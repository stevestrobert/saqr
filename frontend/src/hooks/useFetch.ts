import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';

export interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  status: number | null;
  reload: (silent?: boolean) => Promise<void>;
  setData: (updater: T | ((prev: T | null) => T | null)) => void;
}

/** Fetch-on-mount with reload; keeps the previous data (dimmed by the caller) while refetching. */
export function useFetch<T>(fetcher: () => Promise<T>, deps: unknown[] = []): FetchState<T> {
  const [data, setDataState] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const alive = useRef(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const reload = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const d = await fetcherRef.current();
      if (!alive.current) return;
      setDataState(d);
      setError(null);
      setStatus(200);
    } catch (e) {
      if (!alive.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setStatus(e instanceof ApiError ? e.status : null);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void reload();
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const setData = useCallback((updater: T | ((prev: T | null) => T | null)) => {
    setDataState((prev) => (typeof updater === 'function' ? (updater as (p: T | null) => T | null)(prev) : updater));
  }, []);

  return { data, loading, error, status, reload, setData };
}
