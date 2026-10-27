import { createContext, useContext } from 'react';
import * as v from 'valibot';

import { type Api, createApi } from './api/client.ts';
import { PinSession, Profile } from './api/schemas.ts';
import { loadAuthClient } from './auth/client.ts';
import { createSession, LOGIN_AT_KEY, type Session } from './auth/session.ts';
import type { AppConfig } from './config.ts';

export type PinLoginResult = 'ok' | 'wrong' | 'limited' | 'error';

/** Everything a screen needs from the outside world, injectable for tests. */
export interface Services {
  readonly config: AppConfig;
  readonly api: Api;
  readonly session: Session;
  readonly profile: () => Promise<Profile | null>;
  readonly callFunction: (
    name: string,
    init: RequestInit & { query?: string },
  ) => Promise<Response>;
  readonly pinLogin: (mobile: string, pin: string) => Promise<PinLoginResult>;
  readonly signOut: () => Promise<void>;
  readonly now: () => number;
}

/** PIN login: the Edge Function checks the PIN and returns a session, which the auth SDK stores. */
async function pinLoginWith(
  callFunction: Services['callFunction'],
  storage: Pick<Storage, 'setItem'>,
  mobile: string,
  pin: string,
): Promise<PinLoginResult> {
  let res: Response;
  try {
    res = await callFunction('pin-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mobile, pin }),
    });
  } catch {
    return 'error';
  }
  if (res.status === 401) return 'wrong';
  if (res.status === 429) return 'limited';
  if (!res.ok) return 'error';
  const parsed = v.safeParse(PinSession, await res.json().catch(() => null));
  if (!parsed.success) return 'error';
  try {
    const client = await loadAuthClient();
    const { error } = await client.setSession(parsed.output);
    if (error !== null) return 'error';
  } catch {
    return 'error';
  }
  try {
    storage.setItem(LOGIN_AT_KEY, String(Date.now()));
  } catch {
    // the sign-in itself worked; only the six-month limit cannot be recorded
  }
  return 'ok';
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
  const callFunction: Services['callFunction'] = async (name, init) => {
    const token = await session.getToken();
    return win.fetch(`${config.supabaseUrl}/functions/v1/${name}${init.query ?? ''}`, {
      ...init,
      headers: {
        apikey: config.anonKey,
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  };
  return {
    config,
    api,
    session,
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
    callFunction,
    pinLogin: async (mobile, pin) => {
      const result = await pinLoginWith(callFunction, storage, mobile, pin);
      if (result === 'ok') cachedProfile = null;
      return result;
    },
    signOut: async () => {
      cachedProfile = null;
      try {
        storage.removeItem(LOGIN_AT_KEY);
      } catch {
        // best effort
      }
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
