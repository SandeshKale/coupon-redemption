-- 0023: a 24M admin can undo a redemption made by HQ (a wrong serial, a wrong credit note, a test).
--
-- Redeemed by HQ stays final for everyone and everything else: only reverse_redemption, run by a 24M
-- admin with a reason, can take a coupon back to validated. It clears the credit note and who/when,
-- and the old credit note reference is kept in the coupon's history and the admin log.

insert into public.coupon_transition (from_status, to_status, functions) values
  ('REDEEMED', 'VALIDATED', '{reverse_redemption}')
on conflict (from_status, to_status) do nothing;

create or replace function public.coupon_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ADD_ONLY: coupons are never deleted' using errcode = 'P0001';
  end if;
  if new.code <> old.code or new.serial <> old.serial or new.serial_no <> old.serial_no
     or new.lot_id <> old.lot_id or new.value_paise <> old.value_paise then
    raise exception 'IMMUTABLE: coupon identity columns cannot change' using errcode = 'P0001';
  end if;
  if old.hq_redeemed_at is not null
     and coalesce(current_setting('app.hq_reversal', true), '') <> 'on'
     and (new.status <> old.status
          or new.hq_redeemed_at is distinct from old.hq_redeemed_at or new.hq_redeemed_by is distinct from old.hq_redeemed_by
          or new.credit_note_ref is distinct from old.credit_note_ref) then
    raise exception 'REDEEMED: a redeemed coupon cannot change' using errcode = 'P0001';
  end if;
  if new.status <> old.status and not exists (
    select 1 from public.coupon_transition t where t.from_status = old.status and t.to_status = new.status
  ) then
    raise exception 'BAD_TRANSITION: % -> %', old.status, new.status using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function public.reverse_redemption(p_coupon_id bigint, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['M24_ADMIN']); c public.coupon;
begin
  if length(coalesce(btrim(p_reason), '')) < 5 then perform public.fail('REASON_REQUIRED'); end if;
  select * into c from public.coupon where id = p_coupon_id for update;
  if not found then perform public.fail('NOT_FOUND'); end if;
  if c.status = 'VALIDATED' then
    update public.coupon set status = 'ACTIVE', redeemed_at = null, redeemed_dealer_id = null, redeemed_user_id = null,
           routed_distributor_id = null, status_reason = p_reason
     where id = c.id;
    perform public.log_event(c.id, 'REVERSED', 'VALIDATED', 'ACTIVE', u.id, p_reason);
    perform public.log_admin(u.id, 'REVERSE_REDEMPTION', 'coupon:' || c.id, p_reason);
    return;
  end if;
  -- Redeemed by HQ: back to validated, as it was before the credit note.
  if c.status = 'REDEEMED' and c.hq_redeemed_at is not null then
    perform set_config('app.hq_reversal', 'on', true);
    update public.coupon set status = 'VALIDATED', hq_redeemed_at = null, hq_redeemed_by = null, credit_note_ref = null,
           status_reason = p_reason
     where id = c.id;
    perform set_config('app.hq_reversal', 'off', true);
    perform public.log_event(c.id, 'REVERSED', 'REDEEMED', 'VALIDATED', u.id,
      p_reason || coalesce(' (credit note ' || c.credit_note_ref || ')', ''));
    perform public.log_admin(u.id, 'REVERSE_REDEMPTION', 'coupon:' || c.id, p_reason,
      jsonb_build_object('credit_note_ref', c.credit_note_ref, 'redeemed_at', c.hq_redeemed_at));
    return;
  end if;
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

-- A hold that holds nothing says so, instead of reporting a quiet zero (a coupon that HQ has redeemed
-- is held only after its redemption is reversed).
create or replace function public.hold_coupons(p_coupon_ids bigint[], p_reason text)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['M24_ADMIN']); v_count int;
begin
  if length(coalesce(btrim(p_reason), '')) < 5 then perform public.fail('REASON_REQUIRED'); end if;
  with h as (
    update public.coupon c set status = 'ON_HOLD', hold_prior_status = c.status, hold_reason = p_reason, held_at = public.app_now()
     where c.id = any (p_coupon_ids) and c.hq_redeemed_at is null
       and c.status in ('GENERATED', 'ACTIVE', 'VALIDATED', 'REDEEMED', 'DIST_CN_ISSUED', 'CLAIMED_TO_24M')
    returning c.id, c.hold_prior_status
  ), e as (
    insert into public.coupon_event (coupon_id, event, from_status, to_status, user_id, ref, at)
    select id, 'HELD', hold_prior_status, 'ON_HOLD', u.id, p_reason, public.app_now() from h returning 1
  ) select count(*) into v_count from e;
  if v_count = 0 and coalesce(array_length(p_coupon_ids, 1), 0) > 0 then perform public.fail('NOT_HOLDABLE'); end if;
  perform public.log_admin(u.id, 'HOLD_COUPONS', null, p_reason, jsonb_build_object('count', v_count, 'ids', to_jsonb(p_coupon_ids)));
  return v_count;
end $$;
