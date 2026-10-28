import { useState, type MouseEvent } from 'react';
import { Check, Copy } from 'lucide-react';

export function CopyButton({ text, label, className = '' }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  const copy = async (e: MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setDone(true);
    window.setTimeout(() => setDone(false), 1400);
  };
  return (
    <button
      onClick={copy}
      title={done ? 'Copied' : `Copy ${label ?? ''}`.trim()}
      aria-label={`Copy ${label ?? text}`}
      className={`inline-flex items-center justify-center size-5 rounded text-ink-3 hover:text-ink hover:bg-raised transition-colors ${className}`}
    >
      {done ? <Check className="size-3 text-emerald" /> : <Copy className="size-3" />}
    </button>
  );
}

export function Mono({ value, n = 12, copy = true, className = '' }: { value: string | null | undefined; n?: number; copy?: boolean; className?: string }) {
  if (!value) return <span className="text-ink-4">—</span>;
  const short = value.length > n ? `${value.slice(0, n)}…` : value;
  return (
    <span className={`inline-flex items-center gap-1 min-w-0 ${className}`}>
      <span className="font-mono text-[12px] text-ink-2 truncate" title={value}>
        {short}
      </span>
      {copy && <CopyButton text={value} />}
    </span>
  );
}
