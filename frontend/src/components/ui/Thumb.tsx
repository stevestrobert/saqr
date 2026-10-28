import { useEffect, useState } from 'react';
import { ImageOff, Loader2 } from 'lucide-react';

/** Screenshot image with loading shimmer and a graceful placeholder when the backend returns 404. */
export function Thumb({
  src,
  alt,
  className = '',
  fit = 'cover',
  placeholder = 'No screenshot',
  position = 'top',
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  fit?: 'cover' | 'contain';
  placeholder?: string;
  position?: 'top' | 'center';
}) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>(src ? 'loading' : 'error');
  useEffect(() => {
    setState(src ? 'loading' : 'error');
  }, [src]);

  return (
    <div className={`relative overflow-hidden bg-sunken border border-line ${className}`}>
      {src && state !== 'error' && (
        <img
          src={src}
          alt={alt}
          onLoad={() => setState('ok')}
          onError={() => setState('error')}
          className={`absolute inset-0 w-full h-full ${fit === 'cover' ? 'object-cover' : 'object-contain'} ${position === 'top' ? 'object-top' : 'object-center'} transition-opacity duration-300 ${state === 'ok' ? 'opacity-100' : 'opacity-0'}`}
          draggable={false}
        />
      )}
      {state === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center text-ink-4">
          <Loader2 className="size-4 animate-spin" />
        </div>
      )}
      {state === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-ink-4 bg-[repeating-linear-gradient(135deg,transparent_0_8px,rgb(255_255_255/0.015)_8px_16px)]">
          <ImageOff className="size-4" />
          <span className="text-[10.5px]">{placeholder}</span>
        </div>
      )}
    </div>
  );
}
