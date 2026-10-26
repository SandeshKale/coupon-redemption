import { useSyncExternalStore } from 'react';

/** Online state + connection quality hints (§18.3). */
export type Quality = 'offline' | 'slow' | 'ok';

interface ConnectionLike {
  effectiveType?: string;
  rtt?: number;
  saveData?: boolean;
  addEventListener?: (t: string, cb: () => void) => void;
  removeEventListener?: (t: string, cb: () => void) => void;
}

export function connectionOf(nav: Navigator): ConnectionLike | undefined {
  return (nav as Navigator & { connection?: ConnectionLike }).connection;
}

export function quality(nav: Navigator): Quality {
  if (!nav.onLine) return 'offline';
  const c = connectionOf(nav);
  if (c === undefined) return 'ok';
  if (
    c.effectiveType === '2g' ||
    c.effectiveType === 'slow-2g' ||
    c.effectiveType === '3g' ||
    (c.rtt ?? 0) > 600
  )
    return 'slow';
  return 'ok';
}

function subscribe(cb: () => void): () => void {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  const c = connectionOf(navigator);
  c?.addEventListener?.('change', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
    c?.removeEventListener?.('change', cb);
  };
}

export function useNetwork(): Quality {
  return useSyncExternalStore(
    subscribe,
    () => quality(navigator),
    () => 'ok',
  );
}

/** Resolves when the browser reports being online. */
export function waitOnline(win: Window = window): Promise<void> {
  if (win.navigator.onLine) return Promise.resolve();
  return new Promise((resolve) => {
    win.addEventListener(
      'online',
      () => {
        resolve();
      },
      { once: true },
    );
  });
}
