-- Fails the build on any plpgsql_check error or warning in public/private functions.
select p.oid::regprocedure || ': ' || r.level || ': ' || r.message || coalesce(' (' || r.statement || ')', '')
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  cross join lateral extensions.plpgsql_check_function_tb(p.oid,
      relid => coalesce((select tgrelid from pg_trigger where tgfoid = p.oid limit 1), 0),
      extra_warnings => false) r
 where n.nspname in ('public', 'private') and l.lanname = 'plpgsql'
   and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
   -- Exempt: reads Supabase Vault via dynamic SQL; the vault schema does not exist locally.
   and p.oid <> 'private.invoke_wa_sender()'::regprocedure
 order by 1;
