-- 0015: dealer chooses Paid or Declined to pay; no painter confirmation by default.
begin;
select plan(12);

update public.app_config set value = 'false' where key = 'painter_confirmation_enabled';
create temp table code as select public.code13(c.code) as c13, c.code as c12 from public.coupon c where c.serial = 'P24-0000001';
grant select on code to authenticated;

-- Paid: redeem works and creates no painter confirmation.
create temp table r as select tests.redeem('Owner A', array[1]) as resp;
grant select on r to authenticated;
select is((select resp ->> 'result' from r), 'REDEEMED', 'paid: coupon redeemed');
select ok((select resp -> 'painter_token' from r) is null or (select resp -> 'painter_token' from r) = 'null'::jsonb, 'paid: no painter token');
select is((select count(*)::int from public.painter_confirmation), 0, 'paid: no painter confirmation row');
select is(tests.call('Owner A', format('public.batch_status(%s)', (select resp ->> 'batch_id' from r))) ->> 'status', 'NONE', 'paid: receipt has nothing to wait for');

-- Declined: logged, coupon untouched and still payable later.
select is(tests.call('Owner A', format('public.decline_payment(%L)', (select c13 from code))) ->> 'result', 'ALREADY_REDEEMED_SELF', 'declining an already redeemed coupon explains why instead');
select is(tests.call('Owner A', format('public.decline_payment(%L)', public.code13((select code from public.coupon where serial = 'P24-0000002')))) ->> 'result', 'DECLINED', 'declined: recorded');
select is((select status from public.coupon where serial = 'P24-0000002'), 'ACTIVE', 'declined: coupon stays ACTIVE');
select is((select count(*)::int from public.scan_attempt where result = 'DECLINED' and coupon_id = (select id from public.coupon where serial = 'P24-0000002')), 1, 'declined: one audit row');
select is((select count(*)::int from public.coupon where serial = 'P24-0000002' and dealer_claim_id is not null), 0, 'declined: nothing claimed');
select is(tests.call('Owner A', 'public.decline_payment(''nonsense'')') ->> 'result', 'INVALID_FORMAT', 'declined: bad code is rejected');
select is(tests.call('Owner A', format('public.redeem(%L::text[], gen_random_uuid())', array[public.code13((select code from public.coupon where serial = 'P24-0000002'))])) ->> 'result', 'REDEEMED', 'a declined coupon can still be paid later');
select is(tests.call('Owner B', 'public.dealer_home()') ->> 'today_count', '0', 'other dealers are unaffected');

select * from finish();
rollback;
