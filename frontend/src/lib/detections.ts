import type { Action, Candidate, CaseSummary, EvidenceEvent, Source, VerificationEvent } from '../api/types';
import type { LiveSnapshot } from '../hooks/liveStore';
import { parseTime, toUnicodeDomain } from './format';
import { stageLabel, type Tone } from './tones';

/** One row of the "Detections" column: a candidate and/or case for the same domain, joined by domain. */
export interface Detection {
  key: string;
  domain: string;
  displayDomain: string;
  candidate?: Candidate;
  verification?: VerificationEvent & { at: string };
  case?: CaseSummary;
  evidence?: EvidenceEvent & { at: string };
  actions: Action[];
  updatedAt: number;
  score: number;
  entity: string | null;
  source: Source;
  firstSeen: string;
}

export const STAGES = ['Detected', 'Verifying', 'Verified', 'Evidence', 'Awaiting approval', 'Blocked'] as const;

export interface StageStatus {
  /** index into STAGES of the current stage */
  index: number;
  /** true while the current stage is in progress (pulses); false when it is a resting state */
  active: boolean;
  /** terminal outcome that ends the tracker early (benign, monitoring, dismissed, error) */
  terminal?: { label: string; tone: Tone };
  message: string;
  tone: Tone;
}

export function buildDetections(s: LiveSnapshot): Detection[] {
  const byDomain = new Map<string, Detection>();
  const ensure = (domain: string, source: Source, firstSeen: string): Detection => {
    let d = byDomain.get(domain);
    if (!d) {
      d = {
        key: domain,
        domain,
        displayDomain: toUnicodeDomain(domain),
        actions: [],
        updatedAt: 0,
        score: 0,
        entity: null,
        source,
        firstSeen,
      };
      byDomain.set(domain, d);
    }
    return d;
  };

  for (const cand of Object.values(s.candidates)) {
    const d = ensure(cand.domain, cand.source, cand.first_seen);
    if (!d.candidate || parseTime(cand.first_seen)! >= parseTime(d.candidate.first_seen)!) d.candidate = cand;
    d.score = Math.max(d.score, cand.match?.score ?? 0);
    d.entity = d.entity ?? cand.match?.protected_entity ?? null;
    if (cand.match?.unicode_domain) d.displayDomain = cand.match.unicode_domain;
    d.updatedAt = Math.max(d.updatedAt, parseTime(cand.first_seen) ?? 0);
  }
  for (const v of Object.values(s.verification)) {
    const d = ensure(v.domain, 'ct_log', v.at);
    if (!d.verification || parseTime(v.at)! >= parseTime(d.verification.at)!) d.verification = v;
    d.updatedAt = Math.max(d.updatedAt, parseTime(v.at) ?? 0);
  }
  for (const c of Object.values(s.cases)) {
    const d = ensure(c.domain, c.source, c.detected_at);
    if (!d.case || parseTime(c.created_at)! >= parseTime(d.case.created_at)!) d.case = c;
    d.score = Math.max(d.score, c.lookalike_score ?? 0);
    d.entity = c.protected_entity ?? d.entity;
    d.source = c.source;
    const ev = s.evidence[c.id];
    if (ev) d.evidence = ev;
    d.actions = Object.values(s.actions[c.id] ?? {});
    const times = [c.created_at, c.verified_at, c.approved_at, c.blocked_at, c.taken_down_at, ev?.at]
      .map(parseTime)
      .filter((t): t is number => t !== null);
    for (const a of d.actions) {
      for (const t of [a.created_at, a.sent_at, a.acknowledged_at, a.completed_at]) {
        const p = parseTime(t);
        if (p !== null) times.push(p);
      }
    }
    d.updatedAt = Math.max(d.updatedAt, ...times);
  }
  for (const d of byDomain.values()) {
    const touched = s.touched[d.domain];
    if (touched) d.updatedAt = Math.max(d.updatedAt, touched);
  }
  return [...byDomain.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function stageOf(d: Detection): StageStatus {
  const c = d.case;
  if (c) {
    const sum = c.action_summary;
    if (c.state === 'blocked' || c.state === 'taken_down') {
      const confirmed = sum.acknowledged; // cumulative bucket: includes completed
      return {
        index: 5,
        active: false,
        message: c.state === 'taken_down' ? 'registrar confirmed removal' : `${confirmed} of ${sum.total} partners confirmed`,
        tone: 'emerald',
      };
    }
    if (c.state === 'approved') {
      return {
        index: 5,
        active: true,
        message: `dispatching · ${sum.sent}/${sum.total} sent · ${sum.acknowledged} acknowledged`,
        tone: 'sky',
      };
    }
    if (c.state === 'monitoring') {
      return { index: 2, active: false, terminal: { label: 'Monitoring', tone: 'slate' }, message: 'Page inactive — scheduled for re-check', tone: 'slate' };
    }
    if (c.state === 'false_positive') {
      return { index: 2, active: false, terminal: { label: 'Dismissed', tone: 'slate' }, message: 'Dismissed by analyst as a false positive', tone: 'slate' };
    }
    if (c.state === 'closed') {
      return { index: 2, active: false, terminal: { label: 'Closed', tone: 'slate' }, message: `Closed — verdict ${d.case?.verdict.label.replace('_', ' ')}`, tone: 'slate' };
    }
    // open
    const label = c.verdict.label;
    if (label === 'confirmed_fake' || label === 'suspicious') {
      if (!c.has_evidence && !d.evidence) {
        return { index: 3, active: true, message: 'hashing · Merkle root · trusted timestamp', tone: 'sky' };
      }
      return {
        index: 4,
        active: false,
        message: label === 'confirmed_fake' ? 'one click blocks everywhere' : 'suspicious — analyst review required',
        tone: label === 'confirmed_fake' ? 'red' : 'amber',
      };
    }
    return { index: 2, active: false, terminal: { label: label === 'official' ? 'Official' : 'Benign', tone: label === 'official' ? 'emerald' : 'slate' }, message: 'Verified — no impersonation found', tone: 'slate' };
  }
  const v = d.verification;
  if (v) {
    const msg = v.message ? `${(stageLabel[v.stage] ?? v.stage).toLowerCase()} — ${v.message}` : (stageLabel[v.stage] ?? v.stage).toLowerCase();
    switch (v.stage) {
      case 'queued':
      case 'opening':
      case 'captured':
      case 'analysing':
        return { index: 1, active: true, message: msg, tone: 'sky' };
      case 'scored':
        return { index: 2, active: true, message: msg, tone: 'sky' };
      case 'evidence':
        return { index: 3, active: true, message: msg, tone: 'sky' };
      case 'done':
        return { index: 3, active: false, message: msg, tone: 'sky' };
      case 'error':
        return { index: 1, active: false, terminal: { label: 'Error', tone: 'red' }, message: msg, tone: 'red' };
      case 'recheck':
        return { index: 1, active: false, terminal: { label: 'Re-check', tone: 'slate' }, message: msg, tone: 'slate' };
      default:
        return { index: 1, active: true, message: msg, tone: 'sky' };
    }
  }
  return { index: 0, active: true, message: `passed the look-alike filter · score ${d.score}`, tone: 'amber' };
}

/** Detections worth showing on the live wall: anything that is not pure noise. */
export const isInteresting = (d: Detection) => Boolean(d.case || d.candidate || d.verification);
