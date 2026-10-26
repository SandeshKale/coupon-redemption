import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { generateToken, isTokenShape, normaliseToken } from './token.ts';

describe('token', () => {
  it('requires 6 alphabet characters with at least one digit', () => {
    expect(isTokenShape('K7Q2M9')).toBe(true);
    expect(isTokenShape('THANKS')).toBe(false);
    expect(isTokenShape('K7Q2M')).toBe(false);
    expect(isTokenShape('K7Q2MU')).toBe(false);
  });

  it('normalises case and look-alikes', () => {
    expect(normaliseToken('k7q2m9')).toBe('K7Q2M9');
    expect(normaliseToken('K7QIMO')).toBe('K7Q1M0');
    expect(normaliseToken('KOQIML')).toBeNull();
    expect(normaliseToken('hello1')).toBe('HE1101');
    expect(normaliseToken('abc')).toBeNull();
  });

  it('generated tokens always have the token shape', () => {
    fc.assert(fc.property(fc.constant(null), () => isTokenShape(generateToken())));
  });

  it('retries until a digit is present', () => {
    const sources = [
      new Uint8Array([10, 10, 10, 10, 10, 10]),
      new Uint8Array([1, 10, 10, 10, 10, 10]),
    ];
    let call = 0;
    expect(generateToken(() => sources[call++] ?? new Uint8Array(6))).toBe('1AAAAA');
  });
});
