import { assertEquals } from '@std/assert';

import { testDeps } from '../_shared/test_util.ts';
import { handler } from './handler.ts';

Deno.test('healthy when the database answers', async () => {
  const deps = testDeps({ fetch: { '/rest/v1/app_config': () => Response.json([{ key: 'x' }]) } });
  const res = await handler(new Request('http://x/health'), deps);
  assertEquals([res.status, (await res.json()).ok], [200, true]);
});

Deno.test('503 when the database errors or is unreachable', async () => {
  const bad = testDeps({ fetch: { '/rest/v1/app_config': () => new Response('x', { status: 500 }) } });
  assertEquals((await handler(new Request('http://x/health'), bad)).status, 503);
  assertEquals((await handler(new Request('http://x/health'), testDeps())).status, 503);
});
