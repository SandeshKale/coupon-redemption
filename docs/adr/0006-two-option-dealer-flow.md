# ADR-0006: Two-option dealer flow, painter confirmation off

Status: accepted, 2026-10-27

## Context

The plan has the painter confirm the ₹100 payment by WhatsApp. That needs a Meta Business account,
a dedicated number, a webhook and a retry job, and it asks a painter to do something after being
paid. The business decided to drop the painter journey.

## Decision

- After a scan the dealer sees two choices only: **Paid ₹100 to painter** and **Declined to pay**.
- **Paid** is the existing `redeem` call. It creates the batch and the claim line as before. No painter
  token is issued, so the receipt has nothing to wait for.
- **Declined** is the new `decline_payment(code)` function. It writes one `DECLINED` row to
  `scan_attempt` and nothing else. The coupon stays `ACTIVE`, is not claimed, and can still be paid
  later by this or another dealer.
- The `app_config` flag `painter_confirmation_enabled` is set to `false` (migration 0015). The painter
  tables, WhatsApp functions and Edge Functions stay in the project, switched off, and keep their
  tests. Setting the flag back to `true` restores the old behaviour for new redemptions.
- The dealer, distributor and 24M screens no longer show painter status, the painter QR, disputes,
  painter flags or WhatsApp health. The privacy page no longer mentions painter phone numbers.

## Consequences

- The dealer's tap is the only evidence that the painter was paid. The remaining controls are the
  distributor and 24M claim checks, the duplicate and invalid-scan brakes, and the dealer velocity
  report.
- A `DECLINED` row is an audit record only. A dealer who declines and later pays the same coupon
  produces both rows.
- `strict_painter_mode` (rule R2-08) has no effect while confirmation is off.
