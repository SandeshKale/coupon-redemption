import { http, HttpResponse } from 'msw';
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';

import { API, server } from '../../test/server.ts';

import { createApi, outcomeUnknown } from './client.ts';

const api = (over: Partial<Parameters<typeof createApi>[0]> = {}) =>
  createApi({
    baseUrl: API,
    anonKey: 'anon',
    fetch: globalThis.fetch.bind(globalThis),
    getToken: () => Promise.resolve('tok'),
    online: () => true,
    ...over,
  });
const S = v.object({ ok: v.boolean() });

describe('createApi', () => {
  it('posts RPC args with the user token and validates the response', async () => {
    let seen: Request | null = null;
    server.use(
      http.post(`${API}/rest/v1/rpc/f`, ({ request }) => {
        seen = request;
        return HttpResponse.json({ ok: true });
      }),
    );
    expect(await api().rpc('f', { a: 1 }, S)).toEqual({ ok: true, data: { ok: true } });
    expect(seen!.headers.get('authorization')).toBe('Bearer tok');
    expect(seen!.headers.get('apikey')).toBe('anon');
  });

  it('falls back to the anon key without a session', async () => {
    let auth = '';
    server.use(
      http.get(
        `${API}/rest/v1/t`,
        ({ request }) => (
          (auth = request.headers.get('authorization') ?? ''),
          HttpResponse.json({ ok: true })
        ),
      ),
    );
    await api({ getToken: () => Promise.resolve(null) }).select('t', S);
    expect(auth).toBe('Bearer anon');
  });

  it.each([
    [401, { message: 'AUTH_REQUIRED' }, { kind: 'auth' }],
    [403, { message: 'MFA_REQUIRED' }, { kind: 'forbidden', code: 'MFA_REQUIRED' }],
    [403, {}, { kind: 'forbidden', code: 'FORBIDDEN' }],
    [409, { message: 'DUPLICATE_CN' }, { kind: 'business', code: 'DUPLICATE_CN', status: 409 }],
    [404, { code: 'PGRST202' }, { kind: 'business', code: 'PGRST202', status: 404 }],
    [400, 'x', { kind: 'business', code: '400', status: 400 }],
    [503, {}, { kind: 'server', status: 503 }],
  ])('maps HTTP %i to a typed failure', async (status, body, expected) => {
    server.use(http.post(`${API}/rest/v1/rpc/f`, () => HttpResponse.json(body, { status })));
    expect(await api().rpc('f', {}, S)).toEqual({ ok: false, error: expected });
  });

  it('EC-048 schema mismatch is a failure, never success', async () => {
    server.use(http.post(`${API}/rest/v1/rpc/f`, () => HttpResponse.json({ ok: 'yes' })));
    expect(await api().rpc('f', {}, S)).toEqual({ ok: false, error: { kind: 'schema' } });
  });

  it('EC-047 captive portal HTML is treated as offline-like', async () => {
    server.use(
      http.post(
        `${API}/rest/v1/rpc/f`,
        () => new HttpResponse('<html>login</html>', { headers: { 'content-type': 'text/html' } }),
      ),
    );
    expect(await api().rpc('f', {}, S)).toEqual({ ok: false, error: { kind: 'captive' } });
  });

  it('invalid JSON bodies', async () => {
    server.use(
      http.post(
        `${API}/rest/v1/rpc/ok`,
        () => new HttpResponse('{', { headers: { 'content-type': 'application/json' } }),
      ),
    );
    server.use(
      http.post(
        `${API}/rest/v1/rpc/bad`,
        () =>
          new HttpResponse('{', { status: 500, headers: { 'content-type': 'application/json' } }),
      ),
    );
    expect(await api().rpc('ok', {}, S)).toEqual({ ok: false, error: { kind: 'schema' } });
    expect(await api().rpc('bad', {}, S)).toEqual({
      ok: false,
      error: { kind: 'server', status: 500 },
    });
  });

  it('204 responses parse as null', async () => {
    server.use(http.post(`${API}/rest/v1/rpc/f`, () => new HttpResponse(null, { status: 204 })));
    expect(await api().rpc('f', {}, v.null())).toEqual({ ok: true, data: null });
  });

  it('EC-040 offline: no request is sent', async () => {
    expect(await api({ online: () => false }).rpc('f', {}, S)).toEqual({
      ok: false,
      error: { kind: 'offline' },
    });
  });

  it('network errors: network when online, offline when the connection dropped', async () => {
    const failing = (() => Promise.reject(new TypeError('x'))) as typeof fetch;
    expect(await api({ fetch: failing }).rpc('f', {}, S)).toEqual({
      ok: false,
      error: { kind: 'network' },
    });
    let calls = 0;
    expect(await api({ fetch: failing, online: () => calls++ === 0 }).rpc('f', {}, S)).toEqual({
      ok: false,
      error: { kind: 'offline' },
    });
  });

  it('times out', async () => {
    const hang = ((_: unknown, init?: RequestInit) =>
      new Promise((_r, reject) => {
        if (init?.signal?.aborted === true) reject(new DOMException('aborted', 'AbortError'));
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      })) as typeof fetch;
    expect(await api({ fetch: hang }).rpc('f', {}, S, { timeoutMs: 5 })).toEqual({
      ok: false,
      error: { kind: 'timeout' },
    });
    const ctl = new AbortController();
    const p = api({ fetch: hang }).rpc('f', {}, S, { signal: ctl.signal });
    ctl.abort();
    expect(await p).toEqual({ ok: false, error: { kind: 'timeout' } });
  });

  it('outcomeUnknown', () => {
    expect(outcomeUnknown({ kind: 'timeout' })).toBe(true);
    expect(outcomeUnknown({ kind: 'network' })).toBe(true);
    expect(outcomeUnknown({ kind: 'server', status: 500 })).toBe(true);
    expect(outcomeUnknown({ kind: 'captive' })).toBe(true);
    expect(outcomeUnknown({ kind: 'offline' })).toBe(true);
    expect(outcomeUnknown({ kind: 'auth' })).toBe(false);
    expect(outcomeUnknown({ kind: 'business', code: 'x', status: 409 })).toBe(false);
    expect(outcomeUnknown({ kind: 'schema' })).toBe(false);
  });
});
