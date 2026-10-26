/** Crockford Base32 alphabet (no I, L, O, U). Index = code point for Luhn mod 32. */
export const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const ALPHABET_SIZE = 32;

const INDEX: ReadonlyMap<string, number> = new Map(
  Array.from(ALPHABET, (ch, i) => [ch, i] as const),
);

/** Look-alike characters accepted on input and mapped to their canonical form. */
const LOOK_ALIKES: ReadonlyMap<string, string> = new Map([
  ['O', '0'],
  ['I', '1'],
  ['L', '1'],
]);

export function codePointOf(ch: string): number | undefined {
  return INDEX.get(ch);
}

export function charOf(codePoint: number): string {
  const ch = ALPHABET.charAt(codePoint);
  if (ch === '' || !Number.isInteger(codePoint)) {
    throw new RangeError(`code point out of range: ${codePoint}`);
  }
  return ch;
}

export function isAlphabetChar(ch: string): boolean {
  return INDEX.has(ch);
}

/** Maps O→0 and I/L→1; any other character is returned unchanged. */
export function mapLookAlike(ch: string): string {
  return LOOK_ALIKES.get(ch) ?? ch;
}

/** Uniformly random string over the alphabet using a CSPRNG byte source. */
export function randomAlphabetString(
  length: number,
  randomBytes: (n: number) => Uint8Array = defaultRandomBytes,
): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    // Each byte is uniform, so its low 5 bits are uniform over 0..31.
    out += charOf((bytes[i] ?? 0) & 31);
  }
  return out;
}

function defaultRandomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}
