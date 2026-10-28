import { useEffect, useState } from 'react';

/** One shared ticker for every relative-time label on the page (instead of one interval per label). */
const listeners = new Set<() => void>();
let timer: number | null = null;
let now = Date.now();

function ensureTimer() {
  if (timer !== null) return;
  timer = window.setInterval(() => {
    now = Date.now();
    listeners.forEach((l) => l());
  }, 1000);
}

export function useNow(): number {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((x) => x + 1);
    listeners.add(l);
    ensureTimer();
    return () => {
      listeners.delete(l);
      if (!listeners.size && timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, []);
  return now;
}
