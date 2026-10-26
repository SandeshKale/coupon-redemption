-- §12 database security: RLS everywhere, grants allow-list, anon surface, add-only tables.
begin;
select plan(19);

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0, 'RLS is enabled on every table in public');

select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')),
  array['public_coupon_info'], 'anon can execute only public_coupon_info (§12.3)');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')),
  0, 'no API role holds a write privilege on any table');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'anon'),
  0, 'anon holds no table privileges at all');

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'v') and has_table_privilege('anon', c.oid, 'select')),
  0, 'EC-150 anon cannot select from any table or view');

select ok(not has_column_privilege('authenticated', 'public.coupon', 'code', 'select'),
  'authenticated users can never read redeemable codes');
select ok(not has_column_privilege('authenticated', 'public.painter', 'phone_e164', 'select'),
  'full painter numbers are not readable through the table (§6.9)');
select ok(not has_column_privilege('authenticated', 'public.painter', 'phone_hash', 'select'),
  'painter phone hashes are not readable');
select ok(not has_schema_privilege('authenticated', 'private', 'usage') and not has_schema_privilege('anon', 'private', 'usage'),
  'private schema (secrets) is not usable by API roles');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')),
  0, 'every security definer function pins search_path');

select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('service_role', p.oid, 'execute')
      and not has_function_privilege('authenticated', p.oid, 'execute')),
  array['export_lot_page', 'finish_lot_export', 'job_cleanup', 'job_expire_coupons', 'job_expire_painter_tokens',
        'job_submit_dealer_claims', 'record_login_link_issued', 'record_login_link_request', 'register_app_user',
        'run_reconciliation', 'set_app_user_email', 'wa_claim_outbox', 'wa_handle_inbound', 'wa_mark_failed',
        'wa_mark_sent', 'wa_record_error'],
  'service-role-only functions are exactly the Edge Function / job entry points');

select ok(not has_function_privilege('authenticated', 'public.wa_handle_inbound(text,text,text,text,timestamptz,text,text)', 'execute'),
  'dealers cannot call the WhatsApp entry point');

-- EC-158: add-only tables reject update/delete even for the owner (triggers fire for every role).
insert into public.admin_log (action) values ('test');
select throws_ok($$update public.admin_log set action = 'x'$$, 'P0001', null, 'admin_log rejects update');
select throws_ok($$delete from public.admin_log$$, 'P0001', null, 'admin_log rejects delete');
insert into public.coupon_event (coupon_id, event) select id, 'TEST' from public.coupon limit 1;
select throws_ok($$delete from public.coupon_event$$, 'P0001', null, 'coupon_event rejects delete');
insert into public.scan_attempt (result) values ('TEST');
select throws_ok($$update public.scan_attempt set result = 'X'$$, 'P0001', null, 'scan_attempt rejects update');
select throws_ok($$truncate public.coupon_event$$, 'P0001', null, 'coupon_event rejects truncate');
select throws_ok($$delete from public.coupon$$, 'P0001', null, 'coupons are never deleted');
select throws_ok($$update public.coupon set value_paise = 1 where serial = 'P24-0000001'$$, 'P0001', null,
  'coupon identity columns are immutable');

select * from finish();
rollback;
