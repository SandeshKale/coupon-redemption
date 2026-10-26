import { ALPHABET_SIZE, charOf, codePointOf } from './alphabet.ts';

/**
 * Luhn mod N (N = 32) check character over a string of alphabet characters.
 * Mirrored in SQL as luhn32_check_char(); both are verified against
 * test-vectors/luhn32.json in CI.
 */
export function luhn32CheckChar(payload: string): string {
  let factor = 2;
  let sum = 0;
  for (let i = payload.length - 1; i >= 0; i -= 1) {
    const cp = requireCodePoint(payload.charAt(i));
    const addend = factor * cp;
    factor = factor === 2 ? 1 : 2;
    sum += Math.floor(addend / ALPHABET_SIZE) + (addend % ALPHABET_SIZE);
  }
  return charOf((ALPHABET_SIZE - (sum % ALPHABET_SIZE)) % ALPHABET_SIZE);
}

/** True when the last character is the correct Luhn mod 32 check for the rest. */
export function luhn32Valid(withCheck: string): boolean {
  if (withCheck.length < 2) return false;
  for (const ch of withCheck) {
    if (codePointOf(ch) === undefined) return false;
  }
  return luhn32CheckChar(withCheck.slice(0, -1)) === withCheck.slice(-1);
}

function requireCodePoint(ch: string): number {
  const cp = codePointOf(ch);
  if (cp === undefined) throw new RangeError(`not an alphabet character: ${JSON.stringify(ch)}`);
  return cp;
}
