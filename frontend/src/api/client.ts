import type {
  ApproveRequest,
  ApproveResponse,
  AuditResponse,
  AuditVerifyResponse,
  CampaignDetail,
  Campaign,
  Candidate,
  CaseDetail,
  CaseSummary,
  Channel,
  Connector,
  DemoState,
  DismissRequest,
  FeedResponse,
  GalleryItem,
  IntakeUrlRequest,
  MatchResult,
  Metrics,
  ProtectedRegistry,
  Report,
  ReportRequest,
  ReportResponse,
  StatusResponse,
  Action,
  CaseState,
  CandidateStatus,
} from './types';
import { STATIC, staticRequest, staticUrls } from './staticBackend';

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (STATIC) return staticRequest<T>(path, init);
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      ...init,
      headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
    });
  } catch (e) {
    throw new ApiError(0, 'Backend unreachable', e);
  }
  if (!res.ok) {
    let detail: unknown = undefined;
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      detail = body;
      if (typeof body?.detail === 'string') message = body.detail;
      else if (typeof body?.message === 'string') message = body.message;
      else if (typeof body?.error === 'string') message = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

const qs = (params: Record<string, string | number | undefined | null>) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
};

export const api = {
  // status & metrics
  status: () => get<StatusResponse>('/status'),
  metrics: () => get<Metrics>('/metrics'),

  // live feed / registry match
  feed: (limit = 200) => get<FeedResponse>(`/feed${qs({ limit })}`),
  match: (domain: string) => get<MatchResult>(`/match${qs({ domain })}`),

  // candidates & cases
  candidates: (status?: CandidateStatus | '', limit = 100) => get<Candidate[]>(`/candidates${qs({ status, limit })}`),
  cases: (state?: CaseState | '', limit = 100) => get<CaseSummary[]>(`/cases${qs({ state, limit })}`),
  case: (id: string) => get<CaseDetail>(`/cases/${encodeURIComponent(id)}`),
  approve: (id: string, body: ApproveRequest) => post<ApproveResponse>(`/cases/${encodeURIComponent(id)}/approve`, body),
  dismiss: (id: string, body: DismissRequest) => post<CaseSummary>(`/cases/${encodeURIComponent(id)}/dismiss`, body),
  recheck: (id: string) => post<Candidate>(`/cases/${encodeURIComponent(id)}/recheck`),
  note: (id: string, actor: string, note: string) => post<CaseSummary>(`/cases/${encodeURIComponent(id)}/note`, { actor, note }),

  // reports & campaigns
  reports: (limit = 100) => get<Report[]>(`/reports${qs({ limit })}`),
  submitReport: (body: ReportRequest) => post<ReportResponse>('/reports', body),
  intakeUrl: (body: IntakeUrlRequest) => post<Candidate>('/intake/url', body),
  campaigns: () => get<Campaign[]>('/campaigns'),
  campaign: (id: string) => get<CampaignDetail>(`/campaigns/${encodeURIComponent(id)}`),

  // actions, audit, registry, gallery, connectors
  actions: (caseId?: string, limit = 200) => get<Action[]>(`/actions${qs({ case_id: caseId, limit })}`),
  audit: (limit = 200) => get<AuditResponse>(`/audit${qs({ limit })}`),
  verifyAudit: () => post<AuditVerifyResponse>('/audit/verify'),
  protectedRegistry: () => get<ProtectedRegistry>('/protected'),
  gallery: () => get<GalleryItem[]>('/gallery'),
  connectors: () => get<Connector[]>('/connectors'),

  // demo / presenter
  demo: () => get<DemoState>('/demo'),
  demoStart: (speed?: number) => post<DemoState>('/demo/start', speed ? { speed } : {}),
  demoStop: () => post<DemoState>('/demo/stop'),
  demoSpeed: (speed: number) => post<DemoState>('/demo/speed', { speed }),
  demoReset: () => post<DemoState>('/demo/reset'),
  demoInject: (domain: string, issuer?: string) => post<{ injected: boolean }>('/demo/inject', { domain, issuer }),
  demoStep: (step_id: string) => post<DemoState>('/demo/step', { step_id }),
};

// URL helpers for binary resources (images, downloads) — not fetched as JSON.
const liveUrls = {
  screenshot: (caseId: string, view: 'desktop' | 'mobile' = 'desktop', thumb = false) =>
    `${BASE}/cases/${encodeURIComponent(caseId)}/screenshot${qs({ view, thumb: thumb ? 1 : 0 })}`,
  evidenceZip: (caseId: string) => `${BASE}/cases/${encodeURIComponent(caseId)}/evidence.zip`,
  evidenceReport: (caseId: string) => `${BASE}/cases/${encodeURIComponent(caseId)}/evidence/report`,
  evidenceArtifact: (caseId: string, name: string) =>
    `${BASE}/cases/${encodeURIComponent(caseId)}/evidence/${encodeURIComponent(name)}`,
  galleryScreenshot: (refId: string) => `${BASE}/gallery/${encodeURIComponent(refId)}/screenshot`,
};
export const urls = {
  ...(STATIC ? staticUrls : liveUrls),
  websocket: () => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${window.location.host}/ws`;
  },
};

export const ALL_CHANNELS: Channel[] = ['registrar', 'hosting', 'telecom', 'browser', 'bank', 'certificate_authority', 'national_cert'];
