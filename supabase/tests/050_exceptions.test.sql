-- 24M exceptions: hold, release, reverse, dispute resolution, redeem on behalf, lookup (EC-035, EC-036, EC-116).
begin;
select plan(21);

select tests.redeem('Owner A', array[1]);
select tests.redeem('Owner A', array[2]);
create temp table c as select id, serial from public.coupon where serial in ('P24-0000001', 'P24-0000002', 'P24-0000003');
grant select on c to authenticated;

-- hold / release
select is(tests.err('Admin', format('public.hold_coupons(array[%s]::bigint[], %L)', (select id from c where serial = 'P24-0000001'), 'x')), 'REASON_REQUIRED', 'hold needs a reason');
select is(tests.call('Admin', format('public.hold_coupons(array[%s]::bigint[], %L)', (select id from c where serial = 'P24-0000001'), 'investigate dealer'))::int, 1, 'hold');
select is(tests.status('P24-0000001'), 'ON_HOLD', 'ON_HOLD');
select is(tests.call('Admin', format('public.hold_coupons(array[%s]::bigint[], %L)', (select id from c where serial = 'P24-0000003'), 'not redeemed yet'))::int, 0,
  'active coupons cannot be held');
select is(tests.call('Admin', format('public.release_coupons(array[%s]::bigint[], %L)', (select id from c where serial = 'P24-0000001'), 'ok'))::int, 1, 'release');
select is(tests.status('P24-0000001'), 'REDEEMED', 'back to the prior status');

-- reverse (EC-035) before distributor close; refused after (EC-036)
select is(tests.state('Admin', format('public.reverse_redemption(%s, %L)', (select id from c where serial = 'P24-0000002'), 'wrong dealer account')), 'OK', 'EC-035 reversal');
select is(tests.status('P24-0000002'), 'ACTIVE', 'coupon ACTIVE again');
select is((select redeemed_dealer_id from public.coupon where serial = 'P24-0000002'), null, 'redemption fields cleared');
select is((select status from public.dealer_claim_line l where l.coupon_id = (select id from c where serial = 'P24-0000002')), 'REVERSED', 'claim line REVERSED');
select is(tests.redeem('Owner B', array[2]) ->> 'result', 'REDEEMED', 'the right dealer can now redeem it');
select tests.call('Owner A', 'public.submit_dealer_claim()');
select tests.call('Distributor Pune', format('public.dist_decide(%s, null, %L)', id, 'APPROVE')) from public.dealer_claim where dealer_id = 1 and status = 'SUBMITTED';
select tests.call('Distributor Pune', format('public.dist_close_claim(%s, %L, tests.today())', id, 'CN-9')) from public.dealer_claim where dealer_id = 1 and status = 'SUBMITTED';
select is(tests.err('Admin', format('public.reverse_redemption(%s, %L)', (select id from c where serial = 'P24-0000001'), 'too late now')), 'NOT_REVERSIBLE',
  'EC-036 reversal after distributor close refused');

-- EC-116 dispute after distributor approval, before 24M
select tests.call('Distributor Pune', 'public.create_dist_claim()');
select public.hold_batch((select redemption_batch_id from public.coupon where serial = 'P24-0000001'), 'PAINTER_DISPUTE');
update public.painter_confirmation set status = 'DISPUTED', disputed_at = now() where batch_id = (select redemption_batch_id from public.coupon where serial = 'P24-0000001');
select is(tests.call('Admin', format('public.dist_claim_detail(%s)', id)) #>> '{lines,0,failures,0}', 'R3-05', 'EC-116 held at 24M')
  from public.dist_claim where distributor_id = 1;
select is(tests.err('Admin', format('public.release_coupons(array[%s]::bigint[], %L)', (select id from c where serial = 'P24-0000001'), 'x')), 'USE_RESOLVE_DISPUTE',
  'disputed coupons are released only through dispute resolution');
select is(tests.call('Admin', format('public.resolve_dispute(%s, %L, %L)', (select redemption_batch_id from public.coupon where serial = 'P24-0000001'), 'RELEASE', 'called painter, was paid')) ->> 'coupons',
  '1', 'dispute resolved: released');
select is(tests.status('P24-0000001'), 'CLAIMED_TO_24M', 'back to CLAIMED_TO_24M');
select is(tests.err('Admin', format('public.resolve_dispute(%s, %L, %L)', (select redemption_batch_id from public.coupon where serial = 'P24-0000001'), 'REJECT', 'changed my mind')),
  'ALREADY_RESOLVED', 'a dispute is resolved once');

-- redeem on behalf (SOP 6)
select is(tests.call('Admin', format('public.m24_redeem_on_behalf(%L, 1, %L)', 'P24-0000003', 'QR damaged, verified by serial')) ->> 'serial', 'P24-0000003', 'redeem on behalf');
select is((select redeemed_dealer_id from public.coupon where serial = 'P24-0000003'), 1, 'credited to the dealer');

-- lookup
select is(tests.call('Viewer', format('public.lookup_coupon(%L)', 'p24-0000001')) ->> 'found', 'true', 'lookup by serial');
select ok(not (tests.call('Viewer', format('public.lookup_coupon(%L)', 'P24-0000001')) -> 'coupon' ? 'code'), 'lookup never returns the code');

select * from finish();
rollback;
