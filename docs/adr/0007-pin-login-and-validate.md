# ADR-0007: Mobile number and 4-digit PIN login; dealers only validate

Status: accepted, 2026-10-27. Supersedes the dealer parts of ADR-0006 and the link-based login in the plan (§10.1).

## Context

The client's process is physical. The painter hands the coupon to the dealer, the dealer pays cash,
the dealer gives the coupons to the distributor for a credit note, and the distributor gives them to
24M for another. Payment, claims and credit notes happen on paper. The app's job is to show whether
a coupon is genuine and what state it is in, and to let a registered dealer mark it **validated**.
Logins use a mobile number and a 4-digit PIN. A WhatsApp OTP was considered and dropped.

## Decision

- **Public page.** Anyone scanning a coupon sees "Genuine 24M coupon", its value and its status
  (Active, Validated or Expired), with two options: **Login to validate** and **Go to 24M home
  page** (<https://www.24m.in>). Nothing about dealers or distributors is shown.
- **Dealer.** A signed-in dealer sees one extra action, **Validate coupon** (ACTIVE to validated).
  Any dealer can validate any coupon. Validation is optional and moves no money in the app.
  Internally a validated coupon keeps the `REDEEMED` status; no claim, batch or painter record is made.
- **Login.** Dealers, distributors and sales reps log in with their registered mobile number and a PIN.
  The `pin-login` Edge Function checks the PIN in the database and turns an accepted login into an
  ordinary Supabase session, so row-level security is unchanged. 24M staff keep email, password and TOTP.
- **PIN guardrails.** A PIN is 4 digits. Weak PINs (same digit, simple runs, the mobile's last four
  digits) are refused. It is stored as bcrypt of an HMAC with a server-side pepper, in a table nobody
  can read through the API. 5 wrong tries lock the login for 15 minutes, each further lock four times
  longer up to 24 hours. Per-address rate limits apply. Every failure looks the same to the caller.
- **Sessions.** A PIN login lasts about 6 months on a device (the app ends it after 183 days; the
  Supabase inactivity timeout is set to match on the Pro plan).
- **Who creates logins.** A distributor or sales rep adds dealers (name, optional GST, WhatsApp
  mobile, PIN). 24M adds distributors, sales reps and dealers. A sales rep is a distributor-role
  user flagged `is_sales_rep`, created only by 24M.
- **24M view.** A dashboard of counts by status, lot and distributor, top dealers and recent
  validations.

## Consequences

- A 4-digit PIN is weak by nature. The lockouts make guessing impractical, but a distributor knows the
  PIN they set (dealers can change it) and anyone who watches a PIN being typed can use it. The
  stakes are low: validating moves no money and a validated coupon still earns the credit note.
- 24M has no in-app control against the same physical coupon being handed in twice. That is a paper
  control today. An in-app "mark as submitted to 24M" step would close it if needed.
- The claim, settlement, painter and magic-link code and tables remain in the database and Edge
  Functions but have no screens. `decline_payment` (ADR-0006) is unused.
- Hindi and Kannada copy for the new screens needs a native-speaker review.
