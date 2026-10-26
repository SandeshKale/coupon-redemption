-- §9.1: every (from, to) pair of coupon statuses — allowed pairs pass the trigger, all others raise.
begin;

create temp table statuses (s text);
insert into statuses values ('GENERATED'), ('ACTIVE'), ('REDEEMED'), ('ON_HOLD'), ('DIST_CN_ISSUED'), ('DIST_REJECTED'),
  ('CLAIMED_TO_24M'), ('SETTLED'), ('M24_REJECTED'), ('BLOCKED'), ('EXPIRED'), ('VOID');

create temp table pairs as
select a.s as from_s, b.s as to_s,
       exists (select 1 from public.coupon_transition t where t.from_status = a.s and t.to_status = b.s) as allowed
  from statuses a cross join statuses b where a.s <> b.s;

create or replace function pg_temp.try_transition(p_from text, p_to text) returns text language plpgsql as $$
declare v_id bigint;
begin
  select id into v_id from public.coupon where serial = 'P24-0000099';
  begin
    alter table public.coupon disable trigger coupon_guard;
    update public.coupon set status = p_from,
      hold_prior_status = case when p_from = 'ON_HOLD' then 'REDEEMED' end where id = v_id;
    alter table public.coupon enable trigger coupon_guard;
    update public.coupon set status = p_to,
      hold_prior_status = case when p_to = 'ON_HOLD' then 'REDEEMED' end where id = v_id;
    raise exception 'ROLLBACK_OK';
  exception
    when others then
      if sqlerrm = 'ROLLBACK_OK' then return 'OK'; end if;
      return sqlerrm;
  end;
end $$;

select plan((select count(*)::int from pairs) + 2);

select is(pg_temp.try_transition(from_s, to_s) = 'OK', allowed,
  format('%s → %s is %s', from_s, to_s, case when allowed then 'allowed' else 'forbidden' end))
from pairs order by from_s, to_s;

select is((select count(*)::int from public.coupon_transition t
            where not exists (select 1 from unnest(t.functions) f where to_regproc('public.' || f) is not null
                                 or exists (select 1 from pg_proc p where p.proname = f))),
  0, 'every allowed transition names an existing function');
select ok((select bool_and(cardinality(functions) > 0) from public.coupon_transition), 'every transition documents its function');

select * from finish();
rollback;
