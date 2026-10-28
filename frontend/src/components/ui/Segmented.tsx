export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'sm',
  className = '',
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  size?: 'xs' | 'sm';
  className?: string;
}) {
  return (
    <div className={`inline-flex items-center rounded-md border border-line bg-sunken p-0.5 ${className}`} role="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={`inline-flex items-center gap-1.5 rounded-[5px] transition-colors ${size === 'xs' ? 'h-5 px-2 text-[11px]' : 'h-6 px-2.5 text-[12px]'} ${
              active ? 'bg-raised text-ink shadow-[0_1px_0_rgb(255_255_255/0.04)_inset] border border-line-strong' : 'text-ink-3 hover:text-ink-2 border border-transparent'
            }`}
          >
            {o.label}
            {o.count !== undefined && <span className={`tnum text-[10.5px] ${active ? 'text-ink-2' : 'text-ink-4'}`}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
