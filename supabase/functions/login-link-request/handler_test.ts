import { assertEquals } from '@std/assert';

import { post, testDeps } from '../_shared/test_util.ts';
import { handler } from './handler.ts';

const U = 'https://proj.supabase.co/functions/v1/login-link-request';

Deno.test('works without a JWT and passes the client IP to the rate limiter', async () => {
  const deps = testDeps({ rpc: { record_login_link_request: { result: 'RECEIVED' } } });
  const res = await handler(
    post(U, JSON.stringify({ mobile: '9800000001' }), { 'cf-connecting-ip': '1.2.3.4' }),
    deps,
  );
  assertEquals([res.status, (await res.json()).result], [202, 'RECEIVED']);
  assertEquals(deps.calls[0]?.args, { p_mobile: '+919800000001', p_ip: '1.2.3.4' });
});

Deno.test('rate limited → 429', async () => {
  const deps = testDeps({ rpc: { record_login_link_request: { result: 'RATE_LIMITED' } } });
  assertEquals((await handler(post(U, JSON.stringify({ mobile: '9800000001' })), deps)).status, 429);
});

Deno.test('bad input', async () => {
  assertEquals((await handler(post(U, JSON.stringify({ mobile: '12' })), testDeps())).status, 400);
  assertEquals((await handler(post(U, JSON.stringify({ phone: '9800000001' })), testDeps())).status, 400);
  assertEquals((await handler(new Request(U), testDeps())).status, 405);
});
