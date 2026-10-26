-- §20.4.2: each table × role sees only permitted rows (EC-150, EC-151).
begin;
select plan(30);

select tests.redeem('Owner A', array[1, 2]);
select tests.redeem('Owner B', array[3]);
select tests.redeem('Owner Mumbai', array[4]);
select tests.wa('+919811111111', 'CONFIRM', (select token from public.painter_confirmation order by id limit 1));

-- coupon
select is(tests.rows('Owner A', 'select id from public.coupon'), 2::bigint, 'dealer sees only own redeemed coupons');
select is(tests.rows('Staff A', 'select id from public.coupon'), 2::bigint, 'staff sees the dealer''s coupons');
select is(tests.rows('Owner B', 'select id from public.coupon'), 1::bigint, 'EC-151 another dealer sees only theirs');
select is(tests.rows('Distributor Pune', 'select id from public.coupon'), 3::bigint, 'distributor sees routed coupons');
select is(tests.rows('Distributor Mumbai', 'select id from public.coupon'), 1::bigint, 'other distributor sees only theirs');
select is(tests.rows('Viewer', 'select id from public.coupon'), (select count(*) from public.coupon), '24M sees all');
select is(tests.rows('Viewer', 'select id from public.coupon', 'aal1'), 0::bigint, '24M without MFA sees nothing');
select is(tests.rows('Inactive Staff', 'select id from public.coupon'), 0::bigint, 'inactive user sees nothing');
select is(tests.rows('Owner A', 'select code from public.coupon'), -1::bigint, 'code column is never selectable');

-- masters and users
select is(tests.rows('Owner A', 'select * from public.dealer'), 1::bigint, 'dealer sees itself');
select is(tests.rows('Distributor Pune', 'select * from public.dealer'), 8::bigint, 'distributor sees own dealers');
select is(tests.rows('Owner A', 'select * from public.distributor'), 1::bigint, 'dealer sees its distributor');
select is(tests.rows('Owner A', 'select * from public.app_user'), 3::bigint, 'owner sees own dealer''s users');
select is(tests.rows('Staff A', 'select * from public.app_user'), 1::bigint, 'staff sees only self');
select is(tests.rows('Distributor Pune', 'select * from public.app_user where role like ''DEALER%'''), 4::bigint, 'distributor sees its dealers'' users (incl. inactive)');

-- claims
select is(tests.rows('Owner A', 'select * from public.dealer_claim'), 1::bigint, 'owner sees own claim');
select is(tests.rows('Staff A', 'select * from public.dealer_claim'), 0::bigint, 'staff do not see claims');
select is(tests.rows('Distributor Mumbai', 'select * from public.dealer_claim'), 1::bigint, 'distributor sees own dealers'' claims');
select is(tests.rows('Owner A', 'select * from public.dealer_claim_line'), 2::bigint, 'claim lines follow claim visibility');

-- painter data
select is(tests.rows('Owner A', 'select * from public.painter_confirmation'), 1::bigint, 'dealer sees own painter confirmations');
select is(tests.rows('Owner B', 'select * from public.painter_confirmation'), 1::bigint, 'another dealer sees only theirs');
select is(tests.rows('Owner A', 'select id, phone_masked from public.painter'), 1::bigint, 'dealer sees the masked painter linked to its batch');
select is(tests.rows('Owner B', 'select id, phone_masked from public.painter'), 0::bigint, 'and no other painters');
select is(tests.rows('Admin', 'select phone_e164 from public.painter'), -1::bigint, 'full numbers not selectable even for 24M (use painter_detail)');
select is(tests.rows('Owner A', 'select * from public.wa_inbound'), 0::bigint, 'dealers never see inbound messages');
select is(tests.rows('Finance', 'select * from public.wa_inbound'), 0::bigint, 'only 24M admin sees inbound messages');
select is(tests.rows('Admin', 'select * from public.wa_inbound'), 1::bigint, '24M admin sees inbound messages');

-- audit
select is(tests.rows('Owner A', 'select * from public.admin_log'), 0::bigint, 'admin log is 24M admin only');
select is(tests.rows('Owner A', 'select * from public.idempotency'), -1::bigint, 'idempotency is never readable');
select is(tests.rows('Owner A', 'select * from public.scan_attempt'), 2::bigint, 'users see their own scan attempts');

select * from finish();
rollback;
