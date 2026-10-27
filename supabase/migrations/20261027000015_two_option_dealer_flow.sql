-- 0015: the dealer's choice is "Paid" or "Declined to pay"; painter WhatsApp confirmation is switched off.
-- The painter tables and functions stay (add-only history, and the flag turns the feature back on).

update public.app_config set value = 'false' where key = 'painter_confirmation_enabled';

-- "Declined to pay": the dealer saw a valid coupon and chose not to pay. Recorded for audit only;
-- the coupon stays ACTIVE and unclaimed, so nothing flows to the distributor.
create or replace function public.decline_payment(p_code text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u public.app_user := public.assert_role(array['DEALER_OWNER', 'DEALER_STAFF']);
  d public.dealer := public.active_dealer_for(u);
  v_code text; c public.coupon;
begin
  if d.id is null then return jsonb_build_object('result', 'DEALER_INACTIVE'); end if;
  if public.invalid_scan_brake_active(u.id) then return jsonb_build_object('result', 'TOO_MANY_INVALID'); end if;
  v_code := public.normalise_code(p_code);
  if v_code is null then
    perform public.log_scan(u.id, null, d.id, 'INVALID_FORMAT', p_code);
    return jsonb_build_object('result', 'INVALID_FORMAT');
  end if;
  select * into c from public.coupon where code = v_code;
  if not found or c.status <> 'ACTIVE' then return public.explain_coupon(v_code, u.id, d.id); end if;
  perform public.log_scan(u.id, c.id, d.id, 'DECLINED', v_code);
  return jsonb_build_object('result', 'DECLINED', 'code', public.code13(v_code), 'serial', c.serial,
                            'value_paise', c.value_paise);
end $$;

revoke execute on function public.decline_payment(text) from public, anon, authenticated, service_role;
grant execute on function public.decline_payment(text) to authenticated;
