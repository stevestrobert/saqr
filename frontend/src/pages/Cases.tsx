import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, ChevronRight, FolderSearch, Search } from 'lucide-react';
import { api } from '../api/client';
import type { CaseState, CaseSummary, VerdictLabel } from '../api/types';
import { useLive, useLiveStore } from '../hooks/useLiveEvents';
import { useFetch } from '../hooks/useFetch';
import { fmtInt, isPunycode, toUnicodeDomain } from '../lib/format';
import { sourceLabel, stateLabel, verdictLabel } from '../lib/tones';
import { Card } from '../components/ui/Card';
import { Chip, StateChip, VerdictChip } from '../components/ui/Chip';
import { EmptyState, ErrorState } from '../components/ui/EmptyState';
import { PageHeader } from '../components/ui/PageHeader';
import { RelativeTime } from '../components/ui/RelativeTime';
import { RiskBar } from '../components/ui/Risk';
import { SkeletonRows } from '../components/ui/Skeleton';
import { Thumb } from '../components/ui/Thumb';

type SortKey = 'detected_at' | 'risk' | 'report_count' | 'state' | 'domain' | 'progress';
const STATES: CaseState[] = ['open', 'approved', 'blocked', 'taken_down', 'monitoring', 'false_positive', 'closed'];
const VERDICTS: VerdictLabel[] = ['confirmed_fake', 'suspicious', 'benign', 'inactive', 'official'];

const progressOf = (c: CaseSummary) => (c.action_summary.total ? (c.action_summary.acknowledged + c.action_summary.completed) / c.action_summary.total : -1);

export function Cases() {
  const navigate = useNavigate();
  const store = useLiveStore();
  const liveCases = useLive((s) => s.cases);
  const { loading, error, reload } = useFetch(async () => {
    const list = await api.cases('', 100);
    store.mergeCases(list);
    return list;
  });

  const [q, setQ] = useState('');
  const [state, setState] = useState<CaseState | ''>('');
  const [verdict, setVerdict] = useState<VerdictLabel | ''>('');
  const [sort, setSort] = useState<SortKey>('detected_at');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    document.title = 'Cases · SAQR';
  }, []);

  const all = useMemo(() => Object.values(liveCases), [liveCases]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = all.filter(
      (c) =>
        (!state || c.state === state) &&
        (!verdict || c.verdict.label === verdict) &&
        (!needle || c.domain.includes(needle) || toUnicodeDomain(c.domain).includes(needle) || (c.protected_entity ?? '').toLowerCase().includes(needle) || c.title.toLowerCase().includes(needle)),
    );
    const sign = dir === 'asc' ? 1 : -1;
    return filtered.sort((a, b) => {
      switch (sort) {
        case 'risk':
          return sign * (a.verdict.risk - b.verdict.risk);
        case 'report_count':
          return sign * (a.report_count - b.report_count);
        case 'state':
          return sign * STATES.indexOf(a.state) - sign * STATES.indexOf(b.state);
        case 'domain':
          return sign * a.domain.localeCompare(b.domain);
        case 'progress':
          return sign * (progressOf(a) - progressOf(b));
        default:
          return sign * (Date.parse(a.detected_at) - Date.parse(b.detected_at));
      }
    });
  }, [all, q, state, verdict, sort, dir]);

  const counts = useMemo(() => {
    const m: Partial<Record<CaseState, number>> = {};
    for (const c of all) m[c.state] = (m[c.state] ?? 0) + 1;
    return m;
  }, [all]);

  const toggleSort = (k: SortKey) => {
    if (sort === k) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(k);
      setDir(k === 'domain' ? 'asc' : 'desc');
    }
  };

  const Th = ({ k, children, className = '' }: { k?: SortKey; children: ReactNode; className?: string }) => (
    <th className={`label-xs font-medium text-left px-3 h-8 whitespace-nowrap ${className}`}>
      {k ? (
        <button onClick={() => toggleSort(k)} className={`inline-flex items-center gap-1 hover:text-ink ${sort === k ? 'text-ink' : ''}`}>
          {children}
          {sort === k && (dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
        </button>
      ) : (
        children
      )}
    </th>
  );

  return (
    <div>
      <PageHeader
        title="Cases"
        titleAr="الحالات"
        subtitle={`${fmtInt(all.length)} cases · ${fmtInt(counts.open ?? 0)} awaiting approval · ${fmtInt((counts.blocked ?? 0) + (counts.taken_down ?? 0))} blocked or taken down`}
        actions={
          <div className="flex items-center gap-2">
            <label className="relative">
              <Search className="size-3.5 text-ink-4 absolute left-2 top-1/2 -translate-y-1/2" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search domain, entity, title" className="field pl-7 w-[240px]" />
            </label>
            <select value={state} onChange={(e) => setState(e.target.value as CaseState | '')} className="field">
              <option value="">All states</option>
              {STATES.map((s) => (
                <option key={s} value={s}>
                  {stateLabel[s]} {counts[s] ? `(${counts[s]})` : ''}
                </option>
              ))}
            </select>
            <select value={verdict} onChange={(e) => setVerdict(e.target.value as VerdictLabel | '')} className="field">
              <option value="">All verdicts</option>
              {VERDICTS.map((v) => (
                <option key={v} value={v}>
                  {verdictLabel[v]}
                </option>
              ))}
            </select>
          </div>
        }
      />

      <Card padded={false} className="overflow-hidden">
        {loading && all.length === 0 ? (
          <div className="p-4">
            <SkeletonRows rows={8} />
          </div>
        ) : error && all.length === 0 ? (
          <ErrorState message={error} onRetry={() => reload()} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<FolderSearch className="size-4" />} title={all.length ? 'No cases match these filters' : 'No cases yet'} hint={all.length ? 'Clear the search or widen the state / verdict filters.' : 'Cases appear as soon as a candidate is verified. Start the scenario from the Presenter drawer (P).'} />
        ) : (
          <table className="w-full table-fixed text-[12.5px]">
            <colgroup>
              <col style={{ width: 84 }} />
              <col />
              <col style={{ width: 118 }} />
              <col style={{ width: 88 }} />
              <col style={{ width: 132 }} />
              <col style={{ width: 112 }} />
              <col style={{ width: 64 }} />
              <col style={{ width: 172 }} />
              <col style={{ width: 28 }} />
            </colgroup>
            <thead className="bg-sunken/70 border-b border-line">
              <tr>
                <Th>Page</Th>
                <Th k="domain">Domain · entity imitated</Th>
                <Th>Verdict</Th>
                <Th k="risk">Risk</Th>
                <Th k="state">State</Th>
                <Th k="detected_at">Age · source</Th>
                <Th k="report_count" className="text-right">
                  Reports
                </Th>
                <Th k="progress">Response</Th>
                <Th> </Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {rows.map((c) => {
                const prog = progressOf(c);
                return (
                  <tr key={c.id} onClick={() => navigate(`/cases/${c.id}`)} className="cursor-pointer hover:bg-raised/60 transition-colors group">
                    <td className="px-3 py-2">
                      <Thumb src={c.thumbnail_url} alt="" className="w-[64px] h-[40px] rounded" placeholder="" />
                    </td>
                    <td className="px-3 py-2 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-mono text-[12.5px] text-ink truncate" title={c.domain}>
                          {toUnicodeDomain(c.domain)}
                        </span>
                        {isPunycode(c.domain) && (
                          <Chip tone="red" size="xs">
                            IDN
                          </Chip>
                        )}
                      </div>
                      <div className="text-[11.5px] text-ink-3 truncate" title={`${c.protected_entity ?? ''}${c.protected_domain ? ` (${c.protected_domain})` : ''} · ${c.title}`}>
                        {c.protected_entity ? (
                          <>
                            imitates <span className="text-ink-2">{c.protected_entity}</span>
                            {c.protected_domain && <span className="font-mono text-ink-4"> · {c.protected_domain}</span>}
                          </>
                        ) : (
                          c.title || '—'
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <VerdictChip label={c.verdict.label} size="xs" />
                    </td>
                    <td className="px-3 py-2">
                      <RiskBar risk={c.verdict.risk} width="w-10" />
                    </td>
                    <td className="px-3 py-2">
                      <StateChip state={c.state} size="xs" />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <RelativeTime iso={c.detected_at} className="text-ink-2" />
                      <div className="text-[11px] text-ink-4 truncate">{sourceLabel[c.source] ?? c.source}</div>
                    </td>
                    <td className="px-3 py-2 text-right tnum text-ink-2">{c.report_count || <span className="text-ink-4">0</span>}</td>
                    <td className="px-3 py-2">
                      {c.action_summary.total > 0 ? (
                        <div className="flex items-center gap-2" title={`${c.action_summary.acknowledged + c.action_summary.completed} of ${c.action_summary.total} partners confirmed · ${c.action_summary.failed} failed`}>
                          <div className="w-16 h-1.5 rounded-full bg-line overflow-hidden flex">
                            <div className="h-full bg-emerald" style={{ width: `${(c.action_summary.completed / c.action_summary.total) * 100}%` }} />
                            <div className="h-full bg-gold" style={{ width: `${(c.action_summary.acknowledged / c.action_summary.total) * 100}%` }} />
                            <div className="h-full bg-sky" style={{ width: `${(c.action_summary.sent / c.action_summary.total) * 100}%` }} />
                            <div className="h-full bg-red" style={{ width: `${(c.action_summary.failed / c.action_summary.total) * 100}%` }} />
                          </div>
                          <span className="tnum text-[11.5px] text-ink-2">
                            {c.action_summary.acknowledged + c.action_summary.completed}/{c.action_summary.total}
                          </span>
                          {prog >= 0 && c.action_summary.blocking_confirmed && <span className="text-[10.5px] text-emerald">blocking ✓</span>}
                        </div>
                      ) : (
                        <span className="text-ink-4 text-[11.5px]">{c.state === 'open' ? 'not dispatched' : '—'}</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-ink-4 group-hover:text-ink">
                      <ChevronRight className="size-4" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
