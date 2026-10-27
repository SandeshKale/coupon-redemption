#!/usr/bin/env bash
# Post-deploy smoke test (§24 release). Read-only: never redeems or writes production data.
# Env: SMOKE_API_URL (https://<ref>.supabase.co), SMOKE_ANON_KEY, SMOKE_WEB_URL, SMOKE_WA_VERIFY_TOKEN.
set -euo pipefail
: "${SMOKE_API_URL:?}" "${SMOKE_ANON_KEY:?}" "${SMOKE_WEB_URL:?}"
fail() { echo "smoke FAILED: $*" >&2; exit 1; }

echo "1. health function reaches the database"
curl -fsS --max-time 15 "$SMOKE_API_URL/functions/v1/health" | grep -q '"ok":true' || fail health

echo "2. anon key sees 0 rows from a protected table (RLS)"
rows=$(curl -fsS --max-time 15 "$SMOKE_API_URL/rest/v1/coupon?select=id&limit=1" \
  -H "apikey: $SMOKE_ANON_KEY" -H "authorization: Bearer $SMOKE_ANON_KEY" || echo denied)
[ "$rows" = "[]" ] || [ "$rows" = "denied" ] || fail "anon read coupon: $rows"

echo "3. public coupon lookup answers for an unknown code without leaking data"
curl -fsS --max-time 15 "$SMOKE_API_URL/rest/v1/rpc/public_coupon_info" \
  -H "apikey: $SMOKE_ANON_KEY" -H "content-type: application/json" \
  -d '{"p_code":"0000000000000"}' >/dev/null || fail public_coupon_info

echo "4. web app shell and security headers"
headers=$(curl -fsSI --max-time 15 "$SMOKE_WEB_URL/")
grep -qi '^strict-transport-security:' <<<"$headers" || fail "missing HSTS header"
grep -qi '^x-frame-options: *deny' <<<"$headers" || fail "missing X-Frame-Options"
# CSP ships as a <meta> in index.html (CSP hashes are build-specific).
curl -fsS --max-time 15 "$SMOKE_WEB_URL/" | grep -qi 'http-equiv="Content-Security-Policy"' || fail "missing CSP"

if [ -n "${SMOKE_WA_VERIFY_TOKEN:-}" ]; then
  echo "5. WhatsApp webhook verification handshake"
  got=$(curl -fsS --max-time 15 \
    "$SMOKE_API_URL/functions/v1/wa-webhook?hub.mode=subscribe&hub.verify_token=$SMOKE_WA_VERIFY_TOKEN&hub.challenge=smoke42")
  [ "$got" = "smoke42" ] || fail "webhook verify: $got"
fi
echo "smoke OK"
