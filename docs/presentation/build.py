"""Render the HTML slide deck to PDF (and per-slide PNG previews) with headless Chromium.

    python docs/presentation/build.py            -> docs/SAQR-pitch.pdf + docs/presentation/preview/slide-NN.png
Requires Playwright (installed with SAQR). Slides are 1920x1080; one slide per PDF page.
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
HTML = HERE / "index.html"
PDF = HERE.parent / "SAQR-pitch.pdf"
PREVIEW = HERE / "preview"


async def main(previews: bool = True) -> None:
    if "PLAYWRIGHT_BROWSERS_PATH" not in os.environ and Path("/opt/pw-browsers").exists():
        os.environ["PLAYWRIGHT_BROWSERS_PATH"] = "/opt/pw-browsers"
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--no-sandbox"])
        page = await browser.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=1)
        await page.goto(HTML.as_uri(), wait_until="networkidle")
        await page.wait_for_timeout(500)
        await page.emulate_media(media="print")
        await page.pdf(path=str(PDF), width="1920px", height="1080px", print_background=True, prefer_css_page_size=True, margin={"top": "0", "right": "0", "bottom": "0", "left": "0"})
        n = await page.locator("section.slide").count()
        print(f"wrote {PDF} ({n} slides, {PDF.stat().st_size // 1024} KB)")
        if previews:
            PREVIEW.mkdir(exist_ok=True)
            for old in PREVIEW.glob("slide-*.png"):
                old.unlink()
            await page.emulate_media(media="screen")
            for i in range(n):
                el = page.locator("section.slide").nth(i)
                await el.scroll_into_view_if_needed()
                await el.screenshot(path=str(PREVIEW / f"slide-{i + 1:02d}.png"))
            print(f"previews in {PREVIEW}")
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main(previews="--no-previews" not in sys.argv))
