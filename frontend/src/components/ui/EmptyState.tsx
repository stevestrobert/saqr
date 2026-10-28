import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';

export function EmptyState({
  icon,
  title,
  hint,
  action,
  className = '',
  compact,
}: {
  icon?: ReactNode;
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? 'py-6' : 'py-12'} px-4 ${className}`}>
      <div className="size-9 rounded-lg bg-raised border border-line flex items-center justify-center text-ink-3 mb-3">
        {icon ?? <Inbox className="size-4" />}
      </div>
      <p className="text-[13px] font-medium text-ink-2">{title}</p>
      {hint && <p className="text-[12px] text-ink-3 mt-1 max-w-[36ch] leading-snug">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-4">
      <p className="text-[13px] font-medium text-red">Could not load</p>
      <p className="text-[12px] text-ink-3 mt-1">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-3 text-[12px] text-gold hover:text-gold-2 underline underline-offset-2">
          Retry
        </button>
      )}
    </div>
  );
}
