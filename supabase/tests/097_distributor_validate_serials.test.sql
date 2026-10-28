-- 0020: distributors and sales reps validate; the new serial pattern SERIES-NNNNNN-C.
begin;
select plan(45);

-- ── Distributor and rep validate ────────────────────────────────────────────
create temp table rep as select public.register_app_user('00000000-0000-0000-0000-0000000000c4', 'Rep Pune', '+919822200077', 'u177@users.example.in', 'DISTRIBUTOR', null, 1, 7, null, '8642', true, null, null) as uid;
select is(tests.call('Distributor Pune', format('public.check_coupon(%L)', tests.code13('P24-0000001'))) ->> 'result', 'VALID', 'a distributor can check a coupon');
select is(tests.status('P24-0000001'), 'ACTIVE', 'checking changes nothing');
select is(tests.call('Distributor Pune', format('public.validate_coupon(%L)', tests.code13('P24-0000001'))) ->> 'result', 'VALIDATED', 'a distributor validates an active coupon');
select is(tests.status('P24-0000001'), 'VALIDATED', 'the coupon is validated');
select is((select redeemed_dealer_id from public.coupon where serial = 'P24-0000001'), null::int, 'no dealer is recorded for a distributor validation');
select is((select routed_distributor_id from public.coupon where serial = 'P24-0000001'), 1, 'it is routed to the distributor');
select is((select redeemed_user_id from public.coupon where serial = 'P24-0000001'), 5::bigint, 'and records who validated it');
select is((select count(*)::int from public.coupon_event where ref = 'validate' and user_id = 5), 1, 'one validate event');
select is((select count(*)::int from public.scan_attempt where result = 'VALIDATED' and user_id = 5 and dealer_id is null), 1, 'the scan log holds it with no dealer');
select is(tests.call('Distributor Pune', format('public.validate_coupon(%L)', tests.code13('P24-0000001'))) ->> 'result', 'ALREADY_REDEEMED_SELF', 'validating again says you did it');
select is(tests.call('Rep Pune', format('public.validate_coupon(%L)', tests.code13('P24-0000001'))) ->> 'result', 'ALREADY_REDEEMED_OTHER', 'a rep sees it as validated by someone else');
select is(tests.call('Owner A', format('public.validate_coupon(%L)', tests.code13('P24-0000001'))) ->> 'result', 'ALREADY_REDEEMED_OTHER', 'and so does a dealer');
select is(tests.call('Rep Pune', format('public.validate_coupon(%L)', tests.code13('P24-0000002'))) ->> 'result', 'VALIDATED', 'a sales rep validates too');
select is(tests.call('Distributor Mumbai', format('public.check_coupon(%L)', tests.code13('P24-0000002'))) ->> 'result', 'ALREADY_REDEEMED_OTHER', 'another distributor sees it as someone else''s');
select is(tests.call('Distributor Pune', format('public.validate_coupon(%L)', tests.code13('P24-0000101'))) ->> 'result', 'NOT_ACTIVE', 'a coupon not yet active is refused for a distributor too');
select is(tests.call('Distributor Pune', $$public.validate_coupon('nonsense')$$) ->> 'result', 'INVALID_FORMAT', 'a bad code is refused');
select is(tests.state('Viewer', $$public.validate_coupon('x')$$), 'PT403', '24M staff still cannot validate');
select is(tests.state('anon', $$public.validate_coupon('x')$$), '42501', 'the public still cannot');

-- A distributor and its team see their own validations; dealers see their shop's.
select is(jsonb_array_length(tests.call('Distributor Pune', 'public.my_validations(10, null)')), 2, 'the distributor sees the validations of the whole team');
select is(jsonb_array_length(tests.call('Rep Pune', 'public.my_validations(10, null)')), 2, 'and so does a sales rep');
select is(jsonb_array_length(tests.call('Distributor Mumbai', 'public.my_validations(10, null)')), 0, 'another distributor sees none');
select is(jsonb_array_length(tests.call('Owner A', 'public.my_validations(10, null)')), 0, 'a dealer''s own list does not include them');

-- A switched-off distributor cannot validate.
update public.distributor set status = 'INACTIVE' where id = 2;
select is(tests.call('Distributor Mumbai', format('public.validate_coupon(%L)', tests.code13('P24-0000003'))) ->> 'result', 'DEALER_INACTIVE', 'an inactive distributor cannot validate');
update public.distributor set status = 'ACTIVE' where id = 2;

-- Dashboard: recent validations include the distributor's.
select is((select count(*)::int from jsonb_array_elements(tests.call('Admin', 'public.coupon_stats()') -> 'recent') e where e ->> 'dealer' in ('Distributor Pune', 'Rep Pune')), 2, 'stats list distributor validations');
select is((tests.call('Admin', 'public.coupon_stats()') -> 'totals' ->> 'validated')::int, 2, 'and count them');

-- Dealers are unchanged.
select is(tests.call('Owner A', format('public.validate_coupon(%L)', tests.code13('P24-0000004'))) ->> 'result', 'VALIDATED', 'a dealer still validates');
select is(tests.call('Owner A', format('public.validate_coupon(%L)', tests.code13('P24-0000004'))) ->> 'result', 'ALREADY_REDEEMED_SELF', 'and sees their own');
select is(tests.call('Staff A', format('public.validate_coupon(%L)', tests.code13('P24-0000004'))) ->> 'result', 'ALREADY_REDEEMED_SELF', 'staff of the same shop see it as theirs');

-- ── New serial pattern ──────────────────────────────────────────────────────
select ok(public.make_serial('RA', 1) ~ '^RA-[0-9]{6}-[0-9A-HJKMNP-TV-Z]$', 'serial format SERIES-NNNNNN-C');
select is(public.make_serial('RA', 1), public.make_serial('RA', 1), 'the same number always gives the same serial');
select isnt(public.make_serial('RA', 1), public.make_serial('RB', 1), 'another series gives another serial');
select is((select count(distinct public.make_serial('RA', n))::int from generate_series(1, 5000) n), 5000, 'serials of 5000 consecutive numbers are all different');
select is((select count(distinct substr(public.make_serial('RA', n), 4, 6))::int from generate_series(0, 4999) n), 5000, 'the digits alone are different too');
select ok((select count(*) filter (where d > lag_d)::int from (select substr(public.make_serial('RA', n), 4, 6)::int as d, lag(substr(public.make_serial('RA', n), 4, 6)::int) over (order by n) as lag_d from generate_series(1, 1000) n) t where lag_d is not null)
          between 400 and 600, 'the digits are not in order');
select ok((select max(abs(d - lag_d)) > 100000 from (select substr(public.make_serial('RA', n), 4, 6)::int as d, lag(substr(public.make_serial('RA', n), 4, 6)::int) over (order by n) as lag_d from generate_series(1, 1000) n) t where lag_d is not null),
          'neighbouring coupons are far apart');
select is((select count(*)::int from generate_series(1, 2000) n
            where right(public.make_serial('RA', n), 1) <> public.luhn32_check_char('RA' || substr(public.make_serial('RA', n), 4, 6))), 0, 'the check character is always right');
select throws_ok($$select public.make_serial('RA', 1000000)$$, 'P0001', null, 'a number beyond six digits is refused');
select is(tests.state('Admin', $$public.make_serial('RA', 1)$$), '42501', 'nobody calls it through the API');
select is(tests.state('Owner A', $$public.validator_scope(null::public.app_user)$$), '42501', 'nor the validator scope helper');

-- A lot made through the app uses the pattern.
create temp table lot as select tests.call('Admin', $$public.create_lot('LOT-RA', 60, 10000, 'PRIMER-1L', 'RA')$$) as r;
select is(tests.call('Admin', format('public.generate_lot_codes(%s, 100)', (select r ->> 'lot_id' from lot))) ->> 'done', 'true', 'codes are generated for the lot');
select is((select count(*)::int from public.coupon c join public.coupon_lot l on l.id = c.lot_id where l.lot_no = 'LOT-RA' and c.serial ~ '^RA-[0-9]{6}-[0-9A-HJKMNP-TV-Z]$'), 60, 'every serial has the new pattern');
select is((select count(distinct c.serial)::int from public.coupon c join public.coupon_lot l on l.id = c.lot_id where l.lot_no = 'LOT-RA'), 60, 'every serial is unique');
select is(tests.err('Admin', $$public.create_lot('LOT-BAD', 5, 10000, 'PRIMER-1L', 'IL')$$), 'BAD_PREFIX', 'a series with look-alike letters is refused');
select is(tests.err('Admin', $$public.create_lot('LOT-BAD2', 1000000, 10000, 'PRIMER-1L', 'RB')$$), 'BAD_QUANTITY', 'quantity limits still apply');
select is(tests.call('Admin', $$public.lookup_coupon('ra-000000-0')$$) ->> 'found', 'false', 'a serial that does not exist is not found');

select * from finish();
rollback;
