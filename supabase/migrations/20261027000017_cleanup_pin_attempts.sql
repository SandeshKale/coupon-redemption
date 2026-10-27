-- 0017: the weekly cleanup also removes old PIN login attempts (the rate-limit log).
create or replace function public.job_cleanup()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_idem int; v_lookup int; v_links int; v_pins int;
begin
  delete from public.idempotency where created_at < public.app_now() - interval '7 days';
  get diagnostics v_idem = row_count;
  delete from public.public_lookup where at < public.app_now() - interval '1 day';
  get diagnostics v_lookup = row_count;
  delete from public.login_link_attempt where at < public.app_now() - interval '1 day';
  get diagnostics v_links = row_count;
  delete from public.pin_attempt where at < public.app_now() - interval '1 day';
  get diagnostics v_pins = row_count;
  return jsonb_build_object('idempotency', v_idem, 'public_lookup', v_lookup, 'login_link_attempt', v_links,
                            'pin_attempt', v_pins);
end $$;
