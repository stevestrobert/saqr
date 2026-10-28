"""Form-field classification: what does the page ask the visitor to type?

Official payment portals look up a fine or fee and hand off to a licensed gateway. A page that copies a
government layout and asks for a card number and CVV (and often an OTP) on the same page is almost
certainly fake. Fields are classified from name / id / placeholder / label / autocomplete / type / maxlength,
in English and Arabic.
"""
from __future__ import annotations

import re
from urllib.parse import urlparse

from ..models import FormInfo, FormSignals, InputField

# category -> (patterns, sensitivity 0..3)
RULES: list[tuple[str, re.Pattern[str], int]] = [
    ("cvv", re.compile(r"\b(cvv2?|cvc2?|csc|cc[-_ ]?csc|security[-_ ]?code|card[-_ ]?code|cid)\b|رمز الأمان|رمز الحماية", re.I), 3),
    ("expiry", re.compile(r"\b(cc[-_ ]?exp\w*|exp(iry|iration|ires)?[-_ ]?(date|month|year|mm|yy)?|valid[-_ ]?(thru|until)|mm\s*/\s*yy)\b|تاريخ الانتهاء|انتهاء الصلاحية", re.I), 2),
    ("card_number", re.compile(r"\b(cc[-_ ]?number|cc[-_ ]?num|card[-_ ]?(number|num|no)|cardnumber|ccnum|pan|credit[-_ ]?card|debit[-_ ]?card|card)\b|رقم البطاقة|بطاقة الائتمان|بطاقة", re.I), 3),
    ("cardholder", re.compile(r"\b(cc[-_ ]?name|card[-_ ]?holder|cardholder|name[-_ ]?on[-_ ]?card|holder[-_ ]?name)\b|اسم حامل البطاقة|اسم صاحب البطاقة", re.I), 1),
    ("otp", re.compile(r"\b(otp|one[-_ ]?time|verification[-_ ]?code|sms[-_ ]?code|security[-_ ]?pin|auth[-_ ]?code|passcode|6[-_ ]?digit|code sent)\b|رمز التحقق|كلمة المرور لمرة واحدة|الرمز المرسل", re.I), 3),
    ("emirates_id", re.compile(r"\b(emirates[-_ ]?id|eid|emiratesid|national[-_ ]?id|id[-_ ]?number|784[-_ ]?\w*)\b|الهوية الإماراتية|رقم الهوية|بطاقة الهوية", re.I), 2),
    ("password", re.compile(r"\b(password|passwd|pwd|pin[-_ ]?code|pin|secret)\b|كلمة المرور|الرقم السري", re.I), 3),
    ("iban", re.compile(r"\b(iban|account[-_ ]?(number|no)|bank[-_ ]?account|acct)\b|آيبان|رقم الحساب|الحساب البنكي", re.I), 2),
    ("phone", re.compile(r"\b(phone|mobile|tel|msisdn|whatsapp|contact[-_ ]?number)\b|رقم الهاتف|الجوال|الموبايل", re.I), 1),
    ("email", re.compile(r"\b(e-?mail)\b|البريد الإلكتروني", re.I), 1),
    ("name", re.compile(r"\b(full[-_ ]?name|first[-_ ]?name|last[-_ ]?name|fname|lname|your[-_ ]?name|name)\b|الاسم", re.I), 1),
    ("address", re.compile(r"\b(address|street|city|postal|zip|po[-_ ]?box|building|apartment|flat)\b|العنوان|المدينة|صندوق البريد", re.I), 1),
    ("amount", re.compile(r"\b(amount|total|sum)\b|المبلغ", re.I), 0),
    ("lookup", re.compile(r"\b(plate|licen[cs]e|traffic[-_ ]?(file|code)|trn|tracking|reference|ticket|account[-_ ]?id|tag|invoice|fine[-_ ]?(number|no)|violation)\b|رقم اللوحة|رقم المخالفة|رقم التتبع|الرقم الضريبي|رقم المرجع|رخصة", re.I), 0),
]
AUTOCOMPLETE = {
    "cc-number": "card_number", "cc-csc": "cvv", "cc-exp": "expiry", "cc-exp-month": "expiry", "cc-exp-year": "expiry",
    "cc-name": "cardholder", "one-time-code": "otp", "current-password": "password", "new-password": "password",
    "tel": "phone", "email": "email", "name": "name", "street-address": "address", "postal-code": "address",
}
SENSITIVITY = {"cvv": 3, "card_number": 3, "otp": 3, "password": 3, "expiry": 2, "emirates_id": 2, "iban": 2,
               "cardholder": 1, "phone": 1, "email": 1, "name": 1, "address": 1, "amount": 0, "lookup": 0, "other": 0}


def classify_field(f: InputField) -> InputField:
    t = (f.type or "").lower()
    if t in {"hidden", "submit", "button", "reset", "image", "checkbox", "radio", "file", "range", "color"}:
        f.category, f.sensitivity = "other", 0
        return f
    ac = (f.autocomplete or "").lower().strip()
    if ac in AUTOCOMPLETE:
        f.category = AUTOCOMPLETE[ac]
        f.sensitivity = SENSITIVITY[f.category]
        return f
    if t == "password":
        f.category, f.sensitivity = "password", 3
        return f
    if t == "email":
        f.category, f.sensitivity = "email", 1
        return f
    haystack = " ".join(x for x in (f.name, f.id, f.placeholder, f.label) if x)
    # maxlength heuristics: 3-4 numeric -> cvv, 16-19 numeric -> card number
    for cat, pattern, sens in RULES:
        if pattern.search(haystack):
            # avoid 'card' matching 'emirates id card' lookups
            if cat == "card_number" and re.search(r"emirates|هوية|id card|card id|salik tag|nol", haystack, re.I):
                continue
            f.category, f.sensitivity = cat, sens
            return f
    if f.maxlength in (3, 4) and re.search(r"code|cv|pin|رمز", haystack, re.I):
        f.category, f.sensitivity = "cvv", 3
        return f
    if f.maxlength in (16, 19) and t in {"tel", "text", "number", ""}:
        f.category, f.sensitivity = "card_number", 3
        return f
    f.category, f.sensitivity = "other", 0
    return f


def analyse_forms(forms: list[FormInfo], page_host: str = "") -> FormSignals:
    sig = FormSignals()
    cats: list[str] = []
    external: list[str] = []
    for form in forms:
        for f in form.fields:
            classify_field(f)
            if f.category != "other":
                cats.append(f.category)
        if form.action:
            try:
                host = urlparse(form.action).hostname
                if host and page_host and host != page_host and not host.endswith("." + page_host):
                    external.append(host)
            except Exception:
                pass
    sig.categories = sorted(set(cats))
    sig.collects_card = "card_number" in cats
    sig.collects_cvv = "cvv" in cats
    sig.collects_otp = "otp" in cats
    sig.collects_identity = "emirates_id" in cats
    sig.collects_credentials = "password" in cats
    sig.external_action_hosts = sorted(set(external))

    risk = 0.0
    parts: list[str] = []
    if sig.collects_card:
        risk += 0.55
        parts.append("asks for a payment card number")
        if sig.collects_cvv:
            risk += 0.2
            parts.append("and CVV")
        if "expiry" in cats:
            risk += 0.05
    if sig.collects_otp:
        risk += 0.25 if sig.collects_card else 0.35
        parts.append("requests the SMS one-time code (OTP relay — enables immediate fraudulent charges)")
    if sig.collects_identity:
        risk += 0.15
        parts.append("collects Emirates ID number")
    if sig.collects_credentials:
        risk += 0.3
        parts.append("collects a password / PIN")
    if "iban" in cats and not sig.collects_card:
        risk += 0.2
        parts.append("asks for a bank account / IBAN")
    if sig.external_action_hosts:
        risk += 0.05
        parts.append(f"form posts to another host ({', '.join(sig.external_action_hosts[:2])})")
    if not parts:
        if "lookup" in cats:
            parts.append("only lookup fields (plate / reference) — consistent with an official inquiry page")
        elif cats:
            parts.append("collects contact details only")
        else:
            parts.append("no data-collection form")
    sig.risk = min(1.0, risk)
    sig.summary = " ".join(parts) if parts else ""
    return sig
