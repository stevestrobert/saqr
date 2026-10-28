"""Reference gallery of real government pages.

Layout on disk (settings.gallery_dir):
    <ref_id>/screenshot.png   desktop capture of the official page
    <ref_id>/logo.png         crop of the entity emblem (optional; used for logo-reuse detection)
    <ref_id>/meta.json        {id, name, domain, entity, source_url, captured_at}

`build_from_fixtures` screenshots the demo "official" fixture sites; `build_from_live` screenshots the real
protected domains (production). Both use the same isolated browser as verification.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

from ..config import Settings
from .browser import BrowserCapturer
from .logos import LogoTemplate, load_template
from .visual import GalleryIndex, Reference, VisualEncoder

log = logging.getLogger(__name__)

LOGO_JS = """
() => { const el = document.getElementById('brand-logo'); if (!el) return null;
        const r = el.getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height}; }
"""


class Gallery:
    def __init__(self, directory: Path, encoder: VisualEncoder) -> None:
        self.directory = directory
        self.encoder = encoder
        self.index = GalleryIndex(encoder)
        self.logos: list[LogoTemplate] = []
        self.refs: dict[str, Reference] = {}

    # ---------------------------------------------------------------------------------------- loading
    def load(self) -> int:
        self.index = GalleryIndex(self.encoder)
        self.logos, self.refs = [], {}
        if not self.directory.exists():
            return 0
        for d in sorted(p for p in self.directory.iterdir() if p.is_dir()):
            meta_p, shot_p, logo_p = d / "meta.json", d / "screenshot.png", d / "logo.png"
            if not (meta_p.exists() and shot_p.exists()):
                continue
            meta = json.loads(meta_p.read_text(encoding="utf-8"))
            ref = Reference(id=d.name, name=meta.get("name", d.name), domain=meta.get("domain", ""), entity=meta.get("entity", ""),
                            screenshot=shot_p, logo=logo_p if logo_p.exists() else None, meta=meta)
            try:
                self.index.add(ref)
            except Exception as exc:
                log.warning("gallery: skipping %s (%s)", d.name, exc)
                continue
            self.refs[ref.id] = ref
            if ref.logo:
                t = load_template(ref.id, ref.domain, ref.logo)
                if t:
                    self.logos.append(t)
        log.info("gallery: %d reference pages, %d logo templates (encoder %s)", len(self.refs), len(self.logos), self.encoder.name)
        return len(self.refs)

    def get(self, ref_id: str) -> Reference | None:
        return self.refs.get(ref_id)

    # --------------------------------------------------------------------------------------- building
    async def build_from_fixtures(self, sites_dir: Path, base_url: str, capturer: BrowserCapturer) -> int:
        """Screenshot each demo/sites/official/<domain>/ page served by the fixture server."""
        official = sites_dir / "official"
        if not official.exists():
            return 0
        n = 0
        for site in sorted(p for p in official.iterdir() if p.is_dir()):
            manifest = site / "manifest.json"
            meta = json.loads(manifest.read_text(encoding="utf-8")) if manifest.exists() else {}
            domain = meta.get("domain", site.name)
            url = f"{base_url.rstrip('/')}/official/{site.name}/index.html"
            ok = await self._build_one(ref_id=domain.replace(".", "-"), name=meta.get("title") or domain,
                                       domain=domain, entity=meta.get("entity", ""), url=url, capturer=capturer,
                                       extra={"service": meta.get("service", ""), "entity_ar": meta.get("entity_ar", ""), "fixture": True})
            n += int(ok)
        return n

    async def build_from_live(self, urls: dict[str, str], capturer: BrowserCapturer) -> int:
        """urls: {domain: page_url} for the real protected properties."""
        n = 0
        for domain, url in urls.items():
            ok = await self._build_one(ref_id=domain.replace(".", "-"), name=domain, domain=domain, entity="", url=url, capturer=capturer, extra={})
            n += int(ok)
        return n

    async def _build_one(self, *, ref_id: str, name: str, domain: str, entity: str, url: str, capturer: BrowserCapturer, extra: dict) -> bool:
        out = self.directory / ref_id
        out.mkdir(parents=True, exist_ok=True)
        cap = await capturer.capture(url, out, domain=domain, tag="ref")
        if not cap.ok or not cap.screenshot_desktop:
            log.warning("gallery: could not capture %s (%s)", url, cap.error)
            return False
        Path(cap.screenshot_desktop).replace(out / "screenshot.png")
        for stray in ("ref.html", "ref.har", "ref_mobile.png"):
            p = out / stray
            if p.exists():
                p.unlink()
        # logo crop: the fixture pages expose the emblem as #brand-logo; for live pages fall back to the top-left region
        bbox = await self._logo_bbox(url, domain, capturer)
        img = Image.open(out / "screenshot.png").convert("RGB")
        if bbox and bbox["w"] >= 16 and bbox["h"] >= 16:
            x, y, w, h = (int(bbox[k]) for k in ("x", "y", "w", "h"))
            pad = 4
            crop = img.crop((max(0, x - pad), max(0, y - pad), min(img.width, x + w + pad), min(img.height, y + h + pad)))
            crop.save(out / "logo.png")
        meta = {"id": ref_id, "name": name, "domain": domain, "entity": entity, "source_url": url,
                "captured_at": datetime.now(timezone.utc).isoformat(), "title": cap.title, **extra}
        (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
        return True

    async def _logo_bbox(self, url: str, domain: str, capturer: BrowserCapturer) -> dict | None:
        try:
            await capturer.start()
            ctx = await capturer._browser.new_context(viewport={"width": 1280, "height": 800}, ignore_https_errors=True)
            page = await ctx.new_page()
            await page.goto(url, wait_until="domcontentloaded", timeout=capturer.timeout_ms)
            bbox = await page.evaluate(LOGO_JS)
            await ctx.close()
            return bbox
        except Exception:
            return None


def ensure_gallery(settings: Settings, encoder: VisualEncoder) -> Gallery:
    g = Gallery(settings.gallery_dir, encoder)
    g.load()
    return g
