-- 0012: scheduled jobs (§23). Every job is idempotent: running it twice changes nothing more.

-- Claim cut-off: OPEN claims opened before the current IST month → SUBMITTED (00:05 IST on the 1st).
create or replace function public.job_submit_dealer_claims()
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare v_month_start timestamptz := (date_trunc('month', public.ist_date(public.app_now()))::timestamp) at time zone 'Asia/Kolkata';
        v_count int;
begin
  update public.dealer_claim c set status = 'SUBMITTED', submitted_at = public.app_now()
   where c.status = 'OPEN' and c.opened_at < v_month_start
     and exists (select 1 from public.dealer_claim_line l where l.claim_id = c.id and l.status = 'PENDING');
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function public.job_expire_coupons()
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count int;
begin
  with x as (
    update public.coupon set status = 'EXPIRED' where status = 'ACTIVE' and expires_at <= public.app_now() returning id
  ), e as (
    insert into public.coupon_event (coupon_id, event, from_status, to_status, user_id, ref, at)
    select id, 'EXPIRED', 'ACTIVE', 'EXPIRED', null, 'job', public.app_now() from x returning 1
  ) select count(*) into v_count from e;
  return v_count;
end $$;

create or replace function public.job_expire_painter_tokens()
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count int;
begin
  update public.painter_confirmation set status = 'EXPIRED' where status = 'PENDING' and expires_at <= public.app_now();
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function public.job_cleanup()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_idem int; v_lookup int; v_links int;
begin
  delete from public.idempotency where created_at < public.app_now() - interval '7 days';
  get diagnostics v_idem = row_count;
  delete from public.public_lookup where at < public.app_now() - interval '1 day';
  get diagnostics v_lookup = row_count;
  delete from public.login_link_attempt where at < public.app_now() - interval '1 day';
  get diagnostics v_links = row_count;
  return jsonb_build_object('idempotency', v_idem, 'public_lookup', v_lookup, 'login_link_attempt', v_links);
end $$;

-- Safety-net call to the wa-sender Edge Function via pg_net. URL and secret live in Supabase Vault
-- (names: wa_sender_url, wa_sender_secret); without them this is a no-op.
create or replace function private.invoke_wa_sender()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_url text; v_secret text;
begin
  if to_regnamespace('vault') is null or to_regnamespace('net') is null then return; end if;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'wa_sender_url'$q$ into v_url;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'wa_sender_secret'$q$ into v_secret;
  if v_url is null or v_secret is null then return; end if;
  if not exists (select 1 from public.wa_outbox where status in ('QUEUED', 'RETRY') and next_attempt_at <= now()) then return; end if;
  execute 'select net.http_post(url := $1, body := ''{}''::jsonb, headers := jsonb_build_object(''content-type'', ''application/json'', ''x-internal-secret'', $2), timeout_milliseconds := 8000)'
    using v_url, v_secret;
end $$;
revoke all on function private.invoke_wa_sender() from public;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- pg_cron runs in UTC. IST = UTC+05:30.
    perform cron.schedule('claim-cutoff', '35 18 * * *', 'select public.job_submit_dealer_claims()');       -- 00:05 IST daily (acts on the 1st)
    perform cron.schedule('coupon-expiry', '30 19 * * *', 'select public.job_expire_coupons()');           -- 01:00 IST
    perform cron.schedule('painter-token-expiry', '*/15 * * * *', 'select public.job_expire_painter_tokens()');
    perform cron.schedule('wa-sender-retry', '* * * * *', 'select private.invoke_wa_sender()');
    perform cron.schedule('reconciliation', '30 20 * * *', 'select public.run_reconciliation()');           -- 02:00 IST
    perform cron.schedule('cleanup', '0 21 * * 0', 'select public.job_cleanup()');                          -- Mon 02:30 IST
  end if;
end $$;
