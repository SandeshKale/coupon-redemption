// GENERATED from packages/shared/src by scripts/sync-shared.mjs. Do not edit.
import { isAlphabetChar, mapLookAlike, randomAlphabetString } from './alphabet.ts';

export const TOKEN_LENGTH = 6;

/**
 * Painter confirmation tokens are 6 Crockford characters with at least one digit
 * (ADR-0003) so ordinary words such as "THANKS" never parse as a token.
 */
export function isTokenShape(candidate: string): boolean {
  return (
    candidate.length === TOKEN_LENGTH &&
    Array.from(candidate).every(isAlphabetChar) &&
    /[0-9]/.test(candidate)
  );
}

/**
 * Maps look-alikes inside a candidate word; returns the token or null.
 * The raw word must already contain a real digit: otherwise I/L→1 would turn
 * ordinary words ("BHAIYA", "DELETE") into tokens.
 */
export function normaliseToken(word: string): string | null {
  if (!/[0-9]/.test(word)) return null;
  const mapped = Array.from(word.toUpperCase(), mapLookAlike).join('');
  return isTokenShape(mapped) ? mapped : null;
}

export function generateToken(randomBytes?: (n: number) => Uint8Array): string {
  for (;;) {
    const candidate =
      randomBytes === undefined
        ? randomAlphabetString(TOKEN_LENGTH)
        : randomAlphabetString(TOKEN_LENGTH, randomBytes);
    if (isTokenShape(candidate)) return candidate;
  }
}
