"""Human-readable evidence report (HTML) rendered into every package."""
from __future__ import annotations

import base64
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

from ..config import TEMPLATES_DIR
from ..models import Case, EvidencePackage

_env = Environment(loader=FileSystemLoader(str(TEMPLATES_DIR)), autoescape=select_autoescape(["html"]))


def _b64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode() if path.exists() else ""


def render_report(case: Case, pkg: EvidencePackage) -> str:
    d = Path(pkg.directory)
    tpl = _env.get_template("evidence_report.html")
    return tpl.render(
        case=case, pkg=pkg, verdict=case.verdict,
        screenshot_b64=_b64(d / "screenshot_desktop.png"), mobile_b64=_b64(d / "screenshot_mobile.png"),
        reasons=case.verdict.explanations, custody=pkg.custody, artifacts=pkg.artifacts,
    )
