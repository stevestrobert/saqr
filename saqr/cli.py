"""Command-line interface: `saqr serve|demo|watch|match|verify|gallery|evidence|audit|report`."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import time
from pathlib import Path

import typer
from rich import print as rprint
from rich.console import Console
from rich.table import Table

from . import __version__
from .config import Settings, get_settings

cli = typer.Typer(help="SAQR — early warning and one-click takedown for impersonated government financial services.", no_args_is_help=True)
gallery_cli = typer.Typer(help="Reference gallery of official pages.")
evidence_cli = typer.Typer(help="Evidence package tools.")
audit_cli = typer.Typer(help="Audit log tools.")
cli.add_typer(gallery_cli, name="gallery")
cli.add_typer(evidence_cli, name="evidence")
cli.add_typer(audit_cli, name="audit")
console = Console()


def _logging(level: str) -> None:
    logging.basicConfig(level=getattr(logging, level.upper(), logging.INFO), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)


def _apply_env() -> None:
    # Playwright: use the preinstalled browsers when present (cloud dev containers, docker image)
    if "PLAYWRIGHT_BROWSERS_PATH" not in os.environ and Path("/opt/pw-browsers").exists():
        os.environ["PLAYWRIGHT_BROWSERS_PATH"] = "/opt/pw-browsers"


@cli.callback()
def _main_callback() -> None:
    _apply_env()


@cli.command()
def version() -> None:
    """Print the version."""
    rprint(f"saqr {__version__}")


@cli.command()
def serve(host: str = typer.Option(None), port: int = typer.Option(None), source: str = typer.Option(None, help="replay | ctlogs | certstream | hybrid | none"),
          demo: bool = typer.Option(True, help="Auto-start the scripted scenario (replay/hybrid)"), speed: float = typer.Option(None, help="Scenario speed multiplier"),
          log_level: str = typer.Option("info")) -> None:
    """Run the SAQR node: pipeline, API and dashboard."""
    import uvicorn

    _logging(log_level)
    overrides = {k: v for k, v in {"host": host, "port": port, "ct_source": source, "demo_autostart": demo, "demo_speed": speed}.items() if v is not None}
    settings = Settings(**overrides)
    from .api.app import create_app
    app = create_app(settings)
    rprint(f"[bold green]SAQR[/] v{__version__} · source={settings.ct_source} · encoder={settings.visual_encoder} · dashboard http://localhost:{settings.port}/")
    uvicorn.run(app, host=settings.host, port=settings.port, log_level=log_level.lower(), ws_ping_interval=20, ws_ping_timeout=20)


@cli.command()
def demo(port: int = typer.Option(8000), speed: float = typer.Option(1.0), live: bool = typer.Option(False, help="Use the real CT logs with the demo domains injected (hybrid)")) -> None:
    """Run the full demonstration (replayed certificate feed + scripted scam wave)."""
    serve(host="0.0.0.0", port=port, source="hybrid" if live else "replay", demo=True, speed=speed, log_level="info")


@cli.command()
def watch(source: str = typer.Option("ctlogs", help="ctlogs | certstream"), seconds: int = typer.Option(60), show_all: bool = typer.Option(False, "--all", help="Print every certificate, not only matches")) -> None:
    """Tail the live certificate feed and print look-alike matches (no server, no browser)."""
    _logging("warning")
    from .sensing.matcher import LookalikeMatcher

    settings = get_settings()
    matcher = LookalikeMatcher(threshold=settings.match_threshold)
    if source == "certstream":
        from .sensing.ct.certstream import CertstreamSource
        src = CertstreamSource(settings.certstream_url)
    else:
        from .sensing.ct.rfc6962 import MultiLogSource
        src = MultiLogSource(settings.ct_log_urls, batch_size=settings.ct_batch_size, poll_interval=settings.ct_poll_interval)

    async def run() -> None:
        t0, n, hits = time.time(), 0, 0
        async for e in src.stream():
            n += 1
            m = matcher.best_match(e.domains)
            if m and m.is_candidate:
                hits += 1
                console.print(f"[bold red]CANDIDATE[/] {m.score:3d} {m.domain:45s} {m.protected_entity or '':35s} {m.summary[:90]}")
            elif m and m.allowlisted:
                console.print(f"[bold green]OFFICIAL [/]     {m.domain:45s} {m.protected_entity or ''}")
            elif show_all:
                console.print(f"[dim]{e.log[:28]:28s} {e.domains[0][:60]}[/]")
            if time.time() - t0 > seconds:
                break
        dt = time.time() - t0
        console.print(f"\n{n} certificates in {dt:.0f}s ({n / dt:.0f}/s) · {hits} candidates · stats: {json.dumps(src.stats(), default=str)[:400]}")

    asyncio.run(run())


@cli.command()
def match(domains: list[str]) -> None:
    """Score domain names with the look-alike matcher."""
    from .sensing.matcher import LookalikeMatcher

    m = LookalikeMatcher()
    t = Table("domain", "unicode", "score", "verdict", "entity", "reasons")
    for d in domains:
        r = m.match(d)
        verdict = "[green]allow-listed[/]" if r.allowlisted else ("[red]candidate[/]" if r.is_candidate else "[dim]discard[/]")
        t.add_row(d, r.unicode_domain, str(r.score), verdict, r.protected_entity or "", r.summary[:100])
    console.print(t)


@cli.command()
def verify(url: str, domain: str = typer.Option(None), fixture: Path = typer.Option(None, help="Serve the domain from this local fixture directory"),
           out: Path = typer.Option(None, help="Write the verdict JSON here")) -> None:
    """Open a URL in the isolated browser and print the verdict (needs a built gallery)."""
    _logging("warning")
    from .models import VisualMatch
    from .sensing.matcher import LookalikeMatcher
    from .sensing.reports import domain_of
    from .verification.browser import BrowserCapturer
    from .verification.gallery import Gallery
    from .verification.logos import find_logos
    from .verification.scoring import decide
    from .verification.visual import build_encoder, load_image

    settings = get_settings()
    settings.ensure_dirs()
    if not url.startswith("http"):
        url = "https://" + url
    dom = (domain or domain_of(url)).lower()
    encoder = build_encoder(settings.visual_encoder, settings.dino_model, settings.dino_fallback_model)
    gallery = Gallery(settings.gallery_dir, encoder)
    gallery.load()

    async def run() -> None:
        cap_ = BrowserCapturer(settings.browser_timeout_ms, settings.browser_proxy, settings.capture_mobile)
        try:
            cap = await cap_.capture(url, settings.captures_dir / "cli" / dom, domain=dom, override_base=str(fixture) if fixture else None)
        finally:
            await cap_.close()
        visual, logos = [], []
        if cap.ok and cap.screenshot_desktop:
            img = load_image(cap.screenshot_desktop)
            visual = [VisualMatch(reference_id=r.id, reference_name=r.name, reference_domain=r.domain, similarity=s, ssim=ss, encoder=encoder.name)
                      for r, s, ss in gallery.index.search(img, k=3)]
            logos = find_logos(cap.screenshot_desktop, gallery.logos) if gallery.logos else []
        m = LookalikeMatcher().match(dom)
        v = decide(capture=cap, match=m, cert=None, visual=visual, logos=logos, encoder=encoder.name, domain=dom)
        console.rule(f"{dom} → [bold]{v.label.value}[/] risk {v.risk}/100 (confidence {v.confidence})")
        for e in v.explanations:
            console.print(" •", e)
        console.print("components:", v.components)
        if visual:
            console.print("nearest:", [(x.reference_domain, round(x.similarity, 3), round(x.ssim or 0, 3)) for x in visual])
        console.print("screenshot:", cap.screenshot_desktop)
        if out:
            out.write_text(v.model_dump_json(indent=2))

    asyncio.run(run())


@gallery_cli.command("build")
def gallery_build(fixtures: bool = typer.Option(True, help="Build from demo/sites/official fixtures"),
                  live: list[str] = typer.Option(None, help="domain=url pairs to screenshot real official pages")) -> None:
    """Screenshot the reference pages and index them."""
    _logging("warning")
    from .verification.browser import BrowserCapturer
    from .verification.gallery import Gallery
    from .verification.visual import build_encoder

    settings = get_settings()
    settings.ensure_dirs()
    encoder = build_encoder(settings.visual_encoder, settings.dino_model, settings.dino_fallback_model)
    g = Gallery(settings.gallery_dir, encoder)

    async def run() -> None:
        cap = BrowserCapturer(settings.browser_timeout_ms, settings.browser_proxy, capture_mobile=False)
        try:
            n = 0
            if fixtures and settings.demo_sites_dir.exists():
                n += await g.build_from_fixtures(settings.demo_sites_dir, f"file://{settings.demo_sites_dir}", cap)
            if live:
                n += await g.build_from_live(dict(x.split("=", 1) for x in live), cap)
        finally:
            await cap.close()
        g.load()
        rprint(f"built {n} references; gallery now holds {len(g.refs)} pages and {len(g.logos)} logo templates")

    asyncio.run(run())


@gallery_cli.command("list")
def gallery_list() -> None:
    from .verification.gallery import Gallery
    from .verification.visual import PerceptualEncoder

    settings = get_settings()
    g = Gallery(settings.gallery_dir, PerceptualEncoder())
    g.load()
    t = Table("id", "name", "domain", "entity", "logo")
    for r in g.refs.values():
        t.add_row(r.id, r.name, r.domain, r.entity, "yes" if r.logo else "no")
    console.print(t)


@evidence_cli.command("verify")
def evidence_verify(directory: Path) -> None:
    """Recompute hashes, the Merkle root and the timestamp signature of a package directory."""
    from .evidence.package import verify_package

    r = verify_package(directory)
    for a in r["artifacts"]:
        console.print(("[green]ok [/]" if a["ok"] else "[red]BAD[/]"), a["name"])
    console.print("merkle root:", "[green]ok[/]" if r["merkle_root_ok"] else "[red]MISMATCH[/]", "· timestamp:", r["timestamp_ok"])
    raise typer.Exit(code=0 if r["artifacts_ok"] and r["merkle_root_ok"] else 1)


@audit_cli.command("verify")
def audit_verify() -> None:
    """Walk the hash chain of the audit log."""
    from .db import Store
    from .response.audit import AuditLog

    settings = get_settings()
    log_ = AuditLog(Store(settings.db_path))
    r = log_.verify()
    console.print(r)
    raise typer.Exit(code=0 if r["valid"] else 1)


@cli.command()
def report(text: str, channel: str = typer.Option("sms"), sender: str = typer.Option(""), server: str = typer.Option("http://localhost:8000")) -> None:
    """Forward a suspicious message to a running SAQR node (simulates the citizen reporting number)."""
    import httpx

    r = httpx.post(f"{server}/api/reports", json={"channel": channel, "text": text, "sender": sender}, timeout=20)
    r.raise_for_status()
    data = r.json()
    rprint(f"report {data['report']['id']} · urls {data['report']['urls']} · candidates {[c['domain'] for c in data['candidates']]} · campaign {data['campaign']['name'] if data.get('campaign') else '-'}")


def main() -> None:
    try:
        cli()
    except KeyboardInterrupt:
        sys.exit(130)


if __name__ == "__main__":
    main()
