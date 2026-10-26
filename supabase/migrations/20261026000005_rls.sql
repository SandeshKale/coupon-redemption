-- 0005: Row Level Security on every table, read-only grants (§12).
-- Writes never go through table grants: only security definer functions write.

do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- Supabase grants ALL to anon/authenticated by default: take it all back.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges revoke execute on functions from public;

-- Read grants for signed-in users; RLS decides which rows.
grant select on
  public.app_config, public.distributor, public.dealer, public.dealer_distributor_history,
  public.app_user, public.user_request, public.sku, public.coupon_lot, public.coupon_lot_export,
  public.coupon_transition, public.dealer_claim, public.dist_claim, public.redemption_batch,
  public.dealer_claim_line, public.dist_claim_line, public.coupon_event, public.scan_attempt,
  public.admin_log, public.painter, public.painter_confirmation, public.wa_inbound, public.wa_outbox,
  public.wa_template, public.support_note, public.recon_issue, public.review_log
to authenticated;

-- coupon: every column except the redeemable code (only the print export, via service role, reads it).
grant select (
  id, lot_id, serial_no, serial, value_paise, status, sku, batch_no, mfg_date, expires_at,
  activated_at, activated_by, redeemed_at, redeemed_dealer_id, redeemed_user_id,
  routed_distributor_id, dealer_claim_id, redemption_batch_id, dist_claim_id, hold_reason,
  hold_prior_status, held_at, status_reason, updated_at
) on public.coupon to authenticated;

-- painter: full number only for M24_ADMIN — enforced by column grant + view for others.
revoke select on public.painter from authenticated;
grant select (id, phone_masked, first_seen_at, last_seen_at, confirm_count, status, lang) on public.painter to authenticated;

-- ── Policies (select only) ──────────────────────────────────────────────────
create policy app_config_read on public.app_config for select to authenticated
  using ((select public.rls_user_id()) is not null);
create policy coupon_transition_read on public.coupon_transition for select to authenticated
  using ((select public.rls_user_id()) is not null);
create policy sku_read on public.sku for select to authenticated
  using ((select public.rls_user_id()) is not null);
create policy wa_template_read on public.wa_template for select to authenticated
  using ((select public.rls_is_m24()));

create policy distributor_read on public.distributor for select to authenticated using (
  (select public.rls_is_m24())
  or id = (select public.rls_distributor_id())
  or id = (select d.distributor_id from public.dealer d where d.id = (select public.rls_dealer_id()))
);

create policy dealer_read on public.dealer for select to authenticated using (
  (select public.rls_is_m24())
  or distributor_id = (select public.rls_distributor_id())
  or id = (select public.rls_dealer_id())
);

create policy dealer_history_read on public.dealer_distributor_history for select to authenticated using (
  (select public.rls_is_m24())
  or from_distributor_id = (select public.rls_distributor_id())
  or to_distributor_id = (select public.rls_distributor_id())
);

create policy app_user_read on public.app_user for select to authenticated using (
  (select public.rls_is_m24())
  or id = (select public.rls_user_id())
  or ((select public.rls_role()) = 'DEALER_OWNER' and dealer_id = (select public.rls_dealer_id()))
  or ((select public.rls_role()) = 'DISTRIBUTOR' and dealer_id in (
        select d.id from public.dealer d where d.distributor_id = (select public.rls_distributor_id())))
);

create policy user_request_read on public.user_request for select to authenticated using (
  (select public.rls_is_m24())
  or distributor_id = (select public.rls_distributor_id())
  or ((select public.rls_role()) = 'DEALER_OWNER' and dealer_id = (select public.rls_dealer_id()))
);

create policy coupon_lot_read on public.coupon_lot for select to authenticated
  using ((select public.rls_is_m24()));
create policy coupon_lot_export_read on public.coupon_lot_export for select to authenticated
  using ((select public.rls_is_m24()));

create policy coupon_read on public.coupon for select to authenticated using (
  (select public.rls_is_m24())
  or redeemed_dealer_id = (select public.rls_dealer_id())
  or routed_distributor_id = (select public.rls_distributor_id())
);

create policy coupon_event_read on public.coupon_event for select to authenticated using (
  (select public.rls_is_m24())
  or exists (select 1 from public.coupon c where c.id = coupon_id and (
       c.redeemed_dealer_id = (select public.rls_dealer_id())
       or c.routed_distributor_id = (select public.rls_distributor_id())))
);

create policy scan_attempt_read on public.scan_attempt for select to authenticated using (
  (select public.rls_is_m24()) or user_id = (select public.rls_user_id())
);

create policy admin_log_read on public.admin_log for select to authenticated
  using ((select public.rls_role()) = 'M24_ADMIN');

create policy dealer_claim_read on public.dealer_claim for select to authenticated using (
  (select public.rls_is_m24())
  or distributor_id = (select public.rls_distributor_id())
  or ((select public.rls_role()) = 'DEALER_OWNER' and dealer_id = (select public.rls_dealer_id()))
);

create policy dealer_claim_line_read on public.dealer_claim_line for select to authenticated using (
  exists (select 1 from public.dealer_claim c where c.id = claim_id)  -- inherits dealer_claim RLS
);

create policy dist_claim_read on public.dist_claim for select to authenticated using (
  (select public.rls_is_m24()) or distributor_id = (select public.rls_distributor_id())
);

create policy dist_claim_line_read on public.dist_claim_line for select to authenticated using (
  exists (select 1 from public.dist_claim c where c.id = claim_id)
);

create policy redemption_batch_read on public.redemption_batch for select to authenticated using (
  (select public.rls_is_m24())
  or dealer_id = (select public.rls_dealer_id())
  or dealer_id in (select d.id from public.dealer d where d.distributor_id = (select public.rls_distributor_id()))
);

create policy painter_confirmation_read on public.painter_confirmation for select to authenticated using (
  exists (select 1 from public.redemption_batch b where b.id = batch_id)  -- inherits batch RLS
);

create policy painter_read on public.painter for select to authenticated using (
  (select public.rls_is_m24())
  or exists (select 1 from public.painter_confirmation pc where pc.painter_id = painter.id)
);

create policy wa_inbound_read on public.wa_inbound for select to authenticated
  using ((select public.rls_role()) = 'M24_ADMIN');
create policy wa_outbox_read on public.wa_outbox for select to authenticated
  using ((select public.rls_role()) = 'M24_ADMIN');
create policy support_note_read on public.support_note for select to authenticated
  using ((select public.rls_role()) = 'M24_ADMIN');
create policy recon_issue_read on public.recon_issue for select to authenticated
  using ((select public.rls_is_m24()));
create policy review_log_read on public.review_log for select to authenticated
  using ((select public.rls_is_m24()));

-- Tables with RLS on and deliberately no policy (deny all to API roles):
-- serial_counter, idempotency, public_lookup, login_link_attempt.
