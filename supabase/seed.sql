-- Deterministic local/staging test data (§20.8). Never run against production.
-- 3 distributors, 20 dealers, a user for every role, 3 lots (inactive, active, blocked).

insert into public.sku (code, name) values ('PRIMER-1L', '24M Primer 1 L'), ('PRIMER-4L', '24M Primer 4 L');

insert into public.distributor (id, code, name, mobile_e164, city) values
  (1, 'DIST-PUNE', 'Pune Paint Distributors', '+919800000101', 'Pune'),
  (2, 'DIST-MUM', 'Mumbai Colour House', '+919800000102', 'Mumbai'),
  (3, 'DIST-NSK', 'Nashik Coatings', '+919800000103', 'Nashik');
select setval('public.distributor_id_seq', 3);

insert into public.dealer (id, code, name, mobile_e164, city, distributor_id, status)
select g, 'DLR-' || lpad(g::text, 3, '0'),
       case g when 1 then 'Shree Ganesh Paints' when 2 then 'Sai Hardware' else 'Dealer ' || g end,
       '+9197000' || lpad(g::text, 5, '0'),
       case when g <= 8 then 'Pune' when g <= 15 then 'Mumbai' else 'Nashik' end,
       case when g <= 8 then 1 when g <= 15 then 2 else 3 end,
       case when g = 20 then 'INACTIVE' else 'ACTIVE' end
  from generate_series(1, 20) g;
select setval('public.dealer_id_seq', 20);

insert into public.dealer_distributor_history (dealer_id, from_distributor_id, to_distributor_id, changed_at)
select id, null, distributor_id, now() from public.dealer;

-- Auth users with fixed ids (u0000000-…-000000000NNN) so tests can impersonate them.
insert into auth.users (id, email)
select ('00000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'u' || g || '@users.example.in'
  from generate_series(1, 12) g;

insert into public.app_user (id, auth_user_id, name, mobile_e164, email, role, dealer_id, distributor_id, status) values
  (1, '00000000-0000-0000-0000-000000000001', 'Owner A', '+919800000001', 'u1@users.example.in', 'DEALER_OWNER', 1, null, 'ACTIVE'),
  (2, '00000000-0000-0000-0000-000000000002', 'Staff A', '+919800000002', 'u2@users.example.in', 'DEALER_STAFF', 1, null, 'ACTIVE'),
  (3, '00000000-0000-0000-0000-000000000003', 'Owner B', '+919800000003', 'u3@users.example.in', 'DEALER_OWNER', 2, null, 'ACTIVE'),
  (4, '00000000-0000-0000-0000-000000000004', 'Owner Inactive Dealer', '+919800000004', 'u4@users.example.in', 'DEALER_OWNER', 20, null, 'ACTIVE'),
  (5, '00000000-0000-0000-0000-000000000005', 'Distributor Pune', '+919800000005', 'u5@users.example.in', 'DISTRIBUTOR', null, 1, 'ACTIVE'),
  (6, '00000000-0000-0000-0000-000000000006', 'Distributor Mumbai', '+919800000006', 'u6@users.example.in', 'DISTRIBUTOR', null, 2, 'ACTIVE'),
  (7, '00000000-0000-0000-0000-000000000007', 'Admin', '+919800000007', 'u7@users.example.in', 'M24_ADMIN', null, null, 'ACTIVE'),
  (8, '00000000-0000-0000-0000-000000000008', 'Admin Two', '+919800000008', 'u8@users.example.in', 'M24_ADMIN', null, null, 'ACTIVE'),
  (9, '00000000-0000-0000-0000-000000000009', 'Finance', '+919800000009', 'u9@users.example.in', 'M24_FINANCE', null, null, 'ACTIVE'),
  (10, '00000000-0000-0000-0000-000000000010', 'Viewer', '+919800000010', 'u10@users.example.in', 'M24_VIEWER', null, null, 'ACTIVE'),
  (11, '00000000-0000-0000-0000-000000000011', 'Inactive Staff', '+919800000011', 'u11@users.example.in', 'DEALER_STAFF', 1, null, 'INACTIVE'),
  (12, '00000000-0000-0000-0000-000000000012', 'Owner Mumbai', '+919800000012', 'u12@users.example.in', 'DEALER_OWNER', 9, null, 'ACTIVE');
select setval('public.app_user_id_seq', 12);

insert into public.serial_counter (prefix, last_value) values ('P24', 135);
insert into public.coupon_lot (id, lot_no, quantity, value_paise, intended_sku, serial_prefix, serial_from, serial_to, status, generated_count, export_count, created_by) values
  (1, 'LOT-A', 100, 10000, 'PRIMER-1L', 'P24', 1, 100, 'EXPORTED', 100, 1, 7),
  (2, 'LOT-B', 20, 10000, 'PRIMER-1L', 'P24', 101, 120, 'GENERATED', 20, 0, 7),
  (3, 'LOT-C', 10, 20000, 'PRIMER-4L', 'P24', 121, 130, 'EXPORTED', 10, 1, 7),
  (4, 'LOT-D', 5, 15000, 'PRIMER-4L', 'P24', 131, 135, 'EXPORTED', 5, 1, 7);
select setval('public.coupon_lot_id_seq', 4);

-- LOT-A active ₹100, LOT-B generated (inactive), LOT-C blocked ₹200, LOT-D active ₹150.
insert into public.coupon (lot_id, serial_no, serial, code, value_paise, status, sku, batch_no, mfg_date, expires_at, activated_at, activated_by)
select 1, s, 'P24-' || lpad(s::text, 7, '0'), public.gen_code12(), 10000, 'ACTIVE', 'PRIMER-1L', 'B-001',
       current_date - 30, now() + interval '17 months', now(), 7
  from generate_series(1, 100) s;
insert into public.coupon (lot_id, serial_no, serial, code, value_paise, status, sku)
select 2, s, 'P24-' || lpad(s::text, 7, '0'), public.gen_code12(), 10000, 'GENERATED', 'PRIMER-1L'
  from generate_series(101, 120) s;
insert into public.coupon (lot_id, serial_no, serial, code, value_paise, status, sku, status_reason)
select 3, s, 'P24-' || lpad(s::text, 7, '0'), public.gen_code12(), 20000, 'BLOCKED', 'PRIMER-4L', 'recall test'
  from generate_series(121, 130) s;
insert into public.coupon (lot_id, serial_no, serial, code, value_paise, status, sku, batch_no, mfg_date, expires_at, activated_at, activated_by)
select 4, s, 'P24-' || lpad(s::text, 7, '0'), public.gen_code12(), 15000, 'ACTIVE', 'PRIMER-4L', 'B-002',
       current_date - 10, now() + interval '17 months', now(), 7
  from generate_series(131, 135) s;

update public.app_config set value = '"+91 20 0000 0000"' where key = 'helpline';
update public.app_config set value = '"919000000000"' where key = 'wa_business_number';
