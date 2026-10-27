import { assert, assertEquals } from '@std/assert';

import { ApiError } from '../_shared/supabase.ts';
import { post, testDeps } from '../_shared/test_util.ts';
import { handler } from './handler.ts';

const U = 'https://proj.supabase.co/functions/v1/admin-create-user';
const AUTH = { authorization: 'Bearer user-jwt' };
const okRpc = {
  precheck_new_user: { created_by: 7, email_domain: 'users.example.in' },
  register_app_user: 42,
  set_app_user_email: null,
};
const okAuth = { 'POST users': { id: '00000000-0000-0000-0000-0000000000aa' }, 'PUT users/:id': {} };

Deno.test('creates a dealer login: precheck as caller → auth user → app_user → internal email', async () => {
  const deps = testDeps({ rpc: okRpc, auth: okAuth });
  const res = await handler(
    post(
      U,
      JSON.stringify({
        name: 'Ravi',
        mobile: '98765 43210',
        role: 'DEALER_STAFF',
        dealer_id: 1,
        pin: '4817',
      }),
      AUTH,
    ),
    deps,
  );
  assertEquals(res.status, 201);
  assertEquals(await res.json(), { user_id: 42 });
  assertEquals(deps.calls.map((c) => `${c.kind}:${c.name}`), [
    'user:precheck_new_user',
    'auth:POST users',
    'service:register_app_user',
    'auth:PUT users/:id',
    'service:set_app_user_email',
  ]);
  assertEquals(
    deps.calls[0]?.jwt,
    'user-jwt',
    'authorisation is decided by the database under the caller JWT',
  );
  assertEquals((deps.calls[0]?.args as { p_mobile: string }).p_mobile, '+919876543210');
  assertEquals((deps.calls[4]?.args as { p_email: string }).p_email, 'u42@users.example.in');
});

Deno.test('24M users keep their real email and need one', async () => {
  const deps = testDeps({ rpc: okRpc, auth: okAuth });
  const res = await handler(
    post(U, JSON.stringify({ name: 'Asha', email: 'asha@24m.in', role: 'M24_FINANCE' }), AUTH),
    deps,
  );
  assertEquals(res.status, 201);
  assertEquals((deps.calls[1]?.args as { email: string }).email, 'asha@24m.in');
  assert(!deps.calls.some((c) => c.name === 'set_app_user_email'));
  const missing = await handler(
    post(U, JSON.stringify({ name: 'Asha', role: 'M24_ADMIN' }), AUTH),
    testDeps(),
  );
  assertEquals((await missing.json()).error, 'EMAIL_REQUIRED');
});

Deno.test('validation: unknown fields, bad mobile, dealer roles need a mobile', async () => {
  const d = testDeps();
  assertEquals((await handler(post(U, JSON.stringify({ name: 'R', role: 'X' }), AUTH), d)).status, 400);
  assertEquals(
    (await handler(post(U, JSON.stringify({ name: 'Ravi', role: 'DEALER_STAFF', hack: 1 }), AUTH), d)).status,
    400,
  );
  assertEquals(
    (await (await handler(
      post(U, JSON.stringify({ name: 'Ravi', role: 'DEALER_STAFF', mobile: '123' }), AUTH),
      d,
    )).json()).error,
    'BAD_MOBILE',
  );
  assertEquals(
    (await (await handler(post(U, JSON.stringify({ name: 'Ravi', role: 'DEALER_STAFF' }), AUTH), d)).json())
      .error,
    'MOBILE_REQUIRED',
  );
  assertEquals(
    (await (await handler(
      post(U, JSON.stringify({ name: 'Ravi', role: 'DEALER_STAFF', mobile: '9876543210' }), AUTH),
      d,
    )).json()).error,
    'PIN_REQUIRED',
  );
  assertEquals(
    (await handler(
      post(U, JSON.stringify({ name: 'Ravi', role: 'DEALER_STAFF', mobile: '9876543210', pin: '12' }), AUTH),
      d,
    )).status,
    400,
    'a PIN must be exactly four digits',
  );
  assertEquals((await handler(post(U, 'not json', AUTH), d)).status, 400);
  assertEquals((await handler(new Request(U, { headers: AUTH }), d)).status, 405);
  assertEquals(d.calls.length, 0);
});

Deno.test('EC-136 forbidden callers stop before any Auth user is created', async () => {
  const deps = testDeps({ rpc: { precheck_new_user: new ApiError(403, 'PT403', 'FORBIDDEN') } });
  const res = await handler(
    post(
      U,
      JSON.stringify({ name: 'Ravi', mobile: '9876543210', role: 'DEALER_OWNER', dealer_id: 9, pin: '4817' }),
      AUTH,
    ),
    deps,
  );
  assertEquals([res.status, (await res.json()).error], [403, 'FORBIDDEN']);
  assert(!deps.calls.some((c) => c.kind === 'auth'));
});

Deno.test('compensates: deletes the Auth user when app_user registration fails', async () => {
  const deps = testDeps({
    rpc: { ...okRpc, register_app_user: new ApiError(409, '23505', 'duplicate') },
    auth: { ...okAuth, 'DELETE users/:id': {} },
  });
  const res = await handler(
    post(
      U,
      JSON.stringify({ name: 'Ravi', mobile: '9876543210', role: 'DEALER_STAFF', dealer_id: 1, pin: '4817' }),
      AUTH,
    ),
    deps,
  );
  assertEquals(res.status, 409);
  assert(deps.calls.some((c) => c.name === 'DELETE users/:id'));
});

Deno.test('a non-API registration failure still compensates and returns 500', async () => {
  const deps = testDeps({
    rpc: { ...okRpc, register_app_user: new Error('socket') },
    auth: { ...okAuth, 'DELETE users/:id': {} },
  });
  const res = await handler(
    post(
      U,
      JSON.stringify({ name: 'Ravi', mobile: '9876543210', role: 'DEALER_STAFF', dealer_id: 1, pin: '4817' }),
      AUTH,
    ),
    deps,
  );
  assertEquals(res.status, 500);
});

Deno.test('internal email update is best effort', async () => {
  const deps = testDeps({ rpc: okRpc, auth: { ...okAuth, 'PUT users/:id': new Error('auth down') } });
  const res = await handler(
    post(
      U,
      JSON.stringify({ name: 'Ravi', mobile: '9876543210', role: 'DEALER_STAFF', dealer_id: 1, pin: '4817' }),
      AUTH,
    ),
    deps,
  );
  assertEquals(res.status, 201);
  assert(deps.logs.some((l) => l.includes('internal_email_not_set')));
});

Deno.test('a distributor adds a new dealer: PIN, GST and parent distributor reach the database', async () => {
  const deps = testDeps({ rpc: okRpc, auth: okAuth });
  const res = await handler(
    post(
      U,
      JSON.stringify({
        name: 'Om Paints',
        mobile: '9822200001',
        role: 'DEALER_OWNER',
        parent_distributor_id: 1,
        pin: '2468',
        gst: ' 27aaapl1234c1z5 ',
      }),
      AUTH,
    ),
    deps,
  );
  assertEquals(res.status, 201);
  const pre = deps.calls.find((c) => c.name === 'precheck_new_user')?.args as Record<string, unknown>;
  assertEquals([pre['p_parent_distributor'], pre['p_is_rep'], pre['p_dealer_id']], [1, false, null]);
  const reg = deps.calls.find((c) => c.name === 'register_app_user')?.args as Record<string, unknown>;
  assertEquals(
    [reg['p_pin'], reg['p_gst'], reg['p_parent_distributor_id'], reg['p_is_rep']],
    ['2468', '27AAAPL1234C1Z5', 1, false],
  );
});

Deno.test('24M adds a sales rep: the rep flag is passed on, and a bad GST is rejected', async () => {
  const deps = testDeps({ rpc: okRpc, auth: okAuth });
  const res = await handler(
    post(
      U,
      JSON.stringify({
        name: 'Rep One',
        mobile: '9822200005',
        role: 'DISTRIBUTOR',
        distributor_id: 1,
        is_rep: true,
        pin: '8642',
      }),
      AUTH,
    ),
    deps,
  );
  assertEquals(res.status, 201);
  const reg = deps.calls.find((c) => c.name === 'register_app_user')?.args as Record<string, unknown>;
  assertEquals(reg['p_is_rep'], true);
  const bad = await handler(
    post(
      U,
      JSON.stringify({
        name: 'Om',
        mobile: '9822200001',
        role: 'DEALER_OWNER',
        parent_distributor_id: 1,
        pin: '2468',
        gst: 'nope',
      }),
      AUTH,
    ),
    testDeps(),
  );
  assertEquals(bad.status, 400);
});
