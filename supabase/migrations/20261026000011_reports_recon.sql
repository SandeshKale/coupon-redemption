-- 0011: weekly review views (§22) and nightly reconciliation. Views run with the caller's
-- privileges (security_invoker), so RLS still applies.

create view public.v_disputes with (security_invoker = true) as
select pc.batch_id, pc.status, pc.flags, pc.disputed_at, pc.confirmed_at, b.dealer_id, d.name as dealer_name, b.coupon_count,
       b.value_paise, p.phone_masked as painter, pc.resolution
  from public.painter_confirmation pc
  join public.redemption_batch b on b.id = pc.batch_id
  join public.dealer d on d.id = b.dealer_id
  left join public.painter p on p.id = pc.painter_id
 where pc.resolution is null and (pc.status = 'DISPUTED' or 'SELF_CONFIRM' = any (pc.flags));

create view public.v_dealer_confirmation_rate with (security_invoker = true) as
select d.id as dealer_id, d.name as dealer_name, d.distributor_id,
       sum(b.coupon_count) as coupons,
       sum(b.coupon_count) filter (where pc.status in ('CONFIRMED', 'LATE')) as confirmed_coupons,
       round(100.0 * coalesce(sum(b.coupon_count) filter (where pc.status in ('CONFIRMED', 'LATE')), 0) / nullif(sum(b.coupon_count), 0), 1) as rate_pct,
       (round(100.0 * coalesce(sum(b.coupon_count) filter (where pc.status in ('CONFIRMED', 'LATE')), 0) / nullif(sum(b.coupon_count), 0), 1)
          < (public.cfg('dealer_confirmation_rate_alert') ->> 'below_pct')::numeric
        and sum(b.coupon_count) >= (public.cfg('dealer_confirmation_rate_alert') ->> 'min_coupons')::int) as below_threshold
  from public.redemption_batch b
  join public.dealer d on d.id = b.dealer_id
  left join public.painter_confirmation pc on pc.batch_id = b.id
 where b.created_at > now() - make_interval(days => (public.cfg('dealer_confirmation_rate_alert') ->> 'days')::int)
 group by d.id, d.name, d.distributor_id;

create view public.v_painter_flags with (security_invoker = true) as
select pc.painter_id, p.phone_masked as painter, p.status as painter_status, f.flag, count(*) as occurrences, max(pc.confirmed_at) as last_seen
  from public.painter_confirmation pc
  join public.painter p on p.id = pc.painter_id
  cross join lateral unnest(pc.flags) as f(flag)
 where f.flag in ('MULTI_DEALER', 'HIGH_VOLUME', 'STAFF_NUMBER', 'NON_INDIAN', 'TOKEN_REUSE', 'SELF_CONFIRM')
 group by pc.painter_id, p.phone_masked, p.status, f.flag;

create view public.v_invalid_scans with (security_invoker = true) as
select s.user_id, u.name as user_name, s.dealer_id, s.result, count(*) as attempts, max(s.at) as last_at
  from public.scan_attempt s left join public.app_user u on u.id = s.user_id
 where s.result in ('NOT_FOUND', 'NOT_ACTIVE', 'INVALID_FORMAT', 'BLOCKED') and s.at > now() - interval '7 days'
 group by s.user_id, u.name, s.dealer_id, s.result;

create view public.v_duplicate_attempts with (security_invoker = true) as
select s.coupon_id, c.serial, c.redeemed_dealer_id, s.dealer_id as attempted_by_dealer, s.user_id, s.at
  from public.scan_attempt s join public.coupon c on c.id = s.coupon_id
 where s.result = 'ALREADY_REDEEMED_OTHER' and s.at > now() - interval '30 days';

create view public.v_dealer_velocity with (security_invoker = true) as
with weekly as (
  select redeemed_dealer_id as dealer_id, date_trunc('week', redeemed_at) as week, count(*) as coupons
    from public.coupon where redeemed_at > now() - interval '13 weeks'
   group by redeemed_dealer_id, date_trunc('week', redeemed_at)
)

select w.dealer_id, d.name as dealer_name, w.week, w.coupons,
       round(avg(w.coupons) over (partition by w.dealer_id order by w.week rows between 12 preceding and 1 preceding), 1) as usual_weekly,
       w.coupons > 3 * coalesce(avg(w.coupons) over (partition by w.dealer_id order by w.week rows between 12 preceding and 1 preceding), w.coupons) as unusual
  from weekly w join public.dealer d on d.id = w.dealer_id;

create view public.v_claim_ageing with (security_invoker = true) as
select 'DEALER' as kind, c.id as claim_id, c.status, c.distributor_id, c.submitted_at as since, now() - c.submitted_at as age
  from public.dealer_claim c where c.status = 'SUBMITTED' and c.submitted_at < now() - make_interval(days => public.cfg_int('claim_ageing_days'))
union all
select 'DIST', c.id, c.status, c.distributor_id, c.created_at, now() - c.created_at
  from public.dist_claim c where c.status in ('SUBMITTED', 'VALIDATED') and c.created_at < now() - make_interval(days => public.cfg_int('claim_ageing_days'));

create view public.v_unacked_cn with (security_invoker = true) as
select c.id as claim_id, c.dealer_id, d.name as dealer_name, c.distributor_id, c.cn_no, c.cn_date, c.cn_total_paise, c.closed_at
  from public.dealer_claim c join public.dealer d on d.id = c.dealer_id
 where c.status = 'CN_ISSUED' and c.cn_count > 0 and c.closed_at < now() - make_interval(days => public.cfg_int('unacked_cn_days'));

create view public.v_wa_health with (security_invoker = true) as
select (select max(received_at) from public.wa_inbound) as last_inbound_at,
       (select count(*) from public.wa_inbound where result like 'ERROR:%' and received_at > now() - interval '24 hours') as webhook_errors_24h,
       (select count(*) from public.wa_outbox where status = 'FAILED' and created_at > now() - interval '1 hour') as outbox_failed_1h,
       (select count(*) from public.wa_outbox where status in ('QUEUED', 'RETRY')) as outbox_pending,
       (select count(*) from public.wa_outbox where status = 'EXPIRED_WINDOW' and created_at > now() - interval '24 hours') as outbox_expired_24h,
       (select count(*) from public.redemption_batch where created_at > now() - interval '24 hours') as batches_24h;

grant select on public.v_disputes, public.v_dealer_confirmation_rate, public.v_painter_flags, public.v_invalid_scans,
  public.v_duplicate_attempts, public.v_dealer_velocity, public.v_claim_ageing, public.v_unacked_cn, public.v_wa_health
to authenticated;

-- §22 identities, asserted per run. Inserts one recon_issue per violation (idempotent per day).
create or replace function public.run_reconciliation()
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare v_day date := public.ist_date(public.app_now()); v_before int; v_after int;
begin
  select count(*) into v_before from public.recon_issue where run_date = v_day;

  -- 1. Every redeemed coupon is live in exactly one dealer claim.
  insert into public.recon_issue (run_date, check_name, ref, details)
  select v_day, 'REDEEMED_WITHOUT_LINE', 'coupon:' || c.id, jsonb_build_object('status', c.status)
    from public.coupon c
   where c.redeemed_at is not null
     and (select count(*) from public.dealer_claim_line l where l.coupon_id = c.id and l.status not in ('MOVED', 'REVERSED')) <> 1
  on conflict do nothing;

  -- 2. Distributor approved = coupons at or beyond DIST_CN_ISSUED.
  insert into public.recon_issue (run_date, check_name, ref, details)
  select v_day, 'APPROVED_STATUS_MISMATCH', 'coupon:' || c.id, jsonb_build_object('status', c.status, 'prior', c.hold_prior_status)
    from public.dealer_claim_line l join public.dealer_claim dc on dc.id = l.claim_id join public.coupon c on c.id = l.coupon_id
   where l.status = 'APPROVED' and dc.status in ('CN_ISSUED', 'ACKNOWLEDGED')
     and coalesce(c.hold_prior_status, c.status) not in ('DIST_CN_ISSUED', 'CLAIMED_TO_24M', 'SETTLED', 'M24_REJECTED')
  on conflict do nothing;

  -- 3. Dealer CN total = sum of approved line values.
  insert into public.recon_issue (run_date, check_name, ref, details)
  select v_day, 'DEALER_CN_TOTAL', 'dealer_claim:' || dc.id, jsonb_build_object('cn_total', dc.cn_total_paise, 'lines_total', s.total)
    from public.dealer_claim dc
    cross join lateral (select coalesce(sum(c.value_paise), 0) as total from public.dealer_claim_line l join public.coupon c on c.id = l.coupon_id
                         where l.claim_id = dc.id and l.status = 'APPROVED') s
   where dc.status in ('CN_ISSUED', 'ACKNOWLEDGED') and dc.cn_total_paise <> s.total
  on conflict do nothing;

  -- 4. 24M settled total = sum of settled coupons in the claim.
  insert into public.recon_issue (run_date, check_name, ref, details)
  select v_day, 'M24_SETTLED_TOTAL', 'dist_claim:' || x.id, jsonb_build_object('total', x.total_paise, 'coupons_total', s.total)
    from public.dist_claim x
    cross join lateral (select coalesce(sum(c.value_paise), 0) as total from public.dist_claim_line l join public.coupon c on c.id = l.coupon_id
                         where l.claim_id = x.id and l.status = 'APPROVED' and coalesce(c.hold_prior_status, c.status) in ('SETTLED')) s
   where x.status = 'SETTLED' and x.total_paise <> s.total
  on conflict do nothing;

  -- 5. Every batch has a painter confirmation while the feature is on (one per batch, unique).
  insert into public.recon_issue (run_date, check_name, ref, details)
  select v_day, 'BATCH_WITHOUT_CONFIRMATION', 'batch:' || b.id, '{}'::jsonb
    from public.redemption_batch b
   where public.cfg_bool('painter_confirmation_enabled')
     and not exists (select 1 from public.painter_confirmation pc where pc.batch_id = b.id)
     and exists (select 1 from public.app_user u where u.id = b.user_id and u.role in ('DEALER_OWNER', 'DEALER_STAFF'))
     and b.created_at > public.app_now() - interval '35 days'
  on conflict do nothing;

  -- 6. Batch totals match their coupons (reversals excepted).
  insert into public.recon_issue (run_date, check_name, ref, details)
  select v_day, 'BATCH_TOTAL', 'batch:' || b.id, jsonb_build_object('batch', b.value_paise, 'coupons', s.total, 'reversed', s.reversed)
    from public.redemption_batch b
    cross join lateral (
      select coalesce(sum(c.value_paise), 0) as total,
             (select count(*) from public.coupon_event e where e.event = 'REVERSED' and e.ref like 'batch:' || b.id || ' %') as reversed
        from public.coupon c where c.redemption_batch_id = b.id) s
   where s.reversed = 0 and b.value_paise <> s.total
  on conflict do nothing;

  select count(*) into v_after from public.recon_issue where run_date = v_day;
  return v_after - v_before;
end $$;

-- Per-distributor monthly summary (count and ₹) used by the reconciliation report.
create or replace function public.recon_summary(p_month date)
returns table (distributor_id int, redeemed int, redeemed_paise bigint, dist_approved int, dist_rejected int, dist_pending int,
               claimed_to_24m int, settled int, settled_paise bigint, m24_rejected int, on_hold int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_from timestamptz := (date_trunc('month', p_month)::timestamp) at time zone 'Asia/Kolkata';
        v_to timestamptz := ((date_trunc('month', p_month) + interval '1 month')::timestamp) at time zone 'Asia/Kolkata';
        u public.app_user := public.assert_role(array['M24_ADMIN', 'M24_FINANCE', 'M24_VIEWER', 'DISTRIBUTOR']);
begin
  return query
  select c.routed_distributor_id,
         count(*)::int, sum(c.value_paise)::bigint,
         count(*) filter (where coalesce(c.hold_prior_status, c.status) in ('DIST_CN_ISSUED', 'CLAIMED_TO_24M', 'SETTLED', 'M24_REJECTED'))::int,
         count(*) filter (where c.status = 'DIST_REJECTED')::int,
         count(*) filter (where coalesce(c.hold_prior_status, c.status) = 'REDEEMED')::int,
         count(*) filter (where coalesce(c.hold_prior_status, c.status) in ('CLAIMED_TO_24M', 'SETTLED', 'M24_REJECTED'))::int,
         count(*) filter (where c.status = 'SETTLED')::int,
         coalesce(sum(c.value_paise) filter (where c.status = 'SETTLED'), 0)::bigint,
         count(*) filter (where c.status = 'M24_REJECTED')::int,
         count(*) filter (where c.status = 'ON_HOLD')::int
    from public.coupon c
   where c.redeemed_at >= v_from and c.redeemed_at < v_to
     and (u.role <> 'DISTRIBUTOR' or c.routed_distributor_id = u.distributor_id)
   group by c.routed_distributor_id;
end $$;
