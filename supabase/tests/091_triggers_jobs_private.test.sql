-- Trigger functions and the private pg_net caller.
begin;
select plan(8);

select tests.redeem('Owner A', array[1]);
select throws_ok($$update public.redemption_batch set value_paise = 1$$, 'P0001', null, 'forbid_change: batches are immutable');
select is((select count(*)::int from pg_trigger where tgfoid = 'public.forbid_change'::regproc), 12, 'forbid_change: 5 add-only tables (row + truncate) + coupon/wa_inbound truncate');
update public.dealer set name = 'Renamed' where id = 1;
select ok((select updated_at from public.dealer where id = 1) >= now(), 'touch_updated_at');
select public.wa_record_error('wamid.err', '+919811100000', 'text', now(), 'boom');
select throws_ok($$update public.wa_inbound set body = 'changed' where wamid = 'wamid.err'$$, 'P0001', null, 'wa_inbound_guard: body cannot be rewritten');
select throws_ok($$update public.wa_inbound set result = 'X' where wamid = 'wamid.err'$$, 'P0001', null, 'wa_inbound_guard: result set only once');
select lives_ok($$update public.wa_inbound set from_e164 = public.mask_phone(from_e164) where wamid = 'wamid.err'$$, 'wa_inbound_guard: masking allowed');
select throws_ok($$delete from public.wa_inbound$$, 'P0001', null, 'wa_inbound_guard: no delete');
select lives_ok($$select private.invoke_wa_sender()$$, 'invoke_wa_sender is a no-op without Vault/pg_net');

select * from finish();
rollback;
