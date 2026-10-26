/** Defaults for app_config (Appendix C). The database is the source of truth at runtime. */
export const DEFAULT_CONFIG = {
  coupon_validity_months: 18,
  claim_cycle: 'MONTHLY',
  dealer_claim_window_days: 90,
  dist_claim_window_days: 60,
  redeem_batch_max: 50,
  invalid_scan_brake: { count: 5, minutes: 10 },
  public_lookup_limit: { count: 30, minutes: 10 },
  painter_confirmation_enabled: true,
  strict_painter_mode: false,
  painter_on_time_minutes: 10,
  painter_token_ttl_hours: 24,
  painter_flags: { multi_dealer: { dealers: 3, days: 7 }, high_volume: { batches: 10, hours: 24 } },
  painter_bad_token_brake: { count: 5, minutes: 60 },
  dealer_confirmation_rate_alert: { below_pct: 60, min_coupons: 20, days: 30 },
  dispute_window_hours: 24,
  wa_sender_backoff_seconds: [30, 120, 600, 1800, 7200],
  wa_sender_max_attempts: 6,
} as const;

/** Backoff for wa_outbox retries; attempts beyond the table reuse the last delay. */
export function backoffSeconds(attempt: number, table: readonly number[]): number {
  const idx = Math.max(0, Math.min(attempt - 1, table.length - 1));
  return table[idx] ?? 0;
}
