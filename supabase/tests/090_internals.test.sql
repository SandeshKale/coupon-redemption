-- Direct unit tests for internal helpers (called only from other functions).
begin;
select plan(43);

-- identity
select tests.claims('Owner A');
select is((public.me()).name, 'Owner A', 'me() returns the caller');
select tests.claims('Inactive Staff');
select is((public.me()).status, 'INACTIVE', 'me() returns inactive users too (assert_role decides)');
select set_config('request.jwt.claims', '', true);
select is(tests.state('Owner A', '(public.me()).id'), '42501', 'me() is not callable via the API');
select tests.claims('Owner A');
select is((public.assert_role(array['DEALER_OWNER'])).id, 1::bigint, 'assert_role returns the user');
select throws_ok($$select public.assert_role(array['M24_ADMIN'])$$, 'PT403', 'FORBIDDEN', 'assert_role refuses other roles');
select tests.claims('Admin', 'aal1');
select throws_ok($$select public.assert_role(array['M24_ADMIN'])$$, 'PT403', 'MFA_REQUIRED', 'assert_role demands aal2 for 24M');
select tests.claims('Distributor Pune');
select throws_ok($$select public.assert_can_manage_user('DEALER_OWNER', 9, null)$$, 'PT403', 'FORBIDDEN', 'assert_can_manage_user scope');
select set_config('request.jwt.claims', '', true);
select is((public.active_dealer_for((select u from public.app_user u where name = 'Owner A'))).id, 1, 'active_dealer_for: active dealer');
select is((public.active_dealer_for((select u from public.app_user u where name = 'Owner Inactive Dealer'))).id, null, 'active_dealer_for: inactive dealer → null');
update public.distributor set status = 'INACTIVE' where id = 1;
select is((public.active_dealer_for((select u from public.app_user u where name = 'Owner A'))).id, null, 'R1-07 inactive distributor → null');
update public.distributor set status = 'ACTIVE' where id = 1;

-- time, config, request
select is(public.ist_date('2026-10-31 19:00+00'), '2026-11-01'::date, 'ist_date crosses midnight at UTC+05:30');
select is(public.ist_date('2026-10-31 18:29+00'), '2026-10-31'::date, 'and not before');
select is(public.request_ip(), 'unknown', 'request_ip without headers');
select set_config('request.headers', '{"x-forwarded-for": "9.9.9.9, 10.0.0.1"}', true);
select is(public.request_ip(), '9.9.9.9', 'request_ip takes the first forwarded hop');
select set_config('request.headers', '{"cf-connecting-ip": "8.8.8.8", "x-forwarded-for": "9.9.9.9"}', true);
select is(public.request_ip(), '8.8.8.8', 'request_ip prefers Cloudflare');
select ok(public.ip_hash('1.1.1.1') <> public.ip_hash('1.1.1.2') and length(public.ip_hash('1.1.1.1')) = 32, 'ip_hash is a keyed SHA-256');
select is(tests.state('Owner A', $$public.fail('SOMETHING')$$), '42501', 'fail itself is not callable via the API');
select throws_ok($$select public.fail('X')$$, 'PT409', 'X', 'fail uses PT409');

-- logging
select public.log_admin(7, 'TEST_ACTION', 'x');
select is((select count(*)::int from public.admin_log where action = 'TEST_ACTION'), 1, 'log_admin');
select public.log_event((select id from public.coupon where serial = 'P24-0000001'), 'TEST_EVENT', null, null, 7);
select is((select count(*)::int from public.coupon_event where event = 'TEST_EVENT'), 1, 'log_event');
select public.log_scan(1, null, 1, 'TEST_SCAN', 'abcdefghijklmnopqrstuvwxyz');
select is((select code_hint from public.scan_attempt where result = 'TEST_SCAN'), 'abcdefghijklmnopqrst', 'log_scan truncates hints to 20 chars');
select is(public.invalid_scan_brake_active(1), false, 'brake off');

-- claims
select is(public.open_claim_for(1, 1), public.open_claim_for(1, 1), 'open_claim_for is idempotent');
select is(public.release_coupon_rows(array[0]::bigint[], 7, 'none'), 0, 'release_coupon_rows ignores non-held coupons');
select is((public.explain_coupon((select code from public.coupon where serial = 'P24-0000101'), 1, 1)) ->> 'result', 'NOT_ACTIVE', 'explain_coupon');
select tests.redeem('Owner A', array[1]);
select is(public.dist_line_failures((select c from public.coupon c where serial = 'P24-0000001'),
                                    (select d from public.dealer_claim d where dealer_id = 1 and status = 'OPEN')), '{}'::text[], 'dist_line_failures: eligible');
select is(public.dist_line_failures((select c from public.coupon c where serial = 'P24-0000002'),
                                    (select d from public.dealer_claim d where dealer_id = 1 and status = 'OPEN')), '{R2-01,R2-02}'::text[], 'dist_line_failures: not redeemed');
select is(public.m24_line_failures((select c from public.coupon c where serial = 'P24-0000001'),
                                   row(0, 0, 0, (select id from public.dealer_claim where dealer_id = 1 and status = 'OPEN'), 'PENDING', null, null, null)::public.dist_claim_line,
                                   row(0, 1, 'SUBMITTED', 'x', null, now(), null, null, null, null, null, null, null, null, null)::public.dist_claim),
          '{R3-01,R3-02}'::text[], 'm24_line_failures');

-- painter internals
select is(public.reply_text('STOPPED', 'en'), 'Your number has been removed. Thank you.', 'reply_text en');
select ok(public.reply_text('STOPPED', 'hi+en') like '%हटा%' || E'\n\n' || 'Your number%', 'reply_text hi+en: Hindi then English');
select ok(public.reply_text('HELP', 'en', '{"helpline": "123"}') like '%Help: 123', 'reply_text substitutes variables');
create temp table pp as select public.upsert_painter('+919811100000', now()) as p;
select is((select (p).phone_masked from pp), '+91 98•••• 0000', 'upsert_painter stores the masked number');
select is((public.upsert_painter('+919811100000', now())).id, (select (p).id from pp), 'upsert_painter is idempotent by hash');
insert into public.redemption_batch (dealer_id, user_id, coupon_count, value_paise) values (1, 1, 1, 10000);
select ok(public.new_painter_token((select max(id) from public.redemption_batch)) ~ '^[0-9A-HJKMNP-TV-Z]{6}$', 'new_painter_token issues a token');
select is((select expires_at - created_at from public.painter_confirmation where batch_id = (select max(id) from public.redemption_batch)),
          interval '24 hours', 'token valid for 24 h (D11)');
update public.app_config set value = 'false' where key = 'painter_confirmation_enabled';
insert into public.redemption_batch (dealer_id, user_id, coupon_count, value_paise) values (1, 1, 1, 10000);
select is(public.new_painter_token((select max(id) from public.redemption_batch)), null, 'feature flag off → no token');
update public.app_config set value = 'true' where key = 'painter_confirmation_enabled';
select is(public.painter_flags((select p from pp), (select pc from public.painter_confirmation pc order by id limit 1), now()), '{}'::text[], 'painter_flags: clean number');
select ok(public.confirm_reply((select pc from public.painter_confirmation pc order by id limit 1), (select p from pp)) like '%Shree Ganesh Paints%', 'confirm_reply');
select is(public.handle_confirm((select p from pp), 'ZZZZZ9', now(), 'w1') ->> 'result', 'UNKNOWN_TOKEN', 'handle_confirm');
select is(public.handle_dispute((select p from pp), now(), null) ->> 'result', 'DISPUTE_NO_HISTORY', 'handle_dispute with no history');
select ok(public.wa_enqueue('+919811100000', 'hello', null, now() + interval '1 hour', (select (p).id from pp), true) > 0, 'wa_enqueue');
select ok((select body from public.wa_outbox order by id desc limit 1) like 'hello%STOP%', 'wa_enqueue appends the privacy notice once');
select public.anonymise_painter((select (p).id from pp));
select is((select phone_e164 from public.painter where id = (select (p).id from pp)), null, 'anonymise_painter');

select * from finish();
rollback;
