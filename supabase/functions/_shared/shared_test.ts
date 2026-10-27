import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert';

import { browserFunction } from './browser.ts';
import { csvCell, parseCsv } from './csv.ts';
import { readEnv } from './env.ts';
import { bearer, clientIp, json, readLimited, timingSafeEqual } from './http.ts';
import { makeLogger, scrub } from './log.ts';
import { extractMessages, verifyMetaSignature } from './meta.ts';
import { ApiError, makeSupa, statusFor } from './supabase.ts';
import { sign, TEST_ENV, testDeps } from './test_util.ts';

Deno.test('timingSafeEqual', () => {
  assert(timingSafeEqual('abc', 'abc'));
  assert(!timingSafeEqual('abc', 'abd'));
  assert(!timingSafeEqual('abc', 'abcd'));
  assert(timingSafeEqual('', ''));
});

Deno.test('readLimited enforces the limit while streaming and by content-length', async () => {
  assertEquals(
    (await readLimited(new Request('http://x', { method: 'POST', body: 'hello' }), 10))?.length,
    5,
  );
  assertEquals(await readLimited(new Request('http://x', { method: 'POST', body: 'hello world!' }), 5), null);
  const declared = new Request('http://x', {
    method: 'POST',
    body: 'hi',
    headers: { 'content-length': '999' },
  });
  assertEquals(await readLimited(declared, 10), null);
  assertEquals((await readLimited(new Request('http://x'), 10))?.length, 0);
  const stream = new ReadableStream({
    start(c): void {
      c.enqueue(new TextEncoder().encode('abc'));
      c.enqueue(new TextEncoder().encode('def'));
      c.close();
    },
  });
  assertEquals(
    new TextDecoder().decode(
      (await readLimited(new Request('http://x', { method: 'POST', body: stream }), 10)) ?? undefined,
    ),
    'abcdef',
  );
});

Deno.test('bearer and clientIp', () => {
  assertEquals(bearer(new Request('http://x', { headers: { authorization: 'Bearer abc' } })), 'abc');
  assertEquals(bearer(new Request('http://x')), null);
  assertEquals(clientIp(new Request('http://x', { headers: { 'cf-connecting-ip': '1.1.1.1' } })), '1.1.1.1');
  assertEquals(
    clientIp(new Request('http://x', { headers: { 'x-forwarded-for': '2.2.2.2, 3.3.3.3' } })),
    '2.2.2.2',
  );
  assertEquals(clientIp(new Request('http://x')), 'unknown');
});

Deno.test('scrub masks phone numbers anywhere in log fields', () => {
  assertEquals(scrub({ a: 'from 919811114521', b: ['+919811114521'], c: 3, d: null }), {
    a: 'from +91 98•••• 4521',
    b: ['+91 98•••• 4521'],
    c: 3,
    d: null,
  });
  const lines: string[] = [];
  makeLogger('fn', 'req-1', (l) => lines.push(l)).log('info', 'ok', { phone: '919811114521' });
  const parsed = JSON.parse(lines[0] ?? '{}');
  assertEquals([parsed.fn, parsed.request_id, parsed.outcome, parsed.phone], [
    'fn',
    'req-1',
    'ok',
    '+91 98•••• 4521',
  ]);
});

Deno.test('Meta signature verification', async () => {
  const body = new TextEncoder().encode('{"a":1}');
  assert(await verifyMetaSignature(body, await sign('{"a":1}'), TEST_ENV.metaAppSecret));
  assert(
    await verifyMetaSignature(
      body,
      (await sign('{"a":1}')).toUpperCase().replace('SHA256=', 'sha256='),
      TEST_ENV.metaAppSecret,
    ),
  );
  assert(!(await verifyMetaSignature(body, await sign('{"a":2}'), TEST_ENV.metaAppSecret)));
  assert(!(await verifyMetaSignature(body, 'md5=abc', TEST_ENV.metaAppSecret)));
  assert(!(await verifyMetaSignature(body, null, TEST_ENV.metaAppSecret)));
  assert(!(await verifyMetaSignature(body, await sign('{"a":1}', 'any'), '')), 'empty secret never verifies');
});

Deno.test('extractMessages ignores non-message fields', () => {
  assertEquals(
    extractMessages({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ field: 'account_update', value: {} }] }],
    }),
    { messages: [], invalid: 0 },
  );
  assertEquals(extractMessages({ nope: true }), null);
});

Deno.test('CSV parser handles quotes, escaped quotes, CRLF, BOM and blank lines', () => {
  assertEquals(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n\n1,2'), [['a', 'b'], ['x, y', 'say "hi"'], ['1', '2']]);
  assertEquals(parseCsv('a,b'), [['a', 'b']]);
  assertEquals(parseCsv('a,\n'), [['a', '']]);
});

Deno.test('csvCell quotes and neutralises formula injection', () => {
  assertEquals(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assertEquals(csvCell('+91'), `'+91`);
  assertEquals(csvCell('a,b'), '"a,b"');
  assertEquals(csvCell(null), '');
  assertEquals(csvCell(5), '5');
});

Deno.test('readEnv validates required keys and defaults the rest', () => {
  const env = readEnv((k) =>
    ({ SUPABASE_URL: 'u', SUPABASE_SERVICE_ROLE_KEY: 's', SUPABASE_ANON_KEY: 'a' })[k]
  );
  assertEquals([env.metaGraphVersion, env.couponHost, env.metaAppSecret], ['v21.0', 'c.example.in', '']);
  assertThrows(() => readEnv(() => undefined), Error, 'missing env SUPABASE_URL');
});

Deno.test('makeSupa calls PostgREST and GoTrue with the right keys and maps errors', async () => {
  const seen: Request[] = [];
  const fake = ((input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init);
    seen.push(req);
    if (req.url.endsWith('/rpc/bad')) {
      return Promise.resolve(Response.json({ code: 'PT403', message: 'FORBIDDEN' }, { status: 403 }));
    }
    if (req.url.endsWith('/rpc/empty')) return Promise.resolve(new Response('', { status: 200 }));
    if (req.url.endsWith('/rpc/text')) return Promise.resolve(new Response('{}', { status: 500 }));
    return Promise.resolve(Response.json({ ok: true }));
  }) as typeof fetch;
  const supa = makeSupa(TEST_ENV, fake);
  assertEquals(await supa.service('f', { a: 1 }), { ok: true });
  assertEquals(seen[0]?.headers.get('authorization'), 'Bearer service-key-test');
  await supa.asUser('user-jwt', 'f', {});
  assertEquals([seen[1]?.headers.get('authorization'), seen[1]?.headers.get('apikey')], [
    'Bearer user-jwt',
    'anon-key-test',
  ]);
  await supa.authAdmin('GET', 'users');
  assertEquals(seen[2]?.url, 'https://proj.supabase.co/auth/v1/admin/users');
  await supa.authVerify('hash-9');
  assertEquals(seen[3]?.url, 'https://proj.supabase.co/auth/v1/verify');
  assertEquals(seen[3]?.headers.get('apikey'), 'anon-key-test');
  assertEquals(await seen[3]?.json(), { type: 'magiclink', token_hash: 'hash-9' });
  assertEquals(await supa.service('empty', {}), null);
  const err = await assertRejects(() => supa.asUser('j', 'bad', {}), ApiError);
  assertEquals([err.status, err.code, err.message], [403, 'PT403', 'FORBIDDEN']);
  assertEquals(statusFor(err), 403);
  assertEquals((await assertRejects(() => supa.service('text', {}), ApiError)).code, '500');
  assertEquals(statusFor(new Error('x')), 500);
  assertEquals(statusFor(new ApiError(200, 'x', 'y')), 500);
});

Deno.test('browserFunction: CORS preflight, JWT required, error mapping', async () => {
  const fn = browserFunction((_req, _deps, jwt) => {
    if (jwt === 'boom') throw new Error('secret detail');
    if (jwt === 'forbidden') throw new ApiError(403, 'PT403', 'FORBIDDEN');
    return Promise.resolve(json(200, { jwt }));
  });
  const deps = testDeps();
  const pre = await fn(new Request('http://x', { method: 'OPTIONS' }), deps);
  assertEquals([pre.status, pre.headers.get('access-control-allow-origin')], [204, 'https://c.example.in']);
  assertEquals((await fn(new Request('http://x'), deps)).status, 401);
  const ok = await fn(new Request('http://x', { headers: { authorization: 'Bearer t' } }), deps);
  assertEquals([ok.status, ok.headers.get('access-control-allow-origin')], [200, 'https://c.example.in']);
  const f = await fn(new Request('http://x', { headers: { authorization: 'Bearer forbidden' } }), deps);
  assertEquals([f.status, (await f.json()).error], [403, 'FORBIDDEN']);
  const b = await fn(new Request('http://x', { headers: { authorization: 'Bearer boom' } }), deps);
  assertEquals([b.status, (await b.json()).error], [500, 'INTERNAL'], 'internal details never leak');
});

Deno.test('readEnv reads Deno.env by default', () => {
  Deno.env.set('SUPABASE_URL', 'https://u');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 's');
  Deno.env.set('SUPABASE_ANON_KEY', 'a');
  assertEquals(readEnv().supabaseUrl, 'https://u');
});

Deno.test('default log sink writes one JSON line', () => {
  // The log sink is console.log; swap it to capture the line.
  // deno-lint-ignore no-console
  const original = console.log;
  const lines: unknown[] = [];
  // deno-lint-ignore no-console
  console.log = (...args: unknown[]) => void lines.push(args[0]);
  try {
    makeLogger('fn', 'r').log('info', 'ok');
  } finally {
    // deno-lint-ignore no-console
    console.log = original;
  }
  assertEquals(JSON.parse(String(lines[0])).outcome, 'ok');
});
