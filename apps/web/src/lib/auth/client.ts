import type { GoTrueClient } from '@supabase/auth-js';

import { config } from '../config.ts';

import { STORAGE_KEY } from './session.ts';

let clientPromise: Promise<GoTrueClient> | null = null;

/** Lazily loads @supabase/auth-js (its own chunk) and creates the single client. */
export function loadAuthClient(): Promise<GoTrueClient> {
  clientPromise ??= import('@supabase/auth-js').then(
    ({ GoTrueClient: Client }) =>
      new Client({
        url: `${config.supabaseUrl}/auth/v1`,
        headers: { apikey: config.anonKey },
        storageKey: STORAGE_KEY,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      }),
  );
  return clientPromise;
}

/** Prefetch the auth chunk when the browser is idle, unless Data Saver is on (§18.2.6). */
export function prefetchAuthWhenIdle(win: Window = window): void {
  const nav = win.navigator as Navigator & { connection?: { saveData?: boolean } };
  if (nav.connection?.saveData === true) return;
  const run = (): void => {
    void loadAuthClient();
  };
  // Safari has no requestIdleCallback.
  const ric = (win as { requestIdleCallback?: Window['requestIdleCallback'] }).requestIdleCallback;
  if (ric === undefined) win.setTimeout(run, 2000);
  else ric.call(win, run);
}
