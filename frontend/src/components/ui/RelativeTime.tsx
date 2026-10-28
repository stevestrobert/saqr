import { useNow } from '../../hooks/useNow';
import { fmtExact, fmtRelative } from '../../lib/format';

export function RelativeTime({ iso, className = '', prefix }: { iso: string | null | undefined; className?: string; prefix?: string }) {
  const now = useNow();
  if (!iso) return <span className={`text-ink-4 ${className}`}>—</span>;
  return (
    <time dateTime={iso} title={`${fmtExact(iso)} · ${iso}`} className={`tnum whitespace-nowrap ${className}`}>
      {prefix}
      {fmtRelative(iso, now)}
    </time>
  );
}
