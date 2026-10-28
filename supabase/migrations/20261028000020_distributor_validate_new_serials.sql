-- 0020: distributors and sales reps can scan and validate coupons too; new serial pattern.
--
-- Serial pattern:  SERIES-NNNNNN-C   for example  RA-860881-6
--   SERIES  the lot's serial prefix (2 to 6 characters from the coupon alphabet)
--   NNNNNN  six digits from a keyed permutation of the coupon's sequence number, so the digits are
--           not in order and neither neighbours nor the number of coupons can be guessed
--   C       a check character over SERIES and NNNNNN, so a mistyped serial is caught
-- The serial is a paperwork reference. The secret is the 13-character code inside the QR.

insert into private.secret (name, value) values ('serial_key', extensions.gen_random_bytes(32))
on conflict (name) do nothing;

create or replace function public.make_serial(p_prefix text, p_n bigint)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  k bytea; x int; l int; r int; t int; h bytea;
begin
  if p_n < 0 or p_n > 999999 then raise exception 'SERIAL_RANGE: % is outside 0 to 999999', p_n; end if;
  select s.value into k from private.secret s where s.name = 'serial_key';
  x := p_n::int;
  loop                              -- 4-round Feistel permutation of 20 bits, cycle-walked into 0..999999
    l := x >> 10; r := x & 1023;
    for i in 0..3 loop
      h := extensions.hmac(int4send(r) || int4send(i), k, 'sha256');
      t := l # (((get_byte(h, 0) << 8) | get_byte(h, 1)) & 1023);
      l := r; r := t;
    end loop;
    x := (l << 10) | r;
    exit when x < 1000000;
  end loop;
  return p_prefix || '-' || lpad(x::text, 6, '0') || '-' || public.luhn32_check_char(p_prefix || lpad(x::text, 6, '0'));
end $$;

revoke execute on function public.make_serial(text, bigint) from public, anon, authenticated, service_role;

-- A series is made of characters from the coupon alphabet and a lot never passes six digits.
create or replace function public.create_lot(p_lot_no text, p_quantity int, p_value_paise bigint, p_sku text, p_serial_prefix text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u public.app_user := public.assert_role(array['M24_ADMIN']);
  v_from bigint; v_id int;
begin
  if p_quantity is null or p_quantity < 1 or p_quantity > 200000 then perform public.fail('BAD_QUANTITY'); end if;
  if upper(coalesce(p_serial_prefix, '')) !~ '^[0-9A-HJKMNP-TV-Z]{2,6}$' then perform public.fail('BAD_PREFIX'); end if;
  insert into public.serial_counter (prefix) values (upper(p_serial_prefix)) on conflict do nothing;
  update public.serial_counter set last_value = last_value + p_quantity
   where prefix = upper(p_serial_prefix) returning last_value - p_quantity + 1 into v_from;
  if v_from + p_quantity - 1 > 999999 then perform public.fail('SERIES_FULL'); end if;
  insert into public.coupon_lot (lot_no, quantity, value_paise, intended_sku, serial_prefix, serial_from, serial_to, created_by, created_at)
  values (upper(p_lot_no), p_quantity, p_value_paise, upper(p_sku), upper(p_serial_prefix), v_from, v_from + p_quantity - 1, u.id, public.app_now())
  returning id into v_id;
  perform public.log_admin(u.id, 'CREATE_LOT', 'lot:' || v_id, null,
    jsonb_build_object('quantity', p_quantity, 'value_paise', p_value_paise));
  return jsonb_build_object('lot_id', v_id, 'serial_from', v_from, 'serial_to', v_from + p_quantity - 1);
end $$;

create or replace function public.generate_lot_codes(p_lot_id int, p_max int default 50000)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  l public.coupon_lot; v_start bigint; v_end bigint; v_missing int; v_rounds int := 0;
begin
  perform public.assert_role(array['M24_ADMIN']);
  select * into l from public.coupon_lot where id = p_lot_id for update;
  if not found then perform public.fail('NOT_FOUND'); end if;
  if l.status <> 'GENERATING' then
    return jsonb_build_object('lot_id', l.id, 'generated', l.generated_count, 'done', true);
  end if;
  v_start := l.serial_from + l.generated_count;
  v_end := least(l.serial_to, v_start + least(greatest(p_max, 1), 50000) - 1);
  loop
    insert into public.coupon (lot_id, serial_no, serial, code, value_paise, sku)
    select l.id, s, public.make_serial(l.serial_prefix, s), public.gen_code12(), l.value_paise, l.intended_sku
      from generate_series(v_start, v_end) s
     where not exists (select 1 from public.coupon c where c.lot_id = l.id and c.serial_no = s)
    on conflict do nothing;
    select (v_end - v_start + 1) - count(*) into v_missing
      from public.coupon c where c.lot_id = l.id and c.serial_no between v_start and v_end;
    exit when v_missing = 0;
    v_rounds := v_rounds + 1;
    if v_rounds > 20 then perform public.fail('CODE_GENERATION_STUCK'); end if;
  end loop;
  update public.coupon_lot
     set generated_count = (v_end - l.serial_from + 1)::int,
         status = case when v_end = l.serial_to then 'GENERATED' else 'GENERATING' end
   where id = l.id;
  return jsonb_build_object('lot_id', l.id, 'generated', v_end - l.serial_from + 1, 'done', v_end = l.serial_to,
    'collision_rounds', v_rounds);
end $$;

-- ── Distributors and sales reps validate like dealers ───────────────────────────────────────
-- A dealer's own check says "already validated by you" for their shop; a distributor's for themselves.
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

-- Who is validating and for which distributor: a dealer for their (active) distributor, a distributor
-- or rep for their own. Returns null columns when the account may not validate right now.
create or replace function public.validator_scope(u public.app_user, out o_dealer int, out o_distributor int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare d public.dealer;
begin
  if u.role = 'DISTRIBUTOR' then
    select x.id into o_distributor from public.distributor x where x.id = u.distributor_id and x.status = 'ACTIVE';
  else
    d := public.active_dealer_for(u);
    o_dealer := d.id; o_distributor := d.distributor_id;
  end if;
end $$;
revoke execute on function public.validator_scope(public.app_user) from public, anon, authenticated, service_role;

create or replace function public.check_coupon(p_code text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u public.app_user := public.assert_role(array['DEALER_OWNER', 'DEALER_STAFF', 'DISTRIBUTOR']);
  s record; v_code text;
begin
  select * into s from public.validator_scope(u);
  if s.o_distributor is null then return jsonb_build_object('result', 'DEALER_INACTIVE'); end if;
  if public.invalid_scan_brake_active(u.id) then return jsonb_build_object('result', 'TOO_MANY_INVALID'); end if;
  v_code := public.normalise_code(p_code);
  if v_code is null then
    perform public.log_scan(u.id, null, s.o_dealer, 'INVALID_FORMAT', p_code);
    return jsonb_build_object('result', 'INVALID_FORMAT');
  end if;
  return public.explain_coupon(v_code, u.id, s.o_dealer);
end $$;

create or replace function public.validate_coupon(p_code text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u public.app_user := public.assert_role(array['DEALER_OWNER', 'DEALER_STAFF', 'DISTRIBUTOR']);
  s record; v_code text; c public.coupon; v_now timestamptz := public.app_now();
begin
  select * into s from public.validator_scope(u);
  if s.o_distributor is null then return jsonb_build_object('result', 'DEALER_INACTIVE'); end if;
  if public.invalid_scan_brake_active(u.id) then return jsonb_build_object('result', 'TOO_MANY_INVALID'); end if;
  v_code := public.normalise_code(p_code);
  if v_code is null then
    perform public.log_scan(u.id, null, s.o_dealer, 'INVALID_FORMAT', p_code);
    return jsonb_build_object('result', 'INVALID_FORMAT');
  end if;
  update public.coupon
     set status = 'VALIDATED', redeemed_at = v_now, redeemed_dealer_id = s.o_dealer, redeemed_user_id = u.id,
         routed_distributor_id = s.o_distributor
   where code = v_code and status = 'ACTIVE' and (expires_at is null or expires_at > v_now)
  returning * into c;
  if not found then return public.explain_coupon(v_code, u.id, s.o_dealer); end if;
  insert into public.coupon_event (coupon_id, event, from_status, to_status, user_id, ref, at)
  values (c.id, 'VALIDATED', 'ACTIVE', 'VALIDATED', u.id, 'validate', v_now);
  perform public.log_scan(u.id, c.id, s.o_dealer, 'VALIDATED', v_code);
  return jsonb_build_object('result', 'VALIDATED', 'code', public.code13(v_code), 'serial', c.serial,
                            'value_paise', c.value_paise, 'validated_at', v_now);
end $$;

-- A dealer sees their shop's validations; a distributor or rep sees those of their own team.
create or replace function public.my_validations(p_limit int default 20, p_before timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['DEALER_OWNER', 'DEALER_STAFF', 'DISTRIBUTOR']);
begin
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.validated_at desc) from (
      select c.serial, c.value_paise, c.redeemed_at as validated_at, au.name as validated_by
        from public.coupon c join public.app_user au on au.id = c.redeemed_user_id
       where (case when u.role = 'DISTRIBUTOR'
                   then au.distributor_id = u.distributor_id
                   else c.redeemed_dealer_id = u.dealer_id end)
         and c.redeemed_at is not null and (p_before is null or c.redeemed_at < p_before)
       order by c.redeemed_at desc, c.id desc
       limit least(greatest(coalesce(p_limit, 20), 1), 100)
    ) x), '[]'::jsonb);
end $$;

-- The 24M dashboard's "recent validations" also lists validations made by distributors.
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
        from (select c.serial, coalesce(dl.name, au.name) dname, c.redeemed_at
                from public.coupon c
                left join public.dealer dl on dl.id = c.redeemed_dealer_id
                left join public.app_user au on au.id = c.redeemed_user_id
               where c.redeemed_at is not null order by c.redeemed_at desc limit 20) z), '[]'::jsonb),
    'as_of', public.app_now());
end $$;
