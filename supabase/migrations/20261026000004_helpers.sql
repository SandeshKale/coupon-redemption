-- 0004: helpers — clock, config, codes, phones, identity/role assertion, logging.

-- Server clock. Tests may freeze it, but only in databases where the override is
-- explicitly enabled (never in staging/production: see scripts/db-test.sh).
create or replace function public.app_now() returns timestamptz
language sql stable set search_path = public, pg_temp as $$
  select case
    when current_setting('app.allow_clock_override', true) = 'on'
      and coalesce(current_setting('app.now', true), '') <> ''
    then current_setting('app.now', true)::timestamptz
    else now()
  end;
$$;

create or replace function public.ist_date(p_ts timestamptz) returns date
language sql immutable set search_path = public, pg_temp as $$
  select (p_ts at time zone 'Asia/Kolkata')::date;
$$;

create or replace function public.cfg(p_key text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select value from public.app_config where key = p_key;
$$;

create or replace function public.cfg_int(p_key text, p_path text default null) returns int
language sql stable set search_path = public, pg_temp as $$
  select (case when p_path is null then public.cfg(p_key) else public.cfg(p_key) -> p_path end)::text::int;
$$;

create or replace function public.cfg_bool(p_key text) returns boolean
language sql stable set search_path = public, pg_temp as $$
  select coalesce(public.cfg(p_key)::text::boolean, false);
$$;

create or replace function public.cfg_text(p_key text) returns text
language sql stable set search_path = public, pg_temp as $$
  select public.cfg(p_key) #>> '{}';
$$;

-- ── Codes (mirrors packages/shared; verified by shared test vectors) ───────
create or replace function public.luhn32_check_char(p_payload text) returns text
language plpgsql immutable strict set search_path = public, pg_temp as $$
declare
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  factor int := 2;
  total int := 0;
  cp int;
  addend int;
begin
  for i in reverse length(p_payload)..1 loop
    cp := strpos(alphabet, substr(p_payload, i, 1)) - 1;
    if cp < 0 then
      raise exception 'not an alphabet character: %', substr(p_payload, i, 1);
    end if;
    addend := factor * cp;
    factor := case when factor = 2 then 1 else 2 end;
    total := total + (addend / 32) + (addend % 32);
  end loop;
  return substr(alphabet, ((32 - (total % 32)) % 32) + 1, 1);
end $$;

create or replace function public.luhn32_valid(p_code text) returns boolean
language sql immutable strict set search_path = public, pg_temp as $$
  select length(p_code) >= 2
    and p_code ~ '^[0-9A-HJKMNP-TV-Z]+$'
    and public.luhn32_check_char(left(p_code, -1)) = right(p_code, 1);
$$;

-- Returns the 12-character lookup key, or null when format/check character fail (§8.3).
create or replace function public.normalise_code(p_input text) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare v text;
begin
  if p_input is null then return null; end if;
  v := upper(btrim(p_input));
  v := regexp_replace(v, '^.*/C/', '');        -- URL prefix
  v := regexp_replace(v, '[?#].*$', '');       -- tracking params / fragment
  v := regexp_replace(v, '[\s-]+', '', 'g');
  v := translate(v, 'OIL', '011');
  if length(v) <> 13 or v !~ '^[0-9A-HJKMNP-TV-Z]{13}$' or not public.luhn32_valid(v) then
    return null;
  end if;
  return left(v, 12);
end $$;

create or replace function public.code13(p_code12 text) returns text
language sql immutable strict set search_path = public, pg_temp as $$
  select p_code12 || public.luhn32_check_char(p_code12);
$$;

create or replace function public.display_code(p_code13 text) returns text
language sql immutable strict set search_path = public, pg_temp as $$
  select concat_ws('-', substr(p_code13, 1, 4), substr(p_code13, 5, 4), substr(p_code13, 9, 4), nullif(substr(p_code13, 13), ''));
$$;

-- §8.2: each random byte masked to 5 bits ⇒ each character uniform.
create or replace function public.gen_code12() returns text
language sql volatile set search_path = public, pg_temp as $$
  select string_agg(substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', (get_byte(r.b, i) & 31) + 1, 1), '' order by i)
  from (select extensions.gen_random_bytes(12) as b) r, generate_series(0, 11) as i;
$$;

-- Painter token: 6 Crockford characters with at least one digit (ADR-0003).
create or replace function public.gen_token6() returns text
language plpgsql volatile set search_path = public, pg_temp as $$
declare v text;
begin
  loop
    select string_agg(substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', (get_byte(r.b, i) & 31) + 1, 1), '' order by i)
      into v
      from (select extensions.gen_random_bytes(6) as b) r, generate_series(0, 5) as i;
    exit when v ~ '[0-9]';
  end loop;
  return v;
end $$;

-- ── Phones ─────────────────────────────────────────────────────────────────
create or replace function public.mask_phone(p_e164 text) returns text
language sql immutable strict set search_path = public, pg_temp as $$
  select case
    when p_e164 ~ '^\+91[6-9][0-9]{9}$' then '+91 ' || substr(p_e164, 4, 2) || '•••• ' || right(p_e164, 4)
    when p_e164 ~ '^\+[0-9]{6,}$' then '+' || substr(p_e164, 2, 2) || ' •••• ' || right(p_e164, 4)
    else p_e164   -- already masked or unrecognised: never reveal more than we got
  end;
$$;

create or replace function public.phone_hash(p_e164 text) returns bytea
language sql stable security definer set search_path = public, pg_temp as $$
  select extensions.hmac(convert_to(p_e164, 'UTF8'), s.value, 'sha256')
  from private.secret s where s.name = 'painter_phone_salt';
$$;

create or replace function public.ip_hash(p_ip text) returns bytea
language sql stable security definer set search_path = public, pg_temp as $$
  select extensions.hmac(convert_to(coalesce(p_ip, 'unknown'), 'UTF8'), s.value, 'sha256')
  from private.secret s where s.name = 'painter_phone_salt';
$$;

-- Client IP as seen by PostgREST (Cloudflare → Supabase).
create or replace function public.request_ip() returns text
language plpgsql stable set search_path = public, pg_temp as $$
declare h jsonb;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    h := null;
  end;
  return coalesce(h ->> 'cf-connecting-ip', split_part(h ->> 'x-forwarded-for', ',', 1), 'unknown');
end $$;

-- ── Identity ───────────────────────────────────────────────────────────────
create or replace function public.jwt_claim(p_name text) returns text
language sql stable set search_path = public, pg_temp as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> p_name;
$$;

-- The calling app_user (any status) or null.
create or replace function public.me() returns public.app_user
language sql stable security definer set search_path = public, pg_temp as $$
  select u.* from public.app_user u where u.auth_user_id = auth.uid();
$$;

-- §12.6: every function starts with this. Raises PT401/PT403 (PostgREST maps to HTTP status).
create or replace function public.assert_role(p_roles text[]) returns public.app_user
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u public.app_user;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'PT401';
  end if;
  select * into u from public.app_user where auth_user_id = auth.uid();
  if not found then
    raise exception 'AUTH_REQUIRED' using errcode = 'PT401';
  end if;
  if u.status <> 'ACTIVE' or not (u.role = any (p_roles)) then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if u.role like 'M24_%' and coalesce(public.jwt_claim('aal'), '') <> 'aal2' then
    raise exception 'MFA_REQUIRED' using errcode = 'PT403';
  end if;
  return u;
end $$;

-- RLS helpers: return null unless the caller is an ACTIVE app_user (and aal2 for 24M).
create or replace function public.rls_user() returns public.app_user
language sql stable security definer set search_path = public, pg_temp as $$
  select u.* from public.app_user u
  where u.auth_user_id = auth.uid() and u.status = 'ACTIVE'
    and (u.role not like 'M24_%' or coalesce(public.jwt_claim('aal'), '') = 'aal2');
$$;

create or replace function public.rls_role() returns text
language sql stable set search_path = public, pg_temp as $$ select (public.rls_user()).role; $$;

create or replace function public.rls_user_id() returns bigint
language sql stable set search_path = public, pg_temp as $$ select (public.rls_user()).id; $$;

create or replace function public.rls_dealer_id() returns int
language sql stable set search_path = public, pg_temp as $$ select (public.rls_user()).dealer_id; $$;

create or replace function public.rls_distributor_id() returns int
language sql stable set search_path = public, pg_temp as $$ select (public.rls_user()).distributor_id; $$;

create or replace function public.rls_is_m24() returns boolean
language sql stable set search_path = public, pg_temp as $$
  select coalesce(public.rls_role() like 'M24_%', false);
$$;

-- ── Logging ────────────────────────────────────────────────────────────────
create or replace function public.log_event(p_coupon bigint, p_event text, p_from text, p_to text, p_user bigint, p_ref text default null)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.coupon_event (coupon_id, event, from_status, to_status, user_id, ref, at)
  values (p_coupon, p_event, p_from, p_to, p_user, p_ref, public.app_now());
$$;

create or replace function public.log_scan(p_user bigint, p_coupon bigint, p_dealer int, p_result text, p_hint text default null)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.scan_attempt (user_id, coupon_id, dealer_id, result, code_hint, at)
  values (p_user, p_coupon, p_dealer, p_result, left(p_hint, 20), public.app_now());
$$;

create or replace function public.log_admin(p_user bigint, p_action text, p_target text, p_reason text default null, p_details jsonb default '{}')
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.admin_log (user_id, action, target, reason, details, at)
  values (p_user, p_action, p_target, p_reason, coalesce(p_details, '{}'), public.app_now());
$$;

-- Typed business error (PT409 → HTTP 409) with a machine-readable code.
create or replace function public.fail(p_code text, p_detail text default null) returns void
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception '%', p_code using errcode = 'PT409', detail = coalesce(p_detail, '');
end $$;

create trigger wa_inbound_guard before update or delete on public.wa_inbound
  for each row execute function public.wa_inbound_guard();
create trigger wa_inbound_no_truncate before truncate on public.wa_inbound
  for each statement execute function public.forbid_change();
