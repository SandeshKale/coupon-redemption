import { assert, assertEquals } from '@std/assert';

import { ApiError } from '../_shared/supabase.ts';
import { post, testDeps } from '../_shared/test_util.ts';
import { handler } from './handler.ts';

const U = 'https://proj.supabase.co/functions/v1/pin-login';
const body = (o: unknown) => JSON.stringify(o);
const ok = { pin_login_check: { result: 'OK', user_id: 5, email: 'u5@users.example.in' } };
const session = { access_token: 'at', refresh_token: 'rt', expires_in: 3600, expires_at: 1790000000 };

Deno.test('a good mobile and PIN returns a session minted through generate_link and verify', async () => {
  const deps = testDeps({
    rpc: ok,
    auth: { 'POST generate_link': { hashed_token: 'hash-1' }, VERIFY: session },
  });
  const res = await handler(
    post(U, body({ mobile: '98765 43210', pin: '4817' }), { 'cf-connecting-ip': '1.2.3.4' }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    access_token: 'at',
    refresh_token: 'rt',
    expires_in: 3600,
    expires_at: 1790000000,
    token_type: 'bearer',
  });
  assertEquals(deps.calls.map((c) => `${c.kind}:${c.name}`), [
    'service:pin_login_check',
    'auth:POST generate_link',
    'verify:verify',
  ]);
  assertEquals(deps.calls[0]?.args, { p_mobile: '+919876543210', p_pin: '4817', p_ip: '1.2.3.4' });
  assertEquals(deps.calls[1]?.args, { type: 'magiclink', email: 'u5@users.example.in' });
  assertEquals(deps.calls[2]?.args, 'hash-1');
  assert(!deps.logs.some((l) => l.includes('4817')), 'the PIN is never logged');
});

Deno.test('the token hash may sit under properties', async () => {
  const deps = testDeps({
    rpc: ok,
    auth: { 'POST generate_link': { properties: { hashed_token: 'hash-2' } }, VERIFY: session },
  });
  const res = await handler(post(U, body({ mobile: '9876543210', pin: '4817' })), deps);
  assertEquals(res.status, 200);
  assertEquals(deps.calls[2]?.args, 'hash-2');
});

Deno.test('every failure is the same 401, whatever the reason', async () => {
  for (const why of ['unknown', 'wrong_pin', 'locked', 'no_pin', 'format']) {
    const deps = testDeps({ rpc: { pin_login_check: { result: 'FAILED', why } } });
    const res = await handler(post(U, body({ mobile: '9876543210', pin: '4817' })), deps);
    assertEquals([res.status, await res.json()], [401, { error: 'LOGIN_FAILED' }]);
    assert(!deps.calls.some((c) => c.kind === 'auth' || c.kind === 'verify'), 'no session is minted');
    assert(deps.logs.some((l) => l.includes(why)), 'the reason is logged for operators only');
  }
  const noReason = testDeps({ rpc: { pin_login_check: { result: 'FAILED' } } });
  assertEquals((await handler(post(U, body({ mobile: '9876543210', pin: '4817' })), noReason)).status, 401);
  const noEmail = testDeps({ rpc: { pin_login_check: { result: 'OK' } } });
  assertEquals((await handler(post(U, body({ mobile: '9876543210', pin: '4817' })), noEmail)).status, 401);
});

Deno.test('a malformed mobile looks like any other failed login and never reaches the database', async () => {
  const deps = testDeps();
  const res = await handler(post(U, body({ mobile: '123', pin: '4817' })), deps);
  assertEquals([res.status, (await res.json()).error], [401, 'LOGIN_FAILED']);
  assertEquals(deps.calls.length, 0);
});

Deno.test('rate limited requests get 429', async () => {
  const deps = testDeps({ rpc: { pin_login_check: { result: 'RATE_LIMITED' } } });
  const res = await handler(post(U, body({ mobile: '9876543210', pin: '4817' })), deps);
  assertEquals([res.status, (await res.json()).error], [429, 'RATE_LIMITED']);
});

Deno.test('a missing link token is a 502, not a session', async () => {
  const deps = testDeps({ rpc: ok, auth: { 'POST generate_link': {} } });
  const res = await handler(post(U, body({ mobile: '9876543210', pin: '4817' })), deps);
  assertEquals([res.status, (await res.json()).error], [502, 'SESSION_FAILED']);
});

Deno.test('auth service errors are logged and returned as a generic failure', async () => {
  const deps = testDeps({ rpc: ok, auth: { 'POST generate_link': new ApiError(500, 'x', 'boom') } });
  const res = await handler(post(U, body({ mobile: '9876543210', pin: '4817' })), deps);
  assertEquals([res.status, (await res.json()).error], [500, 'INTERNAL']);
});

Deno.test('validation, method and CORS preflight', async () => {
  const d = testDeps();
  assertEquals((await handler(post(U, 'not json'), d)).status, 400);
  assertEquals((await handler(post(U, body({ mobile: '9876543210' })), d)).status, 400);
  assertEquals((await handler(post(U, body({ mobile: '9876543210', pin: '4817', x: 1 })), d)).status, 400);
  assertEquals((await handler(new Request(U), d)).status, 405);
  const pre = await handler(new Request(U, { method: 'OPTIONS' }), d);
  assertEquals(pre.status, 204);
  assertEquals(pre.headers.get('access-control-allow-origin'), 'https://c.example.in');
  assertEquals(d.calls.length, 0);
});
