import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./auth/client.ts', () => ({
  loadAuthClient: vi.fn(() =>
    Promise.resolve({ signOut: vi.fn(() => Promise.resolve({ error: null })) }),
  ),
}));

import { signIn, testServices } from '../test/render.tsx';
import { API, server } from '../test/server.ts';

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

  it('signOut, now and redeem deps', async () => {
    const s = testServices();
    await s.signOut();
    expect(typeof s.now()).toBe('number');
    expect(s.redeemDeps.uuid()).toMatch(/^[0-9a-f-]{36}$/);
    await expect(s.redeemDeps.waitOnline()).resolves.toBeUndefined();
  });
});

describe('services wiring', () => {
  it('real redeem deps sleep, randomise and refresh; useServices needs a provider', async () => {
    const { createServices, useServices } = await import('./services.ts');
    const { readConfig } = await import('./config.ts');
    const { renderHook } = await import('@testing-library/react');
    const s = createServices(readConfig({ VITE_SUPABASE_URL: API }));
    await expect(s.redeemDeps.sleep(1)).resolves.toBeUndefined();
    expect(s.redeemDeps.random()).toBeGreaterThanOrEqual(0);
    expect(await s.redeemDeps.refreshSession()).toBe(false);
    expect(() => renderHook(() => useServices())).toThrow('useServices outside ServicesContext');
  });
});
