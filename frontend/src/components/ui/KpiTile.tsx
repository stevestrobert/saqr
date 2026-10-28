import type { ReactNode } from 'react';
import { toneClasses, type Tone } from '../../lib/tones';

export function KpiTile({
  label,
  value,
  sub,
  tone,
  loading,
  icon,
  spark,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  loading?: boolean;
  icon?: ReactNode;
  spark?: number[];
}) {
  return (
    <div className="card px-3.5 py-3 min-w-0 flex flex-col justify-between relative overflow-hidden">
      <div className="flex items-center justify-between gap-2 min-h-[14px]">
        <span className="label-xs leading-tight">{label}</span>
        {icon && <span className="text-ink-4">{icon}</span>}
      </div>
      <div className="mt-1.5 flex items-end justify-between gap-2">
        {loading ? (
          <div className="skeleton h-6 w-20" />
        ) : (
          <span className={`text-[22px] leading-none font-semibold tracking-tight ${tone ? toneClasses[tone].text : 'text-ink'}`}>{value}</span>
        )}
        {spark && spark.length > 1 && <Sparkline data={spark} tone={tone ?? 'slate'} />}
      </div>
      {sub !== undefined && <div className="text-[11.5px] text-ink-3 mt-1.5 truncate leading-none min-h-[11px]">{sub}</div>}
    </div>
  );
}

function Sparkline({ data, tone }: { data: number[]; tone: Tone }) {
  const w = 56;
  const h = 20;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const span = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - ((v - min) / span) * (h - 2) - 1] as const);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} className="shrink-0 overflow-visible" aria-hidden>
      <path d={d} fill="none" stroke={toneClasses[tone].ring} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" opacity={0.8} />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2.2} fill={toneClasses[tone].ring} />
    </svg>
  );
}
