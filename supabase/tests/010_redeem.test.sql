-- §13.1 redeem / check_coupon / outcome / receipt (EC-010..EC-036, EC-042, EC-057).
begin;
select plan(52);

-- ── check_coupon ──
select is(tests.call('Owner A', format('public.check_coupon(%L)', tests.code13('P24-0000001'))) ->> 'result', 'VALID', 'R1 valid coupon');
select is(tests.call('Owner A', format('public.check_coupon(%L)', lower(public.display_code(tests.code13('P24-0000001'))))) ->> 'result', 'VALID',
  'EC-001/002 lowercase grouped input accepted server-side');
select is(tests.call('Owner A', format('public.check_coupon(%L)', 'https://c.example.in/c/' || tests.code13('P24-0000001') || '?utm=x')) ->> 'result', 'VALID',
  'EC-007/009 URL with tracking params accepted');
select is((tests.call('Owner A', format('public.check_coupon(%L)', tests.code13('P24-0000001'))) ->> 'value_paise')::int, 10000, 'value returned');
select is(tests.call('Owner A', format('public.check_coupon(%L)', tests.code13('P24-0000001'))) ->> 'product', '24M Primer 1 L', 'product returned');
select is(tests.call('Owner A', $$public.check_coupon('0000000000000')$$) ->> 'result', 'NOT_FOUND', 'R1-02 unknown code');
select is(tests.call('Owner A', format('public.check_coupon(%L)', tests.code13('P24-0000101'))) ->> 'result', 'NOT_ACTIVE', 'R1-03 / EC-010 lot not activated');
select is(tests.call('Owner A', format('public.check_coupon(%L)', tests.code13('P24-0000121'))) ->> 'result', 'BLOCKED', 'R1-04 / EC-011 blocked range');
select is(tests.call('Owner A', $$public.check_coupon('ABC')$$) ->> 'result', 'INVALID_FORMAT', 'R1-01 bad format');
select is(tests.call('Owner A', format('public.check_coupon(%L)', left(tests.code13('P24-0000001'), 12)
  || case when right(tests.code13('P24-0000001'), 1) = '0' then '1' else '0' end)) ->> 'result', 'INVALID_FORMAT', 'R1-01 wrong check character');
select is(tests.call('Owner Inactive Dealer', format('public.check_coupon(%L)', tests.code13('P24-0000001'))) ->> 'result', 'DEALER_INACTIVE', 'R1-07 inactive dealer');
select is(tests.state('Inactive Staff', format('public.check_coupon(%L)', tests.code13('P24-0000001'))), 'PT403', 'R1-09 inactive user is FORBIDDEN');
select is(tests.state('Distributor Pune', format('public.check_coupon(%L)', tests.code13('P24-0000001'))), 'PT403', 'R1-09 wrong role is FORBIDDEN');
select is(tests.state('anon', format('public.check_coupon(%L)', tests.code13('P24-0000001'))), '42501', 'anon cannot call check_coupon');
select is(tests.state('00000000-0000-0000-0000-0000000000ff', $$public.check_coupon('x')$$), 'PT401', 'unknown auth user → AUTH_REQUIRED');

-- EC-013 expiry boundary: at exactly expires_at the coupon is expired.
update public.coupon set expires_at = '2026-11-01 00:00+05:30' where serial = 'P24-0000090';
select tests.freeze('2026-10-31 23:59:59+05:30');
select is(tests.call('Owner A', format('public.check_coupon(%L)', tests.code13('P24-0000090'))) ->> 'result', 'VALID', 'one second before expiry: valid');
select tests.freeze('2026-11-01 00:00+05:30');
select is(tests.call('Owner A', format('public.check_coupon(%L)', tests.code13('P24-0000090'))) ->> 'result', 'EXPIRED', 'EC-013 at expires_at: expired');
select is(tests.redeem('Owner A', array[90]) ->> 'result', 'NONE_REDEEMED', 'expired coupon cannot be redeemed');
select tests.thaw();

-- ── redeem happy path ──
select is(tests.redeem('Owner A', array[1]) ->> 'result', 'REDEEMED', 'redeem one');
select is(tests.status('P24-0000001'), 'REDEEMED', 'coupon is REDEEMED');
select is((select routed_distributor_id from public.coupon where serial = 'P24-0000001'), 1, 'auto-routed to the dealer''s distributor');
select is((select count(*)::int from public.dealer_claim_line l join public.coupon c on c.id = l.coupon_id where c.serial = 'P24-0000001'), 1,
  'joined the dealer''s open claim');
select is((select count(*)::int from public.dealer_claim where dealer_id = 1 and status = 'OPEN'), 1, 'exactly one OPEN claim');
select is((select count(*)::int from public.coupon_event e join public.coupon c on c.id = e.coupon_id where c.serial = 'P24-0000001' and e.event = 'REDEEMED'), 1,
  'event logged');
select ok((select pc.token from public.painter_confirmation pc join public.coupon c on c.redemption_batch_id = pc.batch_id where c.serial = 'P24-0000001') ~ '[0-9]',
  'painter token created and contains a digit');

-- EC-020 / EC-021 re-scan
select is(tests.call('Owner A', format('public.check_coupon(%L)', tests.code13('P24-0000001'))) ->> 'result', 'ALREADY_REDEEMED_SELF', 'EC-020 same dealer re-scan');
select ok(tests.call('Owner A', format('public.check_coupon(%L)', tests.code13('P24-0000001'))) ? 'redeemed_at', 'self re-scan shows when');
select is(tests.call('Owner B', format('public.check_coupon(%L)', tests.code13('P24-0000001'))) ->> 'result', 'ALREADY_REDEEMED_OTHER', 'EC-021 other dealer');
select ok(not (tests.call('Owner B', format('public.check_coupon(%L)', tests.code13('P24-0000001'))) ? 'redeemed_at'), 'other dealer learns nothing more');
select is(tests.redeem('Owner B', array[1]) -> 'lines' -> 0 ->> 'result', 'ALREADY_REDEEMED_OTHER', 'second redemption refused');

-- EC-033 staff
select is(tests.redeem('Staff A', array[2]) ->> 'result', 'REDEEMED', 'EC-033 staff can redeem');
select is((select u.name from public.coupon c join public.app_user u on u.id = c.redeemed_user_id where c.serial = 'P24-0000002'), 'Staff A',
  'recorded under the staff user');
select is((select redeemed_dealer_id from public.coupon where serial = 'P24-0000002'), 1, 'credited to the owner''s dealer');

-- ── bulk ──
select is(tests.redeem('Owner A', array[3, 3, 4]) ->> 'count', '2', 'EC-024 duplicates in one request are de-duplicated');
select is(tests.redeem('Owner A', array[3, 5, 101]) ->> 'result', 'PARTIAL', 'EC-027 partial success');
select is((select count(*)::int from public.coupon where serial = 'P24-0000005' and status = 'REDEEMED'), 1, 'valid line of a partial batch redeemed');
select is(tests.redeem('Owner A', array[101, 121]) ->> 'result', 'NONE_REDEEMED', 'EC-026 all invalid');
select ok(not (tests.redeem('Owner A', array[102]) ? 'batch_id'), 'no batch/token when nothing redeemed');
select is(tests.call('Owner A', format('public.redeem(%L::text[], gen_random_uuid())',
  (select array_agg(tests.code13(tests.serial(s))) from generate_series(10, 60) s))) ->> 'result', 'BAD_REQUEST', 'EC-025 51 codes rejected');
select is(tests.call('Owner A', format('public.redeem(%L::text[], gen_random_uuid())',
  (select array_agg(tests.code13(tests.serial(s))) from generate_series(10, 59) s))) ->> 'count', '50', '50 codes accepted');
select is(tests.call('Owner A', $$public.redeem('{}'::text[], gen_random_uuid())$$) ->> 'result', 'BAD_REQUEST', 'empty request rejected');
select is((select count(*)::int from public.painter_confirmation pc join public.redemption_batch b on b.id = pc.batch_id
            where b.coupon_count = 50), 1, 'one painter token covers a 50-coupon batch');

-- ── idempotency (EC-023, EC-042) ──
create temp table idem as select gen_random_uuid() as k;
grant select on idem to authenticated;
select is(
  tests.call('Owner A', format('public.redeem(array[%L], %L::uuid)', tests.code13('P24-0000070'), (select k from idem))),
  tests.call('Owner A', format('public.redeem(array[%L], %L::uuid)', tests.code13('P24-0000070'), (select k from idem))),
  'EC-023/042 replay with the same key returns the identical stored response');
select is((select count(*)::int from public.redemption_batch b join public.coupon c on c.redemption_batch_id = b.id where c.serial = 'P24-0000070'), 1,
  'replay created nothing new');
select is(tests.call('Owner A', format('public.redemption_outcome(%L::uuid)', (select k from idem))) ->> 'found', 'true', 'EC-042 outcome found');
select is(tests.call('Owner A', 'public.redemption_outcome(gen_random_uuid())') ->> 'found', 'false', 'EC-043 unknown key: not redeemed');
select is(tests.call('Owner B', format('public.redemption_outcome(%L::uuid)', (select k from idem))) ->> 'found', 'false', 'outcomes are per user');

-- EC-031 invalid-scan brake
select tests.call('Owner B', $$public.check_coupon('0000000000000')$$) from generate_series(1, 5);
select is(tests.call('Owner B', format('public.check_coupon(%L)', tests.code13('P24-0000080'))) ->> 'result', 'TOO_MANY_INVALID', 'EC-031 brake after 5 invalid scans');
select is(tests.redeem('Owner B', array[80]) ->> 'result', 'TOO_MANY_INVALID', 'brake applies to redeem too');
select tests.freeze(now() + interval '11 minutes');
select is(tests.call('Owner B', format('public.check_coupon(%L)', tests.code13('P24-0000080'))) ->> 'result', 'VALID', 'brake lifts after 10 minutes');
select tests.thaw();

-- EC-028 dealer deactivated between check and confirm
update public.dealer set status = 'INACTIVE' where id = 2;
select is(tests.redeem('Owner B', array[81]) ->> 'result', 'DEALER_INACTIVE', 'EC-028 deactivated dealer cannot redeem');
update public.dealer set status = 'ACTIVE' where id = 2;

-- EC-034 values sum by lot
select is(tests.redeem('Owner A', array[71, 131]) ->> 'value_paise', '25000', 'EC-034 totals sum actual coupon values');

select * from finish();
rollback;
