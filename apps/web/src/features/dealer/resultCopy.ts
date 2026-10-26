import type { CouponResult } from '@24m/shared';

import type { ApiFailure } from '../../lib/api/client.ts';
import type { I18n, Key } from '../../lib/i18n/index.ts';
import type { ResultVariant } from '../../ui/index.ts';

export interface ResultView {
  readonly variant: ResultVariant;
  readonly title: string;
  readonly payable: boolean;
}

interface Detail {
  readonly value_paise?: number | undefined;
  readonly redeemed_at?: string | undefined;
  readonly expires_at?: string | null | undefined;
}

/** Fixed copy for every result code that needs no data (Appendix A). */
const FIXED: Record<
  Exclude<CouponResult, 'VALID' | 'ALREADY_REDEEMED_SELF' | 'EXPIRED'>,
  readonly [ResultVariant, Key]
> = {
  REDEEMED: ['valid', 'result.redeemed'],
  PARTIAL: ['valid', 'result.redeemed'],
  ALREADY_REDEEMED_OTHER: ['invalid', 'result.already_other'],
  NOT_FOUND: ['invalid', 'result.not_found'],
  NOT_ACTIVE: ['invalid', 'result.not_active'],
  BLOCKED: ['invalid', 'result.blocked'],
  INVALID_FORMAT: ['invalid', 'result.invalid_format'],
  BAD_REQUEST: ['invalid', 'result.invalid_format'],
  NONE_REDEEMED: ['invalid', 'result.invalid_format'],
  DEALER_INACTIVE: ['invalid', 'result.dealer_inactive'],
  TOO_MANY_INVALID: ['invalid', 'result.too_many_invalid'],
  AUTH_REQUIRED: ['warning', 'auth.required'],
  FORBIDDEN: ['invalid', 'result.forbidden'],
};

/** Maps every server result code to unambiguous money copy (§16.1). Only VALID is payable. */
export function resultView(result: CouponResult, d: Detail, i: I18n): ResultView {
  if (result === 'VALID')
    return {
      variant: 'valid',
      title: i.t('result.valid', { amount: i.money(d.value_paise ?? 0) }),
      payable: true,
    };
  if (result === 'ALREADY_REDEEMED_SELF') {
    return {
      variant: 'warning',
      title: i.t('result.already_self', {
        date: d.redeemed_at === undefined ? '' : i.dateTime(d.redeemed_at),
      }),
      payable: false,
    };
  }
  if (result === 'EXPIRED') {
    const date = d.expires_at === null || d.expires_at === undefined ? '' : i.date(d.expires_at);
    return { variant: 'invalid', title: i.t('result.expired', { date }), payable: false };
  }
  const [variant, key] = FIXED[result];
  return { variant, title: i.t(key), payable: false };
}

/** Network / transport failures: never green, always "don't pay yet" (§18.3). */
export function failureView(e: ApiFailure, i: I18n): ResultView {
  if (e.kind === 'captive')
    return { variant: 'checking', title: i.t('state.captive'), payable: false };
  if (e.kind === 'auth') return { variant: 'warning', title: i.t('auth.required'), payable: false };
  if (e.kind === 'forbidden') {
    return {
      variant: 'invalid',
      title: e.code === 'FORBIDDEN' ? i.t('result.forbidden') : i.t('common.forbidden'),
      payable: false,
    };
  }
  return { variant: 'checking', title: i.t('state.offline'), payable: false };
}
