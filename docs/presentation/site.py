"""Assemble the public static site (landing page, web deck, PDF, presenter notes) into var/site/.

    python docs/presentation/site.py            -> var/site/   (deployed to Cloudflare Pages by .github/workflows/pages.yml)

The dashboard itself is not part of the site: it needs the SAQR node (`make demo`). Slide 11 of the deck therefore
shows a screenshot when served from Pages and embeds the live dashboard only when the deck is served by the node.
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
OUT = REPO / "var" / "site"

LANDING = """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SAQR · صقر</title>
<style>body{margin:0;background:#0b1220;color:#e8eef8;font-family:Inter,system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
main{max-width:720px}h1{font-size:64px;margin:0;letter-spacing:-.02em}h1 span{color:#f2b544}p{font-size:20px;color:#b6c2d6;line-height:1.45}
a.btn{display:inline-block;margin:10px 12px 0 0;padding:14px 22px;border-radius:12px;border:1px solid rgba(255,255,255,.12);color:#e8eef8;text-decoration:none;font-weight:600;background:#121c2e}
a.btn.gold{background:#f2b544;color:#1a1200;border-color:#f2b544}small{display:block;margin-top:28px;color:#8593ab}code{font-family:ui-monospace,monospace}</style></head><body><main>
<h1>SAQR <span>صقر</span></h1>
<p>Early warning and one-click takedown for impersonated government financial services. hackathon.ae 2026 · Digital Trust &amp; Cyber-Secure Nation · NYU Abu Dhabi student team.</p>
<a class="btn gold" href="/presentation/">Slide deck · 3 min</a>
<a class="btn" href="/presentation/?full=1">Full deck · 13 slides</a>
<a class="btn" href="/presentation/SAQR-pitch.pdf">PDF · 3 min</a>
<a class="btn" href="/presentation/SAQR-pitch-full.pdf">PDF · full</a>
<a class="btn" href="/presentation/script-3min.md">Script · 3 min</a>
<a class="btn" href="/presentation/presenter-notes.md">Presenter notes</a>
<a class="btn" href="https://github.com/stevestrobert/saqr">Source code</a>
<small>Deck keys: → next · ← back · N presenter notes · F fullscreen. The live dashboard runs locally with <code>make demo</code>.</small>
</main></body></html>
"""


def main() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    deck = OUT / "presentation"
    deck.mkdir(parents=True)
    for name in ("index.html", "presenter-notes.md", "script-3min.md"):
        shutil.copy(HERE / name, deck / name)
    for folder in ("fonts", "img"):
        shutil.copytree(HERE / folder, deck / folder)
    for name in ("SAQR-pitch.pdf", "SAQR-pitch-full.pdf"):
        pdf = HERE / name
        if pdf.exists():
            shutil.copy(pdf, deck / pdf.name)
        else:
            print(f"note: {name} missing (run build.py --pdf [--full] first); its link will 404", file=sys.stderr)
    images = OUT / "images"
    images.mkdir()
    for name in ("evidence-report.png", "live-wall.png", "case.png", "approve-modal.png"):
        shutil.copy(REPO / "docs" / "images" / name, images / name)
    (OUT / "index.html").write_text(LANDING)
    (OUT / "_redirects").write_text("/deck  /presentation/  302\n")
    (OUT / "_headers").write_text("/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n")
    n = sum(1 for p in OUT.rglob("*") if p.is_file())
    print(f"{n} files in {OUT}")


if __name__ == "__main__":
    main()
