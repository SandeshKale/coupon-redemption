-- Receipt polling, skip, history, home totals, public lookup, rerouting (EC-030, EC-095, EC-096, EC-153).
begin;
select plan(24);

create temp table r as select tests.redeem('Owner A', array[1, 2]) as resp;
grant select on r to authenticated, service_role;

select is((select resp ->> 'count' from r), '2', 'two coupons redeemed');
select is(tests.call('Owner A', format('public.batch_status(%s)', (select resp ->> 'batch_id' from r))) ->> 'status', 'PENDING', 'receipt: waiting for painter');
select is(tests.call('Owner A', format('public.batch_status(%s)', (select resp ->> 'batch_id' from r))) ->> 'token', (select resp ->> 'painter_token' from r),
  'EC-096 token re-showable from status');
select is(tests.call('Staff A', format('public.batch_status(%s)', (select resp ->> 'batch_id' from r))) ->> 'status', 'PENDING', 'staff of the same dealer can see it');
select is(tests.call('Owner B', format('public.batch_status(%s)', (select resp ->> 'batch_id' from r))) ->> 'msg', 'NOT_FOUND', 'other dealer cannot');

select is(jsonb_array_length(tests.call('Owner A', 'public.my_batches(10, null)')), 1, 'history lists the batch');
select is(tests.call('Owner A', 'public.my_batches(10, null)') -> 0 ->> 'token', (select resp ->> 'painter_token' from r), 'history carries the open token');
select is(tests.call('Owner B', 'public.my_batches(10, null)'), '[]'::jsonb, 'history is per dealer');

select is((tests.call('Owner A', 'public.dealer_home()') ->> 'today_count')::int, 2, 'home: today count');
select is((tests.call('Owner A', 'public.dealer_home()') ->> 'month_paise')::int, 20000, 'home: month value in paise');
select is((tests.call('Owner A', 'public.dealer_home()') ->> 'pending_painter')::int, 1, 'home: pending painter confirmations');

-- Token expires after 24 h: no longer shown.
select tests.freeze(now() + interval '25 hours');
select is(tests.call('Owner A', format('public.batch_status(%s)', (select resp ->> 'batch_id' from r))) ->> 'status', 'EXPIRED', 'expired after 24 h');
select ok(tests.call('Owner A', format('public.batch_status(%s)', (select resp ->> 'batch_id' from r))) -> 'token' = 'null'::jsonb, 'expired token is not shown');
select tests.thaw();

-- EC-095 skip
select is(tests.call('Owner A', format('public.skip_painter_confirmation(%s, %L)', (select resp ->> 'batch_id' from r), 'NO_WHATSAPP')) ->> 'status', 'SKIPPED',
  'EC-095 painter has no WhatsApp');
select is(tests.call('Owner A', format('public.skip_painter_confirmation(%s, %L)', (select resp ->> 'batch_id' from r), 'NO_WHATSAPP')) ->> 'msg', 'NOT_PENDING',
  'cannot skip twice');
select is(tests.call('Owner A', format('public.skip_painter_confirmation(%s, %L)', (select resp ->> 'batch_id' from r), 'BECAUSE')) ->> 'msg', 'BAD_REQUEST',
  'skip reason is validated');

-- EC-030 distributor mapping at confirm time
update public.dealer set distributor_id = 2 where id = 3;
select is((select routed_distributor_id from public.coupon c where c.serial = 'P24-0000003'), null, 'not yet redeemed');
insert into public.app_user (auth_user_id, name, role, dealer_id) values ('00000000-0000-0000-0000-0000000000a3', 'Owner Three', 'DEALER_OWNER', 3);
select is(tests.redeem('Owner Three', array[3]) ->> 'result', 'REDEEMED', 'dealer 3 redeems after remap');
select is((select routed_distributor_id from public.coupon c where c.serial = 'P24-0000003'), 2, 'EC-030 routed using the mapping at confirm time');

-- Public genuineness page (anon)
select is(tests.call('anon', format('public.public_coupon_info(%L)', tests.code13('P24-0000040'))) ->> 'result', 'GENUINE', 'anon: genuine coupon');
select ok(not (tests.call('anon', format('public.public_coupon_info(%L)', tests.code13('P24-0000001'))) ? 'status'), 'anon learns nothing about redemption status');
select is(tests.call('anon', format('public.public_coupon_info(%L)', tests.code13('P24-0000121'))) ->> 'result', 'NOT_RECOGNISED', 'anon: blocked = not recognised');
select tests.call('anon', $$public.public_coupon_info('x')$$) from generate_series(1, 30);
select is(tests.call('anon', format('public.public_coupon_info(%L)', tests.code13('P24-0000040'))) ->> 'result', 'RATE_LIMITED', 'EC-153 per-IP limit');
select is((select count(*)::int from public.public_lookup), 30, 'lookups beyond the limit are not even recorded');

select * from finish();
rollback;
