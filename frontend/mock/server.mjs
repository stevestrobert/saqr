#!/usr/bin/env node
// SAQR mock backend — implements docs/api.md with realistic fake data so the dashboard can be developed and
// demonstrated without the Python pipeline. `npm run mock` → http://localhost:8000 (REST under /api, events on /ws).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { ENTITIES, bestMatch, matchDomain, protectedRegistryResponse, isFreeCA, RISKY_TLDS, splitDomain, toUnicode } from './registry.mjs';
import { Feed } from './feed.mjs';
import { renderPage, renderThumb } from './png.mjs';
import { buildZip } from './zip.mjs';
import { BENIGN, CONNECTORS, ENTITY_SHORT, FAKES, PARKED, REFERENCES, bankForIban, lureKind } from './sites.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8000);
const THRESHOLD = 35;
const BASELINE_TTI_MIN = 9 * 60;
const BASELINE_EXPOSURE_MIN = 48 * 60;
const ENCODER = { name: 'dino', model: 'facebook/dinov3-vits16-pretrain-lvd1689m', dims: 384 };
const DIST = path.resolve(__dirname, '..', 'dist');
const START = new Date();

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const newId = (p) => `${p}_${randomBytes(5).toString('hex')}`;
const iso = (d) => (d instanceof Date ? d : new Date(d)).toISOString();
const ago = (ms) => new Date(Date.now() - ms);
const MIN = 60_000;
const minutesBetween = (a, b) => (a && b ? Math.max(0, (new Date(b) - new Date(a)) / MIN) : null);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round1 = (x) => (x === null ? null : Math.round(x * 10) / 10);
const canonical = (o) => JSON.stringify(o, Object.keys(o).sort());
const shortIssuer = (i) => i.split(' (')[0].replace(/,? Inc\.?$/, '');

// ------------------------------------------------------------------------------------------------ state
const S = {
  certsSeenBase: 284_311,
  filteredBase: 49,
  certs: [], // newest first, ≤ 400
  certTimes: [],
  certCount: 0,
  filtered: 0,
  planted: 0,
  candidates: new Map(),
  cases: new Map(),
  evidence: new Map(),
  actions: new Map(),
  reports: new Map(),
  campaigns: new Map(),
  audit: [],
  history: [],
  activated: new Set(),
  renderOpts: new Map(), // case id → renderer options
  timers: new Set(),
  demo: { running: false, speed: 1, startedAt: null, elapsedBase: 0, steps: [] },
};
const feed = new Feed(20261027);

// ------------------------------------------------------------------------------------------------ websocket
const wss = new WebSocketServer({ noServer: true });
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'hello', at: iso(new Date()), data: { history: S.history } }));
});
function emit(type, data, keep = true) {
  const ev = { type, at: iso(new Date()), data };
  if (keep) {
    S.history.push(ev);
    if (S.history.length > 300) S.history.shift();
  }
  const msg = JSON.stringify(ev);
  for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
  return ev;
}
const delay = (ms) => ms / Math.max(0.25, S.demo.speed);
function later(ms, fn) {
  const t = setTimeout(() => {
    S.timers.delete(t);
    try {
      fn();
    } catch (e) {
      console.error('[mock] timer error', e);
    }
  }, ms);
  S.timers.add(t);
  return t;
}

// ------------------------------------------------------------------------------------------------ audit (hash chain)
function audit(actor, action, subject, detail = {}, at = new Date()) {
  const prev = S.audit.length ? S.audit[S.audit.length - 1].hash : '0'.repeat(64);
  const seq = S.audit.length + 1;
  const e = { seq, at: iso(at), actor, action, subject, detail, prev_hash: prev, hash: '' };
  e.hash = sha256(prev + canonical({ seq, at: e.at, actor, action, subject, detail: canonical(detail) }));
  S.audit.push(e);
  emit('audit', e);
  return e;
}
function verifyAudit() {
  let prev = '0'.repeat(64);
  for (const e of S.audit) {
    const h = sha256(prev + canonical({ seq: e.seq, at: e.at, actor: e.actor, action: e.action, subject: e.subject, detail: canonical(e.detail) }));
    if (e.prev_hash !== prev || h !== e.hash) return { valid: false, length: S.audit.length, broken_at: e.seq };
    prev = e.hash;
  }
  return { valid: true, length: S.audit.length, broken_at: null };
}

// ------------------------------------------------------------------------------------------------ profiles
function refById(id) {
  return REFERENCES.find((r) => r.id === id);
}
function entityById(id) {
  return ENTITIES.find((e) => e.id === id);
}
/** Resolve what the isolated browser "sees" for a domain. */
function profileFor(domain, match) {
  if (FAKES[domain]) return { kind: 'fake', ...FAKES[domain] };
  if (PARKED[domain]) return S.activated.has(domain) ? { kind: 'fake', ...PARKED[domain].activatedAs } : { kind: 'inactive', entityId: PARKED[domain].entityId, ref: PARKED[domain].ref };
  if (BENIGN[domain]) return { kind: 'benign', ...BENIGN[domain] };
  const score = match?.score ?? 0;
  const ent = ENTITIES.find((e) => e.name === match?.protected_entity) ?? null;
  const ref = REFERENCES.find((r) => ent && r.entity === ent.name) ?? REFERENCES[0];
  if (score >= 80) {
    const base = FAKES['salik-recharge-ae.com'];
    const short = ent ? (ENTITY_SHORT[ent.id] ?? ent.name) : 'Government';
    return {
      kind: 'fake',
      ...base,
      title: `${short} — Online Payment`,
      entityId: ent?.id ?? 'uae',
      ref: ref.id,
      verdict: 'confirmed_fake',
      risk: 80 + Math.min(15, Math.round((score - 80) / 2)),
      confidence: 0.9,
      components: { visual: 0.86, logo: 0.88, text: 0.74, form: 0.95, domain: Math.min(1, score / 100) },
      similarity: 0.86,
      ssim: 0.7,
      lure: `${short}: outstanding payment — settle now to avoid a penalty`,
      text: `${short} · Online payment\nAn outstanding amount of AED 240.00 must be settled within 24 hours to avoid a penalty.\nName on card · Card number · Expiry · CVV\nPay now`,
      textSignals: { brand_mentions: [short], payment_terms: ['pay now', 'card number', 'cvv', 'penalty'], urgency_terms: ['within 24 hours'], arabic_ratio: 0.0, gov_claims: [short.toLowerCase()], score: 0.74 },
      iocs: {},
      infra: { ip: `45.${90 + (score % 40)}.${score}.${(score * 7) % 250}`, asn: 'AS9009', org: 'M247 Europe SRL', country: 'RO', registrar: 'NameCheap, Inc.', createdDaysAgo: 1, ns: ['dns1.registrar-servers.com', 'dns2.registrar-servers.com'], hostAbuse: 'abuse@m247.com', regAbuse: 'abuse@namecheap.com' },
      explanations: [`Clone of ${ref.domain} (visual similarity 0.86) reusing the ${short} logo.`, 'Collects full card details on-page.', `Look-alike score ${score}: ${match?.reasons?.slice(0, 2).map((r) => r.detail).join('; ') ?? ''}`],
      recommended: 'Block everywhere and request suspension.',
    };
  }
  if (score >= 60) {
    const base = FAKES['moi-uae-fines-pay.com'];
    const short = ent ? (ENTITY_SHORT[ent.id] ?? ent.name) : 'Government';
    return { kind: 'fake', ...base, title: `${short} — e-Services`, entityId: ent?.id ?? 'uae', ref: ref.id, verdict: 'suspicious', risk: 50 + Math.round((score - 60) / 2), confidence: 0.7, lure: `${short} services lookup`, text: `${short} e-Services\nEnter your Emirates ID and mobile number to look up outstanding amounts.\nEmirates ID · Mobile number\nCheck now`, explanations: [`Text claims to be ${short} but the layout differs from ${ref.domain} (visual similarity 0.58).`, 'Collects Emirates ID and mobile number; no card fields yet.', `Look-alike score ${score}.`] };
  }
  if (score >= THRESHOLD && RISKY_TLDS.has(splitDomain(domain).suffix.split('.').pop() ?? '')) return { kind: 'inactive', entityId: ent?.id ?? null, ref: ref.id };
  return { kind: 'benign', title: `${domain} — business site`, verdict: 'benign', risk: 12, confidence: 0.8, components: { visual: 0.1, logo: 0, text: 0.05, form: 0.1, domain: Math.min(1, score / 100) }, text: `Welcome to ${domain}. Ordinary business website with no government claims.`, fields: [], palette: [60, 120, 200], explanations: ['No visual, logo or text similarity to any protected page.', 'No payment fields.'], infra: { ip: '104.21.9.12', asn: 'AS13335', org: 'Cloudflare, Inc. (proxy)', country: 'US', registrar: 'GoDaddy.com, LLC', createdDaysAgo: 300 } };
}

// ------------------------------------------------------------------------------------------------ summaries
function actionSummary(caseId) {
  const acts = [...S.actions.values()].filter((a) => a.case_id === caseId);
  const count = (st) => acts.filter((a) => a.status === st).length;
  return { total: acts.length, sent: count('sent'), acknowledged: count('acknowledged'), completed: count('completed'), failed: count('failed'), blocking_confirmed: acts.some((a) => a.blocks_exposure && (a.status === 'acknowledged' || a.status === 'completed')) };
}
function summaryOf(k) {
  const v = k.verdict;
  const top = v.visual[0] ?? null;
  const ent = S.candidates.get(k.candidate_id)?.match ?? null;
  return {
    id: k.id,
    domain: k.domain,
    url: k.url,
    state: k.state,
    source: k.source,
    created_at: k.created_at,
    issued_at: k.issued_at,
    detected_at: k.detected_at,
    verified_at: k.verified_at,
    approved_at: k.approved_at,
    approved_by: k.approved_by,
    blocked_at: k.blocked_at,
    taken_down_at: k.taken_down_at,
    verdict: {
      label: v.label,
      risk: v.risk,
      confidence: v.confidence,
      encoder: v.encoder,
      components: { visual: v.components.visual ?? 0, logo: v.components.logo ?? 0, text: v.components.text ?? 0, form: v.components.form ?? 0, domain: v.components.domain ?? 0 },
      top_visual: top ? { reference_id: top.reference_id, reference_name: top.reference_name, reference_domain: top.reference_domain, similarity: top.similarity, ssim: top.ssim } : null,
      form_summary: v.form.summary,
      explanations: v.explanations,
    },
    protected_entity: ent?.protected_entity ?? k._entity ?? null,
    protected_domain: ent?.protected_domain ?? k._protectedDomain ?? null,
    lookalike_score: ent?.score ?? v.domain.lookalike_score,
    campaign_id: k.campaign_id,
    report_count: k.report_ids.length,
    action_summary: actionSummary(k.id),
    screenshot_url: `/api/cases/${k.id}/screenshot?view=desktop`,
    thumbnail_url: `/api/cases/${k.id}/screenshot?view=desktop&thumb=1`,
    mobile_screenshot_url: k.capture.screenshot_mobile ? `/api/cases/${k.id}/screenshot?view=mobile` : null,
    has_evidence: Boolean(k.evidence_id),
    evidence_id: k.evidence_id,
    minutes_to_identify: round1(minutesBetween(k.issued_at, k.detected_at)),
    minutes_to_verify: round1(minutesBetween(k.detected_at, k.verified_at)),
    minutes_exposure: round1(minutesBetween(k.detected_at, k.blocked_at ?? k.taken_down_at)),
    title: k.capture.title,
  };
}
const emitCase = (k) => emit('case', summaryOf(k));
const publicCase = (k) => {
  const { _entity, _protectedDomain, ...rest } = k;
  return rest;
};

// ------------------------------------------------------------------------------------------------ case building
function buildCase({ candidate, profile, now, times = {} }) {
  const id = newId('case');
  const kind = profile.kind;
  const ref = refById(profile.ref) ?? REFERENCES[0];
  const ent = profile.entityId ? entityById(profile.entityId) : null;
  const match = candidate.match;
  const detected = times.detected ?? now;
  const verified = times.verified ?? new Date(detected.getTime() + delay(6800));
  const parts = splitDomain(candidate.domain);
  const tld = parts.suffix.split('.').pop();
  const issuer = profile.issuer ?? "Let's Encrypt (R12)";
  const certAgeH = candidate.issued_at ? Math.max(0.02, (detected - new Date(candidate.issued_at)) / 3600_000) : null;
  const fields = profile.fields ?? [];
  const cats = [...new Set(fields.map((x) => x.category))];
  const collects = (c) => cats.includes(c);
  const formRisk = collects('card_number') || collects('cvv') ? 1.0 : collects('otp') || collects('password') ? 0.95 : collects('emirates_id') ? 0.45 : fields.length ? 0.3 : 0.0;
  const formSummary =
    kind === 'inactive'
      ? 'No page content captured (parked / unreachable)'
      : fields.length === 0
        ? 'No input fields'
        : `Collects ${cats.filter((c) => c !== 'other').join(', ')}${collects('card_number') ? ' — full card data on-page' : ''}${collects('otp') ? ' plus OTP' : ''}`;
  const text = kind === 'inactive' ? '' : profile.text ?? '';
  const infra = profile.infra ?? { ip: '203.0.113.10', asn: 'AS64500', org: 'Example Hosting', country: 'XX', registrar: 'Example Registrar', createdDaysAgo: 1 };
  const fingerprint = sha256(`${candidate.domain}|${issuer}`);

  const verdict = {
    label: kind === 'inactive' ? 'inactive' : profile.verdict,
    risk: kind === 'inactive' ? 30 : profile.risk,
    confidence: kind === 'inactive' ? 0.55 : profile.confidence,
    components: kind === 'inactive' ? { visual: 0, logo: 0, text: 0, form: 0, domain: Math.min(1, (match?.score ?? 40) / 100) } : profile.components,
    explanations:
      kind === 'inactive'
        ? [`Domain looks like ${ent?.name ?? 'a protected entity'} (score ${match?.score ?? '—'}) but served a parking page with no content.`, 'Re-checked periodically; promoted to a case the moment a page appears.']
        : profile.explanations ?? [],
    recommended_action: kind === 'inactive' ? 'Monitor and re-check' : profile.recommended ?? (profile.verdict === 'benign' ? 'Close' : 'Analyst review'),
    visual: kind === 'inactive' || kind === 'benign' ? (kind === 'benign' ? [{ reference_id: ref.id, reference_name: ref.name, reference_domain: ref.domain, similarity: profile.components.visual, ssim: Math.max(0, profile.components.visual - 0.05), encoder: ENCODER.name }] : []) : [{ reference_id: ref.id, reference_name: ref.name, reference_domain: ref.domain, similarity: profile.similarity, ssim: profile.ssim, encoder: ENCODER.name }, { reference_id: 'ref_moi', reference_name: 'Ministry of Interior · Traffic Fines Payment', reference_domain: 'moi.gov.ae', similarity: Math.max(0.2, profile.similarity - 0.41), ssim: null, encoder: ENCODER.name }],
    logos: kind === 'fake' && profile.logoScore ? [{ reference_id: ref.id, reference_domain: ref.domain, score: profile.logoScore, bbox: [140, 44, 56, 40], scale: 1.0, }] : [],
    text: profile.textSignals ?? { brand_mentions: [], payment_terms: [], urgency_terms: [], arabic_ratio: 0, gov_claims: [], score: profile.components?.text ?? 0 },
    form: { categories: cats, collects_card: collects('card_number'), collects_cvv: collects('cvv'), collects_otp: collects('otp'), collects_identity: collects('emirates_id'), collects_credentials: collects('password'), external_action_hosts: profile.formAction && !profile.formAction.includes(candidate.domain) ? [new URL(profile.formAction).host] : [], risk: formRisk, summary: formSummary },
    domain: { lookalike_score: match?.score ?? 0, reasons: (match?.reasons ?? []).slice(0, 4).map((r) => r.detail), cert_age_hours: certAgeH === null ? null : Math.round(certAgeH * 100) / 100, free_ca: isFreeCA(issuer), risky_tld: RISKY_TLDS.has(tld), idn_homoglyph: Boolean(match && match.unicode_domain !== match.domain), score: Math.min(1, (match?.score ?? 0) / 100) },
    encoder: ENCODER.name === 'dino' ? 'DINOv3 ViT-S/16' : 'perceptual',
    decided_at: iso(verified),
  };

  const capture = {
    captured_at: iso(new Date(detected.getTime() + delay(3200))),
    requested_url: candidate.url,
    final_url: kind === 'inactive' ? candidate.url : candidate.url,
    redirects: [],
    status: kind === 'inactive' ? 200 : 200,
    ok: true,
    error: kind === 'inactive' ? 'registrar parking page (no application content)' : '',
    title: kind === 'inactive' ? `${candidate.domain} — parked` : profile.title,
    lang: kind === 'inactive' ? '' : profile.lang ?? 'en',
    text,
    text_length: text.length,
    screenshot_desktop: `captures/${id}/desktop.png`,
    screenshot_mobile: `captures/${id}/mobile.png`,
    html_path: `captures/${id}/page.html`,
    har_path: `captures/${id}/network.har`,
    forms: fields.length ? [{ action: profile.formAction ?? `https://${candidate.domain}/submit`, method: 'POST', fields, submit_text: profile.submit ?? 'Submit' }] : [],
    external_hosts: kind === 'fake' ? ['fonts.googleapis.com', 'cdn.jsdelivr.net', 'api.telegram.org'] : ['fonts.googleapis.com'],
    resource_count: kind === 'inactive' ? 6 : 42,
    meta: { viewport: '1280x800', 'og:title': kind === 'inactive' ? '' : profile.title },
    tls: {
      issuer,
      subject: `CN=${candidate.domain}`,
      valid_from: candidate.issued_at ? iso(new Date(new Date(candidate.issued_at).getTime() - 3600_000)) : iso(ago(2 * 3600_000)),
      valid_to: iso(new Date((candidate.issued_at ? new Date(candidate.issued_at) : new Date()).getTime() + 90 * 86400_000)),
      protocol: 'TLSv1.3',
      sans: [candidate.domain, `www.${candidate.domain}`],
      fingerprint_sha256: fingerprint,
    },
    headers: { server: kind === 'inactive' ? 'nginx' : 'cloudflare', 'content-type': 'text/html; charset=utf-8' },
    ip: infra.ip,
    resolved_via: FAKES[candidate.domain] || PARKED[candidate.domain] || BENIGN[candidate.domain] ? 'demo-override' : 'dns',
    duration_ms: kind === 'inactive' ? 1840 : 4260,
  };

  const state = kind === 'inactive' ? 'monitoring' : kind === 'benign' ? 'closed' : 'open';
  const k = {
    id,
    candidate_id: candidate.id,
    domain: candidate.domain,
    url: candidate.url,
    source: candidate.source,
    state,
    created_at: iso(verified),
    issued_at: candidate.issued_at,
    detected_at: iso(detected),
    verified_at: iso(verified),
    approved_at: null,
    approved_by: null,
    blocked_at: null,
    taken_down_at: null,
    verdict,
    capture,
    evidence_id: null,
    campaign_id: null,
    report_ids: [...candidate.report_ids],
    iocs: profile.iocs ?? {},
    timeline: [],
    analyst_note: '',
    _entity: ent?.name ?? match?.protected_entity ?? null,
    _protectedDomain: ent?.domains?.[0] ?? match?.protected_domain ?? null,
    _infra: infra,
    _issuer: issuer,
    _fingerprint: fingerprint,
  };
  if (candidate.issued_at) k.timeline.push({ at: candidate.issued_at, kind: 'issued', title: 'Certificate logged', detail: `${profile.log ?? 'CT log'} · ${issuer}`, actor: 'system' });
  k.timeline.push({ at: iso(detected), kind: 'detected', title: 'Passed look-alike filter', detail: `score ${match?.score ?? '—'}`, actor: 'system' });
  k.timeline.push({ at: capture.captured_at, kind: 'verifying', title: 'Captured in isolated browser', detail: `${capture.title}`, actor: 'system' });
  k.timeline.push({ at: iso(verified), kind: 'verified', title: `Verdict: ${verdict.label} (risk ${verdict.risk})`, detail: verdict.explanations[0] ?? '', actor: 'system' });
  S.renderOpts.set(id, { kind: kind === 'fake' ? 'fake' : kind === 'benign' ? 'benign' : 'parked', palette: profile.palette ?? ref.palette, seed: parseInt(id.slice(-4), 16) || 7 });
  return k;
}

function merkleRoot(hashes) {
  let layer = [...hashes];
  if (!layer.length) return '';
  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) next.push(sha256(layer[i] + (layer[i + 1] ?? layer[i])));
    layer = next;
  }
  return layer[0];
}

function buildEvidence(k, now) {
  const id = newId('evd');
  const infra = k._infra;
  const names = [
    ['screenshot_desktop.png', 'image/png', 184_322, 'Above-the-fold desktop capture (1280×800)'],
    ['screenshot_mobile.png', 'image/png', 96_118, 'Mobile capture (390×844)'],
    ['page.html', 'text/html', 48_212, 'Rendered DOM after load'],
    ['network.har', 'application/json', 212_480, 'HTTP archive of the visit'],
    ['dns.json', 'application/json', 1_204, 'A/AAAA/NS/MX answers from 1.1.1.1 and 8.8.8.8'],
    ['rdap.json', 'application/json', 6_410, 'Registrar RDAP record'],
    ['certificate.pem', 'application/x-pem-file', 2_118, 'Leaf certificate as served'],
    ['ct_entry.json', 'application/json', 812, 'Certificate-transparency log entry'],
    ['hosting.json', 'application/json', 944, 'IP, ASN and abuse contact'],
    ['manifest.json', 'application/json', 2_480, 'Artifact list with SHA-256 hashes'],
  ];
  const artifacts = names.map(([name, mime, size, description]) => ({ name, path: `evidence/${k.id}/${name}`, sha256: sha256(`${k.id}:${name}`), size, mime, description }));
  const root = merkleRoot(artifacts.map((a) => a.sha256));
  const manifestSha = sha256(JSON.stringify(artifacts));
  const t0 = new Date(now.getTime() - 1200);
  const created = new Date(now.getTime() + 2000);
  const ev = {
    id,
    case_id: k.id,
    domain: k.domain,
    created_at: iso(created),
    directory: `evidence/${k.id}`,
    zip_path: `evidence/${k.id}.zip`,
    zip_sha256: sha256(`${k.id}:zip`),
    artifacts,
    merkle_root: root,
    manifest_sha256: manifestSha,
    timestamp: { kind: 'rfc3161', authority: 'FreeTSA (freetsa.org)', time: iso(created), token_path: `evidence/${k.id}/timestamp.tsr`, digest: manifestSha, verified: true, note: 'SHA-256 of manifest.json, RFC 3161 token verified against the TSA certificate' },
    custody: [
      { at: k.capture.captured_at, actor: 'saqr-verifier', event: 'Capture completed', detail: 'isolated Chromium, proxy exit NL', hash: artifacts[0].sha256 },
      { at: iso(t0), actor: 'saqr-evidence', event: 'Artifacts hashed', detail: `${artifacts.length} files · SHA-256`, hash: manifestSha },
      { at: iso(new Date(t0.getTime() + 600)), actor: 'saqr-evidence', event: 'Merkle root sealed', detail: '', hash: root },
      { at: iso(created), actor: 'freetsa.org', event: 'RFC 3161 timestamp obtained', detail: 'token verified', hash: manifestSha },
    ],
    dns: { a: [infra.ip], aaaa: [], ns: infra.ns ?? [], mx: [], resolver: '1.1.1.1', ttl: 300 },
    registration: { registrar: infra.registrar, created: iso(ago((infra.createdDaysAgo ?? 1) * 86400_000 + 3600_000 * 7)), expires: iso(new Date(Date.now() + 365 * 86400_000)), status: ['clientTransferProhibited'], registrant_country: 'IS (privacy proxy)', abuse_email: infra.regAbuse ?? 'abuse@registrar.example', source: 'RDAP (rdap.org)' },
    hosting: { ip: infra.ip, asn: infra.asn, org: infra.org, country: infra.country, abuse_contact: infra.hostAbuse ?? 'abuse@hosting.example', reverse_dns: '' },
    certificate: { issuer: k._issuer, subject: `CN=${k.domain}`, not_before: k.capture.tls.valid_from, not_after: k.capture.tls.valid_to, fingerprint_sha256: k._fingerprint, sans: k.capture.tls.sans, serial: k._fingerprint.slice(0, 32).toUpperCase().replace(/(..)/g, '$1:').slice(0, -1) },
    ct_entry: S.candidates.get(k.candidate_id)?.cert_id ? ctEntryFor(S.candidates.get(k.candidate_id).cert_id, k) : {},
    iocs: k.iocs,
    tool_versions: { saqr: '0.1.0', playwright: '1.47.0', chromium: '129.0.6668.29', encoder: ENCODER.model, tsa_client: 'rfc3161ng 2.1.3' },
  };
  return ev;
}
function ctEntryFor(certId, k) {
  const c = S.certs.find((x) => x.id === certId) ?? S._certIndex?.get(certId);
  if (!c) return { id: certId, log: 'Google Argon 2026h2', index: null };
  return { id: c.id, log: c.log, index: c.index, issued_at: c.issued_at, is_precert: c.is_precert, fingerprint: c.fingerprint, issuer: c.issuer, domains: c.domains, url_hint: k.url };
}

// ------------------------------------------------------------------------------------------------ campaigns
const lureSignature = (text) => {
  const t = text.toLowerCase().replace(/https?:\/\/\S+|\S+\.(com|net|org|shop|online|site|top|xyz|ae)\S*/g, ' ').replace(/\d+([.,]\d+)?/g, ' # ');
  const stop = new Set('the a an to of for your you is are be has have will on in at by and or with this that from it as we our please now within hours hour day days aed dhs amount link click here via visit'.split(' '));
  const words = (t.match(/[a-z؀-ۿ#]+/g) ?? []).filter((w) => !stop.has(w) && w.length > 1);
  const s = new Set(words);
  for (let i = 0; i < words.length - 1; i++) s.add(`${words[i]} ${words[i + 1]}`);
  return s;
};
const jaccard = (a, b) => (a.size && b.size ? [...a].filter((x) => b.has(x)).length / new Set([...a, ...b]).size : 0);

function assignCampaign(report, entityName, now) {
  let camp = [...S.campaigns.values()].find((c) => c.domains.some((d) => report.domains.includes(d)));
  if (!camp) {
    const sig = lureSignature(report.text);
    let best = null;
    for (const c of S.campaigns.values()) {
      const score = jaccard(sig, lureSignature(c.pattern));
      const sameEntity = entityName && c.entity === entityName;
      if ((sameEntity && score >= 0.12) || score >= 0.35) if (!best || score > best[1]) best = [c, score];
    }
    camp = best?.[0] ?? null;
  }
  if (!camp) {
    const ent = ENTITIES.find((e) => e.name === entityName);
    const short = ent ? (ENTITY_SHORT[ent.id] ?? ent.name) : 'Unknown brand';
    camp = { id: newId('camp'), name: `${short} ${lureKind(report.text)} lure`, created_at: iso(now), last_seen: iso(now), report_ids: [], domains: [], case_ids: [], pattern: report.text, infrastructure: {}, entity: entityName ?? null, status: 'active' };
    S.campaigns.set(camp.id, camp);
  }
  if (!camp.report_ids.includes(report.id)) camp.report_ids.push(report.id);
  for (const d of report.domains) if (!camp.domains.includes(d)) camp.domains.push(d);
  camp.last_seen = iso(now);
  report.campaign_id = camp.id;
  for (const k of S.cases.values()) if (camp.domains.includes(k.domain)) linkCaseToCampaign(k, camp);
  emit('campaign', camp);
  return camp;
}
function addInfra(camp, key, value) {
  if (!value) return;
  camp.infrastructure[key] = camp.infrastructure[key] ?? [];
  if (!camp.infrastructure[key].includes(value)) camp.infrastructure[key].push(value);
}
function linkCaseToCampaign(k, camp) {
  if (!camp.case_ids.includes(k.id)) camp.case_ids.push(k.id);
  if (!camp.domains.includes(k.domain)) camp.domains.push(k.domain);
  k.campaign_id = camp.id;
  addInfra(camp, 'ips', k._infra?.ip);
  addInfra(camp, 'asns', k._infra?.asn);
  addInfra(camp, 'registrars', k._infra?.registrar);
  addInfra(camp, 'issuers', shortIssuer(k._issuer ?? ''));
  if (!camp.entity && k._entity) camp.entity = k._entity;
  const allBlocked = camp.case_ids.every((id) => ['blocked', 'taken_down'].includes(S.cases.get(id)?.state));
  camp.status = allBlocked && camp.case_ids.length ? 'contained' : 'active';
}
function onCaseCreated(k) {
  for (const camp of S.campaigns.values()) {
    if (camp.domains.includes(k.domain)) {
      linkCaseToCampaign(k, camp);
      emit('campaign', camp);
    }
  }
  for (const r of S.reports.values()) if (r.domains.includes(k.domain) && !k.report_ids.includes(r.id)) k.report_ids.push(r.id);
}

// ------------------------------------------------------------------------------------------------ pipeline
function createCandidate({ domain, url, source, issued_at, cert_id, match, report_ids = [], now = new Date() }) {
  const existing = [...S.candidates.values()].find((c) => c.domain === domain && c.status !== 'dismissed');
  if (existing) {
    for (const r of report_ids) if (!existing.report_ids.includes(r)) existing.report_ids.push(r);
    return existing;
  }
  const cand = { id: newId('cand'), domain, url, source, status: 'queued', first_seen: iso(now), issued_at: issued_at ?? null, cert_id: cert_id ?? null, report_ids: [...report_ids], match, recheck_count: 0, next_recheck_at: null, case_id: null, note: '' };
  S.candidates.set(cand.id, cand);
  emit('candidate', cand);
  audit('pipeline', 'candidate.detected', domain, { score: match?.score ?? null, source, entity: match?.protected_entity ?? null });
  later(delay(400), () => verify(cand));
  return cand;
}

function verify(cand, { recheck = false } = {}) {
  const now = () => new Date();
  const stage = (st, message) => emit('verification', { candidate_id: cand.id, domain: cand.domain, stage: st, message });
  cand.status = 'verifying';
  emit('candidate', cand);
  stage('queued', recheck ? `re-check #${cand.recheck_count + 1}` : 'waiting for an isolated browser slot');
  later(delay(900), () => stage('opening', `GET ${cand.url} in isolated Chromium (proxy exit NL, no cookies)`));
  later(delay(3200), () => {
    const p = profileFor(cand.domain, cand.match);
    stage('captured', p.kind === 'inactive' ? 'HTTP 200 · registrar parking page · 6 resources' : `HTTP 200 · "${p.title}" · 2 screenshots, DOM, HAR`);
  });
  later(delay(4600), () => stage('analysing', `embedding vs ${REFERENCES.length} reference pages · logo search · form and text analysis`));
  later(delay(6800), () => {
    const p = profileFor(cand.domain, cand.match);
    const t = now();
    const existingCase = cand.case_id ? S.cases.get(cand.case_id) : null;
    let k;
    if (existingCase && recheck && p.kind !== 'inactive') {
      // a monitored page went live: promote the existing case in place
      const fresh = buildCase({ candidate: cand, profile: p, now: new Date(existingCase.detected_at), times: { detected: new Date(existingCase.detected_at), verified: t } });
      Object.assign(existingCase, { verdict: fresh.verdict, capture: fresh.capture, state: fresh.state, verified_at: iso(t), iocs: fresh.iocs, _entity: fresh._entity, _protectedDomain: fresh._protectedDomain, _infra: fresh._infra, _issuer: fresh._issuer, _fingerprint: fresh._fingerprint });
      existingCase.timeline.push({ at: iso(t), kind: 'recheck', title: `Page went live — verdict ${fresh.verdict.label}`, detail: fresh.verdict.explanations[0] ?? '', actor: 'system' });
      S.renderOpts.set(existingCase.id, S.renderOpts.get(fresh.id));
      k = existingCase;
    } else if (existingCase && recheck) {
      cand.recheck_count += 1;
      cand.next_recheck_at = iso(new Date(Date.now() + 90_000));
      cand.status = 'rechecking';
      existingCase.timeline.push({ at: iso(t), kind: 'recheck', title: `Re-check #${cand.recheck_count}: still inactive`, detail: 'parking page', actor: 'system' });
      stage('scored', `inactive · still parked · next re-check in 90 s`);
      emit('candidate', cand);
      emitCase(existingCase);
      later(delay(800), () => stage('recheck', `re-check #${cand.recheck_count + 1} scheduled`));
      return;
    } else {
      k = buildCase({ candidate: cand, profile: p, now: new Date(cand.first_seen), times: { detected: new Date(cand.first_seen), verified: t } });
      S.cases.set(k.id, k);
      cand.case_id = k.id;
      onCaseCreated(k);
    }
    cand.status = p.kind === 'inactive' ? 'rechecking' : 'verified';
    if (p.kind === 'inactive') {
      cand.recheck_count += recheck ? 1 : 0;
      cand.next_recheck_at = iso(new Date(Date.now() + 90_000));
    }
    emit('candidate', cand);
    stage('scored', `${k.verdict.label} · risk ${k.verdict.risk} · nearest ${k.verdict.visual[0]?.reference_domain ?? '—'}`);
    audit('pipeline', 'case.verdict', k.domain, { case_id: k.id, verdict: k.verdict.label, risk: k.verdict.risk, encoder: k.verdict.encoder });
    emitCase(k);
    if (k.verdict.label === 'confirmed_fake' || k.verdict.label === 'suspicious') {
      later(delay(800), () => stage('evidence', 'hashing 10 artifacts · Merkle root · RFC 3161 timestamp request'));
      later(delay(3700), () => {
        const ev = buildEvidence(k, now());
        S.evidence.set(ev.id, ev);
        k.evidence_id = ev.id;
        k.timeline.push({ at: ev.created_at, kind: 'evidence', title: 'Evidence package sealed', detail: `${ev.artifacts.length} artifacts · ${ev.timestamp.kind}`, actor: 'system' });
        emit('evidence', { case_id: k.id, evidence_id: ev.id, artifacts: ev.artifacts.length, merkle_root: ev.merkle_root, timestamp_kind: ev.timestamp.kind });
        audit('pipeline', 'evidence.sealed', k.domain, { case_id: k.id, evidence_id: ev.id, merkle_root: ev.merkle_root.slice(0, 16), timestamp: ev.timestamp.kind });
        emitCase(k);
        stage('done', 'case ready for analyst review');
      });
    } else {
      later(delay(600), () => stage('done', p.kind === 'inactive' ? 'monitoring — re-check scheduled in 90 s' : 'benign — case closed'));
      if (p.kind === 'inactive') later(delay(1200), () => stage('recheck', 're-check #1 scheduled'));
    }
  });
}

function onCert(entry, { planted = false } = {}) {
  const m = bestMatch(entry.domains, THRESHOLD);
  if (m) {
    entry.match_score = m.allowlisted ? 0 : m.score;
    entry.matched_domain = m.domain;
    entry.allowlisted = m.allowlisted;
  }
  S.certCount += 1;
  if (planted) S.planted += 1;
  S.certTimes.push(Date.now());
  if (S.certTimes.length > 2000) S.certTimes.splice(0, S.certTimes.length - 2000);
  S.certs.unshift(entry);
  if (S.certs.length > 400) S.certs.length = 400;
  (S._certIndex ??= new Map()).set(entry.id, entry);
  emit('cert', entry, false);
  if (m && !m.allowlisted && m.is_candidate) {
    S.filtered += 1;
    createCandidate({ domain: m.domain, url: `https://${m.domain}/`, source: 'ct_log', issued_at: entry.issued_at, cert_id: entry.id, match: m });
  }
}

function injectCert(domain, issuer) {
  const d = domain.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const prof = FAKES[d] ?? PARKED[d]?.activatedAs ?? null;
  const entry = feed.entry([d, `www.${d}`], issuer ?? prof?.issuer ?? "Let's Encrypt (R12)", prof?.log ?? 'Google Argon 2026h2');
  entry.source = 'ct_log';
  onCert(entry, { planted: true });
  return entry;
}

// ------------------------------------------------------------------------------------------------ response
function dispatch(k, channels, actor, note, now = new Date()) {
  const infra = k._infra;
  const ent = k._entity ?? 'a UAE government service';
  const specs = [];
  const add = (channel, connector, target, request_summary, blocks_exposure = false) => specs.push({ channel, connector, target, request_summary, blocks_exposure });
  for (const ch of channels) {
    if (ch === 'registrar') add('registrar', 'registrar-abuse', `${infra.registrar} abuse desk`, `Suspend ${k.domain} — impersonation of ${ent}; evidence ${k.evidence_id ?? 'pending'}`);
    if (ch === 'hosting') add('hosting', 'hosting-abuse', `${infra.org} (${infra.asn})`, `Take down ${infra.ip} — phishing content for ${ent}`);
    if (ch === 'telecom') {
      add('telecom', 'telecom-etisalat', 'e& (Etisalat)', `Block ${k.domain} on mobile data + filter SMS senders`, true);
      add('telecom', 'telecom-du', 'du', `Block ${k.domain} on mobile data + filter SMS senders`, true);
    }
    if (ch === 'browser') {
      add('browser', 'browser-safe-browsing', 'Google Safe Browsing', `Submit ${k.url} as social engineering`, true);
      add('browser', 'browser-smartscreen', 'Microsoft SmartScreen', `Submit ${k.url} as phishing`, true);
    }
    if (ch === 'bank') {
      const ibans = k.iocs.ibans ?? [];
      if (ibans.length) for (const iban of ibans) add('bank', 'bank-fraud-desk', `${bankForIban(iban)} fraud desk`, `Freeze ${iban} — mule account for ${ent} impersonation`);
      else add('bank', 'cbuae-fraud-reporting', 'CBUAE fraud reporting', `Share indicators (${Object.values(k.iocs).flat().length} IOCs) with the banking sector`);
    }
    if (ch === 'certificate_authority') add('certificate_authority', 'ca-revocation', shortIssuer(k._issuer), `Revoke certificate ${k._fingerprint.slice(0, 16)}… (fraudulent use)`);
    if (ch === 'national_cert') add('national_cert', 'aecert-incident', 'aeCERT (TDRA)', `Incident report with evidence package ${k.evidence_id ?? ''}`);
  }
  const actions = specs.map((s) => ({ id: newId('act'), case_id: k.id, status: 'pending', payload: { domain: k.domain, url: k.url, evidence_id: k.evidence_id, approved_by: actor, note: note ?? '' }, receipt: '', created_at: iso(now), sent_at: null, acknowledged_at: null, completed_at: null, error: '', ...s }));
  for (const a of actions) {
    S.actions.set(a.id, a);
    emit('action', a);
  }
  audit(actor, 'actions.dispatched', k.domain, { case_id: k.id, channels, count: actions.length });
  progressActions(actions, k);
  return actions;
}

function progressActions(actions, k, speedy = false) {
  const base = speedy ? 0.4 : 1;
  for (const [i, a] of actions.entries()) {
    const jitter = Math.random();
    later(delay(base * (700 + i * 220 + jitter * 600)), () => {
      if (a.status !== 'pending') return;
      a.status = 'sent';
      a.sent_at = iso(new Date());
      a.receipt = `${a.connector.split('-')[0].toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;
      emit('action', a);
    });
    const fails = a.channel === 'registrar' && Math.random() < 0.08;
    later(delay(base * (3200 + i * 500 + jitter * 3000)), () => {
      if (a.status !== 'sent') return;
      if (fails) {
        a.status = 'failed';
        a.error = 'No response from abuse contact (timeout 30 s) — retry scheduled';
        emit('action', a);
        audit(a.target, 'action.failed', k.domain, { action_id: a.id, channel: a.channel, error: a.error });
        return;
      }
      a.status = 'acknowledged';
      a.acknowledged_at = iso(new Date());
      emit('action', a);
      audit(a.target, 'action.acknowledged', k.domain, { action_id: a.id, channel: a.channel, receipt: a.receipt });
      if (a.blocks_exposure && !k.blocked_at) {
        k.blocked_at = a.acknowledged_at;
        k.state = 'blocked';
        k.timeline.push({ at: k.blocked_at, kind: 'blocked', title: `Blocking confirmed by ${a.target}`, detail: a.request_summary, actor: a.target });
        audit(a.target, 'case.blocked', k.domain, { case_id: k.id, via: a.channel, exposure_minutes: round1(minutesBetween(k.detected_at, k.blocked_at)) });
        emitCase(k);
        for (const camp of S.campaigns.values()) if (camp.case_ids.includes(k.id)) linkCaseToCampaign(k, camp), emit('campaign', camp);
      }
    });
    later(delay(base * (9000 + i * 900 + jitter * 9000)), () => {
      if (a.status !== 'acknowledged') return;
      a.status = 'completed';
      a.completed_at = iso(new Date());
      emit('action', a);
      audit(a.target, 'action.completed', k.domain, { action_id: a.id, channel: a.channel });
      if (a.channel === 'registrar' && !k.taken_down_at) {
        k.taken_down_at = a.completed_at;
        k.state = 'taken_down';
        k.timeline.push({ at: k.taken_down_at, kind: 'taken_down', title: 'Domain suspended by registrar', detail: a.target, actor: a.target });
        audit(a.target, 'case.taken_down', k.domain, { case_id: k.id });
        emitCase(k);
      }
    });
  }
}

function approveCase(k, { actor, channels, note }) {
  const allow = matchDomain(k.domain).allowlisted;
  if (allow) return { error: 409, detail: `${k.domain} is an allow-listed official domain and can never be blocked` };
  if (k.state !== 'open') return { error: 409, detail: `case is ${k.state}, not open` };
  const now = new Date();
  k.state = 'approved';
  k.approved_at = iso(now);
  k.approved_by = actor;
  if (note) k.analyst_note = note;
  k.timeline.push({ at: iso(now), kind: 'approved', title: 'Approved by analyst — one-click response', detail: note ?? '', actor });
  audit(actor, 'case.approved', k.domain, { case_id: k.id, verdict: k.verdict.label, risk: k.verdict.risk, evidence_id: k.evidence_id, note: note ?? '' });
  emitCase(k);
  const chans = channels?.length ? channels : CONNECTORS.map((c) => c.channel);
  const actions = dispatch(k, chans, actor, note, now);
  emitCase(k);
  return { case: summaryOf(k), actions };
}

// ------------------------------------------------------------------------------------------------ reports
const URL_RE = /(?:(?:https?|hxxps?):\/\/)?(?:www\.)?(?:[a-z0-9؀-ۿ](?:[a-z0-9؀-ۿ-]{0,61}[a-z0-9؀-ۿ])?\.)+(?:[a-z]{2,24}|xn--[a-z0-9-]{2,})(?::\d{2,5})?(?:\/[^\s<>"'،]*)?/gi;
const defang = (t) => t.replace(/\[\.\]/g, '.').replace(/\(\.\)/g, '.').replace(/\[dot\]/gi, '.').replace(/hxxp/gi, 'http').replace(/\[:\]/g, ':');
function extractUrls(text) {
  const out = [];
  for (const m of defang(text).matchAll(URL_RE)) {
    const raw = m[0].replace(/[.,;:!?)»"'،۔]+$/, '');
    const host = raw.replace(/^(?:https?:\/\/)?(?:www\.)?/i, '').split('/')[0].split(':')[0].toLowerCase();
    if (['e.g', 'i.e', 'etc', 'a.m', 'p.m'].includes(host) || !host.includes('.')) continue;
    const p = splitDomain(host);
    if (!p.suffix || p.label.length < 2) continue;
    if (/^[\d.-]+$/.test(host)) continue;
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    if (!out.includes(url)) out.push(url);
  }
  return out;
}
const domainOf = (url) => url.replace(/^https?:\/\//i, '').split('/')[0].split('?')[0].split(':')[0].toLowerCase().replace(/^www\./, '');
const maskPhone = (s) => {
  const d = s.replace(/\D/g, '');
  return d.length < 6 ? (s ? '***' : 'unknown') : `+${d.slice(0, 3)} ${d.slice(3, 4)}* *** **${d.slice(-2)}`;
};
const scrub = (t) => t.replace(/784-?\d{4}-?\d{7}-?\d/g, '[EID]').replace(/(?<!\w)(?:\+?971|0)5\d[\s-]?\d{3}[\s-]?\d{4}(?!\w)/g, '[PHONE]');
const detectLang = (t) => {
  const ar = (t.match(/[؀-ۿ]/g) ?? []).length;
  const la = (t.match(/[A-Za-z]/g) ?? []).length;
  return ar && la ? (ar > la * 0.3 ? 'ar+en' : 'en') : ar ? 'ar' : 'en';
};

function createReport({ channel, text, sender }, now = new Date()) {
  const urls = extractUrls(text);
  const domains = [...new Set(urls.map(domainOf))];
  const report = { id: newId('rpt'), channel, text: scrub(text.trim()), sender_masked: sender ? maskPhone(sender) : '', reporter_ref: sender ? sha256(`saqr-reporter-v1:${sender.replace(/\D/g, '')}`).slice(0, 16) : '', received_at: iso(now), urls, domains, candidate_ids: [], campaign_id: null, language: detectLang(text) };
  S.reports.set(report.id, report);
  const candidates = [];
  let entityName = null;
  for (const d of domains) {
    const match = matchDomain(d, THRESHOLD);
    entityName = entityName ?? match.protected_entity;
    if (match.allowlisted) continue;
    const cand = createCandidate({ domain: d, url: urls.find((u) => domainOf(u) === d) ?? `https://${d}/`, source: 'citizen_report', match, report_ids: [report.id], now });
    report.candidate_ids.push(cand.id);
    candidates.push(cand);
    const k = [...S.cases.values()].find((x) => x.domain === d);
    if (k && !k.report_ids.includes(report.id)) {
      k.report_ids.push(report.id);
      k.timeline.push({ at: iso(now), kind: 'report', title: `Citizen report via ${channel}`, detail: report.text.slice(0, 80), actor: 'citizen' });
    }
  }
  const campaign = assignCampaign(report, entityName, now);
  emit('report', report);
  for (const d of domains) {
    const k = [...S.cases.values()].find((x) => x.domain === d);
    if (k) emitCase(k);
  }
  audit('intake', 'report.received', report.id, { channel, domains, language: report.language, campaign: campaign?.id ?? null });
  return { report, candidates, campaign };
}

// ------------------------------------------------------------------------------------------------ metrics / status
const ratePerMin = () => {
  const cutoff = Date.now() - 60_000;
  const n = S.certTimes.filter((t) => t >= cutoff).length;
  const elapsed = Math.min(60, (Date.now() - START.getTime()) / 1000);
  return elapsed < 5 ? n * 10 : Math.round((n / Math.max(1, elapsed)) * 60);
};
function metrics() {
  const cases = [...S.cases.values()];
  const open = cases.filter((c) => c.state === 'open').length;
  const confirmed = cases.filter((c) => c.verdict.label === 'confirmed_fake').length;
  const blocked = cases.filter((c) => c.state === 'blocked' || c.state === 'taken_down').length;
  const tti = median(cases.map((c) => minutesBetween(c.issued_at, c.detected_at)).filter((x) => x !== null));
  const ver = median(cases.map((c) => minutesBetween(c.detected_at, c.verified_at)).filter((x) => x !== null));
  const exp = median(cases.map((c) => minutesBetween(c.detected_at, c.blocked_at ?? c.taken_down_at)).filter((x) => x !== null));
  const cands = [...S.candidates.values()];
  return {
    certs_seen: S.certsSeenBase + S.certCount,
    certs_per_minute: ratePerMin(),
    candidates: cands.length,
    cases_open: open,
    cases_confirmed: confirmed,
    cases_blocked: blocked,
    reports: S.reports.size,
    campaigns: S.campaigns.size,
    false_positives: cases.filter((c) => c.state === 'false_positive').length,
    median_tti_minutes: round1(tti),
    median_verify_minutes: round1(ver),
    median_exposure_minutes: round1(exp),
    baseline_tti_minutes: BASELINE_TTI_MIN,
    baseline_exposure_minutes: BASELINE_EXPOSURE_MIN,
    tti_reduction_pct: tti === null ? null : round1((1 - tti / BASELINE_TTI_MIN) * 100),
    exposure_reduction_pct: exp === null ? null : round1((1 - exp / BASELINE_EXPOSURE_MIN) * 100),
    funnel: { certs_seen: S.certsSeenBase + S.certCount, filtered: S.filteredBase + S.filtered, candidates: cands.length, verified: cands.filter((c) => c.status === 'verified' || c.status === 'rechecking').length, confirmed, approved: cases.filter((c) => c.approved_at).length, blocked },
    sources: sourceStats(),
  };
}
function sourceStats() {
  const rate = ratePerMin();
  const n = S.certCount;
  return {
    source: 'hybrid',
    online: true,
    entries: n,
    rate_per_min: rate,
    planted: S.planted,
    logs: [
      { name: 'Google Argon 2026h2', url: 'https://ct.googleapis.com/logs/us1/argon2026h2/', tree_size: 1_284_332_110 + n, position: 1_284_332_110 + n - 12, lag: 12, entries: Math.round(n * 0.55), rate_per_min: Math.round(rate * 0.55), online: true },
      { name: 'Google Xenon 2026h2', url: 'https://ct.googleapis.com/logs/eu1/xenon2026h2/', tree_size: 901_118_452 + n, position: 901_118_452 + n - 31, lag: 31, entries: Math.round(n * 0.45), rate_per_min: Math.round(rate * 0.45), online: true },
    ],
  };
}
function demoState() {
  const d = S.demo;
  return { available: true, running: d.running, speed: d.speed, started_at: d.startedAt ? iso(d.startedAt) : null, elapsed_s: Math.round(demoElapsed()), sites_url: 'http://localhost:8081', steps: d.steps.map(({ id, at_s, kind, label, fired, fired_at }) => ({ id, at_s, kind, label, fired, fired_at })) };
}
function status() {
  return {
    node: 'saqr-node-01',
    version: '0.1.0',
    started_at: iso(START),
    uptime_s: Math.round((Date.now() - START.getTime()) / 1000),
    sources: sourceStats(),
    encoder: ENCODER,
    connector_mode: 'simulate',
    demo: demoState(),
    protected_entities: ENTITIES.length,
    counts: { certs_seen: S.certsSeenBase + S.certCount, candidates: S.candidates.size, cases: S.cases.size, reports: S.reports.size, campaigns: S.campaigns.size, actions: S.actions.size },
    match_threshold: THRESHOLD,
  };
}

// ------------------------------------------------------------------------------------------------ demo scenario
const demoElapsed = () => S.demo.elapsedBase + (S.demo.running && S.demo.startedAt ? ((Date.now() - S.demo.startedAt) / 1000) * S.demo.speed : 0);
function makeSteps() {
  return [
    { id: 's1', at_s: 12, kind: 'cert', label: 'Certificate issued for rta-fines-refund.com (Let’s Encrypt) — clone of rta.ae', run: () => injectCert('rta-fines-refund.com') },
    { id: 's2', at_s: 48, kind: 'report', label: 'Citizen forwards SMS: “RTA refund of AED 320 — claim within 24h” → rta-fines-refund.com', run: () => createReport({ channel: 'sms', text: 'RTA: A refund of AED 320.00 for an overpaid traffic fine is ready. Claim within 24 hours or it will be forfeited: https://rta-fines-refund.com/claim', sender: '+971501234567' }) },
    { id: 's3', at_s: 80, kind: 'cert', label: 'Certificate issued for salik-recharge-ae.com — negative-balance lure', run: () => injectCert('salik-recharge-ae.com') },
    { id: 's4', at_s: 118, kind: 'cert', label: 'IDN homograph certificate: tаx-refund-gov.com (Cyrillic а) imitating tax.gov.ae', run: () => injectCert('xn--tx-refund-gov-w1k.com') },
    { id: 's5', at_s: 160, kind: 'report', label: 'WhatsApp report: VAT refund message (second wave) → tаx-refund-gov.com', run: () => createReport({ channel: 'whatsapp', text: 'الهيئة الاتحادية للضرائب: تم اعتماد استرداد ضريبة القيمة المضافة بقيمة 1,250 درهم. يرجى التحقق من بطاقتك خلال 48 ساعة https://xn--tx-refund-gov-w1k.com/verify', sender: '+971559876543' }) },
    { id: 's6', at_s: 205, kind: 'activate', label: 'Parked domain salik-toll-renewal.site goes live with a card form — re-check catches it', run: () => activateDomain('salik-toll-renewal.site') },
    { id: 's7', at_s: 250, kind: 'note', label: 'Scenario complete — approve the open cases to measure exposure', run: () => {} },
  ];
}
function activateDomain(domain) {
  S.activated.add(domain);
  const cand = [...S.candidates.values()].find((c) => c.domain === domain);
  if (cand) verify(cand, { recheck: true });
  else injectCert(domain);
}
function fireStep(step) {
  step.fired = true;
  step.fired_at = iso(new Date());
  emit('demo', { step_id: step.id, label: step.label, kind: step.kind });
  audit('presenter', 'scenario.step', step.id, { label: step.label, kind: step.kind });
  step.run();
}
function demoTick() {
  if (!S.demo.running) return;
  const e = demoElapsed();
  for (const s of S.demo.steps) if (!s.fired && s.at_s <= e) fireStep(s);
}
function demoStart(speed) {
  if (speed && speed > 0) {
    if (S.demo.running) S.demo.elapsedBase = demoElapsed();
    S.demo.speed = speed;
    S.demo.startedAt = new Date();
  } else if (!S.demo.running) S.demo.startedAt = new Date();
  if (S.demo.steps.every((s) => s.fired)) {
    S.demo.steps = makeSteps();
    S.demo.elapsedBase = 0;
    S.demo.startedAt = new Date();
  }
  S.demo.running = true;
  audit('presenter', 'scenario.start', 'demo', { speed: S.demo.speed });
  return demoState();
}
function demoStop() {
  S.demo.elapsedBase = demoElapsed();
  S.demo.running = false;
  S.demo.startedAt = null;
  audit('presenter', 'scenario.stop', 'demo', { elapsed_s: Math.round(S.demo.elapsedBase) });
  return demoState();
}
function demoReset() {
  for (const t of S.timers) clearTimeout(t);
  S.timers.clear();
  S.candidates.clear();
  S.cases.clear();
  S.evidence.clear();
  S.actions.clear();
  S.reports.clear();
  S.campaigns.clear();
  S.activated.clear();
  S.renderOpts.clear();
  S.history.length = 0;
  S.filtered = 0;
  S.demo.steps = makeSteps();
  S.demo.elapsedBase = 0;
  S.demo.startedAt = new Date();
  S.demo.running = true;
  audit('presenter', 'demo.reset', 'demo', { kept: 'registry, audit' });
  emit('metrics', metrics());
  emit('status', status());
  return demoState();
}

// ------------------------------------------------------------------------------------------------ seed data
function seed() {
  const now = Date.now();
  const at = (minsAgo, secs = 0) => new Date(now - minsAgo * MIN - secs * 1000);
  const mkCandidate = (domain, source, issuedMinsAgo, detectedMinsAgo, reportIds = []) => {
    const match = matchDomain(domain, THRESHOLD);
    const prof = FAKES[domain] ?? PARKED[domain]?.activatedAs ?? null;
    let cert = null;
    if (issuedMinsAgo !== null) {
      cert = feed.entry([domain, `www.${domain}`], prof?.issuer ?? "Let's Encrypt (R12)", prof?.log ?? 'Google Argon 2026h2', at(issuedMinsAgo, -8));
      cert.issued_at = iso(at(issuedMinsAgo));
      cert.match_score = match.score;
      cert.matched_domain = domain;
      cert.source = 'ct_log';
      (S._certIndex ??= new Map()).set(cert.id, cert);
    }
    const cand = { id: newId('cand'), domain, url: `https://${domain}/`, source, status: 'verified', first_seen: iso(at(detectedMinsAgo)), issued_at: cert ? cert.issued_at : null, cert_id: cert?.id ?? null, report_ids: reportIds, match, recheck_count: 0, next_recheck_at: null, case_id: null, note: '' };
    S.candidates.set(cand.id, cand);
    return cand;
  };
  const mkCase = (cand, profile, detectedMinsAgo, verifyDelayS) => {
    const k = buildCase({ candidate: cand, profile, now: at(detectedMinsAgo), times: { detected: at(detectedMinsAgo), verified: at(detectedMinsAgo, -verifyDelayS) } });
    S.cases.set(k.id, k);
    cand.case_id = k.id;
    return k;
  };
  const seal = (k, minsAgo) => {
    const ev = buildEvidence(k, at(minsAgo));
    S.evidence.set(ev.id, ev);
    k.evidence_id = ev.id;
    k.timeline.push({ at: ev.created_at, kind: 'evidence', title: 'Evidence package sealed', detail: `${ev.artifacts.length} artifacts · rfc3161`, actor: 'system' });
    return ev;
  };
  const auditAt = (minsAgo, actor, action, subject, detail) => audit(actor, action, subject, detail, at(minsAgo));

  auditAt(242, 'system', 'node.started', 'saqr-node-01', { version: '0.1.0', ct_source: 'hybrid', encoder: ENCODER.model });
  auditAt(242, 'system', 'registry.loaded', 'protected_domains.yaml', { entities: ENTITIES.length, suffixes: 4 });

  // 1. emiratespost-redelivery.shop — blocked (approved 2h41m ago)
  const r3 = { id: newId('rpt'), channel: 'sms', text: 'Emirates Post: your parcel EP7781204AE could not be delivered. Pay the AED 11.50 redelivery fee within 48h: emiratespost-redelivery.shop/track', sender_masked: '+971 5* *** **19', reporter_ref: sha256('a').slice(0, 16), received_at: iso(at(186)), urls: ['https://emiratespost-redelivery.shop/track'], domains: ['emiratespost-redelivery.shop'], candidate_ids: [], campaign_id: null, language: 'en' };
  const r4 = { id: newId('rpt'), channel: 'whatsapp', text: 'بريد الإمارات: لم يتم توصيل شحنتك بسبب عنوان غير مكتمل. يرجى دفع رسوم إعادة التوصيل 11.50 درهم خلال 48 ساعة emiratespost-redelivery.shop/track', sender_masked: '+971 5* *** **77', reporter_ref: sha256('b').slice(0, 16), received_at: iso(at(171)), urls: ['https://emiratespost-redelivery.shop/track'], domains: ['emiratespost-redelivery.shop'], candidate_ids: [], campaign_id: null, language: 'ar' };
  const r5 = { id: newId('rpt'), channel: 'partner', text: 'Fraud desk referral: 14 customers reported card charges after paying a "redelivery fee" on emiratespost-redelivery.shop (Emirates Post lookalike).', sender_masked: '', reporter_ref: sha256('c').slice(0, 16), received_at: iso(at(150)), urls: ['https://emiratespost-redelivery.shop'], domains: ['emiratespost-redelivery.shop'], candidate_ids: [], campaign_id: null, language: 'en' };
  const c1 = mkCandidate('emiratespost-redelivery.shop', 'ct_log', 194, 192, [r3.id, r4.id, r5.id]);
  const k1 = mkCase(c1, profileFor('emiratespost-redelivery.shop'), 192, 11);
  seal(k1, 191);
  auditAt(192, 'pipeline', 'candidate.detected', k1.domain, { score: c1.match.score, source: 'ct_log', entity: 'Emirates Post' });
  auditAt(191.8, 'pipeline', 'case.verdict', k1.domain, { case_id: k1.id, verdict: 'confirmed_fake', risk: 92, encoder: k1.verdict.encoder });
  auditAt(191, 'pipeline', 'evidence.sealed', k1.domain, { case_id: k1.id, evidence_id: k1.evidence_id, merkle_root: S.evidence.get(k1.evidence_id).merkle_root.slice(0, 16), timestamp: 'rfc3161' });
  for (const r of [r3, r4, r5]) {
    S.reports.set(r.id, r);
    r.candidate_ids = [c1.id];
    k1.report_ids = [r3.id, r4.id, r5.id];
  }
  k1.state = 'blocked';
  k1.approved_at = iso(at(161));
  k1.approved_by = 'analyst@demo';
  k1.analyst_note = 'Matches SMS wave reported by du fraud desk.';
  k1.blocked_at = iso(at(159, 20));
  k1.timeline.push({ at: k1.approved_at, kind: 'approved', title: 'Approved by analyst — one-click response', detail: k1.analyst_note, actor: 'analyst@demo' });
  auditAt(161, 'analyst@demo', 'case.approved', k1.domain, { case_id: k1.id, verdict: 'confirmed_fake', risk: 92, evidence_id: k1.evidence_id, note: k1.analyst_note });
  auditAt(161, 'analyst@demo', 'actions.dispatched', k1.domain, { case_id: k1.id, channels: CONNECTORS.map((c) => c.channel), count: 9 });
  {
    const infra = k1._infra;
    const specs = [
      ['registrar', 'registrar-abuse', `${infra.registrar} abuse desk`, `Suspend ${k1.domain} — impersonation of Emirates Post`, false, 'acknowledged', 160.5, 159.7, null],
      ['hosting', 'hosting-abuse', `${infra.org} (${infra.asn})`, `Take down ${infra.ip} — phishing content`, false, 'completed', 160.6, 158.9, 118],
      ['telecom', 'telecom-etisalat', 'e& (Etisalat)', `Block ${k1.domain} on mobile data + filter SMS senders`, true, 'completed', 160.7, 159.33, 151],
      ['telecom', 'telecom-du', 'du', `Block ${k1.domain} on mobile data + filter SMS senders`, true, 'completed', 160.7, 158.6, 149],
      ['browser', 'browser-safe-browsing', 'Google Safe Browsing', `Submit ${k1.url} as social engineering`, true, 'completed', 160.8, 157.1, 132],
      ['browser', 'browser-smartscreen', 'Microsoft SmartScreen', `Submit ${k1.url} as phishing`, true, 'completed', 160.8, 156.2, 141],
      ['bank', 'cbuae-fraud-reporting', 'CBUAE fraud reporting', 'Share indicators (1 IOC) with the banking sector', false, 'completed', 160.9, 155, 120],
      ['certificate_authority', 'ca-revocation', 'Google Trust Services', `Revoke certificate ${k1._fingerprint.slice(0, 16)}… (fraudulent use)`, false, 'completed', 160.9, 152, 131],
      ['national_cert', 'aecert-incident', 'aeCERT (TDRA)', `Incident report with evidence package ${k1.evidence_id}`, false, 'completed', 161, 158, 140],
    ];
    for (const [channel, connector, target, summary, blocks, st, sentM, ackM, doneM] of specs) {
      const a = { id: newId('act'), case_id: k1.id, channel, connector, target, status: st, request_summary: summary, payload: { domain: k1.domain, url: k1.url, evidence_id: k1.evidence_id, approved_by: 'analyst@demo' }, receipt: `${connector.split('-')[0].toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`, created_at: k1.approved_at, sent_at: iso(at(sentM)), acknowledged_at: iso(at(ackM)), completed_at: doneM ? iso(at(doneM)) : null, error: '', blocks_exposure: blocks };
      S.actions.set(a.id, a);
    }
    k1.timeline.push({ at: k1.blocked_at, kind: 'blocked', title: 'Blocking confirmed by e& (Etisalat)', detail: 'mobile network URL block', actor: 'e& (Etisalat)' });
    auditAt(159.33, 'e& (Etisalat)', 'action.acknowledged', k1.domain, { channel: 'telecom', receipt: 'TELECOM-A1F2C3' });
    auditAt(159.33, 'e& (Etisalat)', 'case.blocked', k1.domain, { case_id: k1.id, via: 'telecom', exposure_minutes: round1(minutesBetween(k1.detected_at, k1.blocked_at)) });
    auditAt(118, 'Alibaba (US) Technology Co. (AS45102)', 'action.completed', k1.domain, { channel: 'hosting' });
  }
  const camp2 = { id: newId('camp'), name: 'Emirates Post parcel redelivery lure', created_at: iso(at(186)), last_seen: iso(at(150)), report_ids: [r3.id, r4.id, r5.id], domains: ['emiratespost-redelivery.shop'], case_ids: [k1.id], pattern: r3.text, infrastructure: {}, entity: 'Emirates Post', status: 'contained' };
  S.campaigns.set(camp2.id, camp2);
  for (const r of [r3, r4, r5]) r.campaign_id = camp2.id;
  linkCaseToCampaign(k1, camp2);

  // 2. nol-card-balance.net — benign, closed
  const c2 = mkCandidate('nol-card-balance.net', 'ct_log', 141, 140);
  const k2 = mkCase(c2, profileFor('nol-card-balance.net'), 140, 9);
  auditAt(140, 'pipeline', 'candidate.detected', k2.domain, { score: c2.match.score, source: 'ct_log', entity: c2.match.protected_entity });
  auditAt(139.8, 'pipeline', 'case.verdict', k2.domain, { case_id: k2.id, verdict: 'benign', risk: 18, encoder: k2.verdict.encoder });

  // 3. moi-uae-fines-pay.com — suspicious, open
  const c3 = mkCandidate('moi-uae-fines-pay.com', 'threat_feed', null, 66);
  c3.source = 'threat_feed';
  const k3 = mkCase(c3, profileFor('moi-uae-fines-pay.com'), 66, 12);
  seal(k3, 65);
  auditAt(66, 'pipeline', 'candidate.detected', k3.domain, { score: c3.match.score, source: 'threat_feed', entity: 'Ministry of Interior' });
  auditAt(65.8, 'pipeline', 'case.verdict', k3.domain, { case_id: k3.id, verdict: 'suspicious', risk: 61, encoder: k3.verdict.encoder });
  auditAt(65, 'pipeline', 'evidence.sealed', k3.domain, { case_id: k3.id, evidence_id: k3.evidence_id, merkle_root: S.evidence.get(k3.evidence_id).merkle_root.slice(0, 16), timestamp: 'rfc3161' });

  // 4. rta-ae-fitness.com — dismissed as false positive
  const c4 = mkCandidate('rta-ae-fitness.com', 'ct_log', 58, 57);
  const k4 = mkCase(c4, profileFor('rta-ae-fitness.com'), 57, 10);
  k4.state = 'false_positive';
  k4.analyst_note = 'Gym in Al Quoz (Real Time Athletics). No government claim, no payment form.';
  k4.timeline.push({ at: iso(at(52)), kind: 'dismissed', title: 'Dismissed as false positive', detail: k4.analyst_note, actor: 'analyst@demo' });
  c4.status = 'dismissed';
  auditAt(57, 'pipeline', 'candidate.detected', k4.domain, { score: c4.match.score, source: 'ct_log', entity: c4.match.protected_entity });
  auditAt(56.8, 'pipeline', 'case.verdict', k4.domain, { case_id: k4.id, verdict: 'suspicious', risk: 44, encoder: k4.verdict.encoder });
  auditAt(52, 'analyst@demo', 'case.dismissed', k4.domain, { case_id: k4.id, reason: k4.analyst_note });

  // 5. salik-toll-renewal.site — parked, monitoring
  const c5 = mkCandidate('salik-toll-renewal.site', 'ct_log', 51, 50);
  const k5 = mkCase(c5, profileFor('salik-toll-renewal.site'), 50, 8);
  c5.status = 'rechecking';
  c5.recheck_count = 2;
  c5.next_recheck_at = iso(new Date(now + 90_000));
  k5.timeline.push({ at: iso(at(48)), kind: 'recheck', title: 'Re-check #1: still inactive', detail: 'parking page', actor: 'system' });
  k5.timeline.push({ at: iso(at(46.5)), kind: 'recheck', title: 'Re-check #2: still inactive', detail: 'parking page', actor: 'system' });
  auditAt(50, 'pipeline', 'candidate.detected', k5.domain, { score: c5.match.score, source: 'ct_log', entity: 'Salik (Dubai toll)' });
  auditAt(49.8, 'pipeline', 'case.verdict', k5.domain, { case_id: k5.id, verdict: 'inactive', risk: 30, encoder: k5.verdict.encoder });

  // 6. dubaipolice-fines.online — confirmed fake awaiting approval, 2 reports, campaign 1
  const r1 = { id: newId('rpt'), channel: 'sms', text: 'Dubai Police: You have 2 unpaid traffic fines (AED 1,120). Pay within 24 hours to avoid a travel ban: https://dubaipolice-fines.online/pay', sender_masked: '+971 5* *** **12', reporter_ref: sha256('d').slice(0, 16), received_at: iso(at(31)), urls: ['https://dubaipolice-fines.online/pay'], domains: ['dubaipolice-fines.online'], candidate_ids: [], campaign_id: null, language: 'en' };
  const r2 = { id: newId('rpt'), channel: 'whatsapp', text: 'شرطة دبي: لديك مخالفات مرورية غير مدفوعة بقيمة 1,120 درهم. ادفع خلال 24 ساعة لتجنب منع السفر dubaipolice-fines.online/pay', sender_masked: '+971 5* *** **40', reporter_ref: sha256('e').slice(0, 16), received_at: iso(at(22)), urls: ['https://dubaipolice-fines.online/pay'], domains: ['dubaipolice-fines.online'], candidate_ids: [], campaign_id: null, language: 'ar' };
  const c6 = mkCandidate('dubaipolice-fines.online', 'ct_log', 40, 38, [r1.id, r2.id]);
  const k6 = mkCase(c6, profileFor('dubaipolice-fines.online'), 38, 12);
  seal(k6, 37);
  for (const r of [r1, r2]) {
    S.reports.set(r.id, r);
    r.candidate_ids = [c6.id];
  }
  k6.report_ids = [r1.id, r2.id];
  auditAt(38, 'pipeline', 'candidate.detected', k6.domain, { score: c6.match.score, source: 'ct_log', entity: 'Dubai Police' });
  auditAt(37.8, 'pipeline', 'case.verdict', k6.domain, { case_id: k6.id, verdict: 'confirmed_fake', risk: 89, encoder: k6.verdict.encoder });
  auditAt(37, 'pipeline', 'evidence.sealed', k6.domain, { case_id: k6.id, evidence_id: k6.evidence_id, merkle_root: S.evidence.get(k6.evidence_id).merkle_root.slice(0, 16), timestamp: 'rfc3161' });
  auditAt(31, 'intake', 'report.received', r1.id, { channel: 'sms', domains: r1.domains, language: 'en' });
  auditAt(22, 'intake', 'report.received', r2.id, { channel: 'whatsapp', domains: r2.domains, language: 'ar' });
  const camp1 = { id: newId('camp'), name: 'Traffic-fine travel-ban lure', created_at: iso(at(31)), last_seen: iso(at(22)), report_ids: [r1.id, r2.id], domains: ['dubaipolice-fines.online', 'moi-uae-fines-pay.com'], case_ids: [], pattern: r1.text, infrastructure: {}, entity: 'Dubai Police', status: 'active' };
  S.campaigns.set(camp1.id, camp1);
  for (const r of [r1, r2]) r.campaign_id = camp1.id;
  linkCaseToCampaign(k6, camp1);
  linkCaseToCampaign(k3, camp1);

  // 7. uaepass-verify.top — approved 20 s ago; actions progress live after boot
  const c7 = mkCandidate('uaepass-verify.top', 'ct_log', 11, 9);
  const k7 = mkCase(c7, profileFor('uaepass-verify.top'), 9, 11);
  seal(k7, 8.5);
  auditAt(9, 'pipeline', 'candidate.detected', k7.domain, { score: c7.match.score, source: 'ct_log', entity: 'UAE PASS' });
  auditAt(8.8, 'pipeline', 'case.verdict', k7.domain, { case_id: k7.id, verdict: 'confirmed_fake', risk: 88, encoder: k7.verdict.encoder });
  auditAt(8.5, 'pipeline', 'evidence.sealed', k7.domain, { case_id: k7.id, evidence_id: k7.evidence_id, merkle_root: S.evidence.get(k7.evidence_id).merkle_root.slice(0, 16), timestamp: 'rfc3161' });
  k7.state = 'approved';
  k7.approved_at = iso(at(0, 20));
  k7.approved_by = 'analyst@demo';
  k7.timeline.push({ at: k7.approved_at, kind: 'approved', title: 'Approved by analyst — one-click response', detail: '', actor: 'analyst@demo' });
  audit('analyst@demo', 'case.approved', k7.domain, { case_id: k7.id, verdict: 'confirmed_fake', risk: 88, evidence_id: k7.evidence_id, note: '' }, at(0, 20));
  const acts7 = dispatch(k7, CONNECTORS.map((c) => c.channel), 'analyst@demo', '', at(0, 20));
  for (const a of acts7) a.created_at = k7.approved_at;

  // background certificates so the ticker is not empty on first load
  for (let i = 60; i > 0; i--) {
    const e = feed.entry(feed.syntheticDomains(), feed.randomIssuer(), feed.randomLog(), new Date(now - i * 420));
    const m = bestMatch(e.domains, THRESHOLD);
    if (m) {
      e.match_score = m.allowlisted ? 0 : m.score;
      e.matched_domain = m.domain;
      e.allowlisted = m.allowlisted;
    }
    S.certs.unshift(e);
  }
  for (const c of [c1, c3, c6, c7]) if (c.cert_id) S.certs.splice(Math.floor(Math.random() * 20), 0, S._certIndex.get(c.cert_id));
  S.history.length = 0; // seed events are historical; a late dashboard loads them via REST
  S.demo.steps = makeSteps();
  S.demo.running = true;
  S.demo.startedAt = new Date();
}

// ------------------------------------------------------------------------------------------------ HTTP
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.map': 'application/json' };
const json = (res, code, body) => {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': data.length, 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
  res.end(data);
};
const err = (res, code, detail) => json(res, code, { detail });
const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
const pngCache = new Map();
function screenshotFor(key, opts, { thumb, mobile }) {
  const ck = `${key}:${thumb ? 't' : mobile ? 'm' : 'd'}`;
  let buf = pngCache.get(ck);
  if (!buf) {
    buf = thumb ? renderThumb(opts) : mobile ? renderPage({ ...opts, width: 390, height: 844, mobile: true }) : renderPage({ ...opts, width: 1280, height: 800 });
    pngCache.set(ck, buf);
  }
  return buf;
}
const sendPng = (res, buf) => {
  res.writeHead(200, { 'content-type': 'image/png', 'content-length': buf.length, 'cache-control': 'public, max-age=60', 'access-control-allow-origin': '*' });
  res.end(buf);
};
const caseDetail = (k) => {
  const cand = S.candidates.get(k.candidate_id) ?? null;
  const ev = k.evidence_id ? (S.evidence.get(k.evidence_id) ?? null) : null;
  const top = k.verdict.visual[0];
  const ref = top ? refById(top.reference_id) : null;
  return {
    summary: summaryOf(k),
    case: publicCase(k),
    candidate: cand,
    evidence: ev,
    actions: [...S.actions.values()].filter((a) => a.case_id === k.id).sort((a, b) => a.created_at.localeCompare(b.created_at)),
    reports: k.report_ids.map((id) => S.reports.get(id)).filter(Boolean),
    campaign: k.campaign_id ? (S.campaigns.get(k.campaign_id) ?? null) : null,
    reference: ref ? { id: ref.id, name: ref.name, domain: ref.domain, entity: ref.entity, screenshot_url: `/api/gallery/${ref.id}/screenshot` } : null,
    capture_text_excerpt: k.capture.text.slice(0, 1200),
  };
};
function evidenceReportHtml(k, ev) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const rows = ev.artifacts.map((a) => `<tr><td>${esc(a.name)}</td><td>${esc(a.mime)}</td><td>${a.size}</td><td><code>${a.sha256}</code></td></tr>`).join('');
  const custody = ev.custody.map((c) => `<li><b>${esc(c.event)}</b> — ${esc(c.actor)} · ${esc(c.at)} ${c.hash ? `· <code>${c.hash.slice(0, 16)}…</code>` : ''}</li>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>SAQR evidence report — ${esc(k.domain)}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:960px;margin:40px auto;padding:0 20px;color:#1b1f24}h1{font-size:22px}table{border-collapse:collapse;width:100%;font-size:13px}td,th{border-bottom:1px solid #e3e6ea;padding:6px 8px;text-align:left;vertical-align:top}code{font:12px ui-monospace,monospace;word-break:break-all}.chip{display:inline-block;padding:2px 8px;border-radius:6px;background:#fde8e8;color:#b3202a;font-weight:600}.muted{color:#667}</style></head>
<body><h1>SAQR evidence report <span class="muted">صقر</span></h1>
<p><b>${esc(toUnicode(k.domain))}</b> ${k.domain !== toUnicode(k.domain) ? `<span class="muted">(${esc(k.domain)})</span>` : ''} — <span class="chip">${esc(k.verdict.label)}</span> risk ${k.verdict.risk}/100 · confidence ${Math.round(k.verdict.confidence * 100)}%</p>
<p>Imitates <b>${esc(k._entity ?? '—')}</b> (${esc(k._protectedDomain ?? '')}). Case ${esc(k.id)} · detected ${esc(k.detected_at)} · verified ${esc(k.verified_at)}.</p>
<h2>Why</h2><ul>${k.verdict.explanations.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
<h2>Artifacts (${ev.artifacts.length})</h2><table><tr><th>name</th><th>type</th><th>bytes</th><th>sha-256</th></tr>${rows}</table>
<p>Merkle root <code>${ev.merkle_root}</code><br>manifest sha-256 <code>${ev.manifest_sha256}</code><br>Trusted timestamp: ${esc(ev.timestamp.kind)} · ${esc(ev.timestamp.authority)} · ${esc(ev.timestamp.time)} · ${ev.timestamp.verified ? 'verified' : 'unverified'}</p>
<h2>Chain of custody</h2><ol>${custody}</ol>
<h2>Infrastructure</h2><pre>${esc(JSON.stringify({ dns: ev.dns, registration: ev.registration, hosting: ev.hosting, certificate: ev.certificate, ct_entry: ev.ct_entry, iocs: ev.iocs }, null, 2))}</pre>
<p class="muted">Generated by SAQR mock backend · tool versions ${esc(JSON.stringify(ev.tool_versions))}</p></body></html>`;
}
function evidenceZip(k, ev) {
  const opts = S.renderOpts.get(k.id);
  const entries = [
    { name: 'manifest.json', data: JSON.stringify({ case_id: k.id, domain: k.domain, created_at: ev.created_at, artifacts: ev.artifacts, merkle_root: ev.merkle_root, timestamp: ev.timestamp }, null, 2) },
    { name: 'screenshot_desktop.png', data: screenshotFor(k.id, opts, { thumb: false, mobile: false }) },
    { name: 'screenshot_mobile.png', data: screenshotFor(k.id, opts, { thumb: false, mobile: true }) },
    { name: 'page.html', data: `<!doctype html><html><head><title>${k.capture.title}</title></head><body><!-- captured DOM placeholder (mock) -->\n<pre>${k.capture.text}</pre></body></html>` },
    { name: 'network.har', data: JSON.stringify({ log: { version: '1.2', creator: { name: 'saqr-mock', version: '0.1.0' }, entries: [] } }, null, 2) },
    { name: 'dns.json', data: JSON.stringify(ev.dns, null, 2) },
    { name: 'rdap.json', data: JSON.stringify(ev.registration, null, 2) },
    { name: 'hosting.json', data: JSON.stringify(ev.hosting, null, 2) },
    { name: 'certificate.pem', data: `-----BEGIN CERTIFICATE-----\n${Buffer.from(k._fingerprint).toString('base64')}\n-----END CERTIFICATE-----\n` },
    { name: 'ct_entry.json', data: JSON.stringify(ev.ct_entry, null, 2) },
    { name: 'custody.json', data: JSON.stringify(ev.custody, null, 2) },
    { name: 'timestamp.tsr', data: Buffer.from(ev.timestamp.digest, 'hex') },
    { name: 'README.txt', data: `SAQR evidence package for ${k.domain}\nCase ${k.id} · Merkle root ${ev.merkle_root}\nVerify: sha256 of each artifact must match manifest.json; the manifest digest is time-stamped (RFC 3161) by ${ev.timestamp.authority}.\n` },
  ];
  return buildZip(entries);
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const q = url.searchParams;
  const m = req.method;
  if (m === 'OPTIONS') {
    res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' });
    return res.end();
  }
  if (!p.startsWith('/api/')) return serveStatic(req, res, p);
  const seg = p.slice(5).split('/').filter(Boolean);
  const limit = (d) => Math.max(1, Math.min(1000, Number(q.get('limit') || d)));
  try {
    // ---------------------------------------------------------------- status & metrics
    if (m === 'GET' && p === '/api/status') return json(res, 200, status());
    if (m === 'GET' && p === '/api/metrics') return json(res, 200, metrics());
    if (m === 'GET' && p === '/api/feed') return json(res, 200, { entries: S.certs.slice(0, limit(200)) });
    if (m === 'GET' && p === '/api/match') {
      const d = (q.get('domain') ?? '').trim();
      if (!d) return err(res, 422, 'domain query parameter is required');
      return json(res, 200, matchDomain(d, THRESHOLD));
    }
    // ---------------------------------------------------------------- candidates & cases
    if (m === 'GET' && p === '/api/candidates') {
      const st = q.get('status');
      const list = [...S.candidates.values()].filter((c) => !st || c.status === st).sort((a, b) => b.first_seen.localeCompare(a.first_seen));
      return json(res, 200, list.slice(0, limit(100)));
    }
    if (m === 'GET' && p === '/api/cases') {
      const st = q.get('state');
      const list = [...S.cases.values()].filter((k) => !st || k.state === st).sort((a, b) => b.created_at.localeCompare(a.created_at));
      return json(res, 200, list.slice(0, limit(100)).map(summaryOf));
    }
    if (seg[0] === 'cases' && seg[1]) {
      const k = S.cases.get(seg[1]);
      if (!k) return err(res, 404, 'case not found');
      if (m === 'GET' && !seg[2]) return json(res, 200, caseDetail(k));
      if (m === 'GET' && seg[2] === 'screenshot') {
        const opts = S.renderOpts.get(k.id);
        if (!opts) return err(res, 404, 'no screenshot');
        return sendPng(res, screenshotFor(k.id, opts, { thumb: q.get('thumb') === '1', mobile: q.get('view') === 'mobile' }));
      }
      if (m === 'GET' && seg[2] === 'evidence.zip') {
        const ev = k.evidence_id ? S.evidence.get(k.evidence_id) : null;
        if (!ev) return err(res, 404, 'evidence not built yet');
        const zip = evidenceZip(k, ev);
        res.writeHead(200, { 'content-type': 'application/zip', 'content-length': zip.length, 'content-disposition': `attachment; filename="saqr-evidence-${k.domain}.zip"` });
        return res.end(zip);
      }
      if (m === 'GET' && seg[2] === 'evidence' && seg[3]) {
        const ev = k.evidence_id ? S.evidence.get(k.evidence_id) : null;
        if (!ev) return err(res, 404, 'evidence not built yet');
        const name = decodeURIComponent(seg[3]);
        if (name === 'report') {
          const html = Buffer.from(evidenceReportHtml(k, ev));
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': html.length });
          return res.end(html);
        }
        if (name.endsWith('.png')) return sendPng(res, screenshotFor(k.id, S.renderOpts.get(k.id), { thumb: false, mobile: name.includes('mobile') }));
        if (name === 'manifest.json') return json(res, 200, { case_id: k.id, artifacts: ev.artifacts, merkle_root: ev.merkle_root, timestamp: ev.timestamp });
        const dict = { 'dns.json': ev.dns, 'rdap.json': ev.registration, 'hosting.json': ev.hosting, 'ct_entry.json': ev.ct_entry, 'custody.json': ev.custody }[name];
        if (dict) return json(res, 200, dict);
        if (!ev.artifacts.some((a) => a.name === name)) return err(res, 404, 'artifact not found');
        const body = Buffer.from(`${name} (mock placeholder) for ${k.domain}\n`);
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-length': body.length });
        return res.end(body);
      }
      if (m === 'POST' && seg[2] === 'approve') {
        const body = await readBody(req);
        if (!body.actor) return err(res, 422, 'actor is required');
        const r = approveCase(k, { actor: String(body.actor), channels: Array.isArray(body.channels) ? body.channels : undefined, note: body.note ? String(body.note) : undefined });
        if (r.error) return err(res, r.error, r.detail);
        return json(res, 200, r);
      }
      if (m === 'POST' && seg[2] === 'dismiss') {
        const body = await readBody(req);
        if (!body.actor || !body.reason) return err(res, 422, 'actor and reason are required');
        if (!['open', 'monitoring'].includes(k.state)) return err(res, 409, `case is ${k.state}`);
        k.state = 'false_positive';
        k.analyst_note = String(body.reason);
        k.timeline.push({ at: iso(new Date()), kind: 'dismissed', title: 'Dismissed as false positive', detail: k.analyst_note, actor: String(body.actor) });
        const cand = S.candidates.get(k.candidate_id);
        if (cand) {
          cand.status = 'dismissed';
          emit('candidate', cand);
        }
        audit(String(body.actor), 'case.dismissed', k.domain, { case_id: k.id, reason: k.analyst_note });
        emitCase(k);
        return json(res, 200, summaryOf(k));
      }
      if (m === 'POST' && seg[2] === 'recheck') {
        const cand = S.candidates.get(k.candidate_id);
        if (!cand) return err(res, 404, 'candidate not found');
        cand.status = 'queued';
        cand.next_recheck_at = null;
        audit('analyst', 'case.recheck', k.domain, { case_id: k.id, candidate_id: cand.id });
        k.timeline.push({ at: iso(new Date()), kind: 'recheck', title: 'Re-check requested by analyst', detail: '', actor: 'analyst' });
        later(delay(300), () => verify(cand, { recheck: true }));
        return json(res, 200, cand);
      }
      if (m === 'POST' && seg[2] === 'note') {
        const body = await readBody(req);
        k.analyst_note = String(body.note ?? '');
        k.timeline.push({ at: iso(new Date()), kind: 'note', title: 'Analyst note', detail: k.analyst_note, actor: String(body.actor ?? 'analyst') });
        audit(String(body.actor ?? 'analyst'), 'case.note', k.domain, { case_id: k.id, note: k.analyst_note });
        emitCase(k);
        return json(res, 200, summaryOf(k));
      }
    }
    // ---------------------------------------------------------------- reports & campaigns
    if (m === 'GET' && p === '/api/reports') return json(res, 200, [...S.reports.values()].sort((a, b) => b.received_at.localeCompare(a.received_at)).slice(0, limit(100)));
    if (m === 'POST' && p === '/api/reports') {
      const body = await readBody(req);
      if (!body.text || !body.channel) return err(res, 422, 'channel and text are required');
      return json(res, 200, createReport({ channel: String(body.channel), text: String(body.text), sender: body.sender ? String(body.sender) : '' }));
    }
    if (m === 'POST' && p === '/api/intake/url') {
      const body = await readBody(req);
      if (!body.url) return err(res, 422, 'url is required');
      const d = domainOf(String(body.url));
      const match = matchDomain(d, THRESHOLD);
      const cand = createCandidate({ domain: d, url: String(body.url), source: body.source ?? 'manual', match });
      if (body.note) cand.note = String(body.note);
      return json(res, 200, cand);
    }
    if (m === 'GET' && p === '/api/campaigns') return json(res, 200, [...S.campaigns.values()].sort((a, b) => b.last_seen.localeCompare(a.last_seen)));
    if (m === 'GET' && seg[0] === 'campaigns' && seg[1]) {
      const c = S.campaigns.get(seg[1]);
      if (!c) return err(res, 404, 'campaign not found');
      return json(res, 200, { campaign: c, reports: c.report_ids.map((id) => S.reports.get(id)).filter(Boolean), cases: c.case_ids.map((id) => S.cases.get(id)).filter(Boolean).map(summaryOf) });
    }
    // ---------------------------------------------------------------- actions, audit, registry, gallery, connectors
    if (m === 'GET' && p === '/api/actions') {
      const cid = q.get('case_id');
      return json(res, 200, [...S.actions.values()].filter((a) => !cid || a.case_id === cid).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit(200)));
    }
    if (m === 'GET' && p === '/api/audit') {
      const v = verifyAudit();
      return json(res, 200, { entries: S.audit.slice(-limit(200)), valid: v.valid, length: S.audit.length });
    }
    if (m === 'POST' && p === '/api/audit/verify') return json(res, 200, verifyAudit());
    if (m === 'GET' && p === '/api/protected') return json(res, 200, protectedRegistryResponse());
    if (m === 'GET' && p === '/api/gallery') return json(res, 200, REFERENCES.map((r) => ({ id: r.id, name: r.name, domain: r.domain, entity: r.entity, screenshot_url: `/api/gallery/${r.id}/screenshot` })));
    if (m === 'GET' && seg[0] === 'gallery' && seg[1] && seg[2] === 'screenshot') {
      const r = refById(seg[1]);
      if (!r) return err(res, 404, 'reference not found');
      return sendPng(res, screenshotFor(r.id, { kind: 'official', palette: r.palette, seed: 11 }, { thumb: q.get('thumb') === '1', mobile: q.get('view') === 'mobile' }));
    }
    if (m === 'GET' && p === '/api/connectors') return json(res, 200, CONNECTORS);
    // ---------------------------------------------------------------- demo
    if (m === 'GET' && p === '/api/demo') return json(res, 200, demoState());
    if (m === 'POST' && p === '/api/demo/start') {
      const body = await readBody(req);
      return json(res, 200, demoStart(body.speed ? Number(body.speed) : undefined));
    }
    if (m === 'POST' && p === '/api/demo/stop') return json(res, 200, demoStop());
    if (m === 'POST' && p === '/api/demo/reset') return json(res, 200, demoReset());
    if (m === 'POST' && p === '/api/demo/inject') {
      const body = await readBody(req);
      if (!body.domain) return err(res, 422, 'domain is required');
      injectCert(String(body.domain), body.issuer ? String(body.issuer) : undefined);
      return json(res, 200, { injected: true });
    }
    if (m === 'POST' && p === '/api/demo/step') {
      const body = await readBody(req);
      const step = S.demo.steps.find((s) => s.id === body.step_id);
      if (!step) return err(res, 404, 'unknown step');
      fireStep(step);
      return json(res, 200, demoState());
    }
    return err(res, 404, 'not found');
  } catch (e) {
    console.error('[mock]', m, p, e);
    return err(res, 500, String(e?.message ?? e));
  }
}

function serveStatic(req, res, p) {
  if (!fs.existsSync(DIST)) {
    const body = Buffer.from('SAQR mock backend is running. Build the dashboard (npm run build) or use the Vite dev server (npm run dev).\n');
    res.writeHead(200, { 'content-type': 'text/plain', 'content-length': body.length });
    return res.end(body);
  }
  let file = path.join(DIST, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  const data = fs.readFileSync(file);
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'content-length': data.length });
  res.end(data);
}

// ------------------------------------------------------------------------------------------------ main
seed();
const server = http.createServer((req, res) => void handle(req, res));
server.on('upgrade', (req, socket, head) => {
  if (new URL(req.url, 'http://localhost').pathname === '/ws') wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  else socket.destroy();
});

// background certificate stream (~10/s with jitter; an official renewal every ~25 s; a near-miss every ~70 s)
let lastOfficial = Date.now();
let lastNearMiss = Date.now();
function pump() {
  const now = Date.now();
  let domains;
  if (now - lastOfficial > 25_000 + Math.random() * 10_000) {
    domains = feed.officialDomains();
    lastOfficial = now;
  } else if (now - lastNearMiss > 70_000 + Math.random() * 40_000) {
    domains = feed.nearMissDomains();
    lastNearMiss = now;
  } else domains = feed.syntheticDomains();
  onCert(feed.entry(domains, feed.randomIssuer(), feed.randomLog()));
  setTimeout(pump, 100 * (0.4 + Math.random() * 1.2));
}
setTimeout(pump, 300);
setInterval(() => emit('metrics', metrics()), 5000);
setInterval(() => emit('status', status()), 10000);
setInterval(demoTick, 500);

server.listen(PORT, () => {
  console.log(`[saqr mock] listening on http://localhost:${PORT}  (REST /api, events /ws)`);
  console.log(`[saqr mock] seeded ${S.cases.size} cases, ${S.reports.size} reports, ${S.campaigns.size} campaigns, ${S.audit.length} audit entries; scenario running`);
});
