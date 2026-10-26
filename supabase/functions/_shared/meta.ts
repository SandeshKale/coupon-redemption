import * as v from 'valibot';

import { timingSafeEqual } from './http.ts';

/** X-Hub-Signature-256: "sha256=<hex HMAC of the raw body with the App Secret>". */
export async function verifyMetaSignature(
  raw: Uint8Array<ArrayBuffer>,
  header: string | null,
  appSecret: string,
): Promise<boolean> {
  if (header === null || appSecret === '' || !header.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [
      'sign',
    ],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, raw));
  const hex = Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(hex, header.slice('sha256='.length).toLowerCase());
}

const MessageSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
  from: v.pipe(v.string(), v.regex(/^\d{6,15}$/)),
  timestamp: v.pipe(v.string(), v.regex(/^\d{1,12}$/)),
  type: v.pipe(v.string(), v.maxLength(30)),
  text: v.optional(v.object({ body: v.pipe(v.string(), v.maxLength(4096)) })),
});
export type MetaMessage = v.InferOutput<typeof MessageSchema>;

const WebhookSchema = v.object({
  object: v.literal('whatsapp_business_account'),
  entry: v.array(
    v.object({
      changes: v.array(
        v.object({
          field: v.string(),
          value: v.object({
            messages: v.optional(v.array(v.unknown())),
            statuses: v.optional(v.array(v.unknown())),
          }),
        }),
      ),
    }),
  ),
});

/** Extracts valid inbound messages; status events (delivered/read) are ignored (EC-087). */
export function extractMessages(body: unknown): { messages: MetaMessage[]; invalid: number } | null {
  const parsed = v.safeParse(WebhookSchema, body);
  if (!parsed.success) return null;
  const messages: MetaMessage[] = [];
  let invalid = 0;
  for (const entry of parsed.output.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'messages') continue;
      for (const m of change.value.messages ?? []) {
        const msg = v.safeParse(MessageSchema, m);
        if (msg.success) messages.push(msg.output);
        else invalid += 1;
      }
    }
  }
  return { messages, invalid };
}

export interface SendResult {
  readonly ok: boolean;
  readonly retryable: boolean;
  readonly id?: string;
  readonly error?: string;
}

/** Sends a free-form text reply (inside the painter-opened 24-hour window only). */
export async function sendText(
  fetchImpl: typeof fetch,
  cfg: { graphVersion: string; phoneNumberId: string; accessToken: string },
  to: string,
  body: string,
  timeoutMs = 8000,
): Promise<SendResult> {
  try {
    const res = await fetchImpl(
      `https://graph.facebook.com/${cfg.graphVersion}/${cfg.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${cfg.accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: to.replace(/^\+/, ''),
          type: 'text',
          text: { body },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      messages?: { id?: string }[];
      error?: { message?: string };
    };
    if (res.ok) {
      const id = json.messages?.[0]?.id;
      return id === undefined ? { ok: true, retryable: false } : { ok: true, retryable: false, id };
    }
    return {
      ok: false,
      retryable: res.status === 429 || res.status >= 500,
      error: `${res.status} ${json.error?.message ?? ''}`.trim(),
    };
  } catch (e) {
    return { ok: false, retryable: true, error: e instanceof Error ? e.name : 'network' };
  }
}
