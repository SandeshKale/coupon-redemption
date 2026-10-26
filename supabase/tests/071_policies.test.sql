-- §20.4.2: every RLS policy × role — allowed roles see rows, all others see none; anon has no access.
begin;

select tests.redeem('Owner A', array[1, 2]);
select tests.redeem('Owner B', array[3]);
select tests.call('Owner A', format('public.check_coupon(%L)', tests.code13('P24-0000050')));
select tests.wa('+919811111111', 'CONFIRM', (select token from public.painter_confirmation order by id limit 1));
select tests.call('Owner A', 'public.submit_dealer_claim()');
select tests.call('Distributor Pune', format('public.dist_decide(%s, null, %L)', id, 'APPROVE')) from public.dealer_claim where dealer_id = 1 and status = 'SUBMITTED';
select tests.call('Distributor Pune', format('public.dist_close_claim(%s, %L, tests.today())', id, 'CN-P')) from public.dealer_claim where dealer_id = 1 and status = 'SUBMITTED';
select tests.call('Distributor Pune', 'public.create_dist_claim()');
select tests.call('Owner A', $$public.request_staff('New Helper', '+919812399999')$$);
select tests.call('Admin', $$public.upsert_sku('PRIMER-10L', '24M Primer 10 L')$$);
select tests.call('Admin', $$public.log_weekly_review('weekly review done')$$);
insert into public.recon_issue (run_date, check_name, ref) values (current_date, 'TEST', 'x');
insert into public.support_note (kind) values ('TEST');
insert into public.coupon_lot_export (lot_id, exported_by) values (1, 7);

create temp table pol (policy text, query text, allowed text[]);
insert into pol values
  ('admin_log_read', 'select id from public.admin_log', '{M24_ADMIN}'),
  ('app_config_read', 'select key from public.app_config', '{DEALER_OWNER,DEALER_STAFF,DISTRIBUTOR,M24_ADMIN,M24_FINANCE,M24_VIEWER}'),
  ('app_user_read', 'select id from public.app_user', '{DEALER_OWNER,DEALER_STAFF,DISTRIBUTOR,M24_ADMIN,M24_FINANCE,M24_VIEWER}'),
  ('coupon_event_read', 'select id from public.coupon_event', '{DEALER_OWNER,DEALER_STAFF,DISTRIBUTOR,M24_ADMIN,M24_FINANCE,M24_VIEWER}'),
  ('coupon_lot_export_read', 'select id from public.coupon_lot_export', '{M24_ADMIN,M24_FINANCE,M24_VIEWER}'),
  ('coupon_lot_read', 'select id from public.coupon_lot', '{M24_ADMIN,M24_FINANCE,M24_VIEWER}'),
  ('coupon_read', 'select id from public.coupon', '{DEALER_OWNER,DEALER_STAFF,DISTRIBUTOR,M24_ADMIN,M24_FINANCE,M24_VIEWER}'),
  ('coupon_transition_read', 'select from_status from public.coupon_transition', '{DEALER_OWNER,DEALER_STAFF,DISTRIBUTOR,M24_ADMIN,M24_FINANCE,M24_VIEWER}'),
  ('dealer_claim_line_read', 'select id from public.dealer_claim_line', '{DEALER_OWNER,DISTRIBUTOR,M24_ADMIN,M24_FINANCE,M24_VIEWER}'),
  ('dealer_claim_read', 'select id from public.dealer_claim', '{DEALER_OWNER,DISTRIBUTOR,M24_ADMIN,M24_FINANCE,M24_VIEWER}'),
  ('dealer_history_read', 'select id from public.dealer_distributor_history', '{DISTRIBUTOR,M24_ADMIN,M24_FINANCE,M24_VIEWER}'),
  ('dealer_read', 'select id from public.dealer', '{DEALER_OWNER,DEALER_STAFF,DISTRIBUTOR,M24_ADMIN,M24_FINANCE,M24_VIEWER}'),
  ('dist_claim_line_read', 'select id from public.dist_claim_line', '{DISTRIBUTOR,M24_ADMIN,M24_FINANCE,M24_VIEWER}'),
  ('dist_claim_read', 'select id from public.dist_claim', '{DISTRIBUTOR,M24_ADMIN,M24_FINANCE,M24_VIEWER}'),
  ('distributor_read', 'select id from public.distributor', '{DEALER_OWNER,DEALER_STAFF,DISTRIBUTOR,M24_ADMIN,M24_FINANCE,M24_VIEWER}'),
  ('painter_confirmation_read', 'select id from public.painter_confirmation', '{DEALER_OWNER,DEALER_STAFF,DISTRIBUTOR,M24_ADMIN,M24_FINANCE,M24_VIEWER}'),
  ('painter_read', 'select id, phone_masked from public.painter', '{DEALER_OWNER,DEALER_STAFF,DISTRIBUTOR,M24_ADMIN,M24_FINANCE,M24_VIEWER}'),
  ('recon_issue_read', 'select id from public.recon_issue', '{M24_ADMIN,M24_FINANCE,M24_VIEWER}'),
  ('redemption_batch_read', 'select id from public.redemption_batch', '{DEALER_OWNER,DEALER_STAFF,DISTRIBUTOR,M24_ADMIN,M24_FINANCE,M24_VIEWER}'),
  ('review_log_read', 'select id from public.review_log', '{M24_ADMIN,M24_FINANCE,M24_VIEWER}'),
  ('scan_attempt_read', 'select id from public.scan_attempt', '{DEALER_OWNER,M24_ADMIN,M24_FINANCE,M24_VIEWER}'),
  ('sku_read', 'select code from public.sku', '{DEALER_OWNER,DEALER_STAFF,DISTRIBUTOR,M24_ADMIN,M24_FINANCE,M24_VIEWER}'),
  ('support_note_read', 'select id from public.support_note', '{M24_ADMIN}'),
  ('user_request_read', 'select id from public.user_request', '{DEALER_OWNER,DISTRIBUTOR,M24_ADMIN,M24_FINANCE,M24_VIEWER}'),
  ('wa_inbound_read', 'select id from public.wa_inbound', '{M24_ADMIN}'),
  ('wa_outbox_read', 'select id from public.wa_outbox', '{M24_ADMIN}'),
  ('wa_template_read', 'select key from public.wa_template', '{M24_ADMIN,M24_FINANCE,M24_VIEWER}');

create temp table who (label text, role text);
insert into who values ('Owner A', 'DEALER_OWNER'), ('Staff A', 'DEALER_STAFF'), ('Distributor Pune', 'DISTRIBUTOR'),
  ('Admin', 'M24_ADMIN'), ('Finance', 'M24_FINANCE'), ('Viewer', 'M24_VIEWER');

select plan((select count(*)::int from pol) * 8 + 1);

select ok(case when w.role = any (p.allowed) then tests.rows(w.label, p.query) > 0 else tests.rows(w.label, p.query) = 0 end,
          format('%s: %s %s', p.policy, w.role, case when w.role = any (p.allowed) then 'sees rows' else 'sees nothing' end))
  from pol p cross join who w order by p.policy, w.role;
select is(tests.rows('anon', p.query), -1::bigint, format('%s: anon has no access', p.policy)) from pol p;
select is(tests.rows('Inactive Staff', p.query), 0::bigint, format('%s: inactive user sees nothing', p.policy)) from pol p;

select is((select count(*)::int from pg_policies pp where pp.schemaname = 'public' and not exists (select 1 from pol where pol.policy = pp.policyname)),
  0, 'every policy in the database is in this matrix');

select * from finish();
rollback;
