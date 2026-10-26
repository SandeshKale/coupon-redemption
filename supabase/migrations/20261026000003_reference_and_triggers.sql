-- 0003: reference data and integrity triggers (state machine, add-only, immutability).

alter table public.coupon_transition add column functions text[] not null default '{}';

insert into public.coupon_transition (from_status, to_status, functions) values
  ('GENERATED', 'ACTIVE', '{activate_range}'),
  ('GENERATED', 'VOID', '{void_serials}'),
  ('ACTIVE', 'REDEEMED', '{redeem,m24_redeem_on_behalf}'),
  ('ACTIVE', 'BLOCKED', '{block_range}'),
  ('ACTIVE', 'EXPIRED', '{job_expire_coupons}'),
  ('REDEEMED', 'ACTIVE', '{reverse_redemption}'),
  ('REDEEMED', 'ON_HOLD', '{hold_coupons,hold_batch}'),
  ('REDEEMED', 'DIST_CN_ISSUED', '{dist_close_claim}'),
  ('REDEEMED', 'DIST_REJECTED', '{dist_decide}'),
  ('DIST_CN_ISSUED', 'ON_HOLD', '{hold_coupons,hold_batch}'),
  ('DIST_CN_ISSUED', 'CLAIMED_TO_24M', '{create_dist_claim}'),
  ('CLAIMED_TO_24M', 'ON_HOLD', '{hold_coupons,hold_batch}'),
  ('CLAIMED_TO_24M', 'SETTLED', '{m24_settle}'),
  ('CLAIMED_TO_24M', 'M24_REJECTED', '{m24_decide}'),
  ('CLAIMED_TO_24M', 'DIST_CN_ISSUED', '{m24_return_claim}'),
  ('ON_HOLD', 'REDEEMED', '{release_coupons,resolve_dispute}'),
  ('ON_HOLD', 'DIST_CN_ISSUED', '{release_coupons,resolve_dispute}'),
  ('ON_HOLD', 'CLAIMED_TO_24M', '{release_coupons,resolve_dispute}'),
  ('ON_HOLD', 'M24_REJECTED', '{resolve_dispute,m24_decide}');

insert into public.app_config (key, value) values
  ('coupon_validity_months', '18'),
  ('claim_cycle', '"MONTHLY"'),
  ('dealer_claim_window_days', '90'),
  ('dist_claim_window_days', '60'),
  ('redeem_batch_max', '50'),
  ('invalid_scan_brake', '{"count": 5, "minutes": 10}'),
  ('public_lookup_limit', '{"count": 30, "minutes": 10}'),
  ('painter_confirmation_enabled', 'true'),
  ('strict_painter_mode', 'false'),
  ('painter_on_time_minutes', '10'),
  ('painter_token_ttl_hours', '24'),
  ('painter_flags', '{"multi_dealer": {"dealers": 3, "days": 7}, "high_volume": {"batches": 10, "hours": 24}}'),
  ('painter_bad_token_brake', '{"count": 5, "minutes": 60}'),
  ('dealer_confirmation_rate_alert', '{"below_pct": 60, "min_coupons": 20, "days": 30}'),
  ('dispute_window_hours', '24'),
  ('wa_sender_backoff_seconds', '[30, 120, 600, 1800, 7200]'),
  ('wa_sender_max_attempts', '6'),
  ('helpline', '"+91 00000 00000"'),
  ('privacy_url', '"https://c.example.in/privacy"'),
  ('internal_email_domain', '"users.example.in"'),
  ('unacked_cn_days', '15'),
  ('claim_ageing_days', '15'),
  ('login_link_request_limit', '{"count": 5, "minutes": 60}');

-- ── Generic triggers ────────────────────────────────────────────────────────
create or replace function public.forbid_change() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'ADD_ONLY: % on % is not allowed', tg_op, tg_table_name using errcode = 'P0001';
end $$;

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['coupon_event', 'scan_attempt', 'admin_log', 'redemption_batch', 'coupon_transition'] loop
    if to_regclass('public.' || t) is not null then
      execute format('create trigger %I before update or delete on public.%I for each row execute function public.forbid_change()', t || '_add_only', t);
      execute format('create trigger %I before truncate on public.%I for each statement execute function public.forbid_change()', t || '_no_truncate', t);
    end if;
  end loop;
  foreach t in array array['distributor', 'dealer', 'app_user', 'coupon'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.touch_updated_at()', t || '_touch', t);
  end loop;
end $$;

-- wa_inbound: add-only except processing columns (null → value, once) and anonymisation.
create or replace function public.wa_inbound_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ADD_ONLY: DELETE on wa_inbound is not allowed' using errcode = 'P0001';
  end if;
  if new.id <> old.id or new.wamid <> old.wamid or new.msg_type <> old.msg_type
     or new.msg_ts <> old.msg_ts or new.received_at <> old.received_at then
    raise exception 'ADD_ONLY: immutable wa_inbound column changed' using errcode = 'P0001';
  end if;
  if (old.intent is not null and new.intent is distinct from old.intent)
     or (old.result is not null and new.result is distinct from old.result)
     or (old.processed_at is not null and new.processed_at is distinct from old.processed_at)
     or (old.painter_id is not null and new.painter_id is distinct from old.painter_id) then
    raise exception 'ADD_ONLY: wa_inbound processing columns can be set only once' using errcode = 'P0001';
  end if;
  -- Anonymisation (STOP): number may only be replaced by its masked form, body only cleared.
  if new.from_e164 <> old.from_e164 and new.from_e164 <> public.mask_phone(old.from_e164) then
    raise exception 'ADD_ONLY: wa_inbound.from_e164 may only be masked' using errcode = 'P0001';
  end if;
  if new.body is distinct from old.body and new.body is not null then
    raise exception 'ADD_ONLY: wa_inbound.body may only be cleared' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- ── Coupon state machine and immutable columns ─────────────────────────────
create or replace function public.coupon_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ADD_ONLY: coupons are never deleted' using errcode = 'P0001';
  end if;
  if new.code <> old.code or new.serial <> old.serial or new.serial_no <> old.serial_no
     or new.lot_id <> old.lot_id or new.value_paise <> old.value_paise then
    raise exception 'IMMUTABLE: coupon identity columns cannot change' using errcode = 'P0001';
  end if;
  if new.status <> old.status and not exists (
    select 1 from public.coupon_transition t where t.from_status = old.status and t.to_status = new.status
  ) then
    raise exception 'BAD_TRANSITION: % -> %', old.status, new.status using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger coupon_guard before update or delete on public.coupon
  for each row execute function public.coupon_guard();
create trigger coupon_no_truncate before truncate on public.coupon
  for each statement execute function public.forbid_change();
