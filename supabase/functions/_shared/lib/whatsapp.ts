// GENERATED from packages/shared/src by scripts/sync-shared.mjs. Do not edit.
import { normaliseToken } from './token.ts';

export type WaIntent = 'CONFIRM' | 'DISPUTE' | 'STOP' | 'HELP';

export type ParsedWaMessage =
  | { readonly intent: 'CONFIRM'; readonly token: string }
  | { readonly intent: Exclude<WaIntent, 'CONFIRM'>; readonly token: null };

const DEVANAGARI_ZERO = 0x0966;

const DISPUTE_PHRASES: ReadonlySet<string> = new Set([
  'NO',
  'NOT PAID',
  'NAHI',
  'NAHI MILA',
  'नहीं',
  'नाही',
  'PAISE NAHI MILE',
]);

const STOP_WORDS: ReadonlySet<string> = new Set(['STOP', 'DELETE', 'UNSUBSCRIBE']);

/** Words that may surround the token and are never tokens themselves. */
const PREFIX_WORDS: ReadonlySet<string> = new Set(['24M', 'PAID']);

/** NFKC, Devanagari digits → ASCII, uppercase, punctuation/emoji → space, collapse whitespace. */
export function normaliseWaText(body: string): string {
  return body
    .normalize('NFKC')
    .replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - DEVANAGARI_ZERO))
    .toUpperCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Parses an inbound WhatsApp message (§6.4). First match wins:
 * CONFIRM (a token anywhere) → DISPUTE (whole message) → STOP → HELP.
 * Non-text messages (media, location, voice, stickers) are always HELP.
 */
export function parseWaMessage(type: string, body: string | null | undefined): ParsedWaMessage {
  if (type !== 'text' || body === null || body === undefined) return help();
  const text = normaliseWaText(body);
  for (const word of text.split(' ')) {
    if (PREFIX_WORDS.has(word)) continue;
    const candidate = normaliseToken(word);
    if (candidate !== null) return { intent: 'CONFIRM', token: candidate };
  }
  if (DISPUTE_PHRASES.has(text)) return { intent: 'DISPUTE', token: null };
  if (STOP_WORDS.has(text)) return { intent: 'STOP', token: null };
  return help();
}

function help(): ParsedWaMessage {
  return { intent: 'HELP', token: null };
}

/** `https://wa.me/<number>?text=24M%20PAID%20<TOKEN>` — the painter QR payload. */
export function painterConfirmLink(businessNumber: string, token: string): string {
  const digits = businessNumber.replace(/\D/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(painterConfirmText(token))}`;
}

export function painterConfirmText(token: string): string {
  return `24M PAID ${token}`;
}

/** Share link that opens the admin's own WhatsApp with a prefilled message to `mobile`. */
export function waShareLink(mobileE164: string, text: string): string {
  return `https://wa.me/${mobileE164.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
}
