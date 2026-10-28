import { riskTone, toneClasses } from '../../lib/tones';

export function RiskBar({ risk, className = '', showValue = true, width = 'w-14' }: { risk: number; className?: string; showValue?: boolean; width?: string }) {
  const tone = riskTone(risk);
  return (
    <div className={`inline-flex items-center gap-2 ${className}`} title={`Risk score ${risk}/100`}>
      <div className={`${width} h-1.5 rounded-full bg-line overflow-hidden`}>
        <div className={`h-full rounded-full ${toneClasses[tone].bar} transition-[width] duration-500`} style={{ width: `${Math.max(2, Math.min(100, risk))}%` }} />
      </div>
      {showValue && <span className={`tnum text-[12px] font-medium ${toneClasses[tone].text}`}>{Math.round(risk)}</span>}
    </div>
  );
}

export function RiskRing({ risk, size = 56, stroke = 5, label = 'risk', className = '' }: { risk: number; size?: number; stroke?: number; label?: string; className?: string }) {
  const tone = riskTone(risk);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, risk)) / 100;
  return (
    <div className={`relative inline-flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size }} title={`Risk score ${risk}/100`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1e2834" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={toneClasses[tone].ring}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c * (1 - pct)}`}
          className="transition-[stroke-dasharray] duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className={`font-semibold ${toneClasses[tone].text}`} style={{ fontSize: size * 0.3 }}>
          {Math.round(risk)}
        </span>
        {size >= 48 && <span className="text-ink-3 uppercase tracking-wider" style={{ fontSize: Math.max(8, size * 0.14), marginTop: 2 }}>{label}</span>}
      </div>
    </div>
  );
}

/** Horizontal 0..1 signal bar with label and explanation (used for the five verdict components). */
export function SignalBar({ label, value, hint, weight }: { label: string; value: number; hint?: string; weight?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const tone = pct >= 70 ? 'red' : pct >= 40 ? 'amber' : 'slate';
  return (
    <div className="py-1.5">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-[12.5px] font-medium text-ink">{label}</span>
          {weight && <span className="text-[10.5px] text-ink-4">{weight}</span>}
        </div>
        <span className={`tnum text-[12px] font-medium ${toneClasses[tone].text}`}>{(pct / 100).toFixed(2)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-line overflow-hidden">
        <div className={`h-full rounded-full ${toneClasses[tone].bar} transition-[width] duration-700`} style={{ width: `${Math.max(1.5, pct)}%` }} />
      </div>
      {hint && <p className="text-[11.5px] text-ink-3 mt-1 leading-snug">{hint}</p>}
    </div>
  );
}
