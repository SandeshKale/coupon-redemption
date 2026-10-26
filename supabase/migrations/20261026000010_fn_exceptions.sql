-- 0010: 24M exception handling — holds, releases, reversals, disputes, lookups (§7, §26).

create or replace function public.hold_coupons(p_coupon_ids bigint[], p_reason text)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['M24_ADMIN']); v_count int;
begin
  if length(coalesce(btrim(p_reason), '')) < 5 then perform public.fail('REASON_REQUIRED'); end if;
  with h as (
    update public.coupon c set status = 'ON_HOLD', hold_prior_status = c.status, hold_reason = p_reason, held_at = public.app_now()
     where c.id = any (p_coupon_ids) and c.status in ('REDEEMED', 'DIST_CN_ISSUED', 'CLAIMED_TO_24M')
    returning c.id, c.hold_prior_status
  ), e as (
    insert into public.coupon_event (coupon_id, event, from_status, to_status, user_id, ref, at)
    select id, 'HELD', hold_prior_status, 'ON_HOLD', u.id, p_reason, public.app_now() from h returning 1
  ) select count(*) into v_count from e;
  perform public.log_admin(u.id, 'HOLD_COUPONS', null, p_reason, jsonb_build_object('count', v_count, 'ids', to_jsonb(p_coupon_ids)));
  return v_count;
end $$;

create or replace function public.release_coupon_rows(p_coupon_ids bigint[], p_user bigint, p_note text)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count int;
begin
  with r as (
    update public.coupon c set status = c.hold_prior_status, hold_prior_status = null, hold_reason = null, held_at = null
     where c.id = any (p_coupon_ids) and c.status = 'ON_HOLD'
    returning c.id, c.status
  ), e as (
    insert into public.coupon_event (coupon_id, event, from_status, to_status, user_id, ref, at)
    select id, 'RELEASED', 'ON_HOLD', status, p_user, p_note, public.app_now() from r returning 1
  ) select count(*) into v_count from e;
  return v_count;
end $$;

create or replace function public.release_coupons(p_coupon_ids bigint[], p_note text)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['M24_ADMIN']); v_count int;
begin
  if exists (select 1 from public.coupon c join public.painter_confirmation pc on pc.batch_id = c.redemption_batch_id
              where c.id = any (p_coupon_ids) and pc.status = 'DISPUTED' and pc.resolution is null) then
    perform public.fail('USE_RESOLVE_DISPUTE');
  end if;
  v_count := public.release_coupon_rows(p_coupon_ids, u.id, p_note);
  perform public.log_admin(u.id, 'RELEASE_COUPONS', null, p_note, jsonb_build_object('count', v_count));
  return v_count;
end $$;

-- D7: 24M admin only, before the distributor closes the claim (EC-035, EC-036).
create or replace function public.reverse_redemption(p_coupon_id bigint, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['M24_ADMIN']); c public.coupon;
begin
  if length(coalesce(btrim(p_reason), '')) < 5 then perform public.fail('REASON_REQUIRED'); end if;
  select * into c from public.coupon where id = p_coupon_id for update;
  if not found then perform public.fail('NOT_FOUND'); end if;
  if c.status <> 'REDEEMED' or not exists (
       select 1 from public.dealer_claim_line l join public.dealer_claim dc on dc.id = l.claim_id
        where l.coupon_id = c.id and l.status in ('PENDING', 'HELD') and dc.status in ('OPEN', 'SUBMITTED')) then
    perform public.fail('NOT_REVERSIBLE');
  end if;
  update public.dealer_claim_line set status = 'REVERSED', reason = p_reason, decided_by = u.id, decided_at = public.app_now()
   where coupon_id = c.id and status in ('PENDING', 'HELD');
  update public.coupon set status = 'ACTIVE', redeemed_at = null, redeemed_dealer_id = null, redeemed_user_id = null,
         routed_distributor_id = null, dealer_claim_id = null, redemption_batch_id = null, status_reason = p_reason
   where id = c.id;
  perform public.log_event(c.id, 'REVERSED', 'REDEEMED', 'ACTIVE', u.id, 'batch:' || c.redemption_batch_id || ' ' || p_reason);
  perform public.log_admin(u.id, 'REVERSE_REDEMPTION', 'coupon:' || c.id, p_reason);
end $$;

-- SOP 4: release (painter was paid after all) or reject (coupons → M24_REJECTED).
create or replace function public.resolve_dispute(p_batch_id bigint, p_decision text, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u public.app_user := public.assert_role(array['M24_ADMIN']);
  pc public.painter_confirmation; v_ids bigint[]; v_count int;
begin
  if coalesce(p_decision, '') not in ('RELEASE', 'REJECT') or length(coalesce(btrim(p_note), '')) < 5 then perform public.fail('BAD_REQUEST'); end if;
  select * into pc from public.painter_confirmation where batch_id = p_batch_id for update;
  if not found then perform public.fail('NOT_FOUND'); end if;
  if pc.resolution is not null then perform public.fail('ALREADY_RESOLVED'); end if;
  if pc.status <> 'DISPUTED' and not ('SELF_CONFIRM' = any (pc.flags)) then perform public.fail('NOT_DISPUTED'); end if;
  select array_agg(id) into v_ids from public.coupon where redemption_batch_id = p_batch_id and status = 'ON_HOLD';
  v_ids := coalesce(v_ids, '{}');
  if p_decision = 'RELEASE' then
    v_count := public.release_coupon_rows(v_ids, u.id, 'dispute released: ' || p_note);
  else
    with r as (
      update public.coupon set status = 'M24_REJECTED', status_reason = 'PAINTER_DISPUTE', hold_prior_status = null, hold_reason = null, held_at = null
       where id = any (v_ids) returning id
    ), e as (
      insert into public.coupon_event (coupon_id, event, from_status, to_status, user_id, ref, at)
      select id, 'M24_REJECTED', 'ON_HOLD', 'M24_REJECTED', u.id, 'dispute: ' || p_note, public.app_now() from r returning 1
    ) select count(*) into v_count from e;
    update public.dealer_claim_line set status = 'REJECTED', reason = 'PAINTER_DISPUTE', decided_by = u.id, decided_at = public.app_now()
     where coupon_id = any (v_ids) and status in ('PENDING', 'HELD', 'APPROVED');
    update public.dist_claim_line set status = 'REJECTED', reason = 'PAINTER_DISPUTE', decided_by = u.id, decided_at = public.app_now()
     where coupon_id = any (v_ids) and status in ('PENDING', 'HELD', 'APPROVED');
  end if;
  update public.painter_confirmation set resolution = case when p_decision = 'RELEASE' then 'RELEASED' else 'REJECTED' end,
         resolved_at = public.app_now(), resolved_by = u.id where id = pc.id;
  perform public.log_admin(u.id, 'RESOLVE_DISPUTE', 'batch:' || p_batch_id, p_note, jsonb_build_object('decision', p_decision, 'coupons', v_count));
  return jsonb_build_object('batch_id', p_batch_id, 'decision', p_decision, 'coupons', v_count);
end $$;

-- SOP 6: damaged coupon redeemed on the dealer's behalf (no painter token: painter not present).
create or replace function public.m24_redeem_on_behalf(p_serial text, p_dealer_id int, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u public.app_user := public.assert_role(array['M24_ADMIN']);
  d public.dealer; c public.coupon; v_claim bigint; v_batch bigint; v_now timestamptz := public.app_now();
begin
  if length(coalesce(btrim(p_reason), '')) < 5 then perform public.fail('REASON_REQUIRED'); end if;
  select * into d from public.dealer where id = p_dealer_id and status = 'ACTIVE';
  if not found then perform public.fail('DEALER_INACTIVE'); end if;
  select * into c from public.coupon where serial = upper(p_serial) for update;
  if not found then perform public.fail('NOT_FOUND'); end if;
  if c.status <> 'ACTIVE' or (c.expires_at is not null and c.expires_at <= v_now) then perform public.fail('NOT_REDEEMABLE', c.status); end if;
  v_claim := public.open_claim_for(d.id, d.distributor_id);
  insert into public.redemption_batch (dealer_id, user_id, coupon_count, value_paise, created_at)
  values (d.id, u.id, 1, c.value_paise, v_now) returning id into v_batch;
  update public.coupon set status = 'REDEEMED', redeemed_at = v_now, redeemed_dealer_id = d.id, redeemed_user_id = u.id,
         routed_distributor_id = d.distributor_id, dealer_claim_id = v_claim, redemption_batch_id = v_batch, status_reason = p_reason
   where id = c.id;
  insert into public.dealer_claim_line (claim_id, coupon_id) values (v_claim, c.id);
  perform public.log_event(c.id, 'REDEEMED_ON_BEHALF', 'ACTIVE', 'REDEEMED', u.id, 'batch:' || v_batch || ' ' || p_reason);
  perform public.log_admin(u.id, 'REDEEM_ON_BEHALF', 'coupon:' || c.id, p_reason, jsonb_build_object('dealer_id', d.id));
  return jsonb_build_object('batch_id', v_batch, 'serial', c.serial, 'value_paise', c.value_paise);
end $$;

-- Full coupon history by serial or code (24M lookup).
create or replace function public.lookup_coupon(p_query text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['M24_ADMIN', 'M24_FINANCE', 'M24_VIEWER']); c public.coupon;
begin
  select * into c from public.coupon where serial = upper(btrim(p_query)) or code = public.normalise_code(p_query);
  if not found then return jsonb_build_object('found', false); end if;
  return jsonb_build_object('found', true,
    'coupon', to_jsonb(c) - 'code',
    'lot', (select jsonb_build_object('lot_no', l.lot_no, 'value_paise', l.value_paise) from public.coupon_lot l where l.id = c.lot_id),
    'dealer', (select jsonb_build_object('id', d.id, 'code', d.code, 'name', d.name) from public.dealer d where d.id = c.redeemed_dealer_id),
    'painter', (select jsonb_build_object('status', pc.status, 'flags', pc.flags, 'confirmed_at', pc.confirmed_at,
                  'painter', case when u.role = 'M24_ADMIN' then p.phone_e164 else p.phone_masked end)
                  from public.painter_confirmation pc left join public.painter p on p.id = pc.painter_id
                 where pc.batch_id = c.redemption_batch_id),
    'events', coalesce((select jsonb_agg(jsonb_build_object('event', e.event, 'from', e.from_status, 'to', e.to_status,
                  'by', (select name from public.app_user a where a.id = e.user_id), 'ref', e.ref, 'at', e.at) order by e.at, e.id)
                  from public.coupon_event e where e.coupon_id = c.id), '[]'::jsonb),
    'scans', (select count(*) from public.scan_attempt s where s.coupon_id = c.id));
end $$;

create or replace function public.log_weekly_review(p_notes text)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['M24_ADMIN']); v_id bigint;
begin
  insert into public.review_log (reviewed_by, reviewed_at, notes) values (u.id, public.app_now(), p_notes) returning id into v_id;
  return v_id;
end $$;

create or replace function public.close_support_note(p_note_id bigint)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['M24_ADMIN']);
begin
  update public.support_note set closed_at = public.app_now(), closed_by = u.id where id = p_note_id and closed_at is null;
  if not found then perform public.fail('NOT_FOUND'); end if;
end $$;

create or replace function public.set_config_value(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['M24_ADMIN']); v_old jsonb;
begin
  select value into v_old from public.app_config where key = p_key for update;
  if not found then perform public.fail('UNKNOWN_KEY'); end if;
  if jsonb_typeof(v_old) <> jsonb_typeof(p_value) then perform public.fail('TYPE_MISMATCH'); end if;
  update public.app_config set value = p_value, updated_by = u.id, updated_at = public.app_now() where key = p_key;
  perform public.log_admin(u.id, 'SET_CONFIG', 'app_config:' || p_key, null, jsonb_build_object('old', v_old, 'new', p_value));
end $$;
