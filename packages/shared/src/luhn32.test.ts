import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import vectors from '../test-vectors/luhn32.json' with { type: 'json' };

import { ALPHABET } from './alphabet.ts';
import { luhn32CheckChar, luhn32Valid } from './luhn32.ts';

const alphaChar = fc.constantFrom(...Array.from(ALPHABET));
const payload12 = fc.array(alphaChar, { minLength: 12, maxLength: 12 }).map((a) => a.join(''));

describe('luhn32', () => {
  it('matches the 1,000 shared test vectors (also checked by pgTAP)', () => {
    expect(vectors).toHaveLength(1000);
    for (const v of vectors) {
      expect(luhn32CheckChar(v.payload)).toBe(v.check);
      expect(luhn32Valid(v.payload + v.check)).toBe(true);
    }
  });

  it('known example', () => {
    expect(luhn32CheckChar('7KQ2M9XHTB4R')).toBe(luhn32CheckChar('7KQ2M9XHTB4R'));
    expect(luhn32Valid('0')).toBe(false);
    expect(luhn32Valid('')).toBe(false);
    expect(luhn32Valid('00')).toBe(true);
    expect(luhn32Valid('0U')).toBe(false);
  });

  it('throws on non-alphabet payload characters', () => {
    expect(() => luhn32CheckChar('ABCU')).toThrow(RangeError);
  });

  it('every generated payload passes its own check character', () => {
    fc.assert(fc.property(payload12, (p) => luhn32Valid(p + luhn32CheckChar(p))));
  });

  it('detects every single-character substitution', () => {
    fc.assert(
      fc.property(payload12, fc.integer({ min: 0, max: 12 }), alphaChar, (p, pos, ch) => {
        const full = p + luhn32CheckChar(p);
        fc.pre(full.charAt(pos) !== ch);
        const mutated = full.slice(0, pos) + ch + full.slice(pos + 1);
        return !luhn32Valid(mutated);
      }),
    );
  });

  it('detects every adjacent transposition except the 0↔Z pair (Luhn mod N limit, ADR-0002)', () => {
    fc.assert(
      fc.property(payload12, fc.integer({ min: 0, max: 11 }), (p, pos) => {
        const full = p + luhn32CheckChar(p);
        const a = full.charAt(pos);
        const b = full.charAt(pos + 1);
        fc.pre(a !== b && [a, b].sort().join('') !== '0Z');
        const swapped = full.slice(0, pos) + b + a + full.slice(pos + 2);
        return !luhn32Valid(swapped);
      }),
    );
  });
});
