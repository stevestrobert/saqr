import { fmtInt } from '../../lib/format';

export interface FunnelStage {
  key: string;
  label: string;
  value: number;
}

/**
 * Horizontal funnel on a log scale (the first stage is thousands of times larger than the last).
 * One ordinal hue ramp; values in ink tokens; stage-to-stage ratio labelled on the right.
 */
export function Funnel({ stages, loading }: { stages: FunnelStage[]; loading?: boolean }) {
  const ramp = ['#2f4f7a', '#3a6396', '#4677ad', '#5a8fc4', '#7ba9d8'];
  const maxLog = Math.log10(Math.max(1, ...stages.map((s) => s.value)) + 1);
  return (
    <div className="space-y-2">
      {stages.map((s, i) => {
        const pct = maxLog > 0 ? Math.max(3, (Math.log10(s.value + 1) / maxLog) * 100) : 3;
        const prev = i > 0 ? stages[i - 1].value : null;
        const ratio = prev && s.value > 0 ? prev / s.value : null;
        return (
          <div key={s.key} className="grid grid-cols-[108px_1fr_112px] items-center gap-3 text-[12px]">
            <span className="text-ink-2 truncate" title={s.label}>
              {s.label}
            </span>
            <div className="relative h-5 rounded-[3px] bg-sunken/80 overflow-hidden" title={`${s.label}: ${fmtInt(s.value)}`}>
              {loading ? (
                <div className="skeleton h-full w-1/2" />
              ) : (
                <div className="h-full rounded-r-[3px] transition-[width] duration-700" style={{ width: `${pct}%`, background: ramp[Math.min(i, ramp.length - 1)] }} />
              )}
            </div>
            <div className="flex items-baseline justify-end gap-2">
              <span className="tnum font-medium text-ink">{loading ? '—' : fmtInt(s.value)}</span>
              <span className="tnum text-[10.5px] text-ink-4 w-[52px] text-right">{ratio && ratio > 1.05 ? `1 in ${fmtInt(ratio)}` : i === 0 ? 'log scale' : ''}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
