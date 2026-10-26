import { assert, assertEquals } from '@std/assert';

import { fixture, post, sign, testDeps } from '../_shared/test_util.ts';
import { ApiError } from '../_shared/supabase.ts';
import { handler, MAX_BODY_BYTES } from './handler.ts';

const URL_ = 'https://proj.supabase.co/functions/v1/wa-webhook';

Deno.test('GET verification echoes the challenge for the right token', async () => {
  const res = await handler(
    new Request(`${URL_}?hub.mode=subscribe&hub.verify_token=verify-token-test&hub.challenge=42`),
    testDeps(),
  );
  assertEquals(res.status, 200);
  assertEquals(await res.text(), '42');
});

Deno.test('EC-086 GET verification with a wrong token is 403', async () => {
  const res = await handler(
    new Request(`${URL_}?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42`),
    testDeps(),
  );
  assertEquals(res.status, 403);
  await res.body?.cancel();
});

Deno.test('GET verification fails closed when no verify token is configured', async () => {
  const res = await handler(
    new Request(`${URL_}?hub.mode=subscribe&hub.verify_token=&hub.challenge=1`),
    testDeps({ env: { metaVerifyToken: '' } }),
  );
  assertEquals(res.status, 403);
  await res.body?.cancel();
});

Deno.test('other methods are 405', async () => {
  const res = await handler(new Request(URL_, { method: 'PUT' }), testDeps());
  assertEquals(res.status, 405);
});

Deno.test('non-JSON content types are rejected', async () => {
  const res = await handler(post(URL_, 'x', { 'content-type': 'text/plain' }), testDeps());
  assertEquals(res.status, 415);
});

Deno.test('EC-156 oversized bodies are rejected before signature checks', async () => {
  const deps = testDeps();
  const res = await handler(post(URL_, 'x'.repeat(MAX_BODY_BYTES + 1)), deps);
  assertEquals(res.status, 413);
  assertEquals(deps.calls.length, 0);
});

Deno.test('EC-085 bad signature is 401 and nothing is processed', async () => {
  const body = fixture('meta_text_message.json');
  const deps = testDeps();
  const res = await handler(post(URL_, body, { 'x-hub-signature-256': await sign(body, 'wrong') }), deps);
  assertEquals(res.status, 401);
  assertEquals(deps.calls.length, 0);
  assert(deps.logs.some((l) => l.includes('bad_signature')));
});

Deno.test('missing signature is 401', async () => {
  const res = await handler(post(URL_, fixture('meta_text_message.json')), testDeps());
  assertEquals(res.status, 401);
});

Deno.test('EC-070 a signed text message is parsed once (shared parser) and handed to the database', async () => {
  const body = fixture('meta_text_message.json');
  const deps = testDeps({
    rpc: { wa_handle_inbound: { result: 'CONFIRMED', outbox_id: 9 }, wa_claim_outbox: [] },
  });
  const res = await handler(post(URL_, body, { 'x-hub-signature-256': await sign(body) }), deps);
  assertEquals(res.status, 200);
  const call = deps.calls.find((c) => c.name === 'wa_handle_inbound');
  assertEquals(call?.kind, 'service');
  assertEquals(call?.args, {
    p_wamid: 'wamid.HBgMOTE5ODExMTExMTExFQIAEhgUM0EwRkVEQ0Q4NjA2NjQ5QjEzRDkA',
    p_from: '+919811111111',
    p_body: '24M PAID K7Q2M9',
    p_type: 'text',
    p_msg_ts: '2025-10-26T12:00:00.000Z',
    p_intent: 'CONFIRM',
    p_token: 'K7Q2M9',
  });
  assertEquals(deps.background.length, 1, 'reply sending runs in the background');
  await Promise.all(deps.background);
  assert(!deps.logs.join().includes('9811111111'), 'logs never contain the full number');
});

Deno.test('EC-087 status events are ignored', async () => {
  const body = fixture('meta_status_event.json');
  const deps = testDeps();
  const res = await handler(post(URL_, body, { 'x-hub-signature-256': await sign(body) }), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).processed, 0);
  assertEquals(deps.calls.length, 0);
});

Deno.test('EC-083 media becomes HELP; bad sender and malformed messages are skipped', async () => {
  const body = fixture('meta_media_message.json');
  const deps = testDeps({ rpc: { wa_handle_inbound: { result: 'HELP', outbox_id: null } } });
  const res = await handler(post(URL_, body, { 'x-hub-signature-256': await sign(body) }), deps);
  assertEquals(res.status, 200);
  const calls = deps.calls.filter((c) => c.name === 'wa_handle_inbound');
  assertEquals(calls.length, 1);
  assertEquals((calls[0]?.args as { p_intent: string }).p_intent, 'HELP');
  assertEquals(deps.background.length, 0, 'no reply queued → no sender run');
});

Deno.test('a database failure is recorded for replay and Meta still gets 200', async () => {
  const body = fixture('meta_text_message.json');
  const deps = testDeps({
    rpc: { wa_handle_inbound: new ApiError(500, 'XX000', 'boom'), wa_record_error: null },
  });
  const res = await handler(post(URL_, body, { 'x-hub-signature-256': await sign(body) }), deps);
  assertEquals(res.status, 200);
  assert(deps.calls.some((c) => c.name === 'wa_record_error'));
});

Deno.test('invalid JSON with a valid signature is 400', async () => {
  const body = '{not json';
  const res = await handler(post(URL_, body, { 'x-hub-signature-256': await sign(body) }), testDeps());
  assertEquals(res.status, 400);
});

Deno.test('signed payloads for other products are acknowledged without processing', async () => {
  const body = JSON.stringify({ object: 'page', entry: [] });
  const deps = testDeps();
  const res = await handler(post(URL_, body, { 'x-hub-signature-256': await sign(body) }), deps);
  assertEquals(res.status, 200);
  assertEquals(deps.calls.length, 0);
});
