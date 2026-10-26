import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { assertPaise, formatInr, rupeesToPaise, sumPaise } from './money.ts';

describe('money', () => {
  it('formats with Indian grouping', () => {
    expect(formatInr(10_000)).toBe('₹100');
    expect(formatInr(10_000_000)).toBe('₹1,00,000');
    expect(formatInr(12_345)).toBe('₹123.45');
    expect(formatInr(0)).toBe('₹0');
  });

  it('converts rupees', () => {
    expect(rupeesToPaise(100)).toBe(10_000);
    expect(rupeesToPaise(0.1 + 0.2)).toBe(30);
    expect(() => rupeesToPaise(-1)).toThrow(RangeError);
  });

  it('rejects invalid amounts', () => {
    expect(() => {
      assertPaise(1.5);
    }).toThrow(RangeError);
    expect(() => {
      assertPaise(-1);
    }).toThrow(RangeError);
    expect(() => {
      assertPaise(Number.MAX_SAFE_INTEGER + 1);
    }).toThrow(RangeError);
    expect(() => formatInr(Number.NaN)).toThrow(RangeError);
  });

  it('sums and detects overflow', () => {
    expect(sumPaise([])).toBe(0);
    expect(sumPaise([10_000, 10_000])).toBe(20_000);
    expect(() => sumPaise([Number.MAX_SAFE_INTEGER, 1])).toThrow('overflow');
  });

  it('property: sums of up to 50 coupons never overflow and format', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 10_000_000 }), { maxLength: 50 }), (vals) => {
        const total = sumPaise(vals);
        return total === vals.reduce((a, b) => a + b, 0) && formatInr(total).startsWith('₹');
      }),
    );
  });
});
