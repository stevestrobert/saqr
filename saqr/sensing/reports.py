"""Reactive intake: forwarded SMS / WhatsApp messages, partner (bank, telecom, CERT) submissions, threat feeds.

Fakes hosted on shared platforms, behind wildcard certificates or under meaningless names never show up in
the certificate filter; they reach the same verification pipeline through this module. Messages are also
grouped into campaigns so analysts act on a whole wave of texts rather than one link at a time.

Privacy: the reporter's phone number is never stored. We keep a masked form for display and a salted hash
for de-duplication, and the message text is stripped of digits that look like personal identifiers.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

from ..models import Report
from .normalize import split_domain

URL_RE = re.compile(
    r"""(?ix)
    (?:(?:https?|hxxps?)://)?                       # optional scheme (hxxp = defanged)
    (?:www\.)?
    (?:[a-z0-9؀-ۿ](?:[a-z0-9؀-ۿ-]{0,61}[a-z0-9؀-ۿ])?\.)+   # labels (incl. IDN)
    (?:[a-z]{2,24}|xn--[a-z0-9-]{2,})               # tld
    (?::\d{2,5})?
    (?:/[^\s<>"'،]*)?                                # path
    """
)
DEFANG = [("[.]", "."), ("(.)", "."), ("[dot]", "."), ("hxxp", "http"), ("[:]", ":")]
SHORTENERS = {"bit.ly", "tinyurl.com", "t.co", "goo.gl", "cutt.ly", "is.gd", "rb.gy", "shorturl.at", "tiny.cc", "rebrand.ly", "s.id", "u.to"}
COMMON_FALSE_URLS = {"e.g", "i.e", "etc", "a.m", "p.m"}
# ignore trailing punctuation that sentence structure glues onto URLs
TRAIL = ".,;:!?)»\"'،۔"

EN_STOP = set(["the", "a", "an", "to", "of", "for", "your", "you", "is", "are", "be", "has", "have", "will", "on", "in", "at", "by", "and", "or", "with", "this", "that", "from", "it", "as", "we", "our", "please", "now", "within", "hours", "hour", "day", "days", "aed", "dhs", "amount", "link", "click", "here", "via", "visit"])


def _mask_phone(sender: str) -> str:
    digits = re.sub(r"\D", "", sender)
    if len(digits) < 6:
        return "unknown" if not sender else "***"
    return f"+{digits[:3]} {digits[3:4]}* *** **{digits[-2:]}"


def reporter_ref(sender: str, salt: str = "saqr-reporter-v1") -> str:
    digits = re.sub(r"\D", "", sender) or sender.strip().lower()
    return hashlib.sha256(f"{salt}:{digits}".encode()).hexdigest()[:16] if digits else ""


def defang(text: str) -> str:
    out = text
    for a, b in DEFANG:
        out = out.replace(a, b)
    return out


def extract_urls(text: str) -> list[str]:
    urls: list[str] = []
    for m in URL_RE.finditer(defang(text)):
        raw = m.group(0).rstrip(TRAIL)
        host = re.sub(r"^(?:https?://)?(?:www\.)?", "", raw, flags=re.I).split("/")[0].split(":")[0].lower()
        if host in COMMON_FALSE_URLS or "." not in host:
            continue
        p = split_domain(host)
        if not p.suffix or len(p.label) < 2:
            continue
        if host.replace("-", "").replace(".", "").isdigit():
            continue
        url = raw if re.match(r"^https?://", raw, re.I) else "https://" + raw
        if url not in urls:
            urls.append(url)
    return urls


def domain_of(url: str) -> str:
    host = re.sub(r"^https?://", "", url, flags=re.I).split("/")[0].split("?")[0].split(":")[0].lower()
    return host.removeprefix("www.") if host.startswith("www.") and host.count(".") > 1 else host


def is_shortener(domain: str) -> bool:
    return domain in SHORTENERS


def detect_language(text: str) -> str:
    arabic = len(re.findall(r"[؀-ۿ]", text))
    latin = len(re.findall(r"[A-Za-z]", text))
    if arabic and latin:
        return "ar+en" if arabic > latin * 0.3 else "en"
    return "ar" if arabic else "en"


def scrub(text: str) -> str:
    """Remove digit runs that look like personal identifiers (Emirates ID, phone numbers, plate numbers)."""
    text = re.sub(r"784-?\d{4}-?\d{7}-?\d", "[EID]", text)
    text = re.sub(r"(?<!\w)(?:\+?971|0)5\d[\s-]?\d{3}[\s-]?\d{4}(?!\w)", "[PHONE]", text)
    return text


def lure_signature(text: str) -> set[str]:
    """Content words of the message with URLs, digits and stop-words removed — used for campaign clustering.

    Variants of one lure keep the same nouns (parcel, redelivery, fee, fine, refund) while the wording, amounts
    and links change, so plain word overlap (Jaccard) is the right granularity.
    """
    t = URL_RE.sub(" ", defang(text).lower())
    t = re.sub(r"\d+([.,]\d+)?", " ", t)
    return {w for w in re.findall(r"[a-z؀-ۿ]+", t) if w not in EN_STOP and len(w) > 2}


def similarity(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


@dataclass
class IntakeResult:
    report: Report
    new_domains: list[str]


def build_report(channel: str, text: str, sender: str = "") -> Report:
    urls = extract_urls(text)
    domains = list(dict.fromkeys(domain_of(u) for u in urls))
    return Report(
        channel=channel, text=scrub(text.strip()), sender_masked=_mask_phone(sender) if sender else "",
        reporter_ref=reporter_ref(sender) if sender else "", urls=urls, domains=domains, language=detect_language(text),
    )


def extract_iocs(text: str) -> dict[str, list[str]]:
    """Bank accounts, wallets and contact numbers shown on a page or in a message (sent to banks / telecoms)."""
    iocs: dict[str, list[str]] = {}
    # UAE IBAN: AE + 2 check digits + 3 bank code + 16 account digits (23 characters), optionally grouped in fours
    ibans = re.findall(r"\bAE\d{2}(?:\s?\d{4}){4}\s?\d{3}\b|\bAE\d{21}\b", text)
    if ibans:
        iocs["ibans"] = sorted({re.sub(r"\s", "", i) for i in ibans})
    phones = re.findall(r"(?<!\d)(?:\+?971|00971|0)\s?5\d(?:[\s-]?\d{3}){1}[\s-]?\d{4}(?!\d)", text)
    if phones:
        iocs["phones"] = sorted({re.sub(r"[\s-]", "", p) for p in phones})
    wa = re.findall(r"wa\.me/\+?\d{9,15}|whatsapp(?:\s*:)?\s*\+?\d[\d\s-]{8,16}", text, flags=re.I)
    if wa:
        iocs["whatsapp"] = sorted({re.sub(r"\D", "", w) for w in wa})
    emails = re.findall(r"[\w.+-]+@[\w-]+\.[\w.-]+", text)
    if emails:
        iocs["emails"] = sorted(set(e.lower() for e in emails))
    crypto = re.findall(r"\b(?:bc1[a-z0-9]{25,59}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|0x[a-fA-F0-9]{40}|T[A-Za-z1-9]{33})\b", text)
    if crypto:
        iocs["crypto_wallets"] = sorted(set(crypto))
    return iocs
