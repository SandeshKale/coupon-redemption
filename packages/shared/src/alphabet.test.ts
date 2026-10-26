import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  ALPHABET,
  ALPHABET_SIZE,
  charOf,
  codePointOf,
  isAlphabetChar,
  mapLookAlike,
  randomAlphabetString,
} from './alphabet.ts';

describe('alphabet', () => {
  it('is Crockford base32 without I L O U', () => {
    expect(ALPHABET).toHaveLength(ALPHABET_SIZE);
    expect(new Set(ALPHABET).size).toBe(32);
    for (const ch of 'ILOU') expect(isAlphabetChar(ch)).toBe(false);
  });

  it('round-trips code points', () => {
    for (let i = 0; i < 32; i += 1) expect(codePointOf(charOf(i))).toBe(i);
    expect(codePointOf('U')).toBeUndefined();
  });

  it('rejects out of range code points', () => {
    expect(() => charOf(32)).toThrow(RangeError);
    expect(() => charOf(-1)).toThrow(RangeError);
    expect(() => charOf(1.5)).toThrow(RangeError);
  });

  it('maps look-alikes only', () => {
    expect(mapLookAlike('O')).toBe('0');
    expect(mapLookAlike('I')).toBe('1');
    expect(mapLookAlike('L')).toBe('1');
    expect(mapLookAlike('U')).toBe('U');
    expect(mapLookAlike('A')).toBe('A');
  });

  it('produces strings over the alphabet using the low 5 bits', () => {
    expect(randomAlphabetString(4, () => new Uint8Array([0, 31, 32, 255]))).toBe('0Z0Z');
    // Missing bytes default to 0 rather than crashing.
    expect(randomAlphabetString(2, () => new Uint8Array([1]))).toBe('10');
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 64 }), (n) => {
        const s = randomAlphabetString(n);
        return s.length === n && Array.from(s).every(isAlphabetChar);
      }),
    );
  });
});
