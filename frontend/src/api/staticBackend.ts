/**
 * Server-less mode of the dashboard (`npm run build:static`, VITE_STATIC=1).
 *
 * A recorded demo run (`saqr snapshot`) is published next to the bundle under `<base>/data/`:
 * `events.json` holds every live event the node emitted, `api/*.json` the final answer of every GET endpoint,
 * plus screenshots and evidence files. This module replays the event stream on a timer (as if a WebSocket
 * delivered it) and answers API calls from the state reconstructed so far, so what the pages show is always
 * consistent with what the live wall has already revealed. "Approve & block" fast-forwards the recorded
 * dispatch for that case; the other writes are refused with a clear message.
 */
import type { LiveStore } from '../hooks/liveStore';
import { ApiError } from './client';
import type {
  Action,
  AuditEntry,
  Campaign,
  Candidate,
  CaseDetail,
  CaseSummary,
  CertEntry,
  DemoState,
  EvidenceEvent,
  Metrics,
  Report,
  StatusResponse,
  WsEvent,
} from './types';

export const STATIC = import.meta.env.VITE_STATIC === '1';
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
export const DATA = `${BASE}/data`;

export const staticUrls = {
  screenshot: (caseId: string, view: 'desktop' | 'mobile' = 'desktop', thumb = false) =>
    `${DATA}/api/cases/${encodeURIComponent(caseId)}/screenshot-${view}${thumb ? '-thumb' : ''}.png`,
  evidenceZip: (caseId: string) => `${DATA}/api/cases/${encodeURIComponent(caseId)}/evidence.zip`,
  evidenceReport: (caseId: string) => `${DATA}/api/cases/${encodeURIComponent(caseId)}/evidence/report.html`,
  evidenceArtifact: (caseId: string, name: string) => `${DATA}/api/cases/${encodeURIComponent(caseId)}/evidence/${encodeURIComponent(name)}`,
  galleryScreenshot: (refId: string) => `${DATA}/api/gallery/${encodeURIComponent(refId)}.png`,
};

const cache = new Map<string, Promise<unknown>>();
function loadJson<T>(rel: string): Promise<T> {
  let p = cache.get(rel);
  if (!p) {
    p = fetch(`${DATA}/${rel}`, { cache: 'force-cache' }).then(async (r) => {
      if (!r.ok) throw new ApiError(r.status, r.status === 404 ? 'not found in the recording' : `${r.status} ${r.statusText}`);
      return r.json();
    });
    cache.set(rel, p);
  }
  return p as Promise<T>;
}

const REFUSED = 'Not available in the hosted replay: this is a recording of a real run. Run the node locally (make demo) for the live system.';
const TICK_MS = 100;
const DEFAULT_SPEED = 2;

class Replayer {
  private events: WsEvent[] = [];
  private idx = 0;
  private t0 = 0;
  private offsetMs = 0;
  private startedWall = 0;
  private timer: number | null = null;
  private delivered = new Set<number>();
  private loading: Promise<void> | null = null;
  private store: LiveStore | null = null;
  private finalDemo: DemoState | null = null;
  speed = DEFAULT_SPEED;
  running = false;

  // state reconstructed from the delivered events
  certs: CertEntry[] = [];
  candidates = new Map<string, Candidate>();
  cases = new Map<string, CaseSummary>();
  actions = new Map<string, Map<string, Action>>();
  reports = new Map<string, Report>();
  campaigns = new Map<string, Campaign>();
  evidence = new Map<string, EvidenceEvent>();
  audit: AuditEntry[] = [];
  metrics: Metrics | null = null;
  status: StatusResponse | null = null;
  fired = new Map<string, string>();

  ready(): Promise<void> {
    if (!this.loading) {
      this.loading = Promise.all([loadJson<WsEvent[]>('events.json'), loadJson<DemoState>('api/demo.json')]).then(([events, demo]) => {
        this.events = events.filter((e) => e.type !== 'hello');
        this.t0 = this.events.length ? Date.parse(this.events[0].at) : Date.now();
        this.finalDemo = demo;
      });
    }
    return this.loading;
  }

  attach(store: LiveStore) {
    this.store = store;
    store.setConnection('connecting');
    void this.ready().then(() => {
      if (this.store !== store) return;
      store.setConnection('connected');
      // A reload or a deep link continues where this browser left off instead of restarting the run.
      const saved = this.restore();
      if (saved) {
        this.speed = saved.speed;
        this.seek(saved.offsetMs);
      }
      this.start();
    });
  }

  private static KEY = 'saqr.replay';
  private lastSave = 0;

  private persist(force = false) {
    const now = Date.now();
    if (!force && now - this.lastSave < 1000) return;
    this.lastSave = now;
    try {
      localStorage.setItem(Replayer.KEY, JSON.stringify({ offsetMs: this.elapsedMs(), speed: this.speed }));
    } catch {
      /* private mode or storage disabled: the run simply restarts on reload */
    }
  }

  private restore(): { offsetMs: number; speed: number } | null {
    try {
      const raw = localStorage.getItem(Replayer.KEY);
      if (!raw) return null;
      const v = JSON.parse(raw) as { offsetMs?: number; speed?: number };
      if (typeof v.offsetMs !== 'number' || v.offsetMs <= 0) return null;
      return { offsetMs: v.offsetMs, speed: typeof v.speed === 'number' && v.speed > 0 ? v.speed : DEFAULT_SPEED };
    } catch {
      return null;
    }
  }

  /** Deliver everything up to `offsetMs` of scenario time at once (used after a reload). */
  private seek(offsetMs: number) {
    while (this.idx < this.events.length && Date.parse(this.events[this.idx].at) - this.t0 <= offsetMs) {
      this.deliver(this.idx);
      this.idx += 1;
    }
    this.offsetMs = Math.min(offsetMs, this.events.length ? Date.parse(this.events[this.events.length - 1].at) - this.t0 : 0);
  }

  detach() {
    this.stop();
    this.store = null;
  }

  elapsedMs(): number {
    return this.running ? this.offsetMs + (Date.now() - this.startedWall) * this.speed : this.offsetMs;
  }

  start(speed?: number) {
    if (speed) this.setSpeed(speed);
    if (this.running) return;
    this.running = true;
    this.startedWall = Date.now();
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    this.offsetMs = this.elapsedMs();
    this.running = false;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  setSpeed(speed: number) {
    const s = Math.max(0.1, speed);
    this.offsetMs = this.elapsedMs();
    this.startedWall = Date.now();
    this.speed = s;
    this.persist(true);
  }

  reset() {
    this.stop();
    this.idx = 0;
    this.offsetMs = 0;
    try {
      localStorage.removeItem(Replayer.KEY);
    } catch {
      /* ignore */
    }
    this.delivered.clear();
    this.certs = [];
    this.candidates.clear();
    this.cases.clear();
    this.actions.clear();
    this.reports.clear();
    this.campaigns.clear();
    this.evidence.clear();
    this.audit = [];
    this.metrics = null;
    this.status = null;
    this.fired.clear();
    this.store?.push({ type: 'demo', at: new Date().toISOString(), data: { step_id: '', label: 'Replay restarted from the beginning', kind: 'reset' } });
    this.start();
  }

  private tick() {
    const el = this.elapsedMs();
    while (this.idx < this.events.length && Date.parse(this.events[this.idx].at) - this.t0 <= el) {
      this.deliver(this.idx);
      this.idx += 1;
    }
    this.persist();
    if (this.idx >= this.events.length) this.stop();
  }

  private deliver(i: number) {
    if (this.delivered.has(i)) return;
    this.delivered.add(i);
    const ev = this.events[i];
    this.apply(ev);
    this.store?.push(ev);
  }

  private apply(ev: WsEvent) {
    switch (ev.type) {
      case 'cert':
        this.certs.unshift(ev.data);
        if (this.certs.length > 300) this.certs.length = 300;
        break;
      case 'candidate':
        this.candidates.delete(ev.data.id);
        this.candidates.set(ev.data.id, ev.data);
        break;
      case 'case':
        this.cases.delete(ev.data.id);
        this.cases.set(ev.data.id, ev.data);
        break;
      case 'action': {
        const m = this.actions.get(ev.data.case_id) ?? new Map<string, Action>();
        m.set(ev.data.id, ev.data);
        this.actions.set(ev.data.case_id, m);
        break;
      }
      case 'report':
        this.reports.set(ev.data.id, ev.data);
        break;
      case 'campaign':
        this.campaigns.set(ev.data.id, ev.data);
        break;
      case 'evidence':
        this.evidence.set(ev.data.case_id, ev.data);
        break;
      case 'audit':
        this.audit = [ev.data, ...this.audit.filter((a) => a.seq !== ev.data.seq)];
        break;
      case 'metrics':
        this.metrics = ev.data;
        break;
      case 'status':
        this.status = ev.data;
        break;
      case 'demo':
        if (ev.data.step_id) this.fired.set(ev.data.step_id, ev.at);
        break;
      default:
        break;
    }
  }

  demoState(): DemoState {
    const base: DemoState = this.finalDemo ?? { available: true, running: false, speed: this.speed, started_at: null, elapsed_s: 0, sites_url: '', steps: [] };
    return {
      ...base,
      running: this.running,
      speed: this.speed,
      started_at: new Date(Date.now() - this.elapsedMs() / this.speed).toISOString(),
      elapsed_s: Math.round(this.elapsedMs() / 100) / 10,
      steps: base.steps.map((s) => ({ ...s, fired: this.fired.has(s.id), fired_at: this.fired.get(s.id) ?? null })),
    };
  }

  jumpToStep(stepId: string) {
    const target = this.events.findIndex((e) => e.type === 'demo' && e.data.step_id === stepId);
    if (target < 0) throw new ApiError(404, 'unknown step');
    if (this.delivered.has(target)) return;
    const wasRunning = this.running;
    this.stop();
    for (let i = this.idx; i <= target; i++) this.deliver(i);
    this.idx = Math.max(this.idx, target + 1);
    this.offsetMs = Date.parse(this.events[target].at) - this.t0;
    if (wasRunning) this.start();
  }

  /** The one click: deliver the recorded approval → dispatch → acknowledgements for this case now, paced. */
  fastForwardCase(caseId: string, actor: string): Promise<{ case: CaseSummary; actions: Action[] }> {
    const summary = this.cases.get(caseId);
    if (!summary) throw new ApiError(404, 'case not found');
    if (summary.state !== 'open') throw new ApiError(409, `case is ${summary.state}, not open`);
    const first = this.events.findIndex(
      (e, i) => !this.delivered.has(i) && e.type === 'case' && e.data.id === caseId && (e.data.state === 'approved' || e.data.state === 'blocked'),
    );
    if (first < 0) throw new ApiError(409, 'No recorded response for this case: in the recorded run the analyst did not approve it.');
    const picked: number[] = [];
    for (let i = first; i < this.events.length; i++) {
      if (this.delivered.has(i)) continue;
      const e = this.events[i];
      const mine =
        (e.type === 'case' && e.data.id === caseId) ||
        (e.type === 'action' && e.data.case_id === caseId) ||
        (e.type === 'audit' && (e.data.subject === caseId || e.data.subject === summary.domain));
      if (mine) picked.push(i);
    }
    const patch = (ev: WsEvent): WsEvent => {
      if (ev.type === 'case' && ev.data.approved_by) return { ...ev, data: { ...ev.data, approved_by: actor } };
      if (ev.type === 'audit' && ev.data.actor && ev.data.actor !== 'system') return { ...ev, data: { ...ev.data, actor } };
      return ev;
    };
    const now = Date.now();
    picked.forEach((i, k) => {
      this.events[i] = patch(this.events[i]);
      // dispatch and acknowledgements arrive over the next seconds, like the real partners' receipts
      const delay = k === 0 ? 0 : Math.min(1500 + k * 700, 12000);
      window.setTimeout(() => this.deliver(i), delay);
      void now;
    });
    const approvedSummary = (this.events[first] as Extract<WsEvent, { type: 'case' }>).data;
    const actions = picked.map((i) => this.events[i]).filter((e): e is Extract<WsEvent, { type: 'action' }> => e.type === 'action');
    const firstPerAction = new Map<string, Action>();
    for (const a of actions) if (!firstPerAction.has(a.data.id)) firstPerAction.set(a.data.id, a.data);
    return Promise.resolve({ case: approvedSummary, actions: [...firstPerAction.values()] });
  }
}

export const replay = new Replayer();

const stamp = (x: object): string => {
  const r = x as Record<string, unknown>;
  return String(r.created_at ?? r.first_seen ?? r.received_at ?? r.at ?? '');
};
const sortNewest = <T extends object>(xs: T[]) => [...xs].sort((a, b) => stamp(b).localeCompare(stamp(a)));

export async function staticRequest<T>(path: string, init?: RequestInit): Promise<T> {
  await replay.ready();
  const url = new URL(path, 'http://static.local');
  const p = url.pathname;
  const q = url.searchParams;
  const method = (init?.method ?? 'GET').toUpperCase();
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  const limit = Number(q.get('limit') ?? 100);
  const out = (v: unknown) => v as T;

  if (method === 'GET') {
    if (p === '/status') {
      const s = replay.status ?? (await loadJson<StatusResponse>('api/initial/status.json'));
      return out({ ...s, demo: replay.demoState(), hosted_replay: true });
    }
    if (p === '/metrics') return out(replay.metrics ?? (await loadJson<Metrics>('api/initial/metrics.json')));
    if (p === '/feed') return out({ entries: replay.certs.slice(0, limit) });
    if (p === '/match') throw new ApiError(503, 'The name tester runs the matcher on the node. Run SAQR locally (make demo) to test names.');
    if (p === '/candidates') {
      const status = q.get('status');
      return out(sortNewest([...replay.candidates.values()].filter((c) => !status || c.status === status)).slice(0, limit));
    }
    if (p === '/cases') {
      const state = q.get('state');
      return out(sortNewest([...replay.cases.values()].filter((c) => !state || c.state === state)).slice(0, limit));
    }
    let m = p.match(/^\/cases\/([^/]+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const summary = replay.cases.get(id);
      if (!summary) throw new ApiError(404, 'case not found (not reached yet in the replay)');
      const detail = await loadJson<CaseDetail>(`api/cases/${id}.json`);
      const actions = sortNewest([...(replay.actions.get(id)?.values() ?? [])]).reverse();
      return out({ ...detail, summary, actions, evidence: replay.evidence.has(id) ? detail.evidence : null });
    }
    if (p === '/reports') return out(sortNewest([...replay.reports.values()]).slice(0, limit));
    if (p === '/campaigns') return out(sortNewest([...replay.campaigns.values()]));
    m = p.match(/^\/campaigns\/([^/]+)$/);
    if (m) {
      const c = replay.campaigns.get(decodeURIComponent(m[1]));
      if (!c) throw new ApiError(404, 'campaign not found');
      return out({
        campaign: c,
        reports: c.report_ids.map((r) => replay.reports.get(r)).filter(Boolean),
        cases: c.case_ids.map((x) => replay.cases.get(x)).filter(Boolean),
      });
    }
    if (p === '/actions') {
      const caseId = q.get('case_id');
      const all = caseId ? [...(replay.actions.get(caseId)?.values() ?? [])] : [...replay.actions.values()].flatMap((mm) => [...mm.values()]);
      return out(sortNewest(all).slice(0, limit));
    }
    if (p === '/audit') return out({ entries: replay.audit.slice(0, limit), valid: true, length: replay.audit.length });
    if (p === '/protected' || p === '/gallery' || p === '/connectors') return out(await loadJson(`api${p}.json`));
    if (p === '/demo') return out(replay.demoState());
    throw new ApiError(404, `no recording for ${p}`);
  }

  // ---- writes -----------------------------------------------------------------------------------
  const approve = p.match(/^\/cases\/([^/]+)\/approve$/);
  if (approve) return out(await replay.fastForwardCase(decodeURIComponent(approve[1]), String(body.actor ?? 'Analyst')));
  if (p === '/audit/verify') return out({ valid: true, length: replay.audit.length, broken_at: null });
  if (p === '/demo/start') {
    replay.start(typeof body.speed === 'number' ? body.speed : undefined);
    return out(replay.demoState());
  }
  if (p === '/demo/stop') {
    replay.stop();
    return out(replay.demoState());
  }
  if (p === '/demo/speed') {
    replay.setSpeed(Number(body.speed) || DEFAULT_SPEED);
    return out(replay.demoState());
  }
  if (p === '/demo/reset') {
    replay.reset();
    return out(replay.demoState());
  }
  if (p === '/demo/step') {
    replay.jumpToStep(String(body.step_id));
    return out(replay.demoState());
  }
  throw new ApiError(503, REFUSED);
}
