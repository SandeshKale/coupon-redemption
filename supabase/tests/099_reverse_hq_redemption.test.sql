-- 0023: a 24M admin can undo a redemption made by HQ; nobody and nothing else can.
begin;
select plan(15);

select tests.call('Owner A', format('public.validate_coupon(%L)', tests.code13('P24-0000010')));
select tests.call('Finance', $$public.redeem_coupons(array['P24-0000010'], 'CN-77')$$);
create temp table cp as select id from public.coupon where serial = 'P24-0000010';
grant select on cp to authenticated;

select is(tests.err('Admin', format('public.hold_coupons(array[%s]::bigint[], %L)', (select id from cp), 'checking')), 'NOT_HOLDABLE', 'a coupon redeemed by HQ cannot be held');
select is(tests.state('Finance', format('public.reverse_redemption(%s, %L)', (select id from cp), 'wrong credit note')), 'PT403', 'finance cannot reverse');
select is(tests.err('Admin', format('public.reverse_redemption(%s, %L)', (select id from cp), 'no')), 'REASON_REQUIRED', 'a reason is needed');
select is(tests.state('Admin', format('public.reverse_redemption(%s, %L)', (select id from cp), 'wrong credit note')), 'OK', 'a 24M admin reverses it');
select is(tests.status('P24-0000010'), 'VALIDATED', 'back to validated');
select is((select hq_redeemed_at from public.coupon where serial = 'P24-0000010'), null::timestamptz, 'the HQ redemption time is cleared');
select is((select credit_note_ref from public.coupon where serial = 'P24-0000010'), null, 'and the credit note');
select ok((select e.ref like '%CN-77%' and e.from_status = 'REDEEMED' and e.to_status = 'VALIDATED'
             from public.coupon_event e where e.event = 'REVERSED' and e.coupon_id = (select id from cp)), 'the history keeps the old credit note');
select is((select details ->> 'credit_note_ref' from public.admin_log where action = 'REVERSE_REDEMPTION' order by id desc limit 1), 'CN-77', 'the admin log keeps it too');
select isnt((select redeemed_at from public.coupon where serial = 'P24-0000010'), null, 'the dealer validation is untouched');
select is(tests.call('Admin', format('public.hold_coupons(array[%s]::bigint[], %L)', (select id from cp), 'now it can be held'))::int, 1, 'after the reversal it can be held');
select is(tests.call('Admin', format('public.release_coupons(array[%s]::bigint[], %L)', (select id from cp), 'ok'))::int, 1, 'and released');
select is(tests.call('Finance', $$public.redeem_coupons(array['P24-0000010'], 'CN-78')$$) ->> 'redeemed', '1', 'redeemed again with the right credit note');
select throws_ok($$update public.coupon set status = 'ACTIVE' where serial = 'P24-0000010'$$, 'P0001', null, 'a redeemed coupon still cannot be changed by hand');
select throws_ok($$update public.coupon set hq_redeemed_at = null, credit_note_ref = null where serial = 'P24-0000010'$$, 'P0001', null, 'nor stripped of its redemption outside the reversal');

select * from finish();
rollback;
