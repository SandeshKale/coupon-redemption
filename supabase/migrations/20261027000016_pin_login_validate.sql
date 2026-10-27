-- 0016: mobile + 4-digit PIN login, dealer "validate" action, sales reps, dealer GST, live stats.
-- Painter payment and claims happen outside the app (physical coupons, credit notes on paper).

-- ── Columns ─────────────────────────────────────────────────────────────────
alter table public.app_user add column is_sales_rep boolean not null default false;
alter table public.dealer add column gst text
  check (gst is null or gst ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$');
create sequence public.dealer_code_seq;

insert into private.secret (name, value) values ('pin_pepper', extensions.gen_random_bytes(32))
on conflict (name) do nothing;

insert into public.app_config (key, value) values
  ('pin_login_limit', '{"count": 40, "minutes": 10}'),
  ('pin_lock', '{"failures": 5, "base_minutes": 15, "max_minutes": 1440}')
on conflict (key) do nothing;

-- ── PIN storage ─────────────────────────────────────────────────────────────
create table public.user_pin (
  user_id bigint primary key references public.app_user,
  pin_hash text not null,
  failed_count int not null default 0,
  lock_level int not null default 0,
  locked_until timestamptz,
  set_by bigint references public.app_user,
  set_at timestamptz not null default now()
);
create index on public.user_pin (set_by);

create table public.pin_attempt (
  id bigserial primary key,
  ip_hash bytea not null,
  at timestamptz not null default now()
);
create index on public.pin_attempt (ip_hash, at);

alter table public.user_pin enable row level security;
alter table public.pin_attempt enable row level security;
revoke all on public.user_pin, public.pin_attempt from public, anon, authenticated, service_role;
revoke all on sequence public.pin_attempt_id_seq, public.dealer_code_seq from public, anon, authenticated, service_role;

-- Hash input is the PIN keyed with a server-side pepper, then bcrypt: a copy of the table alone is not enough.
create or replace function public.pin_digest(p_pin text) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select encode(extensions.hmac(convert_to(p_pin, 'UTF8'), s.value, 'sha256'), 'hex')
    from private.secret s where s.name = 'pin_pepper';
$$;

create or replace function public.pin_is_weak(p_pin text, p_mobile text default null) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select p_pin is null or p_pin !~ '^[0-9]{4}$'
      or p_pin ~ '^([0-9])\1{3}$'
      or p_pin in ('0123', '1234', '2345', '3456', '4567', '5678', '6789', '3210', '4321', '5432', '6543', '7654',
                   '8765', '9876', '1212', '2580', '1004', '2000', '2024', '2025', '2026')
      or (p_mobile is not null and right(p_mobile, 4) = p_pin);
$$;

create or replace function public.store_pin(p_user_id bigint, p_pin text, p_by bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_mobile text;
begin
  select mobile_e164 into v_mobile from public.app_user where id = p_user_id;
  if public.pin_is_weak(p_pin, v_mobile) then perform public.fail('WEAK_PIN'); end if;
  insert into public.user_pin (user_id, pin_hash, set_by, set_at)
  values (p_user_id, extensions.crypt(public.pin_digest(p_pin), extensions.gen_salt('bf', 10)), p_by, public.app_now())
  on conflict (user_id) do update
    set pin_hash = excluded.pin_hash, failed_count = 0, lock_level = 0, locked_until = null,
        set_by = excluded.set_by, set_at = excluded.set_at;
end $$;

-- ── Login check (service role, called by the pin-login Edge Function) ───────
-- Every failure looks the same to the caller: no way to learn which numbers exist or are locked.
create or replace function public.pin_login_check(p_mobile text, p_pin text, p_ip text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_lim jsonb := public.cfg('pin_login_limit');
  v_lock jsonb := public.cfg('pin_lock');
  v_hash bytea := public.ip_hash(p_ip);
  v_now timestamptz := public.app_now();
  t public.app_user; c public.user_pin; v_mins int;
begin
  if (select count(*) from public.pin_attempt
       where ip_hash = v_hash and at > v_now - make_interval(mins => (v_lim ->> 'minutes')::int))
     >= (v_lim ->> 'count')::int then
    return jsonb_build_object('result', 'RATE_LIMITED');
  end if;
  insert into public.pin_attempt (ip_hash, at) values (v_hash, v_now);

  if coalesce(p_pin, '') !~ '^[0-9]{4}$' or coalesce(p_mobile, '') !~ '^\+[1-9][0-9]{7,14}$' then
    return jsonb_build_object('result', 'FAILED', 'why', 'format');
  end if;
  select * into t from public.app_user where mobile_e164 = p_mobile and status = 'ACTIVE' and role not like 'M24\_%';
  if not found then
    perform extensions.crypt(public.pin_digest(p_pin), extensions.gen_salt('bf', 10));   -- same work as a real check
    return jsonb_build_object('result', 'FAILED', 'why', 'unknown');
  end if;
  select * into c from public.user_pin where user_id = t.id for update;
  if not found then return jsonb_build_object('result', 'FAILED', 'why', 'no_pin'); end if;
  if c.locked_until is not null and c.locked_until > v_now then
    return jsonb_build_object('result', 'FAILED', 'why', 'locked');
  end if;

  if c.pin_hash = extensions.crypt(public.pin_digest(p_pin), c.pin_hash) then
    update public.user_pin set failed_count = 0, lock_level = 0, locked_until = null where user_id = t.id;
    return jsonb_build_object('result', 'OK', 'user_id', t.id, 'email', t.email);
  end if;

  if c.failed_count + 1 >= (v_lock ->> 'failures')::int then
    v_mins := least((v_lock ->> 'base_minutes')::int * (4 ^ c.lock_level)::int, (v_lock ->> 'max_minutes')::int);
    update public.user_pin set failed_count = 0, lock_level = c.lock_level + 1,
           locked_until = v_now + make_interval(mins => v_mins) where user_id = t.id;
    perform public.log_admin(null, 'PIN_LOCKED', 'app_user:' || t.id, null, jsonb_build_object('minutes', v_mins));
  else
    update public.user_pin set failed_count = failed_count + 1 where user_id = t.id;
  end if;
  return jsonb_build_object('result', 'FAILED', 'why', 'wrong_pin');
end $$;

-- A manager sets or resets someone's PIN (24M for anyone, a distributor for their own dealers).
create or replace function public.set_user_pin(p_user_id bigint, p_pin text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.app_user; t public.app_user;
begin
  u := public.assert_role(array['M24_ADMIN', 'DISTRIBUTOR']);
  select * into t from public.app_user where id = p_user_id;
  if not found then perform public.fail('NOT_FOUND'); end if;
  if t.role like 'M24\_%' then perform public.fail('USE_PASSWORD_LOGIN'); end if;
  perform public.assert_can_manage_user(t.role, t.dealer_id, t.distributor_id);
  perform public.store_pin(t.id, p_pin, u.id);
  perform public.log_admin(u.id, 'SET_PIN', 'app_user:' || t.id);
end $$;

-- Own PIN change (needs the current PIN).
create or replace function public.change_my_pin(p_old text, p_new text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.app_user; c public.user_pin;
begin
  u := public.assert_role(array['DEALER_OWNER', 'DEALER_STAFF', 'DISTRIBUTOR']);
  select * into c from public.user_pin where user_id = u.id for update;
  if not found or c.pin_hash <> extensions.crypt(public.pin_digest(coalesce(p_old, '')), c.pin_hash) then
    perform public.fail('WRONG_PIN');
  end if;
  perform public.store_pin(u.id, p_new, u.id);
  perform public.log_admin(u.id, 'CHANGE_PIN', 'app_user:' || u.id);
end $$;

-- ── Creating logins (dealer, distributor, sales rep) ────────────────────────
drop function public.precheck_new_user(text, text, text, int, int);
create or replace function public.precheck_new_user(p_name text, p_mobile text, p_role text, p_dealer_id int,
  p_distributor_id int, p_parent_distributor int default null, p_is_rep boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u public.app_user;
begin
  if p_role = 'DEALER_OWNER' and p_dealer_id is null then       -- a new dealer under p_parent_distributor
    u := public.assert_role(array['M24_ADMIN', 'DISTRIBUTOR']);
    if p_parent_distributor is null then perform public.fail('BAD_REQUEST'); end if;
    if u.role = 'DISTRIBUTOR' and p_parent_distributor <> u.distributor_id then
      raise exception 'FORBIDDEN' using errcode = 'PT403';
    end if;
    if not exists (select 1 from public.distributor where id = p_parent_distributor and status = 'ACTIVE') then
      perform public.fail('DISTRIBUTOR_INACTIVE');
    end if;
    if p_mobile is not null and exists (select 1 from public.dealer where mobile_e164 = p_mobile) then
      perform public.fail('DUPLICATE_MOBILE');
    end if;
  else
    u := public.assert_can_manage_user(p_role, p_dealer_id, p_distributor_id);
  end if;
  if p_role not in ('DEALER_STAFF', 'DEALER_OWNER', 'DISTRIBUTOR', 'M24_ADMIN', 'M24_FINANCE', 'M24_VIEWER') then
    perform public.fail('BAD_ROLE');
  end if;
  if p_is_rep and (p_role <> 'DISTRIBUTOR' or u.role <> 'M24_ADMIN') then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if length(coalesce(btrim(p_name), '')) < 2 then perform public.fail('BAD_NAME'); end if;
  if p_mobile is not null and exists (select 1 from public.app_user where mobile_e164 = p_mobile and status = 'ACTIVE') then
    perform public.fail('DUPLICATE_MOBILE');
  end if;
  return jsonb_build_object('ok', true, 'created_by', u.id,
    'email_domain', public.cfg_text('internal_email_domain'));
end $$;

drop function public.register_app_user(uuid, text, text, text, text, int, int, bigint, bigint);
create or replace function public.register_app_user(p_auth_user_id uuid, p_name text, p_mobile text, p_email text,
  p_role text, p_dealer_id int, p_distributor_id int, p_created_by bigint, p_request_id bigint default null,
  p_pin text default null, p_is_rep boolean default false, p_gst text default null, p_parent_distributor_id int default null)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id bigint; v_dealer int := p_dealer_id;
begin
  if p_role not like 'M24\_%' and p_pin is null then perform public.fail('PIN_REQUIRED'); end if;
  if p_pin is not null and public.pin_is_weak(p_pin, p_mobile) then perform public.fail('WEAK_PIN'); end if;
  if p_role = 'DEALER_OWNER' and v_dealer is null then
    insert into public.dealer (code, name, mobile_e164, gst, distributor_id)
    values ('DL' || lpad(nextval('public.dealer_code_seq')::text, 5, '0'), p_name, p_mobile, nullif(upper(btrim(p_gst)), ''),
            p_parent_distributor_id)
    returning id into v_dealer;
    insert into public.dealer_distributor_history (dealer_id, from_distributor_id, to_distributor_id, changed_by, changed_at)
    values (v_dealer, null, p_parent_distributor_id, p_created_by, public.app_now());
  end if;
  insert into public.app_user (auth_user_id, name, mobile_e164, email, role, dealer_id, distributor_id, created_by, is_sales_rep)
  values (p_auth_user_id, p_name, p_mobile, p_email, p_role, v_dealer, p_distributor_id, p_created_by, coalesce(p_is_rep, false))
  returning id into v_id;
  if p_pin is not null then perform public.store_pin(v_id, p_pin, p_created_by); end if;
  if p_request_id is not null then
    update public.user_request set status = 'DONE', decided_by = p_created_by, decided_at = public.app_now(), target_user_id = v_id
     where id = p_request_id and status = 'PENDING';
  end if;
  perform public.log_admin(p_created_by, 'CREATE_USER', 'app_user:' || v_id,
    null, jsonb_build_object('role', p_role, 'sales_rep', coalesce(p_is_rep, false)));
  return v_id;
end $$;

-- ── Validate (the only thing a dealer can do to a coupon) ───────────────────
-- ACTIVE → validated. The coupon keeps the REDEEMED status internally; the app calls it "Validated".
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
     set status = 'REDEEMED', redeemed_at = v_now, redeemed_dealer_id = d.id, redeemed_user_id = u.id,
         routed_distributor_id = d.distributor_id
   where code = v_code and status = 'ACTIVE' and (expires_at is null or expires_at > v_now)
  returning * into c;
  if not found then return public.explain_coupon(v_code, u.id, d.id); end if;
  insert into public.coupon_event (coupon_id, event, from_status, to_status, user_id, ref, at)
  values (c.id, 'REDEEMED', 'ACTIVE', 'REDEEMED', u.id, 'validate', v_now);
  perform public.log_scan(u.id, c.id, d.id, 'VALIDATED', v_code);
  return jsonb_build_object('result', 'VALIDATED', 'code', public.code13(v_code), 'serial', c.serial,
                            'value_paise', c.value_paise, 'validated_at', v_now);
end $$;

-- Coupons this dealer validated, newest first.
create or replace function public.my_validations(p_limit int default 20, p_before timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['DEALER_OWNER', 'DEALER_STAFF']);
begin
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.validated_at desc) from (
      select c.serial, c.value_paise, c.redeemed_at as validated_at, au.name as validated_by
        from public.coupon c join public.app_user au on au.id = c.redeemed_user_id
       where c.redeemed_dealer_id = u.dealer_id and (p_before is null or c.redeemed_at < p_before)
       order by c.redeemed_at desc, c.id desc
       limit least(greatest(coalesce(p_limit, 20), 1), 100)
    ) x), '[]'::jsonb);
end $$;

-- Public page: genuine or not, and where the coupon is in its life (no dealer or distributor details).
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
      else 'VALIDATED' end,
    'helpline', public.cfg_text('helpline'));
end $$;

-- ── 24M live view ───────────────────────────────────────────────────────────
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
        'validated_today', count(*) filter (where redeemed_at >= v_day_start),
        'validated_7d', count(*) filter (where redeemed_at >= public.app_now() - interval '7 days'),
        'validated_30d', count(*) filter (where redeemed_at >= public.app_now() - interval '30 days')) from public.coupon),
    'by_lot', coalesce((select jsonb_agg(jsonb_build_object('lot_no', l.lot_no, 'quantity', l.quantity,
          'active', coalesce(k.active, 0), 'validated', coalesce(k.validated, 0), 'not_active', coalesce(k.not_active, 0))
          order by l.id)
        from public.coupon_lot l
        left join lateral (select count(*) filter (where status = 'ACTIVE') active,
                                  count(*) filter (where redeemed_at is not null) validated,
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

-- Dealers list for a distributor / sales rep (and 24M): name, GST, mobile, status, whether a PIN is set.
create or replace function public.list_dealers(p_distributor_id int default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  u public.app_user := public.assert_role(array['M24_ADMIN', 'M24_FINANCE', 'M24_VIEWER', 'DISTRIBUTOR']);
  v_dist int;
begin
  v_dist := case when u.role = 'DISTRIBUTOR' then u.distributor_id else p_distributor_id end;
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.name) from (
      select d.id, d.code, d.name, d.gst, d.mobile_e164, d.status, d.distributor_id, ds.name as distributor,
             (select au.id from public.app_user au where au.dealer_id = d.id and au.role = 'DEALER_OWNER' order by au.id limit 1) as user_id,
             (select au.status from public.app_user au where au.dealer_id = d.id and au.role = 'DEALER_OWNER' order by au.id limit 1) as user_status,
             (select count(*) from public.coupon c where c.redeemed_dealer_id = d.id and c.redeemed_at is not null) as validated
        from public.dealer d join public.distributor ds on ds.id = d.distributor_id
       where v_dist is null or d.distributor_id = v_dist
    ) x), '[]'::jsonb);
end $$;

create or replace function public.run_reconciliation()
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare v_day date := public.ist_date(public.app_now()); v_before int; v_after int;
begin
  select count(*) into v_before from public.recon_issue where run_date = v_day;

  -- 1. Every coupon redeemed through a batch is live in exactly one dealer claim.
  --    (Coupons validated by a dealer, with no batch, do not enter the claim flow.)
  insert into public.recon_issue (run_date, check_name, ref, details)
  select v_day, 'REDEEMED_WITHOUT_LINE', 'coupon:' || c.id, jsonb_build_object('status', c.status)
    from public.coupon c
   where c.redeemed_at is not null and c.redemption_batch_id is not null
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

-- ── Grants (new functions start with none) ──────────────────────────────────
grant execute on function
  public.set_user_pin(bigint, text), public.change_my_pin(text, text),
  public.precheck_new_user(text, text, text, int, int, int, boolean),
  public.validate_coupon(text), public.my_validations(int, timestamptz),
  public.coupon_stats(), public.list_dealers(int)
to authenticated;
grant execute on function
  public.register_app_user(uuid, text, text, text, text, int, int, bigint, bigint, text, boolean, text, int),
  public.pin_login_check(text, text, text)
to service_role;

-- Internal helpers are callable only from other functions; API-facing functions only by their roles.
revoke execute on function public.pin_digest(text), public.pin_is_weak(text, text), public.store_pin(bigint, text, bigint)
  from public, anon, authenticated, service_role;
revoke execute on function
  public.set_user_pin(bigint, text), public.change_my_pin(text, text),
  public.precheck_new_user(text, text, text, int, int, int, boolean),
  public.validate_coupon(text), public.my_validations(int, timestamptz),
  public.coupon_stats(), public.list_dealers(int)
from public, anon, service_role;
revoke execute on function
  public.register_app_user(uuid, text, text, text, text, int, int, bigint, bigint, text, boolean, text, int),
  public.pin_login_check(text, text, text)
from public, anon, authenticated;
