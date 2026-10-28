import { useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import { Activity, BookMarked, FolderSearch, MessageSquareWarning, ScrollText } from 'lucide-react';
import { useLive } from '../../hooks/useLiveEvents';
import { fmtDuration } from '../../lib/format';

const items = [
  { to: '/', label: 'Live Wall', ar: 'الرصد', icon: Activity, end: true },
  { to: '/cases', label: 'Cases', ar: 'الحالات', icon: FolderSearch },
  { to: '/reports', label: 'Reports & Campaigns', ar: 'البلاغات', icon: MessageSquareWarning },
  { to: '/audit', label: 'Audit', ar: 'التدقيق', icon: ScrollText },
  { to: '/registry', label: 'Registry', ar: 'السجل', icon: BookMarked },
];

export function FalconMark({ className = 'size-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#161d27" stroke="#2b3747" />
      <path d="M6 20c3-1 6-4 7-9 1 3 1 6-1 9 3-1 5-3 6-7 2 3 1 7-2 9 4 0 7-1 10-4-1 4-5 8-11 8-5 0-8-3-9-6z" fill="#e3b341" />
    </svg>
  );
}

export function SideNav() {
  const cases = useLive((s) => s.cases);
  const status = useLive((s) => s.status);
  const openCount = useMemo(
    () => Object.values(cases).filter((c) => c.state === 'open' && (c.verdict.label === 'confirmed_fake' || c.verdict.label === 'suspicious')).length,
    [cases],
  );

  return (
    <aside className="h-full border-r border-line bg-surface/70 backdrop-blur flex flex-col">
      <div className="px-4 pt-4 pb-3 border-b border-line">
        <div className="flex items-center gap-2.5">
          <FalconMark className="size-8" />
          <div className="leading-none">
            <div className="flex items-baseline gap-2">
              <span className="text-[17px] font-bold tracking-[0.12em] text-ink">SAQR</span>
              <span className="arabic text-[16px] text-gold leading-none">صقر</span>
            </div>
            <div className="text-[10.5px] text-ink-3 mt-1.5 leading-tight">Early warning for impersonated government services</div>
          </div>
        </div>
      </div>

      <nav className="p-2.5 space-y-0.5">
        {items.map(({ to, label, ar, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `group flex items-center gap-2.5 rounded-md px-2.5 h-9 text-[13px] transition-colors ${
                isActive ? 'bg-raised text-ink border border-line-strong shadow-[0_1px_0_rgb(255_255_255/0.03)_inset]' : 'text-ink-2 hover:text-ink hover:bg-raised/60 border border-transparent'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon className={`size-4 shrink-0 ${isActive ? 'text-gold' : 'text-ink-3 group-hover:text-ink-2'}`} />
                <span className="flex-1 truncate font-medium">{label}</span>
                {to === '/cases' && openCount > 0 ? (
                  <span className="tnum text-[10.5px] font-semibold bg-amber/15 text-amber border border-amber/30 rounded px-1.5 py-px" title="Cases awaiting approval">
                    {openCount}
                  </span>
                ) : (
                  <span className="arabic text-[11px] text-ink-4 group-hover:text-ink-3">{ar}</span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto p-3 border-t border-line text-[11px] text-ink-3 space-y-1">
        <div className="flex items-center justify-between">
          <span className="truncate">{status?.node ?? 'saqr-node'}</span>
          <span className="font-mono text-ink-4">v{status?.version ?? '—'}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>uptime</span>
          <span className="tnum text-ink-2">{status ? fmtDuration(status.uptime_s * 1000) : '—'}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>protected entities</span>
          <span className="tnum text-ink-2">{status?.protected_entities ?? '—'}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>look-alike threshold</span>
          <span className="tnum text-ink-2">{status?.match_threshold ?? 35}</span>
        </div>
      </div>
    </aside>
  );
}
