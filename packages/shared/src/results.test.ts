import { describe, expect, it } from 'vitest';

import { backoffSeconds, DEFAULT_CONFIG } from './config.ts';
import { COUPON_RESULTS, DO_NOT_PAY, isCouponResult } from './results.ts';

describe('results', () => {
  it('guards result codes', () => {
    expect(isCouponResult('REDEEMED')).toBe(true);
    expect(isCouponResult('NOPE')).toBe(false);
    expect(isCouponResult(1)).toBe(false);
  });

  it('every do-not-pay code is a known result', () => {
    for (const r of DO_NOT_PAY) expect(COUPON_RESULTS).toContain(r);
    expect(DO_NOT_PAY.has('REDEEMED')).toBe(false);
  });
});

describe('config', () => {
  it('backoff follows the table and clamps', () => {
    const t = DEFAULT_CONFIG.wa_sender_backoff_seconds;
    expect(backoffSeconds(1, t)).toBe(30);
    expect(backoffSeconds(5, t)).toBe(7200);
    expect(backoffSeconds(9, t)).toBe(7200);
    expect(backoffSeconds(0, t)).toBe(30);
    expect(backoffSeconds(1, [])).toBe(0);
  });
});
