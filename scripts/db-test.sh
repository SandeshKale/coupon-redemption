#!/usr/bin/env bash
# Builds a throwaway database from zero (shim → migrations → helpers → seed) and runs:
#   plpgsql_check on every function, then pgTAP via pg_prove.
# Env: PGHOST/PGPORT/PGUSER/PGPASSWORD as usual; DB (default coupon_test).
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${DB:-coupon_test}"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -d "$DB")

psql -X -q -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB"
# Frozen-clock support is enabled ONLY in this throwaway database (see app_now()).
psql -X -q -d postgres -c "alter database $DB set app.allow_clock_override = 'on'" \
  -c "alter database $DB set search_path = public, extensions"

"${PSQL[@]}" -f supabase/test-support/shim.sql
for f in supabase/migrations/*.sql; do
  "${PSQL[@]}" -f "$f"
done
"${PSQL[@]}" -f supabase/test-support/helpers.sql
"${PSQL[@]}" -o /dev/null -f supabase/seed.sql
"${PSQL[@]}" -c "create extension if not exists pgtap with schema extensions" -c "create extension if not exists plpgsql_check with schema extensions"

echo "── plpgsql_check"
"${PSQL[@]}" -At -f supabase/test-support/plpgsql_check.sql | tee /tmp/plpgsql_check.out
if [ -s /tmp/plpgsql_check.out ]; then
  echo "plpgsql_check reported issues" >&2
  exit 1
fi

echo "── pgTAP"
pg_prove -d "$DB" --ext .sql -r supabase/tests "$@"
