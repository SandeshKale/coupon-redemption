# Operations runbooks

Each SOP names the screen to use and the database function behind it. Every action is written
to `admin_log` or `coupon_event` with the actor. Nobody edits tables directly.

| #   | Situation                  | Who                     | Steps                                                                                                                                                                            | Function(s)                                           |
| --- | -------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 1   | Onboard a distributor      | 24M admin               | Masters → **Add distributor** (name, code, registered mobile, 4-digit PIN). Tell them the mobile number and PIN in person or by phone.                                           | `upsert_distributor`, `admin-create-user`             |
| 2   | Add a sales rep            | 24M admin               | Masters → **Add distributor sales rep** (distributor, name, mobile, PIN).                                                                                                        | `admin-create-user`                                   |
| 3   | Onboard a dealer           | Distributor, rep or 24M | Dealers → **Add dealer** (name, GST optional, WhatsApp mobile, PIN). 24M can also use Masters → **Add dealer (24M)**. Tell the dealer their PIN; they can change it.             | `admin-create-user` (creates dealer and login)        |
| 4   | Dealer forgot their PIN    | Distributor, rep or 24M | Dealers → **Set new PIN** on that dealer's row. This also clears a lockout straight away.                                                                                        | `set_user_pin`                                        |
| 5   | Login locked               | Dealer → distributor    | Five wrong tries lock a login (15 minutes, then longer). Wait it out or **Set new PIN**.                                                                                         | `pin_login_check`, `set_user_pin`                     |
| 6   | Lost or stolen phone       | Distributor, rep or 24M | Dealers → **Switch off** on that dealer, then **Set new PIN** and **Switch on** when the dealer has a new phone. Access stops on the next request.                               | `set_user_status`, `set_user_pin`                     |
| 7   | Dealer left or closed      | Distributor or 24M      | Dealers → **Switch off**.                                                                                                                                                        | `set_user_status`                                     |
| 8   | Move a dealer              | 24M admin               | Masters → Dealers → reassign (dealer, new distributor, reason).                                                                                                                  | `reassign_dealer`                                     |
| 9   | Add 24M staff              | 24M admin               | Users → **Add 24M staff** (role and work email). They set a password in the Supabase email flow or you set one in the dashboard, then enrol an authenticator app on first login. | `admin-create-user`                                   |
| 10  | Activate coupons           | 24M admin               | Lots → open the lot → **Activate range** (serials, SKU, batch, manufacturing date). Only activate stock that is on the shelves.                                                  | `activate_range`                                      |
| 11  | Block or recall            | 24M admin               | Lots → **Block range** (serials, reason). A blocked coupon shows as not recognised to the public.                                                                                | `block_range`                                         |
| 12  | Damaged or disputed coupon | 24M admin               | Coupon lookup → find the serial. **Hold**, **Release** or **Reverse validation** with a reason.                                                                                  | `lookup_coupon`, `hold_coupons`, `reverse_redemption` |
| 13  | Weekly review (Monday)     | 24M admin               | Weekly review → look at invalid scans, duplicate attempts and unusual dealer volume, then record the review.                                                                     | `log_weekly_review`                                   |
| 14  | Quarterly                  | 24M IT                  | Restore drill (Actions → Backup → run with `restore_test`), rotate keys (see [secrets](../secrets.md)), review `admin_log`.                                                      | n/a                                                   |

## Incidents

| Signal                   | First check                          | Action                                                                                                               |
| ------------------------ | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| UptimeRobot: health down | `GET /functions/v1/health` → `db_ms` | Supabase status page. On the Free plan, check whether the project is paused and restore it.                          |
| Sentry error spike       | Release in the issue                 | Roll back on Vercel (Deployments → previous → Promote). Database changes are additive, so the old app keeps working. |
| Many logins failing      | `admin_log` rows `PIN_LOCKED`        | One dealer: reset their PIN. Many dealers locked in a short time points to someone guessing PINs: check the pattern. |
| `recon_issue` row        | Weekly review / `recon_issue` table  | Each issue names the identity that broke. Investigate before anything else is changed.                               |
| Backup job failed        | Actions log                          | Re-run. If R2 credentials expired, rotate them. Never skip a week silently.                                          |

## Restore (disaster recovery)

1. Download the latest `weekly/*.dump.gpg` from R2.
2. `gpg --decrypt` it with `BACKUP_PASSPHRASE` (offline copy held by the 24M owner).
3. Create a new Supabase project (Mumbai) and run `supabase db push` so the schema comes from
   migrations.
4. Restore data with `pg_restore --data-only --disable-triggers --schema=public --schema=private`.
5. Run `select public.run_reconciliation()`. It must create zero `recon_issue` rows.
6. Point Edge Function secrets and the web build at the new project, deploy, run the smoke test.
