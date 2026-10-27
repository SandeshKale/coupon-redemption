# Load and concurrency suite (k6, §20.7)

Runs against **staging only**. `seed-staging.sql` refuses to run without `-v confirm_staging=yes`,
and the `Load` workflow refuses to run when the project ref equals `PRODUCTION_PROJECT_REF`.

| Script                 | Scenario                                               | Pass criteria                                                                  |
| ---------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `redeem-same-code.js`  | 100 VUs redeem the same code at once                   | exactly 1 `REDEEMED` line, 0 HTTP errors                                       |
| `redeem-throughput.js` | 300 redemptions/min for 15 min across 200 dealers      | p95 ≤ 300 ms for `check_coupon` and `redeem`, 0 errors                         |
| `webhook-burst.js`     | 50 signed webhooks/s for 2 min, 10% duplicate `wamid`s | p95 ≤ 1 s, 0 errors; `verify.sql`: one row per distinct `wamid`, all processed |
| `month-end.sql`        | 1,000 OPEN claims → `job_submit_dealer_claims()`       | < 60 s, second run is a no-op (rolled back afterwards)                         |

## Run

```sh
export STAGING_DB_URL=postgres://…        # staging session pooler
export K6_API_URL=https://<ref>.supabase.co
export K6_ANON_KEY=…                      # staging anon key
export K6_JWT_SECRET=…                    # staging JWT secret (signs dealer tokens)
export K6_WA_APP_SECRET=…                 # staging Meta app secret (signs webhooks)
bash load/run.sh
```

`run.sh` seeds 1 distributor, 1,000 dealers with owners and 5 lakh ACTIVE coupons (idempotent),
mints 2-hour tokens for 200 dealers, runs the three k6 scripts, then `month-end.sql` and
`verify.sql`. Outputs go to `load/.out/` (git-ignored).

Each run consumes up to 4,500 codes. 5 lakh codes last about 100 runs; re-seed by adding another
`LOT-K6-n` range.
