import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import type { Tone } from '../../lib/tones';

interface ToastItem {
  id: number;
  title: string;
  description?: string;
  tone: Tone;
}

interface ToastApi {
  toast: (t: { title: string; description?: string; tone?: Tone; ttl?: number }) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const toast = useCallback<ToastApi['toast']>(
    ({ title, description, tone = 'slate', ttl = 4200 }) => {
      const id = ++seq;
      setItems((xs) => [...xs, { id, title, description, tone }].slice(-4));
      window.setTimeout(() => dismiss(id), ttl);
    },
    [dismiss],
  );
  const api = useMemo(() => ({ toast }), [toast]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-[340px] pointer-events-none">
        {items.map((t) => (
          <div key={t.id} className="card p-3 flex items-start gap-2.5 pointer-events-auto animate-pop-in shadow-pop">
            {t.tone === 'red' ? (
              <AlertTriangle className="size-4 text-red mt-px shrink-0" />
            ) : t.tone === 'emerald' ? (
              <CheckCircle2 className="size-4 text-emerald mt-px shrink-0" />
            ) : (
              <Info className="size-4 text-sky mt-px shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-ink leading-snug">{t.title}</p>
              {t.description && <p className="text-[12px] text-ink-3 mt-0.5 leading-snug break-words">{t.description}</p>}
            </div>
            <button onClick={() => dismiss(t.id)} className="text-ink-4 hover:text-ink" aria-label="Dismiss">
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
