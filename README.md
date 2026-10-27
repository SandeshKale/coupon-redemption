# 24M Primer ₹100 Painter Coupon

A dealer scans the coupon inside a can of 24M Primer and taps **Paid ₹100 to painter** or
**Declined to pay**. A paid coupon moves dealer → distributor → 24M for settlement. The painter
WhatsApp confirmation in the plan is switched off ([ADR-0006](docs/adr/0006-two-option-dealer-flow.md)).
The full specification is [docs/plan.md](docs/plan.md) (v2); decisions that differ from it are in
[docs/adr](docs/adr).

## Architecture

```text
Dealer / distributor / 24M ── PWA (React 19, Cloudflare Pages)
        │  thin fetch client → PostgREST RPC only (no table writes)
        ▼
Supabase Postgres 17 ── every rule in SECURITY DEFINER functions, RLS on every table,
        │                state machines enforced by triggers, add-only audit tables
        │ pg_cron + pg_net
        ▼
Edge Functions (Deno) ── wa-webhook / wa-sender (Meta WhatsApp Cloud API), admin-*,
                         bulk-upload, export-print-file, login-link-request, health
```

| Path                  | Contents                                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| `apps/web`            | PWA: `src/features/{dealer,auth,backoffice}`, `src/lib` (API client, network, i18n), `src/ui`               |
| `packages/shared`     | Zero-dependency TS: alphabet, Luhn mod 32, codes, tokens, WhatsApp parser, phone, money (100% coverage)     |
| `supabase/migrations` | The only way to change the schema (`0001`–`0013`)                                                           |
| `supabase/tests`      | pgTAP (1,261 assertions) + `scripts/db-meta-test.sh` (every function/policy/transition tested)              |
| `supabase/functions`  | Edge Functions; `_shared/lib` is synced from `packages/shared` (`pnpm sync:shared`)                         |
| `e2e`                 | Playwright journeys, axe, §18.5 network profiles                                                            |
| `load`                | k6 release gate ([load/README.md](load/README.md))                                                          |
| `docs`                | Plan, ADRs, [runbooks](docs/runbooks/README.md), [secrets](docs/secrets.md), [copy deck](docs/copy-deck.md) |

## Setup

Requirements: Node 22 (`.nvmrc`), pnpm 10, Deno 2.9, PostgreSQL 17 with pgTAP, plpgsql_check and
`pg_prove`, plus `sqlfluff` 3.4 and `gitleaks` 8 for the commit hooks.

```sh
pnpm install            # also installs lefthook git hooks
cp apps/web/.env.example apps/web/.env.local   # point at a local or staging Supabase
pnpm --filter @24m/web dev
```

## Quality gates

| Command                            | What                                                                                                |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| `pnpm lint`                        | ESLint (0 warnings, strict type-checked, jsx-a11y strict), Stylelint, markdownlint, Prettier        |
| `pnpm lint:sql` / `pnpm lint:deno` | sqlfluff / deno lint + fmt + check                                                                  |
| `pnpm typecheck`                   | `tsc` for shared, web (app, tests, node) and e2e                                                    |
| `pnpm test`                        | Vitest with coverage gates: shared 100%, web lib ≥ 95%, UI/features ≥ 90/85                         |
| `pnpm test:deno`                   | Deno tests, coverage gate 95/90/95                                                                  |
| `pnpm test:db`                     | Fresh DB from migrations → plpgsql_check → pgTAP → meta-test (needs local Postgres; `PG*` env vars) |
| `pnpm test:e2e`                    | Playwright against the production build (`E2E_NIGHTLY=1` adds 2G + flaky)                           |
| `pnpm size`                        | size-limit budgets (§18.1, see ADR-0005)                                                            |
| `pnpm knip`                        | Unused files, exports, dependencies                                                                 |
| `pnpm test:all`                    | Everything above except e2e                                                                         |

CI runs the same gates ([.github/workflows](.github/workflows)): `ci.yml` per PR, `nightly.yml`
(2G/flaky e2e, Stryker mutation), `security.yml` (weekly), `load.yml`, `backup.yml` (weekly +
monthly restore drill), `deploy.yml`, `release.yml`.

## Environments and deploy (§24)

| Environment        | Supabase                                                          | Web                   | WhatsApp         |
| ------------------ | ----------------------------------------------------------------- | --------------------- | ---------------- |
| Local              | Postgres + `supabase/test-support/shim.sql` (or `supabase start`) | `vite dev`            | fixtures         |
| Staging            | Free project                                                      | Cloudflare preview    | Meta test number |
| Pilot / production | Free → **Pro, Mumbai** before rollout                             | Cloudflare production | business number  |

Release: tag `vX.Y.Z` → `release.yml` runs every gate, security and k6 against staging, deploys
staging, then production after manual approval on the `production` environment, then
`scripts/smoke.sh`. Rollback: Cloudflare Pages instant rollback. Migrations are additive
(expand → migrate → contract), so the previous app keeps working.

First-time project setup (per environment):

1. `supabase link --project-ref <ref>` → `supabase db push` (never `--include-seed` outside local).
2. `supabase secrets set …` and the two Vault secrets ([docs/secrets.md](docs/secrets.md)).
3. `supabase functions deploy` (JWT verification per `supabase/config.toml`).
4. Auth: disable sign-ups, enable TOTP MFA, set the site URL and redirect `/auth/callback`.
5. Meta: set the webhook URL `https://<ref>.supabase.co/functions/v1/wa-webhook`, the verify token,
   and subscribe to `messages`.
6. Create the first 24M admin (SQL, once): an auth user plus an `app_user` with role `M24_ADMIN`.
