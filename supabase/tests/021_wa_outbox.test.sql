-- §6.7 outbox: claim with lease, sent, retry with backoff, failed, free-window guard (EC-089, EC-090).
begin;
select plan(13);

select tests.wa('+919811111111', 'HELP');
select tests.wa('+919822222222', 'HELP');
create temp table o as select (x ->> 'id')::bigint as id from jsonb_array_elements(tests.call('service', '(select jsonb_agg(c) from public.wa_claim_outbox(20) c)')) x;

select is((select count(*)::int from o), 2, 'two rows claimed');
select is(tests.call('service', '(select jsonb_agg(c) from public.wa_claim_outbox(20) c)'), 'null'::jsonb, 'leased rows are not re-claimed');
select is((select attempts from public.wa_outbox where id = (select min(id) from o)), 1, 'attempt counted');

select tests.call('service', format('public.wa_mark_sent(%s, %L)', (select min(id) from o), 'wamid.out1'));
select is((select status from public.wa_outbox where id = (select min(id) from o)), 'SENT', 'marked SENT');

select is(tests.call('service', format('public.wa_mark_failed(%s, %L, true)', (select max(id) from o), '429 rate limit')) #>> '{}', 'RETRY', 'EC-089 retryable → RETRY');
select is((select next_attempt_at - now() from public.wa_outbox where id = (select max(id) from o)), interval '30 seconds', 'first backoff 30 s');

select tests.freeze(now() + interval '31 seconds');
select is(jsonb_array_length(tests.call('service', '(select jsonb_agg(c) from public.wa_claim_outbox(20) c)')), 1, 'due again after backoff');
select is(tests.call('service', format('public.wa_mark_failed(%s, %L, true)', (select max(id) from o), '500')) #>> '{}', 'RETRY', 'still retrying');
select is((select next_attempt_at - public.app_now() from public.wa_outbox where id = (select max(id) from o)), interval '2 minutes', 'second backoff 2 min');
select tests.thaw();

select is(tests.call('service', format('public.wa_mark_failed(%s, %L, false)', (select max(id) from o), '400 bad number')) #>> '{}', 'FAILED', 'non-retryable → FAILED');

-- EC-090: never send outside the 24 h window
select tests.wa('+919833333333', 'HELP');
select tests.freeze(now() + interval '24 hours 1 minute');
select tests.call('service', '(select jsonb_agg(c) from public.wa_claim_outbox(20) c)');
select is((select status from public.wa_outbox where to_e164 = '+919833333333'), 'EXPIRED_WINDOW', 'EC-090 expired window is never sent');
select tests.thaw();

select is(tests.state('Admin', 'public.wa_claim_outbox(1)'), '42501', 'outbox is service-role only');
select is(tests.rows('Admin', 'select * from public.wa_outbox'), 3::bigint, 'M24 admin can read the outbox for the ops dashboard');

select * from finish();
rollback;
