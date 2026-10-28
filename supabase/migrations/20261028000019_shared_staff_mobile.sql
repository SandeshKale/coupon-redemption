-- 0019: a 24M staff member may also be a distributor or dealer contact with the same mobile number.
-- Mobile numbers stay unique among PIN logins (dealers, distributors, reps) and, separately, among
-- 24M staff, who sign in with email and password and never with the number.
drop index public.app_user_mobile_active;
create unique index app_user_mobile_active on public.app_user (mobile_e164, (role like 'M24\_%'))
  where status = 'ACTIVE';

create or replace function public.precheck_new_user(p_name text, p_mobile text, p_role text, p_dealer_id int,
  p_distributor_id int, p_parent_distributor int default null, p_is_rep boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u public.app_user;
begin
  if p_role = 'DEALER_OWNER' and p_dealer_id is null then       -- a new dealer under p_parent_distributor
    u := public.assert_role(array['M24_ADMIN', 'DISTRIBUTOR']);
    if p_parent_distributor is null then perform public.fail('BAD_REQUEST'); end if;
    if u.role = 'DISTRIBUTOR' and p_parent_distributor <> u.distributor_id then
      raise exception 'FORBIDDEN' using errcode = 'PT403';
    end if;
    if not exists (select 1 from public.distributor where id = p_parent_distributor and status = 'ACTIVE') then
      perform public.fail('DISTRIBUTOR_INACTIVE');
    end if;
    if p_mobile is not null and exists (select 1 from public.dealer where mobile_e164 = p_mobile) then
      perform public.fail('DUPLICATE_MOBILE');
    end if;
  else
    u := public.assert_can_manage_user(p_role, p_dealer_id, p_distributor_id);
  end if;
  if p_role not in ('DEALER_STAFF', 'DEALER_OWNER', 'DISTRIBUTOR', 'M24_ADMIN', 'M24_FINANCE', 'M24_VIEWER') then
    perform public.fail('BAD_ROLE');
  end if;
  if p_is_rep and (p_role <> 'DISTRIBUTOR' or u.role <> 'M24_ADMIN') then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if length(coalesce(btrim(p_name), '')) < 2 then perform public.fail('BAD_NAME'); end if;
  if p_mobile is not null and exists (
       select 1 from public.app_user
        where mobile_e164 = p_mobile and status = 'ACTIVE' and (role like 'M24\_%') = (p_role like 'M24\_%')) then
    perform public.fail('DUPLICATE_MOBILE');
  end if;
  return jsonb_build_object('ok', true, 'created_by', u.id,
    'email_domain', public.cfg_text('internal_email_domain'));
end $$;

create or replace function public.update_user_mobile(p_user_id bigint, p_mobile text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['M24_ADMIN']); t public.app_user; v_old text;
begin
  if p_mobile is null or p_mobile !~ '^\+[1-9][0-9]{7,14}$' then perform public.fail('BAD_MOBILE'); end if;
  select * into t from public.app_user where id = p_user_id for update;
  if not found then perform public.fail('NOT_FOUND'); end if;
  v_old := t.mobile_e164;
  if v_old is not distinct from p_mobile then return; end if;
  if t.status = 'ACTIVE' and exists (
       select 1 from public.app_user
        where mobile_e164 = p_mobile and status = 'ACTIVE' and id <> t.id and (role like 'M24\_%') = (t.role like 'M24\_%')) then
    perform public.fail('DUPLICATE_MOBILE');
  end if;
  if t.dealer_id is not null and t.role = 'DEALER_OWNER'
     and exists (select 1 from public.dealer where mobile_e164 = p_mobile and id <> t.dealer_id) then
    perform public.fail('DUPLICATE_MOBILE');
  end if;
  update public.app_user set mobile_e164 = p_mobile where id = t.id;
  if t.dealer_id is not null and t.role = 'DEALER_OWNER' then
    update public.dealer set mobile_e164 = p_mobile where id = t.dealer_id;
  end if;
  if t.distributor_id is not null and t.role = 'DISTRIBUTOR' and not t.is_sales_rep then
    update public.distributor set mobile_e164 = p_mobile where id = t.distributor_id;
  end if;
  perform public.log_admin(u.id, 'UPDATE_MOBILE', 'app_user:' || t.id, null,
    jsonb_build_object('from', public.mask_phone(coalesce(v_old, '')), 'to', public.mask_phone(p_mobile)));
end $$;
