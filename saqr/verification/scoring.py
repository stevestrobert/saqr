"""Fuse the verification signals into a verdict with a risk score and plain-language explanations.

Components (each 0..1):
  visual  nearest reference page similarity (embedding cosine, confirmed by SSIM)
  logo    an official emblem is reused on the page
  text    claims to be a government entity + payment vocabulary + urgency cues
  form    what the page asks for (card number / CVV / OTP / Emirates ID / password)
  domain  look-alike score of the name, certificate age, free CA, abuse-prone TLD, IDN homograph

The MVP uses fixed, documented weights plus decision rules; the Fuser interface is the place where a model
calibrated on historical impersonation cases plugs in (same inputs, same output).
"""
from __future__ import annotations

from datetime import datetime, timezone

from ..models import Capture, CertEntry, DomainSignals, FormSignals, LogoMatch, MatchResult, TextSignals, Verdict, VerdictLabel, VisualMatch
from ..sensing.protected import Registry, get_registry
from .forms import analyse_forms
from .text import analyse_text, text_summary

WEIGHTS = {"visual": 0.30, "logo": 0.10, "text": 0.15, "form": 0.25, "domain": 0.20}
CONFIRMED_AT, SUSPICIOUS_AT = 72, 40


def visual_component(similarity: float | None, ssim: float | None) -> float:
    """Map cosine similarity (and SSIM agreement) to 0..1. Clones score > 0.9; unrelated pages < 0.75."""
    if similarity is None:
        return 0.0
    s = similarity
    if ssim is not None:
        s = 0.7 * s + 0.3 * max(0.0, ssim)
    if s >= 0.92:
        return 1.0
    if s <= 0.72:
        return 0.0
    return round((s - 0.72) / 0.20, 3)


def domain_signals(match: MatchResult | None, cert: CertEntry | None, registry: Registry, now: datetime | None = None) -> DomainSignals:
    now = now or datetime.now(timezone.utc)
    sig = DomainSignals()
    if match:
        sig.lookalike_score = match.score
        sig.reasons = [r.detail for r in match.reasons[:6]]
        sig.idn_homoglyph = any(r.kind == "homoglyph" for r in match.reasons)
        tld = match.domain.rsplit(".", 1)[-1] if "." in match.domain else ""
        sig.risky_tld = tld in registry.risky_tlds
    if cert:
        anchor = cert.issued_at or cert.not_before
        if anchor:
            sig.cert_age_hours = round(max(0.0, (now - anchor).total_seconds() / 3600), 2)
        sig.free_ca = registry.is_free_ca(cert.issuer)
    score = sig.lookalike_score / 100 * 0.75
    if sig.idn_homoglyph:
        score += 0.15
    if sig.cert_age_hours is not None and sig.cert_age_hours < 48:
        score += 0.15
    if sig.free_ca:
        score += 0.05
    if sig.risky_tld:
        score += 0.05
    sig.score = round(min(1.0, score), 3)
    return sig


def decide(*, capture: Capture, match: MatchResult | None, cert: CertEntry | None, visual: list[VisualMatch],
           logos: list[LogoMatch], encoder: str, registry: Registry | None = None, domain: str = "") -> Verdict:
    reg = registry or get_registry()
    page_host = (capture.final_url or capture.requested_url).split("//")[-1].split("/")[0].lower()

    # Safety net (the sensing layer never creates candidates for official properties, but the verdict must
    # be impossible to get wrong): an allow-listed name is official, whatever the page looks like.
    for name in (domain, page_host):
        if name and reg.is_allowlisted(name):
            return Verdict(label=VerdictLabel.official, risk=0, confidence=1.0,
                           components={"visual": 0, "logo": 0, "text": 0, "form": 0, "domain": 0},
                           explanations=[f"{name} is an official government property on the protected registry; it can never be flagged or blocked."],
                           recommended_action="None", encoder=encoder)

    # Unreachable / parked / empty pages: nothing to judge yet — schedule a re-check.
    if not capture.ok or capture.text_length < 40 or _looks_parked(capture):
        why = capture.error or ("parked / placeholder page" if _looks_parked(capture) else "page has no meaningful content yet")
        dom = domain_signals(match, cert, reg)
        return Verdict(label=VerdictLabel.inactive, risk=min(35, int(dom.score * 40)), confidence=0.6,
                       components={"visual": 0, "logo": 0, "text": 0, "form": 0, "domain": dom.score},
                       explanations=[f"Not active: {why}.", "Scammers often register a name and activate the page later; the domain stays under watch and is re-verified automatically."],
                       recommended_action="Monitor and re-check", domain=dom, encoder=encoder)

    text_sig: TextSignals = analyse_text(capture.text, capture.title, reg)
    form_sig: FormSignals = analyse_forms(capture.forms, page_host)
    dom = domain_signals(match, cert, reg)
    top = visual[0] if visual else None
    vis = visual_component(top.similarity if top else None, top.ssim if top else None)
    logo = 1.0 if logos else 0.0

    comps = {"visual": round(vis, 3), "logo": logo, "text": text_sig.score, "form": form_sig.risk, "domain": dom.score}
    risk = sum(WEIGHTS[k] * v for k, v in comps.items()) * 100

    explanations: list[str] = []
    # --- decision rules (make the obvious cases decisive and explainable) -------------------------
    imitates_layout = vis >= 0.6
    card_capture = form_sig.collects_card or form_sig.collects_otp or form_sig.collects_credentials
    if imitates_layout and top:
        explanations.append(f"Page layout matches the official {top.reference_name} page ({top.similarity:.0%} visual similarity"
                            + (f", SSIM {top.ssim:.2f}" if top.ssim is not None else "") + ").")
    if logos:
        explanations.append(f"Official emblem of {logos[0].reference_domain} reused on the page (match {logos[0].score:.0%}).")
    if card_capture:
        explanations.append("Form " + form_sig.summary + ". Official portals hand off to a licensed payment gateway; they never collect card data on an inquiry page.")
    elif form_sig.summary:
        explanations.append("Form: " + form_sig.summary + ".")
    if text_sig.brand_mentions:
        explanations.append(f"Text claims to be {', '.join(text_sig.brand_mentions[:2])}" +
                            (f" and uses urgency cues ({', '.join(text_sig.urgency_terms[:2])})" if text_sig.urgency_terms else "") + ".")
    if dom.reasons:
        explanations.append("Name: " + "; ".join(dom.reasons[:3]) + ".")
    if dom.cert_age_hours is not None:
        explanations.append(f"Certificate issued {dom.cert_age_hours:.1f} h ago" + (" by a free automated CA" if dom.free_ca else "") + ".")

    if imitates_layout and card_capture:
        risk = max(risk, 90)
    elif (imitates_layout or logo) and (text_sig.brand_mentions or form_sig.collects_identity):
        risk = max(risk, 78)
    elif card_capture and text_sig.brand_mentions and dom.lookalike_score >= 35:
        risk = max(risk, 76)
    elif not imitates_layout and not card_capture and not text_sig.brand_mentions:
        # looks like an unrelated business that happens to share a word: cap the risk
        risk = min(risk, 30)
        explanations.append("No government layout, emblem, entity claim or card collection: consistent with an unrelated legitimate site.")

    risk_i = int(round(min(100, max(0, risk))))
    if risk_i >= CONFIRMED_AT:
        label, action = VerdictLabel.confirmed_fake, "Approve takedown and blocking"
    elif risk_i >= SUSPICIOUS_AT:
        label, action = VerdictLabel.suspicious, "Analyst review"
    else:
        label, action = VerdictLabel.benign, "No action; keep under passive watch"

    # confidence: agreement between independent signal families
    strong = sum(1 for v in (vis, logo, form_sig.risk, text_sig.score) if v >= 0.6)
    weak = sum(1 for v in (vis, logo, form_sig.risk, text_sig.score) if v <= 0.15)
    confidence = round(min(0.98, 0.55 + 0.12 * max(strong, weak)), 2)

    return Verdict(label=label, risk=risk_i, confidence=confidence, components=comps, explanations=explanations,
                   recommended_action=action, visual=visual, logos=logos, text=text_sig, form=form_sig, domain=dom, encoder=encoder)


PARKED_MARKERS = ["domain is parked", "this domain was recently registered", "website coming soon", "coming soon",
                  "buy this domain", "domain for sale", "parked free", "sedo", "godaddy.com/domainsearch", "under construction",
                  "this site can’t be reached", "default web site page", "apache2 ubuntu default", "welcome to nginx",
                  "future home of", "hugedomains", "dan.com", "afternic", "is for sale", "domain name is registered"]


def _looks_parked(capture: Capture) -> bool:
    t = (capture.title + " " + capture.text[:1500]).lower()
    return capture.text_length < 700 and any(m in t for m in PARKED_MARKERS)


def verdict_summary(v: Verdict) -> str:
    return f"{v.label.value} · risk {v.risk}/100 · " + (text_summary(v.text) if v.text else "")
