import { assert, assertEquals } from '@std/assert';

import { ApiError } from '../_shared/supabase.ts';
import { post, testDeps } from '../_shared/test_util.ts';
import { handler } from './handler.ts';

const U = 'https://proj.supabase.co/functions/v1/admin-login-link';
const AUTH = { authorization: 'Bearer user-jwt' };
const target = {
  user_id: 3,
  email: 'u3@users.example.in',
  mobile_e164: '+919800000003',
  name: 'Owner B',
  issued_by: 5,
};

Deno.test('returns a one-time magic link and a WhatsApp share URL', async () => {
  const deps = testDeps({
    rpc: { login_link_target: target, record_login_link_issued: null },
    auth: {
      'POST generate_link': {
        action_link: 'https://proj.supabase.co/auth/v1/verify?token=abc&type=magiclink',
      },
    },
  });
  const res = await handler(post(U, JSON.stringify({ user_id: 3 }), AUTH), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assert(body.link.includes('type=magiclink'));
  assert(body.whatsapp_url.startsWith('https://wa.me/919800000003?text='));
  assertEquals(
    (deps.calls[1]?.args as { redirect_to: string }).redirect_to,
    'https://c.example.in/auth/callback',
  );
  assert(deps.calls.some((c) => c.name === 'record_login_link_issued'));
});

Deno.test('supports the nested properties.action_link shape and users without a mobile', async () => {
  const deps = testDeps({
    rpc: { login_link_target: { ...target, mobile_e164: null }, record_login_link_issued: null },
    auth: { 'POST generate_link': { properties: { action_link: 'https://x/verify' } } },
  });
  const body = await (await handler(post(U, JSON.stringify({ user_id: 3 }), AUTH), deps)).json();
  assertEquals([body.link, body.whatsapp_url], ['https://x/verify', null]);
});

Deno.test('fails cleanly when Auth returns no link', async () => {
  const deps = testDeps({ rpc: { login_link_target: target }, auth: { 'POST generate_link': {} } });
  assertEquals((await handler(post(U, JSON.stringify({ user_id: 3 }), AUTH), deps)).status, 502);
});

Deno.test('forbidden / bad input / method', async () => {
  const forbidden = testDeps({ rpc: { login_link_target: new ApiError(403, 'PT403', 'FORBIDDEN') } });
  assertEquals((await handler(post(U, JSON.stringify({ user_id: 3 }), AUTH), forbidden)).status, 403);
  assert(!forbidden.calls.some((c) => c.kind === 'auth'));
  assertEquals((await handler(post(U, JSON.stringify({ user_id: 'x' }), AUTH), testDeps())).status, 400);
  assertEquals((await handler(new Request(U, { headers: AUTH }), testDeps())).status, 405);
});
