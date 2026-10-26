-- 0013: function execute grants (§12.3). Everything is revoked, then granted explicitly.
-- The pgTAP meta-test (supabase/tests/001_security.test.sql) asserts this exact allow-list.

revoke execute on all functions in schema public from public, anon, authenticated, service_role;
revoke all on schema private from anon, authenticated, service_role;

-- Anonymous: genuineness check only.
grant execute on function public.public_coupon_info(text) to anon, authenticated;

-- RLS helpers and config readers (used inside policies and security_invoker views).
grant execute on function
  public.rls_user(), public.rls_role(), public.rls_user_id(), public.rls_dealer_id(),
  public.rls_distributor_id(), public.rls_is_m24(), public.jwt_claim(text),
  public.cfg(text), public.cfg_int(text, text), public.cfg_bool(text), public.cfg_text(text)
to authenticated;

-- Signed-in API (each function enforces its own roles via assert_role).
grant execute on function
  public.check_coupon(text), public.redeem(text[], uuid), public.redemption_outcome(uuid),
  public.batch_status(bigint), public.skip_painter_confirmation(bigint, text), public.dealer_home(),
  public.my_batches(int, bigint), public.submit_dealer_claim(), public.ack_dealer_cn(bigint), public.my_claims(int),
  public.get_claim_by_slip(text), public.dealer_claim_detail(bigint), public.dist_decide(bigint, bigint[], text, text),
  public.dist_close_claim(bigint, text, date), public.create_dist_claim(), public.distributor_todo(),
  public.dist_claim_detail(bigint), public.m24_decide(bigint, bigint[], text, text), public.m24_validate_claim(bigint),
  public.m24_return_claim(bigint, text), public.m24_settle(bigint, text, date), public.m24_settlement_export(bigint),
  public.upsert_distributor(text, text, text, text, text), public.upsert_dealer(text, text, text, text, int),
  public.reassign_dealer(int, int, text), public.set_dealer_status(int, text, text), public.upsert_sku(text, text, boolean),
  public.bulk_upsert_dealers(jsonb, boolean), public.can_manage_user(text, int, int),
  public.precheck_new_user(text, text, text, int, int), public.login_link_target(bigint),
  public.set_user_status(bigint, text, text), public.request_staff(text, text), public.reject_user_request(bigint),
  public.create_lot(text, int, bigint, text, text), public.generate_lot_codes(int, int), public.begin_lot_export(int, text),
  public.void_serials(int, text[], text), public.lot_reconciliation(int),
  public.activate_range(int, bigint, bigint, text, text, date), public.block_range(int, bigint, bigint, text),
  public.hold_coupons(bigint[], text), public.release_coupons(bigint[], text), public.reverse_redemption(bigint, text),
  public.resolve_dispute(bigint, text, text), public.m24_redeem_on_behalf(text, int, text), public.lookup_coupon(text),
  public.log_weekly_review(text), public.close_support_note(bigint), public.set_config_value(text, jsonb),
  public.painter_detail(bigint), public.set_painter_status(bigint, text, text), public.recon_summary(date)
to authenticated;

-- Service role only (Edge Functions and jobs).
grant execute on function
  public.wa_handle_inbound(text, text, text, text, timestamptz, text, text),
  public.wa_record_error(text, text, text, timestamptz, text),
  public.wa_claim_outbox(int), public.wa_mark_sent(bigint, text), public.wa_mark_failed(bigint, text, boolean),
  public.register_app_user(uuid, text, text, text, text, int, int, bigint, bigint),
  public.set_app_user_email(bigint, text), public.record_login_link_issued(bigint, bigint),
  public.record_login_link_request(text, text), public.export_lot_page(bigint, bigint, int),
  public.finish_lot_export(bigint, int, text),
  public.job_submit_dealer_claims(), public.job_expire_coupons(), public.job_expire_painter_tokens(),
  public.job_cleanup(), public.run_reconciliation()
to service_role;

-- Service role reads nothing directly either: it acts through the functions above.
revoke all on all tables in schema public from service_role;
grant select on public.app_config to service_role;
