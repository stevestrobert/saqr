import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Mail, MessageSquare, MessageSquareWarning, Phone, Send, Waypoints } from 'lucide-react';
import { api } from '../api/client';
import type { Campaign, Report, ReportRequest, ReportResponse } from '../api/types';
import { useFetch } from '../hooks/useFetch';
import { useLive } from '../hooks/useLiveEvents';
import { fmtInt, toUnicodeDomain } from '../lib/format';
import { reportChannelLabel } from '../lib/tones';
import { Button } from '../components/ui/Button';
import { Card, CardHeader } from '../components/ui/Card';
import { Chip, VerdictChip } from '../components/ui/Chip';
import { EmptyState, ErrorState } from '../components/ui/EmptyState';
import { PageHeader } from '../components/ui/PageHeader';
import { RelativeTime } from '../components/ui/RelativeTime';
import { SkeletonCard, SkeletonRows } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';

const EXAMPLES: { channel: ReportRequest['channel']; sender: string; text: string }[] = [
  {
    channel: 'sms',
    sender: '+971 50 123 4567',
    text: 'RTA: You have an unpaid traffic fine of AED 1,120. Settle within 24 hours to avoid a travel ban: https://rta-fines-refund.com/pay',
  },
  {
    channel: 'whatsapp',
    sender: '+971 55 987 6543',
    text: 'بريد الإمارات: لم يتم توصيل شحنتك. يرجى دفع رسوم إعادة التوصيل 11.50 درهم خلال 48 ساعة emiratespost-redelivery.shop/track',
  },
  {
    channel: 'sms',
    sender: '+971 52 444 1212',
    text: 'Salik: your balance is negative (AED -45.00). Recharge now to avoid a AED 100 fine salik-recharge-ae[.]com',
  },
];

const channelIcon = (ch: string) => (ch === 'whatsapp' ? <Phone className="size-3.5" /> : ch === 'email' ? <Mail className="size-3.5" /> : ch === 'partner' || ch === 'feed' ? <Waypoints className="size-3.5" /> : <MessageSquare className="size-3.5" />);

export function Reports() {
  const { id: highlightId } = useParams();
  const reportsQ = useFetch(() => api.reports(100));
  const campaignsQ = useFetch(api.campaigns);
  const liveReports = useLive((s) => s.reports);
  const liveCampaigns = useLive((s) => s.campaigns);
  const cases = useLive((s) => s.cases);
  const { toast } = useToast();

  const [channel, setChannel] = useState<ReportRequest['channel']>('sms');
  const [text, setText] = useState('');
  const [sender, setSender] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ReportResponse | null>(null);

  useEffect(() => {
    document.title = 'Reports & Campaigns · SAQR';
  }, []);

  const reports = useMemo(() => {
    const m = new Map<string, Report>();
    for (const r of reportsQ.data ?? []) m.set(r.id, r);
    for (const r of liveReports) m.set(r.id, r);
    return [...m.values()].sort((a, b) => Date.parse(b.received_at) - Date.parse(a.received_at));
  }, [reportsQ.data, liveReports]);

  const campaigns = useMemo(() => {
    const m = new Map<string, Campaign>();
    for (const c of campaignsQ.data ?? []) m.set(c.id, c);
    for (const c of Object.values(liveCampaigns)) m.set(c.id, c);
    return [...m.values()].sort((a, b) => Date.parse(b.last_seen) - Date.parse(a.last_seen));
  }, [campaignsQ.data, liveCampaigns]);

  const caseByDomain = useMemo(() => new Map(Object.values(cases).map((c) => [c.domain, c])), [cases]);
  const caseById = useMemo(() => new Map(Object.values(cases).map((c) => [c.id, c])), [cases]);

  const submit = async () => {
    if (!text.trim()) return;
    setSubmitting(true);
    try {
      const res = await api.submitReport({ channel, text: text.trim(), sender: sender.trim() || undefined });
      setResult(res);
      setText('');
      setSender('');
      toast({
        title: res.candidates.length ? `${res.candidates.length} candidate${res.candidates.length === 1 ? '' : 's'} queued for verification` : 'Report filed — no URL found',
        description: res.campaign ? `Assigned to campaign “${res.campaign.name}”` : undefined,
        tone: res.candidates.length ? 'emerald' : 'slate',
      });
      void reportsQ.reload(true);
      void campaignsQ.reload(true);
    } catch (e) {
      toast({ title: 'Could not submit report', description: e instanceof Error ? e.message : String(e), tone: 'red' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Reports & Campaigns"
        titleAr="البلاغات والحملات"
        subtitle={`${fmtInt(reports.length)} forwarded messages · ${fmtInt(campaigns.length)} campaigns · fakes that never appear in certificate logs reach the same pipeline here`}
      />
      <div className="grid grid-cols-[440px_minmax(0,1fr)] gap-4">
        {/* left: intake + recent */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="Forward a suspicious message" titleAr="بلّغ عن رسالة" subtitle="SMS, WhatsApp, email or a partner submission. URLs are extracted, de-fanged and queued for verification." />
            <form
              className="space-y-2.5"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <div className="grid grid-cols-[130px_1fr] gap-2">
                <select value={channel} onChange={(e) => setChannel(e.target.value as ReportRequest['channel'])} className="field">
                  <option value="sms">SMS</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="email">Email</option>
                  <option value="partner">Partner</option>
                </select>
                <input value={sender} onChange={(e) => setSender(e.target.value)} placeholder="Sender (optional) — stored masked" className="field" />
              </div>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} placeholder="Paste the message text, including the link…" className="field w-full resize-y leading-relaxed" dir="auto" />
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1">
                  {EXAMPLES.map((x, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        setChannel(x.channel);
                        setSender(x.sender);
                        setText(x.text);
                      }}
                      className="text-[11px] text-ink-3 hover:text-ink bg-sunken border border-line rounded px-1.5 py-0.5"
                    >
                      example {i + 1}
                    </button>
                  ))}
                </div>
                <Button type="submit" variant="primary" loading={submitting} disabled={!text.trim()} icon={<Send className="size-3.5" />}>
                  Submit report
                </Button>
              </div>
            </form>

            {result && (
              <div className="mt-3 rounded-lg border border-line bg-sunken/50 p-3 animate-pop-in text-[12.5px]">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-ink">Report {result.report.id}</span>
                  <Chip tone="violet" size="xs">
                    {reportChannelLabel[result.report.channel] ?? result.report.channel} · {result.report.language || 'lang ?'}
                  </Chip>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 mt-2">
                  <dt className="text-ink-3">URLs</dt>
                  <dd className="font-mono text-[11.5px] text-ink-2 break-all">{result.report.urls.length ? result.report.urls.join('\n') : <span className="text-ink-4">none extracted</span>}</dd>
                  <dt className="text-ink-3">Candidates</dt>
                  <dd>
                    {result.candidates.length ? (
                      <ul className="space-y-1">
                        {result.candidates.map((c) => {
                          const kase = caseByDomain.get(c.domain);
                          return (
                            <li key={c.id} className="flex items-center gap-2">
                              <span className="font-mono text-ink">{toUnicodeDomain(c.domain)}</span>
                              <Chip tone="amber" size="xs">
                                {c.status}
                              </Chip>
                              {c.match && <span className="tnum text-[11px] text-ink-3">score {c.match.score}</span>}
                              {kase && (
                                <Link to={`/cases/${kase.id}`} className="text-[11px] text-gold hover:underline">
                                  open case ↗
                                </Link>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <span className="text-ink-4">none — no link in the message</span>
                    )}
                  </dd>
                  <dt className="text-ink-3">Campaign</dt>
                  <dd className="text-ink-2">{result.campaign ? `${result.campaign.name} · ${result.campaign.report_ids.length} reports` : <span className="text-ink-4">not clustered</span>}</dd>
                </dl>
              </div>
            )}
          </Card>

          <Card padded={false} className="overflow-hidden">
            <div className="px-4 pt-3.5">
              <CardHeader title="Recent reports" titleAr="آخر البلاغات" count={reports.length} />
            </div>
            {reportsQ.loading && reports.length === 0 ? (
              <div className="px-4 pb-4">
                <SkeletonRows rows={5} />
              </div>
            ) : reportsQ.error && reports.length === 0 ? (
              <ErrorState message={reportsQ.error} onRetry={() => reportsQ.reload()} />
            ) : reports.length === 0 ? (
              <EmptyState icon={<MessageSquareWarning className="size-4" />} title="No reports yet" hint="Forward a message above — the pipeline extracts the link and verifies the page." compact />
            ) : (
              <ul className="divide-y divide-line/70 max-h-[560px] overflow-y-auto">
                {reports.map((r) => (
                  <li key={r.id} className="px-4 py-2.5 hover:bg-raised/40">
                    <div className="flex items-center gap-2 text-[11.5px] text-ink-3">
                      <span className="text-violet">{channelIcon(r.channel)}</span>
                      <span className="text-ink-2 font-medium">{reportChannelLabel[r.channel] ?? r.channel}</span>
                      {r.sender_masked && <span className="font-mono">{r.sender_masked}</span>}
                      {r.language && <span className="uppercase text-[10px] border border-line rounded px-1">{r.language}</span>}
                      <span className="ml-auto">
                        <RelativeTime iso={r.received_at} />
                      </span>
                    </div>
                    <p className="text-[12.5px] text-ink mt-1 leading-snug" dir="auto">
                      {r.text}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      {r.domains.map((d) => {
                        const kase = caseByDomain.get(d);
                        return kase ? (
                          <Link key={d} to={`/cases/${kase.id}`} className="inline-flex items-center gap-1.5 font-mono text-[11px] text-ink-2 bg-sunken border border-line rounded px-1.5 py-px hover:border-line-strong">
                            {toUnicodeDomain(d)}
                            <VerdictChip label={kase.verdict.label} size="xs" />
                          </Link>
                        ) : (
                          <span key={d} className="font-mono text-[11px] text-ink-3 bg-sunken border border-line rounded px-1.5 py-px">
                            {toUnicodeDomain(d)}
                          </span>
                        );
                      })}
                      {r.campaign_id && (
                        <Link to={`/campaigns/${r.campaign_id}`} className="text-[11px] text-violet hover:underline ml-auto">
                          campaign ↗
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* right: campaigns */}
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <h2 className="text-[13px] font-semibold text-ink">
              Campaigns <span className="arabic text-[12px] text-ink-3 ml-1.5">الحملات</span>
            </h2>
            <span className="text-[11.5px] text-ink-3">messages clustered by lure text, domain and infrastructure</span>
          </div>
          {campaignsQ.loading && campaigns.length === 0 ? (
            <div className="grid grid-cols-2 gap-3">
              {[0, 1].map((i) => (
                <Card key={i}>
                  <SkeletonCard lines={5} />
                </Card>
              ))}
            </div>
          ) : campaignsQ.error && campaigns.length === 0 ? (
            <Card>
              <ErrorState message={campaignsQ.error} onRetry={() => campaignsQ.reload()} />
            </Card>
          ) : campaigns.length === 0 ? (
            <Card>
              <EmptyState icon={<Waypoints className="size-4" />} title="No campaigns yet" hint="Two or more related reports form a campaign." />
            </Card>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {campaigns.map((c) => {
                const campCases = c.case_ids.map((id) => caseById.get(id)).filter((x): x is NonNullable<typeof x> => Boolean(x));
                const highlighted = highlightId === c.id;
                return (
                  <Card key={c.id} className={highlighted ? 'ring-1 ring-gold/60' : ''}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-[13.5px] font-semibold text-ink leading-snug truncate" title={c.name}>
                          {c.name}
                        </h3>
                        <p className="text-[11.5px] text-ink-3 mt-0.5">
                          {c.entity ?? 'unknown entity'} · <span className="tnum">{c.report_ids.length}</span> reports · <span className="tnum">{c.domains.length}</span> domains
                        </p>
                      </div>
                      <Chip tone={c.status === 'active' ? 'red' : c.status === 'contained' ? 'emerald' : 'slate'} size="xs" dot>
                        {c.status}
                      </Chip>
                    </div>
                    {c.pattern && (
                      <blockquote className="mt-2.5 text-[12px] text-ink-2 italic leading-snug border-l-2 border-violet/50 pl-2.5" dir="auto">
                        “{c.pattern}”
                      </blockquote>
                    )}
                    <div className="mt-3 space-y-1">
                      {c.domains.map((d) => {
                        const kase = caseByDomain.get(d) ?? campCases.find((k) => k.domain === d);
                        return (
                          <div key={d} className="flex items-center gap-2 text-[12px]">
                            <span className="font-mono text-ink truncate">{toUnicodeDomain(d)}</span>
                            {kase ? (
                              <>
                                <VerdictChip label={kase.verdict.label} size="xs" />
                                <Link to={`/cases/${kase.id}`} className="ml-auto text-[11px] text-gold hover:underline shrink-0">
                                  case ↗
                                </Link>
                              </>
                            ) : (
                              <span className="text-[11px] text-ink-4 ml-auto">no case yet</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11.5px]">
                      <span className="text-ink-3">
                        first seen <RelativeTime iso={c.created_at} className="text-ink-2" />
                      </span>
                      <span className="text-ink-3">
                        last seen <RelativeTime iso={c.last_seen} className="text-ink-2" />
                      </span>
                    </div>
                    {Object.keys(c.infrastructure ?? {}).length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-1">
                        {Object.entries(c.infrastructure).flatMap(([k, vs]) =>
                          (vs ?? []).slice(0, 4).map((v) => (
                            <span key={`${k}-${v}`} className="font-mono text-[10.5px] text-ink-3 bg-sunken border border-line rounded px-1.5 py-px" title={k}>
                              <span className="text-ink-4">{k.replace(/s$/, '')}:</span> {v}
                            </span>
                          )),
                        )}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
