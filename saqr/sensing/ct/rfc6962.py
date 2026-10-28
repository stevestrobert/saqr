"""Direct Certificate Transparency log tailer (RFC 6962 `get-sth` / `get-entries`).

Reading the logs directly needs no third-party aggregator: every publicly trusted certificate must be
submitted to logs like Google Argon/Xenon before browsers accept it, so a scammer who obtains a
certificate for `uae-fines-pay.com` publishes that name here within minutes, whatever the TLD.

Each leaf is a MerkleTreeLeaf (RFC 6962 §3.4):
    Version(1) LeafType(1) Timestamp(8) EntryType(2) [X509: len(3)+DER] | [Precert: issuer_key_hash(32)+len(3)+TBS] ...
We parse the (pre)certificate with asn1crypto and extract the subject CN and every SAN dNSName.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import logging
import struct
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import AsyncIterator

import httpx
from asn1crypto import x509 as asn1_x509

from ...models import CertEntry, Source

log = logging.getLogger(__name__)


@dataclass
class ParsedLeaf:
    timestamp: datetime
    is_precert: bool
    domains: list[str]
    issuer: str
    subject: str
    not_before: datetime | None
    not_after: datetime | None
    fingerprint: str
    serial: str = ""


def _names_from_tbs(tbs: asn1_x509.TbsCertificate) -> tuple[list[str], str, str, datetime | None, datetime | None, str]:
    domains: list[str] = []
    subject = ""
    try:
        subj = tbs["subject"].native or {}
        cn = subj.get("common_name")
        if isinstance(cn, list):
            cn = cn[0]
        if cn:
            subject = str(cn)
            if "." in subject and " " not in subject:
                domains.append(subject.lower())
    except Exception:
        pass
    try:
        for ext in tbs["extensions"]:
            if ext["extn_id"].native == "subject_alt_name":
                for gn in ext["extn_value"].parsed:
                    if gn.name == "dns_name":
                        domains.append(str(gn.native).lower())
    except Exception:
        pass
    issuer = ""
    try:
        iss = tbs["issuer"].native or {}
        issuer = str(iss.get("organization_name") or iss.get("common_name") or "")
        cn = iss.get("common_name")
        if cn and cn != issuer:
            issuer = f"{issuer} ({cn})" if issuer else str(cn)
    except Exception:
        pass
    nb = na = None
    try:
        nb = tbs["validity"]["not_before"].native
        na = tbs["validity"]["not_after"].native
    except Exception:
        pass
    serial = ""
    try:
        serial = format(tbs["serial_number"].native, "x")
    except Exception:
        pass
    seen: set[str] = set()
    uniq = [d for d in domains if not (d in seen or seen.add(d))]
    return uniq, issuer, subject, nb, na, serial


def parse_leaf(leaf_input_b64: str) -> ParsedLeaf:
    raw = base64.b64decode(leaf_input_b64)
    fingerprint = hashlib.sha256(raw).hexdigest()
    version, leaf_type = raw[0], raw[1]
    if version != 0 or leaf_type != 0:
        raise ValueError(f"unsupported leaf version/type {version}/{leaf_type}")
    (ts_ms,) = struct.unpack(">Q", raw[2:10])
    (entry_type,) = struct.unpack(">H", raw[10:12])
    pos = 12
    if entry_type == 0:  # x509_entry
        length = int.from_bytes(raw[pos : pos + 3], "big")
        pos += 3
        der = raw[pos : pos + length]
        tbs = asn1_x509.Certificate.load(der)["tbs_certificate"]
        is_precert = False
    elif entry_type == 1:  # precert_entry
        pos += 32  # issuer_key_hash
        length = int.from_bytes(raw[pos : pos + 3], "big")
        pos += 3
        der = raw[pos : pos + length]
        tbs = asn1_x509.TbsCertificate.load(der)
        is_precert = True
    else:
        raise ValueError(f"unknown entry type {entry_type}")
    domains, issuer, subject, nb, na, serial = _names_from_tbs(tbs)
    return ParsedLeaf(
        timestamp=datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc), is_precert=is_precert, domains=domains,
        issuer=issuer, subject=subject, not_before=nb, not_after=na, fingerprint=fingerprint, serial=serial,
    )


def leaf_to_entry(parsed: ParsedLeaf, log_name: str, index: int) -> CertEntry:
    return CertEntry(
        source=Source.ct_log, log=log_name, index=index, issued_at=parsed.timestamp, not_before=parsed.not_before,
        not_after=parsed.not_after, issuer=parsed.issuer, domains=parsed.domains, is_precert=parsed.is_precert,
        fingerprint=parsed.fingerprint,
    )


@dataclass
class TailerStats:
    name: str
    url: str
    tree_size: int = 0
    position: int = 0
    entries: int = 0
    parse_errors: int = 0
    http_errors: int = 0
    last_error: str = ""
    started_at: float = field(default_factory=time.time)
    last_entry_at: float = 0.0
    online: bool = False

    @property
    def lag(self) -> int:
        return max(0, self.tree_size - self.position)

    def as_dict(self) -> dict:
        elapsed = max(1e-6, time.time() - self.started_at)
        return {
            "name": self.name, "url": self.url, "tree_size": self.tree_size, "position": self.position, "lag": self.lag,
            "entries": self.entries, "rate_per_min": round(self.entries / elapsed * 60, 1), "parse_errors": self.parse_errors,
            "http_errors": self.http_errors, "last_error": self.last_error, "online": self.online,
        }


class CTLogTailer:
    """Follows one RFC 6962 log from (tree_size - backfill) onward."""

    def __init__(self, url: str, name: str | None = None, *, batch_size: int = 256, poll_interval: float = 3.0,
                 backfill: int = 64, client: httpx.AsyncClient | None = None) -> None:
        self.url = url.rstrip("/") + "/"
        self.name = name or self.url.split("//", 1)[-1].rstrip("/")
        self.batch_size = batch_size
        self.poll_interval = poll_interval
        self.backfill = backfill
        self._client = client
        self.stats = TailerStats(name=self.name, url=self.url)
        self._stop = asyncio.Event()

    async def _get(self, path: str, params: dict | None = None) -> dict:
        assert self._client is not None
        r = await self._client.get(self.url + "ct/v1/" + path, params=params, timeout=20)
        r.raise_for_status()
        return r.json()

    async def get_sth(self) -> int:
        sth = await self._get("get-sth")
        self.stats.tree_size = int(sth["tree_size"])
        return self.stats.tree_size

    async def get_entries(self, start: int, end: int) -> list[dict]:
        data = await self._get("get-entries", {"start": start, "end": end})
        return data.get("entries", [])

    def stop(self) -> None:
        self._stop.set()

    async def stream(self) -> AsyncIterator[CertEntry]:
        own_client = self._client is None
        if own_client:
            self._client = httpx.AsyncClient(headers={"user-agent": "saqr-ct-tailer/0.1"})
        backoff = 1.0
        try:
            while not self._stop.is_set():
                try:
                    tree_size = await self.get_sth()
                    self.stats.online = True
                    if self.stats.position == 0:
                        self.stats.position = max(0, tree_size - self.backfill)
                    while self.stats.position < tree_size and not self._stop.is_set():
                        start = self.stats.position
                        end = min(start + self.batch_size - 1, tree_size - 1)
                        entries = await self.get_entries(start, end)
                        if not entries:
                            break
                        for i, e in enumerate(entries):
                            idx = start + i
                            try:
                                parsed = parse_leaf(e["leaf_input"])
                            except Exception as exc:  # malformed / unsupported leaf: skip, keep tailing
                                self.stats.parse_errors += 1
                                log.debug("leaf %s@%d parse error: %s", self.name, idx, exc)
                                continue
                            if not parsed.domains:
                                continue
                            self.stats.entries += 1
                            self.stats.last_entry_at = time.time()
                            yield leaf_to_entry(parsed, self.name, idx)
                        self.stats.position = start + len(entries)
                    backoff = 1.0
                    await asyncio.sleep(self.poll_interval)
                except (httpx.HTTPError, ValueError, KeyError) as exc:
                    self.stats.http_errors += 1
                    self.stats.last_error = f"{type(exc).__name__}: {exc}"[:200]
                    self.stats.online = False
                    log.warning("CT log %s: %s (retry in %.0fs)", self.name, self.stats.last_error, backoff)
                    await asyncio.sleep(backoff)
                    backoff = min(backoff * 2, 60)
        finally:
            if own_client and self._client is not None:
                await self._client.aclose()


class MultiLogSource:
    """Merges several tailers into one stream."""

    name = "ctlogs"

    def __init__(self, urls: list[str], names: dict[str, str] | None = None, **kwargs) -> None:
        names = names or {}
        self.tailers = [CTLogTailer(u, names.get(u.rstrip("/") + "/"), **kwargs) for u in urls]

    async def stream(self) -> AsyncIterator[CertEntry]:
        queue: asyncio.Queue[CertEntry | None] = asyncio.Queue(maxsize=5000)

        async def pump(t: CTLogTailer) -> None:
            try:
                async for entry in t.stream():
                    await queue.put(entry)
            finally:
                await queue.put(None)

        tasks = [asyncio.create_task(pump(t)) for t in self.tailers]
        finished = 0
        try:
            while finished < len(tasks):
                item = await queue.get()
                if item is None:
                    finished += 1
                    continue
                yield item
        finally:
            for t in self.tailers:
                t.stop()
            for task in tasks:
                task.cancel()

    def stats(self) -> dict:
        return {"source": self.name, "logs": [t.stats.as_dict() for t in self.tailers]}
