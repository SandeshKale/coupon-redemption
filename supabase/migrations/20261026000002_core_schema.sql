-- 0002: core tables (§11). All writes go through security definer functions (§12).

-- ── Configuration ───────────────────────────────────────────────────────────
create table public.app_config (
  key text primary key,
  value jsonb not null,
  updated_by bigint,
  updated_at timestamptz not null default now()
);

-- ── Masters ─────────────────────────────────────────────────────────────────
create table public.distributor (
  id serial primary key,
  code text not null unique check (code ~ '^[A-Z0-9-]{2,20}$'),
  name text not null check (length(name) between 2 and 120),
  mobile_e164 text check (mobile_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  city text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.dealer (
  id serial primary key,
  code text not null unique check (code ~ '^[A-Z0-9-]{2,20}$'),
  name text not null check (length(name) between 2 and 120),
  mobile_e164 text not null unique check (mobile_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  city text,
  distributor_id int not null references public.distributor,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE', 'BLOCKED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index dealer_distributor_idx on public.dealer (distributor_id);

create table public.dealer_distributor_history (
  id bigserial primary key,
  dealer_id int not null references public.dealer,
  from_distributor_id int references public.distributor,
  to_distributor_id int not null references public.distributor,
  changed_by bigint,
  changed_at timestamptz not null default now()
);
create index on public.dealer_distributor_history (dealer_id, changed_at);
create index on public.dealer_distributor_history (from_distributor_id);
create index on public.dealer_distributor_history (to_distributor_id);

create table public.app_user (
  id bigserial primary key,
  auth_user_id uuid unique,
  name text not null check (length(name) between 2 and 120),
  mobile_e164 text check (mobile_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  email text,
  role text not null check (role in ('DEALER_STAFF', 'DEALER_OWNER', 'DISTRIBUTOR', 'M24_ADMIN', 'M24_FINANCE', 'M24_VIEWER')),
  dealer_id int references public.dealer,
  distributor_id int references public.distributor,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_by bigint references public.app_user,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_user_scope check (
    (role in ('DEALER_STAFF', 'DEALER_OWNER') and dealer_id is not null and distributor_id is null)
    or (role = 'DISTRIBUTOR' and distributor_id is not null and dealer_id is null)
    or (role like 'M24_%' and dealer_id is null and distributor_id is null)
  )
);
create unique index app_user_mobile_active on public.app_user (mobile_e164) where status = 'ACTIVE';
create index on public.app_user (dealer_id);
create index on public.app_user (distributor_id);
create index on public.app_user (created_by);
create index app_user_mobile_idx on public.app_user (mobile_e164);

-- Requests: dealer-owner staff additions and "request new link" from logged-out screens.
create table public.user_request (
  id bigserial primary key,
  kind text not null check (kind in ('NEW_STAFF', 'LOGIN_LINK')),
  requested_by bigint references public.app_user,
  target_user_id bigint references public.app_user,
  name text,
  mobile_e164 text,
  dealer_id int references public.dealer,
  distributor_id int references public.distributor,
  status text not null default 'PENDING' check (status in ('PENDING', 'DONE', 'REJECTED')),
  decided_by bigint references public.app_user,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.user_request (distributor_id, status);
create index on public.user_request (dealer_id);
create index on public.user_request (requested_by);
create index on public.user_request (target_user_id);
create index on public.user_request (decided_by);

create table public.sku (
  code text primary key check (code ~ '^[A-Z0-9-]{2,30}$'),
  name text not null,
  active boolean not null default true
);

-- ── Coupons ─────────────────────────────────────────────────────────────────
create table public.serial_counter (
  prefix text primary key check (prefix ~ '^[A-Z0-9]{2,6}$'),
  last_value bigint not null default 0
);

create table public.coupon_lot (
  id serial primary key,
  lot_no text not null unique check (lot_no ~ '^[A-Z0-9-]{2,30}$'),
  quantity int not null check (quantity between 1 and 200000),
  value_paise bigint not null check (value_paise > 0 and value_paise <= 10000000),
  intended_sku text references public.sku,
  serial_prefix text not null references public.serial_counter,
  serial_from bigint not null,
  serial_to bigint not null,
  status text not null default 'GENERATING' check (status in ('GENERATING', 'GENERATED', 'EXPORTED')),
  generated_count int not null default 0,
  export_count int not null default 0,
  last_export_sha256 text,
  created_by bigint not null references public.app_user,
  created_at timestamptz not null default now(),
  check (serial_to - serial_from + 1 = quantity)
);
create index on public.coupon_lot (intended_sku);
create index on public.coupon_lot (serial_prefix);
create index on public.coupon_lot (created_by);

create table public.coupon_lot_export (
  id bigserial primary key,
  lot_id int not null references public.coupon_lot,
  exported_by bigint not null references public.app_user,
  reason text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  row_count int,
  sha256 text
);
create index on public.coupon_lot_export (lot_id);
create index on public.coupon_lot_export (exported_by);

create table public.coupon_transition (
  from_status text not null,
  to_status text not null,
  primary key (from_status, to_status)
);

-- Forward-declared claim tables (coupon references them).
create table public.dealer_claim (
  id bigserial primary key,
  dealer_id int not null references public.dealer,
  distributor_id int not null references public.distributor,
  status text not null default 'OPEN' check (status in ('OPEN', 'SUBMITTED', 'CN_ISSUED', 'ACKNOWLEDGED')),
  slip_token text not null unique default encode(extensions.gen_random_bytes(12), 'hex'),
  opened_at timestamptz not null default now(),
  submitted_at timestamptz,
  submitted_by bigint references public.app_user,
  cn_no text check (cn_no is null or cn_no ~ '^[A-Za-z0-9/_.-]{1,40}$'),
  cn_date date,
  cn_total_paise bigint,
  cn_count int,
  closed_by bigint references public.app_user,
  closed_at timestamptz,
  acked_by bigint references public.app_user,
  acked_at timestamptz
);
create unique index dealer_claim_one_open on public.dealer_claim (dealer_id) where status = 'OPEN';
create unique index dealer_claim_cn_unique on public.dealer_claim (distributor_id, upper(cn_no)) where cn_no is not null;
create index on public.dealer_claim (distributor_id, status);
create index on public.dealer_claim (submitted_by);
create index on public.dealer_claim (closed_by);
create index on public.dealer_claim (acked_by);

create table public.dist_claim (
  id bigserial primary key,
  distributor_id int not null references public.distributor,
  status text not null default 'SUBMITTED' check (status in ('SUBMITTED', 'VALIDATED', 'SETTLED', 'RETURNED')),
  slip_token text not null unique default encode(extensions.gen_random_bytes(12), 'hex'),
  created_by bigint not null references public.app_user,
  created_at timestamptz not null default now(),
  validated_by bigint references public.app_user,
  validated_at timestamptz,
  settled_by bigint references public.app_user,
  settled_at timestamptz,
  returned_reason text,
  cn_no text check (cn_no is null or cn_no ~ '^[A-Za-z0-9/_.-]{1,40}$'),
  cn_date date,
  total_paise bigint,
  settled_count int,
  constraint maker_not_checker check (settled_by is null or settled_by <> validated_by)
);
create unique index dist_claim_cn_unique on public.dist_claim (upper(cn_no)) where cn_no is not null;
create index on public.dist_claim (distributor_id, status);
create index on public.dist_claim (created_by);
create index on public.dist_claim (validated_by);
create index on public.dist_claim (settled_by);

create table public.redemption_batch (
  id bigserial primary key,
  dealer_id int not null references public.dealer,
  user_id bigint not null references public.app_user,
  coupon_count int not null check (coupon_count between 1 and 50),
  value_paise bigint not null check (value_paise > 0),
  created_at timestamptz not null default now()
);
create index on public.redemption_batch (dealer_id, created_at desc);
create index on public.redemption_batch (user_id);

create table public.coupon (
  id bigserial primary key,
  lot_id int not null references public.coupon_lot,
  serial_no bigint not null,
  serial text not null unique,
  code char(12) not null unique check (code ~ '^[0-9A-HJKMNP-TV-Z]{12}$'),
  value_paise bigint not null check (value_paise > 0),
  status text not null default 'GENERATED' check (status in (
    'GENERATED', 'ACTIVE', 'REDEEMED', 'ON_HOLD', 'DIST_CN_ISSUED', 'DIST_REJECTED',
    'CLAIMED_TO_24M', 'SETTLED', 'M24_REJECTED', 'BLOCKED', 'EXPIRED', 'VOID')),
  sku text references public.sku,
  batch_no text,
  mfg_date date,
  expires_at timestamptz,
  activated_at timestamptz,
  activated_by bigint references public.app_user,
  redeemed_at timestamptz,
  redeemed_dealer_id int references public.dealer,
  redeemed_user_id bigint references public.app_user,
  routed_distributor_id int references public.distributor,
  dealer_claim_id bigint references public.dealer_claim,
  redemption_batch_id bigint references public.redemption_batch,
  dist_claim_id bigint references public.dist_claim,
  hold_reason text,
  hold_prior_status text,
  held_at timestamptz,
  status_reason text,
  updated_at timestamptz not null default now(),
  unique (serial_no, lot_id),
  check ((status = 'ON_HOLD') = (hold_prior_status is not null))
);
create index on public.coupon (lot_id, serial_no);
create index on public.coupon (redemption_batch_id);
create index on public.coupon (redeemed_dealer_id, redeemed_at desc);
create index on public.coupon (routed_distributor_id, status);
create index on public.coupon (dealer_claim_id);
create index on public.coupon (dist_claim_id);
create index on public.coupon (redeemed_user_id);
create index on public.coupon (activated_by);
create index on public.coupon (sku);
create index coupon_active_expiry on public.coupon (expires_at) where status = 'ACTIVE';

create table public.dealer_claim_line (
  id bigserial primary key,
  claim_id bigint not null references public.dealer_claim,
  coupon_id bigint not null references public.coupon,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED', 'HELD', 'MOVED', 'REVERSED')),
  reason text,
  decided_by bigint references public.app_user,
  decided_at timestamptz
);
-- R2-03: a coupon is live in at most one dealer claim.
create unique index dealer_claim_line_live on public.dealer_claim_line (coupon_id) where status not in ('MOVED', 'REVERSED');
create index on public.dealer_claim_line (claim_id, status);
create index on public.dealer_claim_line (coupon_id);
create index on public.dealer_claim_line (decided_by);

create table public.dist_claim_line (
  id bigserial primary key,
  claim_id bigint not null references public.dist_claim,
  coupon_id bigint not null references public.coupon,
  dealer_claim_id bigint not null references public.dealer_claim,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED', 'HELD', 'MOVED')),
  reason text,
  decided_by bigint references public.app_user,
  decided_at timestamptz
);
-- R3-03: a coupon is live in at most one distributor claim.
create unique index dist_claim_line_live on public.dist_claim_line (coupon_id) where status <> 'MOVED';
create index on public.dist_claim_line (claim_id, status);
create index on public.dist_claim_line (coupon_id);
create index on public.dist_claim_line (dealer_claim_id);
create index on public.dist_claim_line (decided_by);

-- ── Audit (add-only) ───────────────────────────────────────────────────────
create table public.coupon_event (
  id bigserial primary key,
  coupon_id bigint not null references public.coupon,
  event text not null,
  from_status text,
  to_status text,
  user_id bigint references public.app_user,
  ref text,
  at timestamptz not null default now()
);
create index on public.coupon_event (coupon_id, at);
create index on public.coupon_event (user_id);

create table public.scan_attempt (
  id bigserial primary key,
  user_id bigint references public.app_user,
  coupon_id bigint references public.coupon,
  dealer_id int references public.dealer,
  result text not null,
  code_hint text,
  at timestamptz not null default now()
);
create index on public.scan_attempt (user_id, at);
create index on public.scan_attempt (coupon_id, at);
create index on public.scan_attempt (dealer_id, at);
create index on public.scan_attempt (result, at);

create table public.idempotency (
  user_id bigint not null references public.app_user,
  key uuid not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);
create index on public.idempotency (created_at);

create table public.admin_log (
  id bigserial primary key,
  user_id bigint references public.app_user,
  action text not null,
  target text,
  reason text,
  details jsonb not null default '{}',
  at timestamptz not null default now()
);
create index on public.admin_log (at);
create index on public.admin_log (user_id);

-- ── Painters and WhatsApp ───────────────────────────────────────────────────
create table public.painter (
  id bigserial primary key,
  phone_e164 text unique,
  phone_hash bytea not null unique,
  phone_masked text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  confirm_count int not null default 0,
  status text not null default 'OK' check (status in ('OK', 'WATCH', 'BLOCKED', 'ANONYMISED')),
  privacy_notice_sent_at timestamptz,
  lang text not null default 'hi+en' check (lang in ('hi+en', 'en', 'hi', 'mr')),
  notes text
);

create table public.painter_confirmation (
  id bigserial primary key,
  batch_id bigint not null unique references public.redemption_batch,
  token char(6) not null check (token ~ '^[0-9A-HJKMNP-TV-Z]{6}$' and token ~ '[0-9]'),
  status text not null default 'PENDING' check (status in ('PENDING', 'CONFIRMED', 'LATE', 'DISPUTED', 'SKIPPED', 'EXPIRED')),
  created_at timestamptz not null default now(),
  on_time_until timestamptz not null,
  expires_at timestamptz not null,
  painter_id bigint references public.painter,
  confirmed_at timestamptz,
  disputed_at timestamptz,
  skip_reason text,
  flags text[] not null default '{}',
  wa_message_id text,
  resolved_at timestamptz,
  resolved_by bigint references public.app_user,
  resolution text check (resolution is null or resolution in ('RELEASED', 'REJECTED')),
  check (on_time_until <= expires_at)
);
create unique index open_token_unique on public.painter_confirmation (token)
  where status in ('PENDING', 'CONFIRMED', 'LATE');
create index on public.painter_confirmation (painter_id, confirmed_at);
create index on public.painter_confirmation (status, expires_at);
create index on public.painter_confirmation (resolved_by);

create table public.wa_inbound (
  id bigserial primary key,
  wamid text not null unique,
  from_e164 text not null,
  painter_id bigint references public.painter,
  msg_type text not null,
  body text check (body is null or length(body) <= 1000),
  msg_ts timestamptz not null,
  received_at timestamptz not null default now(),
  intent text check (intent is null or intent in ('CONFIRM', 'DISPUTE', 'STOP', 'HELP')),
  result text,
  processed_at timestamptz
);
create index on public.wa_inbound (from_e164, received_at);
create index on public.wa_inbound (painter_id, received_at);
create index on public.wa_inbound (result, received_at);

create table public.wa_outbox (
  id bigserial primary key,
  to_e164 text not null,
  painter_id bigint references public.painter,
  body text not null check (length(body) <= 4096),
  inbound_id bigint references public.wa_inbound,
  window_expires_at timestamptz not null,
  status text not null default 'QUEUED' check (status in ('QUEUED', 'RETRY', 'SENT', 'FAILED', 'EXPIRED_WINDOW')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  meta_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index on public.wa_outbox (status, next_attempt_at);
create index on public.wa_outbox (inbound_id);
create index on public.wa_outbox (painter_id);

create table public.wa_template (
  key text not null,
  lang text not null check (lang in ('en', 'hi', 'mr')),
  body text not null,
  primary key (key, lang)
);

create table public.support_note (
  id bigserial primary key,
  painter_id bigint references public.painter,
  inbound_id bigint references public.wa_inbound,
  kind text not null,
  note text,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by bigint references public.app_user
);
create index on public.support_note (painter_id);
create index on public.support_note (inbound_id);
create index on public.support_note (closed_by);

-- ── Public lookups, reconciliation, review ─────────────────────────────────
create table public.public_lookup (
  id bigserial primary key,
  ip_hash bytea not null,
  at timestamptz not null default now()
);
create index on public.public_lookup (ip_hash, at);

create table public.recon_issue (
  id bigserial primary key,
  run_date date not null,
  check_name text not null,
  ref text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (run_date, check_name, ref)
);

create table public.review_log (
  id bigserial primary key,
  reviewed_by bigint not null references public.app_user,
  reviewed_at timestamptz not null default now(),
  notes text
);
create index on public.review_log (reviewed_by);

create table public.login_link_attempt (
  id bigserial primary key,
  ip_hash bytea not null,
  at timestamptz not null default now()
);
create index on public.login_link_attempt (ip_hash, at);
