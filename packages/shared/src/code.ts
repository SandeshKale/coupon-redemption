import { isAlphabetChar, mapLookAlike, randomAlphabetString } from './alphabet.ts';
import { luhn32CheckChar, luhn32Valid } from './luhn32.ts';

export const CODE_PAYLOAD_LENGTH = 12;
export const CODE_LENGTH = 13;

export type CodeRejection = 'EMPTY' | 'NOT_24M' | 'BAD_CHARS' | 'BAD_LENGTH' | 'BAD_CHECK';

export type NormalisedCode =
  | { readonly ok: true; readonly code: string; readonly key: string }
  | { readonly ok: false; readonly reason: CodeRejection };

/** Generates a 13-character code (12 random + Luhn mod 32 check character). */
export function generateCode(randomBytes?: (n: number) => Uint8Array): string {
  const payload =
    randomBytes === undefined
      ? randomAlphabetString(CODE_PAYLOAD_LENGTH)
      : randomAlphabetString(CODE_PAYLOAD_LENGTH, randomBytes);
  return payload + luhn32CheckChar(payload);
}

/** `7KQ2M9XHTB4RJ` → `7KQ2-M9XH-TB4R-J` */
export function displayCode(code: string): string {
  return (code.match(/.{1,4}/g) ?? []).join('-');
}

/**
 * The address printed in the QR for a code. `where` is either a bare host (`c.example.in`, which
 * serves `/c/<code>`) or a host with a path (`www.example.in/100Coupons`, which serves `/<path>/<code>`).
 * The case is kept exactly, so the QR must be encoded in byte mode.
 */
export function couponQrUrl(where: string, code: string): string {
  return where.includes('/') ? `https://${where}/${code}` : `https://${where}/c/${code}`;
}

/**
 * Extracts and validates a coupon code from a scan or typed input.
 * Accepts: bare codes, grouped codes, lowercase, look-alikes (O→0, I/L→1),
 * and full URLs (`https://c.<domain>/c/<CODE>?utm=…`). `U` is never mapped.
 */
export function normaliseCode(input: string, couponHost?: string): NormalisedCode {
  const trimmed = input.trim();
  if (trimmed === '') return { ok: false, reason: 'EMPTY' };

  const extracted = extractFromUrl(trimmed, couponHost);
  if (extracted === null) return { ok: false, reason: 'NOT_24M' };

  const cleaned = Array.from(extracted.toUpperCase().replace(/[\s-]+/g, ''), mapLookAlike).join('');
  if (!Array.from(cleaned).every(isAlphabetChar)) return { ok: false, reason: 'BAD_CHARS' };
  if (cleaned.length !== CODE_LENGTH) return { ok: false, reason: 'BAD_LENGTH' };
  if (!luhn32Valid(cleaned)) return { ok: false, reason: 'BAD_CHECK' };
  return { ok: true, code: cleaned, key: cleaned.slice(0, CODE_PAYLOAD_LENGTH) };
}

/** Returns the code part of a URL, the input itself if it isn't a URL, or null for foreign QRs. */
function extractFromUrl(input: string, couponHost?: string): string | null {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(input) && !/^[\w.-]+\.[a-z]{2,}\//i.test(input)) {
    return input;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (couponHost !== undefined && !hostAllowed(url.hostname, couponHost)) return null;
  const match = /^\/(?:c|100coupons)\/([^/]+)\/?$/i.exec(url.pathname);
  return match?.[1] === undefined ? null : decodeURIComponent(match[1]);
}

/** `couponHost` may list several hosts, separated by commas (for example the brand site and the app). */
function hostAllowed(hostname: string, couponHost: string): boolean {
  const host = hostname.toLowerCase();
  return couponHost.split(',').some((h) => h.trim().toLowerCase().split('/')[0] === host);
}
