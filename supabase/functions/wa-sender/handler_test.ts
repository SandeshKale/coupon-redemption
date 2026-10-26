import { assertEquals } from '@std/assert';

import { post, testDeps } from '../_shared/test_util.ts';
import { handler } from './handler.ts';

const URL_ = 'https://proj.supabase.co/functions/v1/wa-sender';
const row = (id: number) => ({ id, to_e164: '+919811111111', body: 'hello', attempts: 1 });

function queue(...batches: unknown[][]): () => unknown[] {
  let i = 0;
  return () => batches[i++] ?? [];
}

Deno.test('requires the internal secret', async () => {
  const res = await handler(post(URL_, '{}', { 'x-internal-secret': 'nope' }), testDeps());
  assertEquals(res.status, 401);
});

Deno.test('fails closed when no secret is configured', async () => {
  const res = await handler(
    post(URL_, '{}', { 'x-internal-secret': '' }),
    testDeps({ env: { waSenderSecret: '' } }),
  );
  assertEquals(res.status, 401);
});

Deno.test('only POST', async () => {
  const res = await handler(new Request(URL_), testDeps());
  assertEquals(res.status, 405);
});

Deno.test('sends and marks SENT with the Meta id', async () => {
  const deps = testDeps({
    rpc: { wa_claim_outbox: queue([row(1)]), wa_mark_sent: null },
    fetch: { 'graph.facebook.com': () => Response.json({ messages: [{ id: 'wamid.out1' }] }) },
  });
  const res = await handler(post(URL_, '{}', { 'x-internal-secret': 'sender-secret-test' }), deps);
  assertEquals(await res.json(), { sent: 1, failed: 0 });
  assertEquals(deps.calls.find((c) => c.name === 'wa_mark_sent')?.args, { p_id: 1, p_meta_id: 'wamid.out1' });
  const graph = deps.calls.find((c) => c.kind === 'fetch');
  assertEquals(graph?.name, 'https://graph.facebook.com/v21.0/106540352242922/messages');
  assertEquals(JSON.parse(String(graph?.args)).to, '919811111111');
});

Deno.test('EC-089 rate limit and 5xx are retryable; 4xx are not; network errors are retryable', async () => {
  const statuses = [429, 503, 400];
  let n = 0;
  const deps = testDeps({
    rpc: { wa_claim_outbox: queue([row(1), row(2), row(3), row(4)]), wa_mark_failed: 'RETRY' },
    fetch: {
      'graph.facebook.com': () => {
        const s = statuses[n++];
        if (s === undefined) throw new TypeError('network down');
        return Response.json({ error: { message: 'x' } }, { status: s });
      },
    },
  });
  const res = await handler(post(URL_, '{}', { 'x-internal-secret': 'sender-secret-test' }), deps);
  assertEquals(await res.json(), { sent: 0, failed: 4 });
  const retryable = deps.calls.filter((c) => c.name === 'wa_mark_failed').map((c) =>
    (c.args as { p_retryable: boolean }).p_retryable
  );
  assertEquals(retryable, [true, true, false, true]);
});

Deno.test('a success without a message id still marks SENT', async () => {
  const deps = testDeps({
    rpc: { wa_claim_outbox: queue([row(5)]), wa_mark_sent: null },
    fetch: { 'graph.facebook.com': () => new Response('not json', { status: 200 }) },
  });
  const res = await handler(post(URL_, '{}', { 'x-internal-secret': 'sender-secret-test' }), deps);
  assertEquals(await res.json(), { sent: 1, failed: 0 });
  assertEquals(deps.calls.find((c) => c.name === 'wa_mark_sent')?.args, { p_id: 5, p_meta_id: null });
});
