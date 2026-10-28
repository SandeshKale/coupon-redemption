-- §5.1 lots: create, generate (incl. collisions), export, void, activate, block (EC-010..EC-015).
begin;
select plan(26);

create temp table l as select tests.call('Admin', $$public.create_lot('LOT-T', 120, 10000, 'PRIMER-1L', 'T26')$$) as r;
grant select on l to authenticated, service_role;
select is((select r ->> 'serial_from' from l), '1', 'serial range starts at 1 for a new prefix');
select is((select r ->> 'serial_to' from l), '120', 'and covers the quantity');
select is(tests.err('Admin', $$public.create_lot('LOT-U', 200001, 10000, 'PRIMER-1L', 'T26')$$), 'BAD_QUANTITY', 'quantity ≤ 2,00,000');
select is((tests.call('Admin', $$public.create_lot('LOT-U', 5, 10000, 'PRIMER-1L', 'T26')$$) ->> 'serial_from')::int, 121, 'next lot continues the series');

select is(tests.err('Admin', format('public.begin_lot_export(%s, null)', (select r ->> 'lot_id' from l))), 'LOT_NOT_GENERATED', 'cannot export before generation');
select is(tests.call('Admin', format('public.generate_lot_codes(%s, 50)', (select r ->> 'lot_id' from l))) ->> 'done', 'false', 'generation in batches');
select is(tests.call('Admin', format('public.generate_lot_codes(%s, 50)', (select r ->> 'lot_id' from l))) ->> 'generated', '100', 'second batch');

-- EC-014: force a collision on the next code, generation retries until the quantity is reached.
create or replace function public.gen_code12() returns text language sql volatile set search_path = public, pg_temp as $$
  select case when (select count(*) from public.coupon c join public.coupon_lot x on x.id = c.lot_id where x.lot_no = 'LOT-T') = 100
              and random() < 0.9
         then (select code from public.coupon where serial = 'P24-0000001')
         else string_agg(substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', (get_byte(r.b, i) & 31) + 1, 1), '' order by i) end
  from (select extensions.gen_random_bytes(12) as b) r, generate_series(0, 11) as i;
$$;
select is(tests.call('Admin', format('public.generate_lot_codes(%s, 50)', (select r ->> 'lot_id' from l))) ->> 'done', 'true', 'EC-014 completes despite collisions');
select is((select count(*)::int from public.coupon c join public.coupon_lot x on x.id = c.lot_id where x.lot_no = 'LOT-T'), 120, 'every serial has a code');
select is((select count(distinct serial_no)::int from public.coupon c join public.coupon_lot x on x.id = c.lot_id where x.lot_no = 'LOT-T'), 120, 'no gaps in serials');
select is((select status from public.coupon_lot where lot_no = 'LOT-T'), 'GENERATED', 'lot GENERATED');

-- Export (EC-015)
create temp table e as select tests.call('Admin', format('public.begin_lot_export(%s, null)', (select r ->> 'lot_id' from l)))::bigint as id;
grant select on e to service_role;
select is(tests.rows('service', format('select * from public.export_lot_page(%s, 0, 10000)', (select id from e))), 120::bigint, 'print file rows');
select ok((select bool_and(public.luhn32_valid(code13)) from public.export_lot_page((select id from e), 0, 10000)), 'every exported code verifies');
select is(tests.rows('Admin', format('select * from public.export_lot_page(%s, 0, 10)', (select id from e))), -1::bigint, 'export pages are service-role only');
select is(tests.state('service', format('public.finish_lot_export(%s, 120, %L)', (select id from e), repeat('a', 64))), 'OK', 'export finished');
select is((select status || ':' || export_count from public.coupon_lot where lot_no = 'LOT-T'), 'EXPORTED:1', 'lot EXPORTED');
select is(tests.err('Admin', format('public.begin_lot_export(%s, null)', (select r ->> 'lot_id' from l))), 'REASON_REQUIRED', 'EC-015 second export needs a reason');
select is(tests.state('Admin', format('public.begin_lot_export(%s, %L)', (select r ->> 'lot_id' from l), 'printer jammed, reprint')), 'OK', 'with a reason it is allowed');
select is((select count(*)::int from public.admin_log where action = 'EXPORT_LOT_START'), 2, 'both exports logged');

-- Void spoiled prints, reconcile
select is(tests.call('Admin', format('public.void_serials(%s, array[%L, %L], %L)', (select r ->> 'lot_id' from l), public.make_serial('T26', 1), lower(public.make_serial('T26', 2)), 'spoiled')) ->> 'void', '2',
  'spoiled serials voided');
select is(tests.call('Admin', format('public.void_serials(%s, array[%L], %L)', (select r ->> 'lot_id' from l), public.make_serial('T26', 1), 'again')) ->> 'msg', 'SERIALS_NOT_VOIDABLE',
  'cannot void twice');
select is(tests.call('Admin', format('public.lot_reconciliation(%s)', (select r ->> 'lot_id' from l))) ->> 'balanced', 'true', 'eligible + void = quantity');

-- Activate a range
select is(tests.call('Admin', format('public.activate_range(%s, 1, 60, %L, %L, %L)', (select r ->> 'lot_id' from l), 'PRIMER-1L', 'B-77', tests.today() - 1)) ->> 'activated', '58',
  'activation skips voided serials');
select is(tests.call('Admin', format('public.activate_range(%s, 1, 60, %L, %L, %L)', (select r ->> 'lot_id' from l), 'PRIMER-1L', 'B-77', tests.today() - 1)) ->> 'activated', '0',
  'activating twice changes nothing');
select is(tests.err('Admin', format('public.activate_range(%s, 1, 500, %L, %L, %L)', (select r ->> 'lot_id' from l), 'PRIMER-1L', 'B-77', tests.today())), 'BAD_RANGE',
  'range must be inside the lot');
select is(tests.call('Admin', format('public.block_range(%s, 50, 60, %L)', (select r ->> 'lot_id' from l), 'recall batch B-77')) ->> 'blocked', '11', 'block a range');

select * from finish();
rollback;
