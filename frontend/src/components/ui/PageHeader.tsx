import type { ReactNode } from 'react';

export function PageHeader({ title, titleAr, subtitle, actions }: { title: ReactNode; titleAr?: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-4">
      <div>
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-[18px] font-semibold tracking-tight text-ink">{title}</h1>
          {titleAr && <span className="arabic text-[14px] text-ink-3">{titleAr}</span>}
        </div>
        {subtitle && <p className="text-[12.5px] text-ink-3 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
