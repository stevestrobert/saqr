"""certstream aggregator client (wss://certstream.calidog.io or a self-hosted certstream-server)."""
from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from typing import AsyncIterator

import websockets

from ...models import CertEntry, Source

log = logging.getLogger(__name__)


def _ts(value) -> datetime | None:
    try:
        return datetime.fromtimestamp(float(value), tz=timezone.utc)
    except Exception:
        return None


def message_to_entry(msg: dict) -> CertEntry | None:
    if msg.get("message_type") != "certificate_update":
        return None
    data = msg.get("data", {})
    leaf = data.get("leaf_cert", {})
    domains = [d.lower() for d in leaf.get("all_domains", []) if d]
    if not domains:
        return None
    chain = data.get("chain") or []
    issuer = ""
    if chain:
        subj = chain[0].get("subject", {})
        issuer = subj.get("O") or subj.get("CN") or ""
    elif leaf.get("issuer"):
        issuer = leaf["issuer"].get("O") or leaf["issuer"].get("CN") or ""
    src = data.get("source", {})
    return CertEntry(
        source=Source.certstream, log=src.get("name") or src.get("url", "certstream"), index=data.get("cert_index"),
        issued_at=_ts(data.get("seen")) or datetime.now(timezone.utc), not_before=_ts(leaf.get("not_before")),
        not_after=_ts(leaf.get("not_after")), issuer=issuer, domains=domains,
        is_precert=data.get("update_type") == "PrecertLogEntry", fingerprint=(leaf.get("fingerprint") or "").replace(":", "").lower(),
    )


class CertstreamSource:
    name = "certstream"

    def __init__(self, url: str = "wss://certstream.calidog.io") -> None:
        self.url = url
        self.entries = 0
        self.errors = 0
        self.last_error = ""
        self.online = False
        self.started = time.time()
        self._stop = asyncio.Event()

    def stop(self) -> None:
        self._stop.set()

    async def stream(self) -> AsyncIterator[CertEntry]:
        backoff = 1.0
        while not self._stop.is_set():
            try:
                async with websockets.connect(self.url, max_size=2**22, ping_interval=20) as ws:
                    self.online = True
                    backoff = 1.0
                    async for raw in ws:
                        try:
                            entry = message_to_entry(json.loads(raw))
                        except Exception:
                            continue
                        if entry:
                            self.entries += 1
                            yield entry
                        if self._stop.is_set():
                            break
            except Exception as exc:
                self.online = False
                self.errors += 1
                self.last_error = f"{type(exc).__name__}: {exc}"[:200]
                log.warning("certstream: %s (retry in %.0fs)", self.last_error, backoff)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 60)

    def stats(self) -> dict:
        elapsed = max(1e-6, time.time() - self.started)
        return {"source": self.name, "url": self.url, "entries": self.entries, "rate_per_min": round(self.entries / elapsed * 60, 1),
                "errors": self.errors, "last_error": self.last_error, "online": self.online}
