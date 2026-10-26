import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { isIndianMobile, maskPhone, normaliseE164 } from './phone.ts';

describe('normaliseE164', () => {
  it('handles Meta "from" digits', () => {
    expect(normaliseE164('919876543210')).toBe('+919876543210');
    expect(normaliseE164('447700900123')).toBe('+447700900123');
  });

  it('handles Indian local formats', () => {
    expect(normaliseE164('9876543210')).toBe('+919876543210');
    expect(normaliseE164('09876543210')).toBe('+919876543210');
    expect(normaliseE164('+91 98765-43210')).toBe('+919876543210');
    expect(normaliseE164('(+91) 98765 43210')).toBe('+919876543210');
    expect(normaliseE164('98765+43210')).toBeNull();
  });

  it('rejects invalid numbers', () => {
    expect(normaliseE164('')).toBeNull();
    expect(normaliseE164('abc')).toBeNull();
    expect(normaliseE164('915876543210')).toBeNull();
    expect(normaliseE164('1234567')).toBeNull();
    expect(normaliseE164('1234567890123456')).toBeNull();
    expect(normaliseE164('+0123456789')).toBeNull();
  });

  it('a + prefix on a 10-digit number is not treated as Indian', () => {
    expect(normaliseE164('+9876543210')).toBe('+9876543210');
  });

  it('property: valid Indian mobiles round-trip', () => {
    fc.assert(
      fc.property(fc.integer({ min: 6_000_000_000, max: 9_999_999_999 }), (n) => {
        const e = normaliseE164(String(n));
        return e === `+91${n}` && isIndianMobile(e) && normaliseE164(e) === e;
      }),
    );
  });
});

describe('maskPhone', () => {
  it('masks Indian numbers', () => {
    expect(maskPhone('+919812344521')).toBe('+91 98•••• 4521');
  });
  it('masks other numbers', () => {
    expect(maskPhone('+447700900123')).toBe('+44 •••• 0123');
    expect(maskPhone('+123')).toBe('••••');
  });
});
