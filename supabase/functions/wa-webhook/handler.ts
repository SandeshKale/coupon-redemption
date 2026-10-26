import type { Deps } from '../_shared/deps.ts';
import { json, readLimited, timingSafeEqual } from '../_shared/http.ts';
import { normaliseE164 } from '../_shared/lib/phone.ts';
import { parseWaMessage } from '../_shared/lib/whatsapp.ts';
import { extractMessages, type MetaMessage, verifyMetaSignature } from '../_shared/meta.ts';
import { drainOutbox } from '../wa-sender/sender.ts';

export const MAX_BODY_BYTES = 256 * 1024;

/** §6.6: Meta webhook. GET = verification handshake; POST = signed message delivery. */
export async function handler(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'GET') return verify(req, deps);
  if (req.method !== 'POST') return json(405, { error: 'method' });
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return json(415, { error: 'content-type' });
  }
  const raw = await readLimited(req, MAX_BODY_BYTES);
  if (raw === null) {
    deps.log.log('warn', 'body_too_large');
    return json(413, { error: 'too large' }); // EC-156
  }
  if (!(await verifyMetaSignature(raw, req.headers.get('x-hub-signature-256'), deps.env.metaAppSecret))) {
    deps.log.log('warn', 'bad_signature');
    return json(401, { error: 'signature' }); // EC-085
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return json(400, { error: 'json' });
  }
  const extracted = extractMessages(body);
  if (extracted === null) {
    deps.log.log('warn', 'unrecognised_payload');
    return json(200, { ok: true, processed: 0 }); // signed but not for us: ack so Meta does not retry
  }
  let queued = 0;
  for (const m of extracted.messages) {
    if (await processMessage(m, deps)) queued += 1;
  }
  if (queued > 0) deps.waitUntil(drainOutbox(deps, 1));
  deps.log.log('info', 'processed', {
    messages: extracted.messages.length,
    invalid: extracted.invalid,
    queued,
  });
  return json(200, { ok: true, processed: extracted.messages.length });
}

function verify(req: Request, deps: Deps): Response {
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token') ?? '';
  const challenge = url.searchParams.get('hub.challenge') ?? '';
  if (
    mode === 'subscribe' && deps.env.metaVerifyToken !== '' &&
    timingSafeEqual(token, deps.env.metaVerifyToken)
  ) {
    return new Response(challenge, { status: 200, headers: { 'content-type': 'text/plain' } });
  }
  deps.log.log('warn', 'verify_rejected');
  return new Response('forbidden', { status: 403 }); // EC-086
}

/** Returns true when a reply was queued. Errors are recorded for replay, never thrown (§6.6 step 5). */
async function processMessage(m: MetaMessage, deps: Deps): Promise<boolean> {
  const from = normaliseE164(m.from);
  const ts = new Date(Number(m.timestamp) * 1000).toISOString();
  if (from === null) {
    deps.log.log('warn', 'bad_from', { wamid: m.id });
    return false;
  }
  const parsed = parseWaMessage(m.type, m.text?.body);
  try {
    const r = await deps.supa.service<{ result: string; outbox_id: number | null }>('wa_handle_inbound', {
      p_wamid: m.id,
      p_from: from,
      p_body: m.text?.body ?? null,
      p_type: m.type,
      p_msg_ts: ts,
      p_intent: parsed.intent,
      p_token: parsed.token,
    });
    deps.log.log('info', 'message', { wamid: m.id, intent: parsed.intent, result: r.result });
    return r.outbox_id !== null;
  } catch (e) {
    deps.log.log('error', 'handle_failed', {
      wamid: m.id,
      error: e instanceof Error ? e.message : String(e),
    });
    await deps.supa
      .service('wa_record_error', {
        p_wamid: m.id,
        p_from: from,
        p_type: m.type,
        p_msg_ts: ts,
        p_error: String(e),
      })
      .catch(() => undefined);
    return false;
  }
}
