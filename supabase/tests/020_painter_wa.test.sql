-- §6 painter WhatsApp confirmation (EC-070..EC-099).
begin;
select plan(46);

create temp table b (n int primary key, batch bigint, token text);
grant all on b to authenticated, service_role;
insert into b select 1, (r ->> 'batch_id')::bigint, r ->> 'painter_token' from (select tests.redeem('Owner A', array[1]) as r) x;
insert into b select 2, (r ->> 'batch_id')::bigint, r ->> 'painter_token' from (select tests.redeem('Owner A', array[2, 3]) as r) x;
insert into b select 3, (r ->> 'batch_id')::bigint, r ->> 'painter_token' from (select tests.redeem('Owner B', array[4]) as r) x;

-- EC-070 exact message
select is(tests.wa('+919811111111', 'CONFIRM', (select token from b where n = 1)) ->> 'result', 'CONFIRMED', 'EC-070 confirmed on time');
select is((select status from public.painter_confirmation where batch_id = (select batch from b where n = 1)), 'CONFIRMED', 'status CONFIRMED');
select ok((select reply from (select tests.wa('+919811111111', 'CONFIRM', (select token from b where n = 1)) ->> 'reply' as reply) x) like '%already confirmed%',
  'EC-075 same painter again: already confirmed');
select is((select count(*)::int from public.wa_outbox where to_e164 = '+919811111111'), 2, 'replies queued');
select ok((select body from public.wa_outbox where to_e164 = '+919811111111' order by id limit 1) like '%STOP%',
  'first reply carries the privacy notice (§6.9)');
select ok((select body from public.wa_outbox where to_e164 = '+919811111111' order by id desc limit 1) not like '%Reply STOP%',
  'privacy notice only on first contact');
select ok((select body from public.wa_outbox where to_e164 = '+919811111111' order by id limit 1) like '%Shree Ganesh Paints%',
  'reply names the dealer');
select ok((select body from public.wa_outbox where to_e164 = '+919811111111' order by id limit 1) like '%धन्यवाद%',
  'default reply language is Hindi + English');

-- Receipt sees confirmation (masked)
select is(tests.call('Owner A', format('public.batch_status(%s)', (select batch from b where n = 1))) ->> 'status', 'CONFIRMED', 'receipt: painter confirmed');
select is(tests.call('Owner A', format('public.batch_status(%s)', (select batch from b where n = 1))) ->> 'painter', '+91 98•••• 1111', 'dealer sees masked number only');

-- EC-076 another number uses the token
select is(tests.wa('+919822222222', 'CONFIRM', (select token from b where n = 1)) ->> 'result', 'TOKEN_USED', 'EC-076 token used by another number');
select ok('TOKEN_REUSE' = any (tests.flags((select batch from b where n = 1))), 'flagged on the confirmation');
select is((select status from public.painter where phone_e164 = '+919822222222'), 'WATCH', 'and the second number is on watch');

-- EC-073 on-time vs late boundary
select tests.freeze((select on_time_until from public.painter_confirmation where batch_id = (select batch from b where n = 2)));
select is(tests.wa('+919833333333', 'CONFIRM', (select token from b where n = 2)) ->> 'result', 'CONFIRMED', 'EC-073 at exactly 10:00 → CONFIRMED');
select tests.thaw();
select is(tests.wa('+919833333333', 'HELP') ->> 'result', 'HELP', 'help reply');
select ok((tests.wa('+919833333333', 'HELP') ->> 'reply') like '%+91 20 0000 0000%', 'help reply includes the helpline');

select tests.freeze((select on_time_until + interval '1 second' from public.painter_confirmation where batch_id = (select batch from b where n = 3)));
select is(tests.wa('+919844444444', 'CONFIRM', (select token from b where n = 3)) ->> 'result', 'LATE', 'EC-073 one second later → LATE');
select ok('LATE' = any (tests.flags((select batch from b where n = 3))), 'LATE flag set');
select tests.thaw();

-- EC-084 duplicate webhook
select is(tests.wa('+919855555555', 'HELP', null, 'hi', null, 'wamid.dup') ->> 'result', 'HELP', 'first delivery processed');
select is(tests.wa('+919855555555', 'HELP', null, 'hi', null, 'wamid.dup') ->> 'result', 'DUPLICATE', 'EC-084 duplicate wamid ignored');
select is((select count(*)::int from public.wa_outbox where to_e164 = '+919855555555'), 1, 'only one reply for a duplicate');

-- EC-077 / EC-078 unknown token and brake
select is(tests.wa('+919866666666', 'CONFIRM', 'ZZZZZ9') ->> 'result', 'UNKNOWN_TOKEN', 'EC-077 unknown token');
select tests.wa('+919866666666', 'CONFIRM', 'ZZZZZ' || g) from generate_series(1, 4) g;
select is(tests.wa('+919866666666', 'CONFIRM', 'ZZZZZ8') ->> 'result', 'IGNORED_BRAKE', 'EC-078 6th message within the hour is ignored');
select ok(tests.wa('+919866666666', 'HELP') -> 'reply' = 'null'::jsonb, 'no reply while braked');
select tests.freeze(now() + interval '61 minutes');
select is(tests.wa('+919866666666', 'HELP') ->> 'result', 'HELP', 'brake lifts after an hour');
select tests.thaw();

-- EC-074 expired token (by message time)
insert into b select 4, (r ->> 'batch_id')::bigint, r ->> 'painter_token' from (select tests.redeem('Owner A', array[5]) as r) x;
select tests.freeze(now() + interval '25 hours');
select is(tests.wa('+919877777777', 'CONFIRM', (select token from b where n = 4)) ->> 'result', 'EXPIRED', 'EC-074 after 24 h: expired');
select is((select status from public.painter_confirmation where batch_id = (select batch from b where n = 4)), 'EXPIRED', 'confirmation marked EXPIRED');
select tests.thaw();

-- EC-091 webhook down: late delivery evaluated by message time even after the expiry job ran
insert into b select 5, (r ->> 'batch_id')::bigint, r ->> 'painter_token' from (select tests.redeem('Owner A', array[6]) as r) x;
select tests.freeze(now() + interval '26 hours');
select public.job_expire_painter_tokens();
select is(tests.wa('+919878787878', 'CONFIRM', (select token from b where n = 5), null, now() + interval '30 minutes') ->> 'result', 'LATE',
  'EC-091 delayed webhook: message sent inside window is accepted as LATE');
select is((select status from public.wa_outbox where to_e164 = '+919878787878'), 'EXPIRED_WINDOW',
  'EC-090 but the reply would be outside the free window: never sent');
select tests.thaw();

-- EC-088 timestamps clamped
create temp table fut as select tests.wa('+919888888888', 'HELP', null, null, now() + interval '3 days') as r;
select is((select msg_ts from public.wa_inbound where id = (select (r ->> 'inbound_id')::bigint from fut)), now() + interval '5 minutes',
  'EC-088 future timestamp clamped to now + 5 min');

-- EC-079 self-confirm → hold
insert into b select 6, (r ->> 'batch_id')::bigint, r ->> 'painter_token' from (select tests.redeem('Owner A', array[7]) as r) x;
select is(tests.wa('+919800000002', 'CONFIRM', (select token from b where n = 6)) ->> 'result', 'CONFIRMED', 'self-confirm is recorded');
select ok('SELF_CONFIRM' = any (tests.flags((select batch from b where n = 6))), 'EC-079 SELF_CONFIRM flag');
select is(tests.status('P24-0000007'), 'ON_HOLD', 'EC-079 coupon put on hold');

-- EC-080 staff number of another dealer
insert into b select 7, (r ->> 'batch_id')::bigint, r ->> 'painter_token' from (select tests.redeem('Owner A', array[8]) as r) x;
select tests.wa('+919800000003', 'CONFIRM', (select token from b where n = 7));
select ok('STAFF_NUMBER' = any (tests.flags((select batch from b where n = 7))), 'EC-080 STAFF_NUMBER flag');
select is(tests.status('P24-0000008'), 'REDEEMED', 'staff number elsewhere is a flag, not a hold');

-- EC-082 non-Indian
insert into b select 8, (r ->> 'batch_id')::bigint, r ->> 'painter_token' from (select tests.redeem('Owner A', array[9]) as r) x;
select tests.wa('+447700900123', 'CONFIRM', (select token from b where n = 8));
select ok('NON_INDIAN' = any (tests.flags((select batch from b where n = 8))), 'EC-082 NON_INDIAN flag');

-- EC-081 multi-dealer: same number at 3 dealers in 7 days
insert into b select 9, (r ->> 'batch_id')::bigint, r ->> 'painter_token' from (select tests.redeem('Owner B', array[10]) as r) x;
insert into b select 10, (r ->> 'batch_id')::bigint, r ->> 'painter_token' from (select tests.redeem('Owner Mumbai', array[11]) as r) x;
insert into b select 11, (r ->> 'batch_id')::bigint, r ->> 'painter_token' from (select tests.redeem('Owner A', array[12]) as r) x;
select tests.wa('+919899999999', 'CONFIRM', (select token from b where n = 9));
select tests.wa('+919899999999', 'CONFIRM', (select token from b where n = 10));
select tests.wa('+919899999999', 'CONFIRM', (select token from b where n = 11));
select ok('MULTI_DEALER' = any (tests.flags((select batch from b where n = 11))), 'EC-081 MULTI_DEALER on the 3rd dealer');
select ok(not ('MULTI_DEALER' = any (tests.flags((select batch from b where n = 10)))), 'not on the 2nd');

-- EC-092 dispute within 24 h → hold
select is(tests.wa('+919899999999', 'DISPUTE') ->> 'result', 'DISPUTED', 'EC-092 NO within 24 h → DISPUTED');
select is(tests.status('P24-0000012'), 'ON_HOLD', 'disputed coupon on hold');
select is((select hold_reason from public.coupon where serial = 'P24-0000012'), 'PAINTER_DISPUTE', 'hold reason recorded');

-- EC-093 dispute after 24 h → support note
select tests.freeze(now() + interval '30 hours');
select is(tests.wa('+919811111111', 'DISPUTE') ->> 'result', 'LATE_DISPUTE', 'EC-093 NO after 24 h → support note');
select is((select count(*)::int from public.support_note where kind = 'LATE_DISPUTE'), 1, 'support note created');
select tests.thaw();

-- EC-094 STOP
select is(tests.wa('+919811111111', 'STOP') ->> 'result', 'STOPPED', 'EC-094 STOP');
select is((select status || ':' || coalesce(phone_e164, '-') from public.painter where phone_masked = '+91 98•••• 1111'), 'ANONYMISED:-', 'number removed');
select is((select count(*)::int from public.wa_inbound where from_e164 = '+919811111111'), 0, 'inbound history keeps only the masked number');

select * from finish();
rollback;
