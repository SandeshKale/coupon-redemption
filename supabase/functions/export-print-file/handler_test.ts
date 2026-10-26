import { assert, assertEquals } from '@std/assert';

import { testDeps } from '../_shared/test_util.ts';
import { handler, sha256Hex } from './handler.ts';

const U = 'https://proj.supabase.co/functions/v1/export-print-file';
const AUTH = { authorization: 'Bearer user-jwt' };

Deno.test('streams the print file, then records row count and SHA-256 (EC-015)', async () => {
  const pages = [
    [{ serial_no: 1, serial: 'P24-0000001', code13: '7KQ2M9XHTB4RJ', display_code: '7KQ2-M9XH-TB4R-J' }],
    [{ serial_no: 2, serial: 'P24-0000002', code13: '0000000000000', display_code: '0000-0000-0000-0' }],
    [],
  ];
  let page = 0;
  const deps = testDeps({
    rpc: { begin_lot_export: 11, export_lot_page: () => pages[page++], finish_lot_export: null },
  });
  const res = await handler(new Request(`${U}?lot_id=3&reason=reprint`, { headers: AUTH }), deps);
  assertEquals(res.status, 200);
  assert(res.headers.get('content-disposition')?.includes('lot-3-export-11.csv'));
  const text = await res.text();
  assertEquals(text.split('\r\n'), [
    'serial,code13,qr_url,display_code',
    'P24-0000001,7KQ2M9XHTB4RJ,HTTPS://C.EXAMPLE.IN/C/7KQ2M9XHTB4RJ,7KQ2-M9XH-TB4R-J',
    'P24-0000002,0000000000000,HTTPS://C.EXAMPLE.IN/C/0000000000000,0000-0000-0000-0',
    '',
  ]);
  const finish = deps.calls.find((c) => c.name === 'finish_lot_export');
  assertEquals(finish?.args, {
    p_export_id: 11,
    p_rows: 2,
    p_sha256: await sha256Hex([new TextEncoder().encode(text)]),
  });
  assertEquals((deps.calls[0]?.args as { p_reason: string }).p_reason, 'reprint');
  assertEquals((deps.calls[2]?.args as { p_after_serial: number }).p_after_serial, 1, 'keyset pagination');
});

Deno.test('bad lot id and method', async () => {
  assertEquals((await handler(new Request(`${U}?lot_id=x`, { headers: AUTH }), testDeps())).status, 400);
  assertEquals((await handler(new Request(U, { method: 'POST', headers: AUTH }), testDeps())).status, 405);
});
