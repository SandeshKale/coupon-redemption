#!/usr/bin/env bash
# §20.2 meta-test: every public function, RLS policy and allowed coupon transition must be
# referenced by name in supabase/tests. Run after scripts/db-test.sh (needs the built DB).
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${DB:-coupon_test}"
missing=0
corpus=$(cat supabase/tests/*.sql)

while read -r fn; do
  if ! grep -qE "\b${fn}\b" <<<"$corpus"; then echo "untested function: $fn"; missing=1; fi
done < <(psql -X -At -d "$DB" -c "
  select distinct p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.prokind = 'f'
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
   order by 1")

while read -r pol; do
  if ! grep -qE "\b${pol}\b" <<<"$corpus"; then echo "untested policy: $pol"; missing=1; fi
done < <(psql -X -At -d "$DB" -c "select policyname from pg_policies where schemaname = 'public' order by 1")

# Transitions: 003_transitions.test.sql enumerates every pair from coupon_transition itself.
grep -q "from public.coupon_transition" supabase/tests/003_transitions.test.sql || { echo "transition test missing"; missing=1; }

if [ "$missing" -ne 0 ]; then echo "meta-test FAILED" >&2; exit 1; fi
echo "meta-test OK: every function, policy and transition is tested"
