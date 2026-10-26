-- §23 jobs are idempotent; §22 reconciliation finds nothing on clean data and catches tampering.
begin;
select plan(13);

select tests.redeem('Owner A', array[1, 2]);
update public.dealer_claim set opened_at = now() - interval '40 days' where dealer_id = 1 and status = 'OPEN';
select is(public.job_submit_dealer_claims(), 1, 'claim cut-off submits last month''s open claim');
select is(public.job_submit_dealer_claims(), 0, 'EC-121 running twice changes nothing');
select is((select count(*)::int from public.dealer_claim where status = 'OPEN' and opened_at < now() - interval '35 days'), 0, 'no stale open claims');

-- EC-032 month-end: a redemption at 23:59:59 on the last day joins that month's claim; the 00:05 run submits it
select tests.freeze('2026-11-30 23:59:59+05:30');
select tests.redeem('Owner B', array[3]);
select tests.freeze('2026-12-01 00:05+05:30');
select is(public.job_submit_dealer_claims(), 1, 'EC-032 cut-off at 00:05 IST on the 1st submits it');
select tests.thaw();

update public.coupon set expires_at = now() - interval '1 second' where serial = 'P24-0000050';
select is(public.job_expire_coupons(), 1, 'expiry job');
select is(public.job_expire_coupons(), 0, 'idempotent');
select is(tests.status('P24-0000050'), 'EXPIRED', 'coupon EXPIRED');

select tests.freeze(now() + interval '25 hours');
select ok(public.job_expire_painter_tokens() >= 1, 'token expiry job');
select is(public.job_expire_painter_tokens(), 0, 'idempotent');
select tests.thaw();

select is(public.run_reconciliation(), 0, 'clean data: no reconciliation issues');
select is(public.run_reconciliation(), 0, 'reconciliation is idempotent');

-- Tamper: a CN total that does not match its lines.
select tests.call('Distributor Pune', format('public.dist_decide(%s, null, %L)', id, 'APPROVE')) from public.dealer_claim where dealer_id = 1 and status = 'SUBMITTED';
select tests.call('Distributor Pune', format('public.dist_close_claim(%s, %L, tests.today())', id, 'CN-R')) from public.dealer_claim where dealer_id = 1 and status = 'SUBMITTED';
update public.dealer_claim set cn_total_paise = cn_total_paise + 100 where cn_no = 'CN-R';
select is(public.run_reconciliation(), 1, 'tampered CN total detected');
select is((select check_name from public.recon_issue order by id desc limit 1), 'DEALER_CN_TOTAL', 'issue names the identity');

select * from finish();
rollback;
