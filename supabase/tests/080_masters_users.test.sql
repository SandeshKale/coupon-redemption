-- Masters and users: upserts, reassignment history, bulk upload, user lifecycle (EC-130..EC-136).
begin;
select plan(20);

select is(tests.err('Distributor Pune', $$public.upsert_dealer('NEW-1', 'New Shop', '+919700000099', 'Pune', 2)$$), 'FORBIDDEN', 'distributor cannot add dealers elsewhere');
select ok(tests.call('Distributor Pune', $$public.upsert_dealer('NEW-1', 'New Shop', '+919700000099', 'Pune', 1)$$)::int > 20, 'distributor adds own dealer');
select is(tests.err('Admin', $$public.upsert_dealer('NEW-2', 'Dup Shop', '+919700000099', 'Pune', 1)$$), 'DUPLICATE_MOBILE', 'EC-131 duplicate dealer mobile refused');

-- EC-132 reassignment
select tests.redeem('Owner B', array[1]);
select is(tests.state('Admin', $$public.reassign_dealer(2, 2, 'territory change')$$), 'OK', 'reassign dealer');
select is((select count(*)::int from public.dealer_distributor_history where dealer_id = 2), 2, 'history row written');
select is((select status from public.dealer_claim where dealer_id = 2 order by id limit 1), 'SUBMITTED', 'old open claim submitted to the old distributor');
select is(tests.redeem('Owner B', array[2]) ->> 'result', 'REDEEMED', 'redeem after move');
select is((select routed_distributor_id from public.coupon where serial = 'P24-0000002'), 2, 'new redemptions route to the new distributor');

-- EC-130 bulk upload dry run
select is(tests.call('Admin', $$public.bulk_upsert_dealers('[{"code":"B-1","name":"Bulk One","mobile_e164":"+919700001001","distributor_code":"DIST-PUNE"},{"code":"B-2","name":"X","mobile_e164":"bad","distributor_code":"NOPE"}]', false)$$) ->> 'committed',
  'false', 'EC-130 bad rows: nothing committed');
select is(jsonb_array_length(tests.call('Admin', $$public.bulk_upsert_dealers('[{"code":"B-1","name":"Bulk One","mobile_e164":"+919700001001","distributor_code":"DIST-PUNE"},{"code":"B-2","name":"X","mobile_e164":"bad","distributor_code":"NOPE"}]', true)$$) -> 'errors'),
  3, 'report lists every problem');
select is((select count(*)::int from public.dealer where code like 'B-%'), 0, 'dry run commits nothing');
select is(tests.call('Admin', $$public.bulk_upsert_dealers('[{"code":"B-1","name":"Bulk One","mobile_e164":"+919700001001","distributor_code":"DIST-PUNE"}]', false)$$) ->> 'committed',
  'true', 'clean upload commits');

-- EC-136 / EC-133 user lifecycle
select is(tests.call('Distributor Pune', $$public.can_manage_user('DEALER_STAFF', 9, null)$$), 'false'::jsonb, 'EC-136 distributor cannot manage another distributor''s dealer');
select is(tests.err('Distributor Pune', $$public.precheck_new_user('Someone', '+919812300000', 'DEALER_STAFF', 9, null)$$), 'FORBIDDEN', 'precheck refuses too');
select is(tests.err('Admin', $$public.precheck_new_user('Someone', '+919800000001', 'DEALER_STAFF', 1, null)$$), 'DUPLICATE_MOBILE', 'duplicate active mobile refused');
select is(tests.call('Owner A', format('public.set_user_status(%s, %L, %L)', (select id from public.app_user where name = 'Staff A'), 'INACTIVE', 'left the shop')) ->> 'status',
  'INACTIVE', 'owner removes staff (SOP 3)');
select is(tests.err('Staff A', 'public.dealer_home()'), 'FORBIDDEN', 'EC-133 deactivated user is FORBIDDEN on the next call');
select is(tests.err('Owner A', format('public.set_user_status(%s, %L, %L)', (select id from public.app_user where name = 'Owner B'), 'INACTIVE', 'x')), 'FORBIDDEN',
  'owner cannot touch other dealers'' users');

-- Logged-out "request new link" (service role, anti-enumeration)
select is(tests.call('service', $$public.record_login_link_request('+919800000001', '1.2.3.4')$$) ->> 'result', 'RECEIVED', 'request for a known number');
select is(tests.call('service', $$public.record_login_link_request('+919999999999', '1.2.3.4')$$) ->> 'result', 'RECEIVED', 'same answer for an unknown number');

select * from finish();
rollback;
