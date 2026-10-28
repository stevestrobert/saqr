import { api } from '../api/client';
import type {
  Action,
  AuditEntry,
  Campaign,
  Candidate,
  CaseSummary,
  CertEntry,
  DemoFiredEvent,
  DemoState,
  EvidenceEvent,
  Metrics,
  Report,
  StatusResponse,
  VerificationEvent,
  WsEvent,
} from '../api/types';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline';

export interface LogLine {
  id: number;
  type: string;
  at: string;
  summary: string;
}

export interface LiveSnapshot {
  connection: ConnectionState;
  reconnectAttempt: number;
  bootstrapped: boolean;
  bootstrapError: string | null;
  certs: CertEntry[];
  certCount: number;
  candidates: Record<string, Candidate>;
  verification: Record<string, VerificationEvent & { at: string }>;
  cases: Record<string, CaseSummary>;
  actions: Record<string, Record<string, Action>>;
  evidence: Record<string, EvidenceEvent & { at: string }>;
  metrics: Metrics | null;
  status: StatusResponse | null;
  demo: DemoState | null;
  demoFired: (DemoFiredEvent & { at: string })[];
  reports: Report[];
  campaigns: Record<string, Campaign>;
  audit: AuditEntry[];
  eventLog: LogLine[];
  lastEventAt: number | null;
  touched: Record<string, number>;
}

const CERT_RING = 150;
const FLUSH_MS = 110;

/** Newest-first merge of certificate entries, de-duplicated by id and capped to the ring size. */
function mergeCerts(existing: CertEntry[], incoming: CertEntry[]): CertEntry[] {
  const seen = new Set<string>();
  const out: CertEntry[] = [];
  for (const e of [...incoming, ...existing]) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  out.sort((a, b) => (b.seen_at > a.seen_at ? 1 : b.seen_at < a.seen_at ? -1 : 0));
  return out.slice(0, CERT_RING);
}

const initial: LiveSnapshot = {
  connection: 'connecting',
  reconnectAttempt: 0,
  bootstrapped: false,
  bootstrapError: null,
  certs: [],
  certCount: 0,
  candidates: {},
  verification: {},
  cases: {},
  actions: {},
  evidence: {},
  metrics: null,
  status: null,
  demo: null,
  demoFired: [],
  reports: [],
  campaigns: {},
  audit: [],
  eventLog: [],
  lastEventAt: null,
  touched: {},
};

function summarize(ev: WsEvent): string {
  switch (ev.type) {
    case 'candidate':
      return `candidate ${ev.data.domain} (score ${ev.data.match?.score ?? '—'})`;
    case 'verification':
      return `${ev.data.domain}: ${ev.data.stage}${ev.data.message ? ` — ${ev.data.message}` : ''}`;
    case 'case':
      return `case ${ev.data.domain} → ${ev.data.verdict.label} / ${ev.data.state}`;
    case 'evidence':
      return `evidence sealed for ${ev.data.case_id} (${ev.data.artifacts} artifacts)`;
    case 'action':
      return `${ev.data.channel} → ${ev.data.target}: ${ev.data.status}`;
    case 'report':
      return `report via ${ev.data.channel}: ${ev.data.domains.join(', ') || 'no URL'}`;
    case 'campaign':
      return `campaign ${ev.data.name} (${ev.data.domains.length} domains)`;
    case 'audit':
      return `audit #${ev.data.seq} ${ev.data.action} ${ev.data.subject}`;
    case 'demo':
      return `scenario step: ${ev.data.label}`;
    case 'metrics':
      return `metrics refreshed`;
    case 'status':
      return `status: ${ev.data.sources?.rate_per_min ?? 0} certs/min`;
    default:
      return ev.type;
  }
}

/**
 * Owns the WebSocket (auto-reconnect with backoff, `hello.history` replay) and a small immutable
 * event store. High-volume `cert` events are batched and flushed ~9 times a second so the UI renders
 * at a steady cadence regardless of feed rate.
 */
export class LiveStore {
  private snap: LiveSnapshot = initial;
  private listeners = new Set<() => void>();
  private pending: WsEvent[] = [];
  private flushTimer: number | null = null;
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private attempts = 0;
  private stopped = false;
  private logSeq = 0;
  private url = '';

  getSnapshot = (): LiveSnapshot => this.snap;

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };

  private commit(next: LiveSnapshot) {
    this.snap = next;
    this.listeners.forEach((l) => l());
  }

  private patch(p: Partial<LiveSnapshot>) {
    this.commit({ ...this.snap, ...p });
  }

  // ------------------------------------------------------------------------------------ bootstrap
  async bootstrap(): Promise<void> {
    const [status, metrics, feed, cases, demo] = await Promise.allSettled([
      api.status(),
      api.metrics(),
      api.feed(CERT_RING),
      api.cases('', 100),
      api.demo(),
    ]);
    const p: Partial<LiveSnapshot> = { bootstrapped: true };
    if (status.status === 'fulfilled') {
      p.status = status.value;
      p.demo = status.value.demo ?? this.snap.demo;
    }
    if (metrics.status === 'fulfilled') p.metrics = metrics.value;
    if (feed.status === 'fulfilled') {
      p.certs = mergeCerts(this.snap.certs, feed.value.entries);
    }
    if (cases.status === 'fulfilled') {
      const map = { ...this.snap.cases };
      for (const c of cases.value) if (!map[c.id]) map[c.id] = c;
      p.cases = map;
    }
    if (demo.status === 'fulfilled') p.demo = demo.value;
    const failures = [status, metrics, feed, cases, demo].filter((r) => r.status === 'rejected');
    p.bootstrapError = failures.length === 5 ? 'Backend unreachable' : null;
    this.patch(p);
  }

  mergeCases(list: CaseSummary[]) {
    const map = { ...this.snap.cases };
    for (const c of list) map[c.id] = c;
    this.patch({ cases: map });
  }

  mergeActions(list: Action[]) {
    const actions = { ...this.snap.actions };
    for (const a of list) actions[a.case_id] = { ...(actions[a.case_id] ?? {}), [a.id]: a };
    this.patch({ actions });
  }

  setDemo(demo: DemoState) {
    this.patch({ demo });
  }

  // ------------------------------------------------------------------------------------ websocket
  connect(url: string) {
    this.url = url;
    this.stopped = false;
    // Deferred by a tick so a mount that is immediately unmounted (React StrictMode) never opens a socket.
    this.reconnectTimer = window.setTimeout(() => this.open(), 0);
  }

  disconnect() {
    this.stopped = true;
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.flushTimer) window.clearTimeout(this.flushTimer);
    this.flushTimer = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.onerror = null;
      ws.close();
    }
  }

  private open() {
    if (this.stopped) return;
    this.patch({ connection: this.attempts === 0 ? 'connecting' : 'reconnecting', reconnectAttempt: this.attempts });
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.attempts = 0;
      this.patch({ connection: 'connected', reconnectAttempt: 0 });
    };
    ws.onmessage = (m) => {
      try {
        const ev = JSON.parse(typeof m.data === 'string' ? m.data : '') as WsEvent;
        if (ev && typeof ev.type === 'string') this.push(ev);
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  private scheduleReconnect() {
    if (this.stopped) return;
    this.attempts += 1;
    const delay = Math.min(15000, 800 * 2 ** Math.min(this.attempts - 1, 4)) + Math.random() * 400;
    this.patch({ connection: this.attempts > 6 ? 'offline' : 'reconnecting', reconnectAttempt: this.attempts });
    this.reconnectTimer = window.setTimeout(() => this.open(), delay);
  }

  push(ev: WsEvent) {
    this.pending.push(ev);
    if (this.flushTimer === null) this.flushTimer = window.setTimeout(() => this.flush(), FLUSH_MS);
  }

  // ------------------------------------------------------------------------------------ apply
  private flush() {
    this.flushTimer = null;
    const events = this.pending;
    this.pending = [];
    if (!events.length) return;
    // Copy-on-write: a collection is cloned only when an event touches it, so selectors on
    // untouched slices keep their references (and their memoised derivations) across cert-only flushes.
    const d: LiveSnapshot = { ...this.snap };
    const base = this.snap;
    const own = <K extends 'candidates' | 'verification' | 'cases' | 'actions' | 'evidence' | 'campaigns' | 'touched'>(key: K): LiveSnapshot[K] => {
      if (d[key] === base[key]) d[key] = { ...(base[key] as object) } as LiveSnapshot[K];
      return d[key];
    };
    const newCerts: CertEntry[] = [];
    for (const ev of events) this.apply(d, ev, newCerts, own);
    if (newCerts.length) {
      newCerts.reverse();
      d.certs = mergeCerts(d.certs, newCerts);
      d.certCount += newCerts.length;
    }
    d.lastEventAt = Date.now();
    this.commit(d);
  }

  private apply(
    d: LiveSnapshot,
    ev: WsEvent,
    newCerts: CertEntry[],
    own: <K extends 'candidates' | 'verification' | 'cases' | 'actions' | 'evidence' | 'campaigns' | 'touched'>(key: K) => LiveSnapshot[K],
  ) {
    const now = Date.now();
    switch (ev.type) {
      case 'hello': {
        const history = Array.isArray(ev.data?.history) ? ev.data.history : [];
        for (const h of history) this.apply(d, h, newCerts, own);
        return;
      }
      case 'cert':
        newCerts.push(ev.data);
        return;
      case 'candidate':
        own('candidates')[ev.data.id] = ev.data;
        own('touched')[ev.data.domain] = now;
        break;
      case 'verification':
        own('verification')[ev.data.candidate_id] = { ...ev.data, at: ev.at };
        own('touched')[ev.data.domain] = now;
        break;
      case 'case':
        own('cases')[ev.data.id] = ev.data;
        own('touched')[ev.data.domain] = now;
        break;
      case 'evidence': {
        own('evidence')[ev.data.case_id] = { ...ev.data, at: ev.at };
        const cases = own('cases');
        const c = cases[ev.data.case_id];
        if (c) {
          cases[c.id] = { ...c, has_evidence: true, evidence_id: ev.data.evidence_id };
          own('touched')[c.domain] = now;
        }
        break;
      }
      case 'action': {
        const a = ev.data;
        const actions = own('actions');
        actions[a.case_id] = { ...(actions[a.case_id] ?? {}), [a.id]: a };
        const c = d.cases[a.case_id];
        if (c) own('touched')[c.domain] = now;
        break;
      }
      case 'report':
        d.reports = [ev.data, ...d.reports.filter((r) => r.id !== ev.data.id)].slice(0, 100);
        break;
      case 'campaign':
        own('campaigns')[ev.data.id] = ev.data;
        break;
      case 'metrics':
        d.metrics = ev.data;
        return; // not logged: noisy
      case 'audit':
        d.audit = [ev.data, ...d.audit.filter((a) => a.seq !== ev.data.seq)].slice(0, 200);
        break;
      case 'demo': {
        if (ev.data.kind === 'reset') {
          // The node wiped its operational state: drop everything derived from it (registry and status stay).
          d.certs = [];
          d.certCount = 0;
          d.candidates = {};
          d.verification = {};
          d.cases = {};
          d.actions = {};
          d.evidence = {};
          d.reports = [];
          d.campaigns = {};
          d.touched = {};
          d.demoFired = [];
          newCerts.length = 0;
        }
        d.demoFired = [{ ...ev.data, at: ev.at }, ...d.demoFired].slice(0, 50);
        if (d.demo) {
          d.demo = {
            ...d.demo,
            steps: d.demo.steps.map((s) => (s.id === ev.data.step_id ? { ...s, fired: true, fired_at: ev.at } : s)),
          };
        }
        break;
      }
      case 'status':
        d.status = ev.data;
        if (ev.data.demo) d.demo = ev.data.demo;
        return; // not logged
      default:
        return;
    }
    d.eventLog = [{ id: ++this.logSeq, type: ev.type, at: ev.at, summary: summarize(ev) }, ...d.eventLog].slice(0, 80);
  }
}
