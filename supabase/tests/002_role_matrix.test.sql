-- §20.4.1: each role × each function. Allowed roles pass the role gate; others get FORBIDDEN;
-- inactive users are always FORBIDDEN; unknown users AUTH_REQUIRED; anon has no execute;
-- 24M roles need aal2 (MFA).
begin;

select tests.redeem('Owner A', array[1]);
select tests.call('Owner A', 'public.submit_dealer_claim()');
create temp table ctx as select (select id from public.dealer_claim where dealer_id = 1 and status = 'SUBMITTED') as claim;
grant select on ctx to authenticated, anon, service_role;

create temp table matrix (expr text, allowed text[]);
insert into matrix values
  ($$public.check_coupon('x')$$, '{DEALER_OWNER,DEALER_STAFF,DISTRIBUTOR}'),
  ($$public.redeem(array['x'], gen_random_uuid())$$, '{DEALER_OWNER,DEALER_STAFF}'),
  ($$public.redemption_outcome(gen_random_uuid())$$, '{DEALER_OWNER,DEALER_STAFF}'),
  ($$public.batch_status(0)$$, '{DEALER_OWNER,DEALER_STAFF}'),
  ($$public.skip_painter_confirmation(0, 'NO_PHONE')$$, '{DEALER_OWNER,DEALER_STAFF}'),
  ($$public.decline_payment('x')$$, '{DEALER_OWNER,DEALER_STAFF}'),
  ($$public.dealer_home()$$, '{DEALER_OWNER,DEALER_STAFF}'),
  ($$public.my_batches(1, null)$$, '{DEALER_OWNER,DEALER_STAFF}'),
  ($$public.submit_dealer_claim()$$, '{DEALER_OWNER}'),
  ($$public.ack_dealer_cn(0)$$, '{DEALER_OWNER}'),
  ($$public.my_claims(1)$$, '{DEALER_OWNER}'),
  ($$public.request_staff('New Staff', '+919000000099')$$, '{DEALER_OWNER}'),
  ($$public.get_claim_by_slip('x')$$, '{DISTRIBUTOR,M24_ADMIN,M24_FINANCE,M24_VIEWER}'),
  ($$public.dealer_claim_detail((select claim from ctx))$$, '{DEALER_OWNER,DISTRIBUTOR,M24_ADMIN,M24_FINANCE,M24_VIEWER}'),
  ($$public.dist_decide((select claim from ctx), array[0]::bigint[], 'HOLD', 'x')$$, '{DISTRIBUTOR}'),
  ($$public.dist_close_claim((select claim from ctx), null, null)$$, '{DISTRIBUTOR}'),
  ($$public.create_dist_claim()$$, '{DISTRIBUTOR}'),
  ($$public.distributor_todo()$$, '{DISTRIBUTOR}'),
  ($$public.dist_claim_detail(0)$$, '{DISTRIBUTOR,M24_ADMIN,M24_FINANCE,M24_VIEWER}'),
  ($$public.m24_decide(0, null, 'APPROVE')$$, '{M24_ADMIN}'),
  ($$public.m24_validate_claim(0)$$, '{M24_ADMIN}'),
  ($$public.m24_return_claim(0, 'reason text')$$, '{M24_ADMIN}'),
  ($$public.m24_settle(0, 'X', null)$$, '{M24_FINANCE}'),
  ($$(select count(*) from public.m24_settlement_export(0))$$, '{M24_ADMIN,M24_FINANCE,M24_VIEWER}'),
  ($$public.upsert_distributor('ZZ', 'Name', null, null)$$, '{M24_ADMIN}'),
  ($$public.upsert_dealer('ZZ-1', 'Name', '+919000000098', null, 1)$$, '{M24_ADMIN,DISTRIBUTOR}'),
  ($$public.reassign_dealer(0, 1, 'reason')$$, '{M24_ADMIN}'),
  ($$public.set_dealer_status(1, 'ACTIVE', 'reason')$$, '{M24_ADMIN,DISTRIBUTOR}'),
  ($$public.upsert_sku('ZZ', 'Name')$$, '{M24_ADMIN}'),
  ($$public.bulk_upsert_dealers('[]', true)$$, '{M24_ADMIN}'),
  ($$public.can_manage_user('DEALER_STAFF', 1, null)$$, '{M24_ADMIN,DISTRIBUTOR}'),
  ($$public.precheck_new_user('Name', null, 'DEALER_STAFF', 1, null)$$, '{M24_ADMIN,DISTRIBUTOR}'),
  ($$public.login_link_target(0)$$, '{M24_ADMIN,DISTRIBUTOR}'),
  ($$public.set_user_status(0, 'ACTIVE', 'reason')$$, '{M24_ADMIN,DISTRIBUTOR,DEALER_OWNER}'),
  ($$public.reject_user_request(0)$$, '{M24_ADMIN,DISTRIBUTOR}'),
  ($$public.create_lot('LOT-Z', 1, 10000, 'PRIMER-1L', 'ZZ')$$, '{M24_ADMIN}'),
  ($$public.generate_lot_codes(0, 1)$$, '{M24_ADMIN}'),
  ($$public.begin_lot_export(0, null)$$, '{M24_ADMIN}'),
  ($$public.void_serials(0, '{}', 'reason')$$, '{M24_ADMIN}'),
  ($$public.lot_reconciliation(0)$$, '{M24_ADMIN,M24_FINANCE,M24_VIEWER}'),
  ($$public.activate_range(0, 1, 1, 'X', 'B', current_date)$$, '{M24_ADMIN}'),
  ($$public.block_range(0, 1, 1, 'reason text')$$, '{M24_ADMIN}'),
  ($$public.hold_coupons('{}', 'reason text')$$, '{M24_ADMIN}'),
  ($$public.release_coupons('{}', 'note')$$, '{M24_ADMIN}'),
  ($$public.reverse_redemption(0, 'reason text')$$, '{M24_ADMIN}'),
  ($$public.resolve_dispute(0, 'RELEASE', 'note text')$$, '{M24_ADMIN}'),
  ($$public.m24_redeem_on_behalf('x', 1, 'reason text')$$, '{M24_ADMIN}'),
  ($$public.lookup_coupon('x')$$, '{M24_ADMIN,M24_FINANCE,M24_VIEWER}'),
  ($$public.log_weekly_review('notes')$$, '{M24_ADMIN}'),
  ($$public.close_support_note(0)$$, '{M24_ADMIN}'),
  ($$public.set_config_value('nope', '1')$$, '{M24_ADMIN}'),
  ($$public.painter_detail(0)$$, '{M24_ADMIN}'),
  ($$public.set_painter_status(0, 'OK', 'note')$$, '{M24_ADMIN}'),
  ($$(select count(*) from public.recon_summary(current_date))$$, '{M24_ADMIN,M24_FINANCE,M24_VIEWER,DISTRIBUTOR}'),
  ($$public.set_user_pin(0, '2468')$$, '{M24_ADMIN,DISTRIBUTOR}'),
  ($$public.change_my_pin('0000', '2468')$$, '{DEALER_OWNER,DEALER_STAFF,DISTRIBUTOR}'),
  ($$public.validate_coupon('x')$$, '{DEALER_OWNER,DEALER_STAFF,DISTRIBUTOR}'),
  ($$public.my_validations(1, null)$$, '{DEALER_OWNER,DEALER_STAFF,DISTRIBUTOR}'),
  ($$public.coupon_stats()$$, '{M24_ADMIN,M24_FINANCE,M24_VIEWER}'),
  ($$public.list_dealers(null)$$, '{M24_ADMIN,M24_FINANCE,M24_VIEWER,DISTRIBUTOR}'),
  ($$public.redeem_coupons(array['x'], null)$$, '{M24_ADMIN,M24_FINANCE}'),
  ($$public.update_user_mobile(0, '+919000000097')$$, '{M24_ADMIN}'),
  ($$public.set_helpline('+91 98000 00000')$$, '{M24_ADMIN}');

create temp table who (label text, role text);
insert into who values ('Owner A', 'DEALER_OWNER'), ('Staff A', 'DEALER_STAFF'), ('Distributor Pune', 'DISTRIBUTOR'),
  ('Admin', 'M24_ADMIN'), ('Finance', 'M24_FINANCE'), ('Viewer', 'M24_VIEWER');

create temp table outcome as
select m.expr, w.label, w.role, m.allowed, tests.call(w.label, m.expr) as r
  from matrix m cross join who w;

select plan((select count(*)::int from outcome) + 4 * (select count(*)::int from matrix) + 1);

select ok(
  case when o.role = any (o.allowed)
       then coalesce(o.r ->> 'msg', '') not in ('FORBIDDEN', 'AUTH_REQUIRED', 'MFA_REQUIRED') and coalesce(o.r ->> 'error', '') <> '42501'
       else o.r ->> 'msg' = 'FORBIDDEN' end,
  format('%s as %s → %s', o.expr, o.role, case when o.role = any (o.allowed) then 'allowed' else 'FORBIDDEN' end))
from outcome o order by o.expr, o.role;

select is(tests.err('Inactive Staff', m.expr), 'FORBIDDEN', format('%s as inactive user → FORBIDDEN', m.expr)) from matrix m;
select is(tests.err('00000000-0000-0000-0000-0000000000ff', m.expr), 'AUTH_REQUIRED', format('%s as unknown user → AUTH_REQUIRED', m.expr)) from matrix m;
select is(tests.state('anon', m.expr), '42501', format('%s as anon → no execute', m.expr)) from matrix m;
select ok(
  case when m.allowed && array['M24_ADMIN', 'M24_FINANCE', 'M24_VIEWER']
       then tests.err(case when 'M24_ADMIN' = any (m.allowed) then 'Admin' when 'M24_FINANCE' = any (m.allowed) then 'Finance' else 'Viewer' end, m.expr, 'aal1') = 'MFA_REQUIRED'
       else true end,
  format('%s needs aal2 for 24M roles', m.expr))
from matrix m;

select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
              and p.proname not in ('public_coupon_info', 'public_helpline', 'rls_user', 'rls_role', 'rls_user_id', 'rls_dealer_id', 'rls_distributor_id',
                                    'rls_is_m24', 'jwt_claim', 'cfg', 'cfg_int', 'cfg_bool', 'cfg_text')
              and not exists (select 1 from matrix m where m.expr like '%public.' || p.proname || '(%')),
  0, 'every function granted to authenticated is in the role matrix');

select * from finish();
rollback;
