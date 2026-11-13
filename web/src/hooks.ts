import { useEffect, useState } from 'react';
import type { Status } from '../../server/contract.ts';
import { fetchStatus } from './api.ts';

export interface Loaded<T> {
  data: T | undefined;
  error: string | undefined;
}

// Loads again whenever `key` changes, and keeps showing what it had until the new answer arrives. `load` is a fresh
// function on every render, so `key` has to name everything it depends on.
export function useLoad<T>(load: (signal: AbortSignal) => Promise<T>, key: string): Loaded<T> {
  const [loaded, setLoaded] = useState<Loaded<T>>({ data: undefined, error: undefined });

  useEffect(() => {
    const abort = new AbortController();
    load(abort.signal)
      .then((data) => setLoaded({ data, error: undefined }))
      .catch((err: unknown) => {
        if (!abort.signal.aborted) setLoaded((had) => ({ data: had.data, error: err instanceof Error ? err.message : String(err) }));
      });
    return () => abort.abort();
  }, [key]);

  return loaded;
}

// Follows the server's background work: looks again when `revision` changes, often while the server is busy, and calls
// `onLanded` each time a read of the sources or a scoring run ends.
export function useStatus(revision: number, onLanded: () => void) {
  const [status, setStatus] = useState<Status | null>(null);
  const busy = status ? status.polling || status.taste.running : false;

  useEffect(() => {
    const abort = new AbortController();
    let wasBusy = busy;
    const look = () =>
      fetchStatus(abort.signal)
        .then((next) => {
          const nowBusy = next.polling || next.taste.running;
          if (wasBusy && !nowBusy) onLanded();
          wasBusy = nowBusy;
          setStatus(next);
        })
        .catch(() => {});
    void look();
    const timer = setInterval(() => void look(), busy ? 2_000 : 30_000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [busy, revision]);

  return { status, setStatus };
}
