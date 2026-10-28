import type { ActionStatus, CaseState, Channel, VerdictLabel, VerificationStage } from '../api/types';

/** A semantic tone drives chip/bar/ring colours. */
export type Tone = 'red' | 'amber' | 'emerald' | 'slate' | 'sky' | 'gold' | 'violet';

export const toneClasses: Record<Tone, { chip: string; dot: string; text: string; bar: string; ring: string; soft: string }> = {
  red: { chip: 'bg-red/12 text-red border-red/30', dot: 'bg-red', text: 'text-red', bar: 'bg-red', ring: '#f0575a', soft: 'bg-red/8' },
  amber: { chip: 'bg-amber/12 text-amber border-amber/30', dot: 'bg-amber', text: 'text-amber', bar: 'bg-amber', ring: '#f5b53b', soft: 'bg-amber/8' },
  emerald: { chip: 'bg-emerald/12 text-emerald border-emerald/30', dot: 'bg-emerald', text: 'text-emerald', bar: 'bg-emerald', ring: '#3ccf91', soft: 'bg-emerald/8' },
  slate: { chip: 'bg-slate/12 text-ink-2 border-slate/30', dot: 'bg-slate', text: 'text-ink-2', bar: 'bg-slate', ring: '#7d8da0', soft: 'bg-slate/8' },
  sky: { chip: 'bg-sky/12 text-sky border-sky/30', dot: 'bg-sky', text: 'text-sky', bar: 'bg-sky', ring: '#5aa8f0', soft: 'bg-sky/8' },
  gold: { chip: 'bg-gold/12 text-gold border-gold/30', dot: 'bg-gold', text: 'text-gold', bar: 'bg-gold', ring: '#e3b341', soft: 'bg-gold/8' },
  violet: { chip: 'bg-violet/12 text-violet border-violet/30', dot: 'bg-violet', text: 'text-violet', bar: 'bg-violet', ring: '#a78bfa', soft: 'bg-violet/8' },
};

export const verdictTone: Record<VerdictLabel, Tone> = {
  confirmed_fake: 'red',
  suspicious: 'amber',
  benign: 'slate',
  inactive: 'slate',
  official: 'emerald',
};

export const verdictLabel: Record<VerdictLabel, string> = {
  confirmed_fake: 'Confirmed fake',
  suspicious: 'Suspicious',
  benign: 'Benign',
  inactive: 'Inactive',
  official: 'Official',
};

export const stateTone: Record<CaseState, Tone> = {
  open: 'amber',
  approved: 'sky',
  blocked: 'emerald',
  taken_down: 'emerald',
  monitoring: 'slate',
  false_positive: 'slate',
  closed: 'slate',
};

export const stateLabel: Record<CaseState, string> = {
  open: 'Awaiting approval',
  approved: 'Dispatching',
  blocked: 'Blocked',
  taken_down: 'Taken down',
  monitoring: 'Monitoring',
  false_positive: 'False positive',
  closed: 'Closed',
};

export const actionTone: Record<ActionStatus, Tone> = {
  pending: 'slate',
  sent: 'sky',
  acknowledged: 'gold',
  completed: 'emerald',
  failed: 'red',
};

export const actionLabel: Record<ActionStatus, string> = {
  pending: 'Pending',
  sent: 'Sent',
  acknowledged: 'Acknowledged',
  completed: 'Completed',
  failed: 'Failed',
};

export const channelLabel: Record<Channel, string> = {
  registrar: 'Registrar',
  hosting: 'Hosting provider',
  telecom: 'Telecom operators',
  browser: 'Browser blocklists',
  bank: 'Banks & wallets',
  certificate_authority: 'Certificate authority',
  national_cert: 'National CERT',
};

export const stageLabel: Record<VerificationStage, string> = {
  queued: 'Queued for verification',
  opening: 'Opening in isolated browser',
  captured: 'Page captured',
  analysing: 'Comparing with official gallery',
  scored: 'Verdict scored',
  evidence: 'Sealing evidence package',
  done: 'Verification complete',
  error: 'Verification error',
  recheck: 'Scheduled re-check',
};

export const riskTone = (risk: number): Tone => (risk >= 75 ? 'red' : risk >= 45 ? 'amber' : 'slate');

/** Field categories that mean the page harvests payment or identity secrets. */
export const sensitiveCategories = new Set(['card_number', 'cvv', 'expiry', 'otp', 'emirates_id', 'password', 'iban', 'cardholder']);

export const sourceLabel: Record<string, string> = {
  ct_log: 'CT log',
  certstream: 'Certstream',
  replay: 'CT replay',
  citizen_report: 'Citizen report',
  partner_report: 'Partner report',
  threat_feed: 'Threat feed',
  manual: 'Manual',
};

export const reportChannelLabel: Record<string, string> = {
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  email: 'Email',
  partner: 'Partner',
  feed: 'Feed',
  manual: 'Manual',
};
