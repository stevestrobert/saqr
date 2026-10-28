"""Render per-slide PNG previews of the web deck (and optionally a PDF export) with headless Chromium.

    python docs/presentation/build.py            -> docs/presentation/preview/slide-NN.png (ignored by git)
    python docs/presentation/build.py --pdf      -> also docs/presentation/SAQR-pitch.pdf (one slide per page)
    python docs/presentation/build.py --full     -> the 13-slide version (preview/full/, SAQR-pitch-full.pdf) instead of the 3-minute cut

The deck itself is docs/presentation/index.html — open it in a browser; no build step is needed to present.
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
HTML = HERE / "index.html"
PREVIEW = HERE / "preview"
PDF = HERE / "SAQR-pitch.pdf"


async def main(pdf: bool, full: bool = False) -> None:
    preview = PREVIEW / "full" if full else PREVIEW
    pdf_path = HERE / "SAQR-pitch-full.pdf" if full else PDF
    url = HTML.as_uri() + ("?full=1" if full else "")
    if "PLAYWRIGHT_BROWSERS_PATH" not in os.environ and Path("/opt/pw-browsers").exists():
        os.environ["PLAYWRIGHT_BROWSERS_PATH"] = "/opt/pw-browsers"
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--no-sandbox"])
        page = await browser.new_page(viewport={"width": 1920, "height": 1080})
        await page.goto(url + "#slide-1", wait_until="networkidle")
        n = await page.locator("section.slide:not(.off)").count()
        preview.mkdir(parents=True, exist_ok=True)
        for old in preview.glob("slide-*.png"):
            old.unlink()
        for i in range(n):
            await page.goto(url + f"#slide-{i + 1}")
            await page.wait_for_timeout(2600)  # let entrance animations and counters finish
            await page.screenshot(path=str(preview / f"slide-{i + 1:02d}.png"))
        print(f"{n} slide previews in {preview}")
        if pdf:
            await page.goto(url + "#slide-1", wait_until="networkidle")
            await page.evaluate("document.body.classList.add('print')")
            await page.wait_for_timeout(500)
            await page.pdf(path=str(pdf_path), width="1920px", height="1080px", print_background=True, prefer_css_page_size=True,
                           margin={"top": "0", "right": "0", "bottom": "0", "left": "0"})
            print(f"PDF export: {pdf_path} ({pdf_path.stat().st_size // 1024} KB)")
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main(pdf="--pdf" in sys.argv, full="--full" in sys.argv))
