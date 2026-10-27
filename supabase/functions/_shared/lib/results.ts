// GENERATED from packages/shared/src by scripts/sync-shared.mjs. Do not edit.
/** Result codes returned by check_coupon / redeem (§15.1). Keep in sync with SQL. */
export const COUPON_RESULTS = [
  'VALID',
  'REDEEMED',
  'VALIDATED',
  'PARTIAL',
  'NONE_REDEEMED',
  'INVALID_FORMAT',
  'NOT_FOUND',
  'NOT_ACTIVE',
  'BLOCKED',
  'EXPIRED',
  'ALREADY_REDEEMED_SELF',
  'ALREADY_REDEEMED_OTHER',
  'DEALER_INACTIVE',
  'TOO_MANY_INVALID',
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'BAD_REQUEST',
] as const;
export type CouponResult = (typeof COUPON_RESULTS)[number];

export function isCouponResult(value: unknown): value is CouponResult {
  return typeof value === 'string' && (COUPON_RESULTS as readonly string[]).includes(value);
}

export const COUPON_STATUSES = [
  'GENERATED',
  'ACTIVE',
  'REDEEMED',
  'ON_HOLD',
  'DIST_CN_ISSUED',
  'DIST_REJECTED',
  'CLAIMED_TO_24M',
  'SETTLED',
  'M24_REJECTED',
  'BLOCKED',
  'EXPIRED',
  'VOID',
] as const;
export type CouponStatus = (typeof COUPON_STATUSES)[number];

export const PAINTER_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'LATE',
  'DISPUTED',
  'SKIPPED',
  'EXPIRED',
] as const;
export type PainterStatus = (typeof PAINTER_STATUSES)[number];

export const PAINTER_FLAGS = [
  'SELF_CONFIRM',
  'STAFF_NUMBER',
  'MULTI_DEALER',
  'HIGH_VOLUME',
  'NON_INDIAN',
  'LATE',
  'BAD_TOKENS',
  'TOKEN_REUSE',
] as const;
export type PainterFlag = (typeof PAINTER_FLAGS)[number];

export const ROLES = [
  'DEALER_STAFF',
  'DEALER_OWNER',
  'DISTRIBUTOR',
  'M24_ADMIN',
  'M24_FINANCE',
  'M24_VIEWER',
] as const;
export type Role = (typeof ROLES)[number];

export const REJECT_REASONS = [
  'NOT_ELIGIBLE',
  'OUT_OF_WINDOW',
  'PAINTER_DISPUTE',
  'SUSPECTED_FRAUD',
  'DUPLICATE',
  'OTHER',
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];
