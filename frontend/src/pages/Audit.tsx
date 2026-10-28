import { useEffect, useMemo, useState } from 'react';
import { Link2, ScrollText, ShieldAlert, ShieldCheck } from 'lucide-react';
import { api } from '../api/client';
import type { AuditEntry, AuditVerifyResponse } from '../api/types';
import { useFetch } from '../hooks/useFetch';
import { useLive } from '../hooks/useLiveEvents';
import { fmtClock, fmtDate, fmtInt, shortHash } from '../lib/format';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Chip } from '../components/ui/Chip';
import { Mono } from '../components/ui/CopyButton';
import { EmptyState, ErrorState } from '../components/ui/EmptyState';
import { PageHeader } from '../components/ui/PageHeader';
import { RelativeTime } from '../components/ui/RelativeTime';
import { SkeletonRows } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';

const actionTone = (action: string) =>
  action.includes('approve') || action.includes('dispatch') ? 'gold' : action.includes('block') || action.includes('complete') || action.includes('acknowledg') ? 'emerald' : action.includes('dismiss') || action.includes('fail') ? 'red' : action.includes('case') || action.includes('verdict') ? 'amber' : 'slate';

export function Audit() {
  const { data, loading, error, reload } = useFetch(() => api.audit(200));
  const live = useLive((s) => s.audit);
  const [verify, setVerify] = useState<AuditVerifyResponse | null>(null);
  const [verifying, setVerifying] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    document.title = 'Audit · SAQR';
  }, []);

  const entries = useMemo(() => {
    const m = new Map<number, AuditEntry>();
    for (const e of data?.entries ?? []) m.set(e.seq, e);
    for (const e of live) m.set(e.seq, e);
    return [...m.values()].sort((a, b) => b.seq - a.seq);
  }, [data, live]);

  const bySeq = useMemo(() => new Map(entries.map((e) => [e.seq, e])), [entries]);

  const runVerify = async () => {
    setVerifying(true);
    try {
      const r = await api.verifyAudit();
      setVerify(r);
      toast(r.valid ? { title: `Chain valid · ${fmtInt(r.length)} entries`, tone: 'emerald' } : { title: `Chain broken at #${r.broken_at}`, tone: 'red' });
    } catch (e) {
      toast({ title: 'Verification failed', description: e instanceof Error ? e.message : String(e), tone: 'red' });
    } finally {
      setVerifying(false);
    }
  };

  const chainValid = verify ? verify.valid : data?.valid;

  return (
    <div>
      <PageHeader
        title="Audit log"
        titleAr="سجل التدقيق"
        subtitle={`Append-only, hash-chained record of every automated and human decision · ${fmtInt(data?.length ?? entries.length)} entries`}
        actions={
          <>
            {chainValid !== undefined && (
              <span className={`inline-flex items-center gap-1.5 text-[12px] ${chainValid ? 'text-emerald' : 'text-red'}`}>
                {chainValid ? <ShieldCheck className="size-4" /> : <ShieldAlert className="size-4" />}
                {verify ? (verify.valid ? `Verified · ${fmtInt(verify.length)} entries intact` : `Broken at #${verify.broken_at}`) : chainValid ? 'Chain reported valid' : 'Chain reported broken'}
              </span>
            )}
            <Button variant="primary" size="md" loading={verifying} onClick={runVerify} icon={<Link2 className="size-3.5" />}>
              Verify chain
            </Button>
          </>
        }
      />

      {verify && (
        <div className={`mb-3 rounded-lg border px-4 py-3 flex items-center gap-3 animate-pop-in ${verify.valid ? 'border-emerald/40 bg-emerald/8' : 'border-red/40 bg-red/8'}`}>
          {verify.valid ? <ShieldCheck className="size-5 text-emerald" /> : <ShieldAlert className="size-5 text-red" />}
          <div>
            <p className={`text-[13px] font-semibold ${verify.valid ? 'text-emerald' : 'text-red'}`}>{verify.valid ? 'Hash chain intact' : 'Hash chain broken'}</p>
            <p className="text-[12px] text-ink-2">
              {verify.valid
                ? `All ${fmtInt(verify.length)} entries re-hashed; every prev-hash matches its predecessor. No entry has been altered or removed.`
                : `Entry #${verify.broken_at} does not match the hash of its predecessor — the log was modified after the fact.`}
            </p>
          </div>
        </div>
      )}

      <Card padded={false} className="overflow-hidden">
        {loading && entries.length === 0 ? (
          <div className="p-4">
            <SkeletonRows rows={10} />
          </div>
        ) : error && entries.length === 0 ? (
          <ErrorState message={error} onRetry={() => reload()} />
        ) : entries.length === 0 ? (
          <EmptyState icon={<ScrollText className="size-4" />} title="Audit log is empty" hint="Entries are appended as the pipeline detects, verifies and responds." />
        ) : (
          <table className="w-full table-fixed text-[12.5px]">
            <colgroup>
              <col style={{ width: 54 }} />
              <col style={{ width: 138 }} />
              <col style={{ width: 128 }} />
              <col style={{ width: 150 }} />
              <col style={{ width: 196 }} />
              <col />
              <col style={{ width: 128 }} />
              <col style={{ width: 132 }} />
            </colgroup>
            <thead className="bg-sunken/70 border-b border-line">
              <tr className="label-xs text-left">
                <th className="px-3 h-8 font-medium">seq</th>
                <th className="px-3 h-8 font-medium">time</th>
                <th className="px-3 h-8 font-medium">actor</th>
                <th className="px-3 h-8 font-medium">action</th>
                <th className="px-3 h-8 font-medium">subject</th>
                <th className="px-3 h-8 font-medium">detail</th>
                <th className="px-3 h-8 font-medium">hash</th>
                <th className="px-3 h-8 font-medium">prev</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {entries.map((e) => {
                const prev = bySeq.get(e.seq - 1);
                const linked = prev ? prev.hash === e.prev_hash : e.seq === 1 || !prev;
                const broken = verify && !verify.valid && verify.broken_at === e.seq;
                const detail = Object.entries(e.detail ?? {})
                  .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
                  .join('  ');
                return (
                  <tr key={e.seq} className={`${broken ? 'bg-red/10' : 'hover:bg-raised/50'} ${e.seq === entries[0].seq ? 'animate-slide-in' : ''}`}>
                    <td className="px-3 py-2 font-mono tnum text-ink-3">#{e.seq}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="font-mono tnum text-ink-2">{fmtClock(e.at)}</div>
                      <div className="text-[11px] text-ink-4">
                        {fmtDate(e.at)} · <RelativeTime iso={e.at} />
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`truncate block ${e.actor.startsWith('system') || e.actor === 'pipeline' || e.actor === 'intake' ? 'text-ink-3' : 'text-gold'}`} title={e.actor}>
                        {e.actor}
                      </span>
                    </td>
                    <td className="px-3 py-2 overflow-hidden">
                      <Chip tone={actionTone(e.action)} size="xs" mono className="max-w-full">
                        <span className="truncate">{e.action}</span>
                      </Chip>
                    </td>
                    <td className="px-3 py-2 font-mono text-[12px] text-ink-2 truncate" title={e.subject}>
                      {e.subject}
                    </td>
                    <td className="px-3 py-2 text-ink-3 font-mono text-[11px] truncate" title={JSON.stringify(e.detail, null, 1)}>
                      {detail || '—'}
                    </td>
                    <td className="px-3 py-2">
                      <Mono value={e.hash} n={10} />
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`font-mono text-[12px] ${linked ? 'text-ink-3' : 'text-red'}`} title={e.prev_hash}>
                          {shortHash(e.prev_hash, 10)}
                        </span>
                        {prev && <Link2 className={`size-3 ${linked ? 'text-emerald/70' : 'text-red'}`} aria-label={linked ? 'linked to previous entry' : 'does not match previous entry'} />}
                      </span>
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
