"""Pipeline orchestrator: Sense -> Assess -> Qualify -> Respond.

One Pipeline instance owns the certificate source, the look-alike filter, the verification workers (isolated
browser + visual/logo/text/form analysis), the evidence builder, campaign grouping, the dispatcher and the
audit log. Everything it does is announced on the event bus so the dashboard follows along live.
"""
from __future__ import annotations

import asyncio
import logging
import statistics
import time
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Any

from . import __version__
from .config import Settings
from .db import Store
from .events import EventBus
from .evidence.package import EvidenceBuilder
from .models import (
    Action,
    Campaign,
    Candidate,
    CandidateStatus,
    Case,
    CaseState,
    CertEntry,
    Channel,
    EvidencePackage,
    MatchResult,
    Metrics,
    Report,
    Source,
    TlsInfo,
    VerdictLabel,
    VisualMatch,
    utcnow,
)
from .response.audit import AuditLog
from .response.campaigns import CampaignManager
from .response.dispatcher import Dispatcher, DispatchRefused
from .sensing.ct.replay import HybridSource, ReplaySource
from .sensing.ct.rfc6962 import MultiLogSource
from .sensing.matcher import LookalikeMatcher
from .sensing.protected import get_registry
from .sensing.reports import build_report, domain_of, extract_iocs
from .serializers import case_summary
from .verification.browser import BrowserCapturer
from .verification.gallery import Gallery
from .verification.logos import find_logos
from .verification.scoring import decide
from .verification.visual import build_encoder, load_image

log = logging.getLogger(__name__)


class Pipeline:
    def __init__(self, settings: Settings, store: Store, bus: EventBus) -> None:
        self.settings = settings
        self.store = store
        self.bus = bus
        settings.ensure_dirs()
        self.registry = get_registry()
        self.matcher = LookalikeMatcher(self.registry, threshold=settings.match_threshold)
        self.audit = AuditLog(store, on_entry=lambda e: bus.publish("audit", e))
        self.encoder = build_encoder(settings.visual_encoder, settings.dino_model, settings.dino_fallback_model)
        self.gallery = Gallery(settings.gallery_dir, self.encoder)
        self.gallery.load()
        self.capturer = BrowserCapturer(settings.browser_timeout_ms, settings.browser_proxy, settings.capture_mobile)
        self.evidence = EvidenceBuilder(settings)
        self.campaigns = CampaignManager(store)
        self.dispatcher = Dispatcher(store, self.registry, self.audit, mode=settings.connector_mode,
                                     ack_scale=1.0 / max(0.1, settings.demo_speed),
                                     on_action=lambda a: bus.publish("action", a), on_case=self._publish_case)
        self.feed: deque[CertEntry] = deque(maxlen=settings.feed_buffer)
        self.queue: asyncio.Queue[Candidate] = asyncio.Queue()
        self.demo_hosts: dict[str, str] = {}          # domain -> local fixture directory (demo) or http base
        self.source: Any = None
        self.started_at = utcnow()
        self.certs_seen = 0
        self.certs_candidates = 0
        self._rate_window: deque[float] = deque(maxlen=20000)
        self._cert_event_window: deque[float] = deque(maxlen=64)
        self._tasks: list[asyncio.Task] = []
        self._running = False
        self.scenario: Any = None                     # set by the demo module

    # ========================================================================================= lifecycle
    def build_source(self) -> Any:
        s = self.settings
        if s.ct_source == "none":
            return None
        replay = ReplaySource(rate=s.replay_rate, speed=s.demo_speed)
        if s.ct_source == "replay":
            return replay
        if s.ct_source == "certstream":
            from .sensing.ct.certstream import CertstreamSource
            live = CertstreamSource(s.certstream_url)
        else:
            import json

            from .config import DATA_DIR
            names = {}
            try:
                for entry in json.loads((DATA_DIR / "ct_logs.json").read_text())["logs"]:
                    names[entry["url"].rstrip("/") + "/"] = entry["name"]
            except Exception:
                pass
            live = MultiLogSource(s.ct_log_urls, names=names, batch_size=s.ct_batch_size, poll_interval=s.ct_poll_interval)
        if s.ct_source == "hybrid":
            return HybridSource(live, replay)
        return live

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self.bus.bind_loop(asyncio.get_running_loop())
        self.source = self.build_source()
        if self.source is not None:
            self._tasks.append(asyncio.create_task(self._consume_source(), name="source"))
        for i in range(max(1, self.settings.verify_concurrency)):
            self._tasks.append(asyncio.create_task(self._verifier(), name=f"verifier-{i}"))
        self._tasks.append(asyncio.create_task(self._recheck_loop(), name="recheck"))
        self._tasks.append(asyncio.create_task(self._ticker(), name="ticker"))
        # re-queue work interrupted by a restart
        for cand in self.store.list(Candidate, {"status": [CandidateStatus.queued.value, CandidateStatus.verifying.value]}):
            cand.status = CandidateStatus.queued
            self.store.put(cand)
            self.queue.put_nowait(cand)
        self.audit.record("system", "node.start", self.settings.node_name, version=__version__, encoder=self.encoder.name,
                          source=self.settings.ct_source, gallery=len(self.gallery.refs))
        log.info("pipeline started: source=%s encoder=%s gallery=%d", self.settings.ct_source, self.encoder.name, len(self.gallery.refs))

    async def stop(self) -> None:
        self._running = False
        for t in self._tasks:
            t.cancel()
        for t in self._tasks:
            try:
                await t
            except (asyncio.CancelledError, Exception):
                pass
        self._tasks.clear()
        await self.capturer.close()

    # ======================================================================================== sensing
    async def _consume_source(self) -> None:
        try:
            async for entry in self.source.stream():
                self.ingest_cert(entry)
                if self.certs_seen % 50 == 0:
                    await asyncio.sleep(0)  # let the event loop breathe on a fast live feed
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.exception("source stream ended: %s", exc)

    def ingest_cert(self, entry: CertEntry) -> Candidate | None:
        self.certs_seen += 1
        self._rate_window.append(time.time())
        m = self.matcher.best_match(entry.domains)
        if m:
            entry.match_score = 0 if m.allowlisted else m.score
            entry.allowlisted = m.allowlisted
            entry.matched_domain = m.domain if (m.is_candidate or m.allowlisted) else None
        self.feed.appendleft(entry)
        interesting = bool(m and (m.is_candidate or m.allowlisted))
        if interesting or self._cert_event_allowed():
            self.bus.publish("cert", entry, keep=False)
        if m and m.is_candidate and not m.allowlisted:
            self.certs_candidates += 1
            self.store.put(entry)
            return self.enqueue_candidate(m.domain, f"https://{m.domain}/", entry.source, match=m, cert=entry)
        return None

    CERT_EVENTS_PER_SECOND = 30

    def _cert_event_allowed(self) -> bool:
        """The live feed can exceed 150 certificates/s; the dashboard ticker only needs a representative sample.
        Candidates and allow-listed names are always published; background noise is rate-limited."""
        now = time.time()
        win = self._cert_event_window
        while win and now - win[0] > 1.0:
            win.popleft()
        if len(win) >= self.CERT_EVENTS_PER_SECOND:
            return False
        win.append(now)
        return True

    def enqueue_candidate(self, domain: str, url: str, source: Source, *, match: MatchResult | None = None,
                          cert: CertEntry | None = None, report: Report | None = None, note: str = "") -> Candidate:
        domain = domain.lower()
        existing = self.store.candidate_by_domain(domain)
        if existing and existing.status != CandidateStatus.dismissed:
            changed = False
            if report and report.id not in existing.report_ids:
                existing.report_ids.append(report.id)
                changed = True
                if existing.case_id:
                    case = self.store.get(Case, existing.case_id)
                    if case and report.id not in case.report_ids:
                        case.report_ids.append(report.id)
                        case.add_event("report", f"Citizen report via {report.channel}", report.text[:140], actor="citizen")
                        self.store.put(case)
                        self.bus.publish("case", case_summary(case, self.store, existing))
            if cert and not existing.cert_id:
                existing.cert_id, existing.issued_at = cert.id, cert.issued_at or cert.not_before
                changed = True
            if changed:
                self.store.put(existing)
                self.bus.publish("candidate", existing)
            return existing
        cand = Candidate(domain=domain, url=url, source=source, match=match, cert_id=cert.id if cert else None,
                         issued_at=(cert.issued_at or cert.not_before) if cert else None,
                         report_ids=[report.id] if report else [], note=note)
        self.store.put(cand)
        self.audit.record("system", "candidate.created", cand.id, domain=domain, source=source.value,
                          score=match.score if match else None, reasons=[r.detail for r in (match.reasons[:3] if match else [])])
        self.bus.publish("candidate", cand)
        self.bus.publish("verification", {"candidate_id": cand.id, "domain": domain, "stage": "queued", "message": "queued for isolated-browser verification"})
        self.queue.put_nowait(cand)
        return cand

    # ---------------------------------------------------------------------------------------- reports
    def ingest_report(self, channel: str, text: str, sender: str = "") -> tuple[Report, list[Candidate], Any]:
        report = build_report(channel, text, sender)
        self.store.put(report)
        self.audit.record("citizen" if channel in ("sms", "whatsapp", "email") else channel, "report.received", report.id,
                          channel=channel, urls=report.urls, sender=report.sender_masked)
        campaign = self.campaigns.assign_report(report)
        cands: list[Candidate] = []
        src = Source.citizen_report if channel in ("sms", "whatsapp", "email") else Source.partner_report
        for url in report.urls:
            dom = domain_of(url)
            m = self.matcher.match(dom)
            if m.allowlisted:
                self.audit.record("system", "report.url_allowlisted", report.id, url=url, entity=m.protected_entity)
                continue
            cand = self.enqueue_candidate(dom, url, src, match=m, report=report, note=f"reported via {channel}")
            if cand.id not in report.candidate_ids:
                report.candidate_ids.append(cand.id)
            cands.append(cand)
        self.store.put(report)
        self.bus.publish("report", report)
        self.bus.publish("campaign", campaign)
        return report, cands, campaign

    def ingest_url(self, url: str, source: Source, note: str = "") -> Candidate:
        if not url.startswith("http"):
            url = "https://" + url
        dom = domain_of(url)
        m = self.matcher.match(dom)
        if m.allowlisted:
            raise ValueError(f"{dom} is an official government property; nothing to verify")
        cand = self.enqueue_candidate(dom, url, source, match=m, note=note)
        return cand

    # ===================================================================================== verification
    async def _verifier(self) -> None:
        while True:
            cand = await self.queue.get()
            try:
                await self.verify(cand)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.exception("verification of %s failed: %s", cand.domain, exc)
                self.bus.publish("verification", {"candidate_id": cand.id, "domain": cand.domain, "stage": "error", "message": str(exc)[:200]})
                cand.status = CandidateStatus.verified
                self.store.put(cand)
            finally:
                self.queue.task_done()

    def _stage(self, cand: Candidate, stage: str, message: str) -> None:
        self.bus.publish("verification", {"candidate_id": cand.id, "domain": cand.domain, "stage": stage, "message": message})

    async def verify(self, cand: Candidate) -> Case:
        t0 = time.time()
        cand.status = CandidateStatus.verifying
        self.store.put(cand)
        override = self.demo_hosts.get(cand.domain)
        self._stage(cand, "opening", "opening in an isolated browser (desktop + mobile)")
        out_dir = self.settings.captures_dir / cand.id / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
        cap = await self.capturer.capture(cand.url, out_dir, domain=cand.domain, override_base=override, tag="capture")
        cert = self.store.get(CertEntry, cand.cert_id) if cand.cert_id else None
        if override and cap.tls is None and cert:
            cap.tls = TlsInfo(issuer=cert.issuer, subject=f"CN={cand.domain}", valid_from=cert.not_before, valid_to=cert.not_after,
                              protocol="TLS 1.3", sans=cert.domains, fingerprint_sha256=cert.fingerprint)
        self._stage(cand, "captured", f"captured in {cap.duration_ms} ms" + (f" — {cap.error}" if cap.error else ""))

        visual: list[VisualMatch] = []
        logos = []
        if cap.ok and cap.screenshot_desktop:
            self._stage(cand, "analysing", f"comparing with {len(self.gallery.refs)} official pages ({self.encoder.name}), logo and form analysis")
            loop = asyncio.get_running_loop()
            visual, logos = await loop.run_in_executor(None, self._analyse, cap.screenshot_desktop)
        verdict = decide(capture=cap, match=cand.match, cert=cert, visual=visual, logos=logos, encoder=self.encoder.name,
                         registry=self.registry, domain=cand.domain)
        self._stage(cand, "scored", f"{verdict.label.value} · risk {verdict.risk}/100")

        now = utcnow()
        case = self.store.get(Case, cand.case_id) if cand.case_id else None
        is_recheck = case is not None
        if case is None:
            case = Case(candidate_id=cand.id, domain=cand.domain, url=cand.url, source=cand.source, detected_at=cand.first_seen,
                        issued_at=cand.issued_at, verdict=verdict, capture=cap, report_ids=list(cand.report_ids))
            if cand.issued_at:
                case.add_event("issued", "Certificate logged in Certificate Transparency", f"{cert.log if cert else ''} · {cert.issuer if cert else ''}", at=cand.issued_at)
            src_detail = (f"look-alike score {cand.match.score}/100 — {cand.match.summary}" if cand.match and cand.match.is_candidate
                          else (cand.note or "submitted for verification"))
            case.add_event("detected", f"Flagged by the {cand.source.value.replace('_', ' ')} filter", src_detail, at=cand.first_seen)
            for rid in cand.report_ids:
                r = self.store.get(Report, rid)
                if r:
                    case.add_event("report", f"Citizen report via {r.channel}", r.text[:140], actor="citizen", at=r.received_at)
        else:
            case.verdict, case.capture = verdict, cap
            case.add_event("recheck", f"Re-verified (attempt {cand.recheck_count})", f"{verdict.label.value} · risk {verdict.risk}/100", at=now)
        case.verified_at = now
        case.iocs = extract_iocs(cap.text)
        if verdict.label == VerdictLabel.inactive:
            case.state = CaseState.monitoring
            if not is_recheck:
                case.add_event("verified", "Page not active yet — kept under watch", verdict.explanations[0] if verdict.explanations else "", at=now)
            cand.recheck_count += 1
            if cand.recheck_count <= self.settings.recheck_max:
                cand.status = CandidateStatus.rechecking
                cand.next_recheck_at = now + timedelta(seconds=self.settings.recheck_interval_s / max(0.1, self.settings.demo_speed))
            else:
                cand.status = CandidateStatus.verified
                case.state = CaseState.closed
                case.add_event("dismissed", "Still inactive after the maximum number of re-checks", actor="system", at=now)
        else:
            cand.status = CandidateStatus.verified
            cand.next_recheck_at = None
            if verdict.label in (VerdictLabel.benign, VerdictLabel.official):
                case.state = CaseState.closed
                case.add_event("verified", "Cleared: no impersonation" if verdict.label == VerdictLabel.benign else "Official property (allow-listed)",
                               "; ".join(verdict.explanations[:2]), at=now)
            else:
                case.state = CaseState.open
                case.add_event("verified", f"Verified as {verdict.label.value.replace('_', ' ')} (risk {verdict.risk}/100)",
                               "; ".join(verdict.explanations[:2]), at=now)
        cand.case_id = case.id
        self.store.put(case)
        self.store.put(cand)
        self.audit.record("system", "case.verified" if not is_recheck else "case.rechecked", case.id, domain=case.domain,
                          verdict=verdict.label.value, risk=verdict.risk, components=verdict.components, seconds=round(time.time() - t0, 1))
        self.bus.publish("candidate", cand)
        self.bus.publish("case", case_summary(case, self.store, cand))

        # campaign grouping (confirmed/suspicious, or anything a citizen reported)
        infra = {"ips": [cap.ip] if cap.ip else [], "issuers": [cert.issuer] if cert else []}
        entity = (cand.match.protected_entity if cand.match else None) or (verdict.text.brand_mentions[0] if verdict.text.brand_mentions else None)
        camp = self.campaigns.attach_case(case, infra=infra, entity=entity) if (verdict.label in (VerdictLabel.confirmed_fake, VerdictLabel.suspicious) or case.report_ids) else None
        if camp:
            self.store.put(case)
            self.bus.publish("campaign", camp)

        # evidence package for anything that may be acted on
        if verdict.label in (VerdictLabel.confirmed_fake, VerdictLabel.suspicious):
            self._stage(cand, "evidence", "building the evidence package (hashes, DNS, RDAP, certificate, hosting, timestamp)")
            pkg = await self.evidence.build(case, cert, demo_override=bool(override))
            self.store.put(pkg)
            case.evidence_id = pkg.id
            case.add_event("evidence", f"Evidence package sealed ({len(pkg.artifacts)} artifacts)",
                           f"Merkle root {pkg.merkle_root[:16]}… · {pkg.timestamp.kind if pkg.timestamp else ''} timestamp", at=pkg.created_at)
            self.store.put(case)
            self.audit.record("system", "evidence.sealed", pkg.id, case=case.id, merkle_root=pkg.merkle_root, manifest_sha256=pkg.manifest_sha256,
                              timestamp=pkg.timestamp.kind if pkg.timestamp else None, artifacts=len(pkg.artifacts))
            self.bus.publish("evidence", {"case_id": case.id, "evidence_id": pkg.id, "artifacts": len(pkg.artifacts), "merkle_root": pkg.merkle_root,
                                          "timestamp_kind": pkg.timestamp.kind if pkg.timestamp else None})
            self.bus.publish("case", case_summary(case, self.store, cand))
        self._stage(cand, "done", f"{verdict.label.value} in {time.time() - t0:.1f}s")
        self.bus.publish("metrics", self.metrics())
        return case

    def _analyse(self, screenshot_path: str) -> tuple[list[VisualMatch], list]:
        img = load_image(screenshot_path)
        visual = [VisualMatch(reference_id=ref.id, reference_name=ref.name, reference_domain=ref.domain, similarity=sim, ssim=ss, encoder=self.encoder.name)
                  for ref, sim, ss in self.gallery.index.search(img, k=3)]
        logos = find_logos(screenshot_path, self.gallery.logos) if self.gallery.logos else []
        return visual, logos

    async def _recheck_loop(self) -> None:
        while True:
            await asyncio.sleep(5)
            try:
                now = utcnow()
                for cand in self.store.list(Candidate, {"status": CandidateStatus.rechecking.value}):
                    if cand.next_recheck_at and cand.next_recheck_at <= now:
                        cand.status = CandidateStatus.queued
                        self.store.put(cand)
                        self._stage(cand, "recheck", f"re-checking inactive domain (attempt {cand.recheck_count + 1})")
                        self.queue.put_nowait(cand)
            except Exception as exc:
                log.warning("recheck loop: %s", exc)

    async def recheck_now(self, case_id: str) -> Candidate:
        case = self.store.get(Case, case_id)
        if not case:
            raise KeyError(case_id)
        cand = self.store.get(Candidate, case.candidate_id)
        if not cand:
            raise KeyError(case.candidate_id)
        if cand.status in (CandidateStatus.queued, CandidateStatus.verifying):
            return cand
        cand.status = CandidateStatus.queued
        self.store.put(cand)
        self.audit.record("analyst", "case.recheck", case.id, domain=case.domain)
        self._stage(cand, "recheck", "manual re-check requested")
        self.queue.put_nowait(cand)
        return cand

    # ======================================================================================== response
    async def approve(self, case_id: str, actor: str, channels: list[Channel] | None = None, note: str = "") -> tuple[Case, list]:
        case = self.store.get(Case, case_id)
        if not case:
            raise KeyError(case_id)
        pkg = self.store.evidence_for_case(case.id)
        actions = await self.dispatcher.approve_and_dispatch(case, pkg, actor, channels, note)
        case = self.store.get(Case, case_id) or case
        self.bus.publish("metrics", self.metrics())
        return case, actions

    def dismiss(self, case_id: str, actor: str, reason: str) -> Case:
        case = self.store.get(Case, case_id)
        if not case:
            raise KeyError(case_id)
        if case.state in (CaseState.approved, CaseState.blocked, CaseState.taken_down):
            raise DispatchRefused("cannot dismiss a case after dispatch")
        case.state = CaseState.false_positive
        case.analyst_note = reason
        case.add_event("dismissed", "Dismissed as false positive", reason, actor=actor)
        self.store.put(case)
        cand = self.store.get(Candidate, case.candidate_id)
        if cand:
            cand.status = CandidateStatus.dismissed
            self.store.put(cand)
        self.audit.record(actor, "case.dismiss", case.id, domain=case.domain, reason=reason)
        self.bus.publish("case", case_summary(case, self.store, cand))
        self.bus.publish("metrics", self.metrics())
        return case

    def add_note(self, case_id: str, actor: str, note: str) -> Case:
        case = self.store.get(Case, case_id)
        if not case:
            raise KeyError(case_id)
        case.analyst_note = note
        case.add_event("note", "Analyst note", note, actor=actor)
        self.store.put(case)
        self.audit.record(actor, "case.note", case.id, note=note)
        self.bus.publish("case", case_summary(case, self.store))
        return case

    async def _publish_case(self, case: Case) -> None:
        self.bus.publish("case", case_summary(case, self.store))
        if case.campaign_id:
            self.campaigns.mark_contained(case.campaign_id)

    # ========================================================================================= metrics
    def certs_per_minute(self) -> float:
        now = time.time()
        return float(sum(1 for t in self._rate_window if now - t <= 60))

    def metrics(self) -> Metrics:
        cases = self.store.list(Case)
        s = self.settings
        tti = [(c.detected_at - c.issued_at).total_seconds() / 60 for c in cases if c.issued_at and c.verdict.label in (VerdictLabel.confirmed_fake, VerdictLabel.suspicious)]
        ver = [(c.verified_at - c.detected_at).total_seconds() / 60 for c in cases if c.verified_at]
        exp = [(c.blocked_at - (c.issued_at or c.detected_at)).total_seconds() / 60 for c in cases if c.blocked_at]
        base_tti, base_exp = s.baseline_tti_hours * 60, s.baseline_exposure_hours * 60
        med = lambda xs: round(statistics.median(xs), 2) if xs else None  # noqa: E731
        m = Metrics(
            certs_seen=self.certs_seen, certs_per_minute=self.certs_per_minute(), candidates=self.store.count(Candidate),
            cases_open=sum(1 for c in cases if c.state == CaseState.open),
            cases_confirmed=sum(1 for c in cases if c.verdict.label == VerdictLabel.confirmed_fake),
            cases_blocked=sum(1 for c in cases if c.blocked_at), reports=self.store.count(Report),
            campaigns=self.store.count(Campaign),
            false_positives=sum(1 for c in cases if c.state == CaseState.false_positive or c.verdict.label == VerdictLabel.benign),
            median_tti_minutes=med(tti), median_verify_minutes=med(ver), median_exposure_minutes=med(exp),
            baseline_tti_minutes=base_tti, baseline_exposure_minutes=base_exp,
            tti_reduction_pct=round((1 - med(tti) / base_tti) * 100, 1) if tti else None,
            exposure_reduction_pct=round((1 - med(exp) / base_exp) * 100, 1) if exp else None,
            funnel={"certs_seen": self.certs_seen, "filtered": max(0, self.certs_seen - self.certs_candidates), "candidates": self.store.count(Candidate),
                    "verified": sum(1 for c in cases), "confirmed": sum(1 for c in cases if c.verdict.label == VerdictLabel.confirmed_fake),
                    "approved": sum(1 for c in cases if c.approved_at), "blocked": sum(1 for c in cases if c.blocked_at)},
            sources=self.source_stats(),
        )
        return m

    def source_stats(self) -> dict:
        if self.source is None:
            return {"source": "none", "online": False, "entries": 0, "rate_per_min": 0}
        if hasattr(self.source, "stats_dict"):
            return self.source.stats_dict()
        return self.source.stats()

    def status(self) -> dict:
        return {
            "node": self.settings.node_name, "version": __version__, "started_at": self.started_at, "uptime_s": round((utcnow() - self.started_at).total_seconds()),
            "sources": self.source_stats(), "encoder": {"name": self.encoder.name, "model": getattr(self.encoder, "model_id", "built-in"), "dims": self.encoder.dims},
            "connector_mode": self.settings.connector_mode, "match_threshold": self.settings.match_threshold,
            "demo": self.scenario.state() if self.scenario else {"available": False, "running": False, "speed": 1.0, "started_at": None, "elapsed_s": 0, "sites_url": "", "steps": []},
            "protected_entities": len(self.registry.entities), "gallery_size": len(self.gallery.refs),
            "counts": {"certs_seen": self.certs_seen, "candidates": self.store.count(Candidate), "cases": self.store.count(Case), "reports": self.store.count(Report),
                       "campaigns": self.store.count(Campaign), "actions": self.store.count(Action)},
        }

    async def _ticker(self) -> None:
        n = 0
        while True:
            await asyncio.sleep(5)
            n += 1
            try:
                self.bus.publish("metrics", self.metrics(), keep=False)
                if n % 2 == 0:
                    self.bus.publish("status", self.status(), keep=False)
            except Exception as exc:
                log.debug("ticker: %s", exc)

    # ============================================================================================ demo
    def reset(self) -> None:
        """Wipe operational state (demo reset). Keeps registry, gallery and keys."""
        for model in (Action, EvidencePackage, Case, Candidate, Report, Campaign, CertEntry):
            for item in self.store.list(model, order=""):
                self.store.delete(model, item.id)
        self.feed.clear()
        self.certs_seen = self.certs_candidates = 0
        self._rate_window.clear()
        while not self.queue.empty():
            self.queue.get_nowait()
        self.audit.record("analyst", "demo.reset", self.settings.node_name)
        self.bus.history.clear()
        self.bus.publish("metrics", self.metrics())
