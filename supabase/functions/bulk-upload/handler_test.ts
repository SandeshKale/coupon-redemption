import { assertEquals } from '@std/assert';

import { testDeps } from '../_shared/test_util.ts';
import { handler } from './handler.ts';

const U = 'https://proj.supabase.co/functions/v1/bulk-upload';
const AUTH = { authorization: 'Bearer user-jwt', 'content-type': 'text/csv' };
const HEADER = 'code,name,mobile,city,distributor_code\n';
const req = (csv: string, q = '') => new Request(U + q, { method: 'POST', body: csv, headers: AUTH });

Deno.test('dry run by default; rows normalised and passed to the database under the caller JWT', async () => {
  const deps = testDeps({
    rpc: { bulk_upsert_dealers: { ok: true, rows: 1, errors: [], committed: false } },
  });
  const res = await handler(req(HEADER + 'dlr-9,"Shree Paints, Pune",98765 43210,,dist-pune\n'), deps);
  assertEquals(res.status, 200);
  assertEquals(deps.calls[0]?.args, {
    p_rows: [{
      code: 'DLR-9',
      name: 'Shree Paints, Pune',
      mobile_e164: '+919876543210',
      city: null,
      distributor_code: 'DIST-PUNE',
    }],
    p_dry_run: true,
  });
  assertEquals(deps.calls[0]?.jwt, 'user-jwt');
});

Deno.test('commit with dry_run=false', async () => {
  const deps = testDeps({ rpc: { bulk_upsert_dealers: { committed: true } } });
  await handler(req(HEADER + 'D-1,Shop,9876543210,Pune,DIST-PUNE\n', '?dry_run=false'), deps);
  assertEquals((deps.calls[0]?.args as { p_dry_run: boolean }).p_dry_run, false);
});

Deno.test('EC-130 bad rows produce a report and nothing reaches the database', async () => {
  const deps = testDeps();
  const res = await handler(req(HEADER + 'D-1,Shop,123,Pune,DIST-PUNE\n!!,X,9876543210,,DIST-PUNE\n'), deps);
  assertEquals(await res.json(), {
    ok: false,
    rows: 2,
    errors: [{ row: 1, error: 'BAD_MOBILE' }, { row: 2, error: 'BAD_ROW' }],
    committed: false,
  });
  assertEquals(deps.calls.length, 0);
});

Deno.test('header, empty, size and method checks', async () => {
  assertEquals((await (await handler(req('a,b\n1,2\n'), testDeps())).json()).error, 'BAD_HEADER');
  assertEquals((await (await handler(req(HEADER), testDeps())).json()).error, 'EMPTY');
  assertEquals((await handler(req('x'.repeat(2 * 1024 * 1024 + 1)), testDeps())).status, 413);
  assertEquals((await handler(new Request(U, { headers: AUTH }), testDeps())).status, 405);
});
