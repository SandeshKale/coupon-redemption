-- 0018: Active → Validated → Redeemed (HQ), admin edits (mobile, helpline), PIN-reset rules, "/" codes, no expiry.
begin;
select plan(70);

-- ── Life of a coupon ────────────────────────────────────────────────────────
select is(tests.call('Owner A', format('public.validate_coupon(%L)', tests.code13('P24-0000001'))) ->> 'result', 'VALIDATED', 'a dealer validates');
select is(tests.status('P24-0000001'), 'VALIDATED', 'status is VALIDATED, not REDEEMED');
select is(tests.call('anon', format('public.public_coupon_info(%L)', tests.code13('P24-0000001'))) ->> 'state', 'VALIDATED', 'public: validated');

-- Only 24M admin and finance can redeem.
select is(tests.state('Owner A', $$public.redeem_coupons(array['P24-0000001'], null)$$), 'PT403', 'a dealer cannot redeem');
select is(tests.state('Distributor Pune', $$public.redeem_coupons(array['P24-0000001'], null)$$), 'PT403', 'a distributor cannot redeem');
select is(tests.state('Viewer', $$public.redeem_coupons(array['P24-0000001'], null)$$), 'PT403', 'a viewer cannot redeem');
select is(tests.state('anon', $$public.redeem_coupons(array['P24-0000001'], null)$$), '42501', 'the public cannot redeem');
select is(tests.err('Admin', $$public.redeem_coupons('{}', null)$$), 'BAD_REQUEST', 'an empty list is refused');

-- Validated → Redeemed, and Active → Redeemed directly. Case and spaces in serials do not matter.
create temp table r1 as select tests.call('Finance', $$public.redeem_coupons(array[' p24-0000001 ', 'P24-0000002', 'P24-0000002'], 'CN/26/001')$$) as r;
select is((select r ->> 'redeemed' from r1), '2', 'finance redeems a validated and an active coupon');
select is(tests.status('P24-0000001'), 'REDEEMED', 'validated → redeemed');
select is(tests.status('P24-0000002'), 'REDEEMED', 'active → redeemed directly');
select is((select hq_redeemed_by from public.coupon where serial = 'P24-0000002'), 9::bigint, 'who redeemed is recorded');
select is((select credit_note_ref from public.coupon where serial = 'P24-0000002'), 'CN/26/001', 'the credit note reference is stored');
select is((select redeemed_at from public.coupon where serial = 'P24-0000002'), null::timestamptz, 'a never-validated coupon has no validation time');
select isnt((select redeemed_at from public.coupon where serial = 'P24-0000001'), null, 'a validated coupon keeps its validation time');
select is((select count(*)::int from public.coupon_event where event = 'REDEEMED' and ref = 'CN/26/001'), 2, 'two redeem events');
select is((select from_status from public.coupon_event where event = 'REDEEMED' and coupon_id = (select id from public.coupon where serial = 'P24-0000001')), 'VALIDATED', 'event records VALIDATED as the previous state');
select is((select from_status from public.coupon_event where event = 'REDEEMED' and coupon_id = (select id from public.coupon where serial = 'P24-0000002')), 'ACTIVE', 'event records ACTIVE as the previous state');

-- Redeemed is the end of the road.
select is(tests.call('Admin', $$public.redeem_coupons(array['P24-0000001', 'P24-0000999', 'P24-0000101'], null)$$) -> 'redeemed', '0', 'redeeming again changes nothing');
select is(tests.call('Admin', $$public.redeem_coupons(array['P24-0000001', 'P24-0000999', 'P24-0000101'], null)$$) -> 'not_found', '["P24-0000999"]'::jsonb, 'unknown serials are listed');
select is(jsonb_array_length(tests.call('Admin', $$public.redeem_coupons(array['P24-0000001', 'P24-0000999', 'P24-0000101'], null)$$) -> 'not_redeemable'), 2, 'redeemed and not-yet-active coupons are listed as not redeemable');
select throws_ok($$update public.coupon set status = 'ACTIVE' where serial = 'P24-0000001'$$, 'P0001', null, 'a redeemed coupon cannot go back to active');
select throws_ok($$update public.coupon set status = 'VALIDATED' where serial = 'P24-0000001'$$, 'P0001', null, 'nor back to validated');
select is(tests.err('Admin', format('public.reverse_redemption(%s, %L)', (select id from public.coupon where serial = 'P24-0000001'), 'wrong coupon')), 'NOT_REVERSIBLE', 'a redeemed coupon cannot be reversed');
select is(tests.call('anon', format('public.public_coupon_info(%L)', tests.code13('P24-0000001'))) ->> 'state', 'REDEEMED', 'public: redeemed');
select is(tests.call('Owner B', format('public.validate_coupon(%L)', tests.code13('P24-0000001'))) ->> 'result', 'ALREADY_CLOSED', 'a dealer cannot validate a redeemed coupon');
select is(tests.call('Owner A', format('public.validate_coupon(%L)', tests.code13('P24-0000002'))) ->> 'result', 'ALREADY_CLOSED', 'not even a dealer who never validated it, nor the same dealer');

-- Not active yet: cannot be redeemed; expired ones cannot either.
select is(tests.status('P24-0000101'), 'GENERATED', 'a not-yet-active coupon stays untouched');

-- Reverse a validation (admin, with a reason): VALIDATED → ACTIVE.
select tests.call('Owner A', format('public.validate_coupon(%L)', tests.code13('P24-0000003')));
select is(tests.state('Admin', format('public.reverse_redemption(%s, %L)', (select id from public.coupon where serial = 'P24-0000003'), 'validated by mistake')), 'OK', 'admin reverses a validation');
select is(tests.status('P24-0000003'), 'ACTIVE', 'validated → active again');
select is((select redeemed_dealer_id from public.coupon where serial = 'P24-0000003'), null::int, 'the dealer link is cleared');
select is(tests.err('Admin', format('public.reverse_redemption(%s, %L)', (select id from public.coupon where serial = 'P24-0000003'), 'again')), 'NOT_REVERSIBLE', 'an active coupon cannot be reversed');
select is(tests.state('Finance', format('public.reverse_redemption(%s, %L)', (select id from public.coupon where serial = 'P24-0000003'), 'no rights')), 'PT403', 'only admin reverses');

-- Hold and release keep a validated coupon validated.
select tests.call('Owner A', format('public.validate_coupon(%L)', tests.code13('P24-0000004')));
select is(tests.call('Admin', format('public.hold_coupons(array[%s]::bigint[], %L)', (select id from public.coupon where serial = 'P24-0000004'), 'check with dealer')), '1', 'admin holds a validated coupon');
select is(tests.status('P24-0000004'), 'ON_HOLD', 'validated → on hold');
select is(tests.call('Admin', format('public.release_coupons(array[%s]::bigint[], %L)', (select id from public.coupon where serial = 'P24-0000004'), 'fine')), '1', 'and releases it');
select is(tests.status('P24-0000004'), 'VALIDATED', 'back to validated');

-- ── Stats ───────────────────────────────────────────────────────────────────
select is((tests.call('Admin', 'public.coupon_stats()') -> 'totals' ->> 'redeemed')::int, 2, 'stats: redeemed');
select is((tests.call('Admin', 'public.coupon_stats()') -> 'totals' ->> 'validated_open')::int, 1, 'stats: validated, not yet redeemed');
select is((tests.call('Admin', 'public.coupon_stats()') -> 'totals' ->> 'validated')::int, 2, 'stats: ever validated (not counting the reversed one)');

-- ── No expiry ───────────────────────────────────────────────────────────────
select is(public.cfg_int('coupon_validity_months'), 0, 'validity is off by default');
update public.app_config set value = '0' where key = 'coupon_validity_months';
update public.coupon_lot set status = 'EXPORTED' where id = 2;
select is((tests.call('Admin', $$public.activate_range(2, 101, 101, 'PRIMER-1L', 'B-NOEXP', current_date)$$) ->> 'activated')::int, 1, 'a coupon is activated');
select is((select expires_at from public.coupon where serial = 'P24-0000101'), null::timestamptz, 'with validity 0 the coupon has no expiry date');
select tests.freeze(now() + interval '60 months');
select is(tests.call('Owner A', format('public.validate_coupon(%L)', tests.code13('P24-0000101'))) ->> 'result', 'VALIDATED', 'a coupon with no expiry is still valid years later');
select tests.thaw();

-- ── Codes with "/" ──────────────────────────────────────────────────────────
select is(tests.state('Admin', $$public.upsert_distributor('KA/26/01', 'MP Ceramics', '+919663448866', null)$$), 'OK', 'a distributor code may contain "/"');
select is(tests.state('Admin', $$public.upsert_sku('24M/PRIM-20L', '24M Primer 20 L')$$), 'OK', 'a SKU code may contain "/"');
select throws_ok($$insert into public.distributor (code, name) values ('KA 26', 'Space')$$, '23514', null, 'but not a space');

-- ── Admin edits a registered mobile number ─────────────────────────────────
select is(tests.state('Admin', $$public.update_user_mobile(1, '+919811100001')$$), 'OK', 'admin changes a dealer login mobile');
select is((select mobile_e164 from public.app_user where id = 1), '+919811100001', 'the login number changed');
select is((select mobile_e164 from public.dealer where id = 1), '+919811100001', 'the dealer record follows');
select is(tests.err('Admin', $$public.update_user_mobile(1, '+919800000012')$$), 'DUPLICATE_MOBILE', 'a number already in use is refused');
select is(tests.err('Admin', $$public.update_user_mobile(1, '98111')$$), 'BAD_MOBILE', 'a malformed number is refused');
select is(tests.state('Admin', $$public.update_user_mobile(5, '+919811100005')$$), 'OK', 'admin changes a distributor mobile');
select is((select mobile_e164 from public.distributor where id = 1), '+919811100005', 'the distributor record follows');
select is(tests.state('Admin', $$public.update_user_mobile(9, '+919811100009')$$), 'OK', 'admin changes a staff mobile');
select is(tests.state('Distributor Pune', $$public.update_user_mobile(1, '+919811100002')$$), 'PT403', 'a distributor cannot change mobile numbers');
select is(tests.state('Finance', $$public.update_user_mobile(1, '+919811100002')$$), 'PT403', 'finance cannot either');
select is(tests.call('service', $$public.pin_login_check('+919811100001', '1357', 'ip-x')$$) ->> 'why', 'no_pin', 'the new number is the login (this dealer has no PIN set in this test)');

-- ── Helpline ────────────────────────────────────────────────────────────────
select is(tests.state('Admin', $$public.set_helpline('+91-9844070070')$$), 'OK', 'admin sets the helpline');
select is(tests.call('anon', 'public.public_helpline()'), '"+91-9844070070"'::jsonb, 'anyone can read the helpline');
select is(tests.err('Admin', $$public.set_helpline('abc')$$), 'BAD_HELPLINE', 'a bad helpline is refused');
select is(tests.state('Finance', $$public.set_helpline('+91 98000 00000')$$), 'PT403', 'only admin sets the helpline');

-- ── Who may reset which PIN ─────────────────────────────────────────────────
create temp table rep as select public.register_app_user('00000000-0000-0000-0000-0000000000b4', 'Rep One', '+919822200005', 'u104@users.example.in', 'DISTRIBUTOR', null, 1, 7, null, '8642', true, null, null) as uid;
select is(tests.state('Rep One', format('public.set_user_pin(%s, %L)', 12, '2468')), 'PT403', 'a rep cannot set a PIN for another distributor''s dealer');
select is(tests.state('Rep One', format('public.set_user_pin(%s, %L)', 3, '2468')), 'OK', 'a rep sets the PIN of a dealer under their distributor');
select is(tests.state('Rep One', format('public.set_user_pin(%s, %L)', 5, '2468')), 'PT403', 'a rep cannot set the distributor''s PIN');
select is(tests.state('Distributor Pune', format('public.set_user_pin(%s, %L)', (select uid from rep), '3579')), 'OK', 'a distributor sets their rep''s PIN');
select is(tests.state('Distributor Mumbai', format('public.set_user_pin(%s, %L)', (select uid from rep), '3579')), 'PT403', 'another distributor cannot');
select is(tests.state('Admin', format('public.set_user_pin(%s, %L)', (select uid from rep), '3579')), 'OK', '24M sets a rep PIN');
select is(tests.state('Admin', format('public.set_user_pin(%s, %L)', 5, '2468')), 'OK', '24M sets a distributor PIN');
select is(tests.state('Distributor Pune', format('public.set_user_pin(%s, %L)', 5, '2468')), 'PT403', 'a distributor cannot set their own PIN this way (they change it themselves)');

select * from finish();
rollback;
