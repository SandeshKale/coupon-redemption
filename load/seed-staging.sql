-- k6 staging data (§20.7): 1 distributor, 1,000 dealers (owners with auth users), 5 lakh ACTIVE
-- ₹100 coupons. STAGING ONLY: refuses to run unless invoked with -v confirm_staging=yes.
--   psql "$STAGING_DB_URL" -v confirm_staging=yes -f load/seed-staging.sql
\if :{?confirm_staging}
\else
  \echo 'refusing to run: pass -v confirm_staging=yes (staging only, never production)'
  \quit
\endif
\set ON_ERROR_STOP on
begin;

insert into public.distributor (code, name, mobile_e164, city)
values ('DIST-K6', 'k6 Load Distributor', '+919899999999', 'Pune')
on conflict (code) do nothing;

insert into public.dealer (code, name, mobile_e164, city, distributor_id, status)
select 'K6-' || lpad(g::text, 4, '0'), 'k6 Dealer ' || g, '+9196' || lpad(g::text, 8, '0'), 'Pune',
       (select id from public.distributor where code = 'DIST-K6'), 'ACTIVE'
  from generate_series(1, 1000) g
on conflict (code) do nothing;

insert into auth.users (id, email, aud, role)
select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'k6-' || g || '@load.example.in',
       'authenticated', 'authenticated'
  from generate_series(1, 1000) g
on conflict (id) do nothing;

insert into public.app_user (auth_user_id, name, mobile_e164, role, dealer_id, status)
select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'k6 Owner ' || g,
       '+9195' || lpad(g::text, 8, '0'), 'DEALER_OWNER', d.id, 'ACTIVE'
  from generate_series(1, 1000) g
  join public.dealer d on d.code = 'K6-' || lpad(g::text, 4, '0')
on conflict (auth_user_id) do nothing;

insert into public.sku (code, name) values ('PRIMER-1L', '24M Primer 1 L') on conflict (code) do nothing;

insert into public.serial_counter (prefix, last_value) values ('K6L', 500000) on conflict (prefix) do nothing;

-- Lots are capped at 2 lakh codes, so 5 lakh coupons span three lots. Needs one ACTIVE 24M admin
-- to own them (staging always has one).
insert into public.coupon_lot (lot_no, quantity, value_paise, intended_sku, serial_prefix, serial_from, serial_to,
                               status, generated_count, export_count, created_by)
select 'LOT-K6-' || r.n, r.hi - r.lo + 1, 10000, 'PRIMER-1L', 'K6L', r.lo, r.hi, 'EXPORTED', r.hi - r.lo + 1, 1,
       (select a.id from public.app_user a where a.role = 'M24_ADMIN' and a.status = 'ACTIVE' order by a.id limit 1)
  from (values (1, 1, 200000), (2, 200001, 400000), (3, 400001, 500000)) r (n, lo, hi)
on conflict (lot_no) do nothing;

insert into public.coupon (lot_id, serial_no, serial, code, value_paise, status, sku, batch_no, mfg_date,
                           expires_at, activated_at)
select l.id, s, 'K6L-' || lpad(s::text, 7, '0'), public.gen_code12(), 10000, 'ACTIVE', 'PRIMER-1L', 'K6',
       current_date, now() + interval '17 months', now()
  from public.coupon_lot l
  cross join lateral generate_series(l.serial_from, l.serial_to) s
 where l.lot_no like 'LOT-K6-%'
   and not exists (select 1 from public.coupon c where c.lot_id = l.id);

commit;

-- Codes for K6_CODES (one 13-character code per line), ACTIVE only, in serial order.
\copy (select public.code13(c.code) from public.coupon c join public.coupon_lot l on l.id = c.lot_id where l.lot_no like 'LOT-K6-%' and c.status = 'ACTIVE' order by c.serial_no) to 'load/.out/codes.txt'
-- Auth user ids for mint-tokens.mjs (first 200 dealers, as in §20.7).
\copy (select auth_user_id from public.app_user where name like 'k6 Owner %' order by id limit 200) to 'load/.out/users.txt'
