"""Logo reuse detection: multi-scale template matching of reference emblems inside the suspect screenshot."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from ..models import LogoMatch


@dataclass
class LogoTemplate:
    reference_id: str
    domain: str
    gray: np.ndarray  # grayscale template


def load_template(reference_id: str, domain: str, path: Path) -> LogoTemplate | None:
    img = Image.open(path).convert("L")
    arr = np.asarray(img, dtype=np.uint8)
    if arr.size == 0 or min(arr.shape) < 8:
        return None
    return LogoTemplate(reference_id=reference_id, domain=domain, gray=arr)


def _prep(gray: np.ndarray) -> np.ndarray:
    # Normalise illumination and emphasise edges a little: robust to background colour changes.
    g = cv2.GaussianBlur(gray, (3, 3), 0)
    return cv2.Canny(g, 60, 160)


def find_logos(screenshot_path: str | Path, templates: list[LogoTemplate], *, threshold: float = 0.82,
               scales: tuple[float, ...] = (0.6, 0.75, 0.9, 1.0, 1.1, 1.25, 1.5), search_fraction: float = 0.55) -> list[LogoMatch]:
    """Return matches above `threshold` (best first), searching the upper part of the page.

    Emblems of different entities often share size and placement, so a wrong emblem can still correlate at
    ~0.7; a genuine copy scores > 0.9. Only one emblem is normally on a page: when several pass, keep the
    best and any other within 0.05 of it.
    """
    img = Image.open(screenshot_path).convert("L")
    page = np.asarray(img, dtype=np.uint8)
    h = max(1, int(page.shape[0] * search_fraction))
    region = page[: max(h, 300)]
    region_e = _prep(region)
    region_g = region
    matches: list[LogoMatch] = []
    for t in templates:
        best: LogoMatch | None = None
        for s in scales:
            tw, th = int(t.gray.shape[1] * s), int(t.gray.shape[0] * s)
            if tw < 10 or th < 10 or tw >= region.shape[1] or th >= region.shape[0]:
                continue
            tmpl = cv2.resize(t.gray, (tw, th), interpolation=cv2.INTER_AREA)
            # combine grayscale and edge correlation: both must agree for a confident hit
            r1 = cv2.matchTemplate(region_g, tmpl, cv2.TM_CCOEFF_NORMED)
            r2 = cv2.matchTemplate(region_e, _prep(tmpl), cv2.TM_CCOEFF_NORMED)
            score_map = 0.6 * r1 + 0.4 * r2
            _, val, _, loc = cv2.minMaxLoc(score_map)
            if best is None or val > best.score:
                best = LogoMatch(reference_id=t.reference_id, reference_domain=t.domain, score=float(val),
                                 bbox=[int(loc[0]), int(loc[1]), tw, th], scale=s)
        if best and best.score >= threshold:
            matches.append(best)
    matches.sort(key=lambda m: -m.score)
    if matches:
        top = matches[0].score
        matches = [m for m in matches if m.score >= top - 0.05]
    return matches
