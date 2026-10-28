import { Link } from 'react-router-dom';
import type { CaseDetail, CaseSummary } from '../../api/types';
import { toUnicodeDomain } from '../../lib/format';
import { sourceLabel } from '../../lib/tones';
import { Chip, StateChip, VerdictChip } from '../ui/Chip';
import { CopyButton } from '../ui/CopyButton';
import { RelativeTime } from '../ui/RelativeTime';
import { RiskRing } from '../ui/Risk';

export function CaseHeader({ summary, detail }: { summary: CaseSummary; detail: CaseDetail | null }) {
  const unicode = detail?.candidate?.match?.unicode_domain ?? toUnicodeDomain(summary.domain);
  const idn = unicode !== summary.domain;
  return (
    <div className="card p-4">
      <div className="flex items-start gap-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="font-mono text-[22px] font-semibold tracking-tight text-ink leading-none" dir="auto">
              {unicode}
            </h1>
            {idn && (
              <Chip tone="red" mono title="Internationalised domain name — this is how the browser renders the punycode name">
                IDN · {summary.domain}
              </Chip>
            )}
            <VerdictChip label={summary.verdict.label} size="md" />
            <StateChip state={summary.state} size="md" />
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-3">
            <span>
              Imitates <span className="text-ink font-medium">{summary.protected_entity ?? '—'}</span>
              {summary.protected_domain && <span className="font-mono text-ink-2"> · {summary.protected_domain}</span>}
            </span>
            <span>
              Source <span className="text-ink-2">{sourceLabel[summary.source] ?? summary.source}</span>
              {detail?.candidate?.match && <span className="tnum"> · look-alike {detail.candidate.match.score}</span>}
            </span>
            <span>
              Detected <RelativeTime iso={summary.detected_at} className="text-ink-2" />
            </span>
            {summary.report_count > 0 && (
              <span>
                <span className="text-ink-2 tnum">{summary.report_count}</span> citizen report{summary.report_count === 1 ? '' : 's'}
              </span>
            )}
            {summary.campaign_id && (
              <Link to={`/campaigns/${summary.campaign_id}`} className="text-violet hover:underline">
                Campaign · {detail?.campaign?.name ?? summary.campaign_id} ↗
              </Link>
            )}
          </div>
          <div className="mt-1.5 flex items-center gap-3 text-[12px] min-w-0">
            {summary.title && (
              <span className="text-ink-2 truncate" title={summary.title}>
                “{summary.title}”
              </span>
            )}
            <span className="font-mono text-[11.5px] text-ink-4 inline-flex items-center gap-1 min-w-0">
              <span className="truncate" title={summary.url}>
                {summary.url}
              </span>
              <CopyButton text={summary.url} label="URL" />
            </span>
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-5">
          <div className="text-right">
            <div className="label-xs">confidence</div>
            <div className="text-[20px] font-semibold text-ink leading-tight">{Math.round(summary.verdict.confidence * 100)}%</div>
            <div className="text-[11px] text-ink-4">{summary.verdict.encoder || 'encoder'}</div>
          </div>
          <RiskRing risk={summary.verdict.risk} size={76} stroke={6} />
        </div>
      </div>
    </div>
  );
}
