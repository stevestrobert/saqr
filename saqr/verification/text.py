"""Page-text signals: which government entity the page claims to be, payment vocabulary, urgency cues."""
from __future__ import annotations

import re

from ..models import TextSignals
from ..sensing.protected import Registry, get_lexicon, get_registry


def _find_terms(text_l: str, terms: list[str]) -> list[str]:
    found = []
    for t in terms:
        if t.lower() in text_l:
            found.append(t)
    return found


def analyse_text(text: str, title: str = "", registry: Registry | None = None) -> TextSignals:
    reg = registry or get_registry()
    lex = get_lexicon()
    full = f"{title}\n{text}"
    tl = full.lower()
    sig = TextSignals()

    # Brand mentions (entity names EN/AR + brand tokens as words)
    mentions: list[str] = []
    for e in reg.entities:
        name_l = e.name.lower().split(" (")[0]
        if name_l in tl or (e.name_ar and e.name_ar in full):
            mentions.append(e.name)
            continue
        for b in e.brands:
            if len(b) >= 4 and re.search(rf"(?<![a-z]){re.escape(b)}(?![a-z])", tl):
                mentions.append(e.name)
                break
    sig.brand_mentions = list(dict.fromkeys(mentions))

    pay = _find_terms(tl, lex["payment_terms"]["en"]) + _find_terms(full, lex["payment_terms"]["ar"])
    urg = _find_terms(tl, lex["urgency_terms"]["en"]) + _find_terms(full, lex["urgency_terms"]["ar"])
    gov = _find_terms(tl, lex["gov_claims"]["en"]) + _find_terms(full, lex["gov_claims"]["ar"])
    sig.payment_terms = list(dict.fromkeys(pay))
    sig.urgency_terms = list(dict.fromkeys(urg))
    sig.gov_claims = list(dict.fromkeys(gov))

    letters = re.findall(r"[A-Za-z؀-ۿ]", full)
    arabic = sum(1 for c in letters if "؀" <= c <= "ۿ")
    sig.arabic_ratio = round(arabic / len(letters), 3) if letters else 0.0

    score = 0.0
    if sig.brand_mentions:
        score += 0.45
    elif sig.gov_claims:
        score += 0.25
    score += min(0.3, 0.06 * len(sig.payment_terms))
    score += min(0.25, 0.1 * len(sig.urgency_terms))
    sig.score = round(min(1.0, score), 3)
    return sig


def text_summary(sig: TextSignals) -> str:
    bits = []
    if sig.brand_mentions:
        bits.append("claims to be " + ", ".join(sig.brand_mentions[:2]))
    if sig.payment_terms:
        bits.append(f"{len(sig.payment_terms)} payment terms ({', '.join(sig.payment_terms[:3])})")
    if sig.urgency_terms:
        bits.append(f"urgency cues ({', '.join(sig.urgency_terms[:2])})")
    return "; ".join(bits) if bits else "no government or payment vocabulary"
