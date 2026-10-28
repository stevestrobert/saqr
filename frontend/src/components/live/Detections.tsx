import { useMemo } from 'react';
import { Crosshair } from 'lucide-react';
import { useLive } from '../../hooks/useLiveEvents';
import type { LiveSnapshot } from '../../hooks/liveStore';
import { buildDetections, isInteresting, stageOf, type Detection } from '../../lib/detections';
import { isPunycode } from '../../lib/format';
import { sourceLabel } from '../../lib/tones';
import { LinkButton } from '../ui/Button';
import { Card, CardHeader } from '../ui/Card';
import { Chip, VerdictChip } from '../ui/Chip';
import { EmptyState } from '../ui/EmptyState';
import { RelativeTime } from '../ui/RelativeTime';
import { RiskBar } from '../ui/Risk';
import { SkeletonCard } from '../ui/Skeleton';
import { StageTracker } from '../ui/StageTracker';
import { Thumb } from '../ui/Thumb';

function DetectionCard({ d }: { d: Detection }) {
  const st = stageOf(d);
  const c = d.case;
  const reviewable = !!c && c.state === 'open' && (c.verdict.label === 'confirmed_fake' || c.verdict.label === 'suspicious');
  const border = c?.verdict.label === 'confirmed_fake' && c.state === 'open' ? 'border-red/40' : st.active ? 'border-sky/30' : 'border-line';
  return (
    <article className={`rounded-lg border bg-surface p-3 animate-slide-in ${border}`}>
      <div className="flex gap-3">
        {c && <Thumb src={c.thumbnail_url} alt={`Screenshot of ${d.domain}`} className="w-[92px] h-[58px] rounded-md shrink-0" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-[13px] font-medium text-ink truncate" title={d.domain}>
              {d.displayDomain}
            </span>
            {isPunycode(d.domain) && (
              <Chip tone="red" size="xs" title={`Punycode: ${d.domain}`}>
                IDN
              </Chip>
            )}
          </div>
          <p className="text-[11.5px] text-ink-3 truncate mt-0.5">
            {d.entity ? (
              <>
                imitates <span className="text-ink-2">{d.entity}</span>
              </>
            ) : (
              sourceLabel[d.source] ?? d.source
            )}
            <span className="text-ink-4"> · </span>
            <RelativeTime iso={d.firstSeen} />
          </p>
          <div className="flex items-center gap-2 mt-1.5">
            {c ? (
              <>
                <VerdictChip label={c.verdict.label} size="xs" />
                <RiskBar risk={c.verdict.risk} width="w-10" />
              </>
            ) : (
              <Chip tone="amber" size="xs" mono>
                look-alike {d.score}
              </Chip>
            )}
          </div>
        </div>
      </div>
      <div className="mt-3">
        <StageTracker status={st} />
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span className="font-mono text-[10.5px] text-ink-4 truncate">{c?.id ?? d.candidate?.id ?? ''}</span>
        {reviewable ? (
          <LinkButton to={`/cases/${c!.id}`} variant="primary" size="sm">
            Review &amp; block
          </LinkButton>
        ) : c ? (
          <LinkButton to={`/cases/${c.id}`} variant="outline" size="xs">
            Open case
          </LinkButton>
        ) : null}
      </div>
    </article>
  );
}

const selectDetectionDeps = (s: LiveSnapshot) => s;

export function Detections() {
  // The derivation needs several slices; recompute only when one of them changes (copy-on-write in the store).
  const snap = useLive(selectDetectionDeps);
  const { candidates, verification, cases, actions, evidence, touched, bootstrapped } = snap;
  const detections = useMemo(
    () => buildDetections({ ...snap, candidates, verification, cases, actions, evidence, touched }).filter(isInteresting).slice(0, 14),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [candidates, verification, cases, actions, evidence, touched],
  );
  const awaiting = detections.filter((d) => d.case?.state === 'open' && (d.case.verdict.label === 'confirmed_fake' || d.case.verdict.label === 'suspicious')).length;

  return (
    <Card padded={false} className="flex flex-col h-[584px] overflow-hidden">
      <div className="px-4 pt-3.5">
        <CardHeader
          title="Detections"
          titleAr="الاكتشافات"
          count={detections.length}
          subtitle={awaiting > 0 ? <span className="text-amber">{awaiting} awaiting approval</span> : 'candidates → verified → evidence → approval → blocked'}
        />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 space-y-2.5">
        {!bootstrapped && detections.length === 0 ? (
          <>
            <div className="card p-3">
              <SkeletonCard lines={3} />
            </div>
            <div className="card p-3">
              <SkeletonCard lines={3} />
            </div>
          </>
        ) : detections.length === 0 ? (
          <EmptyState icon={<Crosshair className="size-4" />} title="No detections yet" hint="Nothing has passed the look-alike filter. Start the scenario or inject a domain from the Presenter drawer (press P)." />
        ) : (
          detections.map((d) => <DetectionCard key={d.key} d={d} />)
        )}
      </div>
    </Card>
  );
}
