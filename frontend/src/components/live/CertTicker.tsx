import { memo, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Pause, ShieldCheck } from 'lucide-react';
import type { CaseSummary, CertEntry } from '../../api/types';
import { useLive } from '../../hooks/useLiveEvents';
import { fmtClock, fmtInt, shortIssuer, shortLog, toUnicodeDomain } from '../../lib/format';
import { Card, CardHeader } from '../ui/Card';
import { ScoreChip } from '../ui/Chip';
import { EmptyState } from '../ui/EmptyState';

const GRID = 'grid grid-cols-[58px_minmax(0,1fr)_minmax(110px,150px)_minmax(96px,132px)_52px] items-center gap-3 px-3';

const Row = memo(function Row({ e, threshold, linkedCase }: { e: CertEntry; threshold: number; linkedCase?: CaseSummary }) {
  const candidate = !e.allowlisted && e.match_score >= threshold;
  const first = e.domains[0] ?? '—';
  const shown = candidate && e.matched_domain ? toUnicodeDomain(e.matched_domain) : first;
  const more = e.domains.length - 1;
  const rowCls = e.allowlisted
    ? 'bg-emerald/[0.06] border-l-emerald'
    : candidate
      ? linkedCase?.verdict.label === 'confirmed_fake'
        ? 'bg-red/[0.07] border-l-red'
        : 'bg-amber/[0.07] border-l-amber'
      : 'border-l-transparent hover:bg-raised/50';
  const content = (
    <>
      <span className="font-mono tnum text-[11px] text-ink-4">{fmtClock(e.seen_at)}</span>
      <span className="min-w-0 flex items-center gap-2">
        <span className={`font-mono text-[12px] truncate ${e.allowlisted ? 'text-emerald' : candidate ? 'text-ink font-medium' : 'text-ink-2'}`} title={e.domains.join('\n')}>
          {shown}
        </span>
        {more > 0 && <span className="text-[11px] text-ink-4 shrink-0 tnum">+{more} more</span>}
        {e.allowlisted && <ShieldCheck className="size-3 text-emerald shrink-0" aria-label="allow-listed" />}
        {linkedCase && (
          <span className={`shrink-0 text-[10.5px] font-medium rounded px-1 ${linkedCase.verdict.label === 'confirmed_fake' ? 'text-red bg-red/10' : 'text-amber bg-amber/10'}`}>case ↗</span>
        )}
      </span>
      <span className="truncate text-[12px] text-ink-3" title={e.issuer}>
        {shortIssuer(e.issuer)}
      </span>
      <span className="truncate text-[11.5px] text-ink-4" title={`${e.log}${e.index != null ? ` · #${e.index}` : ''}`}>
        {shortLog(e.log)}
      </span>
      <span className="flex justify-end">
        <ScoreChip score={e.match_score} threshold={threshold} allowlisted={e.allowlisted} />
      </span>
    </>
  );
  const cls = `${GRID} h-[30px] border-l-2 text-[12px] animate-slide-in ${rowCls}`;
  return linkedCase ? (
    <Link to={`/cases/${linkedCase.id}`} className={`${cls} cursor-pointer`}>
      {content}
    </Link>
  ) : (
    <div className={cls}>{content}</div>
  );
});

export function CertTicker() {
  const certs = useLive((s) => s.certs);
  const certCount = useLive((s) => s.certCount);
  const cases = useLive((s) => s.cases);
  const status = useLive((s) => s.status);
  const connection = useLive((s) => s.connection);
  const bootstrapped = useLive((s) => s.bootstrapped);
  const threshold = status?.match_threshold ?? 35;

  const [paused, setPaused] = useState(false);
  const frozen = useRef<CertEntry[]>(certs);
  if (!paused) frozen.current = certs;
  const rows = paused ? frozen.current : certs;

  const caseByDomain = useMemo(() => {
    const m = new Map<string, CaseSummary>();
    for (const c of Object.values(cases)) m.set(c.domain, c);
    return m;
  }, [cases]);

  const candidates = useMemo(() => rows.filter((e) => !e.allowlisted && e.match_score >= threshold).length, [rows, threshold]);

  return (
    <Card padded={false} className="flex flex-col h-[584px] overflow-hidden">
      <div className="px-4 pt-3.5">
        <CardHeader
          title={
            <span className="inline-flex items-center gap-2">
              Certificate transparency feed
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-sky opacity-50 animate-ping" />
                <span className="relative inline-flex size-1.5 rounded-full bg-sky" />
              </span>
            </span>
          }
          titleAr="سجل الشهادات"
          subtitle={
            <>
              <span className="tnum text-ink-2">{fmtInt(certCount)}</span> certificates this session · {candidates} candidate{candidates === 1 ? '' : 's'} in view · threshold ≥ {threshold}
            </>
          }
          actions={
            paused ? (
              <span className="inline-flex items-center gap-1.5 text-[11.5px] text-amber">
                <Pause className="size-3" /> paused while hovering
              </span>
            ) : (
              <span className="text-[11.5px] text-ink-4">hover to pause</span>
            )
          }
        />
      </div>
      <div className={`${GRID} h-7 border-y border-line bg-sunken/60 label-xs`}>
        <span>time</span>
        <span>domain</span>
        <span>issuer</span>
        <span>log</span>
        <span className="text-right">score</span>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden relative" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
        {rows.length === 0 ? (
          connection !== 'connected' || !bootstrapped ? (
            <EmptyState icon={<Loader2 className="size-4 animate-spin" />} title="Waiting for the certificate stream" hint={connection === 'connected' ? 'Connected — the first certificates will appear in a moment.' : 'Connecting to /ws…'} />
          ) : (
            <EmptyState title="No certificates yet" hint="The feed is connected but idle. Start the scenario or inject a domain from the Presenter drawer (P)." />
          )
        ) : (
          <div className="divide-y divide-line/60">
            {rows.map((e) => (
              <Row key={e.id} e={e} threshold={threshold} linkedCase={e.matched_domain ? caseByDomain.get(e.matched_domain) : undefined} />
            ))}
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-surface to-transparent" />
      </div>
    </Card>
  );
}
