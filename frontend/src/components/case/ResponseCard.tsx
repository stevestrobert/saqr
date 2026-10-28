import { useMemo, useState } from 'react';
import { AlertTriangle, Ban, Building2, Chrome, FileKey2, Flag, Globe, Landmark, RadioTower, RefreshCw, Server, ShieldCheck, ShieldOff, Zap } from 'lucide-react';
import { api } from '../../api/client';
import type { Action, ApproveResponse, Candidate, CaseSummary, Channel, Connector } from '../../api/types';
import { CHANNELS } from '../../api/types';
import { useFetch } from '../../hooks/useFetch';
import { fmtDuration, parseTime } from '../../lib/format';
import { channelLabel } from '../../lib/tones';
import { Button } from '../ui/Button';
import { Card, CardHeader } from '../ui/Card';
import { ActionChip, Chip } from '../ui/Chip';
import { RelativeTime } from '../ui/RelativeTime';
import { useToast } from '../ui/Toast';
import { ApproveModal } from './ApproveModal';
import { DismissModal } from './DismissModal';

export const channelIcon = (ch: Channel, cls = 'size-3.5') =>
  ch === 'registrar' ? <Globe className={cls} /> : ch === 'hosting' ? <Server className={cls} /> : ch === 'telecom' ? <RadioTower className={cls} /> : ch === 'browser' ? <Chrome className={cls} /> : ch === 'bank' ? <Landmark className={cls} /> : ch === 'certificate_authority' ? <FileKey2 className={cls} /> : <Flag className={cls} />;

export function ResponseCard({
  summary,
  actions,
  onApproved,
  onDismissed,
  onRechecked,
}: {
  summary: CaseSummary;
  actions: Action[];
  onApproved: (r: ApproveResponse) => void;
  onDismissed: (s: CaseSummary) => void;
  onRechecked: (c: Candidate) => void;
}) {
  const connectors = useFetch(api.connectors);
  const { toast } = useToast();
  const [approveOpen, setApproveOpen] = useState(false);
  const [dismissOpen, setDismissOpen] = useState(false);
  const [rechecking, setRechecking] = useState(false);

  const fakeish = summary.verdict.label === 'confirmed_fake' || summary.verdict.label === 'suspicious';
  const canApprove = summary.state === 'open' && fakeish;
  const dispatched = actions.length > 0 || ['approved', 'blocked', 'taken_down'].includes(summary.state);
  const sum = summary.action_summary;
  const confirmed = actions.filter((a) => a.status === 'acknowledged' || a.status === 'completed').length;
  const failed = actions.filter((a) => a.status === 'failed').length;
  const exposure = parseTime(summary.blocked_at ?? summary.taken_down_at) !== null ? parseTime(summary.blocked_at ?? summary.taken_down_at)! - parseTime(summary.detected_at)! : null;

  const byChannel = useMemo(() => {
    const m = new Map<Channel, Action[]>();
    for (const a of actions) m.set(a.channel, [...(m.get(a.channel) ?? []), a]);
    return m;
  }, [actions]);

  const recheck = async () => {
    setRechecking(true);
    try {
      onRechecked(await api.recheck(summary.id));
    } catch (e) {
      toast({ title: 'Re-check failed', description: e instanceof Error ? e.message : String(e), tone: 'red' });
    } finally {
      setRechecking(false);
    }
  };

  return (
    <Card className={canApprove ? 'border-gold/30 shadow-[0_0_0_1px_rgb(227_179_65/0.08),0_12px_40px_-16px_rgb(227_179_65/0.35)]' : ''}>
      <CardHeader
        title="Response"
        titleAr="الاستجابة"
        subtitle={
          dispatched
            ? `${confirmed} of ${actions.length || sum.total} partners confirmed${failed ? ` · ${failed} failed` : ''}${exposure !== null ? ` · exposure ${fmtDuration(exposure)}` : ''}`
            : canApprove
              ? 'one click fans out takedown and blocking requests to every partner'
              : 'no response dispatched'
        }
        actions={
          summary.state === 'blocked' || summary.state === 'taken_down' ? (
            <Chip tone="emerald" dot>
              {summary.state === 'taken_down' ? 'taken down' : 'blocking confirmed'}
            </Chip>
          ) : summary.state === 'approved' ? (
            <Chip tone="sky" dot pulse>
              dispatching
            </Chip>
          ) : undefined
        }
      />

      {canApprove && (
        <div className="mb-4">
          <ul className="space-y-1 mb-3 text-[12px]">
            <li className="flex items-center gap-2 text-ink-2">
              <ShieldCheck className="size-3.5 text-emerald" /> Not on the official allow-list
              {summary.protected_domain && <span className="text-ink-4 font-mono text-[11px]">(official: {summary.protected_domain})</span>}
            </li>
            <li className="flex items-center gap-2 text-ink-2">
              <ShieldCheck className="size-3.5 text-emerald" /> Human sign-off required before any block
            </li>
            <li className="flex items-center gap-2 text-ink-2">
              {summary.has_evidence ? <ShieldCheck className="size-3.5 text-emerald" /> : <AlertTriangle className="size-3.5 text-amber" />}
              {summary.has_evidence ? 'Evidence package sealed and time-stamped' : 'Evidence package still building'}
            </li>
          </ul>
          <Button variant="primary" size="lg" className="w-full text-[14px]" icon={<Zap className="size-4" />} onClick={() => setApproveOpen(true)}>
            Approve &amp; block everywhere
          </Button>
          <p className="text-center text-[11px] text-ink-4 mt-1.5 arabic">اعتماد الحظر لدى جميع الشركاء</p>
        </div>
      )}

      {summary.state === 'monitoring' && (
        <div className="mb-4 rounded-md border border-line bg-sunken/50 p-3 text-[12.5px] text-ink-2 flex items-start gap-2">
          <RefreshCw className="size-4 text-ink-3 mt-px" />
          <div>
            The page was unreachable or parked when captured. It is re-checked periodically and promoted to a case the moment it goes live.
          </div>
        </div>
      )}
      {summary.state === 'false_positive' && (
        <div className="mb-4 rounded-md border border-line bg-sunken/50 p-3 text-[12.5px] text-ink-2 flex items-start gap-2">
          <ShieldOff className="size-4 text-ink-3 mt-px" />
          <div>Dismissed by an analyst as a false positive. No partner was contacted.</div>
        </div>
      )}

      {/* channels */}
      <div className="rounded-md border border-line divide-y divide-line/60 bg-sunken/30">
        {CHANNELS.map((ch) => {
          const acts = byChannel.get(ch) ?? [];
          const conn = connectors.data?.find((c) => c.channel === ch);
          if (acts.length === 0 && !conn && !canApprove) return null;
          return (
            <div key={ch} className="px-3 py-2">
              <div className="flex items-center gap-2 text-[12px]">
                <span className="text-ink-3">{channelIcon(ch)}</span>
                <span className="font-medium text-ink">{channelLabel[ch]}</span>
                {acts.length === 0 && (
                  <span className="ml-auto text-[11px] text-ink-4">
                    {dispatched ? 'not included' : conn ? `will notify ${conn.targets.length} target${conn.targets.length === 1 ? '' : 's'}` : 'pending'}
                  </span>
                )}
              </div>
              {acts.length === 0 && conn && !dispatched && (
                <div className="mt-1 ml-[22px] text-[11.5px] text-ink-4 truncate" title={conn.targets.join(', ')}>
                  {conn.targets.join(' · ')}
                </div>
              )}
              {acts.map((a) => (
                <ActionRow key={a.id} action={a} />
              ))}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-2">
        {(summary.state === 'open' || summary.state === 'monitoring') && (
          <Button variant="danger" size="sm" icon={<Ban className="size-3.5" />} onClick={() => setDismissOpen(true)}>
            Dismiss as false positive
          </Button>
        )}
        {summary.state !== 'blocked' && summary.state !== 'taken_down' && (
          <Button variant="outline" size="sm" icon={<RefreshCw className="size-3.5" />} loading={rechecking} onClick={recheck}>
            Re-check now
          </Button>
        )}
        {(summary.state === 'blocked' || summary.state === 'taken_down' || summary.state === 'approved') && summary.approved_by && (
          <span className="ml-auto text-[11.5px] text-ink-3">
            approved by <span className="text-gold">{summary.approved_by}</span> <RelativeTime iso={summary.approved_at} />
          </span>
        )}
      </div>

      <ApproveModal open={approveOpen} onClose={() => setApproveOpen(false)} summary={summary} connectors={connectors.data ?? []} onApproved={onApproved} />
      <DismissModal open={dismissOpen} onClose={() => setDismissOpen(false)} summary={summary} onDismissed={onDismissed} />
    </Card>
  );
}

function ActionRow({ action: a }: { action: Action }) {
  const when = a.completed_at ?? a.acknowledged_at ?? a.sent_at ?? a.created_at;
  return (
    <div className="mt-1.5 ml-[22px] flex items-start gap-2 text-[12px]">
      <Building2 className="size-3.5 text-ink-4 mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-ink-2 truncate" title={`${a.target} via ${a.connector}`}>
            {a.target}
          </span>
          {a.blocks_exposure && (
            <span className="text-[10px] text-emerald/80 border border-emerald/30 rounded px-1 shrink-0" title="A confirmation from this channel ends citizen exposure">
              blocks exposure
            </span>
          )}
        </div>
        {a.request_summary && <div className="text-[11px] text-ink-4 truncate">{a.request_summary}</div>}
        {a.error && <div className="text-[11px] text-red truncate">{a.error}</div>}
        {a.receipt && a.status !== 'failed' && <div className="font-mono text-[10.5px] text-ink-4 truncate">receipt {a.receipt}</div>}
      </div>
      <div className="flex flex-col items-end gap-0.5 shrink-0">
        <ActionChip status={a.status} size="xs" />
        <RelativeTime iso={when} className="text-[10.5px] text-ink-4" />
      </div>
    </div>
  );
}

export type { Connector };
