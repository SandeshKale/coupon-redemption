import { createContext, useContext } from 'react';
import * as v from 'valibot';

import { type Api, createApi } from './api/client.ts';
import type { RedeemDeps } from './api/redeem.ts';
import { Profile } from './api/schemas.ts';
import { loadAuthClient } from './auth/client.ts';
import { createSession, type Session } from './auth/session.ts';
import type { AppConfig } from './config.ts';
import { waitOnline } from './network/status.ts';

/** Everything a screen needs from the outside world, injectable for tests. */
export interface Services {
  readonly config: AppConfig;
  readonly api: Api;
  readonly session: Session;
  readonly redeemDeps: RedeemDeps;
  readonly profile: () => Promise<Profile | null>;
  readonly callFunction: (
    name: string,
    init: RequestInit & { query?: string },
  ) => Promise<Response>;
  readonly signOut: () => Promise<void>;
  readonly now: () => number;
}

export function createServices(config: AppConfig, win: Window = window): Services {
  const storage = win.localStorage;
  const session = createSession({ storage, now: () => Date.now(), loadClient: loadAuthClient });
  const api = createApi({
    baseUrl: config.supabaseUrl,
    anonKey: config.anonKey,
    fetch: win.fetch.bind(win),
    getToken: () => session.getToken(),
    online: () => win.navigator.onLine,
  });
  let cachedProfile: Promise<Profile | null> | null = null;
  return {
    config,
    api,
    session,
    redeemDeps: {
      api,
      storage,
      sleep: (ms) => new Promise((r) => win.setTimeout(r, ms)),
      random: Math.random,
      uuid: () => win.crypto.randomUUID(),
      refreshSession: () => session.refresh(),
      waitOnline: () => waitOnline(win),
    },
    profile: () => {
      const uid = session.userId();
      if (uid === null) return Promise.resolve(null);
      cachedProfile ??= api
        .select(
          `app_user?select=id,name,role,dealer_id,distributor_id&auth_user_id=eq.${encodeURIComponent(uid)}`,
          v.array(v.unknown()),
        )
        .then((r) => {
          if (!r.ok) {
            cachedProfile = null;
            return null;
          }
          const parsed = v.safeParse(Profile, r.data);
          return parsed.success ? (parsed.output[0] ?? null) : null;
        });
      return cachedProfile;
    },
    callFunction: async (name, init) => {
      const token = await session.getToken();
      return win.fetch(`${config.supabaseUrl}/functions/v1/${name}${init.query ?? ''}`, {
        ...init,
        headers: {
          apikey: config.anonKey,
          ...(token === null ? {} : { authorization: `Bearer ${token}` }),
          ...(init.headers as Record<string, string> | undefined),
        },
      });
    },
    signOut: async () => {
      cachedProfile = null;
      const client = await loadAuthClient();
      await client.signOut();
    },
    now: () => Date.now(),
  };
}

export const ServicesContext = createContext<Services | null>(null);

export function useServices(): Services {
  const s = useContext(ServicesContext);
  if (s === null) throw new Error('useServices outside ServicesContext');
  return s;
}
