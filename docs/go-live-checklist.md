# Go-live checklist: Supabase and Vercel

Everything below is a change only you can make, because it needs your dashboard login or a secret
value that must not pass through chat. Work top to bottom. Each step says **where to click**, **what
to enter** and **how to check it worked**.

| What                   | Value                                                          |
| ---------------------- | -------------------------------------------------------------- |
| Supabase project       | `coupon-redemption`, ref `cgkspifvzbyqcoamgafc` (Tokyo region) |
| Supabase API address   | `https://cgkspifvzbyqcoamgafc.supabase.co`                     |
| Vercel project         | `coupon-redemption`, team "Sandesh Kale's projects"            |
| App and coupon address | `https://m24-coupon.vercel.app`                                |

Below, `APP_ADDRESS` means `https://m24-coupon.vercel.app` (no slash at the end). The app and the
coupon QR codes use this one address. If you later move to your own domain, repeat every step that
mentions `APP_ADDRESS` with the new address.

## How people sign in

- **Dealers, distributors and sales reps:** registered mobile number and a 4-digit PIN. No OTP, no
  WhatsApp message, no link. There is nothing to send and no Meta account to set up.
- **24M staff (admin, finance, viewer):** work email, password and an authenticator-app code. A
  4-digit PIN is not used for 24M, because these accounts can change every coupon.

## Priority

| #   | Step                                   | Needed for                             | Time   |
| --- | -------------------------------------- | -------------------------------------- | ------ |
| A1  | Run the PIN-login SQL                  | Everything new: PIN login, Validate    | 2 min  |
| A2  | Run the second SQL (reassign, cleanup) | Dealer reassignment and weekly cleanup | 2 min  |
| A3  | Set the `APP_URL` secret               | The app talking to the login functions | 1 min  |
| A4  | Auth security settings                 | Safe sign-in for 24M staff             | 3 min  |
| A5  | Create the first two 24M users         | Anyone being able to log in            | 10 min |
| B1  | Check the Vercel project settings      | The app building correctly             | 3 min  |
| B2  | Vercel plan: upgrade to Pro            | Allowed commercial use                 | 2 min  |
| A6  | Set the helpline number                | The "Call 24M" link dealers see        | 1 min  |
| A7  | `COUPON_HOST`, activate the coupons    | Real scans, print export               | 5 min  |
| B3  | Your own domain (optional)             | A nicer address, not needed to scan    | later  |

---

## Part A: Supabase

Open the dashboard at <https://supabase.com/dashboard> and select the project `coupon-redemption`.

### A1. Run the PIN-login SQL

This adds PIN storage, the Validate action, sales reps, dealer GST, the 24M dashboard and the new
login checks. It is one file: `supabase/migrations/20261027000016_pin_login_validate.sql` in the
repository (branch `claude/implement-v2-plan`). I have also sent you a copy.

1. Left menu: **SQL Editor**, then **New query**.
2. Paste the whole file, then click **Run**.
3. If the editor warns about a destructive query, confirm. The file replaces two old functions
   (`precheck_new_user` and `register_app_user`) with new versions; nothing else is removed.
4. It should finish with "Success. No rows returned".

**Check it worked:** run `select count(*) from public.user_pin;` and expect `0`.

### A2. Run the second SQL (reassign and cleanup)

Two database functions could not be applied for me, because the Supabase connector holds back any
SQL containing `delete`. Neither deletes anything when created. Run this **after** A1.

1. **SQL Editor**, then **New query**.
2. Paste everything in the box below, then click **Run**.
3. It should finish with "Success. No rows returned".

```sql
-- Finishes the initial deploy of project cgkspifvzbyqcoamgafc. Paste into Supabase → SQL Editor → Run.
-- Creates the two functions the MCP tool could not apply (they contain DELETE statements that only run
-- when called), grants them as in migration 0013, and records 0006/0012/0013/0016/0017 in the migration history.
-- Run the PIN-login SQL file (step A1) first: this script refers to the pin_attempt table it creates.
-- Safe to run more than once. Nothing is deleted by running this file.
begin;

-- EC-132: history row; the old open claim is submitted so new redemptions route to the new distributor.
create or replace function public.reassign_dealer(p_dealer_id int, p_distributor_id int, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.app_user := public.assert_role(array['M24_ADMIN']); d public.dealer;
begin
  select * into d from public.dealer where id = p_dealer_id for update;
  if not found then perform public.fail('NOT_FOUND'); end if;
  if d.distributor_id = p_distributor_id then return; end if;
  if not exists (select 1 from public.distributor where id = p_distributor_id and status = 'ACTIVE') then
    perform public.fail('DISTRIBUTOR_INACTIVE');
  end if;
  update public.dealer_claim set status = 'SUBMITTED', submitted_at = public.app_now(), submitted_by = u.id
   where dealer_id = d.id and status = 'OPEN' and exists (select 1 from public.dealer_claim_line l where l.claim_id = dealer_claim.id);
  delete from public.dealer_claim c where c.dealer_id = d.id and c.status = 'OPEN'
    and not exists (select 1 from public.dealer_claim_line l where l.claim_id = c.id);
  update public.dealer set distributor_id = p_distributor_id where id = d.id;
  insert into public.dealer_distributor_history (dealer_id, from_distributor_id, to_distributor_id, changed_by, changed_at)
  values (d.id, d.distributor_id, p_distributor_id, u.id, public.app_now());
  perform public.log_admin(u.id, 'REASSIGN_DEALER', 'dealer:' || d.id, p_reason,
    jsonb_build_object('from', d.distributor_id, 'to', p_distributor_id));
end $$;

create or replace function public.job_cleanup()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_idem int; v_lookup int; v_links int; v_pins int;
begin
  delete from public.idempotency where created_at < public.app_now() - interval '7 days';
  get diagnostics v_idem = row_count;
  delete from public.public_lookup where at < public.app_now() - interval '1 day';
  get diagnostics v_lookup = row_count;
  delete from public.login_link_attempt where at < public.app_now() - interval '1 day';
  get diagnostics v_links = row_count;
  delete from public.pin_attempt where at < public.app_now() - interval '1 day';
  get diagnostics v_pins = row_count;
  return jsonb_build_object('idempotency', v_idem, 'public_lookup', v_lookup, 'login_link_attempt', v_links,
                            'pin_attempt', v_pins);
end $$;

grant execute on function public.reassign_dealer(int, int, text) to authenticated;
grant execute on function public.job_cleanup() to service_role;

insert into supabase_migrations.schema_migrations (version, name) values
  ('20261026000006', 'fn_masters_lots'), ('20261026000012', 'jobs'), ('20261026000013', 'function_grants'),
  ('20261027000016', 'pin_login_validate'), ('20261027000017', 'cleanup_pin_attempts')
on conflict (version) do nothing;
commit;
```

**Check it worked:** run `select proname from pg_proc where proname in ('reassign_dealer','job_cleanup');`
You should see both names.

### A3. Set the `APP_URL` secret

The app on `APP_ADDRESS` talks to the login functions, and those answer only the address you set here.

1. Left menu: **Edge Functions**, then **Secrets** (called "Manage secrets" on some layouts).
2. Click **Add new secret**.
3. Name: `APP_URL`
4. Value: `https://m24-coupon.vercel.app` (no slash at the end, must start with `https://`).
5. Save.

**Check it worked** (wait about a minute, then run this on any computer):

```sh
curl -si -X OPTIONS \
  -H "Origin: https://m24-coupon.vercel.app" \
  -H "Access-Control-Request-Method: POST" \
  https://cgkspifvzbyqcoamgafc.supabase.co/functions/v1/pin-login | grep -i access-control-allow-origin
```

The line must show `https://m24-coupon.vercel.app`. If it shows `https://c.example.in`, wait a few
minutes; if it still does, tell me and I will redeploy the functions.

### A4. Auth security settings

1. **Authentication**, then **Sign In / Providers** (or **Providers**):
   - Turn **off** "Allow new users to sign up". Only admins create users.
   - Keep the **Email** provider on. PIN login uses it behind the scenes. You do not need an
     email service: nobody receives an email.
2. **Authentication**, then **Multi-Factor** (inside Sign In / Providers on newer layouts):
   - Turn **on** TOTP, both "Enroll" and "Verify". 24M staff must use a second step.
3. **Authentication**, then **URL Configuration**: set **Site URL** to `APP_ADDRESS`. (PIN login does
   not use email links, but Supabase wants a valid Site URL.)
4. **Authentication**, then **Sessions** (Pro plan only): set an inactivity timeout of 183 days
   (4392 hours) and keep refresh-token rotation on. The app itself also ends a PIN login on a
   device after about 6 months, so the Free plan is covered by the app.

### A5. Create the first 24M users

Nobody can log in yet, because the database has no users. You need two 24M staff: an **admin** who
manages everything, and a **finance** user who is a different person. They must be 24M's own
employees with a work email they can read.

Do this once per person:

1. **Authentication**, then **Users**, then **Add user**, then **Create new user**.
2. Enter their email and a strong password.
3. Tick **Auto Confirm User**.
4. Click **Create user**.

Then link each one to the app. Go to **SQL Editor**, paste, **edit the three values in capitals**, and
run. First the admin:

```sql
insert into public.app_user (auth_user_id, name, mobile_e164, email, role)
select id, 'ADMIN FULL NAME', '+91XXXXXXXXXX', email, 'M24_ADMIN'
  from auth.users
 where email = 'ADMIN@YOURCOMPANY.COM';
```

Then the finance user:

```sql
insert into public.app_user (auth_user_id, name, mobile_e164, email, role)
select id, 'FINANCE FULL NAME', '+91XXXXXXXXXX', email, 'M24_FINANCE'
  from auth.users
 where email = 'FINANCE@YOURCOMPANY.COM';
```

Each must say `INSERT 0 1`. `INSERT 0 0` means the email did not match.

**First login:** open `APP_ADDRESS/login` and use the **24M staff** form (email and password). The app
asks the user to set up two-step verification with an authenticator app. After that, the admin
screens unlock.

### A6. Set the helpline number

In Supabase **SQL Editor**, with the number dealers should call:

```sql
update public.app_config set value = '"+91 98XXXXXXXX"' where key = 'helpline';
```

**Check it worked:** sign in as a dealer. The "Call 24M" link shows that number.

### A7. Coupon address, `COUPON_HOST`, and activating the coupons

- **The coupon address is `m24-coupon.vercel.app`.** It is attached to the Vercel project and the app
  is built to use it. The first 1000 coupons (serials P24-0000001 to P24-0001000, lot `LOT-001`) are
  already loaded in Supabase. The label PDF with QR codes that open
  `https://m24-coupon.vercel.app/c/<code>` is `m24-coupon-labels-1000.pdf`.
- Add the Edge Function secret `COUPON_HOST` with the value `m24-coupon.vercel.app` (no `https://`).
  It is used when an admin exports a lot. It is not needed for scanning.
- **Activate the coupons before the first real scan.** Until then a scan shows "not recognised".
  As admin: **Masters**, add the SKU (for example code `PRIMER-1L`, name `24M Primer 1 L`), then
  **Lots**, open `LOT-001`, **Activate range** from 1 to 1000 with a batch number and the
  manufacturing date. Activate only the stock that is actually on the shelves.
- The project is in Tokyo. For dealer data in India, create a new project in Mumbai before real
  use. This cannot be changed in place. Tell me and I will re-run all the migrations there.
- The Free plan has no automatic backups. Move to **Pro** before real dealers use it.

### A8. Onboarding order (after A1 to A7)

1. **Admin** signs in, then **Masters**:
   1. **Add distributor**: name, code, registered mobile number, and a 4-digit PIN. Tell the
      distributor their mobile number and PIN in person or by phone.
   2. **Add distributor sales rep** (optional): name, mobile number, PIN, and which distributor.
2. **Distributor or sales rep** signs in with their mobile number and PIN, then **Dealers**,
   **Add dealer**: dealer name, GST (optional), the dealer's WhatsApp mobile number (this is the
   login), and a 4-digit PIN. Tell the dealer their PIN. Dealers should change it under **Change PIN**.
3. **Dealer** opens any coupon QR with the phone camera, taps **Login to validate**, enters the mobile
   number and PIN. The phone stays signed in for about 6 months. After that, scanning a coupon shows
   **Validate coupon** straight away.

---

## Part B: Vercel

Open <https://vercel.com/dashboard>, team "Sandesh Kale's projects", project `coupon-redemption`.

### B1. Check the project settings

1. **Settings**, then **General**. Check:
   - Framework Preset: **Vite**
   - Root Directory: **apps/web**
   - **Include source files outside of the Root Directory in the Build Step**: **on**. The app
     imports a shared package from the repository root.
   - Build Command `pnpm build`, Output Directory `dist`
   - Node.js Version: **22.x**
2. **Settings**, then **Environment Variables**. These must exist for **Production** (and Preview):

   | Name                     | Value                                      | Status      |
   | ------------------------ | ------------------------------------------ | ----------- |
   | `VITE_SUPABASE_URL`      | `https://cgkspifvzbyqcoamgafc.supabase.co` | already set |
   | `VITE_SUPABASE_ANON_KEY` | the project's public (anon) key            | already set |
   | `VITE_HELPLINE`          | for example `+91 98XXXXXXXX`               | **add**     |
   | `VITE_COUPON_HOST`       | `m24-coupon.vercel.app`                    | already set |
   | `VITE_SENTRY_DSN`        | from Sentry                                | optional    |

   After adding or changing any `VITE_` variable you must **redeploy**, because these are baked in at
   build time. Go to **Deployments**, open the latest, click the **...** menu, then **Redeploy**.

3. **Settings**, then **Deployment Protection**: **Vercel Authentication** must be **Disabled**.
   If it is on, dealers are asked to log in to Vercel. (It is off now; this is only a check.)

### B2. Upgrade to Pro

Your team is on the free **Hobby** plan, which Vercel limits to **non-commercial** use. For a
business app with real dealers, switch to **Pro**: team **Settings**, then **Billing**, then
**Upgrade to Pro**. Do this before real use.

### B3. Your own domains (optional, later)

The coupons already work on `m24-coupon.vercel.app`. This step only adds a nicer address. Suggested: `c.YOURCOMPANY.com`.

1. **Settings**, then **Domains**, then **Add**. Add the domain to this project.
2. At your domain registrar, add the DNS record Vercel shows for each: usually a **CNAME** to
   `cname.vercel-dns.com` for a sub-domain. Wait until Vercel shows a green tick.
3. Update everything that mentions the address:
   - Supabase secret `APP_URL` becomes the new address with `https://` (step A3). It must be the
     address people open the app on, including the address inside the coupon QR codes.
   - Supabase secret `COUPON_HOST` becomes the bare host (step A7)
   - Vercel variable `VITE_COUPON_HOST` becomes `c.YOURCOMPANY.com`, then **redeploy** (step B1)
4. Open `https://c.YOURCOMPANY.com/c/ANY13CHARCODE`. You should see the public "not recognised" page.

### B4. Make production deploy automatically (optional)

Today, production deploys are started by hand from the working branch. To deploy on every merge:

1. On GitHub, open a pull request from `claude/implement-v2-plan` into `main` (ask me if you want it
   opened for you) and merge it.
2. In Vercel, **Settings**, then **Git**: set **Production Branch** to `main`.

---

---

## Final check

Run this from any computer once A1 to A5 are done:

```sh
export SMOKE_API_URL=https://cgkspifvzbyqcoamgafc.supabase.co
export SMOKE_ANON_KEY=PASTE_THE_PUBLIC_ANON_KEY
export SMOKE_WEB_URL=https://m24-coupon.vercel.app
bash scripts/smoke.sh
```

It must end with `smoke OK`. Then on a phone:

1. Scan an activated test coupon with the normal camera. It opens in the browser and says
   "Genuine 24M coupon · ₹100" and "Status: Active", with **Login to validate** and **Go to 24M
   home page**. There is no Validate button yet.
2. Log in as the admin (A5), set up two-step verification, add one distributor, then log in as that
   distributor and add one test dealer with a mobile number and PIN.
3. Scan the coupon again, tap **Login to validate**, enter the test dealer's mobile number and PIN. You
   land back on the coupon, which now shows **Validate coupon**. Tap it: "Validated ✓".
4. Scan the same coupon again: it says it was already validated by you. As admin, the dashboard shows
   one validated coupon.
5. Enter a wrong PIN five times for the test dealer: the login locks for a while. The distributor's
   **Set new PIN** unlocks it at once.

Send me any step that does not behave as written, with a screenshot, and I will take it from there.

---

## Reference: how the app works

### Who does what

| Role                  | Signs in with                     | Can do                                                                                                                             |
| --------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 24M Admin             | Work email, two-step verification | Dashboard of every coupon, add distributors, sales reps and dealers, SKUs, lots and activation, holds and reversals, weekly review |
| 24M Finance, Viewer   | Work email, two-step verification | Read the dashboard, weekly review and coupon lookup                                                                                |
| Distributor           | Mobile number and 4-digit PIN     | Add dealers (name, GST, mobile, PIN), set a dealer's PIN, switch a dealer's login off or on                                        |
| Distributor sales rep | Mobile number and 4-digit PIN     | The same as the distributor, for the same distributor. A rep can only be added by 24M.                                             |
| Dealer                | Mobile number and 4-digit PIN     | Validate a coupon (Active to Validated), see their own validated list, change their own PIN                                        |
| Anyone                | Nothing                           | Scan a coupon: see that it is genuine, its value and its status. Go to the 24M home page.                                          |

### The physical process

1. The painter finds the coupon in the can and gives the physical coupon to the dealer.
2. The dealer pays the painter ₹100 in cash.
3. The dealer hands all collected coupons to the distributor, who gives the dealer a credit note.
4. The distributor hands all coupons to 24M, who give the distributor a credit note for every valid
   coupon.

Validating in the app is optional. A dealer who never validates still gets the credit note, as long as
the coupons handed over are valid. The app does not record payments, claims or credit notes.

### PIN rules

- A PIN is exactly 4 digits. Weak ones are refused: all the same digit, simple runs such as 1234, and
  the last four digits of the person's own mobile number.
- 5 wrong tries lock that login for 15 minutes. Each further lock is 4 times longer, up to 24 hours.
  A correct PIN resets it. Too many tries from one address are also slowed down.
- Every wrong login looks the same on screen, so nobody can find out which numbers are registered.
- PINs are stored only as a salted, peppered hash. Nobody, including 24M admins, can read a PIN.
  Distributors and 24M can set a new one.
- A lost or stolen phone: switch that dealer's login off in **Dealers**, then back on with a new PIN.

### Coupon life

Loaded (`GENERATED`), activated by the admin (`ACTIVE`), then validated by a dealer (stored as
`REDEEMED`, shown as "Validated"). One-way: a validated coupon cannot be validated again.

### Where things are

- Supabase project `cgkspifvzbyqcoamgafc`, Vercel project `coupon-redemption`.
- App and coupon address: `m24-coupon.vercel.app`.
- First lot: `LOT-001`, serials P24-0000001 to P24-0001000, ₹100 each.
- Painter WhatsApp confirmation, claims and the old link-based login are switched off or unused
  (ADR-0006 and ADR-0007). The code stays in the project.
