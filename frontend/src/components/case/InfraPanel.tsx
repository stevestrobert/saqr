import type { ReactNode } from 'react';
import { Database, FileKey, Globe, Server } from 'lucide-react';
import type { Candidate, Capture, EvidencePackage } from '../../api/types';
import { fmtDate, fmtExact, fmtInt, humanize, shortIssuer } from '../../lib/format';
import { Card, CardHeader } from '../ui/Card';
import { Mono } from '../ui/CopyButton';
import { SkeletonRows } from '../ui/Skeleton';

type Dict = Record<string, unknown> | undefined | null;

const str = (v: unknown): string | null => {
  if (v === null || v === undefined || v === '') return null;
  if (Array.isArray(v)) return v.length ? v.map(String).join(', ') : null;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};
const pick = (d: Dict, ...keys: string[]): string | null => {
  if (!d) return null;
  for (const k of keys) {
    const s = str(d[k]);
    if (s) return s;
  }
  return null;
};
const isDateLike = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}T/.test(s);
const fmtMaybeDate = (s: string | null) => (isDateLike(s) ? fmtExact(s) : s);

function Group({ icon, title, rows }: { icon: ReactNode; title: string; rows: { k: string; v: ReactNode | string | null; mono?: boolean }[] }) {
  const shown = rows.filter((r) => r.v !== null && r.v !== undefined && r.v !== '');
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-ink mb-1.5">
        <span className="text-ink-3">{icon}</span>
        {title}
      </div>
      {shown.length === 0 ? (
        <p className="text-[11.5px] text-ink-4">not available</p>
      ) : (
        <dl className="space-y-1">
          {shown.map((r) => (
            <div key={r.k} className="grid grid-cols-[92px_minmax(0,1fr)] gap-2 text-[12px]">
              <dt className="text-ink-3 truncate">{r.k}</dt>
              <dd className={`text-ink-2 min-w-0 break-words ${r.mono ? 'font-mono text-[11.5px]' : ''}`}>{r.v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export function InfraPanel({ capture, evidence, candidate, loading }: { capture: Capture | null; evidence: EvidencePackage | null; candidate: Candidate | null; loading: boolean }) {
  if (loading) {
    return (
      <Card>
        <CardHeader title="Infrastructure" titleAr="البنية التحتية" />
        <SkeletonRows rows={4} />
      </Card>
    );
  }
  const hosting = evidence?.hosting;
  const reg = evidence?.registration;
  const cert = evidence?.certificate;
  const ct = evidence?.ct_entry;
  const dns = evidence?.dns;
  const tls = capture?.tls;

  const extra = (d: Dict, used: string[]) =>
    d
      ? Object.entries(d)
          .filter(([k, v]) => !used.includes(k) && str(v) && typeof v !== 'object')
          .slice(0, 4)
          .map(([k, v]) => ({ k: humanize(k), v: fmtMaybeDate(str(v)) }))
      : [];

  return (
    <Card>
      <CardHeader title="Infrastructure" titleAr="البنية التحتية" subtitle="where the page lives — collected into the evidence package and sent with every takedown request" />
      <div className="grid grid-cols-2 gap-x-8 gap-y-5">
        <Group
          icon={<Server className="size-3.5" />}
          title="Hosting"
          rows={[
            { k: 'IP', v: capture?.ip || pick(hosting, 'ip', 'ips', 'address'), mono: true },
            { k: 'resolved', v: capture?.resolved_via || pick(dns, 'resolver') },
            { k: 'ASN', v: pick(hosting, 'asn', 'as_number', 'as'), mono: true },
            { k: 'provider', v: pick(hosting, 'org', 'provider', 'as_name', 'isp', 'name') },
            { k: 'country', v: pick(hosting, 'country', 'country_code') },
            { k: 'abuse', v: pick(hosting, 'abuse_contact', 'abuse', 'abuse_email'), mono: true },
            { k: 'nameservers', v: pick(dns, 'ns', 'nameservers'), mono: true },
            ...extra(hosting, ['ip', 'ips', 'address', 'asn', 'as_number', 'as', 'org', 'provider', 'as_name', 'isp', 'name', 'country', 'country_code', 'abuse_contact', 'abuse', 'abuse_email']),
          ]}
        />
        <Group
          icon={<Globe className="size-3.5" />}
          title="Registration"
          rows={[
            { k: 'registrar', v: pick(reg, 'registrar', 'registrar_name') },
            { k: 'created', v: fmtMaybeDate(pick(reg, 'created', 'creation_date', 'registered', 'created_at')) },
            { k: 'expires', v: fmtMaybeDate(pick(reg, 'expires', 'expiration_date', 'expiry')) },
            { k: 'status', v: pick(reg, 'status', 'statuses') },
            { k: 'registrant', v: pick(reg, 'registrant', 'registrant_country', 'registrant_org') },
            { k: 'abuse', v: pick(reg, 'abuse_contact', 'abuse_email', 'abuse'), mono: true },
            { k: 'source', v: pick(reg, 'source', 'rdap_url') },
            ...extra(reg, ['registrar', 'registrar_name', 'created', 'creation_date', 'registered', 'created_at', 'expires', 'expiration_date', 'expiry', 'status', 'statuses', 'registrant', 'registrant_country', 'registrant_org', 'abuse_contact', 'abuse_email', 'abuse', 'source', 'rdap_url']),
          ]}
        />
        <Group
          icon={<FileKey className="size-3.5" />}
          title="Certificate"
          rows={[
            { k: 'issuer', v: shortIssuer(tls?.issuer || pick(cert, 'issuer') || '') || null },
            { k: 'valid from', v: tls?.valid_from ? fmtExact(tls.valid_from) : fmtMaybeDate(pick(cert, 'not_before', 'valid_from')) },
            { k: 'valid to', v: tls?.valid_to ? fmtDate(tls.valid_to) : fmtMaybeDate(pick(cert, 'not_after', 'valid_to')) },
            { k: 'protocol', v: tls?.protocol || pick(cert, 'protocol') },
            { k: 'SANs', v: tls?.sans?.length ? `${fmtInt(tls.sans.length)} · ${tls.sans.slice(0, 2).join(', ')}${tls.sans.length > 2 ? '…' : ''}` : pick(cert, 'sans', 'domains'), mono: true },
            { k: 'sha-256', v: tls?.fingerprint_sha256 || pick(cert, 'fingerprint_sha256', 'fingerprint') ? <Mono value={tls?.fingerprint_sha256 || pick(cert, 'fingerprint_sha256', 'fingerprint')} n={16} /> : null },
          ]}
        />
        <Group
          icon={<Database className="size-3.5" />}
          title="CT log entry"
          rows={[
            { k: 'log', v: pick(ct, 'log', 'log_name', 'name') },
            { k: 'index', v: pick(ct, 'index', 'leaf_index'), mono: true },
            { k: 'logged', v: fmtMaybeDate(pick(ct, 'issued_at', 'timestamp', 'logged_at')) },
            { k: 'precert', v: ct && 'is_precert' in ct ? String(ct.is_precert) : null },
            { k: 'leaf hash', v: pick(ct, 'fingerprint', 'leaf_hash') ? <Mono value={pick(ct, 'fingerprint', 'leaf_hash')} n={16} /> : null },
            { k: 'cert id', v: candidate?.cert_id ?? pick(ct, 'id'), mono: true },
            { k: 'first seen', v: candidate ? fmtExact(candidate.first_seen) : null },
          ]}
        />
      </div>
    </Card>
  );
}
