"""Replay / synthetic certificate feed for demonstrations and offline development.

Produces a realistic-looking background of benign certificates (names, issuers, wildcard entries, SaaS
subdomains) at a configurable rate, into which scripted "planted" certificates are injected at scheduled
moments (the fake payment pages the demo catches). A HybridSource layers the same injection on top of a
live log tailer so the demo can run against the real global feed.
"""
from __future__ import annotations

import asyncio
import hashlib
import random
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import AsyncIterator

from ...models import CertEntry, Source

WORDS = ["alpha", "beta", "cedar", "delta", "ember", "falcon", "garden", "harbor", "island", "jasper", "kite", "lumen", "maple", "nova", "orbit", "pixel", "quartz", "river", "sierra", "tango", "umber", "violet", "willow", "xenon", "yonder", "zephyr", "atlas", "bloom", "canvas", "dune", "echo", "forge", "grove", "hazel", "iris", "juno", "koala", "lotus", "mesa", "nimbus", "opal", "pearl", "quill", "ridge", "sage", "tide", "ultra", "vista", "wave", "yarrow", "zinc", "aero", "brick", "cloud", "data", "edge", "flux", "glow", "hub", "ion", "jet", "kernel", "loop", "meta", "node", "onyx", "peak", "quest", "rail", "stack", "trail", "unit", "vault", "wire", "axis", "byte", "core", "dash", "eon", "frame", "grid", "hive", "index", "joint", "key", "lane", "mode", "nest", "oak", "port", "rune", "spark", "tile", "urban", "vine", "web", "yard", "bakery", "bistro", "cafe", "clinic", "dental", "fitness", "florist", "garage", "hotel", "kitchen", "laundry", "market", "pharmacy", "salon", "studio", "tailor", "travel", "yoga", "academy", "agency", "capital", "consulting", "digital", "global", "holdings", "industries", "logistics", "media", "partners", "realty", "solutions", "systems", "ventures", "works", "marina", "palm", "beach", "desert", "oasis", "souk", "falconry", "pearl", "coral", "apartments", "properties", "motors", "trading", "electronics", "furniture", "fashion", "jewellery", "perfume", "carpets", "textiles"]
FIRST_NAMES = ["ahmed", "sara", "omar", "fatima", "khalid", "mariam", "yousef", "layla", "hamad", "noor", "ali", "hessa", "rashid", "aisha", "salem"]
TLDS = ["com"] * 40 + ["net"] * 6 + ["org"] * 5 + ["io"] * 4 + ["ae"] * 5 + ["co.uk"] * 3 + ["de"] * 3 + ["xyz"] * 3 + \
       ["shop"] * 2 + ["app"] * 2 + ["dev"] * 2 + ["online"] * 2 + ["store", "cloud", "in", "fr", "nl", "sa", "eg", "top", "site", "me"]
SUBS = ["www", "api", "app", "mail", "cpanel", "webmail", "shop", "staging", "dev", "portal", "my", "cdn", "admin", "m", "blog", "autodiscover"]
ISSUERS = [("Let's Encrypt (R12)", 46), ("Google Trust Services (WE1)", 18), ("ZeroSSL (ZeroSSL RSA Domain Secure Site CA)", 8),
           ("DigiCert Inc (DigiCert Global G2 TLS RSA SHA256 2020 CA1)", 7), ("Sectigo Limited (Sectigo RSA Domain Validation Secure Server CA)", 7),
           ("GoDaddy.com, Inc.", 4), ("Amazon (Amazon RSA 2048 M02)", 5), ("Cloudflare, Inc. (Cloudflare TLS Issuing ECC CA 1)", 4), ("Actalis S.p.A.", 1)]
_ISSUER_POOL = [name for name, w in ISSUERS for _ in range(w)]
LOGS = ["Google Argon 2026h2", "Google Xenon 2026h2", "Cloudflare Nimbus 2026", "Let's Encrypt Oak 2026h2", "DigiCert Wyvern 2026h2"]


def synthetic_domains(rng: random.Random) -> list[str]:
    """One benign certificate's SAN list."""
    roll = rng.random()
    tld = rng.choice(TLDS)
    w = lambda: rng.choice(WORDS)  # noqa: E731
    if roll < 0.35:
        base = f"{w()}{w()}.{tld}"
    elif roll < 0.6:
        base = f"{w()}-{w()}.{tld}"
    elif roll < 0.72:
        base = f"{w()}{rng.randint(1, 99)}.{tld}"
    elif roll < 0.8:
        base = f"{rng.choice(FIRST_NAMES)}{w()}.{tld}"
    elif roll < 0.88:
        base = f"{w()}.{tld}"
    else:
        # near-miss noise: government cues / UAE words without any brand (legitimately common)
        base = rng.choice([f"dubai-{w()}.com", f"{w()}-uae.com", f"emirates-{w()}.ae", f"abudhabi{w()}.com",
                           f"{w()}-payments.com", f"{w()}-tax.co.uk", f"fine-{w()}.com", f"{w()}refund.net", f"gov{w()}.org"])
    domains = [base]
    r2 = rng.random()
    if r2 < 0.45:
        domains.insert(0, f"www.{base}")
    elif r2 < 0.6:
        domains.insert(0, f"*.{base}")
    elif r2 < 0.75:
        domains.extend(f"{rng.choice(SUBS)}.{base}" for _ in range(rng.randint(1, 4)))
    return list(dict.fromkeys(domains))


def _fingerprint(*parts: str) -> str:
    return hashlib.sha256("|".join(parts).encode()).hexdigest()


@dataclass
class Planted:
    """A scripted certificate to inject into the feed."""

    domains: list[str]
    at_seconds: float = 0.0            # offset from stream start (ignored for runtime injection)
    issuer: str = "Let's Encrypt (R12)"
    log: str = "Google Argon 2026h2"
    label: str = ""                    # free text for the scenario UI
    fired: bool = False


@dataclass
class ReplayStats:
    entries: int = 0
    planted: int = 0
    started: float = field(default_factory=time.time)


class ReplaySource:
    name = "replay"

    def __init__(self, rate: float = 18.0, planted: list[Planted] | None = None, seed: int | None = None,
                 speed: float = 1.0) -> None:
        self.rate = rate
        self.planted = list(planted or [])
        self.rng = random.Random(seed)
        self.speed = speed
        self.stats = ReplayStats()
        self._inject: asyncio.Queue[Planted] = asyncio.Queue()
        self._stop = asyncio.Event()
        self._index = 1_000_000 + self.rng.randint(0, 500_000)

    def inject(self, domains: list[str], issuer: str = "Let's Encrypt (R12)", log: str = "Google Argon 2026h2", label: str = "") -> None:
        """Inject a certificate right now (used by the presenter controls and the scenario runner)."""
        self._inject.put_nowait(Planted(domains=domains, issuer=issuer, log=log, label=label))

    def stop(self) -> None:
        self._stop.set()

    def _entry(self, domains: list[str], issuer: str, log_name: str, planted: bool = False) -> CertEntry:
        now = datetime.now(timezone.utc)
        self._index += self.rng.randint(1, 7)
        # Logged a few seconds after issuance; `not_before` is typically backdated by one hour by CAs.
        issued = now - timedelta(seconds=self.rng.uniform(2, 25))
        return CertEntry(
            source=Source.replay, log=log_name, index=self._index, issued_at=issued,
            not_before=issued - timedelta(hours=1), not_after=issued + timedelta(days=90 if "Encrypt" in issuer or "ZeroSSL" in issuer or "Google" in issuer else 397),
            issuer=issuer, domains=domains, is_precert=self.rng.random() < 0.8,
            fingerprint=_fingerprint(log_name, str(self._index), *domains),
        )

    async def stream(self) -> AsyncIterator[CertEntry]:
        start = time.time()
        interval = 1.0 / max(0.1, self.rate)
        while not self._stop.is_set():
            # scheduled plants
            elapsed = (time.time() - start) * self.speed
            for p in self.planted:
                if not p.fired and elapsed >= p.at_seconds:
                    p.fired = True
                    self.stats.planted += 1
                    self.stats.entries += 1
                    yield self._entry(p.domains, p.issuer, p.log, planted=True)
            # runtime injections
            while not self._inject.empty():
                p = self._inject.get_nowait()
                self.stats.planted += 1
                self.stats.entries += 1
                yield self._entry(p.domains, p.issuer, p.log, planted=True)
            # background noise
            self.stats.entries += 1
            yield self._entry(synthetic_domains(self.rng), self.rng.choice(_ISSUER_POOL), self.rng.choice(LOGS))
            await asyncio.sleep(interval * self.rng.uniform(0.4, 1.6))

    def stats_dict(self) -> dict:
        elapsed = max(1e-6, time.time() - self.stats.started)
        return {"source": self.name, "entries": self.stats.entries, "planted": self.stats.planted,
                "rate_per_min": round(self.stats.entries / elapsed * 60, 1), "online": True}


class HybridSource:
    """Live log tailing plus runtime injection (so planted demo domains appear inside the real stream)."""

    name = "hybrid"

    def __init__(self, live, replay: ReplaySource) -> None:
        self.live = live
        self.replay = replay

    def inject(self, *args, **kwargs) -> None:
        self.replay.inject(*args, **kwargs)

    async def stream(self) -> AsyncIterator[CertEntry]:
        queue: asyncio.Queue[CertEntry] = asyncio.Queue(maxsize=5000)

        async def pump_live() -> None:
            async for e in self.live.stream():
                await queue.put(e)

        async def pump_injections() -> None:
            start = time.time()
            while True:
                elapsed = (time.time() - start) * self.replay.speed
                for p in self.replay.planted:
                    if not p.fired and elapsed >= p.at_seconds:
                        p.fired = True
                        self.replay.stats.planted += 1
                        await queue.put(self.replay._entry(p.domains, p.issuer, p.log, planted=True))
                while not self.replay._inject.empty():
                    p = self.replay._inject.get_nowait()
                    self.replay.stats.planted += 1
                    await queue.put(self.replay._entry(p.domains, p.issuer, p.log, planted=True))
                await asyncio.sleep(0.25)

        tasks = [asyncio.create_task(pump_live()), asyncio.create_task(pump_injections())]
        try:
            while True:
                yield await queue.get()
        finally:
            for t in tasks:
                t.cancel()

    def stats(self) -> dict:
        s = self.live.stats()
        s["source"] = "hybrid"
        s["planted"] = self.replay.stats.planted
        return s
