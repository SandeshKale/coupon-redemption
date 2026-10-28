-- 0016: PIN login, dealer validate, sales reps, GST, public status, live stats.
begin;
select plan(90);

-- ── PIN rules ───────────────────────────────────────────────────────────────
select ok(public.pin_is_weak('1234'), 'pin: ascending run is weak');
select ok(public.pin_is_weak('1111'), 'pin: repeated digit is weak');
select ok(public.pin_is_weak('12a4'), 'pin: non-digits are rejected');
select ok(public.pin_is_weak('123'), 'pin: three digits are rejected');
select ok(public.pin_is_weak('0001', '+919800000001'), 'pin: last four digits of the mobile are weak');
select ok(not public.pin_is_weak('4817', '+919800000001'), 'pin: an ordinary PIN is fine');

select public.store_pin(1, '4817', 7);
select ok((select pin_hash from public.user_pin where user_id = 1) like '$2%', 'pin is stored as a bcrypt hash');
select isnt((select pin_hash from public.user_pin where user_id = 1), '4817', 'the PIN itself is never stored');
select throws_ok($$select public.store_pin(2, '1234', 7)$$, 'PT409', 'WEAK_PIN', 'store_pin refuses a weak PIN');

-- ── Login check ─────────────────────────────────────────────────────────────
select is(tests.call('service', $$public.pin_login_check('+919800000001', '4817', '10.0.0.1')$$) ->> 'result', 'OK', 'right mobile and PIN logs in');
select is((tests.call('service', $$public.pin_login_check('+919800000001', '4817', '10.0.0.1')$$) ->> 'user_id')::int, 1, 'the check returns the user');
select is(tests.call('service', $$public.pin_login_check('+919800000001', '4818', '10.0.0.1')$$) ->> 'result', 'FAILED', 'wrong PIN fails');
select is(tests.call('service', $$public.pin_login_check('+919811111111', '4817', '10.0.0.1')$$) ->> 'result', 'FAILED', 'unknown mobile fails');
select is(tests.call('service', $$public.pin_login_check('+919800000001', '48', '10.0.0.1')$$) ->> 'result', 'FAILED', 'badly formed PIN fails');
select is(tests.call('service', $$public.pin_login_check('+919800000002', '4817', '10.0.0.1')$$) ->> 'why', 'no_pin', 'a user without a PIN cannot log in');

select public.store_pin(7, '4817', 7);
select is(tests.call('service', $$public.pin_login_check('+919800000007', '4817', '10.0.0.1')$$) ->> 'result', 'FAILED', '24M staff never use PIN login, even with a PIN row');
update public.app_user set status = 'INACTIVE' where id = 1;
select is(tests.call('service', $$public.pin_login_check('+919800000001', '4817', '10.0.0.1')$$) ->> 'result', 'FAILED', 'an inactive user cannot log in');
update public.app_user set status = 'ACTIVE' where id = 1;

-- Lockout: 5 wrong tries lock for 15 minutes; the right PIN is refused while locked; the lock grows.
select tests.call('service', $$public.pin_login_check('+919800000001', '9999', '10.0.0.2')$$) from generate_series(1, 5);
select is((select lock_level from public.user_pin where user_id = 1), 1, 'five wrong PINs lock the account');
select is(tests.call('service', $$public.pin_login_check('+919800000001', '4817', '10.0.0.2')$$) ->> 'why', 'locked', 'the right PIN is refused while locked');
select is(tests.call('service', $$public.pin_login_check('+919800000001', '4817', '10.0.0.2')$$) ->> 'result', 'FAILED', 'a locked account looks like any other failure');
select tests.freeze(now() + interval '16 minutes');
select is(tests.call('service', $$public.pin_login_check('+919800000001', '4817', '10.0.0.2')$$) ->> 'result', 'OK', 'the lock ends after 15 minutes');
select is((select lock_level from public.user_pin where user_id = 1), 0, 'a good login clears the lock level');
select tests.call('service', $$public.pin_login_check('+919800000001', '9999', '10.0.0.3')$$) from generate_series(1, 5);
select tests.call('service', $$public.pin_login_check('+919800000001', '4817', '10.0.0.3')$$);
select tests.freeze(now() + interval '32 minutes');
select tests.call('service', $$public.pin_login_check('+919800000001', '9999', '10.0.0.3')$$) from generate_series(1, 5);
select is((select lock_level from public.user_pin where user_id = 1), 2, 'a second lock is longer');
select ok((select locked_until - public.app_now() from public.user_pin where user_id = 1) > interval '50 minutes', 'the second lock is about an hour');
select tests.thaw();

-- Per-IP rate limit.
select tests.call('service', $$public.pin_login_check('+919811111111', '4817', '10.9.9.9')$$) from generate_series(1, 40);
select is(tests.call('service', $$public.pin_login_check('+919811111111', '4817', '10.9.9.9')$$) ->> 'result', 'RATE_LIMITED', 'too many tries from one address are rate limited');
select is(tests.call('service', $$public.pin_login_check('+919811111111', '4817', '10.9.9.8')$$) ->> 'result', 'FAILED', 'another address is not limited');

-- Nobody but the service role can run the check or read the PIN tables.
select is(tests.state('anon', $$public.pin_login_check('+919800000001', '4817', 'x')$$), '42501', 'anon cannot run the PIN check');
select is(tests.state('Owner A', $$public.pin_login_check('+919800000001', '4817', 'x')$$), '42501', 'a dealer cannot run the PIN check');
select is(tests.rows('Owner A', 'select * from public.user_pin'), -1::bigint, 'a dealer cannot read PIN rows');
select is(tests.rows('Admin', 'select * from public.user_pin'), -1::bigint, 'not even 24M admins can read PIN rows');
select is(tests.rows('service', 'select * from public.user_pin'), -1::bigint, 'the service role cannot read PIN rows directly either');
select is(tests.state('Owner A', $$public.pin_digest('4817')$$), '42501', 'the PIN digest helper is not callable');

-- ── Setting and changing PINs ───────────────────────────────────────────────
select is(tests.state('Distributor Pune', $$public.set_user_pin(1, '2468')$$), 'OK', 'a distributor sets the PIN of their own dealer');
select is(tests.call('service', $$public.pin_login_check('+919800000001', '2468', '10.0.0.4')$$) ->> 'result', 'OK', 'the new PIN works');
select is(tests.state('Distributor Pune', $$public.set_user_pin(12, '2468')$$), 'PT403', 'a distributor cannot set the PIN of another distributor''s dealer');
select is(tests.state('Owner A', $$public.set_user_pin(1, '2468')$$), 'PT403', 'a dealer cannot set PINs');
select is(tests.err('Distributor Pune', $$public.set_user_pin(1, '1234')$$), 'WEAK_PIN', 'a weak PIN is refused');
select is(tests.err('Admin', $$public.set_user_pin(7, '2468')$$), 'USE_PASSWORD_LOGIN', '24M staff keep password login');
select is(tests.state('Admin', $$public.set_user_pin(12, '3579')$$), 'PT403', '24M does not set dealer PINs (their distributor or rep does)');

select is(tests.err('Owner A', $$public.change_my_pin('0000', '1357')$$), 'WRONG_PIN', 'changing needs the current PIN');
select is(tests.state('Owner A', $$public.change_my_pin('2468', '1357')$$), 'OK', 'a dealer changes their own PIN');
select is(tests.call('service', $$public.pin_login_check('+919800000001', '1357', '10.0.0.5')$$) ->> 'result', 'OK', 'the changed PIN works');
select is(tests.state('Admin', $$public.change_my_pin('1357', '2468')$$), 'PT403', '24M staff cannot use PIN change');

-- ── Creating logins ─────────────────────────────────────────────────────────
select is(tests.state('Distributor Pune', $$public.precheck_new_user('New Shop', '+919822200001', 'DEALER_OWNER', null, null, 1)$$), 'OK', 'a distributor can precheck a new dealer under themselves');
select is(tests.state('Distributor Pune', $$public.precheck_new_user('New Shop', '+919822200001', 'DEALER_OWNER', null, null, 2)$$), 'PT403', 'not under another distributor');
select is(tests.err('Distributor Pune', $$public.precheck_new_user('Dup', '+919700000001', 'DEALER_OWNER', null, null, 1)$$), 'DUPLICATE_MOBILE', 'a dealer mobile already on file is refused');
select is(tests.state('Distributor Pune', $$public.precheck_new_user('Rep', '+919822200002', 'DISTRIBUTOR', null, 1, null, true)$$), 'PT403', 'a distributor cannot add a sales rep');
select is(tests.state('Admin', $$public.precheck_new_user('Rep', '+919822200002', 'DISTRIBUTOR', null, 1, null, true)$$), 'OK', '24M can add a sales rep');

create temp table made as select
  public.register_app_user('00000000-0000-0000-0000-0000000000a1', 'Om Paints', '+919822200001', 'u101@users.example.in',
    'DEALER_OWNER', null, null, 5, null, '2468', false, '27aaapl1234c1z5', 1) as uid;
select is((select d.code from public.dealer d join public.app_user a on a.dealer_id = d.id where a.id = (select uid from made)), 'DL00001', 'a new dealer gets an automatic code');
select is((select d.gst from public.dealer d join public.app_user a on a.dealer_id = d.id where a.id = (select uid from made)), '27AAAPL1234C1Z5', 'GST is stored in capitals');
select is(tests.call('service', $$public.pin_login_check('+919822200001', '2468', '10.0.0.6')$$) ->> 'result', 'OK', 'the new dealer logs in with the PIN set at creation');
select throws_ok($$select public.register_app_user('00000000-0000-0000-0000-0000000000a2', 'No Pin', '+919822200003', 'u102@users.example.in', 'DEALER_OWNER', null, null, 5, null, null, false, null, 1)$$, 'PT409', 'PIN_REQUIRED', 'a dealer login needs a PIN');
select throws_ok($$select public.register_app_user('00000000-0000-0000-0000-0000000000a3', 'Bad Gst', '+919822200004', 'u103@users.example.in', 'DEALER_OWNER', null, null, 5, null, '2468', false, 'NOT-A-GST', 1)$$, '23514', null, 'a malformed GST is refused');
create temp table rep as select public.register_app_user('00000000-0000-0000-0000-0000000000a4', 'Rep One', '+919822200005', 'u104@users.example.in', 'DISTRIBUTOR', null, 1, 7, null, '8642', true, null, null) as uid;
select is((select is_sales_rep from public.app_user where id = (select uid from rep)), true, 'a sales rep is flagged');

-- ── Validate ────────────────────────────────────────────────────────────────
select is(tests.call('Owner A', format('public.validate_coupon(%L)', tests.code13('P24-0000001'))) ->> 'result', 'VALIDATED', 'a dealer validates an active coupon');
select is(tests.status('P24-0000001'), 'VALIDATED', 'the coupon is now validated');
select is((select redeemed_dealer_id from public.coupon where serial = 'P24-0000001'), 1, 'it records which dealer validated it');
select is((select count(*)::int from public.dealer_claim_line), 0, 'validating creates no claim line');
select is((select count(*)::int from public.coupon_event where ref = 'validate'), 1, 'validating writes one event');
select is(tests.call('Owner A', format('public.validate_coupon(%L)', tests.code13('P24-0000001'))) ->> 'result', 'ALREADY_REDEEMED_SELF', 'validating twice says so');
select is(tests.call('Owner B', format('public.validate_coupon(%L)', tests.code13('P24-0000001'))) ->> 'result', 'ALREADY_REDEEMED_OTHER', 'another dealer cannot validate it again');
select is(tests.call('Owner Mumbai', format('public.validate_coupon(%L)', tests.code13('P24-0000002'))) ->> 'result', 'VALIDATED', 'any dealer can validate any coupon');
select is(tests.call('Owner A', format('public.validate_coupon(%L)', tests.code13('P24-0000101'))) ->> 'result', 'NOT_ACTIVE', 'a coupon not yet activated is refused');
select is(tests.call('Owner A', $$public.validate_coupon('nonsense')$$) ->> 'result', 'INVALID_FORMAT', 'a bad code is refused');
select is(tests.call('Owner Inactive Dealer', format('public.validate_coupon(%L)', tests.code13('P24-0000003'))) ->> 'result', 'DEALER_INACTIVE', 'an inactive dealer cannot validate');
select is(tests.state('Viewer', $$public.validate_coupon('x')$$), 'PT403', 'a 24M viewer cannot validate');
select is(tests.state('anon', $$public.validate_coupon('x')$$), '42501', 'the public cannot validate');
select tests.freeze(now() + interval '20 months');
select is(tests.call('Owner A', format('public.validate_coupon(%L)', tests.code13('P24-0000004'))) ->> 'result', 'EXPIRED', 'an expired coupon cannot be validated');
select tests.thaw();

select is(jsonb_array_length(tests.call('Owner A', 'public.my_validations(10, null)')), 1, 'a dealer sees their own validations');
select is(jsonb_array_length(tests.call('Staff A', 'public.my_validations(10, null)')), 1, 'staff of the same dealer see the same list');
select is(jsonb_array_length(tests.call('Owner B', 'public.my_validations(10, null)')), 0, 'other dealers see none of them');

-- ── Public page ─────────────────────────────────────────────────────────────
select is(tests.call('anon', format('public.public_coupon_info(%L)', tests.code13('P24-0000003'))) ->> 'state', 'ACTIVE', 'public: an active coupon says ACTIVE');
select is(tests.call('anon', format('public.public_coupon_info(%L)', tests.code13('P24-0000001'))) ->> 'state', 'VALIDATED', 'public: a validated coupon says VALIDATED');
select is(tests.call('anon', format('public.public_coupon_info(%L)', tests.code13('P24-0000101'))) ->> 'result', 'NOT_RECOGNISED', 'public: an inactive coupon is not recognised');
select tests.freeze(now() + interval '20 months');
select is(tests.call('anon', format('public.public_coupon_info(%L)', tests.code13('P24-0000005'))) ->> 'state', 'EXPIRED', 'public: an expired coupon says EXPIRED');
select tests.thaw();
select ok(tests.call('anon', format('public.public_coupon_info(%L)', tests.code13('P24-0000001'))) - 'result' - 'value_paise' - 'state' - 'helpline' = '{}'::jsonb,
  'public: nothing about the dealer or distributor is exposed');

-- ── 24M view and dealer list ────────────────────────────────────────────────
select is((tests.call('Admin', 'public.coupon_stats()') -> 'totals' ->> 'validated')::int, 2, 'stats: validated total');
select is((tests.call('Viewer', 'public.coupon_stats()') -> 'totals' ->> 'all')::int, 135, 'stats: viewers can read');
select is(tests.state('Finance', 'public.coupon_stats()'), 'OK', 'stats: finance can read');
select is(tests.state('Owner A', 'public.coupon_stats()'), 'PT403', 'stats: dealers cannot');
select is(jsonb_array_length(tests.call('Admin', 'public.coupon_stats()') -> 'recent'), 2, 'stats: recent validations listed');
select is(jsonb_array_length(tests.call('Distributor Pune', 'public.list_dealers(null)')), 9, 'a distributor lists only their own dealers');
select is(jsonb_array_length(tests.call('Admin', 'public.list_dealers(null)')), 21, '24M lists every dealer');
select is(jsonb_array_length(tests.call('Admin', 'public.list_dealers(2)')), 7, '24M can filter by distributor');
select is(tests.state('Owner A', 'public.list_dealers(null)'), 'PT403', 'dealers cannot list dealers');
select is((select e ->> 'user_status' from jsonb_array_elements(tests.call('Admin', 'public.list_dealers(null)')) e where (e ->> 'id')::int = 1), 'ACTIVE', 'the list shows the login status');
select is((select e ->> 'user_id' from jsonb_array_elements(tests.call('Admin', 'public.list_dealers(null)')) e where (e ->> 'id')::int = 1), '1', 'the list shows the owner login');

-- ── Weekly cleanup removes old PIN login attempts ───────────────────────────
insert into public.pin_attempt (ip_hash, at) values ('\x01', now() - interval '3 days'), ('\x02', now());
select is((public.job_cleanup() ->> 'pin_attempt')::int, 1, 'cleanup removes PIN attempts older than a day');
select is((select count(*)::int from public.pin_attempt where ip_hash = '\x02'), 1, 'and keeps recent ones');

-- ── Reconciliation tolerates validate-only coupons ──────────────────────────
select public.run_reconciliation();
select is((select count(*)::int from public.recon_issue where check_name = 'REDEEMED_WITHOUT_LINE'), 0, 'validated coupons without a claim line are not an issue');

select * from finish();
rollback;
