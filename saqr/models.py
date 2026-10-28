"""Domain models shared by the pipeline, the API and the dashboard (serialised as JSON)."""
from __future__ import annotations

import secrets
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(5)}"


class Source(str, Enum):
    ct_log = "ct_log"              # tailed directly from an RFC 6962 log
    certstream = "certstream"      # certstream aggregator websocket
    replay = "replay"              # synthetic / replayed feed (demo)
    citizen_report = "citizen_report"  # forwarded SMS / WhatsApp
    partner_report = "partner_report"  # bank / telecom / CERT submission
    threat_feed = "threat_feed"    # external phishing feed
    manual = "manual"              # analyst submitted


class CandidateStatus(str, Enum):
    queued = "queued"
    verifying = "verifying"
    verified = "verified"
    rechecking = "rechecking"      # page inactive; scheduled for re-verification
    dismissed = "dismissed"


class VerdictLabel(str, Enum):
    confirmed_fake = "confirmed_fake"
    suspicious = "suspicious"
    benign = "benign"
    inactive = "inactive"          # unreachable / parked / empty: recheck later
    official = "official"          # allow-listed government property


class CaseState(str, Enum):
    open = "open"                  # verified, awaiting analyst decision
    approved = "approved"          # analyst approved; dispatch in progress
    blocked = "blocked"            # at least one blocking channel confirmed
    taken_down = "taken_down"      # registrar / host confirmed removal
    monitoring = "monitoring"      # inactive page under periodic recheck
    false_positive = "false_positive"
    closed = "closed"


class ActionStatus(str, Enum):
    pending = "pending"
    sent = "sent"
    acknowledged = "acknowledged"
    completed = "completed"
    failed = "failed"


class Channel(str, Enum):
    registrar = "registrar"
    hosting = "hosting"
    telecom = "telecom"
    browser = "browser"
    bank = "bank"
    certificate_authority = "certificate_authority"
    national_cert = "national_cert"


# --------------------------------------------------------------------------------------------- sensing
class CertEntry(BaseModel):
    """One certificate observed in a transparency log (or synthesised in replay mode)."""

    id: str = Field(default_factory=lambda: new_id("cert"))
    source: Source
    log: str = ""                          # log URL / name
    index: int | None = None               # leaf index in the log
    seen_at: datetime = Field(default_factory=utcnow)
    issued_at: datetime | None = None      # log timestamp (ms precision) == when the CA logged it
    not_before: datetime | None = None
    not_after: datetime | None = None
    issuer: str = ""
    domains: list[str] = Field(default_factory=list)
    is_precert: bool = False
    fingerprint: str = ""                  # sha256 of the leaf (hex)
    match_score: int = 0                   # best look-alike score across domains
    matched_domain: str | None = None
    allowlisted: bool = False


class MatchReason(BaseModel):
    kind: str          # brand_token | keyword | edit_distance | homoglyph | embedded_domain | tld_swap | typo | gov_cue
    detail: str
    weight: int


class MatchResult(BaseModel):
    domain: str
    unicode_domain: str
    skeleton: str                          # confusable-normalised form
    score: int = 0
    is_candidate: bool = False
    allowlisted: bool = False
    protected_entity: str | None = None
    protected_domain: str | None = None
    reasons: list[MatchReason] = Field(default_factory=list)
    tokens: list[str] = Field(default_factory=list)

    @property
    def summary(self) -> str:
        return "; ".join(r.detail for r in self.reasons[:4])


class Candidate(BaseModel):
    id: str = Field(default_factory=lambda: new_id("cand"))
    domain: str
    url: str
    source: Source
    status: CandidateStatus = CandidateStatus.queued
    first_seen: datetime = Field(default_factory=utcnow)
    issued_at: datetime | None = None      # certificate timestamp when known (time-to-identify anchor)
    cert_id: str | None = None
    report_ids: list[str] = Field(default_factory=list)
    match: MatchResult | None = None
    recheck_count: int = 0
    next_recheck_at: datetime | None = None
    case_id: str | None = None
    note: str = ""


# ---------------------------------------------------------------------------------------- verification
class InputField(BaseModel):
    name: str = ""
    id: str = ""
    type: str = ""
    placeholder: str = ""
    label: str = ""
    autocomplete: str = ""
    maxlength: int | None = None
    category: str = "other"      # card_number | cvv | expiry | cardholder | otp | emirates_id | password | iban | phone | email | name | amount | other
    sensitivity: int = 0         # 0..3


class FormInfo(BaseModel):
    action: str = ""
    method: str = ""
    fields: list[InputField] = Field(default_factory=list)
    submit_text: str = ""


class TlsInfo(BaseModel):
    issuer: str = ""
    subject: str = ""
    valid_from: datetime | None = None
    valid_to: datetime | None = None
    protocol: str = ""
    sans: list[str] = Field(default_factory=list)
    fingerprint_sha256: str = ""


class Capture(BaseModel):
    """Everything collected from one isolated browser visit."""

    captured_at: datetime = Field(default_factory=utcnow)
    requested_url: str
    final_url: str = ""
    redirects: list[str] = Field(default_factory=list)
    status: int | None = None
    ok: bool = False
    error: str = ""
    title: str = ""
    lang: str = ""
    text: str = ""
    text_length: int = 0
    screenshot_desktop: str = ""   # paths relative to data_dir
    screenshot_mobile: str = ""
    html_path: str = ""
    har_path: str = ""
    forms: list[FormInfo] = Field(default_factory=list)
    external_hosts: list[str] = Field(default_factory=list)
    resource_count: int = 0
    meta: dict[str, str] = Field(default_factory=dict)
    tls: TlsInfo | None = None
    headers: dict[str, str] = Field(default_factory=dict)
    ip: str = ""
    resolved_via: str = ""         # "dns" or "demo-override"
    duration_ms: int = 0


class VisualMatch(BaseModel):
    reference_id: str
    reference_name: str
    reference_domain: str
    similarity: float              # cosine similarity of embeddings, 0..1
    ssim: float | None = None      # structural similarity of above-the-fold crops
    encoder: str


class LogoMatch(BaseModel):
    reference_id: str
    reference_domain: str
    score: float
    bbox: list[int] = Field(default_factory=list)   # x, y, w, h on desktop screenshot
    scale: float = 1.0


class TextSignals(BaseModel):
    brand_mentions: list[str] = Field(default_factory=list)
    payment_terms: list[str] = Field(default_factory=list)
    urgency_terms: list[str] = Field(default_factory=list)
    arabic_ratio: float = 0.0
    gov_claims: list[str] = Field(default_factory=list)
    score: float = 0.0


class FormSignals(BaseModel):
    categories: list[str] = Field(default_factory=list)
    collects_card: bool = False
    collects_cvv: bool = False
    collects_otp: bool = False
    collects_identity: bool = False
    collects_credentials: bool = False
    external_action_hosts: list[str] = Field(default_factory=list)
    risk: float = 0.0
    summary: str = ""


class DomainSignals(BaseModel):
    lookalike_score: int = 0
    reasons: list[str] = Field(default_factory=list)
    cert_age_hours: float | None = None
    free_ca: bool = False
    risky_tld: bool = False
    idn_homoglyph: bool = False
    score: float = 0.0


class Verdict(BaseModel):
    label: VerdictLabel
    risk: int                           # 0..100
    confidence: float                   # 0..1
    components: dict[str, float] = Field(default_factory=dict)   # visual, logo, text, form, domain (0..1)
    explanations: list[str] = Field(default_factory=list)
    recommended_action: str = ""
    visual: list[VisualMatch] = Field(default_factory=list)
    logos: list[LogoMatch] = Field(default_factory=list)
    text: TextSignals = Field(default_factory=TextSignals)
    form: FormSignals = Field(default_factory=FormSignals)
    domain: DomainSignals = Field(default_factory=DomainSignals)
    encoder: str = ""
    decided_at: datetime = Field(default_factory=utcnow)


# -------------------------------------------------------------------------------------------- evidence
class Artifact(BaseModel):
    name: str
    path: str
    sha256: str
    size: int
    mime: str
    description: str = ""


class Timestamp(BaseModel):
    kind: str                           # rfc3161 | local_signed
    authority: str
    time: datetime
    token_path: str = ""
    digest: str                         # the hash that was time-stamped (manifest sha256)
    verified: bool = False
    note: str = ""


class CustodyEvent(BaseModel):
    at: datetime = Field(default_factory=utcnow)
    actor: str
    event: str
    detail: str = ""
    hash: str = ""


class EvidencePackage(BaseModel):
    id: str = Field(default_factory=lambda: new_id("evd"))
    case_id: str
    domain: str
    created_at: datetime = Field(default_factory=utcnow)
    directory: str
    zip_path: str = ""
    zip_sha256: str = ""
    artifacts: list[Artifact] = Field(default_factory=list)
    merkle_root: str = ""
    manifest_sha256: str = ""
    timestamp: Timestamp | None = None
    custody: list[CustodyEvent] = Field(default_factory=list)
    dns: dict[str, Any] = Field(default_factory=dict)
    registration: dict[str, Any] = Field(default_factory=dict)
    hosting: dict[str, Any] = Field(default_factory=dict)
    certificate: dict[str, Any] = Field(default_factory=dict)
    ct_entry: dict[str, Any] = Field(default_factory=dict)
    iocs: dict[str, list[str]] = Field(default_factory=dict)
    tool_versions: dict[str, str] = Field(default_factory=dict)


# -------------------------------------------------------------------------------------------- response
class Action(BaseModel):
    id: str = Field(default_factory=lambda: new_id("act"))
    case_id: str
    channel: Channel
    connector: str                      # e.g. "registrar-abuse", "telecom-etisalat"
    target: str                         # human readable recipient
    status: ActionStatus = ActionStatus.pending
    request_summary: str = ""
    payload: dict[str, Any] = Field(default_factory=dict)
    receipt: str = ""
    created_at: datetime = Field(default_factory=utcnow)
    sent_at: datetime | None = None
    acknowledged_at: datetime | None = None
    completed_at: datetime | None = None
    error: str = ""
    blocks_exposure: bool = False       # telecom/browser/DNS blocks reduce exposure immediately


class TimelineEvent(BaseModel):
    at: datetime = Field(default_factory=utcnow)
    kind: str                           # issued | detected | verifying | verified | evidence | approved | dispatched | blocked | taken_down | report | recheck | dismissed
    title: str
    detail: str = ""
    actor: str = "system"


class Case(BaseModel):
    id: str = Field(default_factory=lambda: new_id("case"))
    candidate_id: str
    domain: str
    url: str
    source: Source
    state: CaseState = CaseState.open
    created_at: datetime = Field(default_factory=utcnow)
    issued_at: datetime | None = None
    detected_at: datetime
    verified_at: datetime | None = None
    approved_at: datetime | None = None
    approved_by: str | None = None
    blocked_at: datetime | None = None
    taken_down_at: datetime | None = None
    verdict: Verdict
    capture: Capture
    evidence_id: str | None = None
    campaign_id: str | None = None
    report_ids: list[str] = Field(default_factory=list)
    iocs: dict[str, list[str]] = Field(default_factory=dict)
    timeline: list[TimelineEvent] = Field(default_factory=list)
    analyst_note: str = ""

    def add_event(self, kind: str, title: str, detail: str = "", actor: str = "system", at: datetime | None = None) -> None:
        self.timeline.append(TimelineEvent(at=at or utcnow(), kind=kind, title=title, detail=detail, actor=actor))


class Report(BaseModel):
    """A forwarded message (SMS / WhatsApp / email) or partner/threat-feed submission."""

    id: str = Field(default_factory=lambda: new_id("rpt"))
    channel: str                        # sms | whatsapp | email | partner | feed | manual
    text: str
    sender_masked: str = ""             # e.g. "+971 5* *** **12" — never store the raw number
    reporter_ref: str = ""              # hashed reporter identity for de-duplication
    received_at: datetime = Field(default_factory=utcnow)
    urls: list[str] = Field(default_factory=list)
    domains: list[str] = Field(default_factory=list)
    candidate_ids: list[str] = Field(default_factory=list)
    campaign_id: str | None = None
    language: str = ""


class Campaign(BaseModel):
    id: str = Field(default_factory=lambda: new_id("camp"))
    name: str
    created_at: datetime = Field(default_factory=utcnow)
    last_seen: datetime = Field(default_factory=utcnow)
    report_ids: list[str] = Field(default_factory=list)
    domains: list[str] = Field(default_factory=list)
    case_ids: list[str] = Field(default_factory=list)
    pattern: str = ""                   # representative lure text
    infrastructure: dict[str, list[str]] = Field(default_factory=dict)   # ips, asns, registrars, issuers
    entity: str | None = None
    status: str = "active"              # active | contained | closed


class AuditEntry(BaseModel):
    seq: int
    at: datetime
    actor: str
    action: str
    subject: str
    detail: dict[str, Any] = Field(default_factory=dict)
    prev_hash: str
    hash: str


class Metrics(BaseModel):
    certs_seen: int = 0
    certs_per_minute: float = 0.0
    candidates: int = 0
    cases_open: int = 0
    cases_confirmed: int = 0
    cases_blocked: int = 0
    reports: int = 0
    campaigns: int = 0
    false_positives: int = 0
    median_tti_minutes: float | None = None        # issued -> detected
    median_verify_minutes: float | None = None     # detected -> verified
    median_exposure_minutes: float | None = None   # detected -> first block
    baseline_tti_minutes: float = 0
    baseline_exposure_minutes: float = 0
    tti_reduction_pct: float | None = None
    exposure_reduction_pct: float | None = None
    funnel: dict[str, int] = Field(default_factory=dict)
    sources: dict[str, Any] = Field(default_factory=dict)
