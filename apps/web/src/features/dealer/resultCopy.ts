import type { CouponResult } from '@24m/shared';

import type { ApiFailure } from '../../lib/api/client.ts';
import type { I18n, Key } from '../../lib/i18n/index.ts';
import type { ResultVariant } from '../../ui/index.ts';

export interface ResultView {
  readonly variant: ResultVariant;
  readonly title: string;
  readonly canValidate: boolean;
}

interface Detail {
  readonly value_paise?: number | undefined;
  readonly redeemed_at?: string | undefined;
  readonly expires_at?: string | null | undefined;
}

/** Fixed copy for every result code that needs no data. */
const FIXED: Record<
  Exclude<CouponResult, 'VALID' | 'ALREADY_REDEEMED_SELF' | 'EXPIRED'>,
  readonly [ResultVariant, Key]
> = {
  VALIDATED: ['valid', 'result.validated'],
  REDEEMED: ['valid', 'result.validated'],
  PARTIAL: ['valid', 'result.validated'],
  ALREADY_REDEEMED_OTHER: ['warning', 'result.already_other'],
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

/** Maps every server result code to clear copy. Only VALID offers the Validate button. */
export function resultView(result: CouponResult, d: Detail, i: I18n): ResultView {
  if (result === 'VALID')
    return {
      variant: 'valid',
      title: i.t('result.valid', { amount: i.money(d.value_paise ?? 0) }),
      canValidate: true,
    };
  if (result === 'ALREADY_REDEEMED_SELF') {
    return {
      variant: 'warning',
      title: i.t('result.already_self', {
        date: d.redeemed_at === undefined ? '' : i.dateTime(d.redeemed_at),
      }),
      canValidate: false,
    };
  }
  if (result === 'EXPIRED') {
    const date = d.expires_at === null || d.expires_at === undefined ? '' : i.date(d.expires_at);
    return { variant: 'invalid', title: i.t('result.expired', { date }), canValidate: false };
  }
  const [variant, key] = FIXED[result];
  return { variant, title: i.t(key), canValidate: false };
}

/** Network / transport failures: never shown as a result, always "try again". */
export function failureView(e: ApiFailure, i: I18n): ResultView {
  if (e.kind === 'captive')
    return { variant: 'checking', title: i.t('state.captive'), canValidate: false };
  if (e.kind === 'auth')
    return { variant: 'warning', title: i.t('auth.required'), canValidate: false };
  if (e.kind === 'forbidden') {
    return {
      variant: 'invalid',
      title: e.code === 'FORBIDDEN' ? i.t('result.forbidden') : i.t('common.forbidden'),
      canValidate: false,
    };
  }
  return { variant: 'checking', title: i.t('state.offline'), canValidate: false };
}
