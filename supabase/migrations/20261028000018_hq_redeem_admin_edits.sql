-- 0018: coupon life Active → Validated → Redeemed (HQ), admin edits (mobile, helpline), PIN-reset rules,
-- "/" in distributor and SKU codes, optional expiry.
--
-- Life of a coupon:  ACTIVE → VALIDATED (a dealer)  → REDEEMED (24M admin or finance, end of life)
--                    ACTIVE → REDEEMED (24M admin or finance, when the dealer never validated)

-- ── Codes may contain "/" (for example distributor KA/26/01, SKU 24M/PRIM-20L) ──────────────
alter table public.distributor drop constraint distributor_code_check;
alter table public.distributor add constraint distributor_code_check check (code ~ '^[A-Z0-9/-]{2,20}$');
alter table public.sku drop constraint sku_code_check;
alter table public.sku add constraint sku_code_check check (code ~ '^[A-Z0-9/-]{2,30}$');

-- ── New status and the columns that record who redeemed ─────────────────────────────────────
alter table public.coupon drop constraint coupon_status_check;
alter table public.coupon add constraint coupon_status_check check (status in (
  'GENERATED', 'ACTIVE', 'VALIDATED', 'REDEEMED', 'ON_HOLD', 'DIST_CN_ISSUED', 'DIST_REJECTED',
  'CLAIMED_TO_24M', 'SETTLED', 'M24_REJECTED', 'BLOCKED', 'EXPIRED', 'VOID'));
alter table public.coupon add column hq_redeemed_at timestamptz;
alter table public.coupon add column hq_redeemed_by bigint references public.app_user;
alter table public.coupon add column credit_note_ref text check (length(credit_note_ref) <= 60);

insert into public.coupon_transition (from_status, to_status, functions) values
  ('ACTIVE', 'VALIDATED', '{validate_coupon}'),
  ('VALIDATED', 'REDEEMED', '{redeem_coupons}'),
  ('VALIDATED', 'ACTIVE', '{reverse_redemption}'),
  ('VALIDATED', 'ON_HOLD', '{hold_coupons,hold_batch}'),
  ('ON_HOLD', 'VALIDATED', '{release_coupons,resolve_dispute}');

-- Redeemed by HQ is the end of life: no further status change and no edit of who/when/reference.
-- (The older claim-flow transitions out of REDEEMED stay in the table, which is add-only, but they
-- apply only to coupons a dealer redeemed through that flow, which have no HQ redemption.)
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
  if old.hq_redeemed_at is not null and (new.status <> old.status
     or new.hq_redeemed_at is distinct from old.hq_redeemed_at or new.hq_redeemed_by is distinct from old.hq_redeemed_by
     or new.credit_note_ref is distinct from old.credit_note_ref) then
    raise exception 'REDEEMED: a redeemed coupon cannot change' using errcode = 'P0001';
  end if;
  if new.status <> old.status and not exists (
    select 1 from public.coupon_transition t where t.from_status = old.status and t.to_status = new.status
  ) then
    raise exception 'BAD_TRANSITION: % -> %', old.status, new.status using errcode = 'P0001';
  end if;
  return new;
end $$;

-- No expiry for coupons unless a validity (in months) is configured. 0 means they never expire.
update public.app_config set value = '0' where key = 'coupon_validity_months';

create or replace function public.activate_range(p_lot_id int, p_serial_from bigint, p_serial_to bigint,
  p_sku text, p_batch_no text, p_mfg_date date)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u public.app_user := public.assert_role(array['M24_ADMIN']);
  l public.coupon_lot; v_count int; v_skipped int; v_expires timestamptz; v_months int := public.cfg_int('coupon_validity_months');
begin
  select * into l from public.coupon_lot where id = p_lot_id;
  if not found then perform public.fail('NOT_FOUND'); end if;
  if l.status <> 'EXPORTED' then perform public.fail('LOT_NOT_EXPORTED'); end if;
  if p_serial_from > p_serial_to or p_serial_from < l.serial_from or p_serial_to > l.serial_to then
    perform public.fail('BAD_RANGE');
  end if;
  if p_mfg_date is null or p_mfg_date > public.ist_date(public.app_now()) then perform public.fail('BAD_MFG_DATE'); end if;
  if not exists (select 1 from public.sku where code = upper(p_sku) and active) then perform public.fail('UNKNOWN_SKU'); end if;
  -- Expiry at the end of the validity day in IST; none when no validity is configured.
  if coalesce(v_months, 0) > 0 then
    v_expires := ((p_mfg_date + make_interval(months => v_months))::timestamp + interval '1 day') at time zone 'Asia/Kolkata';
  end if;
  with a as (
    update public.coupon
       set status = 'ACTIVE', sku = upper(p_sku), batch_no = p_batch_no, mfg_date = p_mfg_date,
           expires_at = v_expires, activated_at = public.app_now(), activated_by = u.id
     where lot_id = l.id and serial_no between p_serial_from and p_serial_to and status = 'GENERATED'
    returning id
  ), e as (
    insert into public.coupon_event (coupon_id, event, from_status, to_status, user_id, ref, at)
    select id, 'ACTIVATED', 'GENERATED', 'ACTIVE', u.id, p_batch_no, public.app_now() from a returning 1
  ) select count(*) into v_count from e;
  v_skipped := (p_serial_to - p_serial_from + 1) - v_count;
  perform public.log_admin(u.id, 'ACTIVATE_RANGE', 'lot:' || l.id, null,
    jsonb_build_object('from', p_serial_from, 'to', p_serial_to, 'activated', v_count, 'skipped', v_skipped));
  return jsonb_build_object('activated', v_count, 'skipped', v_skipped, 'expires_at', v_expires);
end $$;

-- ── Dealer validate: ACTIVE → VALIDATED ─────────────────────────────────────────────────────
create or replace function public.validate_coupon(p_code text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u public.app_user := public.assert_role(array['DEALER_OWNER', 'DEALER_STAFF']);
  d public.dealer := public.active_dealer_for(u);
  v_code text; c public.coupon; v_now timestamptz := public.app_now();
begin
  if d.id is null then return jsonb_build_object('result', 'DEALER_INACTIVE'); end if;
  if public.invalid_scan_brake_active(u.id) then return jsonb_build_object('result', 'TOO_MANY_INVALID'); end if;
  v_code := public.normalise_code(p_code);
  if v_code is null then
    perform public.log_scan(u.id, null, d.id, 'INVALID_FORMAT', p_code);
    return jsonb_build_object('result', 'INVALID_FORMAT');
  end if;
  update public.coupon
     set status = 'VALIDATED', redeemed_at = v_now, redeemed_dealer_id = d.id, redeemed_user_id = u.id,
         routed_distributor_id = d.distributor_id
   where code = v_code and status = 'ACTIVE' and (expires_at is null or expires_at > v_now)
  returning * into c;
  if not found then return public.explain_coupon(v_code, u.id, d.id); end if;
  insert into public.coupon_event (coupon_id, event, from_status, to_status, user_id, ref, at)
  values (c.id, 'VALIDATED', 'ACTIVE', 'VALIDATED', u.id, 'validate', v_now);
  perform public.log_scan(u.id, c.id, d.id, 'VALIDATED', v_code);
  return jsonb_build_object('result', 'VALIDATED', 'code', public.code13(v_code), 'serial', c.serial,
                            'value_paise', c.value_paise, 'validated_at', v_now);
end $$;

-- What a dealer sees when the coupon is not simply ACTIVE. Redeemed by 24M is its own answer.
create or replace function public.explain_coupon(p_code12 text, p_user bigint, p_dealer int)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.coupon; v_result text; v_line jsonb;
begin
  select * into c from public.coupon where code = p_code12;
  if not found then
    perform public.log_scan(p_user, null, p_dealer, 'NOT_FOUND', p_code12);
    return jsonb_build_object('code', public.code13(p_code12), 'result', 'NOT_FOUND');
  end if;
  v_result := case
    when c.status = 'GENERATED' then 'NOT_ACTIVE'
    when c.status in ('BLOCKED', 'VOID') then 'BLOCKED'
    when c.status = 'EXPIRED' or (c.status = 'ACTIVE' and c.expires_at is not null and c.expires_at <= public.app_now()) then 'EXPIRED'
    when c.status = 'ACTIVE' then 'VALID'
    when c.hq_redeemed_at is not null then 'ALREADY_CLOSED'
    when c.redeemed_dealer_id = p_dealer then 'ALREADY_REDEEMED_SELF'
    else 'ALREADY_REDEEMED_OTHER'
  end;
  v_line := jsonb_build_object('code', public.code13(p_code12), 'result', v_result, 'serial', c.serial,
                               'value_paise', c.value_paise);
  if v_result = 'EXPIRED' then v_line := v_line || jsonb_build_object('expires_at', c.expires_at); end if;
  if v_result = 'ALREADY_REDEEMED_SELF' then v_line := v_line || jsonb_build_object('redeemed_at', c.redeemed_at); end if;
  if v_result = 'VALID' then
    v_line := v_line || jsonb_build_object('expires_at', c.expires_at,
      'product', (select s.name from public.sku s where s.code = c.sku));
  end if;
  perform public.log_scan(p_user, c.id, p_dealer, case when v_result = 'VALID' then 'CHECK_VALID' else v_result end, p_code12);
  return v_line;
end $$;

-- ── Public page: Active, Validated or Redeemed ──────────────────────────────────────────────
create or replace function public.public_coupon_info(p_code text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_lim jsonb := public.cfg('public_lookup_limit');
  v_hash bytea := public.ip_hash(public.request_ip());
  v_code text; c public.coupon; v_now timestamptz := public.app_now();
begin
  if (select count(*) from public.public_lookup
       where ip_hash = v_hash and at > v_now - make_interval(mins => (v_lim ->> 'minutes')::int))
     >= (v_lim ->> 'count')::int then
    return jsonb_build_object('result', 'RATE_LIMITED');
  end if;
  insert into public.public_lookup (ip_hash, at) values (v_hash, v_now);
  v_code := public.normalise_code(p_code);
  if v_code is null then return jsonb_build_object('result', 'INVALID_FORMAT'); end if;
  select * into c from public.coupon where code = v_code;
  if not found or c.status in ('GENERATED', 'VOID', 'BLOCKED') then
    return jsonb_build_object('result', 'NOT_RECOGNISED');
  end if;
  return jsonb_build_object('result', 'GENUINE', 'value_paise', c.value_paise,
    'state', case
      when c.status = 'EXPIRED' or (c.status = 'ACTIVE' and c.expires_at is not null and c.expires_at <= v_now) then 'EXPIRED'
      when c.status = 'ACTIVE' then 'ACTIVE'
      when c.status in ('VALIDATED', 'ON_HOLD') then 'VALIDATED'
      else 'REDEEMED' end,
    'helpline', public.cfg_text('helpline'));
end $$;

-- ── HQ redeems coupons (at the time the credit note is issued to the distributor) ───────────
create or replace function public.redeem_coupons(p_serials text[], p_credit_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u public.app_user := public.assert_role(array['M24_ADMIN', 'M24_FINANCE']);
  v_now timestamptz := public.app_now(); v_in text[]; v_done text[]; v_rejected jsonb; v_missing text[]; v_ref text;
begin
  if p_serials is null or coalesce(array_length(p_serials, 1), 0) = 0 or array_length(p_serials, 1) > 1000 then
    perform public.fail('BAD_REQUEST');
  end if;
  v_ref := nullif(btrim(p_credit_note), '');
  select array_agg(distinct upper(btrim(s))) into v_in from unnest(p_serials) s where btrim(s) <> '';
  if v_in is null then perform public.fail('BAD_REQUEST'); end if;

  with r as (
    update public.coupon c
       set status = 'REDEEMED', hq_redeemed_at = v_now, hq_redeemed_by = u.id, credit_note_ref = v_ref
     where c.serial = any (v_in) and c.status in ('ACTIVE', 'VALIDATED')
       and (c.status = 'VALIDATED' or c.expires_at is null or c.expires_at > v_now)
    returning c.id, c.serial
  ), e as (
    insert into public.coupon_event (coupon_id, event, from_status, to_status, user_id, ref, at)
    select r.id, 'REDEEMED', case when c0.redeemed_at is null then 'ACTIVE' else 'VALIDATED' end, 'REDEEMED', u.id,
           coalesce(v_ref, 'redeem'), v_now
      from r join public.coupon c0 on c0.id = r.id returning 1
  )
  select coalesce(array_agg(r.serial order by r.serial), '{}') into v_done from r;

  select coalesce(array_agg(s order by s), '{}') into v_missing
    from unnest(v_in) s where not exists (select 1 from public.coupon c where c.serial = s);
  select coalesce(jsonb_agg(jsonb_build_object('serial', c.serial, 'status', c.status) order by c.serial), '[]'::jsonb) into v_rejected
    from public.coupon c where c.serial = any (v_in) and c.serial <> all (v_done);

  perform public.log_admin(u.id, 'REDEEM_COUPONS', null, v_ref,
    jsonb_build_object('redeemed', cardinality(v_done), 'rejected', jsonb_array_length(v_rejected), 'not_found', cardinality(v_missing)));
  return jsonb_build_object('redeemed', cardinality(v_done), 'serials', to_jsonb(v_done),
                            'not_redeemable', v_rejected, 'not_found', to_jsonb(v_missing));
end $$;

-- ── Reverse a validation (admin, with a reason): VALIDATED → ACTIVE ─────────────────────────
create or replace function public.reverse_redemption(p_coupon_id bigint, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['M24_ADMIN']); c public.coupon;
begin
  if length(coalesce(btrim(p_reason), '')) < 5 then perform public.fail('REASON_REQUIRED'); end if;
  select * into c from public.coupon where id = p_coupon_id for update;
  if not found then perform public.fail('NOT_FOUND'); end if;
  if c.status = 'VALIDATED' then
    update public.coupon set status = 'ACTIVE', redeemed_at = null, redeemed_dealer_id = null, redeemed_user_id = null,
           routed_distributor_id = null, status_reason = p_reason
     where id = c.id;
    perform public.log_event(c.id, 'REVERSED', 'VALIDATED', 'ACTIVE', u.id, p_reason);
    perform public.log_admin(u.id, 'REVERSE_REDEMPTION', 'coupon:' || c.id, p_reason);
    return;
  end if;
  if c.status <> 'REDEEMED' or not exists (
       select 1 from public.dealer_claim_line l join public.dealer_claim dc on dc.id = l.claim_id
        where l.coupon_id = c.id and l.status in ('PENDING', 'HELD') and dc.status in ('OPEN', 'SUBMITTED')) then
    perform public.fail('NOT_REVERSIBLE');
  end if;
  update public.dealer_claim_line set status = 'REVERSED', reason = p_reason, decided_by = u.id, decided_at = public.app_now()
   where coupon_id = c.id and status in ('PENDING', 'HELD');
  update public.coupon set status = 'ACTIVE', redeemed_at = null, redeemed_dealer_id = null, redeemed_user_id = null,
         routed_distributor_id = null, dealer_claim_id = null, redemption_batch_id = null, status_reason = p_reason
   where id = c.id;
  perform public.log_event(c.id, 'REVERSED', 'REDEEMED', 'ACTIVE', u.id, 'batch:' || c.redemption_batch_id || ' ' || p_reason);
  perform public.log_admin(u.id, 'REVERSE_REDEMPTION', 'coupon:' || c.id, p_reason);
end $$;

create or replace function public.hold_coupons(p_coupon_ids bigint[], p_reason text)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['M24_ADMIN']); v_count int;
begin
  if length(coalesce(btrim(p_reason), '')) < 5 then perform public.fail('REASON_REQUIRED'); end if;
  with h as (
    update public.coupon c set status = 'ON_HOLD', hold_prior_status = c.status, hold_reason = p_reason, held_at = public.app_now()
     where c.id = any (p_coupon_ids) and c.status in ('VALIDATED', 'REDEEMED', 'DIST_CN_ISSUED', 'CLAIMED_TO_24M')
    returning c.id, c.hold_prior_status
  ), e as (
    insert into public.coupon_event (coupon_id, event, from_status, to_status, user_id, ref, at)
    select id, 'HELD', hold_prior_status, 'ON_HOLD', u.id, p_reason, public.app_now() from h returning 1
  ) select count(*) into v_count from e;
  perform public.log_admin(u.id, 'HOLD_COUPONS', null, p_reason, jsonb_build_object('count', v_count, 'ids', to_jsonb(p_coupon_ids)));
  return v_count;
end $$;

-- ── Live stats: validated and redeemed ──────────────────────────────────────────────────────
create or replace function public.coupon_stats()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  u public.app_user := public.assert_role(array['M24_ADMIN', 'M24_FINANCE', 'M24_VIEWER']);
  v_day_start timestamptz := (public.ist_date(public.app_now())::timestamp) at time zone 'Asia/Kolkata';
begin
  return jsonb_build_object(
    'by_status', coalesce((select jsonb_agg(jsonb_build_object('status', s.status, 'count', s.n) order by s.n desc)
                             from (select status, count(*) n from public.coupon group by status) s), '[]'::jsonb),
    'totals', (select jsonb_build_object(
        'all', count(*),
        'active', count(*) filter (where status = 'ACTIVE' and (expires_at is null or expires_at > public.app_now())),
        'validated', count(*) filter (where redeemed_at is not null),
        'validated_open', count(*) filter (where status = 'VALIDATED'),
        'redeemed', count(*) filter (where status = 'REDEEMED'),
        'validated_today', count(*) filter (where redeemed_at >= v_day_start),
        'validated_7d', count(*) filter (where redeemed_at >= public.app_now() - interval '7 days'),
        'validated_30d', count(*) filter (where redeemed_at >= public.app_now() - interval '30 days')) from public.coupon),
    'by_lot', coalesce((select jsonb_agg(jsonb_build_object('lot_no', l.lot_no, 'quantity', l.quantity,
          'active', coalesce(k.active, 0), 'validated', coalesce(k.validated, 0), 'redeemed', coalesce(k.redeemed, 0),
          'not_active', coalesce(k.not_active, 0))
          order by l.id)
        from public.coupon_lot l
        left join lateral (select count(*) filter (where status = 'ACTIVE') active,
                                  count(*) filter (where redeemed_at is not null) validated,
                                  count(*) filter (where status = 'REDEEMED') redeemed,
                                  count(*) filter (where status = 'GENERATED') not_active
                             from public.coupon where lot_id = l.id) k on true), '[]'::jsonb),
    'by_distributor', coalesce((select jsonb_agg(jsonb_build_object('code', x.code, 'name', x.name, 'dealers', x.dealers,
          'validated', x.validated) order by x.validated desc, x.name)
        from (select d.code, d.name,
                     (select count(*) from public.dealer dl where dl.distributor_id = d.id) dealers,
                     (select count(*) from public.coupon c where c.routed_distributor_id = d.id and c.redeemed_at is not null) validated
                from public.distributor d) x), '[]'::jsonb),
    'top_dealers', coalesce((select jsonb_agg(jsonb_build_object('dealer', y.name, 'distributor', y.dname, 'validated', y.n) order by y.n desc)
        from (select dl.name, ds.name dname, count(*) n
                from public.coupon c join public.dealer dl on dl.id = c.redeemed_dealer_id
                join public.distributor ds on ds.id = dl.distributor_id
               where c.redeemed_at is not null group by dl.name, ds.name order by n desc limit 20) y), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('serial', z.serial, 'dealer', z.dname, 'at', z.redeemed_at) order by z.redeemed_at desc)
        from (select c.serial, dl.name dname, c.redeemed_at
                from public.coupon c join public.dealer dl on dl.id = c.redeemed_dealer_id
               where c.redeemed_at is not null order by c.redeemed_at desc limit 20) z), '[]'::jsonb),
    'as_of', public.app_now());
end $$;

-- ── Who may set whose PIN ───────────────────────────────────────────────────────────────────
--   a dealer's PIN:        the dealer's distributor or sales rep
--   a sales rep's PIN:     their distributor, or 24M admin
--   a distributor's PIN:   24M admin
create or replace function public.set_user_pin(p_user_id bigint, p_pin text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.app_user; t public.app_user; v_ok boolean;
begin
  u := public.assert_role(array['M24_ADMIN', 'DISTRIBUTOR']);
  select * into t from public.app_user where id = p_user_id;
  if not found then perform public.fail('NOT_FOUND'); end if;
  if t.role like 'M24\_%' then perform public.fail('USE_PASSWORD_LOGIN'); end if;
  v_ok := case
    when t.role in ('DEALER_OWNER', 'DEALER_STAFF') then
      u.role = 'DISTRIBUTOR'
      and exists (select 1 from public.dealer where id = t.dealer_id and distributor_id = u.distributor_id)
    when t.role = 'DISTRIBUTOR' and t.is_sales_rep then
      u.role = 'M24_ADMIN' or (not u.is_sales_rep and t.distributor_id = u.distributor_id)
    when t.role = 'DISTRIBUTOR' then u.role = 'M24_ADMIN'
    else false end;
  if not v_ok then raise exception 'FORBIDDEN' using errcode = 'PT403'; end if;
  perform public.store_pin(t.id, p_pin, u.id);
  perform public.log_admin(u.id, 'SET_PIN', 'app_user:' || t.id);
end $$;

-- ── 24M admin: change any registered mobile number, and the helpline ────────────────────────
create or replace function public.update_user_mobile(p_user_id bigint, p_mobile text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['M24_ADMIN']); t public.app_user; v_old text;
begin
  if p_mobile is null or p_mobile !~ '^\+[1-9][0-9]{7,14}$' then perform public.fail('BAD_MOBILE'); end if;
  select * into t from public.app_user where id = p_user_id for update;
  if not found then perform public.fail('NOT_FOUND'); end if;
  v_old := t.mobile_e164;
  if v_old is not distinct from p_mobile then return; end if;
  if t.status = 'ACTIVE' and exists (select 1 from public.app_user where mobile_e164 = p_mobile and status = 'ACTIVE' and id <> t.id) then
    perform public.fail('DUPLICATE_MOBILE');
  end if;
  if t.dealer_id is not null and t.role = 'DEALER_OWNER'
     and exists (select 1 from public.dealer where mobile_e164 = p_mobile and id <> t.dealer_id) then
    perform public.fail('DUPLICATE_MOBILE');
  end if;
  update public.app_user set mobile_e164 = p_mobile where id = t.id;
  if t.dealer_id is not null and t.role = 'DEALER_OWNER' then
    update public.dealer set mobile_e164 = p_mobile where id = t.dealer_id;
  end if;
  if t.distributor_id is not null and t.role = 'DISTRIBUTOR' and not t.is_sales_rep then
    update public.distributor set mobile_e164 = p_mobile where id = t.distributor_id;
  end if;
  perform public.log_admin(u.id, 'UPDATE_MOBILE', 'app_user:' || t.id, null,
    jsonb_build_object('from', public.mask_phone(coalesce(v_old, '')), 'to', public.mask_phone(p_mobile)));
end $$;

create or replace function public.set_helpline(p_number text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['M24_ADMIN']); v_n text := btrim(coalesce(p_number, ''));
begin
  if v_n !~ '^\+?[0-9][0-9 ()-]{6,18}[0-9]$' then perform public.fail('BAD_HELPLINE'); end if;
  insert into public.app_config (key, value) values ('helpline', to_jsonb(v_n))
  on conflict (key) do update set value = excluded.value;
  perform public.log_admin(u.id, 'SET_HELPLINE', 'app_config:helpline');
end $$;

-- The helpline is public (it is shown on the coupon page), so anyone may read it.
create or replace function public.public_helpline()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select public.cfg_text('helpline');
$$;

-- ── Grants (new functions start with none) ──────────────────────────────────────────────────
grant execute on function
  public.redeem_coupons(text[], text), public.update_user_mobile(bigint, text), public.set_helpline(text)
to authenticated;
grant execute on function public.public_helpline() to anon, authenticated;
revoke execute on function
  public.redeem_coupons(text[], text), public.update_user_mobile(bigint, text), public.set_helpline(text)
from public, anon, service_role;
revoke execute on function public.public_helpline() from public, service_role;
