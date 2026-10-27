-- Month-end cut-off (§20.7): 1,000 OPEN dealer claims from last month are submitted by
-- job_submit_dealer_claims() in one run in < 60 s. Runs inside a transaction that is ROLLED BACK,
-- so staging data is unchanged. Needs load/seed-staging.sql first.
\set ON_ERROR_STOP on
\timing on
begin;

insert into public.dealer_claim (dealer_id, distributor_id, status, opened_at)
select d.id, d.distributor_id, 'OPEN', date_trunc('month', now()) - interval '10 days'
  from public.dealer d
 where d.code like 'K6-%'
   and not exists (select 1 from public.dealer_claim c where c.dealer_id = d.id and c.status = 'OPEN');

-- Three pending lines per claim, on coupons not yet in any live claim.
insert into public.dealer_claim_line (claim_id, coupon_id)
select c.id, x.id
  from public.dealer_claim c
  cross join lateral (
    select cp.id from public.coupon cp
     where cp.serial like 'K6L-%'
       and cp.serial_no between 400000 + (c.dealer_id % 1000) * 3 and 400000 + (c.dealer_id % 1000) * 3 + 2
  ) x
 where c.status = 'OPEN' and c.dealer_id in (select id from public.dealer where code like 'K6-%');

select count(*) as open_claims from public.dealer_claim
 where status = 'OPEN' and dealer_id in (select id from public.dealer where code like 'K6-%');

select clock_timestamp() as started \gset
select public.job_submit_dealer_claims() as submitted;
select extract(epoch from clock_timestamp() - :'started'::timestamptz) < 60 as under_60s \gset
\if :under_60s
  \echo 'month-end: OK (< 60 s)'
\else
  \echo 'month-end: FAILED (>= 60 s)'
  rollback;
  \quit 1
\endif
-- Idempotent: a second run changes nothing more.
select public.job_submit_dealer_claims() = 0 as idempotent \gset
\if :idempotent
  \echo 'month-end: second run is a no-op'
\else
  \echo 'month-end: FAILED (second run submitted more claims)'
\endif
rollback;
