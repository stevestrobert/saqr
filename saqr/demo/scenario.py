"""Scripted scenario runner: injects certificates into the feed, forwards messages and flips a parked domain live."""
from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import yaml

from ..models import CandidateStatus, Source
from ..pipeline import Pipeline

log = logging.getLogger(__name__)


@dataclass
class Step:
    id: str
    at: float
    kind: str
    label: str
    data: dict = field(default_factory=dict)
    fired: bool = False
    fired_at: datetime | None = None

    def as_dict(self) -> dict:
        return {"id": self.id, "at_s": self.at, "kind": self.kind, "label": self.label, "fired": self.fired,
                "fired_at": self.fired_at.isoformat() if self.fired_at else None, "domain": self.data.get("domain")}


class Scenario:
    def __init__(self, pipeline: Pipeline, sites_dir: Path, scenario_path: Path, speed: float = 1.0) -> None:
        self.pipeline = pipeline
        self.sites_dir = sites_dir
        self.path = scenario_path
        self.speed = speed
        self.name = ""
        self.description = ""
        self.steps: list[Step] = []
        self.running = False
        self.started_at: float | None = None
        self._task: asyncio.Task | None = None
        self.load()
        self.register_sites()

    # ------------------------------------------------------------------------------------------
    def load(self) -> None:
        raw = yaml.safe_load(self.path.read_text(encoding="utf-8")) if self.path.exists() else {"steps": []}
        self.name = raw.get("name", "demo")
        self.description = raw.get("description", "")
        self.steps = [Step(id=s["id"], at=float(s.get("at", 0)), kind=s["kind"], label=s.get("label", s["id"]),
                           data={k: v for k, v in s.items() if k not in {"id", "at", "kind", "label"}}) for s in raw.get("steps", [])]

    def register_sites(self) -> None:
        """Every fixture domain resolves to its local directory, so reports and presenter injections work too."""
        if not self.sites_dir.exists():
            return
        for kind in ("fake", "benign", "parked", "official"):
            d = self.sites_dir / kind
            if not d.exists():
                continue
            for site in d.iterdir():
                if (site / "index.html").exists():
                    manifest = site / "manifest.json"
                    domain = json.loads(manifest.read_text(encoding="utf-8")).get("domain", site.name) if manifest.exists() else site.name
                    # parked version wins initially; 'activate' steps flip to the live version
                    if kind == "fake" and domain in self.pipeline.demo_hosts and "parked" in self.pipeline.demo_hosts[domain]:
                        continue
                    if kind != "official":
                        self.pipeline.demo_hosts[domain] = str(site)

    def sites_available(self) -> list[dict]:
        out = []
        for domain, path in sorted(self.pipeline.demo_hosts.items()):
            p = Path(path)
            out.append({"domain": domain, "kind": p.parent.name, "path": str(p)})
        return out

    # ------------------------------------------------------------------------------------------
    def state(self) -> dict:
        elapsed = (time.time() - self.started_at) * self.speed if self.started_at else 0.0
        return {"available": True, "running": self.running, "speed": self.speed, "name": self.name, "description": self.description,
                "started_at": datetime.fromtimestamp(self.started_at, tz=timezone.utc).isoformat() if self.started_at else None,
                "elapsed_s": round(elapsed, 1), "sites_url": "/demo-sites/", "steps": [s.as_dict() for s in self.steps],
                "sites": self.sites_available()}

    def set_speed(self, speed: float) -> dict:
        """Change the time multiplier without restarting. While running, the scenario clock is re-based so the
        elapsed scenario time stays the same (otherwise a jump from ×1 to ×4 would fire several steps at once)."""
        new = max(0.1, float(speed))
        if self.running and self.started_at:
            elapsed = (time.time() - self.started_at) * self.speed
            self.started_at = time.time() - elapsed / new
        self.speed = new
        self.pipeline.bus.publish("demo", {"step_id": None, "label": f"Scenario speed ×{self.speed:g}", "kind": "speed"})
        return self.state()

    async def start(self, speed: float | None = None) -> dict:
        if speed:
            if self.running:
                return self.set_speed(speed)
            self.speed = max(0.1, float(speed))
        if self.running:
            return self.state()
        for s in self.steps:
            s.fired, s.fired_at = False, None
        self.running = True
        self.started_at = time.time()
        self._task = asyncio.create_task(self._run())
        self.pipeline.audit.record("presenter", "demo.start", self.name, speed=self.speed)
        self.pipeline.bus.publish("demo", {"step_id": None, "label": f"Scenario '{self.name}' started (speed ×{self.speed})", "kind": "start"})
        return self.state()

    async def stop(self) -> dict:
        self.running = False
        if self._task:
            self._task.cancel()
            self._task = None
        self.pipeline.bus.publish("demo", {"step_id": None, "label": "Scenario stopped", "kind": "stop"})
        return self.state()

    async def _run(self) -> None:
        try:
            while self.running:
                elapsed = (time.time() - self.started_at) * self.speed
                for s in self.steps:
                    if not s.fired and elapsed >= s.at:
                        try:
                            await self.fire(s.id)
                        except Exception as exc:  # a broken step must not kill the scenario
                            log.exception("scenario step %s failed: %s", s.id, exc)
                            self.pipeline.bus.publish("demo", {"step_id": s.id, "label": f"Step {s.id} failed: {exc}", "kind": "error"})
                if all(s.fired for s in self.steps):
                    self.pipeline.bus.publish("demo", {"step_id": None, "label": "Scenario complete", "kind": "end"})
                    break
                await asyncio.sleep(0.5)
        except asyncio.CancelledError:
            pass
        finally:
            self.running = False

    async def fire(self, step_id: str) -> dict:
        step = next((s for s in self.steps if s.id == step_id), None)
        if step is None:
            raise KeyError(step_id)
        step.fired, step.fired_at = True, datetime.now(timezone.utc)
        d = step.data
        site = d.get("site")
        if site:
            self.pipeline.demo_hosts[d.get("domain") or self._domain_of_site(site)] = str(self.sites_dir / site)
        if step.kind == "cert":
            self.inject(d["domain"], d.get("issuer", "Let's Encrypt (R12)"), label=step.label)
        elif step.kind == "report":
            self.pipeline.ingest_report(d.get("channel", "sms"), d["text"], d.get("sender", ""))
        elif step.kind == "activate":
            domain = d["domain"]
            cand = self.pipeline.store.candidate_by_domain(domain)
            if cand and cand.case_id:
                if cand.status not in (CandidateStatus.queued, CandidateStatus.verifying):  # never two verifications at once
                    cand.status = CandidateStatus.queued
                    self.pipeline.store.put(cand)
                    self.pipeline._stage(cand, "recheck", "scheduled re-check (page changed since last visit)")
                    self.pipeline.queue.put_nowait(cand)
            elif not cand:
                self.pipeline.enqueue_candidate(domain, f"https://{domain}/", Source.manual, match=self.pipeline.matcher.match(domain), note="activated")
        self.pipeline.audit.record("presenter", "demo.step", step.id, kind=step.kind, label=step.label)
        self.pipeline.bus.publish("demo", {"step_id": step.id, "label": step.label, "kind": step.kind})
        return self.state()

    def inject(self, domain: str, issuer: str = "Let's Encrypt (R12)", label: str = "") -> None:
        src = self.pipeline.source
        domains = [domain, f"www.{domain}"]
        if src is not None and hasattr(src, "inject"):
            src.inject(domains, issuer=issuer, label=label)
        else:
            # no injectable source (e.g. ctlogs only): synthesise the entry directly
            from ..sensing.ct.replay import ReplaySource
            entry = ReplaySource()._entry(domains, issuer, "Google Argon 2026h2", planted=True)
            self.pipeline.ingest_cert(entry)

    def _domain_of_site(self, site: str) -> str:
        manifest = self.sites_dir / site / "manifest.json"
        if manifest.exists():
            return json.loads(manifest.read_text(encoding="utf-8")).get("domain", Path(site).name)
        return Path(site).name
