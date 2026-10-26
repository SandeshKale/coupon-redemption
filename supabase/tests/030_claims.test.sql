-- Full cycle ACTIVE → REDEEMED → DIST_CN_ISSUED → CLAIMED_TO_24M → SETTLED (§5.3, §5.4, EC-110..EC-121).
begin;
select plan(45);

select tests.redeem('Owner A', array[1, 2, 3]);
select tests.redeem('Owner A', array[4]);
create temp table k (name text primary key, id bigint);
grant all on k to authenticated;
insert into k select 'dc', id from public.dealer_claim where dealer_id = 1 and status = 'OPEN';

-- Dealer submits (EC-111: not with zero lines)
select is(tests.err('Owner B', 'public.submit_dealer_claim()'), 'NO_OPEN_CLAIM', 'dealer without redemptions has nothing to submit');
select is(tests.state('Staff A', 'public.submit_dealer_claim()'), 'PT403', 'staff cannot submit claims');
select is(tests.call('Owner A', 'public.submit_dealer_claim()')::bigint, (select id from k where name = 'dc'), 'owner submits');
select is((select status from public.dealer_claim where id = (select id from k where name = 'dc')), 'SUBMITTED', 'claim SUBMITTED');

-- New redemption after submit opens a new claim (EC-110: always exactly one open)
select tests.redeem('Owner A', array[5]);
select is((select count(*)::int from public.dealer_claim where dealer_id = 1 and status = 'OPEN'), 1, 'a new OPEN claim');

-- Distributor: own claims only (EC-114)
select is(tests.state('Distributor Mumbai', format('public.dist_decide(%s, null, %L)', (select id from k where name = 'dc'), 'APPROVE')), 'PT403',
  'EC-114 other distributor is FORBIDDEN');
select is(tests.call('Distributor Pune', format('public.get_claim_by_slip(%L)', (select slip_token from public.dealer_claim where id = (select id from k where name = 'dc')))) ->> 'claim_id',
  (select id from k where name = 'dc')::text, 'slip QR opens the claim');
select is(jsonb_array_length(tests.call('Distributor Pune', format('public.dealer_claim_detail(%s)', (select id from k where name = 'dc'))) -> 'lines'), 4,
  'detail shows 4 lines');
select is(tests.call('Distributor Pune', format('public.dealer_claim_detail(%s)', (select id from k where name = 'dc'))) -> 'lines' -> 0 ->> 'painter_status', 'PENDING',
  'painter status shown per line');

-- Hold one line, reject one (reason required), approve the rest
select is(tests.err('Distributor Pune', format('public.dist_decide(%s, array[%s]::bigint[], %L, %L)', (select id from k where name = 'dc'),
  (select id from public.coupon where serial = 'P24-0000002'), 'REJECT', null)), 'REASON_REQUIRED', 'rejection needs a reason code');
select is((tests.call('Distributor Pune', format('public.dist_decide(%s, array[%s]::bigint[], %L, %L)', (select id from k where name = 'dc'),
  (select id from public.coupon where serial = 'P24-0000002'), 'REJECT', 'SUSPECTED_FRAUD')) ->> 'decided')::int, 1, 'line rejected');
select is(tests.status('P24-0000002'), 'DIST_REJECTED', 'coupon DIST_REJECTED');
select is((tests.call('Distributor Pune', format('public.dist_decide(%s, array[%s]::bigint[], %L, %L)', (select id from k where name = 'dc'),
  (select id from public.coupon where serial = 'P24-0000003'), 'HOLD', 'call dealer')) ->> 'decided')::int, 1, 'line held');
select is(tests.err('Distributor Pune', format('public.dist_close_claim(%s, %L, tests.today())', (select id from k where name = 'dc'), 'CN-1')), 'LINES_PENDING',
  'cannot close with pending lines');
select is((tests.call('Distributor Pune', format('public.dist_decide(%s, null, %L)', (select id from k where name = 'dc'), 'APPROVE')) ->> 'decided')::int, 2,
  'approve all eligible');

-- Close with CN (EC-112, EC-113)
select is(tests.err('Distributor Pune', format('public.dist_close_claim(%s, %L, tests.today() + 1)', (select id from k where name = 'dc'), 'CN-1')), 'BAD_CN_DATE',
  'EC-113 CN date in the future refused');
select is(tests.err('Distributor Pune', format('public.dist_close_claim(%s, %L, tests.today() - 40)', (select id from k where name = 'dc'), 'CN-1')), 'BAD_CN_DATE',
  'EC-113 CN date before submission refused');
select is(tests.err('Distributor Pune', format('public.dist_close_claim(%s, null, tests.today())', (select id from k where name = 'dc'))), 'CN_REQUIRED', 'CN number required');
select is((tests.call('Distributor Pune', format('public.dist_close_claim(%s, %L, tests.today())', (select id from k where name = 'dc'), 'CN-1')) ->> 'total_paise')::int,
  20000, 'R2-07 total computed by the system (2 × ₹100)');
select is(tests.status('P24-0000001'), 'DIST_CN_ISSUED', 'approved coupon DIST_CN_ISSUED');
select is((select l.status from public.dealer_claim_line l join public.coupon c on c.id = l.coupon_id where c.serial = 'P24-0000003' and l.claim_id = (select id from k where name = 'dc')),
  'MOVED', 'EC-115 held line moved…');
select is((select dc.status from public.coupon c join public.dealer_claim dc on dc.id = c.dealer_claim_id where c.serial = 'P24-0000003'), 'OPEN',
  '…to the dealer''s next open claim');

-- Duplicate CN on the next claim (EC-112)
select tests.call('Owner A', 'public.submit_dealer_claim()');
insert into k select 'dc2', id from public.dealer_claim where dealer_id = 1 and status = 'SUBMITTED';
select tests.call('Distributor Pune', format('public.dist_decide(%s, null, %L)', (select id from k where name = 'dc2'), 'APPROVE'));
select is(tests.err('Distributor Pune', format('public.dist_close_claim(%s, %L, tests.today())', (select id from k where name = 'dc2'), 'cn-1')), 'DUPLICATE_CN',
  'EC-112 duplicate CN refused (case-insensitive)');
select tests.call('Distributor Pune', format('public.dist_close_claim(%s, %L, tests.today())', (select id from k where name = 'dc2'), 'CN-2'));

-- Dealer acknowledges
select is(tests.state('Owner B', format('public.ack_dealer_cn(%s)', (select id from k where name = 'dc'))), 'PT409', 'other dealer cannot acknowledge');
select is(tests.state('Owner A', format('public.ack_dealer_cn(%s)', (select id from k where name = 'dc'))), 'OK', 'dealer marks CN received');
select is((select status from public.dealer_claim where id = (select id from k where name = 'dc')), 'ACKNOWLEDGED', 'ACKNOWLEDGED');

-- Distributor claim to 24M
select is((tests.call('Distributor Pune', 'public.create_dist_claim()') ->> 'count')::int, 4, 'claim to 24M picks all CN-issued, unclaimed coupons');
insert into k select 'x', id from public.dist_claim where distributor_id = 1;
select is(tests.status('P24-0000001'), 'CLAIMED_TO_24M', 'coupon CLAIMED_TO_24M');
select is(tests.err('Distributor Pune', 'public.create_dist_claim()'), 'NOTHING_TO_CLAIM', 'R3-03 nothing left to claim twice');

-- 24M maker
select is(tests.state('Finance', format('public.m24_decide(%s, null, %L)', (select id from k where name = 'x'), 'APPROVE')), 'PT403', 'finance is not the maker');
select is(tests.state('Admin', format('public.m24_decide(%s, null, %L)', (select id from k where name = 'x'), 'APPROVE'), 'aal1'), 'PT403',
  'EC-137 24M functions require aal2');
select is((tests.call('Admin', format('public.m24_decide(%s, array[%s]::bigint[], %L, %L)', (select id from k where name = 'x'),
  (select id from public.coupon where serial = 'P24-0000004'), 'REJECT', 'not eligible')) ->> 'decided')::int, 1, 'maker rejects a line');
select is(tests.status('P24-0000004'), 'M24_REJECTED', 'EC-118 M24_REJECTED after dealer was credited');
select is((tests.call('Admin', format('public.m24_decide(%s, null, %L)', (select id from k where name = 'x'), 'APPROVE')) ->> 'decided')::int, 3, 'maker approves the rest');
select is((tests.call('Admin', format('public.m24_validate_claim(%s)', (select id from k where name = 'x'))) ->> 'total_paise')::int, 30000, 'validated total');

-- 24M checker (EC-117)
update public.app_user set role = 'M24_FINANCE' where name = 'Admin Two';
select is(tests.err('Admin', format('public.m24_settle(%s, %L, tests.today())', (select id from k where name = 'x'), 'M24-CN-1')), 'FORBIDDEN', 'admin cannot settle');
update public.dist_claim set validated_by = (select id from public.app_user where name = 'Admin Two') where id = (select id from k where name = 'x');
select is(tests.err('Admin Two', format('public.m24_settle(%s, %L, tests.today())', (select id from k where name = 'x'), 'M24-CN-1')), 'MAKER_CANNOT_SETTLE',
  'EC-117 maker = checker refused');
select throws_ok(format('update public.dist_claim set settled_by = validated_by where id = %s', (select id from k where name = 'x')), '23514', null,
  'R3-06 maker ≠ checker is also a database constraint');
update public.dist_claim set validated_by = (select id from public.app_user where name = 'Admin') where id = (select id from k where name = 'x');
select is((tests.call('Finance', format('public.m24_settle(%s, %L, tests.today())', (select id from k where name = 'x'), 'M24-CN-1')) ->> 'count')::int, 3,
  'checker settles with the 24M CN');
select is(tests.status('P24-0000001'), 'SETTLED', 'coupon SETTLED');
select is(tests.rows('Finance', format('select * from public.m24_settlement_export(%s)', (select id from k where name = 'x'))), 3::bigint, 'ERP export rows');
select is((select count(*)::int from public.coupon_event e join public.coupon c on c.id = e.coupon_id where c.serial = 'P24-0000001'), 4,
  'full history: redeemed, CN, claimed, settled');

-- Second settle with the same 24M CN (R3-07)
select tests.redeem('Owner A', array[20]);
update public.dealer_claim set status = 'SUBMITTED', submitted_at = now() where dealer_id = 1 and status = 'OPEN';
select tests.call('Distributor Pune', format('public.dist_decide(%s, null, %L)', id, 'APPROVE')) from public.dealer_claim where dealer_id = 1 and status = 'SUBMITTED';
select tests.call('Distributor Pune', format('public.dist_close_claim(%s, %L, tests.today())', id, 'CN-3')) from public.dealer_claim where dealer_id = 1 and status = 'SUBMITTED';
select tests.call('Distributor Pune', 'public.create_dist_claim()');
select tests.call('Admin', format('public.m24_decide(%s, null, %L)', id, 'APPROVE')) from public.dist_claim where status = 'SUBMITTED';
select tests.call('Admin', format('public.m24_validate_claim(%s)', id)) from public.dist_claim where status = 'SUBMITTED';
select is(tests.err('Finance', format('public.m24_settle(%s, %L, tests.today())', id, 'm24-cn-1')), 'DUPLICATE_CN', 'R3-07 24M CN unique')
  from public.dist_claim where status = 'VALIDATED';

-- R2-04 window boundary (EC-119)
select tests.redeem('Owner B', array[30, 31]);
update public.coupon set redeemed_at = now() - interval '90 days' where serial = 'P24-0000030';
update public.coupon set redeemed_at = now() - interval '90 days 1 second' where serial = 'P24-0000031';
update public.dealer_claim set status = 'SUBMITTED', submitted_at = now() where dealer_id = 2 and status = 'OPEN';
select is(tests.call('Distributor Pune', format('public.dealer_claim_detail(%s)', id)) #> '{lines,0,failures}', '[]'::jsonb, 'EC-119 exactly 90 days: eligible')
  from public.dealer_claim where dealer_id = 2 and status = 'SUBMITTED';
select is(tests.call('Distributor Pune', format('public.dealer_claim_detail(%s)', id)) #> '{lines,1,failures}', '["R2-04"]'::jsonb, 'EC-119 90 days + 1 s: out of window')
  from public.dealer_claim where dealer_id = 2 and status = 'SUBMITTED';

select * from finish();
rollback;
