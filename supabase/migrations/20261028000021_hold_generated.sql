-- 0021: hold coupons that were never activated (tested, spoiled or destroyed at the plant).
--
-- A held coupon behaves like a blocked one: it cannot be activated, validated or redeemed, and the
-- public page does not recognise it. Releasing puts it back to the status it had (generated).

insert into public.coupon_transition (from_status, to_status, functions) values
  ('GENERATED', 'ON_HOLD', '{hold_coupons,hold_range}'),
  ('ON_HOLD', 'GENERATED', '{release_coupons,release_range}')
on conflict (from_status, to_status) do nothing;

-- One coupon (or a few by id), as before, and now also a coupon that is still only generated.
create or replace function public.hold_coupons(p_coupon_ids bigint[], p_reason text)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['M24_ADMIN']); v_count int;
begin
  if length(coalesce(btrim(p_reason), '')) < 5 then perform public.fail('REASON_REQUIRED'); end if;
  with h as (
    update public.coupon c set status = 'ON_HOLD', hold_prior_status = c.status, hold_reason = p_reason, held_at = public.app_now()
     where c.id = any (p_coupon_ids)
       and c.status in ('GENERATED', 'VALIDATED', 'REDEEMED', 'DIST_CN_ISSUED', 'CLAIMED_TO_24M')
    returning c.id, c.hold_prior_status
  ), e as (
    insert into public.coupon_event (coupon_id, event, from_status, to_status, user_id, ref, at)
    select id, 'HELD', hold_prior_status, 'ON_HOLD', u.id, p_reason, public.app_now() from h returning 1
  ) select count(*) into v_count from e;
  perform public.log_admin(u.id, 'HOLD_COUPONS', null, p_reason, jsonb_build_object('count', v_count, 'ids', to_jsonb(p_coupon_ids)));
  return v_count;
end $$;

-- A whole run of a lot, for example everything printed on a spoiled roll.
create or replace function public.hold_range(p_lot_id int, p_serial_from bigint, p_serial_to bigint, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['M24_ADMIN']); v_count int;
begin
  if length(coalesce(btrim(p_reason), '')) < 5 then perform public.fail('REASON_REQUIRED'); end if;
  if p_serial_from is null or p_serial_to is null or p_serial_from > p_serial_to then perform public.fail('BAD_RANGE'); end if;
  if not exists (select 1 from public.coupon_lot where id = p_lot_id) then perform public.fail('NOT_FOUND'); end if;
  with h as (
    update public.coupon c set status = 'ON_HOLD', hold_prior_status = 'GENERATED', hold_reason = p_reason, held_at = public.app_now()
     where c.lot_id = p_lot_id and c.serial_no between p_serial_from and p_serial_to and c.status = 'GENERATED'
    returning c.id
  ), e as (
    insert into public.coupon_event (coupon_id, event, from_status, to_status, user_id, ref, at)
    select id, 'HELD', 'GENERATED', 'ON_HOLD', u.id, p_reason, public.app_now() from h returning 1
  ) select count(*) into v_count from e;
  perform public.log_admin(u.id, 'HOLD_RANGE', 'lot:' || p_lot_id, p_reason,
    jsonb_build_object('from', p_serial_from, 'to', p_serial_to, 'held', v_count));
  return jsonb_build_object('held', v_count);
end $$;

-- Puts back a run of coupons that were held before activation.
create or replace function public.release_range(p_lot_id int, p_serial_from bigint, p_serial_to bigint, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['M24_ADMIN']); v_ids bigint[]; v_count int;
begin
  if length(coalesce(btrim(p_note), '')) < 3 then perform public.fail('REASON_REQUIRED'); end if;
  if p_serial_from is null or p_serial_to is null or p_serial_from > p_serial_to then perform public.fail('BAD_RANGE'); end if;
  select coalesce(array_agg(c.id), '{}') into v_ids from public.coupon c
   where c.lot_id = p_lot_id and c.serial_no between p_serial_from and p_serial_to
     and c.status = 'ON_HOLD' and c.hold_prior_status = 'GENERATED';
  v_count := public.release_coupon_rows(v_ids, u.id, p_note);
  perform public.log_admin(u.id, 'RELEASE_RANGE', 'lot:' || p_lot_id, p_note,
    jsonb_build_object('from', p_serial_from, 'to', p_serial_to, 'released', v_count));
  return jsonb_build_object('released', v_count);
end $$;

grant execute on function public.hold_range(int, bigint, bigint, text), public.release_range(int, bigint, bigint, text) to authenticated;

-- What a scan says about a held coupon that was never activated: blocked for the dealer, unknown to the public.
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
    when c.status = 'ON_HOLD' and c.hold_prior_status = 'GENERATED' then 'BLOCKED'
    when c.status = 'EXPIRED' or (c.status = 'ACTIVE' and c.expires_at is not null and c.expires_at <= public.app_now()) then 'EXPIRED'
    when c.status = 'ACTIVE' then 'VALID'
    when c.hq_redeemed_at is not null then 'ALREADY_CLOSED'
    when c.redeemed_user_id = p_user or (p_dealer is not null and c.redeemed_dealer_id = p_dealer) then 'ALREADY_REDEEMED_SELF'
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
  if not found or c.status in ('GENERATED', 'VOID', 'BLOCKED')
     or (c.status = 'ON_HOLD' and c.hold_prior_status = 'GENERATED') then
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
