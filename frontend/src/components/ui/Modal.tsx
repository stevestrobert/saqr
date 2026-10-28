import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 'max-w-xl',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 animate-fade-in" role="dialog" aria-modal>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} />
      <div className={`relative w-full ${width} card p-0 shadow-pop animate-pop-in max-h-[88vh] flex flex-col`}>
        <header className="flex items-start justify-between gap-4 px-5 pt-4 pb-3 border-b border-line">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
            {subtitle && <p className="text-[12.5px] text-ink-3 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-ink-3 hover:text-ink rounded p-1 -m-1" aria-label="Close">
            <X className="size-4" />
          </button>
        </header>
        <div className="px-5 py-4 overflow-y-auto">{children}</div>
        {footer && <footer className="px-5 py-3 border-t border-line flex items-center justify-end gap-2 bg-sunken/40 rounded-b-lg">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
