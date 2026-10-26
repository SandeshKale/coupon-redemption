-- 0006: masters, users and coupon lots (§5.1, §13).

-- ── Masters ────────────────────────────────────────────────────────────────
create or replace function public.upsert_distributor(p_code text, p_name text, p_mobile text, p_city text, p_status text default 'ACTIVE')
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['M24_ADMIN']); v_id int;
begin
  insert into public.distributor (code, name, mobile_e164, city, status)
  values (upper(p_code), p_name, p_mobile, p_city, p_status)
  on conflict (code) do update set name = excluded.name, mobile_e164 = excluded.mobile_e164,
    city = excluded.city, status = excluded.status
  returning id into v_id;
  perform public.log_admin(u.id, 'UPSERT_DISTRIBUTOR', 'distributor:' || v_id);
  return v_id;
end $$;

-- 24M admins manage any dealer; distributors manage dealers under themselves (D5).
create or replace function public.upsert_dealer(p_code text, p_name text, p_mobile text, p_city text, p_distributor_id int)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u public.app_user := public.assert_role(array['M24_ADMIN', 'DISTRIBUTOR']);
  v_id int; v_existing public.dealer;
begin
  if u.role = 'DISTRIBUTOR' and p_distributor_id is distinct from u.distributor_id then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if not exists (select 1 from public.distributor where id = p_distributor_id and status = 'ACTIVE') then
    perform public.fail('DISTRIBUTOR_INACTIVE');
  end if;
  if exists (select 1 from public.dealer where mobile_e164 = p_mobile and code <> upper(p_code)) then
    perform public.fail('DUPLICATE_MOBILE');                                   -- EC-131
  end if;
  select * into v_existing from public.dealer where code = upper(p_code);
  if found then
    if u.role = 'DISTRIBUTOR' and v_existing.distributor_id <> u.distributor_id then
      raise exception 'FORBIDDEN' using errcode = 'PT403';
    end if;
    if v_existing.distributor_id <> p_distributor_id then
      perform public.fail('USE_REASSIGN_DEALER');
    end if;
    update public.dealer set name = p_name, mobile_e164 = p_mobile, city = p_city where id = v_existing.id;
    v_id := v_existing.id;
  else
    insert into public.dealer (code, name, mobile_e164, city, distributor_id)
    values (upper(p_code), p_name, p_mobile, p_city, p_distributor_id) returning id into v_id;
    insert into public.dealer_distributor_history (dealer_id, from_distributor_id, to_distributor_id, changed_by, changed_at)
    values (v_id, null, p_distributor_id, u.id, public.app_now());
  end if;
  perform public.log_admin(u.id, 'UPSERT_DEALER', 'dealer:' || v_id);
  return v_id;
end $$;

-- EC-132: history row; the old open claim is submitted so new redemptions route to the new distributor.
create or replace function public.reassign_dealer(p_dealer_id int, p_distributor_id int, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['M24_ADMIN']); d public.dealer;
begin
  select * into d from public.dealer where id = p_dealer_id for update;
  if not found then perform public.fail('NOT_FOUND'); end if;
  if d.distributor_id = p_distributor_id then return; end if;
  if not exists (select 1 from public.distributor where id = p_distributor_id and status = 'ACTIVE') then
    perform public.fail('DISTRIBUTOR_INACTIVE');
  end if;
  update public.dealer_claim set status = 'SUBMITTED', submitted_at = public.app_now(), submitted_by = u.id
   where dealer_id = d.id and status = 'OPEN' and exists (select 1 from public.dealer_claim_line l where l.claim_id = dealer_claim.id);
  delete from public.dealer_claim c where c.dealer_id = d.id and c.status = 'OPEN'
    and not exists (select 1 from public.dealer_claim_line l where l.claim_id = c.id);
  update public.dealer set distributor_id = p_distributor_id where id = d.id;
  insert into public.dealer_distributor_history (dealer_id, from_distributor_id, to_distributor_id, changed_by, changed_at)
  values (d.id, d.distributor_id, p_distributor_id, u.id, public.app_now());
  perform public.log_admin(u.id, 'REASSIGN_DEALER', 'dealer:' || d.id, p_reason,
    jsonb_build_object('from', d.distributor_id, 'to', p_distributor_id));
end $$;

create or replace function public.set_dealer_status(p_dealer_id int, p_status text, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['M24_ADMIN', 'DISTRIBUTOR']);
begin
  if coalesce(p_status, '') not in ('ACTIVE', 'INACTIVE', 'BLOCKED') then perform public.fail('BAD_REQUEST'); end if;
  if u.role = 'DISTRIBUTOR' and (p_status = 'BLOCKED' or not exists (
       select 1 from public.dealer where id = p_dealer_id and distributor_id = u.distributor_id)) then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  update public.dealer set status = p_status where id = p_dealer_id;
  if not found then perform public.fail('NOT_FOUND'); end if;
  perform public.log_admin(u.id, 'SET_DEALER_STATUS', 'dealer:' || p_dealer_id, p_reason, jsonb_build_object('status', p_status));
end $$;

create or replace function public.upsert_sku(p_code text, p_name text, p_active boolean default true)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['M24_ADMIN']);
begin
  insert into public.sku (code, name, active) values (upper(p_code), p_name, p_active)
  on conflict (code) do update set name = excluded.name, active = excluded.active;
  perform public.log_admin(u.id, 'UPSERT_SKU', 'sku:' || upper(p_code));
end $$;

-- Bulk master upload (§14 bulk-upload). Dry run returns the validation report only.
create or replace function public.bulk_upsert_dealers(p_rows jsonb, p_dry_run boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u public.app_user := public.assert_role(array['M24_ADMIN']);
  r jsonb; i int := 0; v_errors jsonb := '[]'::jsonb; v_dist int; v_seen_codes text[] := '{}'::text[]; v_seen_mobiles text[] := '{}'::text[];
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 5000 then
    perform public.fail('BAD_REQUEST');
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    select id into v_dist from public.distributor where code = upper(r ->> 'distributor_code') and status = 'ACTIVE';
    if v_dist is null then
      v_errors := v_errors || jsonb_build_object('row', i, 'error', 'UNKNOWN_DISTRIBUTOR');
    end if;
    if coalesce(r ->> 'code', '') !~ '^[A-Za-z0-9-]{2,20}$' then
      v_errors := v_errors || jsonb_build_object('row', i, 'error', 'BAD_CODE');
    end if;
    if coalesce(r ->> 'mobile_e164', '') !~ '^\+[1-9][0-9]{7,14}$' then
      v_errors := v_errors || jsonb_build_object('row', i, 'error', 'BAD_MOBILE');
    elsif (r ->> 'mobile_e164') = any (v_seen_mobiles) or exists (
      select 1 from public.dealer where mobile_e164 = r ->> 'mobile_e164' and code <> upper(r ->> 'code')) then
      v_errors := v_errors || jsonb_build_object('row', i, 'error', 'DUPLICATE_MOBILE');
    end if;
    if upper(r ->> 'code') = any (v_seen_codes) then
      v_errors := v_errors || jsonb_build_object('row', i, 'error', 'DUPLICATE_CODE');
    end if;
    if length(coalesce(r ->> 'name', '')) < 2 then
      v_errors := v_errors || jsonb_build_object('row', i, 'error', 'BAD_NAME');
    end if;
    v_seen_codes := v_seen_codes || upper(r ->> 'code');
    v_seen_mobiles := v_seen_mobiles || (r ->> 'mobile_e164');
  end loop;

  if p_dry_run or jsonb_array_length(v_errors) > 0 then
    return jsonb_build_object('ok', jsonb_array_length(v_errors) = 0, 'rows', i, 'errors', v_errors, 'committed', false);
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    perform public.upsert_dealer(r ->> 'code', r ->> 'name', r ->> 'mobile_e164', r ->> 'city',
      (select id from public.distributor where code = upper(r ->> 'distributor_code')));
  end loop;
  perform public.log_admin(u.id, 'BULK_UPSERT_DEALERS', null, null, jsonb_build_object('rows', i));
  return jsonb_build_object('ok', true, 'rows', i, 'errors', '[]'::jsonb, 'committed', true);
end $$;

-- ── Users ──────────────────────────────────────────────────────────────────
-- Who may manage a target user (used by admin Edge Functions before calling the Auth admin API).
create or replace function public.can_manage_user(p_role text, p_dealer_id int, p_distributor_id int)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['M24_ADMIN', 'DISTRIBUTOR']);
begin
  if u.role = 'M24_ADMIN' then return true; end if;
  return p_role in ('DEALER_OWNER', 'DEALER_STAFF') and p_distributor_id is null
    and exists (select 1 from public.dealer where id = p_dealer_id and distributor_id = u.distributor_id);
end $$;

create or replace function public.assert_can_manage_user(p_role text, p_dealer_id int, p_distributor_id int)
returns public.app_user language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['M24_ADMIN', 'DISTRIBUTOR']);
begin
  if not public.can_manage_user(p_role, p_dealer_id, p_distributor_id) then  -- EC-136
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  return u;
end $$;

-- Validates a planned user before the Edge Function creates the Auth user (no side effects).
create or replace function public.precheck_new_user(p_name text, p_mobile text, p_role text, p_dealer_id int, p_distributor_id int)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_can_manage_user(p_role, p_dealer_id, p_distributor_id);
begin
  if p_role not in ('DEALER_STAFF', 'DEALER_OWNER', 'DISTRIBUTOR', 'M24_ADMIN', 'M24_FINANCE', 'M24_VIEWER') then
    perform public.fail('BAD_ROLE');
  end if;
  if length(coalesce(btrim(p_name), '')) < 2 then perform public.fail('BAD_NAME'); end if;
  if p_mobile is not null and exists (select 1 from public.app_user where mobile_e164 = p_mobile and status = 'ACTIVE') then
    perform public.fail('DUPLICATE_MOBILE');
  end if;
  return jsonb_build_object('ok', true, 'created_by', u.id,
    'email_domain', public.cfg_text('internal_email_domain'));
end $$;

-- Service role only: called by admin-create-user after the Auth user exists.
create or replace function public.register_app_user(p_auth_user_id uuid, p_name text, p_mobile text, p_email text,
  p_role text, p_dealer_id int, p_distributor_id int, p_created_by bigint, p_request_id bigint default null)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id bigint;
begin
  insert into public.app_user (auth_user_id, name, mobile_e164, email, role, dealer_id, distributor_id, created_by)
  values (p_auth_user_id, p_name, p_mobile, p_email, p_role, p_dealer_id, p_distributor_id, p_created_by)
  returning id into v_id;
  if p_request_id is not null then
    update public.user_request set status = 'DONE', decided_by = p_created_by, decided_at = public.app_now(), target_user_id = v_id
     where id = p_request_id and status = 'PENDING';
  end if;
  perform public.log_admin(p_created_by, 'CREATE_USER', 'app_user:' || v_id, null, jsonb_build_object('role', p_role));
  return v_id;
end $$;

-- Service role only: the Edge Function stores the internal email once the id is known.
create or replace function public.set_app_user_email(p_user_id bigint, p_email text)
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.app_user set email = p_email where id = p_user_id;
$$;

-- Returns what the login-link Edge Function needs after checking the caller may manage the target.
create or replace function public.login_link_target(p_user_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare t public.app_user; u public.app_user;
begin
  perform public.assert_role(array['M24_ADMIN', 'DISTRIBUTOR']);   -- before any lookup: no existence oracle
  select * into t from public.app_user where id = p_user_id;
  if not found then perform public.fail('NOT_FOUND'); end if;
  u := public.assert_can_manage_user(t.role, t.dealer_id, t.distributor_id);
  if t.status <> 'ACTIVE' then perform public.fail('USER_INACTIVE'); end if;
  if t.role like 'M24_%' then perform public.fail('USE_PASSWORD_LOGIN'); end if;
  return jsonb_build_object('user_id', t.id, 'auth_user_id', t.auth_user_id, 'email', t.email,
    'mobile_e164', t.mobile_e164, 'name', t.name, 'issued_by', u.id);
end $$;

create or replace function public.record_login_link_issued(p_user_id bigint, p_issued_by bigint)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.user_request set status = 'DONE', decided_by = p_issued_by, decided_at = public.app_now()
   where kind = 'LOGIN_LINK' and target_user_id = p_user_id and status = 'PENDING';
  perform public.log_admin(p_issued_by, 'LOGIN_LINK_ISSUED', 'app_user:' || p_user_id);
end $$;

-- Activation/deactivation (§10.1 revocation). The Edge Function also bans/unbans the Auth user.
create or replace function public.set_user_status(p_user_id bigint, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u public.app_user := public.assert_role(array['M24_ADMIN', 'DISTRIBUTOR', 'DEALER_OWNER']);
  t public.app_user;
begin
  if coalesce(p_status, '') not in ('ACTIVE', 'INACTIVE') then perform public.fail('BAD_REQUEST'); end if;
  select * into t from public.app_user where id = p_user_id for update;
  if not found then perform public.fail('NOT_FOUND'); end if;
  if t.id = u.id then perform public.fail('CANNOT_CHANGE_SELF'); end if;
  if u.role = 'DEALER_OWNER' then
    if t.role <> 'DEALER_STAFF' or t.dealer_id <> u.dealer_id then
      raise exception 'FORBIDDEN' using errcode = 'PT403';
    end if;
  elsif u.role = 'DISTRIBUTOR' then
    perform public.assert_can_manage_user(t.role, t.dealer_id, t.distributor_id);
  end if;
  update public.app_user set status = p_status where id = t.id;
  perform public.log_admin(u.id, 'SET_USER_STATUS', 'app_user:' || t.id, p_reason, jsonb_build_object('status', p_status));
  return jsonb_build_object('auth_user_id', t.auth_user_id, 'status', p_status);
end $$;

-- Dealer owner asks the distributor to add a staff login (§14).
create or replace function public.request_staff(p_name text, p_mobile text)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['DEALER_OWNER']); v_id bigint;
begin
  if p_mobile !~ '^\+[1-9][0-9]{7,14}$' or length(coalesce(p_name, '')) < 2 then
    perform public.fail('BAD_REQUEST');
  end if;
  if exists (select 1 from public.app_user where mobile_e164 = p_mobile and status = 'ACTIVE') then
    perform public.fail('DUPLICATE_MOBILE');
  end if;
  insert into public.user_request (kind, requested_by, name, mobile_e164, dealer_id, distributor_id)
  select 'NEW_STAFF', u.id, p_name, p_mobile, d.id, d.distributor_id from public.dealer d where d.id = u.dealer_id
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.reject_user_request(p_request_id bigint)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['M24_ADMIN', 'DISTRIBUTOR']);
begin
  update public.user_request set status = 'REJECTED', decided_by = u.id, decided_at = public.app_now()
   where id = p_request_id and status = 'PENDING'
     and (u.role = 'M24_ADMIN' or distributor_id = u.distributor_id);
  if not found then perform public.fail('NOT_FOUND'); end if;
end $$;

-- Service role only (login-link-request Edge Function): logged-out "Request new link" (§10.1 step 4).
-- Always returns the same answer so the endpoint cannot be used to discover registered numbers.
create or replace function public.record_login_link_request(p_mobile text, p_ip text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_lim jsonb := public.cfg('login_link_request_limit');
  v_hash bytea := public.ip_hash(p_ip);
  t public.app_user;
begin
  if (select count(*) from public.login_link_attempt
       where ip_hash = v_hash and at > public.app_now() - make_interval(mins => (v_lim ->> 'minutes')::int))
     >= (v_lim ->> 'count')::int then
    return jsonb_build_object('result', 'RATE_LIMITED');
  end if;
  insert into public.login_link_attempt (ip_hash, at) values (v_hash, public.app_now());
  select * into t from public.app_user where mobile_e164 = p_mobile and status = 'ACTIVE' and role not like 'M24_%';
  if found and not exists (select 1 from public.user_request where kind = 'LOGIN_LINK' and target_user_id = t.id and status = 'PENDING') then
    insert into public.user_request (kind, target_user_id, name, mobile_e164, dealer_id, distributor_id)
    values ('LOGIN_LINK', t.id, t.name, t.mobile_e164, t.dealer_id,
            coalesce(t.distributor_id, (select distributor_id from public.dealer where id = t.dealer_id)));
  end if;
  return jsonb_build_object('result', 'RECEIVED');
end $$;

-- ── Lots (§5.1, §8.2) ─────────────────────────────────────────────────────
create or replace function public.create_lot(p_lot_no text, p_quantity int, p_value_paise bigint, p_sku text, p_serial_prefix text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u public.app_user := public.assert_role(array['M24_ADMIN']);
  v_from bigint; v_id int;
begin
  if p_quantity is null or p_quantity < 1 or p_quantity > 200000 then perform public.fail('BAD_QUANTITY'); end if;
  insert into public.serial_counter (prefix) values (upper(p_serial_prefix)) on conflict do nothing;
  update public.serial_counter set last_value = last_value + p_quantity
   where prefix = upper(p_serial_prefix) returning last_value - p_quantity + 1 into v_from;
  insert into public.coupon_lot (lot_no, quantity, value_paise, intended_sku, serial_prefix, serial_from, serial_to, created_by, created_at)
  values (upper(p_lot_no), p_quantity, p_value_paise, upper(p_sku), upper(p_serial_prefix), v_from, v_from + p_quantity - 1, u.id, public.app_now())
  returning id into v_id;
  perform public.log_admin(u.id, 'CREATE_LOT', 'lot:' || v_id, null,
    jsonb_build_object('quantity', p_quantity, 'value_paise', p_value_paise));
  return jsonb_build_object('lot_id', v_id, 'serial_from', v_from, 'serial_to', v_from + p_quantity - 1);
end $$;

-- Generates up to p_max codes per call (keeps each call inside the API statement timeout).
-- Codes colliding with existing ones are retried until every serial in the lot has a code (EC-014).
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
    select l.id, s, l.serial_prefix || '-' || lpad(s::text, 7, '0'), public.gen_code12(), l.value_paise, l.intended_sku
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

-- Print export (export-print-file Edge Function). A second export needs a reason (EC-015).
create or replace function public.begin_lot_export(p_lot_id int, p_reason text default null)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['M24_ADMIN']); l public.coupon_lot; v_id bigint;
begin
  select * into l from public.coupon_lot where id = p_lot_id for update;
  if not found then perform public.fail('NOT_FOUND'); end if;
  if l.status = 'GENERATING' then perform public.fail('LOT_NOT_GENERATED'); end if;
  if l.export_count > 0 and length(coalesce(btrim(p_reason), '')) < 5 then perform public.fail('REASON_REQUIRED'); end if;
  insert into public.coupon_lot_export (lot_id, exported_by, reason, started_at)
  values (l.id, u.id, p_reason, public.app_now()) returning id into v_id;
  perform public.log_admin(u.id, 'EXPORT_LOT_START', 'lot:' || l.id, p_reason, jsonb_build_object('export_id', v_id));
  return v_id;
end $$;

-- Service role only: pages of the print file, keyset-paginated by serial.
create or replace function public.export_lot_page(p_export_id bigint, p_after_serial bigint, p_limit int)
returns table (serial_no bigint, serial text, code13 text, display_code text)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.serial_no, c.serial, public.code13(c.code), public.display_code(public.code13(c.code))
    from public.coupon_lot_export e join public.coupon c on c.lot_id = e.lot_id
   where e.id = p_export_id and e.finished_at is null and c.serial_no > coalesce(p_after_serial, 0)
   order by c.serial_no
   limit least(greatest(p_limit, 1), 10000);
$$;

create or replace function public.finish_lot_export(p_export_id bigint, p_rows int, p_sha256 text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare e public.coupon_lot_export;
begin
  update public.coupon_lot_export set finished_at = public.app_now(), row_count = p_rows, sha256 = p_sha256
   where id = p_export_id and finished_at is null returning * into e;
  if not found then perform public.fail('NOT_FOUND'); end if;
  update public.coupon_lot set status = 'EXPORTED', export_count = export_count + 1, last_export_sha256 = p_sha256
   where id = e.lot_id;
  perform public.log_admin(e.exported_by, 'EXPORT_LOT_DONE', 'lot:' || e.lot_id, e.reason,
    jsonb_build_object('rows', p_rows, 'sha256', p_sha256));
end $$;

-- Spoiled prints → VOID. Returns the lot reconciliation (printed eligible + void = quantity).
create or replace function public.void_serials(p_lot_id int, p_serials text[], p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['M24_ADMIN']); v_count int; v_unknown text[];
begin
  if not exists (select 1 from public.coupon_lot where id = p_lot_id and status = 'EXPORTED') then
    perform public.fail('LOT_NOT_EXPORTED');
  end if;
  select array_agg(s) into v_unknown from unnest(p_serials) s
   where not exists (select 1 from public.coupon c where c.lot_id = p_lot_id and c.serial = upper(s) and c.status = 'GENERATED');
  if v_unknown is not null then
    perform public.fail('SERIALS_NOT_VOIDABLE', array_to_string(v_unknown[1:20], ','));
  end if;
  with v as (
    update public.coupon set status = 'VOID', status_reason = p_reason
     where lot_id = p_lot_id and serial = any (select upper(s) from unnest(p_serials) s) and status = 'GENERATED'
    returning id
  ), e as (
    insert into public.coupon_event (coupon_id, event, from_status, to_status, user_id, ref, at)
    select id, 'VOIDED', 'GENERATED', 'VOID', u.id, p_reason, public.app_now() from v returning 1
  ) select count(*) into v_count from e;
  perform public.log_admin(u.id, 'VOID_SERIALS', 'lot:' || p_lot_id, p_reason, jsonb_build_object('count', v_count));
  return public.lot_reconciliation(p_lot_id) || jsonb_build_object('voided_now', v_count);
end $$;

create or replace function public.lot_reconciliation(p_lot_id int)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare l public.coupon_lot; v jsonb;
begin
  perform public.assert_role(array['M24_ADMIN', 'M24_FINANCE', 'M24_VIEWER']);
  select * into l from public.coupon_lot where id = p_lot_id;
  if not found then perform public.fail('NOT_FOUND'); end if;
  select jsonb_build_object(
      'quantity', l.quantity,
      'void', count(*) filter (where status = 'VOID'),
      'eligible', count(*) filter (where status <> 'VOID'),
      'active', count(*) filter (where status = 'ACTIVE'),
      'balanced', count(*) = l.quantity)
    into v from public.coupon where lot_id = l.id;
  return v;
end $$;

-- Batch release: GENERATED → ACTIVE for a serial range with SKU, batch and mfg date (§5.1 step 4).
create or replace function public.activate_range(p_lot_id int, p_serial_from bigint, p_serial_to bigint,
  p_sku text, p_batch_no text, p_mfg_date date)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u public.app_user := public.assert_role(array['M24_ADMIN']);
  l public.coupon_lot; v_count int; v_skipped int; v_expires timestamptz;
begin
  select * into l from public.coupon_lot where id = p_lot_id;
  if not found then perform public.fail('NOT_FOUND'); end if;
  if l.status <> 'EXPORTED' then perform public.fail('LOT_NOT_EXPORTED'); end if;
  if p_serial_from > p_serial_to or p_serial_from < l.serial_from or p_serial_to > l.serial_to then
    perform public.fail('BAD_RANGE');
  end if;
  if p_mfg_date is null or p_mfg_date > public.ist_date(public.app_now()) then perform public.fail('BAD_MFG_DATE'); end if;
  if not exists (select 1 from public.sku where code = upper(p_sku) and active) then perform public.fail('UNKNOWN_SKU'); end if;
  -- Expiry at the end of the validity day in IST.
  v_expires := ((p_mfg_date + make_interval(months => public.cfg_int('coupon_validity_months')))::timestamp
                + interval '1 day') at time zone 'Asia/Kolkata';
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

-- Recall: ACTIVE → BLOCKED for a serial range (§26.8).
create or replace function public.block_range(p_lot_id int, p_serial_from bigint, p_serial_to bigint, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['M24_ADMIN']); v_count int;
begin
  if length(coalesce(btrim(p_reason), '')) < 5 then perform public.fail('REASON_REQUIRED'); end if;
  with b as (
    update public.coupon set status = 'BLOCKED', status_reason = p_reason
     where lot_id = p_lot_id and serial_no between p_serial_from and p_serial_to and status = 'ACTIVE'
    returning id
  ), e as (
    insert into public.coupon_event (coupon_id, event, from_status, to_status, user_id, ref, at)
    select id, 'BLOCKED', 'ACTIVE', 'BLOCKED', u.id, p_reason, public.app_now() from b returning 1
  ) select count(*) into v_count from e;
  perform public.log_admin(u.id, 'BLOCK_RANGE', 'lot:' || p_lot_id, p_reason,
    jsonb_build_object('from', p_serial_from, 'to', p_serial_to, 'blocked', v_count));
  return jsonb_build_object('blocked', v_count);
end $$;
