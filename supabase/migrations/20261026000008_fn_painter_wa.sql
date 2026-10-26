-- 0008: painter WhatsApp confirmation (§6, §13.2). Service-role functions are called only by
-- the wa-webhook / wa-sender Edge Functions. The message is parsed once, in TypeScript
-- (packages/shared parseWaMessage), and the intent/token are passed in (ADR-0004).

insert into public.wa_template (key, lang, body) values
  ('CONFIRMED', 'en', '✅ Thank you! ₹{amount} from {dealer} is confirmed (coupon {serial}). If you did NOT receive the money, reply NO.'),
  ('CONFIRMED', 'hi', '✅ धन्यवाद! {dealer} से ₹{amount} की पुष्टि हो गई (कूपन {serial})। अगर आपको पैसे नहीं मिले, तो NO लिखकर भेजें।'),
  ('CONFIRMED', 'mr', '✅ धन्यवाद! {dealer} कडून ₹{amount} ची पुष्टी झाली (कूपन {serial}). जर तुम्हाला पैसे मिळाले नसतील, तर NO असे उत्तर द्या.'),
  ('CONFIRMED_BATCH', 'en', '✅ Thank you! ₹{amount} for {count} coupons from {dealer} is confirmed. If you did NOT receive the money, reply NO.'),
  ('CONFIRMED_BATCH', 'hi', '✅ धन्यवाद! {dealer} से {count} कूपन के ₹{amount} की पुष्टि हो गई। अगर आपको पैसे नहीं मिले, तो NO लिखकर भेजें।'),
  ('CONFIRMED_BATCH', 'mr', '✅ धन्यवाद! {dealer} कडून {count} कूपनसाठी ₹{amount} ची पुष्टी झाली. जर तुम्हाला पैसे मिळाले नसतील, तर NO असे उत्तर द्या.'),
  ('ALREADY_CONFIRMED', 'en', 'You have already confirmed this payment. Thank you!'),
  ('ALREADY_CONFIRMED', 'hi', 'आप इस भुगतान की पुष्टि पहले ही कर चुके हैं। धन्यवाद!'),
  ('ALREADY_CONFIRMED', 'mr', 'तुम्ही या पेमेंटची पुष्टी आधीच केली आहे. धन्यवाद!'),
  ('TOKEN_USED', 'en', 'This code was already used. If this is a mistake, call {helpline}.'),
  ('TOKEN_USED', 'hi', 'यह कोड पहले ही इस्तेमाल हो चुका है। अगर यह गलती है, तो {helpline} पर कॉल करें।'),
  ('TOKEN_USED', 'mr', 'हा कोड आधीच वापरला गेला आहे. ही चूक असल्यास {helpline} वर कॉल करा.'),
  ('UNKNOWN_TOKEN', 'en', 'We couldn''t find this code. Please scan the QR on the dealer''s phone again.'),
  ('UNKNOWN_TOKEN', 'hi', 'यह कोड नहीं मिला। कृपया डीलर के फ़ोन पर QR फिर से स्कैन करें।'),
  ('UNKNOWN_TOKEN', 'mr', 'हा कोड सापडला नाही. कृपया डीलरच्या फोनवरील QR पुन्हा स्कॅन करा.'),
  ('EXPIRED', 'en', 'This code has expired. Please ask the dealer to show a new QR, or call {helpline}.'),
  ('EXPIRED', 'hi', 'यह कोड समाप्त हो गया है। कृपया डीलर से नया QR दिखाने को कहें, या {helpline} पर कॉल करें।'),
  ('EXPIRED', 'mr', 'या कोडची मुदत संपली आहे. कृपया डीलरला नवीन QR दाखवायला सांगा, किंवा {helpline} वर कॉल करा.'),
  ('DISPUTE_RECORDED', 'en', 'Sorry about this. We have recorded that you did not receive the money. 24M will call you within 2 working days.'),
  ('DISPUTE_RECORDED', 'hi', 'इसके लिए खेद है। हमने दर्ज कर लिया है कि आपको पैसे नहीं मिले। 24M आपको 2 कार्य दिवसों में कॉल करेगा।'),
  ('DISPUTE_RECORDED', 'mr', 'याबद्दल क्षमस्व. तुम्हाला पैसे मिळाले नाहीत हे आम्ही नोंदवले आहे. 24M तुम्हाला 2 कामकाजाच्या दिवसांत कॉल करेल.'),
  ('HELP', 'en', 'This number confirms 24M painter coupon payments. Scan the QR on your dealer''s phone and press Send. Help: {helpline}'),
  ('HELP', 'hi', 'यह नंबर 24M पेंटर कूपन भुगतान की पुष्टि करता है। अपने डीलर के फ़ोन पर QR स्कैन करें और Send दबाएँ। मदद: {helpline}'),
  ('HELP', 'mr', 'हा नंबर 24M पेंटर कूपन पेमेंटची पुष्टी करतो. तुमच्या डीलरच्या फोनवरील QR स्कॅन करा आणि Send दाबा. मदत: {helpline}'),
  ('PRIVACY', 'en', 'We use your number only to confirm coupon payments, for 3 years. Privacy: {url}. Reply STOP to remove your number.'),
  ('PRIVACY', 'hi', 'हम आपका नंबर केवल कूपन भुगतान की पुष्टि के लिए 3 साल तक इस्तेमाल करते हैं। गोपनीयता: {url}। अपना नंबर हटाने के लिए STOP लिखें।'),
  ('PRIVACY', 'mr', 'आम्ही तुमचा नंबर फक्त कूपन पेमेंटची पुष्टी करण्यासाठी 3 वर्षे वापरतो. गोपनीयता: {url}. तुमचा नंबर काढण्यासाठी STOP असे उत्तर द्या.'),
  ('STOPPED', 'en', 'Your number has been removed. Thank you.'),
  ('STOPPED', 'hi', 'आपका नंबर हटा दिया गया है। धन्यवाद।'),
  ('STOPPED', 'mr', 'तुमचा नंबर काढून टाकला आहे. धन्यवाद.');

create or replace function public.reply_text(p_key text, p_lang text, p_vars jsonb default '{}')
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_langs text[] := case when p_lang = 'hi+en' then array['hi', 'en'] else array[p_lang] end;
  v_parts text[] := '{}'::text[]; v_body text; k text;
  v_vars jsonb := jsonb_build_object('helpline', public.cfg_text('helpline'), 'url', public.cfg_text('privacy_url')) || coalesce(p_vars, '{}');
begin
  foreach k in array v_langs loop
    select body into v_body from public.wa_template where key = p_key and lang = k;
    if v_body is null then select body into v_body from public.wa_template where key = p_key and lang = 'en'; end if;
    v_parts := v_parts || v_body;
  end loop;
  v_body := array_to_string(v_parts, E'\n\n');
  for k in select jsonb_object_keys(v_vars) loop
    v_body := replace(v_body, '{' || k || '}', coalesce(v_vars ->> k, ''));
  end loop;
  return v_body;
end $$;

create or replace function public.upsert_painter(p_e164 text, p_ts timestamptz)
returns public.painter language plpgsql security definer set search_path = public, pg_temp as $$
declare v_hash bytea := public.phone_hash(p_e164); p public.painter;
begin
  insert into public.painter (phone_e164, phone_hash, phone_masked, first_seen_at, last_seen_at)
  values (p_e164, v_hash, public.mask_phone(p_e164), p_ts, p_ts)
  on conflict (phone_hash) do update
    set last_seen_at = greatest(public.painter.last_seen_at, excluded.last_seen_at),
        -- A number that sent STOP and writes again has re-engaged: restore it, re-send the notice.
        phone_e164 = excluded.phone_e164,
        status = case when public.painter.status = 'ANONYMISED' then 'OK' else public.painter.status end,
        privacy_notice_sent_at = case when public.painter.status = 'ANONYMISED' then null else public.painter.privacy_notice_sent_at end
  returning * into p;
  return p;
end $$;

-- §6.9: STOP → number removed (hash kept for fraud matching), history keeps only the masked number.
create or replace function public.anonymise_painter(p_painter_id bigint)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.painter set phone_e164 = null, notes = null, status = 'ANONYMISED' where id = p_painter_id;
  update public.wa_inbound set from_e164 = public.mask_phone(from_e164), body = null
   where painter_id = p_painter_id and from_e164 ~ '^\+[0-9]+$';
  update public.wa_outbox set to_e164 = public.mask_phone(to_e164)
   where painter_id = p_painter_id and status in ('SENT', 'FAILED', 'EXPIRED_WINDOW') and to_e164 ~ '^\+[0-9]+$';
end $$;

-- ON_HOLD for every holdable coupon of a batch (disputes, self-confirm).
create or replace function public.hold_batch(p_batch_id bigint, p_reason text, p_user bigint default null)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count int;
begin
  with h as (
    update public.coupon c set status = 'ON_HOLD', hold_prior_status = c.status, hold_reason = p_reason, held_at = public.app_now()
     where c.redemption_batch_id = p_batch_id and c.status in ('REDEEMED', 'DIST_CN_ISSUED', 'CLAIMED_TO_24M')
    returning c.id, c.hold_prior_status
  ), e as (
    insert into public.coupon_event (coupon_id, event, from_status, to_status, user_id, ref, at)
    select id, 'HELD', hold_prior_status, 'ON_HOLD', p_user, p_reason, public.app_now() from h returning 1
  ) select count(*) into v_count from e;
  return v_count;
end $$;

create or replace function public.painter_flags(p public.painter, pc public.painter_confirmation, p_ts timestamptz)
returns text[] language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_flags text[] := '{}'::text[];
  v_dealer int := (select dealer_id from public.redemption_batch where id = pc.batch_id);
  v_cfg jsonb := public.cfg('painter_flags');
begin
  if exists (select 1 from public.app_user u where u.mobile_e164 = p.phone_e164 and u.dealer_id = v_dealer)
     or exists (select 1 from public.dealer d where d.id = v_dealer and d.mobile_e164 = p.phone_e164) then
    v_flags := v_flags || 'SELF_CONFIRM'::text;
  elsif exists (select 1 from public.app_user u where u.mobile_e164 = p.phone_e164)
     or exists (select 1 from public.dealer d where d.mobile_e164 = p.phone_e164)
     or exists (select 1 from public.distributor x where x.mobile_e164 = p.phone_e164) then
    v_flags := v_flags || 'STAFF_NUMBER'::text;
  end if;
  if (select count(distinct b.dealer_id) from public.painter_confirmation c join public.redemption_batch b on b.id = c.batch_id
       where c.painter_id = p.id and c.confirmed_at > p_ts - make_interval(days => (v_cfg #>> '{multi_dealer,days}')::int)
         and b.dealer_id <> v_dealer) + 1 >= (v_cfg #>> '{multi_dealer,dealers}')::int then
    v_flags := v_flags || 'MULTI_DEALER'::text;
  end if;
  if (select count(*) from public.painter_confirmation c
       where c.painter_id = p.id and c.confirmed_at > p_ts - make_interval(hours => (v_cfg #>> '{high_volume,hours}')::int))
     + 1 >= (v_cfg #>> '{high_volume,batches}')::int then
    v_flags := v_flags || 'HIGH_VOLUME'::text;
  end if;
  if p.phone_e164 !~ '^\+91' then v_flags := v_flags || 'NON_INDIAN'::text; end if;
  if p_ts > pc.on_time_until then v_flags := v_flags || 'LATE'::text; end if;
  return v_flags;
end $$;

create or replace function public.confirm_reply(pc public.painter_confirmation, p public.painter)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select public.reply_text(
    case when b.coupon_count = 1 then 'CONFIRMED' else 'CONFIRMED_BATCH' end, p.lang,
    jsonb_build_object('amount', to_char(b.value_paise / 100.0, 'FM99,99,99,990.##'),
      'count', b.coupon_count, 'dealer', d.name,
      'serial', (select min(c.serial) from public.coupon c where c.redemption_batch_id = b.id)))
  from public.redemption_batch b join public.dealer d on d.id = b.dealer_id where b.id = pc.batch_id;
$$;

create or replace function public.handle_confirm(p public.painter, p_token text, p_ts timestamptz, p_wamid text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare pc public.painter_confirmation; v_flags text[]; v_ts timestamptz;
begin
  -- Open token first; else a token the expiry job closed while the message (by its own time) was still in window (EC-091).
  select * into pc from public.painter_confirmation
   where token = p_token and (status in ('PENDING', 'CONFIRMED', 'LATE') or (status = 'EXPIRED' and expires_at > p_ts - interval '7 days'))
   order by (status in ('PENDING', 'CONFIRMED', 'LATE')) desc, created_at desc
   limit 1 for update;
  if not found then
    return jsonb_build_object('result', 'UNKNOWN_TOKEN', 'reply', public.reply_text('UNKNOWN_TOKEN', p.lang));
  end if;
  if pc.status in ('CONFIRMED', 'LATE') then
    if pc.painter_id = p.id then
      return jsonb_build_object('result', 'ALREADY_CONFIRMED', 'reply', public.reply_text('ALREADY_CONFIRMED', p.lang));
    end if;
    update public.painter_confirmation set flags = array(select distinct unnest(flags || '{TOKEN_REUSE}'::text[])) where id = pc.id;
    update public.painter set status = 'WATCH' where id = p.id and status = 'OK';
    return jsonb_build_object('result', 'TOKEN_USED', 'reply', public.reply_text('TOKEN_USED', p.lang));
  end if;
  v_ts := greatest(p_ts, pc.created_at);
  if v_ts > pc.expires_at then
    update public.painter_confirmation set status = 'EXPIRED' where id = pc.id and status = 'PENDING';
    return jsonb_build_object('result', 'EXPIRED', 'reply', public.reply_text('EXPIRED', p.lang));
  end if;
  v_flags := public.painter_flags(p, pc, v_ts);
  begin
    update public.painter_confirmation
       set status = case when v_ts <= pc.on_time_until then 'CONFIRMED' else 'LATE' end,
           painter_id = p.id, confirmed_at = v_ts, flags = v_flags, wa_message_id = p_wamid
     where id = pc.id;
  exception when unique_violation then
    -- The expired token was re-issued to a newer batch in the meantime: ambiguous, do not guess.
    return jsonb_build_object('result', 'TOKEN_USED', 'reply', public.reply_text('TOKEN_USED', p.lang));
  end;
  update public.painter set confirm_count = confirm_count + 1 where id = p.id;
  if 'SELF_CONFIRM' = any (v_flags) then
    perform public.hold_batch(pc.batch_id, 'SELF_CONFIRM');
  end if;
  return jsonb_build_object('result', case when v_ts <= pc.on_time_until then 'CONFIRMED' else 'LATE' end,
    'reply', public.confirm_reply(pc, p), 'batch_id', pc.batch_id, 'flags', to_jsonb(v_flags));
end $$;

create or replace function public.handle_dispute(p public.painter, p_ts timestamptz, p_inbound bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare pc public.painter_confirmation;
begin
  select * into pc from public.painter_confirmation
   where painter_id = p.id and status in ('CONFIRMED', 'LATE', 'DISPUTED')
     and confirmed_at > p_ts - make_interval(hours => public.cfg_int('dispute_window_hours'))
   order by confirmed_at desc limit 1 for update;
  if found then
    if pc.status <> 'DISPUTED' then
      update public.painter_confirmation set status = 'DISPUTED', disputed_at = p_ts where id = pc.id;
      perform public.hold_batch(pc.batch_id, 'PAINTER_DISPUTE');
    end if;
    return jsonb_build_object('result', 'DISPUTED', 'batch_id', pc.batch_id, 'reply', public.reply_text('DISPUTE_RECORDED', p.lang));
  end if;
  if exists (select 1 from public.painter_confirmation where painter_id = p.id) then
    -- EC-093: dispute after 24 h is a support note, not an automatic hold.
    insert into public.support_note (painter_id, inbound_id, kind, note)
    values (p.id, p_inbound, 'LATE_DISPUTE', 'Painter replied NO after the dispute window');
    return jsonb_build_object('result', 'LATE_DISPUTE', 'reply', public.reply_text('DISPUTE_RECORDED', p.lang));
  end if;
  return jsonb_build_object('result', 'DISPUTE_NO_HISTORY', 'reply', public.reply_text('HELP', p.lang));
end $$;

create or replace function public.wa_enqueue(p_to text, p_body text, p_inbound bigint, p_window timestamptz, p_painter bigint, p_with_notice boolean)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare v_body text := p_body; v_id bigint; v_lang text;
begin
  if p_body is null then return null; end if;
  if p_with_notice and exists (select 1 from public.painter where id = p_painter and privacy_notice_sent_at is null) then
    select lang into v_lang from public.painter where id = p_painter;
    v_body := v_body || E'\n\n' || public.reply_text('PRIVACY', v_lang);
    update public.painter set privacy_notice_sent_at = public.app_now() where id = p_painter;
  end if;
  insert into public.wa_outbox (to_e164, painter_id, body, inbound_id, window_expires_at, status, next_attempt_at)
  values (p_to, p_painter, left(v_body, 4096), p_inbound, p_window,
          case when p_window <= public.app_now() then 'EXPIRED_WINDOW' else 'QUEUED' end, public.app_now())
  returning id into v_id;
  return v_id;
end $$;

-- §13.2 entry point (service role only). Returns {reply, outbox_id, result}.
create or replace function public.wa_handle_inbound(p_wamid text, p_from text, p_body text, p_type text,
  p_msg_ts timestamptz, p_intent text, p_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_now timestamptz := public.app_now();
  v_ts timestamptz := least(greatest(p_msg_ts, v_now - interval '7 days'), v_now + interval '5 minutes');  -- EC-088
  v_inbound bigint; p public.painter; v_out jsonb; v_outbox bigint;
  v_brake jsonb := public.cfg('painter_bad_token_brake');
begin
  if coalesce(p_intent, '') not in ('CONFIRM', 'DISPUTE', 'STOP', 'HELP')
     or (p_intent = 'CONFIRM' and (p_token is null or p_token !~ '^[0-9A-HJKMNP-TV-Z]{6}$' or p_token !~ '[0-9]')) then
    raise exception 'BAD_INTENT' using errcode = '22023';
  end if;
  if p_from !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'BAD_FROM' using errcode = '22023'; end if;

  insert into public.wa_inbound (wamid, from_e164, msg_type, body, msg_ts, received_at)
  values (p_wamid, p_from, left(coalesce(p_type, 'unknown'), 30), left(p_body, 1000), v_ts, v_now)
  on conflict (wamid) do nothing
  returning id into v_inbound;
  if v_inbound is null then
    return jsonb_build_object('result', 'DUPLICATE', 'reply', null);   -- EC-084
  end if;

  p := public.upsert_painter(p_from, v_ts);

  if p.status = 'BLOCKED' then
    v_out := jsonb_build_object('result', 'IGNORED_BLOCKED', 'reply', null);
  elsif (select count(*) from public.wa_inbound
          where painter_id = p.id and result = 'UNKNOWN_TOKEN'
            and received_at > v_now - make_interval(mins => (v_brake ->> 'minutes')::int)) >= (v_brake ->> 'count')::int then
    update public.painter set status = 'WATCH' where id = p.id and status = 'OK';
    v_out := jsonb_build_object('result', 'IGNORED_BRAKE', 'reply', null);               -- EC-078
  elsif p_intent = 'STOP' then
    v_out := jsonb_build_object('result', 'STOPPED', 'reply', public.reply_text('STOPPED', p.lang));
  elsif p_intent = 'DISPUTE' then
    v_out := public.handle_dispute(p, v_ts, v_inbound);
  elsif p_intent = 'CONFIRM' then
    v_out := public.handle_confirm(p, p_token, v_ts, p_wamid);
  else
    v_out := jsonb_build_object('result', 'HELP', 'reply', public.reply_text('HELP', p.lang));
  end if;

  update public.wa_inbound set painter_id = p.id, intent = p_intent, result = v_out ->> 'result', processed_at = v_now
   where id = v_inbound;
  v_outbox := public.wa_enqueue(p_from, v_out ->> 'reply', v_inbound, v_ts + interval '24 hours', p.id,
                                p_intent <> 'STOP');
  if p_intent = 'STOP' then perform public.anonymise_painter(p.id); end if;
  return v_out || jsonb_build_object('outbox_id', v_outbox, 'inbound_id', v_inbound);
end $$;

-- Marks an inbound row as failed so it can be replayed (§6.6 step 5). Service role only.
create or replace function public.wa_record_error(p_wamid text, p_from text, p_type text, p_msg_ts timestamptz, p_error text)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.wa_inbound (wamid, from_e164, msg_type, body, msg_ts, received_at, result, processed_at)
  values (p_wamid, p_from, left(coalesce(p_type, 'unknown'), 30), null, coalesce(p_msg_ts, public.app_now()),
          public.app_now(), 'ERROR:' || left(p_error, 200), public.app_now())
  on conflict (wamid) do nothing;
$$;

-- ── Outbox (§6.7) ─────────────────────────────────────────────────────────
create or replace function public.wa_claim_outbox(p_limit int default 20)
returns table (id bigint, to_e164 text, body text, attempts int)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_now timestamptz := public.app_now();
begin
  -- Never send outside the free 24-hour window (would become a paid message).
  update public.wa_outbox o set status = 'EXPIRED_WINDOW'
   where o.status in ('QUEUED', 'RETRY') and o.window_expires_at <= v_now;
  return query
  with c as (
    select o.id from public.wa_outbox o
     where o.status in ('QUEUED', 'RETRY') and o.next_attempt_at <= v_now
     order by o.next_attempt_at
     limit least(greatest(coalesce(p_limit, 20), 1), 20)
     for update skip locked
  )
  update public.wa_outbox o
     set attempts = o.attempts + 1, next_attempt_at = v_now + interval '2 minutes'   -- lease
    from c where o.id = c.id
  returning o.id, o.to_e164, o.body, o.attempts;
end $$;

create or replace function public.wa_mark_sent(p_id bigint, p_meta_id text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.wa_outbox o
     set status = 'SENT', meta_message_id = p_meta_id, sent_at = public.app_now(), last_error = null,
         to_e164 = case when exists (select 1 from public.painter p where p.id = o.painter_id and p.status = 'ANONYMISED')
                        then public.mask_phone(o.to_e164) else o.to_e164 end
   where o.id = p_id and o.status in ('QUEUED', 'RETRY');
end $$;

create or replace function public.wa_mark_failed(p_id bigint, p_error text, p_retryable boolean)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o public.wa_outbox; v_next timestamptz; v_status text;
  v_table jsonb := public.cfg('wa_sender_backoff_seconds');
begin
  select * into o from public.wa_outbox where id = p_id for update;
  if not found or o.status not in ('QUEUED', 'RETRY') then return null; end if;
  v_next := public.app_now() + make_interval(secs => (v_table ->> least(greatest(o.attempts - 1, 0), jsonb_array_length(v_table) - 1))::int);
  v_status := case
    when not p_retryable or o.attempts >= public.cfg_int('wa_sender_max_attempts') then 'FAILED'
    when v_next >= o.window_expires_at then 'EXPIRED_WINDOW'
    else 'RETRY' end;
  update public.wa_outbox set status = v_status, last_error = left(p_error, 500), next_attempt_at = v_next where id = p_id;
  return v_status;
end $$;

-- 24M admin only: full painter number (§6.9).
create or replace function public.painter_detail(p_painter_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['M24_ADMIN']); v jsonb;
begin
  select to_jsonb(p) - 'phone_hash' into v from public.painter p where p.id = p_painter_id;
  if v is null then perform public.fail('NOT_FOUND'); end if;
  perform public.log_admin(u.id, 'VIEW_PAINTER', 'painter:' || p_painter_id);
  return v;
end $$;

create or replace function public.set_painter_status(p_painter_id bigint, p_status text, p_note text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['M24_ADMIN']);
begin
  if coalesce(p_status, '') not in ('OK', 'WATCH', 'BLOCKED') then perform public.fail('BAD_REQUEST'); end if;
  update public.painter set status = p_status, notes = p_note where id = p_painter_id and status <> 'ANONYMISED';
  if not found then perform public.fail('NOT_FOUND'); end if;
  perform public.log_admin(u.id, 'SET_PAINTER_STATUS', 'painter:' || p_painter_id, p_note, jsonb_build_object('status', p_status));
end $$;
