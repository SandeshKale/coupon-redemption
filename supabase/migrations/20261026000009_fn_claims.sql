-- 0009: claims — dealer → distributor (CN) → 24M maker/checker (CN) (§5.3, §5.4, §15.3, §15.4).

-- ── Dealer side ────────────────────────────────────────────────────────────
create or replace function public.submit_dealer_claim()
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['DEALER_OWNER']); v_id bigint;
begin
  select id into v_id from public.dealer_claim c
   where c.dealer_id = u.dealer_id and c.status = 'OPEN' for update;
  if v_id is null then perform public.fail('NO_OPEN_CLAIM'); end if;
  if not exists (select 1 from public.dealer_claim_line l where l.claim_id = v_id and l.status = 'PENDING') then
    perform public.fail('EMPTY_CLAIM');                                             -- EC-111
  end if;
  update public.dealer_claim set status = 'SUBMITTED', submitted_at = public.app_now(), submitted_by = u.id where id = v_id;
  return v_id;
end $$;

create or replace function public.ack_dealer_cn(p_claim_id bigint)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['DEALER_OWNER']);
begin
  update public.dealer_claim set status = 'ACKNOWLEDGED', acked_by = u.id, acked_at = public.app_now()
   where id = p_claim_id and dealer_id = u.dealer_id and status = 'CN_ISSUED';
  if not found then perform public.fail('NOT_ACKNOWLEDGEABLE'); end if;
end $$;

create or replace function public.my_claims(p_limit int default 24)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['DEALER_OWNER']);
begin
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.id desc) from (
    select c.id, c.status, c.opened_at, c.submitted_at, c.cn_no, c.cn_date, c.cn_total_paise, c.cn_count, c.acked_at, c.slip_token,
           (select count(*) from public.dealer_claim_line l where l.claim_id = c.id and l.status not in ('MOVED', 'REVERSED')) as lines,
           (select coalesce(sum(cp.value_paise), 0) from public.dealer_claim_line l join public.coupon cp on cp.id = l.coupon_id
             where l.claim_id = c.id and l.status not in ('MOVED', 'REVERSED')) as value_paise
      from public.dealer_claim c where c.dealer_id = u.dealer_id
     order by c.id desc limit least(greatest(coalesce(p_limit, 24), 1), 100)) x), '[]'::jsonb);
end $$;

-- ── Shared: slip lookup and line detail ────────────────────────────────────
create or replace function public.get_claim_by_slip(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['DISTRIBUTOR', 'M24_ADMIN', 'M24_FINANCE', 'M24_VIEWER']); v_id bigint;
begin
  if u.role = 'DISTRIBUTOR' then
    select id into v_id from public.dealer_claim where slip_token = p_token and distributor_id = u.distributor_id;
    if v_id is null then perform public.fail('NOT_FOUND'); end if;
    return jsonb_build_object('kind', 'DEALER', 'claim_id', v_id);
  end if;
  select id into v_id from public.dist_claim where slip_token = p_token;
  if v_id is not null then return jsonb_build_object('kind', 'DIST', 'claim_id', v_id); end if;
  select id into v_id from public.dealer_claim where slip_token = p_token;
  if v_id is not null then return jsonb_build_object('kind', 'DEALER', 'claim_id', v_id); end if;
  perform public.fail('NOT_FOUND');
  return null;
end $$;

-- Rule results for one dealer-claim line (R2-01..R2-08). Empty array = eligible.
create or replace function public.dist_line_failures(c public.coupon, dc public.dealer_claim)
returns text[] language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v text[] := '{}'::text[]; v_painter text;
begin
  if c.status = 'ON_HOLD' then v := v || 'R2-05'::text;
  elsif c.status <> 'REDEEMED' then v := v || 'R2-01'::text; end if;
  if c.routed_distributor_id is distinct from dc.distributor_id then v := v || 'R2-02'::text; end if;
  if c.redeemed_at < coalesce(dc.submitted_at, public.app_now()) - make_interval(days => public.cfg_int('dealer_claim_window_days')) then
    v := v || 'R2-04'::text;
  end if;
  if public.cfg_bool('strict_painter_mode') then
    select status into v_painter from public.painter_confirmation where batch_id = c.redemption_batch_id;
    if coalesce(v_painter, '') not in ('CONFIRMED', 'LATE') then v := v || 'R2-08'::text; end if;
  end if;
  return v;
end $$;

create or replace function public.dealer_claim_detail(p_claim_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  u public.app_user := public.assert_role(array['DEALER_OWNER', 'DISTRIBUTOR', 'M24_ADMIN', 'M24_FINANCE', 'M24_VIEWER']);
  dc public.dealer_claim;
begin
  select * into dc from public.dealer_claim where id = p_claim_id;
  if not found
     or (u.role = 'DISTRIBUTOR' and dc.distributor_id <> u.distributor_id)
     or (u.role = 'DEALER_OWNER' and dc.dealer_id <> u.dealer_id) then
    perform public.fail('NOT_FOUND');
  end if;
  return jsonb_build_object(
    'claim', to_jsonb(dc) || jsonb_build_object('dealer', (select jsonb_build_object('id', d.id, 'code', d.code, 'name', d.name) from public.dealer d where d.id = dc.dealer_id)),
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'line_id', l.id, 'coupon_id', cp.id, 'serial', cp.serial, 'value_paise', cp.value_paise,
        'redeemed_at', cp.redeemed_at, 'coupon_status', cp.status, 'line_status', l.status, 'reason', l.reason,
        'hold_reason', cp.hold_reason,
        'painter_status', coalesce(pc.status, 'NONE'), 'painter_flags', to_jsonb(coalesce(pc.flags, '{}')),
        'painter', p.phone_masked,
        'failures', to_jsonb(case when l.status = 'PENDING' then public.dist_line_failures(cp, dc) else '{}'::text[] end))
        order by cp.serial)
      from public.dealer_claim_line l
      join public.coupon cp on cp.id = l.coupon_id
      left join public.painter_confirmation pc on pc.batch_id = cp.redemption_batch_id
      left join public.painter p on p.id = pc.painter_id
     where l.claim_id = dc.id and l.status not in ('MOVED', 'REVERSED')), '[]'::jsonb));
end $$;

-- ── Distributor ────────────────────────────────────────────────────────────
-- p_coupon_ids null = every eligible PENDING line ("Approve all eligible").
create or replace function public.dist_decide(p_claim_id bigint, p_coupon_ids bigint[], p_decision text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u public.app_user := public.assert_role(array['DISTRIBUTOR']);
  dc public.dealer_claim; l record; v_fail text[]; v_out jsonb := '[]'::jsonb; v_ok int := 0; v_now timestamptz := public.app_now();
begin
  if coalesce(p_decision, '') not in ('APPROVE', 'REJECT', 'HOLD') then perform public.fail('BAD_REQUEST'); end if;
  if p_decision = 'REJECT' and coalesce(p_reason, '') not in ('NOT_ELIGIBLE', 'OUT_OF_WINDOW', 'PAINTER_DISPUTE', 'SUSPECTED_FRAUD', 'DUPLICATE', 'OTHER') then
    perform public.fail('REASON_REQUIRED');
  end if;
  select * into dc from public.dealer_claim where id = p_claim_id for update;
  if not found or dc.distributor_id <> u.distributor_id then
    raise exception 'FORBIDDEN' using errcode = 'PT403';                              -- EC-114
  end if;
  if dc.status <> 'SUBMITTED' then perform public.fail('CLAIM_NOT_SUBMITTED'); end if;

  for l in
    select dl.id as line_id, dl.status as line_status, cp as c from public.dealer_claim_line dl join public.coupon cp on cp.id = dl.coupon_id
     where dl.claim_id = dc.id
       -- "Approve all eligible" (null ids) never sweeps up lines the distributor deliberately held.
       and ((p_coupon_ids is null and dl.status = 'PENDING') or (cp.id = any (p_coupon_ids) and dl.status in ('PENDING', 'HELD')))
     order by cp.id for update of dl, cp
  loop
    v_fail := public.dist_line_failures(l.c, dc);
    if p_decision = 'APPROVE' then
      if cardinality(v_fail) > 0 then
        if p_coupon_ids is not null then
          v_out := v_out || jsonb_build_object('coupon_id', (l.c).id, 'result', 'NOT_ELIGIBLE', 'failures', to_jsonb(v_fail));
        end if;
        continue;
      end if;
      update public.dealer_claim_line set status = 'APPROVED', reason = null, decided_by = u.id, decided_at = v_now where id = l.line_id;
    elsif p_decision = 'REJECT' then
      if (l.c).status = 'ON_HOLD' then
        v_out := v_out || jsonb_build_object('coupon_id', (l.c).id, 'result', 'ON_HOLD_24M');
        continue;
      end if;
      update public.dealer_claim_line set status = 'REJECTED', reason = p_reason, decided_by = u.id, decided_at = v_now where id = l.line_id;
      update public.coupon set status = 'DIST_REJECTED', status_reason = p_reason where id = (l.c).id and status = 'REDEEMED';
      perform public.log_event((l.c).id, 'DIST_REJECTED', 'REDEEMED', 'DIST_REJECTED', u.id, 'dealer_claim:' || dc.id);
    else
      update public.dealer_claim_line set status = 'HELD', reason = p_reason, decided_by = u.id, decided_at = v_now where id = l.line_id;
    end if;
    v_ok := v_ok + 1;
    v_out := v_out || jsonb_build_object('coupon_id', (l.c).id, 'result', p_decision);
  end loop;
  return jsonb_build_object('decided', v_ok, 'lines', v_out);
end $$;

create or replace function public.dist_close_claim(p_claim_id bigint, p_cn_no text, p_cn_date date)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u public.app_user := public.assert_role(array['DISTRIBUTOR']);
  dc public.dealer_claim; v_total bigint; v_count int; v_moved int; v_next bigint; v_now timestamptz := public.app_now();
begin
  select * into dc from public.dealer_claim where id = p_claim_id for update;
  if not found or dc.distributor_id <> u.distributor_id then raise exception 'FORBIDDEN' using errcode = 'PT403'; end if;
  if dc.status <> 'SUBMITTED' then perform public.fail('CLAIM_NOT_SUBMITTED'); end if;
  if exists (select 1 from public.dealer_claim_line where claim_id = dc.id and status = 'PENDING') then
    perform public.fail('LINES_PENDING');
  end if;

  -- Approved lines whose coupon was put on hold since approval are carried forward (EC-116).
  update public.dealer_claim_line l set status = 'HELD', reason = 'ON_HOLD_AT_CLOSE'
    from public.coupon c where c.id = l.coupon_id and l.claim_id = dc.id and l.status = 'APPROVED' and c.status = 'ON_HOLD';

  select count(*), coalesce(sum(c.value_paise), 0) into v_count, v_total
    from public.dealer_claim_line l join public.coupon c on c.id = l.coupon_id
   where l.claim_id = dc.id and l.status = 'APPROVED';

  if v_count > 0 then
    if p_cn_no is null or p_cn_no !~ '^[A-Za-z0-9/_.-]{1,40}$' then perform public.fail('CN_REQUIRED'); end if;
    if p_cn_date is null or p_cn_date < public.ist_date(dc.submitted_at) or p_cn_date > public.ist_date(v_now) then
      perform public.fail('BAD_CN_DATE');                                               -- EC-113
    end if;
    if exists (select 1 from public.dealer_claim where distributor_id = dc.distributor_id and upper(cn_no) = upper(p_cn_no)) then
      perform public.fail('DUPLICATE_CN');                                              -- EC-112
    end if;
  end if;

  with x as (
    update public.coupon c set status = 'DIST_CN_ISSUED'
      from public.dealer_claim_line l where l.coupon_id = c.id and l.claim_id = dc.id and l.status = 'APPROVED' and c.status = 'REDEEMED'
    returning c.id
  ) insert into public.coupon_event (coupon_id, event, from_status, to_status, user_id, ref, at)
    select id, 'DIST_CN_ISSUED', 'REDEEMED', 'DIST_CN_ISSUED', u.id, 'dealer_claim:' || dc.id || ' cn:' || p_cn_no, v_now from x;

  -- Held lines move to the dealer's next open claim (EC-115).
  select count(*) into v_moved from public.dealer_claim_line where claim_id = dc.id and status = 'HELD';
  if v_moved > 0 then
    update public.dealer_claim_line set status = 'MOVED' where claim_id = dc.id and status = 'HELD';
    v_next := public.open_claim_for(dc.dealer_id, (select distributor_id from public.dealer where id = dc.dealer_id));
    insert into public.dealer_claim_line (claim_id, coupon_id)
    select v_next, l.coupon_id from public.dealer_claim_line l where l.claim_id = dc.id and l.status = 'MOVED';
    update public.coupon c set dealer_claim_id = v_next
      from public.dealer_claim_line l where l.claim_id = dc.id and l.status = 'MOVED' and c.id = l.coupon_id;
  end if;

  update public.dealer_claim
     set status = 'CN_ISSUED', cn_no = case when v_count > 0 then p_cn_no end, cn_date = case when v_count > 0 then p_cn_date end,
         cn_total_paise = v_total, cn_count = v_count, closed_by = u.id, closed_at = v_now
   where id = dc.id;
  return jsonb_build_object('claim_id', dc.id, 'count', v_count, 'total_paise', v_total, 'moved', v_moved, 'next_claim_id', v_next,
    'dealer_mobile', (select mobile_e164 from public.dealer where id = dc.dealer_id));
end $$;

create or replace function public.create_dist_claim()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u public.app_user := public.assert_role(array['DISTRIBUTOR']);
  v_id bigint; v_count int; v_total bigint; v_now timestamptz := public.app_now(); v_slip text;
begin
  perform pg_advisory_xact_lock(hashtextextended('dist_claim:' || u.distributor_id, 24));
  if not exists (
    select 1 from public.coupon c where c.routed_distributor_id = u.distributor_id and c.status = 'DIST_CN_ISSUED'
       and not exists (select 1 from public.dist_claim_line l where l.coupon_id = c.id and l.status <> 'MOVED')) then
    perform public.fail('NOTHING_TO_CLAIM');
  end if;
  insert into public.dist_claim (distributor_id, created_by, created_at) values (u.distributor_id, u.id, v_now)
  returning id, slip_token into v_id, v_slip;
  with picked as (
    select c.id, c.dealer_claim_id from public.coupon c
     where c.routed_distributor_id = u.distributor_id and c.status = 'DIST_CN_ISSUED'
       and not exists (select 1 from public.dist_claim_line l where l.coupon_id = c.id and l.status <> 'MOVED')
     for update of c
  ), lines as (
    insert into public.dist_claim_line (claim_id, coupon_id, dealer_claim_id)
    select v_id, id, dealer_claim_id from picked returning coupon_id
  ), upd as (
    update public.coupon c set status = 'CLAIMED_TO_24M', dist_claim_id = v_id from lines where c.id = lines.coupon_id
    returning c.id, c.value_paise
  ), ev as (
    insert into public.coupon_event (coupon_id, event, from_status, to_status, user_id, ref, at)
    select id, 'CLAIMED_TO_24M', 'DIST_CN_ISSUED', 'CLAIMED_TO_24M', u.id, 'dist_claim:' || v_id, v_now from upd returning 1
  ) select (select count(*) from upd), (select coalesce(sum(value_paise), 0) from upd), (select count(*) from ev)
      into v_count, v_total, v_count;
  update public.dist_claim set total_paise = v_total where id = v_id;
  return jsonb_build_object('claim_id', v_id, 'count', v_count, 'total_paise', v_total, 'slip_token', v_slip);
end $$;

create or replace function public.distributor_todo()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['DISTRIBUTOR']);
begin
  return jsonb_build_object(
    'claims_to_validate', (select count(*) from public.dealer_claim where distributor_id = u.distributor_id and status = 'SUBMITTED'),
    'cn_ready_to_claim', (select count(*) from public.coupon c where c.routed_distributor_id = u.distributor_id and c.status = 'DIST_CN_ISSUED'
                            and not exists (select 1 from public.dist_claim_line l where l.coupon_id = c.id and l.status <> 'MOVED')),
    'requests', (select count(*) from public.user_request where distributor_id = u.distributor_id and status = 'PENDING'),
    'returned_claims', (select count(*) from public.dist_claim where distributor_id = u.distributor_id and status = 'RETURNED'));
end $$;

-- ── 24M ────────────────────────────────────────────────────────────────────
create or replace function public.m24_line_failures(c public.coupon, l public.dist_claim_line, dcl public.dist_claim)
returns text[] language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v text[] := '{}'::text[]; dc public.dealer_claim;
begin
  select * into dc from public.dealer_claim where id = l.dealer_claim_id;
  if c.status = 'ON_HOLD' then v := v || 'R3-05'::text;
  elsif c.status <> 'CLAIMED_TO_24M' then v := v || 'R3-01'::text; end if;
  if dc.distributor_id is distinct from dcl.distributor_id or dc.cn_no is null then v := v || 'R3-02'::text; end if;
  if public.ist_date(dcl.created_at) > dc.cn_date + public.cfg_int('dist_claim_window_days') then v := v || 'R3-04'::text; end if;
  if exists (select 1 from public.painter_confirmation pc where pc.batch_id = c.redemption_batch_id
              and pc.status = 'DISPUTED' and pc.resolution is null) then
    v := v || 'R3-05'::text;
  end if;
  return v;
end $$;

create or replace function public.dist_claim_detail(p_claim_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  u public.app_user := public.assert_role(array['DISTRIBUTOR', 'M24_ADMIN', 'M24_FINANCE', 'M24_VIEWER']);
  dcl public.dist_claim;
begin
  select * into dcl from public.dist_claim where id = p_claim_id;
  if not found or (u.role = 'DISTRIBUTOR' and dcl.distributor_id <> u.distributor_id) then perform public.fail('NOT_FOUND'); end if;
  return jsonb_build_object(
    'claim', to_jsonb(dcl) || jsonb_build_object('distributor', (select jsonb_build_object('id', x.id, 'code', x.code, 'name', x.name) from public.distributor x where x.id = dcl.distributor_id)),
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'line_id', l.id, 'coupon_id', cp.id, 'serial', cp.serial, 'value_paise', cp.value_paise,
        'dealer', d.name, 'dealer_cn_no', dc.cn_no, 'dealer_cn_date', dc.cn_date,
        'coupon_status', cp.status, 'line_status', l.status, 'reason', l.reason,
        'painter_status', coalesce(pc.status, 'NONE'), 'painter_flags', to_jsonb(coalesce(pc.flags, '{}')),
        'failures', to_jsonb(case when l.status in ('PENDING', 'HELD') then public.m24_line_failures(cp, l, dcl) else '{}'::text[] end))
        order by cp.serial)
      from public.dist_claim_line l
      join public.coupon cp on cp.id = l.coupon_id
      join public.dealer_claim dc on dc.id = l.dealer_claim_id
      join public.dealer d on d.id = dc.dealer_id
      left join public.painter_confirmation pc on pc.batch_id = cp.redemption_batch_id
     where l.claim_id = dcl.id and l.status <> 'MOVED'), '[]'::jsonb));
end $$;

create or replace function public.m24_decide(p_claim_id bigint, p_coupon_ids bigint[], p_decision text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u public.app_user := public.assert_role(array['M24_ADMIN']);
  dcl public.dist_claim; l record; v_fail text[]; v_out jsonb := '[]'::jsonb; v_ok int := 0; v_now timestamptz := public.app_now();
begin
  if coalesce(p_decision, '') not in ('APPROVE', 'REJECT', 'HOLD') then perform public.fail('BAD_REQUEST'); end if;
  if p_decision in ('REJECT', 'HOLD') and length(coalesce(btrim(p_reason), '')) < 2 then perform public.fail('REASON_REQUIRED'); end if;
  select * into dcl from public.dist_claim where id = p_claim_id for update;
  if not found then perform public.fail('NOT_FOUND'); end if;
  if dcl.status <> 'SUBMITTED' then perform public.fail('CLAIM_NOT_SUBMITTED'); end if;

  for l in
    select dl.id as line_id, cp.id as coupon_id, cp.status as coupon_status, cp.hold_prior_status
      from public.dist_claim_line dl join public.coupon cp on cp.id = dl.coupon_id
     where dl.claim_id = dcl.id
       and ((p_coupon_ids is null and dl.status = 'PENDING') or (cp.id = any (p_coupon_ids) and dl.status in ('PENDING', 'HELD')))
     order by cp.id for update of dl, cp
  loop
    if p_decision = 'APPROVE' then
      v_fail := public.m24_line_failures((select c from public.coupon c where c.id = l.coupon_id),
                                         (select x from public.dist_claim_line x where x.id = l.line_id), dcl);
      if cardinality(v_fail) > 0 then
        v_out := v_out || jsonb_build_object('coupon_id', l.coupon_id, 'result', 'NOT_ELIGIBLE', 'failures', to_jsonb(v_fail));
        continue;
      end if;
      update public.dist_claim_line set status = 'APPROVED', reason = null, decided_by = u.id, decided_at = v_now where id = l.line_id;
    elsif p_decision = 'REJECT' then
      update public.dist_claim_line set status = 'REJECTED', reason = p_reason, decided_by = u.id, decided_at = v_now where id = l.line_id;
      update public.coupon set status = 'M24_REJECTED', status_reason = p_reason,      -- EC-118: dealer already credited → recovery note
             hold_prior_status = null, hold_reason = null, held_at = null
       where id = l.coupon_id;
      perform public.log_event(l.coupon_id, 'M24_REJECTED', l.coupon_status, 'M24_REJECTED', u.id, 'dist_claim:' || dcl.id || ' ' || p_reason);
    else
      update public.dist_claim_line set status = 'HELD', reason = p_reason, decided_by = u.id, decided_at = v_now where id = l.line_id;
      if l.coupon_status = 'CLAIMED_TO_24M' then
        update public.coupon set status = 'ON_HOLD', hold_prior_status = 'CLAIMED_TO_24M', hold_reason = p_reason, held_at = v_now where id = l.coupon_id;
        perform public.log_event(l.coupon_id, 'HELD', 'CLAIMED_TO_24M', 'ON_HOLD', u.id, p_reason);
      end if;
    end if;
    v_ok := v_ok + 1;
    v_out := v_out || jsonb_build_object('coupon_id', l.coupon_id, 'result', p_decision);
  end loop;
  return jsonb_build_object('decided', v_ok, 'lines', v_out);
end $$;

create or replace function public.m24_validate_claim(p_claim_id bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['M24_ADMIN']); dcl public.dist_claim; v_total bigint; v_count int;
begin
  select * into dcl from public.dist_claim where id = p_claim_id for update;
  if not found then perform public.fail('NOT_FOUND'); end if;
  if dcl.status <> 'SUBMITTED' then perform public.fail('CLAIM_NOT_SUBMITTED'); end if;
  if exists (select 1 from public.dist_claim_line where claim_id = dcl.id and status in ('PENDING', 'HELD')) then
    perform public.fail('LINES_PENDING');
  end if;
  select count(*), coalesce(sum(c.value_paise), 0) into v_count, v_total
    from public.dist_claim_line l join public.coupon c on c.id = l.coupon_id where l.claim_id = dcl.id and l.status = 'APPROVED';
  update public.dist_claim set status = 'VALIDATED', validated_by = u.id, validated_at = public.app_now(), total_paise = v_total
   where id = dcl.id;
  perform public.log_admin(u.id, 'M24_VALIDATE', 'dist_claim:' || dcl.id, null, jsonb_build_object('count', v_count, 'total_paise', v_total));
  return jsonb_build_object('claim_id', dcl.id, 'count', v_count, 'total_paise', v_total);
end $$;

create or replace function public.m24_return_claim(p_claim_id bigint, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['M24_ADMIN']); dcl public.dist_claim;
begin
  if length(coalesce(btrim(p_reason), '')) < 5 then perform public.fail('REASON_REQUIRED'); end if;
  select * into dcl from public.dist_claim where id = p_claim_id for update;
  if not found or dcl.status not in ('SUBMITTED', 'VALIDATED') then perform public.fail('NOT_RETURNABLE'); end if;
  with r as (
    update public.coupon c set status = 'DIST_CN_ISSUED', dist_claim_id = null
      from public.dist_claim_line l where l.claim_id = dcl.id and l.coupon_id = c.id and l.status in ('PENDING', 'APPROVED') and c.status = 'CLAIMED_TO_24M'
    returning c.id
  ) insert into public.coupon_event (coupon_id, event, from_status, to_status, user_id, ref, at)
    select id, 'RETURNED', 'CLAIMED_TO_24M', 'DIST_CN_ISSUED', u.id, 'dist_claim:' || dcl.id, public.app_now() from r;
  update public.dist_claim_line set status = 'MOVED' where claim_id = dcl.id and status in ('PENDING', 'APPROVED');
  update public.dist_claim set status = 'RETURNED', returned_reason = p_reason, validated_by = null, validated_at = null where id = dcl.id;
  perform public.log_admin(u.id, 'M24_RETURN', 'dist_claim:' || dcl.id, p_reason);
end $$;

-- Checker: a different person settles with the 24M CN (R3-06, R3-07).
create or replace function public.m24_settle(p_claim_id bigint, p_cn_no text, p_cn_date date)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u public.app_user := public.assert_role(array['M24_FINANCE']);
  dcl public.dist_claim; v_count int; v_total bigint; v_now timestamptz := public.app_now();
begin
  select * into dcl from public.dist_claim where id = p_claim_id for update;
  if not found then perform public.fail('NOT_FOUND'); end if;
  if dcl.status <> 'VALIDATED' then perform public.fail('CLAIM_NOT_VALIDATED'); end if;
  if dcl.validated_by = u.id then perform public.fail('MAKER_CANNOT_SETTLE'); end if;        -- EC-117
  if p_cn_no is null or p_cn_no !~ '^[A-Za-z0-9/_.-]{1,40}$' then perform public.fail('CN_REQUIRED'); end if;
  if p_cn_date is null or p_cn_date < public.ist_date(dcl.created_at) or p_cn_date > public.ist_date(v_now) then
    perform public.fail('BAD_CN_DATE');
  end if;
  if exists (select 1 from public.dist_claim where upper(cn_no) = upper(p_cn_no)) then perform public.fail('DUPLICATE_CN'); end if;
  with s as (
    update public.coupon c set status = 'SETTLED'
      from public.dist_claim_line l where l.claim_id = dcl.id and l.coupon_id = c.id and l.status = 'APPROVED' and c.status = 'CLAIMED_TO_24M'
    returning c.id, c.value_paise
  ), e as (
    insert into public.coupon_event (coupon_id, event, from_status, to_status, user_id, ref, at)
    select id, 'SETTLED', 'CLAIMED_TO_24M', 'SETTLED', u.id, 'dist_claim:' || dcl.id || ' cn:' || p_cn_no, v_now from s returning 1
  ) select (select count(*) from s), (select coalesce(sum(value_paise), 0) from s) into v_count, v_total;
  update public.dist_claim set status = 'SETTLED', settled_by = u.id, settled_at = v_now, cn_no = p_cn_no, cn_date = p_cn_date,
         total_paise = v_total, settled_count = v_count where id = dcl.id;
  perform public.log_admin(u.id, 'M24_SETTLE', 'dist_claim:' || dcl.id, null, jsonb_build_object('cn', p_cn_no, 'total_paise', v_total));
  return jsonb_build_object('claim_id', dcl.id, 'count', v_count, 'total_paise', v_total);
end $$;

-- ERP CSV source (§5.4 step 3).
create or replace function public.m24_settlement_export(p_claim_id bigint)
returns table (claim_id bigint, distributor_code text, cn_no text, cn_date date, serial text, value_paise bigint,
               dealer_code text, dealer_cn_no text, redeemed_at timestamptz, painter_status text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_role(array['M24_ADMIN', 'M24_FINANCE', 'M24_VIEWER']);
  return query
  select dcl.id, x.code, dcl.cn_no, dcl.cn_date, c.serial, c.value_paise, d.code, dc.cn_no, c.redeemed_at, coalesce(pc.status, 'NONE')
    from public.dist_claim dcl
    join public.distributor x on x.id = dcl.distributor_id
    join public.dist_claim_line l on l.claim_id = dcl.id and l.status = 'APPROVED'
    join public.coupon c on c.id = l.coupon_id
    join public.dealer_claim dc on dc.id = l.dealer_claim_id
    join public.dealer d on d.id = dc.dealer_id
    left join public.painter_confirmation pc on pc.batch_id = c.redemption_batch_id
   where dcl.id = p_claim_id and dcl.status = 'SETTLED'
   order by c.serial;
end $$;
