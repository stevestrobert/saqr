import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { urls } from '../api/client';
import { LiveStore, type LiveSnapshot } from './liveStore';

const LiveContext = createContext<LiveStore | null>(null);

export function LiveProvider({ children }: { children: ReactNode }) {
  const store = useMemo(() => new LiveStore(), []);
  useEffect(() => {
    store.connect(urls.websocket());
    void store.bootstrap();
    return () => store.disconnect();
  }, [store]);
  return <LiveContext.Provider value={store}>{children}</LiveContext.Provider>;
}

export function useLiveStore(): LiveStore {
  const s = useContext(LiveContext);
  if (!s) throw new Error('useLiveStore must be used inside <LiveProvider>');
  return s;
}

/**
 * Subscribe to a slice of the live snapshot. The selector must return a stable reference
 * (a field of the snapshot) — derive arrays/objects with useMemo in the component.
 */
export function useLive<T>(selector: (s: LiveSnapshot) => T): T {
  const store = useLiveStore();
  return useSyncExternalStore(store.subscribe, () => selector(store.getSnapshot()), () => selector(store.getSnapshot()));
}

export function useLiveSnapshot(): LiveSnapshot {
  const store = useLiveStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
