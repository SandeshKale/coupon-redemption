import type { GoTrueClient } from '@supabase/auth-js';
import * as v from 'valibot';

/**
 * Session access without loading the auth SDK on the dealer critical path (§3.1): the access
 * token is read straight from storage; the SDK (code-split) is loaded only to refresh, sign in
 * or sign out, and is prefetched when the browser is idle.
 */
export const STORAGE_KEY = 'sb-24m-auth';
const SKEW_S = 60;

const StoredSession = v.object({
  access_token: v.optional(v.string()),
  expires_at: v.optional(v.number()),
  user: v.optional(v.object({ id: v.optional(v.string()) })),
});
type StoredSession = v.InferOutput<typeof StoredSession>;

export interface SessionDeps {
  readonly storage: Pick<Storage, 'getItem'>;
  readonly now: () => number;
  readonly loadClient: () => Promise<Pick<GoTrueClient, 'refreshSession' | 'getSession'>>;
}

export function readStored(storage: Pick<Storage, 'getItem'>): StoredSession | null {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return null;
  try {
    const parsed = v.safeParse(StoredSession, JSON.parse(raw));
    return parsed.success ? parsed.output : null;
  } catch {
    return null;
  }
}

/** JWT claims (unverified, display/routing only — the server verifies). */
export function claims(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1];
  if (part === undefined) return null;
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function createSession(deps: SessionDeps) {
  async function refresh(): Promise<boolean> {
    try {
      const client = await deps.loadClient();
      const { data, error } = await client.refreshSession();
      return error === null && data.session !== null;
    } catch {
      return false;
    }
  }
  return {
    /** A token valid for at least a minute, refreshing via the SDK only when needed. */
    async getToken(): Promise<string | null> {
      const s = readStored(deps.storage);
      if (s?.access_token === undefined) return null;
      if ((s.expires_at ?? 0) - SKEW_S > deps.now() / 1000) return s.access_token;
      if (!(await refresh())) return null;
      return readStored(deps.storage)?.access_token ?? null;
    },
    refresh,
    userId(): string | null {
      return readStored(deps.storage)?.user?.id ?? null;
    },
    aal(): string | null {
      const t = readStored(deps.storage)?.access_token;
      const a = t === undefined ? undefined : claims(t)?.['aal'];
      return typeof a === 'string' ? a : null;
    },
  };
}

export type Session = ReturnType<typeof createSession>;
