-- 0019: 24M staff and a distributor or dealer may share a mobile number; PIN logins stay unique.
begin;
select plan(8);

select is(tests.state('Admin', $$public.precheck_new_user('Dist Same Phone', '+919800000007', 'DISTRIBUTOR', null, 1)$$), 'OK', 'a distributor may use the mobile number of a 24M staff member');
select is(tests.err('Admin', $$public.precheck_new_user('Dup', '+919800000005', 'DISTRIBUTOR', null, 2)$$), 'DUPLICATE_MOBILE', 'but not the mobile number of another PIN login');
select is(tests.err('Admin', $$public.precheck_new_user('Staff Dup', '+919800000009', 'M24_VIEWER', null, null)$$), 'DUPLICATE_MOBILE', 'and 24M staff cannot share a number with each other');

-- Give a distributor and the admin the same number, then log in with the PIN.
select is(tests.state('Admin', $$public.update_user_mobile(5, '+919800000007')$$), 'OK', 'admin gives a distributor the admin''s own number');
select public.store_pin(5, '4817', 7);
select is(tests.call('service', $$public.pin_login_check('+919800000007', '4817', '10.1.1.1')$$) ->> 'user_id', '5', 'the PIN login finds the distributor, never the staff member');
select is(tests.call('service', $$public.pin_login_check('+919800000007', '4818', '10.1.1.1')$$) ->> 'result', 'FAILED', 'a wrong PIN still fails');
select throws_ok($$insert into public.app_user (name, mobile_e164, email, role, distributor_id) values ('Clash', '+919800000007', 'clash@users.example.in', 'DISTRIBUTOR', 1)$$, '23505', null, 'the database refuses a second PIN login with the same number');
select is(tests.err('Admin', $$public.update_user_mobile(6, '+919800000007')$$), 'DUPLICATE_MOBILE', 'changing a second distributor to that number is refused');

select * from finish();
rollback;
