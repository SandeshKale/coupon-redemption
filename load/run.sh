#!/usr/bin/env bash
# Runs the release-gate k6 suite (§20.7) against STAGING. See load/README.md for the env vars.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${STAGING_DB_URL:?}" "${K6_API_URL:?}" "${K6_ANON_KEY:?}" "${K6_JWT_SECRET:?}" "${K6_WA_APP_SECRET:?}"
mkdir -p load/.out
export K6_RUN_ID="${K6_RUN_ID:-$(date +%s)}"

psql "$STAGING_DB_URL" -X -q -v confirm_staging=yes -f load/seed-staging.sql
node load/mint-tokens.mjs load/.out/users.txt > load/.out/tokens.txt
export K6_DEALER_TOKENS="$PWD/load/.out/tokens.txt"

# The race uses the LAST code; throughput consumes codes from the start.
tail -n 1 load/.out/codes.txt > load/.out/race-code.txt
K6_CODES="$PWD/load/.out/race-code.txt" k6 run load/redeem-same-code.js
K6_CODES="$PWD/load/.out/codes.txt" k6 run load/redeem-throughput.js
k6 run load/webhook-burst.js
psql "$STAGING_DB_URL" -X -f load/month-end.sql
psql "$STAGING_DB_URL" -X -v run_id="$K6_RUN_ID" -v code="$(cat load/.out/race-code.txt)" -f load/verify.sql
