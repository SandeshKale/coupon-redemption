import { describe, expect, it, vi } from 'vitest';

import { fakeJwt } from '../../test/render.tsx';

import {
  claims,
  createSession,
  LOGIN_AT_KEY,
  readStored,
  SESSION_MAX_MS,
  sessionExpired,
  STORAGE_KEY,
} from './session.ts';

function store(value: unknown): Pick<Storage, 'getItem'> {
  return {
    getItem: (k) =>
      k === STORAGE_KEY ? (typeof value === 'string' ? value : JSON.stringify(value)) : null,
  };
}

describe('session', () => {
  it('readStored validates the stored session', () => {
    expect(readStored({ getItem: () => null })).toBeNull();
    expect(readStored(store('{'))).toBeNull();
    expect(readStored(store({ access_token: 5 }))).toBeNull();
    expect(readStored(store({ access_token: 't', expires_at: 1, user: { id: 'u' } }))).toEqual({
      access_token: 't',
      expires_at: 1,
      user: { id: 'u' },
    });
  });

  it('claims decodes (unverified) JWT payloads', () => {
    expect(claims(fakeJwt({ aal: 'aal2' }))).toMatchObject({ aal: 'aal2' });
    expect(claims('nope')).toBeNull();
    expect(claims('a.!!!.c')).toBeNull();
    expect(claims(`a.${btoa('5')}.c`)).toBeNull();
  });

  it('getToken: valid token without loading the SDK', async () => {
    const loadClient = vi.fn();
    const s = createSession({
      storage: store({ access_token: 'tok', expires_at: 2000 }),
      now: () => 1_000_000,
      loadClient,
    });
    expect(await s.getToken()).toBe('tok');
    expect(loadClient).not.toHaveBeenCalled();
  });

  it('getToken: expiring token refreshes through the SDK', async () => {
    let stored: unknown = { access_token: 'old', expires_at: 1000 };
    const storage = { getItem: () => JSON.stringify(stored) };
    const refreshSession = vi.fn(() => {
      stored = { access_token: 'new', expires_at: 9999 };
      return Promise.resolve({ data: { session: {}, user: null }, error: null });
    });
    const s = createSession({
      storage,
      now: () => 1_000_000,
      loadClient: () => Promise.resolve({ refreshSession, getSession: vi.fn() } as never),
    });
    expect(await s.getToken()).toBe('new');
  });

  it('getToken: refresh failure / SDK failure → null; no session → null', async () => {
    const failing = createSession({
      storage: store({ access_token: 'old', expires_at: 1 }),
      now: () => 1_000_000,
      loadClient: () =>
        Promise.resolve({
          refreshSession: () =>
            Promise.resolve({ data: { session: null }, error: { message: 'x' } }),
          getSession: vi.fn(),
        } as never),
    });
    expect(await failing.getToken()).toBeNull();
    const broken = createSession({
      storage: store({ access_token: 'old', expires_at: 1 }),
      now: () => 1_000_000,
      loadClient: () => Promise.reject(new Error('chunk')),
    });
    expect(await broken.refresh()).toBe(false);
    expect(
      await createSession({ storage: store({}), now: () => 0, loadClient: vi.fn() }).getToken(),
    ).toBeNull();
  });

  it('userId and aal', () => {
    const s = createSession({
      storage: store({ access_token: fakeJwt({ aal: 'aal2' }), user: { id: 'u1' } }),
      now: () => 0,
      loadClient: vi.fn(),
    });
    expect(s.userId()).toBe('u1');
    expect(s.aal()).toBe('aal2');
    const none = createSession({ storage: store({}), now: () => 0, loadClient: vi.fn() });
    expect([none.userId(), none.aal()]).toEqual([null, null]);
    const noAal = createSession({
      storage: store({ access_token: fakeJwt({}) }),
      now: () => 0,
      loadClient: vi.fn(),
    });
    expect(noAal.aal()).toBeNull();
  });
});

describe('six-month PIN login', () => {
  const withLogin = (at: string | null): Pick<Storage, 'getItem'> => ({
    getItem: (k) =>
      k === LOGIN_AT_KEY
        ? at
        : k === STORAGE_KEY
          ? JSON.stringify({ access_token: 'tok', expires_at: 4_000_000_000, user: { id: 'u' } })
          : null,
  });

  it('sessionExpired is false without a record, true only after 183 days', () => {
    expect(sessionExpired(withLogin(null), 10)).toBe(false);
    expect(sessionExpired(withLogin('garbage'), 10)).toBe(false);
    expect(sessionExpired(withLogin('1000'), 1000 + SESSION_MAX_MS)).toBe(false);
    expect(sessionExpired(withLogin('1000'), 1000 + SESSION_MAX_MS + 1)).toBe(true);
  });

  it('an expired login yields no token and no user, so the app asks for the PIN again', async () => {
    const s = createSession({
      storage: withLogin('1000'),
      now: () => 1000 + SESSION_MAX_MS + 1,
      loadClient: vi.fn(),
    });
    expect(await s.getToken()).toBeNull();
    expect(s.userId()).toBeNull();
  });

  it('a login inside the window still works', async () => {
    const s = createSession({
      storage: withLogin('1000'),
      now: () => 1000 + 60_000,
      loadClient: vi.fn(),
    });
    expect(await s.getToken()).toBe('tok');
    expect(s.userId()).toBe('u');
  });
});
