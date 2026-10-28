import { fmtMinutes, fmtPctSmart } from '../../lib/format';

/**
 * Half-ring meter for "% reduction vs baseline" with the programme target marked as a tick.
 * The fill is emerald once the target is met, amber while below it; the track is a step of the same surface ramp.
 */
export function ReductionGauge({
  title,
  subtitle,
  reductionPct,
  targetPct,
  currentMinutes,
  baselineMinutes,
  loading,
}: {
  title: string;
  subtitle: string;
  reductionPct: number | null;
  targetPct: number;
  currentMinutes: number | null;
  baselineMinutes: number;
  loading?: boolean;
}) {
  const w = 220;
  const h = 128;
  const cx = w / 2;
  const cy = 112;
  const r = 92;
  const stroke = 12;
  const value = reductionPct === null ? 0 : Math.max(0, Math.min(100, reductionPct));
  const met = reductionPct !== null && reductionPct >= targetPct;
  const color = reductionPct === null ? '#2b3747' : met ? '#3ccf91' : '#f5b53b';

  const polar = (pct: number, rad = r) => {
    const a = Math.PI - (pct / 100) * Math.PI; // 0% → left, 100% → right
    return [cx + rad * Math.cos(a), cy - rad * Math.sin(a)] as const;
  };
  const arc = (from: number, to: number, rad = r) => {
    const [x1, y1] = polar(from, rad);
    const [x2, y2] = polar(to, rad);
    const large = to - from > 50 ? 1 : 0;
    return `M${x1.toFixed(2)},${y1.toFixed(2)} A${rad},${rad} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)}`;
  };
  const [tx1, ty1] = polar(targetPct, r - stroke / 2 - 4);
  const [tx2, ty2] = polar(targetPct, r + stroke / 2 + 4);
  const [lx, ly] = polar(targetPct, r + stroke / 2 + 16);

  return (
    <div className="flex flex-col items-center">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
        <path d={arc(0, 100)} fill="none" stroke="#1e2834" strokeWidth={stroke} strokeLinecap="round" />
        {value > 0 && <path d={arc(0, value)} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" className="transition-all duration-700" />}
        {/* target tick */}
        <line x1={tx1} y1={ty1} x2={tx2} y2={ty2} stroke="#e6edf3" strokeWidth={2} strokeLinecap="round" />
        <text x={lx} y={ly} textAnchor={targetPct > 55 ? 'start' : targetPct < 45 ? 'end' : 'middle'} fontSize={10} fill="#a3b1c0" className="font-sans" dominantBaseline="middle">
          target {targetPct}%
        </text>
        {/* value */}
        {loading ? (
          <rect x={cx - 28} y={cy - 46} width={56} height={22} rx={4} fill="#161d27" />
        ) : (
          <text x={cx} y={cy - 26} textAnchor="middle" fontSize={30} fontWeight={600} fill={reductionPct === null ? '#6b7a8c' : '#e6edf3'} className="font-sans" letterSpacing="-0.5">
            {reductionPct === null ? '—' : fmtPctSmart(reductionPct)}
          </text>
        )}
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize={10.5} fill="#6b7a8c" className="font-sans" letterSpacing="0.6">
          REDUCTION
        </text>
      </svg>
      <div className="text-center -mt-1">
        <p className="text-[13px] font-semibold text-ink">{title}</p>
        <p className="text-[11.5px] text-ink-3">{subtitle}</p>
        <p className="text-[12px] mt-1.5 tnum">
          <span className={met ? 'text-emerald font-medium' : 'text-ink'}>{loading ? '—' : fmtMinutes(currentMinutes)}</span>
          <span className="text-ink-4"> now · </span>
          <span className="text-ink-2">{fmtMinutes(baselineMinutes)}</span>
          <span className="text-ink-4"> baseline</span>
        </p>
      </div>
    </div>
  );
}
