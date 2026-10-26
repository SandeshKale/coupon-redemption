import { assertEquals } from '@std/assert';

import { post, testDeps } from '../_shared/test_util.ts';
import { handler } from './handler.ts';

const U = 'https://proj.supabase.co/functions/v1/admin-user-status';
const AUTH = { authorization: 'Bearer user-jwt' };

Deno.test('EC-133 deactivation sets INACTIVE in the database and bans the Auth user', async () => {
  const deps = testDeps({
    rpc: { set_user_status: { auth_user_id: '00000000-0000-0000-0000-000000000002', status: 'INACTIVE' } },
    auth: { 'PUT users/:id': {} },
  });
  const res = await handler(
    post(U, JSON.stringify({ user_id: 2, status: 'INACTIVE', reason: 'left the shop' }), AUTH),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(deps.calls[1]?.args, { ban_duration: '876000h' });
});

Deno.test('reactivation lifts the ban; users without Auth rows skip it', async () => {
  const deps = testDeps({
    rpc: { set_user_status: { auth_user_id: '00000000-0000-0000-0000-000000000002', status: 'ACTIVE' } },
    auth: { 'PUT users/:id': {} },
  });
  await handler(post(U, JSON.stringify({ user_id: 2, status: 'ACTIVE', reason: 'back again' }), AUTH), deps);
  assertEquals(deps.calls[1]?.args, { ban_duration: 'none' });
  const noAuth = testDeps({ rpc: { set_user_status: { auth_user_id: null, status: 'ACTIVE' } } });
  await handler(
    post(U, JSON.stringify({ user_id: 2, status: 'ACTIVE', reason: 'back again' }), AUTH),
    noAuth,
  );
  assertEquals(noAuth.calls.length, 1);
});

Deno.test('input validation and method', async () => {
  assertEquals(
    (await handler(post(U, JSON.stringify({ user_id: 2, status: 'GONE', reason: 'x' }), AUTH), testDeps()))
      .status,
    400,
  );
  assertEquals((await handler(new Request(U, { headers: AUTH }), testDeps())).status, 405);
});
