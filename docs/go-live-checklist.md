# Go-live checklist: Supabase and Vercel

Everything below is a change only you can make, because it needs your dashboard login or a secret
value that must not pass through chat. Work top to bottom. Each step says **where to click**, **what
to enter** and **how to check it worked**.

| What                 | Value                                                          |
| -------------------- | -------------------------------------------------------------- |
| Supabase project     | `coupon-redemption`, ref `cgkspifvzbyqcoamgafc` (Tokyo region) |
| Supabase API address | `https://cgkspifvzbyqcoamgafc.supabase.co`                     |
| Vercel project       | `coupon-redemption`, team "Sandesh Kale's projects"            |
| App address today    | `https://coupon-redemption-sandesh-kale-s-projects.vercel.app` |

Below, `APP_ADDRESS` means the app address in the table, with no slash at the end. If you later move
to your own domain, repeat every step that mentions `APP_ADDRESS` with the new address.

## Priority

| #   | Step                              | Needed for                             | Time   |
| --- | --------------------------------- | -------------------------------------- | ------ |
| A1  | Set the `APP_URL` secret          | Login links and every admin screen     | 1 min  |
| A2  | Auth URL settings                 | Login links landing on the right site  | 2 min  |
| A3  | Run the missing SQL               | Dealer reassignment and weekly cleanup | 2 min  |
| A4  | Auth security settings            | Safe sign-in                           | 3 min  |
| A5  | Create the first two 24M users    | Anyone being able to log in            | 10 min |
| B1  | Check the Vercel project settings | The app building correctly             | 3 min  |
| B2  | Vercel plan: upgrade to Pro       | Allowed commercial use                 | 2 min  |
| A6  | Set the helpline number           | The "Call 24M" link dealers see        | 1 min  |
| B3  | Your own domains (optional)       | A nicer address, not needed to scan    | later  |

A1 to A5 and B1 get the app usable. A6 and B3 can wait, but read the warnings on them.

**Painter WhatsApp confirmation is switched off.** The dealer now sees only "Paid ₹100 to painter" and
"Declined to pay". You do not need a Meta account, the five `META_*` and `WA_SENDER_SECRET` secrets,
the Vault values or the webhook. The code stays in the project, switched off by the `app_config` flag
`painter_confirmation_enabled`, in case you want it back.

---

## Part A: Supabase

Open the dashboard at <https://supabase.com/dashboard> and select the project `coupon-redemption`.

### A1. Set the `APP_URL` secret

This fixes the "Could not send your request" error on the login screen.

1. Left menu: **Edge Functions**, then **Secrets** (called "Manage secrets" on some layouts).
2. Click **Add new secret**.
3. Name: `APP_URL`
4. Value: `APP_ADDRESS`, for example `https://coupon-redemption-sandesh-kale-s-projects.vercel.app`.
   No slash at the end, and it must start with `https://`.
5. Save.

**Check it worked** (wait about a minute, then run this on any computer):

```sh
curl -si -X OPTIONS \
  -H "Origin: https://coupon-redemption-sandesh-kale-s-projects.vercel.app" \
  -H "Access-Control-Request-Method: POST" \
  https://cgkspifvzbyqcoamgafc.supabase.co/functions/v1/login-link-request | grep -i access-control-allow-origin
```

The line must show your app address. If it still shows `https://c.example.in` after a few minutes,
tell me and I will redeploy the functions.

### A2. Auth URL settings

1. Left menu: **Authentication**, then **URL Configuration**.
2. **Site URL**: `APP_ADDRESS`.
3. **Redirect URLs**: click **Add URL** and enter `APP_ADDRESS/auth/callback`.
4. Save.

If these are missing, a login link opens the wrong page or Supabase rejects it.

### A3. Run the missing SQL

Two database functions could not be applied for me, because the Supabase connector holds back any
SQL containing `delete`. Neither deletes anything when created.

1. Left menu: **SQL Editor**, then **New query**.
2. Paste everything in the box below, then click **Run**.
3. It should finish with "Success. No rows returned".

```sql
-- Finishes the initial deploy of project cgkspifvzbyqcoamgafc. Paste into Supabase → SQL Editor → Run.
-- Creates the two functions the MCP tool could not apply (they contain DELETE statements that only run
-- when called), grants them as in migration 0013, and records 0006/0012/0013 in the migration history.
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
declare v_idem int; v_lookup int; v_links int;
begin
  delete from public.idempotency where created_at < public.app_now() - interval '7 days';
  get diagnostics v_idem = row_count;
  delete from public.public_lookup where at < public.app_now() - interval '1 day';
  get diagnostics v_lookup = row_count;
  delete from public.login_link_attempt where at < public.app_now() - interval '1 day';
  get diagnostics v_links = row_count;
  return jsonb_build_object('idempotency', v_idem, 'public_lookup', v_lookup, 'login_link_attempt', v_links);
end $$;

grant execute on function public.reassign_dealer(int, int, text) to authenticated;
grant execute on function public.job_cleanup() to service_role;

insert into supabase_migrations.schema_migrations (version, name) values
  ('20261026000006', 'fn_masters_lots'), ('20261026000012', 'jobs'), ('20261026000013', 'function_grants')
on conflict (version) do nothing;
commit;
```

**Check it worked:** run `select proname from pg_proc where proname in ('reassign_dealer','job_cleanup');`
You should see both names.

### A4. Auth security settings

1. **Authentication**, then **Sign In / Providers** (or **Providers**):
   - Turn **off** "Allow new users to sign up". Only admins create users.
   - Keep the **Email** provider on. Magic links depend on it. You do not need to set up an email
     service, because login links are sent by hand over WhatsApp.
2. **Authentication**, then **Multi-Factor** (inside Sign In / Providers on newer layouts):
   - Turn **on** TOTP, both "Enroll" and "Verify". 24M staff must use a second step.
3. **Authentication**, then **Sessions** (Pro plan only): set an inactivity timeout of 90 days
   (2160 hours) and keep refresh-token rotation on. This keeps dealers logged in for months but
   ends idle sessions. Skip on the Free plan.

### A5. Create the first 24M users

Nobody can log in yet, because the database has no users. You need two 24M staff: an **admin** who
manages everything, and a **finance** user who is a different person and approves settlements.
(The same person cannot do both steps of a settlement.)

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

**First login:** open `APP_ADDRESS/login` and use the **Email** and **Password** form. The app asks
the user to set up two-step verification with an authenticator app. After that, admin screens
unlock.

**Then, as admin, in this order** (details in `docs/runbooks/README.md`): add SKUs, add the
distributor, add dealers (or upload a CSV), create each owner's login and send the login link.

### A6. Set the helpline number

In Supabase **SQL Editor**, with the number dealers should call:

```sql
update public.app_config set value = '"+91 98XXXXXXXX"' where key = 'helpline';
```

**Check it worked:** sign in as a dealer. The "Call 24M" link shows that number.

### A7. Later: coupon domain and Mumbai (read before printing)

- **The coupon domain is decided: `m24-coupon.vercel.app`.** It is attached to the Vercel project and
  the app is built to use it. The first 1000 coupons (serials P24-0000001 to P24-0001000, lot
  `LOT-001`) are already loaded in Supabase. The label PDF with QR codes that open
  `https://m24-coupon.vercel.app/c/<code>` is `m24-coupon-labels-1000.pdf`.
- Add the Edge Function secret `COUPON_HOST` with the value `m24-coupon.vercel.app` (no `https://`).
  It is used when an admin exports a lot. It is not needed for scanning.
- The address ends in `vercel.app`, so it belongs to Vercel and your account. It keeps working while
  the project exists. If you later buy a domain (step B3), add it to the same project: the printed
  `m24-coupon.vercel.app` codes keep working next to it.
- **Activate the coupons before the first real scan.** Until then a scan shows "not recognised".
  As admin: add the SKU (for example code `PRIMER-1L`, name `24M Primer 1 L`), then **Lots**,
  open `LOT-001`, **Activate range** from 1 to 1000 with a batch number and the manufacturing date.
  Activate only the stock that is actually on the shelves.
- The project is in Tokyo. For dealer data in India, create a new project in Mumbai before real
  use. This cannot be changed in place. Tell me and I will re-run all the migrations there.
- The Free plan has no automatic backups. Move to **Pro** before real dealers use it.

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

The coupons already work on `m24-coupon.vercel.app`. This step only adds a nicer address. Suggested: `app.YOURCOMPANY.com` for the app, and a short `c.YOURCOMPANY.com` for coupon QR codes.

1. **Settings**, then **Domains**, then **Add**. Add both domains to this project.
2. At your domain registrar, add the DNS record Vercel shows for each: usually a **CNAME** to
   `cname.vercel-dns.com` for a sub-domain. Wait until Vercel shows a green tick.
3. Update everything that mentions the address:
   - Supabase secret `APP_URL` becomes `https://app.YOURCOMPANY.com` (step A1)
   - Supabase **Site URL** and the `/auth/callback` **Redirect URL** (step A2)
   - Supabase secret `COUPON_HOST` becomes `c.YOURCOMPANY.com` (step A7)
   - Vercel variable `VITE_COUPON_HOST` becomes `c.YOURCOMPANY.com`, then **redeploy** (step B1)
4. Open `https://c.YOURCOMPANY.com/c/ANY13CHARCODE`. You should see the public "not recognised" page.

### B4. Make production deploy automatically (optional)

Today, production deploys are started by hand from the working branch. To deploy on every merge:

1. On GitHub, open a pull request from `claude/implement-v2-plan` into `main` (ask me if you want it
   opened for you) and merge it.
2. In Vercel, **Settings**, then **Git**: set **Production Branch** to `main`.

---

## Final check

Run this from any computer once A1 to A5 are done (replace the two `APP_ADDRESS` values):

```sh
export SMOKE_API_URL=https://cgkspifvzbyqcoamgafc.supabase.co
export SMOKE_ANON_KEY=PASTE_THE_PUBLIC_ANON_KEY
export SMOKE_WEB_URL=https://coupon-redemption-sandesh-kale-s-projects.vercel.app
bash scripts/smoke.sh
```

It must end with `smoke OK`. Then on a phone:

1. Open the app address, then tap **Request new login link**, enter a dealer's registered number.
   The message must say "Request sent".
2. Log in as the admin (A5), set up two-step verification, and add one test dealer.
3. Press **Send login link** for that dealer. WhatsApp should open with the Hindi and English message.
4. The dealer taps the link and lands on the Home screen logged in.
5. As that dealer, scan a test coupon that an admin has activated. You must see exactly two buttons,
   **Paid ₹100 to painter** and **Declined to pay**. Tap **Declined to pay** first: the message says
   the coupon stays valid. Scan it again and tap **Paid**: the receipt shows ₹100 and no QR code.

Send me any step that does not behave as written, with a screenshot, and I will take it from there.
