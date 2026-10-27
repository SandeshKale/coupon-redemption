-- Post-run assertions for the k6 suite. Usage:
--   psql "$STAGING_DB_URL" -v run_id=<K6_RUN_ID> -v code=<first code> -f load/verify.sql
\set ON_ERROR_STOP on

-- redeem-same-code: exactly one REDEEMED event for the raced coupon.
select count(*) = 1 as same_code_redeemed_once
  from public.coupon_event e join public.coupon c on c.id = e.coupon_id
 where c.code = left(public.normalise_code(:'code'), 12) and e.event = 'REDEEMED';

-- webhook-burst: one row per distinct wamid (duplicates absorbed), all processed.
select count(*) as inbound_rows,
       count(*) filter (where processed_at is null) = 0 as all_processed
  from public.wa_inbound where wamid like 'wamid.k6.' || :'run_id' || '.%';
