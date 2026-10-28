"""Domain-name normalisation: punycode decoding, confusable (homoglyph) skeletons, tokenisation."""
from __future__ import annotations

import json
import re
import unicodedata
from functools import lru_cache

import idna
import tldextract

from ..config import DATA_DIR

_extract = tldextract.TLDExtract(suffix_list_urls=(), fallback_to_snapshot=True)


@lru_cache
def _confusables() -> tuple[dict[str, str], dict[str, str]]:
    raw = json.loads((DATA_DIR / "confusables.json").read_text(encoding="utf-8"))
    return raw["single"], raw["multi"]


def to_unicode(domain: str) -> str:
    """Decode IDNA (xn--) labels to their Unicode form; leave plain ASCII untouched."""
    labels = []
    for label in domain.lower().strip(".").split("."):
        if label.startswith("xn--"):
            try:
                labels.append(idna.decode(label))
                continue
            except Exception:
                try:
                    labels.append(label.encode("ascii").decode("idna"))
                    continue
                except Exception:
                    pass
        labels.append(label)
    return ".".join(labels)


def skeleton(text: str) -> str:
    """Map look-alike characters to the ASCII letters they imitate (Unicode TR39-style skeleton).

    'rtа.ae' (Cyrillic а) -> 'rta.ae';  'sаlik' -> 'salik';  'g00gle' -> 'google'.
    """
    single, _ = _confusables()
    out = []
    for ch in unicodedata.normalize("NFKD", text.lower()):
        if unicodedata.combining(ch):
            continue
        out.append(single.get(ch, ch))
    return "".join(out)


def has_non_ascii(text: str) -> bool:
    return any(ord(c) > 127 for c in text)


def ascii_glyph_variants(token: str) -> set[str]:
    """Variants of a token after undoing multi-character tricks (rn->m, vv->w, cl->d)."""
    _, multi = _confusables()
    variants = {token}
    for seq, repl in multi.items():
        if seq in token:
            variants.add(token.replace(seq, repl))
    return variants


class Parts:
    __slots__ = ("subdomain", "label", "suffix", "registrable")

    def __init__(self, subdomain: str, label: str, suffix: str) -> None:
        self.subdomain = subdomain
        self.label = label
        self.suffix = suffix
        self.registrable = f"{label}.{suffix}" if suffix else label


def split_domain(domain: str) -> Parts:
    d = domain.lower().strip(".")
    if d.startswith("*."):
        d = d[2:]
    ext = _extract(d)
    if not ext.suffix:  # unknown TLD: fall back to a naive split
        bits = d.split(".")
        return Parts(".".join(bits[:-2]), bits[-2] if len(bits) > 1 else bits[0], bits[-1] if len(bits) > 1 else "")
    return Parts(ext.subdomain, ext.domain, ext.suffix)


_SPLIT_RE = re.compile(r"[-_.]+|(?<=\D)(?=\d)|(?<=\d)(?=\D)")


def coarse_tokens(name: str) -> list[str]:
    """Split a name on hyphens, dots, underscores and letter/digit boundaries."""
    return [t for t in _SPLIT_RE.split(name) if t]


def segment(chunk: str, vocabulary: set[str], max_unknown_ratio: float = 0.34, min_piece: int = 2) -> list[str] | None:
    """Split a concatenated chunk ('rtafinesrefund') into vocabulary words ('rta','fines','refund').

    Dynamic programme minimising unknown characters then token count. Returns None when the best
    segmentation leaves too many unknown characters (the chunk is probably an unrelated word).
    Short vocabulary pieces (< 4 letters, e.g. 'itc', 'rta') are only trusted when the whole chunk is
    covered — otherwise 'kitchenrefund' would yield 'itc' + 'refund'.
    """
    seg = _segment(chunk, vocabulary, max_unknown_ratio, min_piece)
    if seg and any(len(p) < 4 for p in seg) and sum(len(p) for p in seg) < len(chunk):
        seg = _segment(chunk, vocabulary, max_unknown_ratio, max(min_piece, 4))
    return seg


def _segment(chunk: str, vocabulary: set[str], max_unknown_ratio: float, min_piece: int) -> list[str] | None:
    n = len(chunk)
    if n == 0:
        return []
    if chunk in vocabulary:
        return [chunk]
    INF = float("inf")
    # best[i] = (unknown_chars, tokens, segmentation) for chunk[:i]
    best: list[tuple[float, int, list[str]]] = [(INF, 0, [])] * (n + 1)
    best[0] = (0, 0, [])
    for i in range(1, n + 1):
        cands: list[tuple[float, int, list[str]]] = []
        for j in range(max(0, i - 24), i):
            if best[j][0] == INF:
                continue
            piece = chunk[j:i]
            if piece in vocabulary and len(piece) >= min_piece:
                cands.append((best[j][0], best[j][1] + 1, best[j][2] + [piece]))
        # treat the single char chunk[i-1] as unknown
        if best[i - 1][0] != INF:
            prev = best[i - 1]
            seg = prev[2][:]
            if seg and seg[-1].startswith("?"):
                seg[-1] = seg[-1] + chunk[i - 1]
            else:
                seg.append("?" + chunk[i - 1])
            cands.append((prev[0] + 1, prev[1], seg))
        best[i] = min(cands, key=lambda c: (c[0], c[1]))
    unknown, _, seg = best[n]
    if unknown / n > max_unknown_ratio:
        return None
    return [s for s in seg if not s.startswith("?")]
