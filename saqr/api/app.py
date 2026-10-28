"""FastAPI application: REST + WebSocket live events + dashboard + demo fixture hosting."""
from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .. import __version__
from ..config import REPO_DIR, Settings, get_settings
from ..db import Store
from ..events import EventBus
from ..models import Action, Campaign, Candidate, Case, Channel, Report, Source
from ..pipeline import Pipeline
from ..response.connectors import describe_connectors
from ..response.dispatcher import DispatchRefused
from ..serializers import case_summary

log = logging.getLogger(__name__)


# ------------------------------------------------------------------------------------------- request bodies
class ApproveBody(BaseModel):
    actor: str = Field(min_length=1, max_length=120)
    channels: list[Channel] | None = None
    note: str = ""


class DismissBody(BaseModel):
    actor: str = Field(min_length=1, max_length=120)
    reason: str = ""


class NoteBody(BaseModel):
    actor: str = Field(min_length=1, max_length=120)
    note: str


class ReportBody(BaseModel):
    channel: str = Field(pattern="^(sms|whatsapp|email|partner|feed|manual)$")
    text: str = Field(min_length=3, max_length=4000)
    sender: str = ""


class UrlBody(BaseModel):
    url: str = Field(min_length=4, max_length=2000)
    source: str = Field(default="manual", pattern="^(partner_report|threat_feed|manual|citizen_report)$")
    note: str = ""


class DemoStartBody(BaseModel):
    speed: float | None = None


class InjectBody(BaseModel):
    domain: str = Field(min_length=3, max_length=253)
    issuer: str = "Let's Encrypt (R12)"


class StepBody(BaseModel):
    step_id: str


# ------------------------------------------------------------------------------------------------- factory
def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    settings.ensure_dirs()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        store = Store(settings.db_path)
        bus = EventBus()
        pipeline = Pipeline(settings, store, bus)
        app.state.store, app.state.bus, app.state.pipeline = store, bus, pipeline
        scenario = None
        if settings.demo_sites_dir.exists():
            if len(pipeline.gallery.refs) == 0:
                log.info("gallery empty: building reference gallery from demo fixtures")
                n = await pipeline.gallery.build_from_fixtures(settings.demo_sites_dir, f"file://{settings.demo_sites_dir}", pipeline.capturer)
                pipeline.gallery.load()
                log.info("gallery built: %d reference pages", n)
            from ..demo.scenario import Scenario
            scenario = Scenario(pipeline, settings.demo_sites_dir, REPO_DIR / "demo" / "scenario.yaml", settings.demo_speed)
            pipeline.scenario = scenario
        app.state.scenario = scenario
        await pipeline.start()
        if scenario and settings.demo_autostart and settings.ct_source in ("replay", "hybrid"):
            await scenario.start()
        try:
            yield
        finally:
            if scenario:
                await scenario.stop()
            await pipeline.stop()
            store.close()

    app = FastAPI(title="SAQR", version=__version__, lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json")

    def P(request: Request) -> Pipeline:  # noqa: N802
        return request.app.state.pipeline

    def S(request: Request) -> Store:  # noqa: N802
        return request.app.state.store

    # ------------------------------------------------------------------------------------ status/metrics
    @app.get("/api/status")
    def status(request: Request):
        return P(request).status()

    @app.get("/api/metrics")
    def metrics(request: Request):
        return P(request).metrics()

    @app.get("/api/feed")
    def feed(request: Request, limit: int = Query(200, le=1000)):
        return {"entries": list(P(request).feed)[:limit]}

    @app.get("/api/match")
    def match(request: Request, domain: str):
        return P(request).matcher.match(domain.strip())

    # ----------------------------------------------------------------------------------------- candidates
    @app.get("/api/candidates")
    def candidates(request: Request, status: str | None = None, limit: int = Query(100, le=1000)):
        where = {"status": status} if status else None
        return S(request).list(Candidate, where, limit=limit)

    # ---------------------------------------------------------------------------------------------- cases
    @app.get("/api/cases")
    def cases(request: Request, state: str | None = None, limit: int = Query(100, le=1000)):
        store = S(request)
        where = {"state": state} if state else None
        return [case_summary(c, store) for c in store.list(Case, where, limit=limit)]

    def _case(request: Request, case_id: str) -> Case:
        c = S(request).get(Case, case_id)
        if not c:
            raise HTTPException(404, "case not found")
        return c

    @app.get("/api/cases/{case_id}")
    def case_detail(request: Request, case_id: str):
        store, pipeline = S(request), P(request)
        c = _case(request, case_id)
        cand = store.get(Candidate, c.candidate_id)
        actions = store.actions_for_case(c.id)
        evidence = store.evidence_for_case(c.id)
        reports = [r for r in (store.get(Report, rid) for rid in c.report_ids) if r]
        campaign = store.get(Campaign, c.campaign_id) if c.campaign_id else None
        reference = None
        if c.verdict.visual:
            ref = pipeline.gallery.get(c.verdict.visual[0].reference_id)
            if ref:
                reference = {"id": ref.id, "name": ref.name, "domain": ref.domain, "entity": ref.entity, "screenshot_url": f"/api/gallery/{ref.id}/screenshot"}
        return {"summary": case_summary(c, store, cand, actions), "case": c, "candidate": cand, "evidence": evidence, "actions": actions,
                "reports": reports, "campaign": campaign, "reference": reference, "capture_text_excerpt": c.capture.text[:1500],
                "demo_site_url": _demo_site_url(pipeline, c.domain)}

    @app.get("/api/cases/{case_id}/screenshot")
    def case_screenshot(request: Request, case_id: str, view: str = "desktop", thumb: int = 0):
        c = _case(request, case_id)
        path = c.capture.screenshot_mobile if view == "mobile" else c.capture.screenshot_desktop
        if not path or not Path(path).exists():
            raise HTTPException(404, "no screenshot")
        if thumb:
            return FileResponse(_thumbnail(Path(path)), media_type="image/png")
        return FileResponse(path, media_type="image/png")

    @app.get("/api/cases/{case_id}/evidence.zip")
    def evidence_zip(request: Request, case_id: str):
        c = _case(request, case_id)
        pkg = S(request).evidence_for_case(c.id)
        if not pkg or not pkg.zip_path or not Path(pkg.zip_path).exists():
            raise HTTPException(404, "evidence package not built yet")
        return FileResponse(pkg.zip_path, media_type="application/zip", filename=f"saqr-evidence-{c.domain}-{c.id}.zip")

    @app.get("/api/cases/{case_id}/evidence/report")
    def evidence_report(request: Request, case_id: str):
        c = _case(request, case_id)
        pkg = S(request).evidence_for_case(c.id)
        if not pkg:
            raise HTTPException(404, "evidence package not built yet")
        p = Path(pkg.directory) / "report.html"
        if not p.exists():
            raise HTTPException(404, "report missing")
        return HTMLResponse(p.read_text(encoding="utf-8"))

    @app.get("/api/cases/{case_id}/evidence/{artifact}")
    def evidence_artifact(request: Request, case_id: str, artifact: str):
        c = _case(request, case_id)
        pkg = S(request).evidence_for_case(c.id)
        if not pkg:
            raise HTTPException(404, "evidence package not built yet")
        allowed = {a.name for a in pkg.artifacts} | {"manifest.json", "chain_of_custody.json", "timestamp.json", "timestamp.tsr", "report.html"}
        if artifact not in allowed or "/" in artifact or ".." in artifact:
            raise HTTPException(404, "unknown artifact")
        p = Path(pkg.directory) / artifact
        if not p.exists():
            raise HTTPException(404, "artifact missing")
        return FileResponse(p)

    @app.post("/api/cases/{case_id}/approve")
    async def approve(request: Request, case_id: str, body: ApproveBody):
        pipeline, store = P(request), S(request)
        _case(request, case_id)
        try:
            case, actions = await pipeline.approve(case_id, body.actor, body.channels, body.note)
        except DispatchRefused as exc:
            raise HTTPException(409, str(exc)) from exc
        return {"case": case_summary(case, store), "actions": actions}

    @app.post("/api/cases/{case_id}/dismiss")
    def dismiss(request: Request, case_id: str, body: DismissBody):
        _case(request, case_id)
        try:
            case = P(request).dismiss(case_id, body.actor, body.reason)
        except DispatchRefused as exc:
            raise HTTPException(409, str(exc)) from exc
        return case_summary(case, S(request))

    @app.post("/api/cases/{case_id}/recheck")
    async def recheck(request: Request, case_id: str):
        _case(request, case_id)
        return await P(request).recheck_now(case_id)

    @app.post("/api/cases/{case_id}/note")
    def note(request: Request, case_id: str, body: NoteBody):
        _case(request, case_id)
        return case_summary(P(request).add_note(case_id, body.actor, body.note), S(request))

    # -------------------------------------------------------------------------------------------- gallery
    @app.get("/api/gallery")
    def gallery(request: Request):
        return [{"id": r.id, "name": r.name, "domain": r.domain, "entity": r.entity, "screenshot_url": f"/api/gallery/{r.id}/screenshot",
                 "has_logo": r.logo is not None} for r in P(request).gallery.refs.values()]

    @app.get("/api/gallery/{ref_id}/screenshot")
    def gallery_screenshot(request: Request, ref_id: str, thumb: int = 0):
        ref = P(request).gallery.get(ref_id)
        if not ref:
            raise HTTPException(404, "unknown reference")
        return FileResponse(_thumbnail(ref.screenshot) if thumb else ref.screenshot, media_type="image/png")

    # -------------------------------------------------------------------------------------------- reports
    @app.get("/api/reports")
    def reports(request: Request, limit: int = Query(100, le=1000)):
        return S(request).list(Report, limit=limit)

    @app.post("/api/reports")
    def submit_report(request: Request, body: ReportBody):
        report, cands, campaign = P(request).ingest_report(body.channel, body.text, body.sender)
        return {"report": report, "candidates": cands, "campaign": campaign}

    @app.post("/api/intake/url")
    def intake_url(request: Request, body: UrlBody):
        try:
            return P(request).ingest_url(body.url, Source(body.source), body.note)
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc

    @app.get("/api/campaigns")
    def campaigns(request: Request):
        return S(request).list(Campaign)

    @app.get("/api/campaigns/{campaign_id}")
    def campaign_detail(request: Request, campaign_id: str):
        store = S(request)
        c = store.get(Campaign, campaign_id)
        if not c:
            raise HTTPException(404, "campaign not found")
        reports = [r for r in (store.get(Report, rid) for rid in c.report_ids) if r]
        cases = [case_summary(x, store) for x in (store.get(Case, cid) for cid in c.case_ids) if x]
        return {"campaign": c, "reports": reports, "cases": cases}

    # ------------------------------------------------------------------------------------- actions/audit
    @app.get("/api/actions")
    def actions(request: Request, case_id: str | None = None, limit: int = Query(200, le=2000)):
        return S(request).list(Action, {"case_id": case_id} if case_id else None, limit=limit)

    @app.get("/api/audit")
    def audit(request: Request, limit: int = Query(200, le=5000)):
        pipeline = P(request)
        v = pipeline.audit.verify()
        return {"entries": pipeline.store.audit_all(limit=limit), "valid": v["valid"], "length": v["length"]}

    @app.post("/api/audit/verify")
    def audit_verify(request: Request):
        return P(request).audit.verify()

    @app.get("/api/protected")
    def protected(request: Request):
        reg = P(request).registry
        return {"official_suffixes": reg.official_suffixes,
                "entities": [{"id": e.id, "name": e.name, "name_ar": e.name_ar, "sector": e.sector, "domains": e.domains, "brands": e.brands,
                              "services": e.services} for e in reg.entities],
                "keywords": {"strong": sorted(reg.strong_keywords), "normal": sorted(reg.normal_keywords)},
                "government_cues": sorted(reg.government_cues), "risky_tlds": sorted(reg.risky_tlds)}

    @app.get("/api/connectors")
    def connectors(request: Request):
        return describe_connectors(P(request).settings.connector_mode)

    # ----------------------------------------------------------------------------------------------- demo
    def _scenario(request: Request):
        sc = request.app.state.scenario
        if sc is None:
            raise HTTPException(404, "demo scenario not available (demo/sites missing)")
        return sc

    @app.get("/api/demo")
    def demo_state(request: Request):
        sc = request.app.state.scenario
        return sc.state() if sc else {"available": False, "running": False, "speed": 1.0, "started_at": None, "elapsed_s": 0, "sites_url": "", "steps": []}

    @app.post("/api/demo/start")
    async def demo_start(request: Request, body: DemoStartBody | None = None):
        return await _scenario(request).start(body.speed if body else None)

    @app.post("/api/demo/stop")
    async def demo_stop(request: Request):
        return await _scenario(request).stop()

    @app.post("/api/demo/reset")
    async def demo_reset(request: Request):
        sc = request.app.state.scenario
        if sc:
            await sc.stop()
        P(request).reset()
        return sc.state() if sc else {"available": False}

    @app.post("/api/demo/inject")
    def demo_inject(request: Request, body: InjectBody):
        _scenario(request).inject(body.domain.strip().lower(), body.issuer, label="presenter injection")
        return {"injected": True, "domain": body.domain.strip().lower()}

    @app.post("/api/demo/step")
    async def demo_step(request: Request, body: StepBody):
        try:
            return await _scenario(request).fire(body.step_id)
        except KeyError:
            raise HTTPException(404, "unknown step") from None

    # ------------------------------------------------------------------------------------------ websocket
    @app.websocket("/ws")
    async def ws(websocket: WebSocket):
        await websocket.accept()
        bus: EventBus = websocket.app.state.bus
        q = bus.subscribe()
        try:
            await websocket.send_text(json.dumps({"type": "hello", "at": None, "data": {"history": list(bus.history), "version": __version__}}, default=str))
            while True:
                try:
                    event = await asyncio.wait_for(q.get(), timeout=20)
                except asyncio.TimeoutError:
                    await websocket.send_text(json.dumps({"type": "ping", "at": None, "data": None}))
                    continue
                await websocket.send_text(json.dumps(event, default=str))
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            bus.unsubscribe(q)

    # ------------------------------------------------------------------------------------------- static
    if settings.demo_sites_dir.exists():
        app.mount("/demo-sites", StaticFiles(directory=str(settings.demo_sites_dir), html=True), name="demo-sites")

    dist = settings.frontend_dist
    if dist.exists() and (dist / "index.html").exists():
        if (dist / "assets").exists():
            app.mount("/assets", StaticFiles(directory=str(dist / "assets")), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        def spa(full_path: str):
            if full_path.startswith("api/") or full_path.startswith("ws"):
                raise HTTPException(404)
            candidate = dist / full_path
            if full_path and candidate.is_file():
                return FileResponse(candidate)
            return FileResponse(dist / "index.html")
    else:
        @app.get("/", include_in_schema=False)
        def root():
            return JSONResponse({"service": "SAQR", "version": __version__, "dashboard": "frontend/dist not built — see README", "api": "/api/docs"})

    return app


# -------------------------------------------------------------------------------------------------- helpers
def _thumbnail(path: Path, width: int = 360) -> Path:
    from PIL import Image

    thumb = path.with_name(path.stem + f"_thumb{width}.png")
    if thumb.exists() and thumb.stat().st_mtime >= path.stat().st_mtime:
        return thumb
    img = Image.open(path).convert("RGB")
    crop_h = min(img.height, int(img.width * 0.75))
    img = img.crop((0, 0, img.width, crop_h))
    img.thumbnail((width, int(width * 0.75 * 1.4)))
    img.save(thumb, optimize=True)
    return thumb


def _demo_site_url(pipeline: Pipeline, domain: str) -> str | None:
    path = pipeline.demo_hosts.get(domain)
    if not path or path.startswith("http"):
        return path
    p = Path(path)
    try:
        rel = p.relative_to(pipeline.settings.demo_sites_dir)
    except ValueError:
        return None
    return f"/demo-sites/{rel.as_posix()}/index.html"


app: FastAPI | None = None


def get_app() -> FastAPI:
    global app
    if app is None:
        app = create_app()
    return app
