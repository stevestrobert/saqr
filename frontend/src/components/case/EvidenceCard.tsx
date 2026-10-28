import { Archive, BadgeCheck, Clock, Download, ExternalLink, FileText, GitCommitVertical, Loader2 } from 'lucide-react';
import type { CaseSummary, EvidencePackage } from '../../api/types';
import { urls } from '../../api/client';
import { fmtBytes, fmtExact, fmtInt } from '../../lib/format';
import { LinkButton } from '../ui/Button';
import { Card, CardHeader } from '../ui/Card';
import { Chip } from '../ui/Chip';
import { Mono } from '../ui/CopyButton';
import { EmptyState } from '../ui/EmptyState';
import { RelativeTime } from '../ui/RelativeTime';

const EXPECTED = ['screenshot_desktop.png', 'screenshot_mobile.png', 'page.html', 'dns.json', 'whois.json', 'certificate.pem', 'manifest.json'];

export function EvidenceCard({ summary, evidence, building }: { summary: CaseSummary; evidence: EvidencePackage | null; building: boolean }) {
  const fakeish = summary.verdict.label === 'confirmed_fake' || summary.verdict.label === 'suspicious';

  if (!evidence) {
    return (
      <Card>
        <CardHeader title="Evidence package" titleAr="حزمة الأدلة" subtitle="tamper-evident: hashed, Merkle-rooted, time-stamped" />
        {building && fakeish && summary.state !== 'false_positive' ? (
          <div>
            <div className="flex items-center gap-2 text-[12.5px] text-sky">
              <Loader2 className="size-4 animate-spin" />
              <span className="animate-pulse-soft">Building evidence package…</span>
            </div>
            <ul className="mt-3 space-y-1.5 opacity-50">
              {EXPECTED.map((n) => (
                <li key={n} className="flex items-center gap-2 text-[12px] text-ink-3">
                  <FileText className="size-3.5" />
                  <span className="font-mono">{n}</span>
                  <span className="ml-auto skeleton h-2.5 w-20" />
                </li>
              ))}
            </ul>
            <p className="text-[11.5px] text-ink-4 mt-3">Screenshots, HTML, DNS, WHOIS/RDAP, certificate and hosting records are hashed, chained into a Merkle root and time-stamped by a trusted authority.</p>
          </div>
        ) : (
          <EmptyState icon={<Archive className="size-4" />} title="No evidence package" hint={fakeish ? 'The package has not been built for this case.' : `Packages are only sealed for confirmed or suspicious pages (verdict: ${summary.verdict.label.replace('_', ' ')}).`} compact />
        )}
      </Card>
    );
  }

  const ts = evidence.timestamp;
  return (
    <Card>
      <CardHeader
        title="Evidence package"
        titleAr="حزمة الأدلة"
        subtitle={
          <>
            {fmtInt(evidence.artifacts.length)} artifacts · sealed <RelativeTime iso={evidence.created_at} />
          </>
        }
        actions={
          <Chip tone="emerald" size="xs" dot>
            tamper-evident
          </Chip>
        }
      />

      <ul className="divide-y divide-line/60 rounded-md border border-line bg-sunken/40 max-h-[232px] overflow-y-auto">
        {evidence.artifacts.map((a) => (
          <li key={a.name} className="px-2.5 py-1.5 flex items-center gap-2.5 text-[12px]">
            <FileText className="size-3.5 text-ink-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <a href={urls.evidenceArtifact(summary.id, a.name)} target="_blank" rel="noreferrer" className="font-mono text-ink hover:text-gold truncate block" title={a.description || a.mime}>
                {a.name}
              </a>
              <div className="text-[10.5px] text-ink-4 truncate">
                {a.mime} · {fmtBytes(a.size)}
                {a.description ? ` · ${a.description}` : ''}
              </div>
            </div>
            <Mono value={a.sha256} n={12} />
          </li>
        ))}
      </ul>

      <dl className="mt-3 space-y-1.5 text-[12px]">
        <div className="flex items-center gap-2">
          <dt className="text-ink-3 w-[96px] shrink-0 inline-flex items-center gap-1.5">
            <GitCommitVertical className="size-3.5" /> Merkle root
          </dt>
          <dd className="min-w-0">
            <Mono value={evidence.merkle_root} n={22} />
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="text-ink-3 w-[96px] shrink-0">manifest</dt>
          <dd className="min-w-0">
            <Mono value={evidence.manifest_sha256} n={22} />
          </dd>
        </div>
        {evidence.zip_sha256 && (
          <div className="flex items-center gap-2">
            <dt className="text-ink-3 w-[96px] shrink-0">zip sha-256</dt>
            <dd className="min-w-0">
              <Mono value={evidence.zip_sha256} n={22} />
            </dd>
          </div>
        )}
      </dl>

      <div className="mt-3 rounded-md border border-line p-2.5 bg-sunken/40">
        <div className="flex items-center gap-2 text-[12px]">
          <Clock className="size-3.5 text-ink-3" />
          <span className="text-ink font-medium">Trusted timestamp</span>
          {ts ? (
            <>
              <Chip tone={ts.kind === 'rfc3161' ? 'emerald' : 'amber'} size="xs" mono>
                {ts.kind === 'rfc3161' ? 'RFC 3161' : ts.kind.replace('_', ' ')}
              </Chip>
              {ts.verified && (
                <span className="inline-flex items-center gap-1 text-[11px] text-emerald ml-auto">
                  <BadgeCheck className="size-3.5" /> verified
                </span>
              )}
            </>
          ) : (
            <span className="text-ink-4 ml-auto text-[11.5px]">none</span>
          )}
        </div>
        {ts && (
          <div className="mt-1.5 text-[11.5px] text-ink-3 leading-snug">
            <span className="text-ink-2">{ts.authority}</span> · {fmtExact(ts.time)}
            {ts.note && <span className="text-ink-4"> · {ts.note}</span>}
            <div className="mt-1 flex items-center gap-1">
              <span>digest</span>
              <Mono value={ts.digest} n={18} />
            </div>
          </div>
        )}
      </div>

      {evidence.custody.length > 0 && (
        <div className="mt-3">
          <div className="label-xs mb-1.5">Chain of custody</div>
          <ol className="relative border-l border-line ml-1.5 space-y-2">
            {evidence.custody.map((c, i) => (
              <li key={i} className="pl-3.5 relative">
                <span className="absolute -left-[4.5px] top-1.5 size-2 rounded-full bg-emerald/80 border border-surface" />
                <div className="text-[12px] text-ink leading-snug">
                  {c.event}
                  <span className="text-ink-3"> · {c.actor}</span>
                </div>
                <div className="text-[11px] text-ink-4">
                  {fmtExact(c.at)}
                  {c.detail ? ` · ${c.detail}` : ''}
                  {c.hash ? ` · ${c.hash.slice(0, 10)}…` : ''}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="mt-3.5 flex items-center gap-2">
        <LinkButton to={urls.evidenceZip(summary.id)} download variant="subtle" size="md" icon={<Download className="size-3.5" />} className="flex-1">
          Download package (.zip)
        </LinkButton>
        <LinkButton to={urls.evidenceReport(summary.id)} external variant="outline" size="md" icon={<ExternalLink className="size-3.5" />} className="flex-1">
          Open report
        </LinkButton>
      </div>
    </Card>
  );
}
