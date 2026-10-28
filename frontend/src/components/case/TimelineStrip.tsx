import type { CaseSummary, EvidencePackage } from '../../api/types';
import { fmtClock, fmtDuration, fmtExact, parseTime } from '../../lib/format';

interface Node {
  key: string;
  label: string;
  at: string | null;
  tone: 'ink' | 'gold' | 'emerald' | 'sky';
}

/** issued → detected → verified → evidence → approved → blocked, with the elapsed time between steps. */
export function TimelineStrip({ summary, evidence }: { summary: CaseSummary; evidence: EvidencePackage | null }) {
  const nodes: Node[] = [
    { key: 'issued', label: 'Certificate issued', at: summary.issued_at, tone: 'ink' },
    { key: 'detected', label: 'Detected', at: summary.detected_at, tone: 'sky' },
    { key: 'verified', label: 'Verified', at: summary.verified_at, tone: 'sky' },
    { key: 'evidence', label: 'Evidence sealed', at: evidence?.created_at ?? null, tone: 'sky' },
    { key: 'approved', label: 'Approved', at: summary.approved_at, tone: 'gold' },
    { key: 'blocked', label: summary.taken_down_at && !summary.blocked_at ? 'Taken down' : 'Blocked', at: summary.blocked_at ?? summary.taken_down_at, tone: 'emerald' },
  ];
  const awaiting = summary.state === 'open' && (summary.verdict.label === 'confirmed_fake' || summary.verdict.label === 'suspicious');
  const dispatching = summary.state === 'approved';
  const tti = parseTime(summary.issued_at) !== null ? parseTime(summary.detected_at)! - parseTime(summary.issued_at)! : null;
  const exposure = parseTime(summary.blocked_at ?? summary.taken_down_at) !== null ? parseTime(summary.blocked_at ?? summary.taken_down_at)! - parseTime(summary.detected_at)! : null;

  const dotCls = (n: Node) =>
    !n.at ? 'border-line-strong bg-transparent' : n.tone === 'emerald' ? 'bg-emerald border-emerald' : n.tone === 'gold' ? 'bg-gold border-gold' : n.tone === 'sky' ? 'bg-sky border-sky' : 'bg-ink-2 border-ink-2';

  return (
    <div className="card px-5 py-3.5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[13px] font-semibold text-ink">
          Timeline <span className="arabic text-[12px] text-ink-3 ml-1.5">الخط الزمني</span>
        </h2>
        <div className="flex items-center gap-4 text-[12px] text-ink-3">
          <span>
            time-to-identify <span className="tnum text-ink font-medium">{tti !== null ? fmtDuration(tti) : '—'}</span>
          </span>
          <span>
            exposure <span className={`tnum font-medium ${exposure !== null ? 'text-emerald' : 'text-ink'}`}>{exposure !== null ? fmtDuration(exposure) : awaiting ? 'open' : '—'}</span>
          </span>
        </div>
      </div>
      <ol className="flex items-start">
        {nodes.map((n, i) => {
          const next = nodes[i + 1];
          const t0 = parseTime(n.at);
          const t1 = next ? parseTime(next.at) : null;
          let connector: { text: string; cls: string; line: string } | null = null;
          if (next) {
            if (t0 !== null && t1 !== null) connector = { text: fmtDuration(t1 - t0), cls: 'text-ink-2', line: 'bg-ink-3' };
            else if (next.key === 'approved' && awaiting) connector = { text: 'awaiting approval', cls: 'text-amber', line: 'bg-amber/40' };
            else if (next.key === 'blocked' && dispatching) connector = { text: 'dispatching…', cls: 'text-sky animate-pulse-soft', line: 'bg-sky/40' };
            else connector = { text: '', cls: 'text-ink-4', line: 'bg-line-strong' };
          }
          return (
            <li key={n.key} className={`flex items-start ${next ? 'flex-1' : ''}`}>
              <div className="flex flex-col items-center w-[112px] shrink-0" title={n.at ? fmtExact(n.at) : 'not yet'}>
                <span className={`size-3.5 rounded-full border-2 ${dotCls(n)}`} />
                <span className={`text-[11.5px] mt-1.5 leading-tight text-center ${n.at ? 'text-ink' : 'text-ink-4'}`}>{n.label}</span>
                <span className={`font-mono tnum text-[11px] mt-0.5 ${n.at ? 'text-ink-3' : 'text-ink-4'}`}>{n.at ? fmtClock(n.at) : '—'}</span>
              </div>
              {connector && (
                <div className="flex-1 flex flex-col items-center pt-[6px] -mx-8">
                  <span className={`h-0.5 w-full rounded ${connector.line}`} />
                  <span className={`text-[11px] tnum mt-1 ${connector.cls}`}>{connector.text}</span>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
