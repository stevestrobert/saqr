# SAQR HTTP / WebSocket API contract

Base URL: `http://<host>:8000`. JSON everywhere, timestamps are ISO-8601 UTC strings, ids are strings such as
`case_3f9a1c2b7d`. Full field lists for every model are in `saqr/models.py` (pydantic): `CertEntry`, `MatchResult`,
`Candidate`, `Capture`, `Verdict`, `Case`, `EvidencePackage`, `Action`, `Report`, `Campaign`, `AuditEntry`, `Metrics`.
Enums are serialised as their string values (e.g. `"confirmed_fake"`).

The SPA is served from `/` (static `frontend/dist`, SPA fallback to `index.html`). API under `/api`, live events on `/ws`.

## Status & metrics

| Method | Path | Returns |
|---|---|---|
| GET | `/api/status` | `{ node, version, started_at, uptime_s, sources: SourceStats, encoder: {name, model, dims}, connector_mode, demo: DemoState, protected_entities: number, counts: {certs_seen, candidates, cases, reports, campaigns, actions} }` |
| GET | `/api/metrics` | `Metrics` (see models) — counts, medians in minutes, baselines, `tti_reduction_pct`, `exposure_reduction_pct`, `funnel: {certs_seen, filtered, candidates, verified, confirmed, approved, blocked}` |

`SourceStats` = `{ source: "replay"|"ctlogs"|"certstream"|"hybrid", online: bool, entries: number, rate_per_min: number, logs?: [{name, url, tree_size, position, lag, entries, rate_per_min, online}] , planted?: number }`.

## Live certificate feed

| Method | Path | Returns |
|---|---|---|
| GET | `/api/feed?limit=200` | `{ entries: CertEntry[] }` newest first. Every entry carries `match_score` (0-100), `matched_domain`, `allowlisted`. Candidates have `match_score >= threshold` (threshold is in `/api/status.match_threshold`). |
| GET | `/api/match?domain=rta-fines.com` | `MatchResult` — interactive "test a name" for the registry page |

## Candidates & cases

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/candidates?status=&limit=100` | | `Candidate[]` newest first |
| GET | `/api/cases?state=&limit=100` | | `CaseSummary[]` newest first |
| GET | `/api/cases/{id}` | | `CaseDetail` |
| GET | `/api/cases/{id}/screenshot?view=desktop|mobile&thumb=0|1` | | `image/png` |
| GET | `/api/cases/{id}/evidence.zip` | | zip download (404 until evidence exists) |
| GET | `/api/cases/{id}/evidence/report` | | `text/html` human-readable evidence report |
| GET | `/api/cases/{id}/evidence/{artifact_name}` | | the raw artifact (e.g. `manifest.json`, `page.html`, `dns.json`) |
| POST | `/api/cases/{id}/approve` | `{ actor: string, channels?: Channel[], note?: string }` | `{ case: CaseSummary, actions: Action[] }` — the one click. Dispatches to all connectors (or the listed channels). Fails 409 if the domain is allow-listed or the case is not open. |
| POST | `/api/cases/{id}/dismiss` | `{ actor: string, reason: string }` | `CaseSummary` (state `false_positive`) |
| POST | `/api/cases/{id}/recheck` | | `Candidate` (re-queued for verification) |
| POST | `/api/cases/{id}/note` | `{ actor, note }` | `CaseSummary` |

`Channel` = `registrar | hosting | telecom | browser | bank | certificate_authority | national_cert`.

```ts
type CaseSummary = {
  id: string; domain: string; url: string; state: CaseState; source: Source;
  created_at: string; issued_at: string|null; detected_at: string; verified_at: string|null;
  approved_at: string|null; approved_by: string|null; blocked_at: string|null; taken_down_at: string|null;
  verdict: { label: VerdictLabel; risk: number; confidence: number; encoder: string;
             components: {visual:number; logo:number; text:number; form:number; domain:number};
             top_visual: { reference_id: string; reference_name: string; reference_domain: string; similarity: number; ssim: number|null } | null;
             form_summary: string; explanations: string[] };
  protected_entity: string|null; protected_domain: string|null; lookalike_score: number;
  campaign_id: string|null; report_count: number;
  action_summary: { total: number; sent: number; acknowledged: number; completed: number; failed: number; blocking_confirmed: boolean };
  screenshot_url: string; thumbnail_url: string; mobile_screenshot_url: string | null;
  has_evidence: boolean; evidence_id: string|null;
  minutes_to_identify: number|null;   // issued_at -> detected_at
  minutes_to_verify: number|null;     // detected_at -> verified_at
  minutes_exposure: number|null;      // detected_at -> blocked_at (null while not blocked)
  title: string;                      // page title captured
};
type CaseDetail = {
  summary: CaseSummary; case: Case; candidate: Candidate|null; evidence: EvidencePackage|null;
  actions: Action[]; reports: Report[]; campaign: Campaign|null;
  reference: { id: string; name: string; domain: string; entity: string; screenshot_url: string } | null;  // nearest official page
  capture_text_excerpt: string;
};
```

`CaseState` = `open | approved | blocked | taken_down | monitoring | false_positive | closed`.
`VerdictLabel` = `confirmed_fake | suspicious | benign | inactive | official`.

## Reports (forwarded messages) & campaigns

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/reports?limit=100` | | `Report[]` |
| POST | `/api/reports` | `{ channel: "sms"|"whatsapp"|"email"|"partner", text: string, sender?: string }` | `{ report: Report, candidates: Candidate[], campaign: Campaign|null }` |
| POST | `/api/intake/url` | `{ url: string, source: "partner_report"|"threat_feed"|"manual", note?: string }` | `Candidate` |
| GET | `/api/campaigns` | | `Campaign[]` |
| GET | `/api/campaigns/{id}` | | `{ campaign: Campaign, reports: Report[], cases: CaseSummary[] }` |

## Actions, audit, registry, gallery

| Method | Path | Returns |
|---|---|---|
| GET | `/api/actions?case_id=&limit=200` | `Action[]` |
| GET | `/api/audit?limit=200` | `{ entries: AuditEntry[], valid: boolean, length: number }` |
| POST | `/api/audit/verify` | `{ valid: boolean, length: number, broken_at: number|null }` |
| GET | `/api/protected` | `{ official_suffixes: string[], entities: [{ id, name, name_ar, sector, domains, brands, services }], keywords: {strong: string[], normal: string[]}, government_cues: string[] }` |
| GET | `/api/gallery` | `[{ id, name, domain, entity, screenshot_url }]` reference pages |
| GET | `/api/gallery/{id}/screenshot` | `image/png` |
| GET | `/api/connectors` | `[{ channel, name, description, targets: string[], mode }]` |

## Demo / presenter controls

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/demo` | | `DemoState` |
| POST | `/api/demo/start` | `{ speed?: number }` | `DemoState` |
| POST | `/api/demo/stop` | | `DemoState` |
| POST | `/api/demo/reset` | | `DemoState` (wipes cases/candidates/reports, keeps registry) |
| POST | `/api/demo/inject` | `{ domain: string, issuer?: string }` | `{ injected: true }` plants a certificate in the live feed now |
| POST | `/api/demo/step` | `{ step_id: string }` | `DemoState` fires a scenario step immediately |

```ts
type DemoState = { available: boolean; running: boolean; speed: number; started_at: string|null; elapsed_s: number;
                   sites_url: string; steps: [{ id: string; at_s: number; kind: "cert"|"report"|"activate"|"note"; label: string; fired: boolean; fired_at: string|null }] };
```

## WebSocket `/ws`

Server pushes `{ type: string, at: string, data: any }`. On connect: `{ type: "hello", data: { history: Event[] } }` with the
last ~300 non-cert events so a late dashboard catches up.

| type | data | notes |
|---|---|---|
| `cert` | `CertEntry` | high volume (up to hundreds/s in live mode); not in history. Render a rolling ticker, keep ~150. |
| `candidate` | `Candidate` | a name passed the filter |
| `verification` | `{ candidate_id, domain, stage, message }` | stage: `queued, opening, captured, analysing, scored, evidence, done, error, recheck` |
| `case` | `CaseSummary` | created or updated |
| `evidence` | `{ case_id, evidence_id, artifacts: number, merkle_root, timestamp_kind }` | |
| `action` | `Action` | status transitions (pending → sent → acknowledged → completed) |
| `report` | `Report` | |
| `campaign` | `Campaign` | |
| `metrics` | `Metrics` | every ~5 s |
| `audit` | `AuditEntry` | |
| `demo` | `{ step_id, label, kind }` | a scenario step fired |
| `status` | status object (as `/api/status`) | every ~10 s |
