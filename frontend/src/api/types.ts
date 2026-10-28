/**
 * Types for the SAQR HTTP / WebSocket contract (docs/api.md) and the pydantic models (saqr/models.py).
 * Timestamps are ISO-8601 UTC strings; enums are their string values.
 */

export type Source =
  | 'ct_log'
  | 'certstream'
  | 'replay'
  | 'citizen_report'
  | 'partner_report'
  | 'threat_feed'
  | 'manual';

export type CandidateStatus = 'queued' | 'verifying' | 'verified' | 'rechecking' | 'dismissed';
export type VerdictLabel = 'confirmed_fake' | 'suspicious' | 'benign' | 'inactive' | 'official';
export type CaseState = 'open' | 'approved' | 'blocked' | 'taken_down' | 'monitoring' | 'false_positive' | 'closed';
export type ActionStatus = 'pending' | 'sent' | 'acknowledged' | 'completed' | 'failed';
export type Channel = 'registrar' | 'hosting' | 'telecom' | 'browser' | 'bank' | 'certificate_authority' | 'national_cert';
export type ReportChannel = 'sms' | 'whatsapp' | 'email' | 'partner' | 'feed' | 'manual';
export type VerificationStage =
  | 'queued'
  | 'opening'
  | 'captured'
  | 'analysing'
  | 'scored'
  | 'evidence'
  | 'done'
  | 'error'
  | 'recheck';

export const CHANNELS: Channel[] = [
  'registrar',
  'hosting',
  'telecom',
  'browser',
  'bank',
  'certificate_authority',
  'national_cert',
];

// ------------------------------------------------------------------------------------------- sensing
export interface CertEntry {
  id: string;
  source: Source;
  log: string;
  index: number | null;
  seen_at: string;
  issued_at: string | null;
  not_before: string | null;
  not_after: string | null;
  issuer: string;
  domains: string[];
  is_precert: boolean;
  fingerprint: string;
  match_score: number;
  matched_domain: string | null;
  allowlisted: boolean;
}

export interface MatchReason {
  kind: string;
  detail: string;
  weight: number;
}

export interface MatchResult {
  domain: string;
  unicode_domain: string;
  skeleton: string;
  score: number;
  is_candidate: boolean;
  allowlisted: boolean;
  protected_entity: string | null;
  protected_domain: string | null;
  reasons: MatchReason[];
  tokens: string[];
}

export interface Candidate {
  id: string;
  domain: string;
  url: string;
  source: Source;
  status: CandidateStatus;
  first_seen: string;
  issued_at: string | null;
  cert_id: string | null;
  report_ids: string[];
  match: MatchResult | null;
  recheck_count: number;
  next_recheck_at: string | null;
  case_id: string | null;
  note: string;
}

// -------------------------------------------------------------------------------------- verification
export type FieldCategory =
  | 'card_number'
  | 'cvv'
  | 'expiry'
  | 'cardholder'
  | 'otp'
  | 'emirates_id'
  | 'password'
  | 'iban'
  | 'phone'
  | 'email'
  | 'name'
  | 'amount'
  | 'other'
  | string;

export interface InputField {
  name: string;
  id: string;
  type: string;
  placeholder: string;
  label: string;
  autocomplete: string;
  maxlength: number | null;
  category: FieldCategory;
  sensitivity: number;
}

export interface FormInfo {
  action: string;
  method: string;
  fields: InputField[];
  submit_text: string;
}

export interface TlsInfo {
  issuer: string;
  subject: string;
  valid_from: string | null;
  valid_to: string | null;
  protocol: string;
  sans: string[];
  fingerprint_sha256: string;
}

export interface Capture {
  captured_at: string;
  requested_url: string;
  final_url: string;
  redirects: string[];
  status: number | null;
  ok: boolean;
  error: string;
  title: string;
  lang: string;
  text: string;
  text_length: number;
  screenshot_desktop: string;
  screenshot_mobile: string;
  html_path: string;
  har_path: string;
  forms: FormInfo[];
  external_hosts: string[];
  resource_count: number;
  meta: Record<string, string>;
  tls: TlsInfo | null;
  headers: Record<string, string>;
  ip: string;
  resolved_via: string;
  duration_ms: number;
}

export interface VisualMatch {
  reference_id: string;
  reference_name: string;
  reference_domain: string;
  similarity: number;
  ssim: number | null;
  encoder: string;
}

export interface LogoMatch {
  reference_id: string;
  reference_domain: string;
  score: number;
  bbox: number[];
  scale: number;
}

export interface TextSignals {
  brand_mentions: string[];
  payment_terms: string[];
  urgency_terms: string[];
  arabic_ratio: number;
  gov_claims: string[];
  score: number;
}

export interface FormSignals {
  categories: string[];
  collects_card: boolean;
  collects_cvv: boolean;
  collects_otp: boolean;
  collects_identity: boolean;
  collects_credentials: boolean;
  external_action_hosts: string[];
  risk: number;
  summary: string;
}

export interface DomainSignals {
  lookalike_score: number;
  reasons: string[];
  cert_age_hours: number | null;
  free_ca: boolean;
  risky_tld: boolean;
  idn_homoglyph: boolean;
  score: number;
}

export interface Verdict {
  label: VerdictLabel;
  risk: number;
  confidence: number;
  components: Record<string, number>;
  explanations: string[];
  recommended_action: string;
  visual: VisualMatch[];
  logos: LogoMatch[];
  text: TextSignals;
  form: FormSignals;
  domain: DomainSignals;
  encoder: string;
  decided_at: string;
}

// ------------------------------------------------------------------------------------------ evidence
export interface Artifact {
  name: string;
  path: string;
  sha256: string;
  size: number;
  mime: string;
  description: string;
}

export interface TrustedTimestamp {
  kind: 'rfc3161' | 'local_signed' | string;
  authority: string;
  time: string;
  token_path: string;
  digest: string;
  verified: boolean;
  note: string;
}

export interface CustodyEvent {
  at: string;
  actor: string;
  event: string;
  detail: string;
  hash: string;
}

export interface EvidencePackage {
  id: string;
  case_id: string;
  domain: string;
  created_at: string;
  directory: string;
  zip_path: string;
  zip_sha256: string;
  artifacts: Artifact[];
  merkle_root: string;
  manifest_sha256: string;
  timestamp: TrustedTimestamp | null;
  custody: CustodyEvent[];
  dns: Record<string, unknown>;
  registration: Record<string, unknown>;
  hosting: Record<string, unknown>;
  certificate: Record<string, unknown>;
  ct_entry: Record<string, unknown>;
  iocs: Record<string, string[]>;
  tool_versions: Record<string, string>;
}

// ------------------------------------------------------------------------------------------ response
export interface Action {
  id: string;
  case_id: string;
  channel: Channel;
  connector: string;
  target: string;
  status: ActionStatus;
  request_summary: string;
  payload: Record<string, unknown>;
  receipt: string;
  created_at: string;
  sent_at: string | null;
  acknowledged_at: string | null;
  completed_at: string | null;
  error: string;
  blocks_exposure: boolean;
}

export interface TimelineEvent {
  at: string;
  kind: string;
  title: string;
  detail: string;
  actor: string;
}

export interface Case {
  id: string;
  candidate_id: string;
  domain: string;
  url: string;
  source: Source;
  state: CaseState;
  created_at: string;
  issued_at: string | null;
  detected_at: string;
  verified_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  blocked_at: string | null;
  taken_down_at: string | null;
  verdict: Verdict;
  capture: Capture;
  evidence_id: string | null;
  campaign_id: string | null;
  report_ids: string[];
  iocs: Record<string, string[]>;
  timeline: TimelineEvent[];
  analyst_note: string;
}

export interface Report {
  id: string;
  channel: ReportChannel | string;
  text: string;
  sender_masked: string;
  reporter_ref: string;
  received_at: string;
  urls: string[];
  domains: string[];
  candidate_ids: string[];
  campaign_id: string | null;
  language: string;
}

export interface Campaign {
  id: string;
  name: string;
  created_at: string;
  last_seen: string;
  report_ids: string[];
  domains: string[];
  case_ids: string[];
  pattern: string;
  infrastructure: Record<string, string[]>;
  entity: string | null;
  status: 'active' | 'contained' | 'closed' | string;
}

export interface AuditEntry {
  seq: number;
  at: string;
  actor: string;
  action: string;
  subject: string;
  detail: Record<string, unknown>;
  prev_hash: string;
  hash: string;
}

export interface Metrics {
  certs_seen: number;
  certs_per_minute: number;
  candidates: number;
  cases_open: number;
  cases_confirmed: number;
  cases_blocked: number;
  reports: number;
  campaigns: number;
  false_positives: number;
  median_tti_minutes: number | null;
  median_verify_minutes: number | null;
  median_exposure_minutes: number | null;
  baseline_tti_minutes: number;
  baseline_exposure_minutes: number;
  tti_reduction_pct: number | null;
  exposure_reduction_pct: number | null;
  funnel: Partial<Record<'certs_seen' | 'filtered' | 'candidates' | 'verified' | 'confirmed' | 'approved' | 'blocked', number>>;
  sources: Record<string, unknown>;
}

// ---------------------------------------------------------------------------------------- API shapes
export interface CaseSummaryVerdict {
  label: VerdictLabel;
  risk: number;
  confidence: number;
  encoder: string;
  components: { visual: number; logo: number; text: number; form: number; domain: number };
  top_visual: {
    reference_id: string;
    reference_name: string;
    reference_domain: string;
    similarity: number;
    ssim: number | null;
  } | null;
  form_summary: string;
  explanations: string[];
}

export interface ActionSummary {
  total: number;
  sent: number;
  acknowledged: number;
  completed: number;
  failed: number;
  blocking_confirmed: boolean;
}

export interface CaseSummary {
  id: string;
  domain: string;
  url: string;
  state: CaseState;
  source: Source;
  created_at: string;
  issued_at: string | null;
  detected_at: string;
  verified_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  blocked_at: string | null;
  taken_down_at: string | null;
  verdict: CaseSummaryVerdict;
  protected_entity: string | null;
  protected_domain: string | null;
  lookalike_score: number;
  campaign_id: string | null;
  report_count: number;
  action_summary: ActionSummary;
  screenshot_url: string;
  thumbnail_url: string;
  mobile_screenshot_url: string | null;
  has_evidence: boolean;
  evidence_id: string | null;
  minutes_to_identify: number | null;
  minutes_to_verify: number | null;
  minutes_exposure: number | null;
  title: string;
}

export interface ReferencePage {
  id: string;
  name: string;
  domain: string;
  entity: string;
  screenshot_url: string;
  /** why this page was chosen: nearest by visual similarity, or the imitated entity's page when nothing matches */
  reason?: string;
}

export interface CaseDetail {
  summary: CaseSummary;
  case: Case;
  candidate: Candidate | null;
  evidence: EvidencePackage | null;
  actions: Action[];
  reports: Report[];
  campaign: Campaign | null;
  reference: ReferencePage | null;
  capture_text_excerpt: string;
}

export interface CtLogStats {
  name: string;
  url: string;
  tree_size: number;
  position: number;
  lag: number;
  entries: number;
  rate_per_min: number;
  online: boolean;
}

export interface SourceStats {
  source: 'replay' | 'ctlogs' | 'certstream' | 'hybrid' | string;
  online: boolean;
  entries: number;
  rate_per_min: number;
  logs?: CtLogStats[];
  planted?: number;
}

export interface DemoStep {
  id: string;
  at_s: number;
  kind: 'cert' | 'report' | 'activate' | 'note' | string;
  label: string;
  fired: boolean;
  fired_at: string | null;
}

export interface DemoState {
  available: boolean;
  running: boolean;
  speed: number;
  started_at: string | null;
  elapsed_s: number;
  sites_url: string;
  steps: DemoStep[];
}

export interface StatusResponse {
  node: string;
  version: string;
  started_at: string;
  uptime_s: number;
  sources: SourceStats;
  encoder: { name: string; model: string; dims: number };
  connector_mode: 'simulate' | 'live' | string;
  demo: DemoState;
  protected_entities: number;
  counts: {
    certs_seen: number;
    candidates: number;
    cases: number;
    reports: number;
    campaigns: number;
    actions: number;
  };
  match_threshold?: number;
}

export interface FeedResponse {
  entries: CertEntry[];
}

export interface ApproveRequest {
  actor: string;
  channels?: Channel[];
  note?: string;
}

export interface ApproveResponse {
  case: CaseSummary;
  actions: Action[];
}

export interface DismissRequest {
  actor: string;
  reason: string;
}

export interface ReportRequest {
  channel: 'sms' | 'whatsapp' | 'email' | 'partner';
  text: string;
  sender?: string;
}

export interface ReportResponse {
  report: Report;
  candidates: Candidate[];
  campaign: Campaign | null;
}

export interface IntakeUrlRequest {
  url: string;
  source: 'partner_report' | 'threat_feed' | 'manual';
  note?: string;
}

export interface CampaignDetail {
  campaign: Campaign;
  reports: Report[];
  cases: CaseSummary[];
}

export interface AuditResponse {
  entries: AuditEntry[];
  valid: boolean;
  length: number;
}

export interface AuditVerifyResponse {
  valid: boolean;
  length: number;
  broken_at: number | null;
}

export interface ProtectedEntity {
  id: string;
  name: string;
  name_ar: string;
  sector: string;
  domains: string[];
  brands: string[];
  services: string[];
}

export interface ProtectedRegistry {
  official_suffixes: string[];
  entities: ProtectedEntity[];
  keywords: { strong: string[]; normal: string[] };
  government_cues: string[];
}

export interface GalleryItem {
  id: string;
  name: string;
  domain: string;
  entity: string;
  screenshot_url: string;
}

export interface Connector {
  channel: Channel;
  name: string;
  description: string;
  targets: string[];
  mode: 'simulate' | 'live' | string;
}

// ------------------------------------------------------------------------------------------- WebSocket
export interface VerificationEvent {
  candidate_id: string;
  domain: string;
  stage: VerificationStage;
  message: string;
}

export interface EvidenceEvent {
  case_id: string;
  evidence_id: string;
  artifacts: number;
  merkle_root: string;
  timestamp_kind: string;
}

export interface DemoFiredEvent {
  step_id: string;
  label: string;
  kind: string;
}

export type WsEvent =
  | { type: 'hello'; at: string; data: { history: WsEvent[] } }
  | { type: 'cert'; at: string; data: CertEntry }
  | { type: 'candidate'; at: string; data: Candidate }
  | { type: 'verification'; at: string; data: VerificationEvent }
  | { type: 'case'; at: string; data: CaseSummary }
  | { type: 'evidence'; at: string; data: EvidenceEvent }
  | { type: 'action'; at: string; data: Action }
  | { type: 'report'; at: string; data: Report }
  | { type: 'campaign'; at: string; data: Campaign }
  | { type: 'metrics'; at: string; data: Metrics }
  | { type: 'audit'; at: string; data: AuditEntry }
  | { type: 'demo'; at: string; data: DemoFiredEvent }
  | { type: 'status'; at: string; data: StatusResponse };
