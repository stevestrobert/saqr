import { useEffect, useMemo, useState } from 'react';
import { BookMarked, Landmark, Search, ShieldCheck, Target } from 'lucide-react';
import { api } from '../api/client';
import type { MatchResult } from '../api/types';
import { useFetch } from '../hooks/useFetch';
import { useLive } from '../hooks/useLiveEvents';
import { fmtInt } from '../lib/format';
import { channelLabel } from '../lib/tones';
import { Button } from '../components/ui/Button';
import { Card, CardHeader } from '../components/ui/Card';
import { Chip } from '../components/ui/Chip';
import { EmptyState, ErrorState } from '../components/ui/EmptyState';
import { PageHeader } from '../components/ui/PageHeader';
import { SkeletonRows } from '../components/ui/Skeleton';

const EXAMPLES = ['rta-fines-refund.com', 'xn--tx-refund-gov-w1k.com', 'www.rta.ae', 'salik.com', 'dubai-properties.com', 'emiratspost.net'];

const reasonTone = (kind: string) => (['homoglyph', 'tld_swap', 'embedded_domain', 'typo', 'edit_distance', 'brand_token'].includes(kind) ? 'red' : kind === 'keyword' || kind === 'combo' ? 'amber' : 'slate');

function MatchCard({ result }: { result: MatchResult }) {
  const tone = result.allowlisted ? 'emerald' : result.is_candidate ? 'red' : 'slate';
  const maxW = Math.max(1, ...result.reasons.map((r) => r.weight));
  return (
    <div className="mt-3 rounded-lg border border-line bg-sunken/50 p-3 animate-pop-in">
      <div className="flex items-start gap-4">
        <div className="shrink-0 text-center w-[72px]">
          <div className={`text-[30px] leading-none font-semibold ${tone === 'red' ? 'text-red' : tone === 'emerald' ? 'text-emerald' : 'text-ink-2'}`}>{result.score}</div>
          <div className="label-xs mt-1">score</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[14px] text-ink">{result.unicode_domain}</span>
            {result.allowlisted ? (
              <Chip tone="emerald" dot>
                allow-listed — never blocked
              </Chip>
            ) : result.is_candidate ? (
              <Chip tone="red" dot>
                candidate
              </Chip>
            ) : (
              <Chip tone="slate" dot>
                not a candidate
              </Chip>
            )}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px] mt-1.5">
            {result.unicode_domain !== result.domain && (
              <>
                <dt className="text-ink-3">punycode</dt>
                <dd className="font-mono text-ink-2">{result.domain}</dd>
              </>
            )}
            <dt className="text-ink-3">skeleton</dt>
            <dd className="font-mono text-ink-2">
              {result.skeleton}
              {result.skeleton !== result.unicode_domain && <span className="text-red text-[11px] ml-2">confusable characters normalised</span>}
            </dd>
            <dt className="text-ink-3">protected</dt>
            <dd className="text-ink-2">
              {result.protected_entity ? (
                <>
                  {result.protected_entity} <span className="font-mono text-ink-3">({result.protected_domain})</span>
                </>
              ) : (
                '—'
              )}
            </dd>
            {result.tokens.length > 0 && (
              <>
                <dt className="text-ink-3">tokens</dt>
                <dd className="flex flex-wrap gap-1">
                  {result.tokens.map((t, i) => (
                    <span key={`${t}${i}`} className="font-mono text-[11px] bg-raised border border-line rounded px-1">
                      {t}
                    </span>
                  ))}
                </dd>
              </>
            )}
          </dl>
        </div>
      </div>
      {result.reasons.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {result.reasons.map((r, i) => (
            <li key={i} className="grid grid-cols-[110px_1fr_40px] items-center gap-3 text-[12px]">
              <Chip tone={reasonTone(r.kind)} size="xs" mono>
                {r.kind}
              </Chip>
              <div className="min-w-0">
                <div className="h-1.5 rounded-full bg-line overflow-hidden mb-1">
                  <div className={`h-full ${reasonTone(r.kind) === 'red' ? 'bg-red' : reasonTone(r.kind) === 'amber' ? 'bg-amber' : 'bg-slate'}`} style={{ width: `${(r.weight / maxW) * 100}%` }} />
                </div>
                <span className="text-ink-2 leading-snug">{r.detail}</span>
              </div>
              <span className="tnum text-right text-ink-2">+{r.weight}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Registry() {
  const reg = useFetch(api.protectedRegistry);
  const connectors = useFetch(api.connectors);
  const status = useLive((s) => s.status);
  const [q, setQ] = useState('');
  const [test, setTest] = useState('');
  const [result, setResult] = useState<MatchResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Registry · SAQR';
  }, []);

  const runTest = async (domain: string) => {
    const d = domain.trim().toLowerCase();
    if (!d) return;
    setTesting(true);
    setTestError(null);
    try {
      setResult(await api.match(d));
    } catch (e) {
      setTestError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  const entities = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = reg.data?.entities ?? [];
    if (!needle) return list;
    return list.filter((e) => [e.name, e.name_ar, e.sector, ...e.domains, ...e.brands, ...e.services].some((x) => x.toLowerCase().includes(needle)));
  }, [reg.data, q]);

  const sectors = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of reg.data?.entities ?? []) m.set(e.sector, (m.get(e.sector) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [reg.data]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Protected registry"
        titleAr="السجل المحمي"
        subtitle={reg.data ? `${fmtInt(reg.data.entities.length)} official entities · ${fmtInt(reg.data.entities.reduce((n, e) => n + e.domains.length, 0))} allow-listed domains · suffixes ${reg.data.official_suffixes.join(', ')} are never blocked` : 'Allow-list of official domains and the brand vocabulary the look-alike filter protects'}
      />

      <div className="grid grid-cols-[minmax(0,1fr)_420px] gap-4">
        {/* entities */}
        <Card padded={false} className="overflow-hidden">
          <div className="px-4 pt-3.5">
            <CardHeader
              title="Entities"
              titleAr="الجهات"
              count={entities.length}
              subtitle={sectors.length ? sectors.map(([s, n]) => `${s} ${n}`).join(' · ') : undefined}
              actions={
                <label className="relative">
                  <Search className="size-3.5 text-ink-4 absolute left-2 top-1/2 -translate-y-1/2" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter entities" className="field pl-7 w-[200px]" />
                </label>
              }
            />
          </div>
          {reg.loading ? (
            <div className="p-4">
              <SkeletonRows rows={8} />
            </div>
          ) : reg.error ? (
            <ErrorState message={reg.error} onRetry={() => reg.reload()} />
          ) : entities.length === 0 ? (
            <EmptyState icon={<Landmark className="size-4" />} title="No entities match" compact />
          ) : (
            <table className="w-full text-[12.5px]">
              <thead className="bg-sunken/70 border-y border-line">
                <tr className="label-xs text-left">
                  <th className="px-3 h-8 font-medium">Entity</th>
                  <th className="px-3 h-8 font-medium w-[90px]">Sector</th>
                  <th className="px-3 h-8 font-medium">Domains</th>
                  <th className="px-3 h-8 font-medium">Brands</th>
                  <th className="px-3 h-8 font-medium">Services</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {entities.map((e) => (
                  <tr key={e.id} className="hover:bg-raised/40 align-top">
                    <td className="px-3 py-2 max-w-[240px]">
                      <div className="text-ink font-medium leading-snug">{e.name}</div>
                      <div className="arabic text-[12px] text-ink-3 leading-snug" dir="rtl">
                        {e.name_ar}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-ink-3">{e.sector}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {e.domains.map((d) => (
                          <span key={d} className="inline-flex items-center gap-1 font-mono text-[11px] text-emerald bg-emerald/8 border border-emerald/20 rounded px-1.5 py-px">
                            <ShieldCheck className="size-2.5" />
                            {d}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {e.brands.map((b) => (
                          <span key={b} className="font-mono text-[11px] text-ink-2 bg-raised border border-line rounded px-1.5 py-px">
                            {b}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-ink-3 text-[12px] leading-snug max-w-[260px]">{e.services.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {/* right column */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="Test a name" titleAr="اختبار اسم" subtitle="Run the look-alike matcher against any domain (GET /api/match)" />
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void runTest(test);
              }}
            >
              <input value={test} onChange={(e) => setTest(e.target.value)} placeholder="e.g. rta-fines-refund.com" className="field flex-1 font-mono" spellCheck={false} />
              <Button type="submit" variant="primary" loading={testing} icon={<Target className="size-3.5" />} disabled={!test.trim()}>
                Test
              </Button>
            </form>
            <div className="flex flex-wrap gap-1 mt-2">
              {EXAMPLES.map((x) => (
                <button
                  key={x}
                  type="button"
                  onClick={() => {
                    setTest(x);
                    void runTest(x);
                  }}
                  className="font-mono text-[10.5px] text-ink-3 hover:text-ink bg-sunken border border-line rounded px-1.5 py-0.5"
                >
                  {x}
                </button>
              ))}
            </div>
            {testError && <p className="text-[12px] text-red mt-2">{testError}</p>}
            {result ? (
              <MatchCard result={result} />
            ) : (
              <p className="text-[12px] text-ink-4 mt-3">
                Threshold: a score of <span className="tnum text-ink-2">{status?.match_threshold ?? 40}</span> or more makes a name a candidate for verification. Official domains always score 0.
              </p>
            )}
          </Card>

          <Card>
            <CardHeader title="Lure vocabulary" titleAr="المفردات" subtitle="Keywords and cues that add weight when combined with a brand" />
            {reg.data ? (
              <div className="space-y-3">
                <WordCloud label="Strong lure keywords" words={reg.data.keywords.strong} tone="red" />
                <WordCloud label="Financial keywords" words={reg.data.keywords.normal} tone="amber" />
                <WordCloud label="Government cues" words={reg.data.government_cues} tone="slate" />
              </div>
            ) : (
              <SkeletonRows rows={3} />
            )}
          </Card>

          <Card>
            <CardHeader title="Response connectors" titleAr="قنوات الاستجابة" subtitle="Partners notified by one-click approval (GET /api/connectors)" count={connectors.data?.length} />
            {connectors.loading ? (
              <SkeletonRows rows={4} />
            ) : connectors.error ? (
              <ErrorState message={connectors.error} onRetry={() => connectors.reload()} />
            ) : !connectors.data?.length ? (
              <EmptyState icon={<BookMarked className="size-4" />} title="No connectors configured" compact />
            ) : (
              <ul className="divide-y divide-line/70">
                {connectors.data.map((c) => (
                  <li key={`${c.channel}-${c.name}`} className="py-2 flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[12.5px] font-medium text-ink">{c.name}</span>
                        <Chip tone={c.mode === 'live' ? 'emerald' : 'slate'} size="xs">
                          {c.mode}
                        </Chip>
                      </div>
                      <p className="text-[11.5px] text-ink-3 leading-snug">{c.description}</p>
                      <p className="text-[11px] text-ink-4 mt-0.5">
                        <span className="text-ink-3">{channelLabel[c.channel] ?? c.channel}</span> → {c.targets.join(', ')}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function WordCloud({ label, words, tone }: { label: string; words: string[]; tone: 'red' | 'amber' | 'slate' }) {
  const [all, setAll] = useState(false);
  const shown = all ? words : words.slice(0, 28);
  const cls = tone === 'red' ? 'text-red bg-red/8 border-red/20' : tone === 'amber' ? 'text-amber bg-amber/8 border-amber/20' : 'text-ink-2 bg-raised border-line';
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="label-xs">{label}</span>
        <span className="text-[11px] text-ink-4 tnum">{words.length}</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {shown.map((w) => (
          <span key={w} className={`font-mono text-[11px] border rounded px-1.5 py-px ${cls}`}>
            {w}
          </span>
        ))}
        {words.length > shown.length && (
          <button onClick={() => setAll(true)} className="text-[11px] text-gold hover:text-gold-2 px-1">
            +{words.length - shown.length} more
          </button>
        )}
      </div>
    </div>
  );
}
