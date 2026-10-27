import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authClient = {
  signOut: vi.fn(() => Promise.resolve({ error: null })),
  setSession: vi.fn(() => Promise.resolve({ error: null })),
};
vi.mock('./auth/client.ts', () => ({ loadAuthClient: vi.fn(() => Promise.resolve(authClient)) }));

import { signIn, testServices } from '../test/render.tsx';
import { API, fn, server } from '../test/server.ts';

import { LOGIN_AT_KEY } from './auth/session.ts';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('services', () => {
  it('profile: null when signed out; cached per session; null on failure', async () => {
    expect(await testServices().profile()).toBeNull();
    signIn('abc');
    let calls = 0;
    server.use(
      http.get(`${API}/rest/v1/app_user`, () => {
        calls += 1;
        return HttpResponse.json([
          { id: 1, name: 'A', role: 'DEALER_OWNER', dealer_id: 1, distributor_id: null },
        ]);
      }),
    );
    const s = testServices();
    expect(await s.profile()).toMatchObject({ role: 'DEALER_OWNER' });
    await s.profile();
    expect(calls).toBe(1);
    server.use(http.get(`${API}/rest/v1/app_user`, () => HttpResponse.json([{ id: 'x' }])));
    expect(await testServices().profile()).toBeNull();
    server.use(
      http.get(`${API}/rest/v1/app_user`, () =>
        HttpResponse.json({ message: 'x' }, { status: 500 }),
      ),
    );
    expect(await testServices().profile()).toBeNull();
  });

  it('callFunction sends apikey and the user token', async () => {
    signIn();
    let auth: string | null = null;
    server.use(
      http.post(
        `${API}/functions/v1/f`,
        ({ request }) => ((auth = request.headers.get('authorization')), HttpResponse.json({})),
      ),
    );
    await testServices().callFunction('f', { method: 'POST', body: '{}' });
    expect(auth).toMatch(/^Bearer /);
    localStorage.clear();
    server.use(
      http.get(
        `${API}/functions/v1/g`,
        ({ request }) => ((auth = request.headers.get('authorization')), HttpResponse.json({})),
      ),
    );
    await testServices().callFunction('g', { method: 'GET', query: '?x=1' });
    expect(auth).toBeNull();
  });

  it('signOut clears the PIN login time; now is the clock', async () => {
    localStorage.setItem(LOGIN_AT_KEY, '1');
    const s = testServices();
    await s.signOut();
    expect(typeof s.now()).toBe('number');
    expect(localStorage.getItem(LOGIN_AT_KEY)).toBeNull();
  });

  describe('pinLogin', () => {
    const tokens = {
      access_token: 'a',
      refresh_token: 'r',
      expires_in: 3600,
      token_type: 'bearer',
    };

    it('stores the session and the login time, and asks for no token itself', async () => {
      let sent: unknown = null;
      let auth: string | null = 'unset';
      fn('pin-login', async (req) => {
        sent = await req.json();
        auth = req.headers.get('authorization');
        return HttpResponse.json(tokens);
      });
      const before = Date.now();
      expect(await testServices().pinLogin('+919800000001', '4817')).toBe('ok');
      expect(sent).toEqual({ mobile: '+919800000001', pin: '4817' });
      expect(auth).toBeNull();
      expect(authClient.setSession).toHaveBeenCalledWith({ access_token: 'a', refresh_token: 'r' });
      expect(Number(localStorage.getItem(LOGIN_AT_KEY))).toBeGreaterThanOrEqual(before);
    });

    it('401 is a wrong login, 429 is rate limited, anything else is an error', async () => {
      fn('pin-login', () => HttpResponse.json({ error: 'LOGIN_FAILED' }, { status: 401 }));
      expect(await testServices().pinLogin('+919800000001', '1111')).toBe('wrong');
      fn('pin-login', () => HttpResponse.json({ error: 'RATE_LIMITED' }, { status: 429 }));
      expect(await testServices().pinLogin('+919800000001', '1111')).toBe('limited');
      fn('pin-login', () => HttpResponse.json({}, { status: 500 }));
      expect(await testServices().pinLogin('+919800000001', '1111')).toBe('error');
      fn('pin-login', () => HttpResponse.error());
      expect(await testServices().pinLogin('+919800000001', '1111')).toBe('error');
      expect(localStorage.getItem(LOGIN_AT_KEY)).toBeNull();
    });

    it('a malformed answer, or the SDK refusing the session, is an error', async () => {
      fn('pin-login', () => HttpResponse.json({ access_token: 'a' }));
      expect(await testServices().pinLogin('+919800000001', '4817')).toBe('error');
      fn('pin-login', () => new HttpResponse('not json'));
      expect(await testServices().pinLogin('+919800000001', '4817')).toBe('error');
      fn('pin-login', () => HttpResponse.json(tokens));
      authClient.setSession.mockResolvedValueOnce({ error: { message: 'bad' } } as never);
      expect(await testServices().pinLogin('+919800000001', '4817')).toBe('error');
      authClient.setSession.mockRejectedValueOnce(new Error('boom'));
      expect(await testServices().pinLogin('+919800000001', '4817')).toBe('error');
    });

    it('still logs in when the login time cannot be stored', async () => {
      fn('pin-login', () => HttpResponse.json(tokens));
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('full');
      });
      expect(await testServices().pinLogin('+919800000001', '4817')).toBe('ok');
      spy.mockRestore();
    });
  });
});

describe('services wiring', () => {
  it('useServices needs a provider', async () => {
    const { useServices } = await import('./services.ts');
    const { renderHook } = await import('@testing-library/react');
    expect(() => renderHook(() => useServices())).toThrow('useServices outside ServicesContext');
  });
});
