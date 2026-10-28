"""Record a complete demo run as static files, so the real dashboard can be hosted without a server.

`saqr snapshot <out>` starts the node in-process (replayed certificate feed), runs the scripted scenario to the end,
approves the confirmed cases as a named analyst, waits for the partner acknowledgements and then writes:

    <out>/events.json                 every live event the node published (certificates, candidates, cases, actions…)
    <out>/api/<endpoint>.json         the final answer of every GET endpoint the dashboard uses
    <out>/api/initial/*.json          status / metrics / demo as they were before the scenario started
    <out>/api/cases/<id>.json         case detail, plus screenshots, thumbnails and the evidence package files
    <out>/api/gallery/<id>.png        reference screenshots

The dashboard's static build (`npm run build:static`) replays `events.json` on a timer and answers API calls from
these files, so the hosted copy shows the scenario unfolding exactly as the node produced it. Binary URLs inside the
JSON (`/api/cases/<id>/screenshot?view=…`) are rewritten to the static paths under `--url-base`.
"""
from __future__ import annotations

import json
import logging
import re
import shutil
import time
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

GET_ENDPOINTS = ["status", "metrics", "feed", "candidates", "cases", "reports", "campaigns", "actions", "audit", "protected",
                 "gallery", "connectors", "demo"]


def rewrite_urls(text: str, base: str) -> str:
    base = base.rstrip("/")
    text = re.sub(r"/api/cases/([A-Za-z0-9_-]+)/screenshot\?view=(desktop|mobile)&thumb=1", rf"{base}/api/cases/\1/screenshot-\2-thumb.png", text)
    text = re.sub(r"/api/cases/([A-Za-z0-9_-]+)/screenshot\?view=(desktop|mobile)(&thumb=0)?", rf"{base}/api/cases/\1/screenshot-\2.png", text)
    text = re.sub(r"/api/gallery/([A-Za-z0-9_-]+)/screenshot", rf"{base}/api/gallery/\1.png", text)
    return text


def _dump(path: Path, data: Any, base: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(rewrite_urls(json.dumps(data, default=str), base), encoding="utf-8")


def record(out: Path, url_base: str = "/app/data", speed: float = 1.0, actor: str = "Demo analyst", timeout_s: int = 900) -> dict:
    from fastapi.testclient import TestClient

    from ..api.app import _thumbnail, create_app
    from ..config import Settings
    from ..events import EventBus

    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    work = out.parent / (out.name + ".work")
    if work.exists():
        shutil.rmtree(work)

    # Capture every event the node publishes (the bus is created inside the app's lifespan).
    events: list[dict] = []
    original_publish = EventBus.publish

    def recording_publish(self: EventBus, type_: str, data: Any = None, keep: bool = True) -> dict:
        ev = original_publish(self, type_, data, keep)
        events.append(ev)
        return ev

    EventBus.publish = recording_publish  # type: ignore[method-assign]
    try:
        settings = Settings(data_dir=work, ct_source="replay", demo_autostart=False, demo_speed=speed, frontend_dist=work / "no-frontend")
        with TestClient(create_app(settings)) as c:
            t0 = time.time()

            def get(path: str) -> Any:
                r = c.get("/api/" + path)
                r.raise_for_status()
                return r.json()

            for name in ("status", "metrics", "demo"):
                _dump(out / "api" / "initial" / f"{name}.json", get(name), url_base)

            c.post("/api/demo/start", json={"speed": speed}).raise_for_status()
            log.info("scenario started (speed ×%s)", speed)

            def steps_done() -> bool:
                return all(s["fired"] for s in get("demo")["steps"])

            def quiet() -> bool:
                busy = [x for x in get("candidates") if x["status"] in ("queued", "verifying")]
                return not busy

            def parked_caught() -> bool:
                return any(x["domain"] == "dubaipolice-fines.online" and x["verdict"]["label"] == "confirmed_fake" for x in get("cases"))

            while not (steps_done() and quiet() and parked_caught()):
                if time.time() - t0 > timeout_s:
                    raise TimeoutError("scenario did not finish in time")
                time.sleep(2)
            log.info("scenario complete after %.0f s", time.time() - t0)
            time.sleep(8)  # let the last status/metrics ticks land before the approvals

            approved = []
            for case in get("cases"):
                if case["state"] == "open" and case["verdict"]["label"] == "confirmed_fake":
                    r = c.post(f"/api/cases/{case['id']}/approve", json={"actor": actor, "note": "Approved in the recorded demo run"})
                    r.raise_for_status()
                    approved.append(case["domain"])
                    time.sleep(3)
            log.info("approved %d cases: %s", len(approved), ", ".join(approved))

            def settled() -> bool:
                return all(a["status"] in ("acknowledged", "completed", "failed") for a in get("actions"))

            t1 = time.time()
            while not settled():
                if time.time() - t1 > 240:
                    log.warning("some actions never settled; snapshotting anyway")
                    break
                time.sleep(2)
            time.sleep(12)  # final metrics/status ticks

            # ---- final answers of every GET endpoint ---------------------------------------------------
            for name in GET_ENDPOINTS:
                _dump(out / "api" / f"{name}.json", get(name), url_base)
            for camp in get("campaigns"):
                _dump(out / "api" / "campaigns" / f"{camp['id']}.json", get(f"campaigns/{camp['id']}"), url_base)
            store = c.app.state.store
            pipeline = c.app.state.pipeline
            from ..models import Case

            for case in get("cases"):
                cid = case["id"]
                detail = get(f"cases/{cid}")
                _dump(out / "api" / "cases" / f"{cid}.json", detail, url_base)
                cdir = out / "api" / "cases" / cid
                cdir.mkdir(parents=True, exist_ok=True)
                model = store.get(Case, cid)
                for view, path in (("desktop", model.capture.screenshot_desktop), ("mobile", model.capture.screenshot_mobile)):
                    if path and Path(path).exists():
                        shutil.copy(path, cdir / f"screenshot-{view}.png")
                        shutil.copy(_thumbnail(Path(path)), cdir / f"screenshot-{view}-thumb.png")
                pkg = store.evidence_for_case(cid)
                if pkg and Path(pkg.directory).exists():
                    edir = cdir / "evidence"
                    edir.mkdir(exist_ok=True)
                    for f in Path(pkg.directory).iterdir():
                        if f.is_file():
                            shutil.copy(f, edir / f.name)
                    if pkg.zip_path and Path(pkg.zip_path).exists():
                        shutil.copy(pkg.zip_path, cdir / "evidence.zip")
            gdir = out / "api" / "gallery"
            gdir.mkdir(parents=True, exist_ok=True)
            for ref in pipeline.gallery.refs.values():
                if Path(ref.screenshot).exists():
                    shutil.copy(ref.screenshot, gdir / f"{ref.id}.png")
    finally:
        EventBus.publish = original_publish  # type: ignore[method-assign]

    (out / "events.json").write_text(rewrite_urls(json.dumps(events, default=str), url_base), encoding="utf-8")
    shutil.rmtree(work, ignore_errors=True)
    summary = {"events": len(events), "certs": sum(1 for e in events if e["type"] == "cert"),
               "cases": len(json.loads((out / "api" / "cases.json").read_text())), "approved": approved,
               "duration_s": round(time.time() - t0)}
    (out / "summary.json").write_text(json.dumps(summary, indent=2))
    return summary
