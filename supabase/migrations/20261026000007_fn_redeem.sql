-- 0007: dealer critical path — check, redeem, receipt status, outcome lookup (§4.1, §13.1, §18.4).

insert into public.app_config (key, value) values ('wa_business_number', '"910000000000"')
on conflict (key) do nothing;

create or replace function public.invalid_scan_brake_active(p_user bigint)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select count(*) >= public.cfg_int('invalid_scan_brake', 'count')
    from public.scan_attempt
   where user_id = p_user and result in ('INVALID_FORMAT', 'NOT_FOUND')
     and at > public.app_now() - make_interval(mins => public.cfg_int('invalid_scan_brake', 'minutes'));
$$;

-- R1-07: dealer active and mapped to an active distributor. Null when not.
create or replace function public.active_dealer_for(u public.app_user)
returns public.dealer language sql stable security definer set search_path = public, pg_temp as $$
  select d.* from public.dealer d join public.distributor x on x.id = d.distributor_id
   where d.id = u.dealer_id and d.status = 'ACTIVE' and x.status = 'ACTIVE';
$$;

-- Race-safe: exactly one OPEN claim per dealer (unique partial index, EC-110).
create or replace function public.open_claim_for(p_dealer int, p_distributor int)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id bigint;
begin
  insert into public.dealer_claim (dealer_id, distributor_id, opened_at)
  values (p_dealer, p_distributor, public.app_now())
  on conflict (dealer_id) where status = 'OPEN' do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.dealer_claim where dealer_id = p_dealer and status = 'OPEN';
  end if;
  return v_id;
end $$;

-- Explains why a code could not be redeemed/checked; also logs the scan.
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

-- Read-only validation for the result screen (R1-01..R1-09).
create or replace function public.check_coupon(p_code text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u public.app_user := public.assert_role(array['DEALER_OWNER', 'DEALER_STAFF']);
  d public.dealer := public.active_dealer_for(u);
  v_code text;
begin
  if d.id is null then return jsonb_build_object('result', 'DEALER_INACTIVE'); end if;
  if public.invalid_scan_brake_active(u.id) then return jsonb_build_object('result', 'TOO_MANY_INVALID'); end if;
  v_code := public.normalise_code(p_code);
  if v_code is null then
    perform public.log_scan(u.id, null, d.id, 'INVALID_FORMAT', p_code);
    return jsonb_build_object('result', 'INVALID_FORMAT');
  end if;
  return public.explain_coupon(v_code, u.id, d.id);
end $$;

-- Creates the painter confirmation for a batch (unique among open tokens, EC-097).
create or replace function public.new_painter_token(p_batch bigint)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_token text; v_now timestamptz := public.app_now();
begin
  if not public.cfg_bool('painter_confirmation_enabled') then return null; end if;
  for i in 1..20 loop
    v_token := public.gen_token6();
    begin
      insert into public.painter_confirmation (batch_id, token, created_at, on_time_until, expires_at)
      values (p_batch, v_token, v_now,
              v_now + make_interval(mins => public.cfg_int('painter_on_time_minutes')),
              v_now + make_interval(hours => public.cfg_int('painter_token_ttl_hours')));
      return v_token;
    exception when unique_violation then
      null;  -- token collided with an open token: try another
    end;
  end loop;
  perform public.fail('TOKEN_GENERATION_FAILED');
  return null;
end $$;

-- §13.1: redeem 1–50 coupons; each coupon independently; idempotent per (user, key).
create or replace function public.redeem(p_codes text[], p_idem uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u public.app_user := public.assert_role(array['DEALER_OWNER', 'DEALER_STAFF']);
  d public.dealer;
  v_claim bigint; v_batch bigint; v_code text; v_raw text; c public.coupon;
  v_results jsonb := '[]'::jsonb; v_ids bigint[] := '{}'::bigint[]; v_value bigint := 0; v_distinct int;
  v_token text; v_resp jsonb; v_now timestamptz := public.app_now();
begin
  if p_idem is null or p_codes is null or cardinality(p_codes) = 0
     or cardinality(p_codes) > least(public.cfg_int('redeem_batch_max'), 50) then
    return jsonb_build_object('result', 'BAD_REQUEST');
  end if;

  -- Serialise concurrent requests with the same key, then replay a stored response.
  perform pg_advisory_xact_lock(hashtextextended(u.id::text || ':' || p_idem::text, 24));
  select response into v_resp from public.idempotency where user_id = u.id and key = p_idem;
  if found then return v_resp; end if;

  d := public.active_dealer_for(u);
  if d.id is null then return jsonb_build_object('result', 'DEALER_INACTIVE'); end if;
  if public.invalid_scan_brake_active(u.id) then return jsonb_build_object('result', 'TOO_MANY_INVALID'); end if;

  v_claim := public.open_claim_for(d.id, d.distributor_id);
  select count(distinct coalesce(public.normalise_code(x), x)) into v_distinct from unnest(p_codes) x;

  for v_raw in select distinct on (coalesce(public.normalise_code(x), x)) x from unnest(p_codes) x loop
    v_code := public.normalise_code(v_raw);
    if v_code is null then
      v_results := v_results || jsonb_build_object('code', left(v_raw, 20), 'result', 'INVALID_FORMAT');
      perform public.log_scan(u.id, null, d.id, 'INVALID_FORMAT', v_raw);
      continue;
    end if;

    update public.coupon
       set status = 'REDEEMED', redeemed_at = v_now, redeemed_dealer_id = d.id, redeemed_user_id = u.id,
           routed_distributor_id = d.distributor_id, dealer_claim_id = v_claim
     where code = v_code and status = 'ACTIVE' and (expires_at is null or expires_at > v_now)
    returning * into c;

    if found then
      insert into public.dealer_claim_line (claim_id, coupon_id) values (v_claim, c.id);
      perform public.log_scan(u.id, c.id, d.id, 'REDEEMED', v_code);
      v_ids := v_ids || c.id;
      v_value := v_value + c.value_paise;
      v_results := v_results || jsonb_build_object('code', public.code13(v_code), 'serial', c.serial,
                                                   'result', 'REDEEMED', 'value_paise', c.value_paise);
    else
      v_results := v_results || public.explain_coupon(v_code, u.id, d.id);
    end if;
  end loop;

  if cardinality(v_ids) = 0 then
    v_resp := jsonb_build_object('result', 'NONE_REDEEMED', 'lines', v_results, 'at', v_now);
  else
    -- The batch is created complete and is immutable afterwards.
    insert into public.redemption_batch (dealer_id, user_id, coupon_count, value_paise, created_at)
    values (d.id, u.id, cardinality(v_ids), v_value, v_now) returning id into v_batch;
    update public.coupon set redemption_batch_id = v_batch where id = any (v_ids);
    insert into public.coupon_event (coupon_id, event, from_status, to_status, user_id, ref, at)
    select id, 'REDEEMED', 'ACTIVE', 'REDEEMED', u.id, 'batch:' || v_batch, v_now from unnest(v_ids) id;
    v_token := public.new_painter_token(v_batch);
    v_resp := jsonb_build_object(
      'result', case when cardinality(v_ids) = v_distinct then 'REDEEMED' else 'PARTIAL' end,
      'batch_id', v_batch, 'count', cardinality(v_ids), 'value_paise', v_value,
      'painter_token', v_token, 'lines', v_results, 'at', v_now);
  end if;

  insert into public.idempotency (user_id, key, response, created_at) values (u.id, p_idem, v_resp, v_now);
  return v_resp;
end $$;

-- §18.4: resolves an unknown outcome after a network failure.
create or replace function public.redemption_outcome(p_idem uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['DEALER_OWNER', 'DEALER_STAFF']); v jsonb;
begin
  select response into v from public.idempotency where user_id = u.id and key = p_idem;
  if not found then return jsonb_build_object('found', false); end if;
  return jsonb_build_object('found', true, 'response', v);
end $$;

-- Receipt polling: painter confirmation status for one of my dealer's batches.
create or replace function public.batch_status(p_batch_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  u public.app_user := public.assert_role(array['DEALER_OWNER', 'DEALER_STAFF']);
  b public.redemption_batch; pc public.painter_confirmation; v_now timestamptz := public.app_now();
begin
  select * into b from public.redemption_batch where id = p_batch_id and dealer_id = u.dealer_id;
  if not found then perform public.fail('NOT_FOUND'); end if;
  select * into pc from public.painter_confirmation where batch_id = b.id;
  if not found then
    return jsonb_build_object('batch_id', b.id, 'status', 'NONE', 'count', b.coupon_count, 'value_paise', b.value_paise);
  end if;
  return jsonb_build_object(
    'batch_id', b.id, 'count', b.coupon_count, 'value_paise', b.value_paise, 'created_at', b.created_at,
    'status', case when pc.status = 'PENDING' and pc.expires_at <= v_now then 'EXPIRED' else pc.status end,
    'token', case when pc.status = 'PENDING' and pc.expires_at > v_now then pc.token end,
    'on_time_until', pc.on_time_until, 'expires_at', pc.expires_at, 'confirmed_at', pc.confirmed_at,
    'painter', (select p.phone_masked from public.painter p where p.id = pc.painter_id),
    'server_now', v_now);
end $$;

-- "Painter has no phone / no WhatsApp" (EC-095).
create or replace function public.skip_painter_confirmation(p_batch_id bigint, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['DEALER_OWNER', 'DEALER_STAFF']);
begin
  if coalesce(p_reason, '') not in ('NO_PHONE', 'NO_WHATSAPP', 'OTHER') then perform public.fail('BAD_REQUEST'); end if;
  update public.painter_confirmation pc set status = 'SKIPPED', skip_reason = p_reason
   where pc.batch_id = p_batch_id and pc.status = 'PENDING'
     and exists (select 1 from public.redemption_batch b where b.id = pc.batch_id and b.dealer_id = u.dealer_id);
  if not found then perform public.fail('NOT_PENDING'); end if;
  return public.batch_status(p_batch_id);
end $$;

-- Home screen totals (IST day and month).
create or replace function public.dealer_home()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  u public.app_user := public.assert_role(array['DEALER_OWNER', 'DEALER_STAFF']);
  v_today date := public.ist_date(public.app_now());
  v_month_start timestamptz := (date_trunc('month', v_today)::timestamp) at time zone 'Asia/Kolkata';
  v_day_start timestamptz := v_today::timestamp at time zone 'Asia/Kolkata';
  v jsonb;
begin
  select jsonb_build_object(
      'today_count', count(*) filter (where redeemed_at >= v_day_start),
      'today_paise', coalesce(sum(value_paise) filter (where redeemed_at >= v_day_start), 0),
      'month_count', count(*),
      'month_paise', coalesce(sum(value_paise), 0))
    into v
    from public.coupon where redeemed_dealer_id = u.dealer_id and redeemed_at >= v_month_start;
  return v || jsonb_build_object(
    'dealer', (select jsonb_build_object('name', d.name, 'status', d.status) from public.dealer d where d.id = u.dealer_id),
    'user', jsonb_build_object('name', u.name, 'role', u.role),
    'pending_painter', (select count(*) from public.painter_confirmation pc join public.redemption_batch b on b.id = pc.batch_id
                         where b.dealer_id = u.dealer_id and pc.status = 'PENDING' and pc.expires_at > public.app_now()),
    'wa_business_number', public.cfg_text('wa_business_number'),
    'helpline', public.cfg_text('helpline'),
    'as_of', public.app_now());
end $$;

-- History list incl. re-showable painter QR within 24 h (EC-096). Keyset pagination.
create or replace function public.my_batches(p_limit int default 20, p_before_id bigint default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['DEALER_OWNER', 'DEALER_STAFF']); v_now timestamptz := public.app_now();
begin
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.batch_id desc) from (
      select b.id as batch_id, b.created_at, b.coupon_count as count, b.value_paise, au.name as redeemed_by,
             case when pc.status = 'PENDING' and pc.expires_at <= v_now then 'EXPIRED' else coalesce(pc.status, 'NONE') end as painter_status,
             case when pc.status = 'PENDING' and pc.expires_at > v_now then pc.token end as token,
             (select array_agg(c.serial order by c.serial) from public.coupon c where c.redemption_batch_id = b.id) as serials
        from public.redemption_batch b
        join public.app_user au on au.id = b.user_id
        left join public.painter_confirmation pc on pc.batch_id = b.id
       where b.dealer_id = u.dealer_id and (p_before_id is null or b.id < p_before_id)
       order by b.id desc
       limit least(greatest(coalesce(p_limit, 20), 1), 100)
    ) x), '[]'::jsonb);
end $$;

-- Anonymous genuineness check (§13). Per-IP limit: 30 per 10 minutes (EC-153).
create or replace function public.public_coupon_info(p_code text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_lim jsonb := public.cfg('public_lookup_limit');
  v_hash bytea := public.ip_hash(public.request_ip());
  v_code text; c public.coupon;
begin
  if (select count(*) from public.public_lookup
       where ip_hash = v_hash and at > public.app_now() - make_interval(mins => (v_lim ->> 'minutes')::int))
     >= (v_lim ->> 'count')::int then
    return jsonb_build_object('result', 'RATE_LIMITED');
  end if;
  insert into public.public_lookup (ip_hash, at) values (v_hash, public.app_now());
  v_code := public.normalise_code(p_code);
  if v_code is null then return jsonb_build_object('result', 'INVALID_FORMAT'); end if;
  select * into c from public.coupon where code = v_code;
  if not found or c.status in ('GENERATED', 'VOID', 'BLOCKED') then
    return jsonb_build_object('result', 'NOT_RECOGNISED');
  end if;
  return jsonb_build_object('result', 'GENUINE', 'value_paise', c.value_paise,
                            'helpline', public.cfg_text('helpline'));
end $$;
