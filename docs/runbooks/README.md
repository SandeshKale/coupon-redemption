# Operations runbooks (§26)

Each SOP names the screen to use and the database function behind it. Every action is written
to `admin_log` or `coupon_event` with the actor and reason. Nobody edits tables directly.

| #   | Situation              | Who                     | Steps                                                                                                                                                                                         | Function(s)                                                                                             |
| --- | ---------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | Onboard dealer         | Distributor / 24M admin | Masters → Add dealer → Users → Add owner → **Send login link on WhatsApp**. The dealer taps the link and lands on Home.                                                                       | `upsert_dealer`, `admin-create-user`, `admin-login-link`                                                |
| 2   | New phone / logged out | Dealer → distributor    | The dealer taps **Request new link** on the login page. The distributor sees the request and resends.                                                                                         | `login-link-request`, `admin-login-link`                                                                |
| 3   | Staff left             | Dealer owner            | Staff → Remove. Access stops on the next request: `assert_role` checks status on every call.                                                                                                  | `set_user_status`                                                                                       |
| 4   | Painter dispute ("NO") | 24M ops                 | The batch's coupons are held automatically. Call the painter and the dealer within 2 working days. Exceptions → Disputes → **Release** or **Reject** (then block the dealer if it was fraud). | `resolve_dispute`, `set_dealer_status`                                                                  |
| 5   | Self-confirm hold      | 24M ops                 | Call the dealer. If it was fraud, block the dealer and reject the coupons. Otherwise release.                                                                                                 | `release_coupons`, `set_dealer_status`                                                                  |
| 6   | Damaged coupon         | 24M admin               | Lookup by serial → **Redeem on dealer's behalf** with a reason, or reject.                                                                                                                    | `lookup_coupon`, `m24_redeem_on_behalf`                                                                 |
| 7   | WhatsApp number issue  | 24M IT                  | Check Meta Business → account quality. Redemptions continue. Confirmations resume when fixed. Late messages are judged by message time (`msg_ts`), not arrival time. Watch `v_wa_health`.     | n/a                                                                                                     |
| 8   | Block or recall        | 24M admin               | Lots → Block range (serials, reason). Blocked coupons show "Do NOT pay".                                                                                                                      | `block_range`                                                                                           |
| 9   | Month-end              | All                     | 1st: cut-off job submits OPEN claims. By the 10th distributors close with CN. By the 15th claims go to 24M. By the 25th 24M settles (maker ≠ checker).                                        | `job_submit_dealer_claims`, `dist_close_claim`, `create_dist_claim`, `m24_validate_claim`, `m24_settle` |
| 10  | Weekly review (Monday) | 24M ops                 | Review → work through the views (§22), record the review.                                                                                                                                     | `log_weekly_review`                                                                                     |
| 11  | Quarterly              | 24M IT                  | Restore drill (Actions → Backup → run with `restore_test`), rotate keys (see [secrets](../secrets.md)), review `admin_log`.                                                                   | n/a                                                                                                     |

## Incidents

| Signal (§25)                 | First check                          | Action                                                                                                                    |
| ---------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| UptimeRobot: health down     | `GET /functions/v1/health` → `db_ms` | Supabase status page. On the Free plan, check whether the project is paused and restore it.                               |
| Sentry error spike           | Release in the issue                 | Roll back on Cloudflare Pages (Deployments → previous → Rollback). DB changes are additive, so the old app keeps working. |
| `recon_issue` row            | Reconciliation view                  | Each issue names the identity that broke. Hold settlement (don't run `m24_settle`) and investigate before paying.         |
| WhatsApp outbox > 5 FAILED/h | `wa_outbox.last_error`               | Expired token → rotate `META_ACCESS_TOKEN`. A rate limit clears itself through the retry job.                             |
| Backup job failed            | Actions log                          | Re-run. If R2 credentials expired, rotate them. Never skip a week silently.                                               |

## Restore (disaster recovery)

1. Download the latest `weekly/*.dump.gpg` from R2.
2. `gpg --decrypt` it with `BACKUP_PASSPHRASE` (offline copy held by the 24M owner).
3. Create a new Supabase project (Mumbai) and run `supabase db push` so the schema comes from
   migrations.
4. Restore data with `pg_restore --data-only --disable-triggers --schema=public --schema=private`.
5. Run `select public.run_reconciliation()`. It must create zero `recon_issue` rows.
6. Point Edge Function secrets and the web build at the new project, deploy, run the smoke test.
