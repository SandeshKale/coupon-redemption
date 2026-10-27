-- Test-only helpers (never applied to staging/production).
-- Pattern: pgTAP assertions always run as the owner; the code under test runs as an API role
-- inside tests.call()/tests.rows(), which capture either the result or the SQLSTATE.
create schema if not exists tests;

create or replace function tests.become(p_who text, p_aal text default null) returns void language plpgsql as $$
declare v_uid uuid; v_role text;
begin
  if p_who = 'anon' then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    execute 'set local role anon';
  elsif p_who = 'service' then
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    execute 'set local role service_role';
  else
    if p_who ~ '^[0-9a-f-]{36}$' then
      v_uid := p_who::uuid;
      select role into v_role from public.app_user where auth_user_id = v_uid;
    else
      select auth_user_id, role into v_uid, v_role from public.app_user where name = p_who;
      if v_uid is null then raise exception 'tests.become: unknown user %', p_who; end if;
    end if;
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated',
      'aal', coalesce(p_aal, case when v_role like 'M24_%' then 'aal2' else 'aal1' end))::text, true);
    execute 'set local role authenticated';
  end if;
end $$;

create or replace function tests.unbecome() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Evaluates a scalar SQL expression as p_who. Returns to_jsonb(result) or {"error": sqlstate, "msg": message}.
create or replace function tests.call(p_who text, p_expr text, p_aal text default null) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  begin
    perform tests.become(p_who, p_aal);
    execute 'select to_jsonb((' || p_expr || '))' into v;
    perform tests.unbecome();
    return coalesce(v, 'null'::jsonb);
  exception when others then
    perform tests.unbecome();
    return jsonb_build_object('error', sqlstate, 'msg', sqlerrm);
  end;
end $$;

-- Row count of a query as p_who, or -1 when the query raises (e.g. permission denied).
create or replace function tests.rows(p_who text, p_query text, p_aal text default null) returns bigint language plpgsql as $$
declare v bigint;
begin
  begin
    perform tests.become(p_who, p_aal);
    execute 'select count(*) from (' || p_query || ') q' into v;
    perform tests.unbecome();
    return v;
  exception when others then
    perform tests.unbecome();
    return -1;
  end;
end $$;

-- SQLSTATE (or 'OK') of running p_expr as p_who.
create or replace function tests.state(p_who text, p_expr text, p_aal text default null) returns text language sql as $$
  select coalesce(tests.call(p_who, p_expr, p_aal) ->> 'error', 'OK');
$$;

-- Error message (or 'OK').
create or replace function tests.err(p_who text, p_expr text, p_aal text default null) returns text language sql as $$
  select coalesce(tests.call(p_who, p_expr, p_aal) ->> 'msg', 'OK');
$$;

create or replace function tests.freeze(p_ts timestamptz) returns void language sql as $$
  select set_config('app.now', p_ts::text, true);
$$;

create or replace function tests.thaw() returns void language sql as $$
  select set_config('app.now', '', true);
$$;

create or replace function tests.code13(p_serial text) returns text language sql stable as $$
  select public.code13(code) from public.coupon where serial = p_serial;
$$;

create or replace function tests.serial(n int) returns text language sql immutable as $$
  select 'P24-' || lpad(n::text, 7, '0');
$$;

create or replace function tests.status(p_serial text) returns text language sql stable as $$
  select status from public.coupon where serial = p_serial;
$$;

-- Redeems serials as a dealer user and returns the response.
create or replace function tests.redeem(p_who text, p_serials int[]) returns jsonb language sql as $$
  select tests.call(p_who, format('public.redeem(%L::text[], %L::uuid)',
    (select array_agg(tests.code13(tests.serial(s))) from unnest(p_serials) s), gen_random_uuid()));
$$;

-- Simulates an inbound painter WhatsApp message through the service-role entry point.
create or replace function tests.wa(p_from text, p_intent text, p_token text default null, p_body text default null,
  p_ts timestamptz default null, p_wamid text default null) returns jsonb language sql as $$
  select tests.call('service', format('public.wa_handle_inbound(%L, %L, %L, %L, %L::timestamptz, %L, %L)',
    coalesce(p_wamid, 'wamid.' || gen_random_uuid()), p_from, coalesce(p_body, p_token, p_intent), 'text',
    coalesce(p_ts, public.app_now()), p_intent, p_token));
$$;

create or replace function tests.token(p_batch bigint) returns text language sql stable as $$
  select token from public.painter_confirmation where batch_id = p_batch;
$$;

grant usage on schema tests to anon, authenticated, service_role;
grant execute on all functions in schema tests to anon, authenticated, service_role;

create or replace function tests.flags(p_batch bigint) returns text[] language sql stable as $$
  select flags from public.painter_confirmation where batch_id = p_batch;
$$;
grant execute on function tests.flags(bigint) to anon, authenticated, service_role;

create or replace function tests.today() returns date language sql stable security definer set search_path = public, pg_temp as $$
  select public.ist_date(public.app_now());
$$;
grant execute on function tests.today() to anon, authenticated, service_role;

-- Sets JWT claims for p_who without switching role (to unit-test internal helpers as owner).
create or replace function tests.claims(p_who text, p_aal text default 'aal1') returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', auth_user_id, 'aal', p_aal)::text, true)
    from public.app_user where name = p_who;
$$;

-- Production ships with painter confirmation off (migration 0015). The suites that cover the dormant
-- painter/WhatsApp feature run with it on; 093_two_option_flow.test.sql covers the shipped default.
update public.app_config set value = 'true' where key = 'painter_confirmation_enabled';
