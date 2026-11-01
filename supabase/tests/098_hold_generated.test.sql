-- 0021 and 0022: generated and active coupons can be held (tested, spoiled or destroyed) and released again.
begin;
select plan(30);

select is(tests.err('Admin', format('public.hold_coupons(array[%s]::bigint[], %L)', (select id from public.coupon where serial = 'P24-0000101'), 'x')),
  'REASON_REQUIRED', 'a hold needs a reason');
select is(tests.call('Admin', format('public.hold_coupons(array[%s]::bigint[], %L)', (select id from public.coupon where serial = 'P24-0000101'), 'tested at the plant'))::int,
  1, 'a generated coupon can be held');
select is(tests.status('P24-0000101'), 'ON_HOLD', 'it is on hold');
select is((select hold_prior_status from public.coupon where serial = 'P24-0000101'), 'GENERATED', 'and remembers it was only generated');
select is(tests.call('Owner A', format('public.check_coupon(%L)', tests.code13('P24-0000101'))) ->> 'result', 'BLOCKED', 'a dealer sees it as blocked');
select is(tests.call('Owner A', format('public.validate_coupon(%L)', tests.code13('P24-0000101'))) ->> 'result', 'BLOCKED', 'and cannot validate it');
select is(tests.call('anon', format('public.public_coupon_info(%L)', tests.code13('P24-0000101'))) ->> 'result', 'NOT_RECOGNISED', 'the public page does not know it');
select is(tests.call('Admin', format('public.release_coupons(array[%s]::bigint[], %L)', (select id from public.coupon where serial = 'P24-0000101'), 'tested ok'))::int,
  1, 'release puts it back');
select is(tests.status('P24-0000101'), 'GENERATED', 'to generated');
select is(tests.call('Owner A', format('public.check_coupon(%L)', tests.code13('P24-0000101'))) ->> 'result', 'NOT_ACTIVE', 'a dealer sees it as not active again');

-- A run of a lot.
select is(tests.err('Admin', 'public.hold_range(2, 102, 105, ''x'')'), 'REASON_REQUIRED', 'a range hold needs a reason');
select is(tests.err('Admin', 'public.hold_range(2, 105, 102, ''spoiled roll'')'), 'BAD_RANGE', 'the range must run from low to high');
select is(tests.err('Admin', 'public.hold_range(99, 1, 2, ''spoiled roll'')'), 'NOT_FOUND', 'the lot must exist');
select is(tests.call('Admin', 'public.hold_range(2, 102, 105, ''spoiled roll'')') ->> 'held', '4', 'four coupons held');
select is((select count(*)::int from public.coupon where lot_id = 2 and status = 'ON_HOLD'), 4, 'they are on hold');
select is(tests.call('Admin', 'public.hold_range(1, 1, 5, ''tested ones'')') ->> 'held', '5', 'active coupons in a range are held too');
select is(tests.call('Owner A', format('public.check_coupon(%L)', tests.code13('P24-0000001'))) ->> 'result', 'BLOCKED', 'a held active coupon is blocked for a dealer');
select is(tests.call('anon', format('public.public_coupon_info(%L)', tests.code13('P24-0000001'))) ->> 'result', 'NOT_RECOGNISED', 'and unknown to the public');
select is(tests.call('Admin', 'public.hold_range(2, 100, 110, ''destroyed'')') ->> 'held', '6', 'only the generated ones in a wider range are held');
select is(tests.call('Admin', 'public.release_range(2, 100, 110, ''found ok'')') ->> 'released', '10', 'a range release puts them back');
select is((select count(*)::int from public.coupon where lot_id = 2 and status = 'ON_HOLD'), 0, 'none is left on hold');
select is(tests.call('Admin', 'public.release_range(1, 1, 5, ''tests done'')') ->> 'released', '5', 'the held active coupons are released');
select is(tests.call('Owner A', format('public.check_coupon(%L)', tests.code13('P24-0000001'))) ->> 'result', 'VALID', 'and are valid again');
select is((select count(*)::int from public.coupon_event where event = 'HELD'), 16, 'every hold is in the coupon history');
select is((select count(*)::int from public.coupon_event where event = 'RELEASED'), 16, 'every release too');

select is(tests.state('Owner A', 'public.hold_range(2, 102, 105, ''reason text'')'), 'PT403', 'a dealer cannot hold a range');
select is(tests.state('Viewer', 'public.release_range(2, 102, 105, ''note'')'), 'PT403', '24M viewers cannot release a range');
select is(tests.state('anon', 'public.hold_range(2, 102, 105, ''reason text'')'), '42501', 'the public cannot');
select is((select count(*)::int from public.admin_log where action = 'HOLD_RANGE'), 3, 'range holds are in the admin log');
select is((select count(*)::int from public.admin_log where action = 'RELEASE_RANGE'), 2, 'and the releases');

select * from finish();
rollback;
