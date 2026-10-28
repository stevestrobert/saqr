import type { ReactNode } from 'react';

export function Card({ children, className = '', padded = true, dim }: { children: ReactNode; className?: string; padded?: boolean; dim?: boolean }) {
  return <section className={`card ${padded ? 'p-4' : ''} ${dim ? 'opacity-60 transition-opacity' : 'transition-opacity'} ${className}`}>{children}</section>;
}

export function CardHeader({
  title,
  titleAr,
  subtitle,
  count,
  actions,
  className = '',
}: {
  title: ReactNode;
  titleAr?: string;
  subtitle?: ReactNode;
  count?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={`flex items-start justify-between gap-3 mb-3 ${className}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="text-[13px] font-semibold text-ink leading-tight">{title}</h2>
          {titleAr && <span className="arabic text-[12px] text-ink-3 leading-none">{titleAr}</span>}
          {count !== undefined && count !== null && (
            <span className="tnum text-[11px] font-medium text-ink-3 bg-raised border border-line rounded px-1.5 py-px">{count}</span>
          )}
        </div>
        {subtitle && <p className="text-[12px] text-ink-3 mt-0.5 leading-snug">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </header>
  );
}

export function KeyValue({ rows, className = '' }: { rows: { k: ReactNode; v: ReactNode; mono?: boolean }[]; className?: string }) {
  return (
    <dl className={`grid grid-cols-[minmax(96px,auto)_1fr] gap-x-4 gap-y-1.5 text-[12.5px] ${className}`}>
      {rows.map((r, i) => (
        <div key={i} className="contents">
          <dt className="text-ink-3 truncate">{r.k}</dt>
          <dd className={`text-ink min-w-0 break-words ${r.mono ? 'font-mono text-[12px]' : ''}`}>{r.v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
