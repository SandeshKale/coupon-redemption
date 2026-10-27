# Secrets and configuration (names only, never values)

Every secret is owned by 24M (§29), not by the developer. Rotate quarterly (§26 item 10) and
whenever someone with access leaves. Values live only in the stores listed. Never put them in
the repo, `.env` files, chat or tickets. `gitleaks` runs on every commit and in CI.

## Supabase Edge Function secrets (`supabase secrets set …`, per project)

| Name                                                             | Used by              | Owner                    | Notes                                                              |
| ---------------------------------------------------------------- | -------------------- | ------------------------ | ------------------------------------------------------------------ |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | all functions        | Supabase (auto-injected) | Service role never leaves Edge Functions.                          |
| `META_APP_SECRET`                                                | `wa-webhook`         | 24M IT                   | Verifies `X-Hub-Signature-256`. Without it every POST is rejected. |
| `META_VERIFY_TOKEN`                                              | `wa-webhook`         | 24M IT                   | Random string also entered in Meta's webhook settings.             |
| `META_ACCESS_TOKEN`                                              | `wa-sender`          | 24M IT                   | System-user permanent token, `whatsapp_business_messaging` only.   |
| `META_PHONE_NUMBER_ID`                                           | `wa-sender`          | 24M IT                   | Not secret but environment-specific.                               |
| `META_GRAPH_VERSION`                                             | `wa-sender`          | Dev                      | Defaults to `v21.0`. Bump deliberately.                            |
| `WA_SENDER_SECRET`                                               | `wa-sender`          | 24M IT                   | Shared with the Vault secret below; protects the internal trigger. |
| `APP_URL`, `COUPON_HOST`                                         | login links, QR URLs | 24M IT                   | e.g. `https://app.24m.in`, `c.24m.in`.                             |

## Supabase Vault (`select vault.create_secret(value, name)`, per project)

| Name               | Used by                                              | Notes                                              |
| ------------------ | ---------------------------------------------------- | -------------------------------------------------- |
| `wa_sender_url`    | `private.invoke_wa_sender()` (pg_cron, every minute) | `https://<ref>.supabase.co/functions/v1/wa-sender` |
| `wa_sender_secret` | same                                                 | Same value as `WA_SENDER_SECRET`.                  |

Without both Vault secrets the retry job is a no-op, and replies are sent only inline by the
webhook.

## Database-internal

| Name                 | Where                                                                | Notes                                                                                                                                      |
| -------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `painter_phone_salt` | `private.secret` (created by migration 0001 from `gen_random_bytes`) | HMAC salt for phone and IP hashes. Never exported; rotating it breaks hash matching for old rows, so rotate only with a re-hash migration. |

## GitHub Actions (repository → Settings → Environments `staging` / `production`)

| Name                                                                   | Kind                  | Workflows      | Notes                                                              |
| ---------------------------------------------------------------------- | --------------------- | -------------- | ------------------------------------------------------------------ |
| `SUPABASE_ACCESS_TOKEN`                                                | secret                | deploy         | Personal access token of the 24M deploy account.                   |
| `SUPABASE_DB_PASSWORD`                                                 | secret                | deploy         | Database password of the target project.                           |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`                        | secret                | deploy, backup | Token scoped to Pages edit (+ R2 for backup).                      |
| `META_VERIFY_TOKEN`                                                    | secret                | deploy (smoke) | Optional; enables the webhook handshake check.                     |
| `PRODUCTION_DB_URL`                                                    | secret (production)   | backup         | Session-pooler URL of a read-only backup role.                     |
| `BACKUP_PASSPHRASE`                                                    | secret (production)   | backup         | GPG symmetric passphrase. Keep an offline copy with the 24M owner. |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`                             | secret (production)   | backup         | R2 token limited to the backup bucket.                             |
| `STAGING_DB_URL`, `STAGING_JWT_SECRET`, `META_APP_SECRET`              | secret (staging)      | load           | k6 seeding, dealer tokens and signed webhooks.                     |
| `SUPABASE_PROJECT_REF`, `SUPABASE_ANON_KEY`                            | variable              | deploy, load   | Per environment.                                                   |
| `PRODUCTION_PROJECT_REF`                                               | variable (staging)    | load           | Guard: load tests refuse to run against this ref.                  |
| `CF_PAGES_PROJECT`, `WEB_URL`, `COUPON_HOST`, `HELPLINE`, `SENTRY_DSN` | variable              | deploy         | Build-time public values.                                          |
| `R2_BACKUP_BUCKET`                                                     | variable (production) | backup         |                                                                    |
| `STAGING_WEB_URL`                                                      | variable (repository) | security       | ZAP baseline target; job skipped when unset.                       |

## Web build (public, baked into the bundle)

`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_COUPON_HOST`, `VITE_HELPLINE`,
`VITE_SENTRY_DSN`. These are public by design: the anon key can only call
`public_coupon_info` (pgTAP `anon` tests).
