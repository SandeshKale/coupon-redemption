# 24M Primer ₹100 Painter Coupon: Frugal Implementation Plan (v2)

**Edition:** Frugal · **Version:** 2.0 · **Scope:** digital solution only (printing already handled)
**Chain:** Painter → Dealer → Distributor → 24M
**Control principle:** _scan → validate → close_ at every stage. The digital trail is the control.

## What changed from v1

| Area               | v1                      | v2                                                                                                                                                                           |
| ------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Painter validation | Not included            | **WhatsApp confirmation (Option 2)**: the painter sends a ready-made WhatsApp message after being paid. ₹0 per coupon. (§6)                                                  |
| Hosting plan       | Supabase Pro from day 1 | **Supabase Free for staging and pilot**, Pro before rollout (§24)                                                                                                            |
| Code quality       | Basic                   | **Strict TypeScript, zero-warning linting across TS, SQL, Deno, CSS and Markdown, enforced in CI** (§19)                                                                     |
| Testing            | Outline                 | **Coverage thresholds per layer, mutation testing, property-based tests, a test for every database function and access rule, accessibility and network-profile tests** (§20) |
| Edge cases         | 25 scenarios            | **Master catalogue of 120+ edge cases, each mapped to a test** (§21)                                                                                                         |
| Performance        | Targets only            | **Budgets, service-worker app shell, minimal payloads, retry and "unknown outcome" handling, tested on 2G/3G/4G profiles** (§18)                                             |
| UI                 | Screen list             | **Full UX spec, design tokens, component library, copy in English/Hindi/Marathi, WCAG 2.2 AA plan and tests** (§16–17)                                                       |

## At a glance

|                   |                                                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **One-time cost** | ≈ ₹4–6.5 lakh (the extra quality work adds ≈ ₹0.5–1 lakh over v1)                                                                  |
| **Running cost**  | ₹0 during pilot (free plans) → ≈ ₹2–3k/month in production. WhatsApp ₹0.                                                           |
| **Team**          | 1 senior freelance full-stack developer (TypeScript + PostgreSQL), 1 part-time UI/UX reviewer (≈ 5 days total), 24M business owner |
| **Timeline**      | ≈ 11 weeks to pilot, rollout from week 16                                                                                          |
| **Capacity**      | 10–20 lakh coupons/year on Supabase Pro                                                                                            |

All costs are indicative 2026 India rates; verify Supabase, Cloudflare and Meta (WhatsApp) pricing at sign-up.

---

## Table of contents

1. Goals, non-goals and success metrics
2. Scope: kept, simplified, deferred
3. Technology stack and repository layout
4. Architecture and request paths
5. Process flow: Scan → Validate → Close
6. Painter WhatsApp confirmation (full design)
7. Roles and permissions
8. Coupon code and QR specification
9. State machines
10. Login and session design
11. Data model
12. Database security (RLS, grants, secrets)
13. Database functions
14. Edge Functions
15. Validation rules
16. UX and UI specification
17. Accessibility (WCAG 2.2 AA)
18. Performance and network resilience
19. Engineering standards: linting, formatting, typing, reviews
20. Testing strategy and coverage gates
21. Edge-case catalogue
22. Weekly review and reconciliation
23. Scheduled jobs
24. Environments, deployment and release
25. Observability and alerting
26. Operations SOPs
27. Build plan, milestones and Definition of Done
28. Budget
29. Decisions needed
30. Risks
31. Upgrade path
32. Appendices: copy deck, WhatsApp messages, configuration keys, glossary

---

## 1. Goals, non-goals and success metrics

### 1.1 Goals

1. **Zero duplicate payouts:** a coupon can be paid once, credited once to a dealer and once to a distributor.
2. **Frictionless dealer redemption:** camera scan plus one tap, on any phone and any network.
3. **Painter-verified payments:** the painter confirms receiving ₹100 from their own WhatsApp at ₹0 cost.
4. **Complete, unchangeable audit trail:** who, what, when, for every coupon, at every stage.
5. **Automatic reconciliation:** dealer redemptions → distributor CN → 24M CN.
6. **Frugal:** ≈ ₹2–3k/month running cost; no servers to manage.

### 1.2 Non-goals (this phase)

Painter app or wallet, UPI payouts, ERP integration, per-box serialisation, secondary-sales import, native mobile app, automated fraud scoring.

### 1.3 Success metrics (measured from pilot onward)

| Metric                                     | Target                                            | How measured                                 |
| ------------------------------------------ | ------------------------------------------------- | -------------------------------------------- |
| Duplicate payouts                          | **0**                                             | Unique constraints + weekly report           |
| Scan-to-receipt time (4G)                  | p50 ≤ 2 s, p95 ≤ 4 s                              | Client timing events (Sentry performance)    |
| Scan-to-receipt time (slow 3G, cached app) | p95 ≤ 6 s                                         | Playwright network-profile test + field data |
| Taps after scan to redeem one coupon       | ≤ 2 for ≥ 95% of redemptions                      | Event log                                    |
| Painter confirmation rate                  | ≥ 70% in month 1, ≥ 85% by month 3                | `painter_confirmation` table                 |
| Dealer task success in usability test      | ≥ 90% unaided (5 dealers)                         | Moderated sessions                           |
| Accessibility                              | 0 axe violations; WCAG 2.2 AA manual audit passed | CI + audit                                   |
| Lighthouse mobile performance              | ≥ 90 on dealer routes                             | Lighthouse CI                                |
| Crash-free sessions                        | ≥ 99.5%                                           | Sentry                                       |
| Availability (dealer hours)                | ≥ 99.5%                                           | UptimeRobot                                  |

---

## 2. Scope: kept, simplified, deferred

| Kept in full (non-negotiable)                                | Simplified                                                 | Deferred                                       |
| ------------------------------------------------------------ | ---------------------------------------------------------- | ---------------------------------------------- |
| Random, non-guessable codes; inactive until lot activation   | Dealer/distributor login via WhatsApp link shared manually | Painter OTP (paid)                             |
| One-shot atomic redemption, idempotent retries               | CN notifications via one-tap WhatsApp share                | Automatic fraud alerts (weekly review instead) |
| Auto-routing to the dealer's distributor                     | Claim slip = printable web page with QR                    | ERP integration (CSV export instead)           |
| Distributor validation + CN; 24M maker/checker + CN          | Add-only audit tables (no hash chain)                      | Secondary-sales import, per-box serialisation  |
| **Painter WhatsApp confirmation (new)**                      | Reports = tables + CSV                                     | Native app                                     |
| Full coupon history; reconciliation                          | Security test = automated scan + freelance reviewer        | Physical-coupon scan-matching at distributor   |
| Accessibility (WCAG 2.2 AA), performance budgets, test gates |                                                            |                                                |

---

## 3. Technology stack and repository layout

### 3.1 Stack

| Layer                       | Choice                                                                                | Why                                                          |
| --------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Language                    | **TypeScript 5.x** (strictest settings, §19.2)                                        | One language for app, shared logic and Edge Functions        |
| Web app                     | **React 19 + Vite 6**, single-page PWA                                                | Static output for free hosting; mature ecosystem             |
| Routing                     | React Router 7 (data mode), route-level code splitting                                | Dealer bundle stays small; back-office lazy-loaded           |
| Styling                     | **Tailwind CSS 4** (purged) + design tokens as CSS variables                          | Tiny CSS, consistent tokens, easy contrast control           |
| Data fetching (dealer)      | **Thin `fetch` client (≈ 2 KB)** calling database functions directly                  | Avoids loading the full Supabase SDK on the critical path    |
| Auth                        | `@supabase/auth-js`, **code-split** and prefetched when the browser is idle           | Handles sessions and refresh without blocking the first scan |
| Data fetching (back-office) | TanStack Query (back-office chunk only)                                               | Caching, pagination, retries for tables                      |
| Validation                  | **Valibot** (tree-shakable, ≈ 1–2 KB used)                                            | Runtime validation of every API response                     |
| QR scanning                 | Native **BarcodeDetector** where available; **`@zxing/browser`** lazy-loaded fallback | Fast on Android Chrome, works everywhere                     |
| QR rendering                | `qrcode-generator` (small)                                                            | Painter-confirmation QR and claim slips, rendered offline    |
| i18n                        | Small in-house dictionary loader (per-language JSON chunk)                            | Avoids heavy i18n libraries                                  |
| Offline shell               | **Workbox** service worker (precache app shell)                                       | Instant repeat loads on poor networks                        |
| Hosting                     | **Cloudflare Pages** + DNS (free)                                                     | Global cache, HTTP/3, free SSL                               |
| Database                    | **Supabase PostgreSQL 15+** (Mumbai `ap-south-1`)                                     | ACID, row locks, RLS, functions, pg_cron                     |
| Server logic                | **PostgreSQL functions (PL/pgSQL)**                                                   | All rules in one place, testable with pgTAP                  |
| Privileged and webhook code | **Supabase Edge Functions (Deno)**                                                    | Admin actions + WhatsApp webhook                             |
| WhatsApp                    | **Meta WhatsApp Cloud API** (direct, no reseller)                                     | Free for painter-started chats and replies inside 24 h       |
| Jobs                        | **pg_cron** + **pg_net** (HTTP from Postgres for retrying WhatsApp sends)             | No extra infrastructure                                      |
| Monitoring                  | Sentry (free), UptimeRobot (free), Supabase logs                                      | Errors, uptime, slow queries                                 |
| CI/CD                       | GitHub Actions (free tier for private repos)                                          | All quality gates (§20.9)                                    |
| Package manager             | **pnpm** workspaces, Node 22 LTS                                                      | Fast, strict dependency resolution                           |

### 3.2 Repository layout (monorepo)

```text
/
├─ apps/web/                       React PWA
│  ├─ src/app/                     routes, layouts, error boundaries
│  ├─ src/features/dealer/         scan, redeem, bulk, receipt, painter-confirm QR, claims, staff
│  ├─ src/features/distributor/    queue, claim detail, close with CN, claim to 24M, dealers
│  ├─ src/features/m24/            lots, masters, claims (maker/checker), lookup, review, reports
│  ├─ src/features/public/         anonymous coupon page
│  ├─ src/lib/api/                 thin RPC client, retry, idempotency, timeout, result mapping
│  ├─ src/lib/network/             online status, connection quality, request queue (read-only)
│  ├─ src/lib/i18n/                dictionaries en/hi/mr, formatters (₹, dates, numbers)
│  ├─ src/ui/                      design system components + tokens
│  └─ src/sw/                      service worker (Workbox)
├─ packages/shared/                pure TS, zero dependencies: code alphabet, Luhn mod 32,
│                                  code normaliser, WhatsApp message parser, phone normaliser,
│                                  result codes, money (paise) helpers  → used by web AND Deno
├─ supabase/
│  ├─ migrations/                  numbered SQL migrations (only way to change schema)
│  ├─ functions/                   Edge Functions (Deno): admin-*, export-print-file, wa-webhook, wa-sender
│  ├─ tests/                       pgTAP tests (one file per function / policy group)
│  └─ seed.sql                     deterministic test data
├─ e2e/                            Playwright tests, network profiles, axe checks
├─ load/                           k6 scripts (concurrency, load)
├─ .github/workflows/              CI pipelines
└─ docs/                           this plan, ADRs, runbooks, copy deck
```

---

## 4. Architecture and request paths

```text
 Painter (own WhatsApp)      Dealer / Distributor / 24M (browser, PWA)
        │                                   │ HTTPS
        │                                   ▼
        │                    ┌───────────────────────────────┐
        │                    │ CLOUDFLARE (free)             │ DNS · SSL · HTTP/3 · WAF · cache
        │                    │ Pages: React PWA (static)     │ c.<domain>/c/<CODE>  → app
        │                    └──────────────┬────────────────┘
        │                                   │ RPC (JSON) + user JWT
        ▼                                   ▼
 ┌──────────────┐  webhook   ┌──────────────────────────────────────────────────────────┐
 │ META         │──────────▶ │ SUPABASE (Mumbai) — Free in pilot, Pro in production      │
 │ WhatsApp     │            │  Auth  · login links (dealers/distributors), email+TOTP   │
 │ Cloud API    │◀────────── │  Edge Functions (Deno)                                    │
 │ (business    │  replies   │    wa-webhook  → verify signature → wa_handle_inbound()   │
 │  number)     │            │    wa-sender   → send queued replies (retry via pg_net)   │
 └──────────────┘            │    admin-create-user · admin-login-link · bulk-upload ·   │
                             │    export-print-file                                      │
                             │  PostgreSQL                                               │
                             │    functions: check, redeem, painter confirm, claims,     │
                             │               settle, lots, holds, reports                │
                             │    RLS on every table · add-only audit tables             │
                             │    pg_cron: month-end cut-off, expiry, recon, retries     │
                             └──────────────────────────────────────────────────────────┘
   GitHub Actions: CI gates + weekly pg_dump → Cloudflare R2   ·   Sentry · UptimeRobot
   Printing machine ← CSV print file   ·   Excel/ERP ← CSV exports
```

### 4.1 Path A: dealer redeems (critical path)

1. Camera opens `https://c.<domain>/c/7KQ2M9XHTB4RJ`.
2. Service worker serves the cached app shell instantly; on first visit, Cloudflare serves it (≈ 60–90 KB gzipped JS).
3. App reads the code from the URL, validates format and check character **locally** (no network).
4. App calls `rpc/check_coupon` (≈ 300-byte request, ≈ 300-byte response) → result screen.
5. Dealer taps **Confirm** → `rpc/redeem` with an idempotency key → one DB transaction redeems, creates a redemption batch and a painter-confirmation token.
6. Receipt screen shows **REDEEMED ✓** and the **painter QR** (rendered locally, no extra request).

### 4.2 Path B: painter confirms on WhatsApp

1. Painter scans the QR on the dealer's screen → WhatsApp opens with `24M PAID K7Q2M9` ready → taps **Send**.
2. Meta posts the message to `wa-webhook` → signature verified → `wa_handle_inbound()` matches the token, records the painter's number, sets flags, queues a reply.
3. `wa-sender` sends the free reply ("Thank you! ₹100 from Shree Ganesh Paints confirmed. Reply NO if not received.").
4. Dealer's receipt screen (polling) changes to **Painter confirmed ✓**.

### 4.3 Path C: claims and settlement

Dealer claim (auto on the 1st) → distributor validates, records CN → distributor claim to 24M → 24M maker validates → 24M checker settles with CN → CSV export.

---

## 5. Process flow: Scan → Validate → Close

| Stage          | Who                               | SCAN                                   | VALIDATE (automatic)                                            | CLOSE (recorded)                           | Coupon status after                |
| -------------- | --------------------------------- | -------------------------------------- | --------------------------------------------------------------- | ------------------------------------------ | ---------------------------------- |
| 0. Issue       | 24M admin                         | Serial range of the printed lot        | Printed + spoiled = quantity; lot not already active            | Activate lot (SKU, batch, mfg date)        | `ACTIVE`                           |
| 1. Dealer      | Dealer or staff                   | Phone camera on coupon QR              | Exists, active, not redeemed/blocked/expired, dealer active     | 1 tap **"₹100 paid – Confirm"**            | `REDEEMED`                         |
| 1a. Painter    | Painter                           | Scans painter QR on dealer's screen    | Token valid, not expired, number not suspicious                 | Taps **Send** in WhatsApp                  | `REDEEMED` + painter `CONFIRMED`   |
| 2. Distributor | Distributor                       | Dealer's claim-slip QR (or queue)      | Routed here, in window, not held, painter status shown per line | Approve/reject lines → enter CN no. + date | `DIST_CN_ISSUED` / `DIST_REJECTED` |
| 3. 24M         | Admin (maker) + finance (checker) | Distributor's claim-slip QR (or queue) | Dealer CN exists, no duplicates, in window, maker ≠ checker     | Validate → enter 24M CN no. + date         | `SETTLED` / `M24_REJECTED`         |

### 5.1 Stage 0: codes, print file, activation

1. `M24_ADMIN` creates a lot (quantity ≤ 2,00,000 per lot, value, intended SKU). Codes are generated in the database in batches of 50,000 (§8.2).
2. `export-print-file` Edge Function streams the CSV (`serial, code13, qr_url, display_code`), logs user, time and SHA-256, and marks the lot `EXPORTED`. A second export requires a reason and is logged.
3. After printing, the admin uploads spoiled serials → `VOID`. The system checks `active-eligible + void = quantity`.
4. On batch release, the admin activates a serial range with SKU, batch number and mfg date → `ACTIVE`, `expires_at = mfg_date + validity_months`.

### 5.2 Stage 1: dealer redemption (one or many)

- **One coupon:** scan → green **₹100 VALID** → **Confirm** → receipt + painter QR.
- **Many coupons:** **Scan many** keeps the camera open; each code is checked as it's scanned and shown in a list (✓ valid, ✕ reason); duplicates in the same session are ignored with a "Scanned already" note; **Confirm ₹X for N coupons** redeems all in one request (max 50). Each coupon is redeemed independently; partial success is reported per line. **One** painter QR covers the whole batch.
- **Typed code:** 13 characters with live check-character validation and grouping (`7KQ2-M9XH-TB4R-J`).
- **Rule:** the dealer pays cash only after the green receipt. The UI never shows success until the server confirms.

### 5.3 Stage 2: distributor validation

1. Redemptions auto-join the dealer's single `OPEN` claim; on the 1st of each month, `pg_cron` submits it (dealer can submit earlier).
2. Distributor opens the claim (slip QR or queue). Each line shows the rule results **and the painter-confirmation status** (✓ confirmed, ⚑ late, ✕ disputed, – none).
3. **Approve all eligible** (one click) or decide per line; rejection needs a reason code.
4. **Close with CN:** system-computed total; distributor enters their CN number and date → coupons `DIST_CN_ISSUED`.
5. **Notify dealer on WhatsApp** (one-tap share with prefilled text). Dealer marks **Received ✓** in the app.

### 5.4 Stage 3: 24M settlement

1. Distributor creates the claim to 24M (pre-selects all CN-issued, unclaimed coupons) and shares the slip.
2. `M24_ADMIN` validates lines (maker). Painter-disputed or held lines must be resolved first.
3. `M24_FINANCE` (a different person) enters the 24M CN → `SETTLED`; CSV export for the ERP.

---

## 6. Painter WhatsApp confirmation (Option 2): full design

### 6.1 Principle

After the dealer pays and redeems, the **painter** attests receipt by sending a ready-made WhatsApp message from **their own phone**. Because the painter starts the chat, the incoming message and our reply within 24 hours cost nothing. WhatsApp itself verifies the painter's number.

Confirmation **never blocks** redemption or the painter's payment. An unconfirmed coupon is flagged for review. Optional strict mode can make confirmation mandatory for distributor approval (decision D10).

### 6.2 One-time WhatsApp setup (week 0)

| Step | Detail                                                                                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Create a **Meta Business** account for the business (owned by the business, 2 admins)                                                                                           |
| 2    | Start **business verification** (documents; can take days, so start in week 0)                                                                                                  |
| 3    | Create a **Meta app** (Business type), add the **WhatsApp** product                                                                                                             |
| 4    | Buy a **new SIM/number** used only for this (it can't be active on a normal WhatsApp app); register it in the WhatsApp Business Account, set a two-step PIN                     |
| 5    | Set the **display name** (e.g., "24M Painter Rewards") and profile (logo, description, helpline)                                                                                |
| 6    | Create a **System User** with a permanent access token (scopes: `whatsapp_business_messaging`, `whatsapp_business_management`); store it only in Supabase Edge Function secrets |
| 7    | Configure the **webhook**: callback URL = `wa-webhook` Edge Function, verify token = random secret, subscribe to the `messages` field                                           |
| 8    | Store **App Secret** (for signature checks), **Phone Number ID**, **verify token** and **access token** as Edge Function secrets                                                |
| 9    | Send a test message from 3 phones (Android, iPhone, WhatsApp Business app) and confirm the webhook round trip in staging                                                        |

Pricing note: under Meta's current model, replies inside the 24-hour customer-service window opened by the painter's message are free. Verify this when signing up; the design never sends business-initiated (paid) messages.

### 6.3 Confirmation token and message format

- On every redemption batch (one or many coupons), the database creates a **confirmation token**: 6 characters from the Crockford alphabet (≈ 1 billion combinations), unique among open tokens.
- **QR on the dealer's receipt** encodes:
  `https://wa.me/<business_number>?text=24M%20PAID%20K7Q2M9`
- Message the painter sends: **`24M PAID K7Q2M9`**
- Below the QR, the receipt also shows the number and the text, for painters who prefer to type it.
- Token windows:
  - **On time:** within 10 minutes of redemption → `CONFIRMED`
  - **Late:** 10 minutes – 24 hours → `LATE` (accepted, low-priority flag)
  - **Expired:** after 24 hours → `EXPIRED`; message gets a polite "expired" reply

### 6.4 Message grammar (parser in `packages/shared`, shared by tests and Edge Function)

Normalisation before matching:

1. Unicode NFKC, uppercase, trim, collapse whitespace.
2. Convert Devanagari digits (०–९) to ASCII.
3. Map Crockford look-alikes inside a candidate token (`O→0`, `I/L→1`).

Recognised intents (first match wins):

| Intent    | Pattern (after normalisation)                                                                    | Example                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `CONFIRM` | contains a 6-char token from the alphabet, optionally preceded by `24M` and/or `PAID`            | `24M PAID K7Q2M9`, `k7q2m9`, `Paid K7Q2M9 🙏` (a token split by spaces, e.g. `K7Q2 M9`, is not accepted) |
| `DISPUTE` | whole message is one of `NO`, `NOT PAID`, `NAHI`, `NAHI MILA`, `नहीं`, `नाही`, `PAISE NAHI MILE` | `no`                                                                                                     |
| `STOP`    | `STOP`, `DELETE`, `UNSUBSCRIBE`                                                                  | `stop`                                                                                                   |
| `HELP`    | anything else, including media, location, voice notes, stickers                                  | `hello`                                                                                                  |

### 6.5 Painter-confirmation state machine

```text
PENDING ──(msg within 10 min)──▶ CONFIRMED ──(NO within 24 h)──▶ DISPUTED
   │  └─(msg 10 min–24 h)──────▶ LATE ───────(NO within 24 h)──▶ DISPUTED
   ├─(dealer: "painter has no phone")▶ SKIPPED (reason)
   └─(24 h passes)──────────────▶ EXPIRED
```

- `DISPUTED` automatically puts the batch's coupons `ON_HOLD` and appears at the top of the weekly review.
- A dispute after 24 h is recorded as a support note (helpline), not an automatic hold.

### 6.6 Webhook processing (`wa-webhook`)

1. `GET` (Meta verification): if `hub.mode=subscribe` and `hub.verify_token` matches → return `hub.challenge`; otherwise 403.
2. `POST`: read the **raw body**; compute HMAC-SHA256 with the App Secret; compare to `X-Hub-Signature-256` using a constant-time comparison. Mismatch → 401 and log.
3. Body size limit 256 KB; reject other content types.
4. For each `entry[].changes[].value.messages[]`:
   - Ignore `statuses[]` events (delivered/read).
   - Extract `id` (wamid), `from` (digits), `timestamp`, `type`, `text.body`.
   - Normalise `from` to E.164 (`+91XXXXXXXXXX`).
   - Call `wa_handle_inbound(wamid, phone, body, type, msg_ts)` with the service role → returns `{reply_text, lang}` or nothing.
   - If a reply exists, insert it into `wa_outbox` (done inside the function) and trigger `wa-sender` in the background (`EdgeRuntime.waitUntil`).
5. Always respond **200 within about 1 second** once the signature is valid, so Meta doesn't retry needlessly. Processing errors are logged and the inbound row is marked `ERROR` for replay.

### 6.7 Reply sending (`wa-sender`)

- Reads `wa_outbox` rows with `status in ('QUEUED','RETRY') and next_attempt_at <= now()`, `FOR UPDATE SKIP LOCKED`, up to 20 at a time.
- `POST https://graph.facebook.com/<version>/<phone_number_id>/messages` with a text message.
- Success → `SENT` with the Meta message id. Rate-limit or 5xx errors → `RETRY` with exponential backoff (30 s, 2 min, 10 min, 30 min, 2 h), max 6 attempts → `FAILED` (shown in ops dashboard).
- Never retries outside the 24-hour window (would become a paid message); such rows go to `EXPIRED_WINDOW`.
- `pg_cron` calls `wa-sender` every minute via `pg_net` as a safety net.

### 6.8 Fraud signals (flags on the confirmation)

| Flag           | Rule                                                                               | Severity               |
| -------------- | ---------------------------------------------------------------------------------- | ---------------------- |
| `SELF_CONFIRM` | Painter number = a user mobile of the **same dealer**                              | High: coupon `ON_HOLD` |
| `STAFF_NUMBER` | Painter number = any dealer/distributor/24M user mobile                            | Medium                 |
| `MULTI_DEALER` | Same number confirmed at ≥ 3 different dealers in 7 days                           | Medium                 |
| `HIGH_VOLUME`  | Same number confirmed ≥ 10 batches in 24 h                                         | Medium                 |
| `NON_INDIAN`   | Number not `+91`                                                                   | Low                    |
| `LATE`         | Confirmed after 10 minutes                                                         | Low                    |
| `BAD_TOKENS`   | ≥ 5 unknown tokens from one number in 1 hour (further messages ignored for 1 hour) | Medium                 |

Dealer-level KPI: **confirmation rate** (confirmed ÷ redeemed, 30 days). Dealers below 60% with ≥ 20 coupons appear in the weekly review.

### 6.9 Privacy (DPDP Act 2023)

- First reply to a new number includes a short notice: purpose (verify coupon payments), retention (3 years), link to privacy page, "Reply STOP to remove your number".
- `STOP` → number replaced by a salted hash (kept only for fraud matching), name/notes cleared, confirmation records keep the masked number.
- Dealers and distributors only ever see the masked number (`+91 98•••• 4521`); full number visible to `M24_ADMIN` only.
- Painter numbers are never used for marketing.

---

## 7. Roles and permissions

| Action                                               | Dealer staff | Dealer owner | Distributor | 24M admin | 24M finance | 24M viewer |
| ---------------------------------------------------- | ------------ | ------------ | ----------- | --------- | ----------- | ---------- |
| Check and redeem coupons                             | ✓            | ✓            | –           | –         | –           | –          |
| Show/re-show painter QR, mark "painter has no phone" | ✓            | ✓            | –           | –         | –           | –          |
| See own coupons, batches, painter status (masked)    | own          | own          | routed      | ✓         | ✓           | ✓          |
| Submit claim, mark CN received                       | –            | ✓            | –           | –         | –           | –          |
| Validate dealer claim, close with CN, claim to 24M   | –            | –            | ✓           | –         | –           | –          |
| Create logins / send WhatsApp login link             | –            | own staff    | own dealers | ✓         | –           | –          |
| Lots, codes, activation, blocking                    | –            | –            | –           | ✓         | –           | –          |
| Hold/release/reverse, resolve disputes               | –            | –            | –           | ✓         | –           | –          |
| Validate 24M claim (maker)                           | –            | –            | –           | ✓         | –           | –          |
| Settle with 24M CN (checker ≠ maker)                 | –            | –            | –           | –         | ✓           | –          |
| See full painter numbers                             | –            | –            | –           | ✓         | –           | –          |
| Reports, CSV                                         | –            | own          | own         | ✓         | ✓           | ✓          |

Enforced twice: RLS policies (reads) and role checks inside every function (writes).

---

## 8. Coupon code and QR specification

### 8.1 Format

| Element      | Spec                                                                              | Example                              |
| ------------ | --------------------------------------------------------------------------------- | ------------------------------------ |
| Code         | 12 chars, Crockford Base32 (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`), CSPRNG, ~60 bits | `7KQ2M9XHTB4R`                       |
| Check char   | Luhn mod 32 over the 12 chars                                                     | `J`                                  |
| Serial       | Sequential, human reference, never redeemable alone                               | `P24-0012345`                        |
| QR           | Uppercase URL (alphanumeric mode), ECC level Q, ≥ 18 mm, 4-module quiet zone      | `HTTPS://C.<DOMAIN>/C/7KQ2M9XHTB4RJ` |
| Printed text | Grouped                                                                           | `7KQ2-M9XH-TB4R-J`                   |

### 8.2 Generation

```sql
create or replace function gen_code12() returns text
language sql volatile as $$
  select string_agg(substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', (get_byte(r.b, i) & 31) + 1, 1), '' order by i)
  from (select gen_random_bytes(12) as b) r, generate_series(0, 11) as i;
$$;
```

- Bytes are masked to 5 bits (`& 31`); each byte is uniformly random, so each character is uniform.
- Inserts use `on conflict (code) do nothing` and a top-up loop until the lot quantity is reached.
- **Luhn mod 32** is implemented once in `packages/shared` (TypeScript) and mirrored in SQL for the print export; a shared JSON file of 1,000 test vectors is checked by both implementations in CI.

### 8.3 Normalisation (input from scans or typing)

Uppercase → strip spaces, hyphens and URL prefix → map `O→0`, `I/L→1`, `U→V` is **not** mapped (U is invalid) → must be exactly 13 characters → check character must verify → first 12 characters are the lookup key.

---

## 9. State machines

### 9.1 Coupon

```text
GENERATED ─► ACTIVE ─► REDEEMED ─► DIST_CN_ISSUED ─► CLAIMED_TO_24M ─► SETTLED
    │          │          │               │                 │
    ▼          ├─► BLOCKED├─► ON_HOLD ◄───┘ (24M only)      └─► M24_REJECTED
   VOID        └─► EXPIRED└─► DIST_REJECTED
```

Allowed transitions are stored in a table `coupon_transition(from_status, to_status, function_name)` and asserted by a trigger; pgTAP tests try **every** pair (allowed and forbidden).

### 9.2 Painter confirmation: §6.5

### 9.3 Dealer claim

`OPEN → SUBMITTED → CN_ISSUED → ACKNOWLEDGED`. Lines: `PENDING → APPROVED | REJECTED | HELD`. Held lines move to the next claim when released.

### 9.4 Distributor claim

`SUBMITTED → VALIDATED (maker) → SETTLED (checker)`, or `RETURNED` (to distributor) → resubmitted.

### 9.5 Redemption batch

`CREATED` (one or more coupons redeemed) — immutable; holds the painter-confirmation link and totals.

---

## 10. Login and session design

### 10.1 Dealers and distributors (no passwords)

1. Admin/distributor adds the user (name, mobile, role, dealer). `admin-create-user` creates a Supabase Auth user with an internal email `u<id>@users.<domain>` (never emailed) and an `app_user` row.
2. `admin-login-link` generates a **one-time magic link** (24 h validity) and returns it; the UI shows **Send on WhatsApp** (`wa.me/91<mobile>?text=…`). Sent from the admin's own WhatsApp: ₹0.
3. Dealer taps once → session stored → **stays logged in** (inactivity timeout 90 days; refresh-token rotation on).
4. **Request new link** button on the logged-out screen notifies the distributor's to-do list.
5. **Revocation:** `app_user.status = 'INACTIVE'` (checked in every function, immediate) plus Auth ban to end sessions.

### 10.2 24M users

Email + password + **TOTP** (Supabase MFA). Functions for 24M roles require the session's assurance level `aal2`.

### 10.3 Session robustness

- Access token refreshed in the background when the app opens and every 45 minutes while open, never in the middle of a redeem (see §18.4 for the expired-token path).
- Multiple tabs: a `BroadcastChannel` keeps tabs in sync after refresh or logout.
- Clock skew on the phone does not matter: all times are server times.

---

## 11. Data model

v1 tables are kept (masters, `coupon_lot`, `coupon`, claims, `coupon_event`, `scan_attempt`, `idempotency`, `admin_log`). New and changed tables:

```sql
-- Configuration (single source for windows, limits, toggles)
create table app_config (
  key text primary key, value jsonb not null,
  updated_by bigint, updated_at timestamptz not null default now()
);

-- One row per dealer redemption action (1..50 coupons)
create table redemption_batch (
  id bigserial primary key,
  dealer_id int not null references dealer,
  user_id bigint not null references app_user,
  coupon_count int not null check (coupon_count between 1 and 50),
  value_paise bigint not null check (value_paise > 0),
  created_at timestamptz not null default now()
);
alter table coupon add column redemption_batch_id bigint references redemption_batch;
create index on coupon (redemption_batch_id);

-- Painters (identified only by WhatsApp number)
create table painter (
  id bigserial primary key,
  phone_e164 text unique,                 -- null after STOP (anonymised)
  phone_hash bytea not null unique,       -- salted SHA-256, kept for fraud matching
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  confirm_count int not null default 0,
  status text not null default 'OK' check (status in ('OK','WATCH','BLOCKED','ANONYMISED')),
  privacy_notice_sent_at timestamptz
);

-- Painter confirmation per batch
create table painter_confirmation (
  id bigserial primary key,
  batch_id bigint not null unique references redemption_batch,
  token char(6) not null,
  status text not null default 'PENDING'
    check (status in ('PENDING','CONFIRMED','LATE','DISPUTED','SKIPPED','EXPIRED')),
  created_at timestamptz not null default now(),
  on_time_until timestamptz not null,     -- created_at + 10 min
  expires_at timestamptz not null,        -- created_at + 24 h
  painter_id bigint references painter,
  confirmed_at timestamptz, disputed_at timestamptz,
  skip_reason text, flags text[] not null default '{}',
  wa_message_id text
);
create unique index open_token_unique on painter_confirmation (token)
  where status in ('PENDING','CONFIRMED','LATE');      -- tokens reusable only after closure
create index on painter_confirmation (painter_id, confirmed_at);
create index on painter_confirmation (status, expires_at);

-- Raw inbound WhatsApp messages (add-only, deduplicated)
create table wa_inbound (
  id bigserial primary key,
  wamid text not null unique,             -- Meta message id: dedupes webhook retries
  from_e164 text not null,
  msg_type text not null,
  body text,                              -- truncated to 1,000 chars
  msg_ts timestamptz not null,
  received_at timestamptz not null default now(),
  intent text, result text, processed_at timestamptz
);
create index on wa_inbound (from_e164, received_at);

-- Outgoing replies (retryable)
create table wa_outbox (
  id bigserial primary key,
  to_e164 text not null, body text not null,
  inbound_id bigint references wa_inbound,
  window_expires_at timestamptz not null,  -- inbound msg_ts + 24 h (free window)
  status text not null default 'QUEUED'
    check (status in ('QUEUED','RETRY','SENT','FAILED','EXPIRED_WINDOW')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  meta_message_id text, last_error text,
  created_at timestamptz not null default now()
);
create index on wa_outbox (status, next_attempt_at);

-- Allowed coupon transitions (asserted by trigger)
create table coupon_transition (
  from_status text not null, to_status text not null, primary key (from_status, to_status)
);
```

Add-only triggers (`forbid_change`) apply to `coupon_event`, `scan_attempt`, `admin_log`, `wa_inbound` (except the `intent/result/processed_at` columns, which are set once via a dedicated trigger that only allows null → value).

---

## 12. Database security

1. **RLS on every table** (CI check: a query on `pg_class` fails the build if any table in `public` has RLS disabled).
2. `revoke insert, update, delete on all tables in schema public from anon, authenticated;` All writes go through `security definer` functions with `set search_path = public, pg_temp`.
3. `anon` can only execute `public_coupon_info`; everything else is revoked from `anon` (`revoke execute on all functions … from anon` then explicit grants).
4. `painter.phone_e164`, `wa_inbound`, `wa_outbox` readable only by `M24_ADMIN` via policy; other roles see masked values through views.
5. Service-role key only in Edge Function secrets. Meta tokens and app secret only in Edge Function secrets.
6. Every function begins with `perform assert_role(array[...])` which raises a typed error if the caller is inactive or lacks the role (and checks `aal2` for 24M roles).
7. Secrets rotated quarterly (service key, Meta system-user token, verify token).
8. Supabase spend cap ON (Pro).

---

## 13. Database functions

| Function                                                                   | Caller            | Purpose                                                                 |
| -------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------- |
| `public_coupon_info(code)`                                                 | anon              | Genuineness message only; per-IP rate limit (30 per 10 min)             |
| `check_coupon(code)`                                                       | dealer            | Read-only validation → result code, value, serial, product              |
| `redeem(codes text[], idem uuid)`                                          | dealer            | Redeem 1–50 coupons atomically per coupon; create batch + painter token |
| `batch_status(batch_id)`                                                   | dealer            | Painter-confirmation status for the receipt screen (polling)            |
| `skip_painter_confirmation(batch_id, reason)`                              | dealer            | "Painter has no phone / no WhatsApp"                                    |
| `redemption_outcome(idem uuid)`                                            | dealer            | Resolves an "unknown outcome" after a network failure (§18.4)           |
| `submit_dealer_claim()`, `ack_dealer_cn(claim_id)`                         | dealer owner      | Claims                                                                  |
| `get_claim_by_slip(token)`                                                 | distributor / 24M | Open claim from slip QR                                                 |
| `dist_decide(claim_id, coupon_ids[], decision, reason)`                    | distributor       | Line decisions                                                          |
| `dist_close_claim(claim_id, cn_no, cn_date)`                               | distributor       | Close with CN                                                           |
| `create_dist_claim()`                                                      | distributor       | Claim to 24M                                                            |
| `m24_decide(...)`, `m24_settle(claim_id, cn_no, cn_date)`                  | 24M               | Maker / checker                                                         |
| `create_lot`, `activate_range`, `void_serials`, `block_range`              | 24M admin         | Lots                                                                    |
| `hold_coupons`, `release_coupons`, `reverse_redemption`, `resolve_dispute` | 24M admin         | Exceptions                                                              |
| `wa_handle_inbound(wamid, from, body, type, msg_ts)`                       | service role only | Painter confirmation logic (§13.2)                                      |
| `wa_claim_outbox(limit)`, `wa_mark_sent(...)`, `wa_mark_failed(...)`       | service role only | Outbox handling                                                         |

### 13.1 `redeem`

```sql
create or replace function redeem(p_codes text[], p_idem uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u app_user := assert_role(array['DEALER_OWNER','DEALER_STAFF']);
  d dealer;
  v_claim bigint;
  v_batch bigint;
  v_code text;
  c coupon;
  v_results jsonb := '[]'::jsonb;
  v_ok int := 0;
  v_value bigint := 0;
  v_token text;
  v_resp jsonb;
begin
  if p_codes is null or cardinality(p_codes) = 0 or cardinality(p_codes) > 50 then
    return jsonb_build_object('result','BAD_REQUEST');
  end if;

  -- Idempotent replay (double tap, retry after timeout)
  select response into v_resp from idempotency where user_id = u.id and key = p_idem;
  if found then return v_resp; end if;

  select * into d from dealer where id = u.dealer_id and status = 'ACTIVE';
  if not found then return jsonb_build_object('result','DEALER_INACTIVE'); end if;

  if invalid_scan_brake_active(u.id) then
    return jsonb_build_object('result','TOO_MANY_INVALID');
  end if;

  v_claim := open_claim_for(d.id, d.distributor_id);          -- race-safe upsert
  insert into redemption_batch (dealer_id, user_id, coupon_count, value_paise)
    values (d.id, u.id, 1, 1)                                  -- placeholder, fixed below
    returning id into v_batch;

  foreach v_code in array (select array_agg(distinct x) from unnest(p_codes) x) loop
    v_code := normalise_code(v_code);                          -- null if format/check fails
    if v_code is null then
      v_results := v_results || jsonb_build_object('code', null, 'result', 'INVALID_FORMAT');
      perform log_scan(u.id, null, 'INVALID_FORMAT');
      continue;
    end if;

    update coupon
       set status = 'REDEEMED', redeemed_at = now(),
           redeemed_dealer_id = d.id, redeemed_user_id = u.id,
           routed_distributor_id = d.distributor_id,
           dealer_claim_id = v_claim, redemption_batch_id = v_batch,
           updated_at = now()
     where code = v_code and status = 'ACTIVE'
       and (expires_at is null or expires_at > now())
    returning * into c;

    if found then
      insert into dealer_claim_line (claim_id, coupon_id) values (v_claim, c.id);
      perform log_event(c.id, 'REDEEMED', 'ACTIVE', 'REDEEMED', u.id, v_batch::text);
      perform log_scan(u.id, c.id, 'REDEEMED');
      v_ok := v_ok + 1; v_value := v_value + c.value_paise;
      v_results := v_results || jsonb_build_object('serial', c.serial, 'result', 'REDEEMED', 'value_paise', c.value_paise);
    else
      v_results := v_results || explain_not_redeemable(v_code, u, d);   -- also logs the scan
    end if;
  end loop;

  if v_ok = 0 then
    delete from redemption_batch where id = v_batch;          -- nothing redeemed: no batch, no token
    v_resp := jsonb_build_object('result','NONE_REDEEMED','lines', v_results);
  else
    update redemption_batch set coupon_count = v_ok, value_paise = v_value where id = v_batch;
    v_token := new_painter_token(v_batch);                     -- unique among open tokens
    v_resp := jsonb_build_object(
      'result', case when v_ok = cardinality(p_codes) then 'REDEEMED' else 'PARTIAL' end,
      'batch_id', v_batch, 'count', v_ok, 'value_paise', v_value,
      'painter_token', v_token, 'lines', v_results, 'at', now());
  end if;

  insert into idempotency (user_id, key, response) values (u.id, p_idem, v_resp);
  return v_resp;
end $$;
```

Notes:

- `redemption_batch` deletion when nothing is redeemed is safe because no row references it yet. The add-only rule doesn't apply to batches until they hold coupons (a trigger forbids deleting batches that have coupons).
- Duplicates inside one request are removed with `distinct` before processing.
- Row locks are held until commit; 50 codes keeps transactions short (< 50 ms target).

### 13.2 `wa_handle_inbound` (outline)

```sql
create or replace function wa_handle_inbound(p_wamid text, p_from text, p_body text, p_type text, p_msg_ts timestamptz)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_inbound bigint; v_intent text; v_token text; v_painter painter; pc painter_confirmation;
  v_ts timestamptz := least(greatest(p_msg_ts, now() - interval '7 days'), now() + interval '5 minutes');
  v_reply text; v_flags text[] := '{}';
begin
  insert into wa_inbound (wamid, from_e164, msg_type, body, msg_ts)
    values (p_wamid, p_from, p_type, left(p_body, 1000), v_ts)
    on conflict (wamid) do nothing
    returning id into v_inbound;
  if v_inbound is null then return jsonb_build_object('reply', null); end if;   -- duplicate webhook

  v_painter := upsert_painter(p_from);                      -- creates or touches; returns row
  select intent, token into v_intent, v_token from parse_wa_message(p_type, p_body);

  if painter_bad_token_brake(v_painter.id) then
    perform wa_finish(v_inbound, v_intent, 'IGNORED_BRAKE'); return jsonb_build_object('reply', null);
  end if;

  if v_intent = 'STOP' then
    perform anonymise_painter(v_painter.id);
    v_reply := reply_text('STOPPED', v_painter);
  elsif v_intent = 'DISPUTE' then
    v_reply := handle_dispute(v_painter, v_ts);              -- latest CONFIRMED/LATE within 24 h → DISPUTED + hold
  elsif v_intent = 'CONFIRM' then
    select * into pc from painter_confirmation
     where token = v_token and status in ('PENDING','CONFIRMED','LATE')
     for update;
    if not found then
      v_reply := reply_text('UNKNOWN_TOKEN', v_painter);
    elsif pc.status in ('CONFIRMED','LATE') then
      v_reply := case when pc.painter_id = v_painter.id then reply_text('ALREADY_CONFIRMED', v_painter, pc)
                      else reply_text('TOKEN_USED', v_painter) end;
    elsif v_ts > pc.expires_at then
      update painter_confirmation set status = 'EXPIRED' where id = pc.id;
      v_reply := reply_text('EXPIRED', v_painter);
    else
      v_flags := painter_flags(v_painter, pc);               -- SELF_CONFIRM, STAFF_NUMBER, MULTI_DEALER, ...
      update painter_confirmation
         set status = case when v_ts <= pc.on_time_until then 'CONFIRMED' else 'LATE' end,
             painter_id = v_painter.id, confirmed_at = v_ts, flags = v_flags, wa_message_id = p_wamid
       where id = pc.id;
      if 'SELF_CONFIRM' = any(v_flags) then perform hold_batch(pc.batch_id, 'SELF_CONFIRM'); end if;
      v_reply := reply_text('CONFIRMED', v_painter, pc);
    end if;
  else
    v_reply := reply_text('HELP', v_painter);
  end if;

  perform wa_finish(v_inbound, v_intent, 'OK');
  perform wa_enqueue(p_from, v_reply, v_inbound, v_ts + interval '24 hours', v_painter);  -- adds privacy notice on first contact
  return jsonb_build_object('reply', v_reply);
end $$;
```

---

## 14. Edge Functions (Deno)

| Function            | Auth                                                                                                | Purpose                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `admin-create-user` | JWT, role `M24_ADMIN` / `DISTRIBUTOR` (own dealers) / `DEALER_OWNER` (own staff, creates a request) | Create Auth user + `app_user`                               |
| `admin-login-link`  | same as above                                                                                       | Generate magic link, return for WhatsApp share              |
| `bulk-upload`       | `M24_ADMIN`                                                                                         | CSV → validation report (dry run) → commit in a transaction |
| `export-print-file` | `M24_ADMIN`                                                                                         | Stream CSV for a lot; log checksum                          |
| `wa-webhook`        | Meta signature                                                                                      | §6.6                                                        |
| `wa-sender`         | Internal secret header (from pg_net) or service role                                                | §6.7                                                        |

Common rules for every Edge Function:

- Input validated with Valibot schemas from `packages/shared`; unknown fields rejected.
- Structured JSON logs (`level, fn, request_id, user_id, outcome, ms`); no personal data in logs (numbers masked).
- Timeouts on outbound calls (Graph API 8 s).
- Unit tests with mocked `fetch` and a fake clock; contract tests against recorded Meta payload fixtures.

---

## 15. Validation rules

### 15.1 Stage 1: dealer (result codes shown in the copy deck, Appendix A)

| ID    | Rule                                           | Result code                                            |
| ----- | ---------------------------------------------- | ------------------------------------------------------ |
| R1-01 | Characters, length, check character            | `INVALID_FORMAT` (client-side first, server re-checks) |
| R1-02 | Code exists                                    | `NOT_FOUND`                                            |
| R1-03 | Lot active                                     | `NOT_ACTIVE`                                           |
| R1-04 | Not blocked/void                               | `BLOCKED`                                              |
| R1-05 | Not expired                                    | `EXPIRED`                                              |
| R1-06 | Not already redeemed                           | `ALREADY_REDEEMED_SELF` / `ALREADY_REDEEMED_OTHER`     |
| R1-07 | Dealer active, mapped to an active distributor | `DEALER_INACTIVE`                                      |
| R1-08 | Fewer than 5 invalid scans in 10 min           | `TOO_MANY_INVALID`                                     |
| R1-09 | Session valid, role allowed                    | `AUTH_REQUIRED`                                        |
| R1-10 | Batch size 1–50                                | `BAD_REQUEST`                                          |

### 15.2 Stage 1a: painter confirmation

| ID     | Rule                                          | Outcome                          |
| ------ | --------------------------------------------- | -------------------------------- |
| R1a-01 | Message carries a known open token            | Else `UNKNOWN_TOKEN` reply       |
| R1a-02 | Within 10 min → CONFIRMED; within 24 h → LATE | Else `EXPIRED`                   |
| R1a-03 | Token not already used by another number      | Else `TOKEN_USED` + flag on both |
| R1a-04 | Number not a same-dealer user                 | Else `SELF_CONFIRM` → hold       |
| R1a-05 | Volume/multi-dealer thresholds                | Flags only                       |
| R1a-06 | Fewer than 5 bad tokens per hour per number   | Else ignored for 1 h             |

### 15.3 Stage 2: distributor

R2-01 coupon `REDEEMED` · R2-02 routed to this distributor · R2-03 not in another claim (unique) · R2-04 redeemed ≤ 90 days ago · R2-05 not `ON_HOLD` (disputed/self-confirm coupons are on hold) · R2-06 CN number unique for this distributor, CN date between submission date and today · R2-07 total computed by the system · R2-08 (strict mode only) painter status is CONFIRMED or LATE.

### 15.4 Stage 3: 24M

R3-01 coupon `DIST_CN_ISSUED` · R3-02 dealer claim belongs to this distributor and has a CN · R3-03 not in another distributor claim · R3-04 submitted ≤ 60 days after dealer CN · R3-05 not on hold, no open dispute · R3-06 maker ≠ checker (DB check) · R3-07 24M CN unique.

---

## 16. UX and UI specification

### 16.1 Principles

1. **One decision per screen** for dealers. The answer (pay / don't pay) is the biggest thing on the screen.
2. **Never ambiguous about money:** green + ✓ + "Pay ₹100" only after the server confirms; red + ✕ + "Do NOT pay" for every failure; amber + ⟳ "Checking… don't pay yet" while unknown.
3. **Words + icon + colour**, never colour alone.
4. **Plain language** (reading age ~10), in the user's language (English, Hindi, Marathi; switchable on every screen).
5. **Thumb-first layout:** primary action at the bottom, full width, ≥ 56 px tall.
6. **Forgiving:** every error tells the user what to do next; nothing destructive without a clear confirm; back always works.
7. **Fast-feeling:** skeletons instead of spinners; optimistic UI is **not** used for money actions.

### 16.2 Design tokens (CSS variables)

| Token             | Value                                                                       | Use                               | Contrast on white       |
| ----------------- | --------------------------------------------------------------------------- | --------------------------------- | ----------------------- |
| `--c-ink`         | `#0F1B2D`                                                                   | Body text                         | 16.9:1                  |
| `--c-muted`       | `#4A5A70`                                                                   | Secondary text                    | 7.0:1                   |
| `--c-success`     | `#05603A`                                                                   | Valid/paid text, buttons          | 7.4:1                   |
| `--c-danger`      | `#A1161B`                                                                   | Do not pay                        | 7.6:1                   |
| `--c-warning-ink` | `#7A3E00`                                                                   | Checking/late (text on `#FFF4E5`) | ≥ 7:1                   |
| `--c-focus`       | `#1D4ED8`                                                                   | 3 px focus ring + 2 px offset     | 3:1 vs adjacent colours |
| Font              | System stack (`system-ui, "Noto Sans", "Noto Sans Devanagari", sans-serif`) | No web-font download              |                         |
| Base size         | 18 px dealer UI, 16 px back-office; line-height 1.5                         |                                   |                         |
| Spacing           | 4 px scale                                                                  |                                   |                         |
| Touch target      | ≥ 48 × 48 px (primary buttons 56 px)                                        |                                   |                         |
| Radius            | 12 px cards, 10 px buttons                                                  |                                   |                         |

Final values are verified with an automated contrast test over all token pairs (§20).

### 16.3 Component library (`src/ui`)

`Button` (primary/secondary/danger, loading state, never disabled without a visible reason), `ResultCard` (valid/invalid/checking/warning variants), `Banner` (offline, slow network, update available), `StatusPill`, `CodeInput` (grouped, live check-char validation), `Scanner` (camera with permission explainer and fallback), `QrBlock` (painter QR + typed text + number), `Money` (₹ with Indian grouping), `DataTable` (sortable, keyboard-navigable, CSV), `Dialog` (focus-trapped, Esc closes), `LanguageSwitch`, `HelpLink` (same position on every screen), `Skeleton`, `EmptyState`, `ErrorState`. Each component has Storybook-style examples (Ladle, free and light) and tests.

### 16.4 Dealer screens and states

| Screen                  | Default                                              | Loading                          | Success                                                                   | Error                                                      | Offline                                                            | Other                                                               |
| ----------------------- | ---------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| **Coupon result**       | —                                                    | Skeleton card "Checking coupon…" | Green ✓ "₹100 · Valid coupon", product, serial, **"₹100 paid – Confirm"** | Red ✕ reason + "Do NOT pay" + Help                         | Amber "No internet. Don't pay yet." + Retry                        | Not logged in → "Log in to redeem" with Request link                |
| **Receipt**             | —                                                    | "Saving… don't pay again"        | "REDEEMED ✓ ₹100" + painter QR + "Waiting for painter…"                   | Unknown outcome → "Checking result…" auto-resolves (§18.4) | Receipt shown from response; painter status polls when back online | "Painter confirmed ✓" (live update); "Painter has no WhatsApp" link |
| **Scan many**           | Camera + empty list                                  | Per-line checking                | List with ✓/✕, total, **Confirm ₹X**                                      | Per-line reasons                                           | Scanning paused, banner                                            | Duplicate scan → "Already in list"                                  |
| **Type code**           | Grouped input                                        | —                                | Goes to Coupon result                                                     | Inline: "Check the last letter"                            | —                                                                  | —                                                                   |
| **Home**                | Scan / Scan many / Type code, today and month totals | Skeleton                         | —                                                                         | Error state with retry                                     | Cached totals with "last updated" time                             | —                                                                   |
| **My coupons / claims** | Lists by month                                       | Skeleton                         | —                                                                         | Retry                                                      | Cached data, read-only                                             | Empty: "No coupons yet"                                             |
| **Staff** (owner)       | Staff list                                           | —                                | Request sent                                                              | Errors inline                                              | Disabled with reason                                               | —                                                                   |

### 16.5 Distributor and 24M screens

Desktop-first, responsive to 360 px. Tables with filters (date, status, dealer, painter status), keyboard shortcuts on claim validation (`A` approve, `R` reject, `J/K` next/previous), sticky totals bar, confirmation dialogs showing the exact total before closing with a CN, and CSV downloads. Every list has empty, loading, error and "no permission" states.

### 16.6 Content rules

- Currency: `₹1,00,000` (Indian grouping) via `Intl.NumberFormat('en-IN')`.
- Dates: `12 Nov 2026, 10:32` in IST; relative times for < 24 h ("2 min ago").
- Numbers in Devanagari are **not** used; digits stay ASCII for consistency with codes.
- Copy for every result code in all three languages (Appendix A), reviewed by native speakers before pilot.

### 16.7 Usability testing

- **Round 1 (week 4, clickable build):** 5 dealers, tasks: redeem one, redeem many, handle "already redeemed", show painter QR, find this month's total.
- **Round 2 (week 9, staging):** 5 dealers + 2 distributors + 2 painters (WhatsApp confirm).
- Pass mark: ≥ 90% task success unaided, median redeem time ≤ 10 s from coupon in hand.

---

## 17. Accessibility (WCAG 2.2 AA)

### 17.1 Requirements mapped to implementation

| WCAG 2.2 criterion                                | Implementation                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1.1.1 Non-text content                            | Icons have text labels; QR has a text alternative (number + message)                  |
| 1.3.1 Info and relationships                      | Semantic HTML (`main`, `nav`, `h1–h3`, `table` with `th scope`), labelled form fields |
| 1.3.4 Orientation                                 | Works in portrait and landscape                                                       |
| 1.3.5 Identify input purpose                      | `autocomplete="tel"`, `inputmode="numeric"` where relevant                            |
| 1.4.1 Use of colour                               | Status always has icon + text                                                         |
| 1.4.3 / 1.4.11 Contrast                           | Text ≥ 4.5:1 (we target 7:1 for dealer UI), UI components ≥ 3:1; automated token test |
| 1.4.4 / 1.4.10 Resize and reflow                  | Usable at 200% text and 320 px width without horizontal scrolling                     |
| 1.4.12 Text spacing                               | Layout tolerates increased letter/line spacing (tested)                               |
| 1.4.13 Content on hover/focus                     | No hover-only content                                                                 |
| 2.1.1 / 2.1.2 Keyboard, no trap                   | All actions keyboard-operable; scanner dialog closes with Esc and returns focus       |
| 2.2.1 Timing adjustable                           | Painter QR window: warning at 8 min with **"Keep showing"**; token itself valid 24 h  |
| 2.3.1 Flashes                                     | No flashing; success animation ≤ 300 ms, disabled under `prefers-reduced-motion`      |
| 2.4.1 Bypass blocks                               | Skip link on back-office pages                                                        |
| 2.4.3 Focus order, 2.4.7 Focus visible            | Logical DOM order; 3 px focus ring                                                    |
| 2.4.11 Focus not obscured                         | Sticky bars never cover the focused element (scroll-margin)                           |
| 2.5.3 Label in name                               | Visible text = accessible name                                                        |
| 2.5.7 Dragging movements                          | None needed                                                                           |
| 2.5.8 Target size                                 | ≥ 48 px (exceeds the 24 px minimum)                                                   |
| 3.1.1 / 3.1.2 Language                            | `lang` set per page and per language switch (`en`, `hi`, `mr`)                        |
| 3.2.6 Consistent help                             | Help link + helpline in the same place on every screen                                |
| 3.3.1 / 3.3.3 Error identification and suggestion | Errors in text with a fix ("Check the last letter of the code")                       |
| 3.3.7 Redundant entry                             | Never ask for the same information twice in a flow                                    |
| 3.3.8 Accessible authentication                   | Magic link: no password or puzzle for dealers; 24M TOTP allows paste                  |
| 4.1.2 Name, role, value                           | Native elements first; ARIA only where needed                                         |
| 4.1.3 Status messages                             | Scan results announced via `role="status"` (polite) or `role="alert"` (do-not-pay)    |

### 17.2 Accessibility testing

1. **Automated:** `eslint-plugin-jsx-a11y` (strict) in lint; `axe-core` via `@axe-core/playwright` on every page and every state in E2E (**0 violations** gate); contrast unit test for every token pair.
2. **Manual per release:** keyboard-only pass; **TalkBack** (Android Chrome), **VoiceOver** (iOS Safari), **NVDA** (Windows Chrome) for the dealer flow and claim validation; 200% zoom and 320 px reflow; text-spacing bookmarklet.
3. **Pre-pilot audit:** an independent accessibility review (half day, included in the UI/UX reviewer's time) against WCAG 2.2 AA; issues are release blockers.

---

## 18. Performance and network resilience

### 18.1 Budgets (enforced in CI)

| Budget                                    | Limit                                                   | Tool                                |
| ----------------------------------------- | ------------------------------------------------------- | ----------------------------------- |
| Dealer route JS (initial, gzip)           | ≤ 90 KB                                                 | `size-limit`                        |
| Dealer route CSS (gzip)                   | ≤ 12 KB                                                 | `size-limit`                        |
| Scanner fallback chunk (lazy)             | ≤ 150 KB, loaded only if BarcodeDetector missing        | `size-limit`                        |
| Back-office chunk (lazy)                  | ≤ 250 KB                                                | `size-limit`                        |
| Web fonts                                 | 0 bytes                                                 | Lint rule                           |
| `check_coupon` / `redeem` payload         | ≤ 2 KB response for a single coupon                     | API tests                           |
| DB time `redeem` (1 coupon)               | p95 ≤ 30 ms                                             | pgTAP timing + `pg_stat_statements` |
| Lighthouse mobile (Moto G Power, slow 4G) | Performance ≥ 90, LCP ≤ 2.5 s, TBT ≤ 200 ms, CLS ≤ 0.05 | Lighthouse CI                       |
| INP (field)                               | ≤ 200 ms                                                | Sentry web vitals                   |

### 18.2 Techniques

1. **App shell precached** by the service worker; repeat visits render with zero network. Updates install in the background with an "Update available" banner (never mid-redeem).
2. **Preconnect** to the Supabase API origin in the HTML head; DNS and TLS warm before the first call.
3. **Local validation first:** format and check character are checked on the device; bad scans never hit the network.
4. **One request per step**, tiny JSON; no waterfalls on the dealer path (the coupon page needs exactly one call).
5. **Brotli/gzip** by Cloudflare; HTTP/3.
6. **Code-splitting:** auth SDK, scanner fallback, back-office, and language packs load separately; prefetched on idle when `navigator.connection.saveData` is false.
7. **No layout shift:** fixed-size result card and skeleton.
8. **Low-end devices:** no heavy animation, no large images, virtualised long tables in back-office.
9. **Database:** every query path has an index; keyset pagination; `pg_stat_statements` reviewed monthly; slow-query threshold 100 ms logged.

### 18.3 Network-aware behaviour

| Condition                                  | Detection                                                         | Behaviour                                                                                                 |
| ------------------------------------------ | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Offline                                    | `navigator.onLine` + failed fetch                                 | Amber banner "No internet. Don't pay yet."; scanning still validates format locally; no redemption queued |
| Slow (RTT > 600 ms or effectiveType 2g/3g) | Network Information API (where supported) + measured request time | "Slow network – this may take a few seconds" hint after 2 s; longer timeouts                              |
| Flaky (drops mid-request)                  | Fetch error/timeout                                               | Retry policy (§18.4)                                                                                      |
| Captive portal / proxy returning HTML      | Response content-type check                                       | Treated as offline                                                                                        |
| Data saver on                              | `saveData`                                                        | No prefetching                                                                                            |

### 18.4 Redeem request algorithm (handles every network outcome)

```text
generate idemKey (UUID v4) when the dealer taps Confirm; persist in sessionStorage with the codes
attempt = 0
loop:
  timeout = attempt == 0 ? 12 s : 20 s
  send rpc/redeem(codes, idemKey) with AbortController(timeout)
  if 2xx → validate response schema → show result → clear idemKey → done
  if 401 → refresh session once (auth-js) → retry same idemKey (doesn't count as attempt)
  if 4xx (other) → show mapped error → done
  if 5xx / network error / timeout:
      attempt += 1
      UI: "Checking result… don't pay again"
      if attempt <= 3 → wait 1 s, 2 s, 4 s (+ jitter) → loop
      else → call rpc/redemption_outcome(idemKey) when online:
              found → show stored result
              not found → "Not redeemed. Try again." (safe: the server never saw it)
on app reopen: if an idemKey is persisted → resolve via redemption_outcome before anything else
```

Guarantee: the same idempotency key can never redeem twice, and the UI never shows success unless the server's stored response says so.

### 18.5 Network profile targets (tested in CI with Playwright + CDP throttling)

| Profile   | RTT / down / up              | Target (cached app): scan → result  | Target: confirm → receipt |
| --------- | ---------------------------- | ----------------------------------- | ------------------------- |
| 4G        | 50 ms / 9 Mbps / 3 Mbps      | ≤ 1 s                               | ≤ 1 s                     |
| Slow 4G   | 150 ms / 1.6 Mbps / 750 Kbps | ≤ 1.5 s                             | ≤ 1.5 s                   |
| 3G        | 300 ms / 750 Kbps / 250 Kbps | ≤ 3 s                               | ≤ 3 s                     |
| 2G (EDGE) | 800 ms / 240 Kbps / 200 Kbps | ≤ 6 s                               | ≤ 6 s                     |
| Flaky     | 3G with 20% request failure  | Correct final result; no duplicates | Correct final result      |

First visit (uncached) on 3G: interactive ≤ 5 s.

---

## 19. Engineering standards

### 19.1 Principles

- **Zero warnings policy:** every linter runs with `--max-warnings 0`; warnings are errors in CI.
- **No `any`, no non-null assertions, no unhandled promises.**
- **All external data validated at the boundary** (API responses, URL params, webhook bodies, CSV uploads).
- **Pure logic lives in `packages/shared`** with 100% test coverage.

### 19.2 TypeScript configuration (base)

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noPropertyAccessFromIndexSignature": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "useUnknownInCatchVariables": true,
    "forceConsistentCasingInFileNames": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": false,
  },
}
```

### 19.3 ESLint (flat config) essentials

```js
// eslint.config.js (essentials)
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  react.configs.flat.recommended,
  react.configs.flat['jsx-runtime'],
  reactHooks.configs['recommended-latest'],
  jsxA11y.flatConfigs.strict,
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  security.configs.recommended,
  {
    languageOptions: { parserOptions: { projectService: true } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/strict-boolean-expressions': 'error',
      'no-console': 'error',
      eqeqeq: 'error',
      complexity: ['error', 12],
      'max-depth': ['error', 3],
      'max-lines-per-function': ['error', { max: 80, skipComments: true }],
      'import-x/no-cycle': 'error',
      'import-x/order': ['error', { 'newlines-between': 'always', alphabetize: { order: 'asc' } }],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@supabase/supabase-js',
              message: 'Use src/lib/api (thin client) on dealer routes.',
            },
          ],
        },
      ],
      'react/jsx-no-literals': 'error', // all user-facing text must come from i18n
    },
  },
);
```

### 19.4 Other linters and formatters

| Area                           | Tool                                                                                         | Gate               |
| ------------------------------ | -------------------------------------------------------------------------------------------- | ------------------ |
| Formatting (TS, JSON, MD, CSS) | Prettier                                                                                     | `prettier --check` |
| SQL                            | **sqlfluff** (dialect `postgres`) + **plpgsql_check** via `supabase db lint --level warning` | 0 issues           |
| Deno Edge Functions            | `deno lint`, `deno fmt --check`, `deno check`                                                | 0 issues           |
| CSS                            | Stylelint (standard + order) with Tailwind plugin                                            | 0 issues           |
| Markdown docs                  | markdownlint                                                                                 | 0 issues           |
| Commit messages                | commitlint (Conventional Commits)                                                            | Required           |
| Secrets                        | gitleaks (pre-commit and CI)                                                                 | 0 findings         |
| Dependencies                   | `pnpm audit --prod` + **osv-scanner**; Renovate weekly                                       | No high/critical   |
| Licences                       | `license-checker` allow-list (MIT, Apache-2.0, BSD, ISC)                                     | Required           |
| Generated types                | `supabase gen types` diff check                                                              | No drift           |
| Unused code                    | **knip** (unused files, exports, deps)                                                       | 0 findings         |

### 19.5 Git workflow and reviews

- Trunk-based: short-lived branches, PR to `main`, squash merge, branch protection with all CI gates required.
- PR template: what/why, screenshots for UI, test evidence, accessibility notes, migration notes.
- Review checklist: money paths, idempotency, RLS impact, new edge cases added to §21 and tests, copy in all 3 languages, no `console`, no secrets.
- Pre-commit (lefthook): lint-staged (ESLint/Prettier/sqlfluff on changed files), gitleaks, commitlint.
- Architecture Decision Records in `docs/adr/` for every non-trivial choice.

---

## 20. Testing strategy and coverage gates

### 20.1 Test pyramid

| Layer            | Tool                                                                      | Scope                                                                                               |
| ---------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Pure logic       | **Vitest** + **fast-check** (property-based)                              | `packages/shared`: alphabet, Luhn mod 32, normalisers, WhatsApp parser, phone normaliser, money     |
| Database         | **pgTAP**                                                                 | Every function, every RLS policy (allow + deny per role), every coupon transition, every constraint |
| Edge Functions   | **Deno test** + fixtures                                                  | Signature verification, parsing, outbox retries, admin auth                                         |
| Components       | Vitest + **React Testing Library** + **MSW**                              | Every UI state in §16.4                                                                             |
| End-to-end       | **Playwright** (Chromium, WebKit, Firefox; Pixel 5 + iPhone 13 emulation) | All journeys, all result screens, network profiles, axe                                             |
| Accessibility    | axe-core in E2E + manual (§17.2)                                          | 0 violations                                                                                        |
| Performance      | Lighthouse CI + size-limit + k6                                           | Budgets in §18                                                                                      |
| Concurrency/load | **k6**                                                                    | Same-code races, 300 redemptions/min                                                                |
| Security         | ZAP baseline + manual review                                              | No high findings                                                                                    |
| Mutation         | **Stryker** (TS)                                                          | Shared logic and API client                                                                         |

### 20.2 Coverage thresholds (CI fails below; thresholds can only go up)

| Area                                                       | Lines                                                                                                                                                           | Branches | Functions | Mutation score |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------- | -------------- |
| `packages/shared`                                          | **100%**                                                                                                                                                        | **100%** | **100%**  | ≥ 90%          |
| `apps/web/src/lib` (API client, network, i18n, formatters) | ≥ 95%                                                                                                                                                           | ≥ 95%    | ≥ 95%     | ≥ 80%          |
| `apps/web/src/features` + `src/ui`                         | ≥ 90%                                                                                                                                                           | ≥ 85%    | ≥ 90%     | —              |
| Edge Functions                                             | ≥ 95%                                                                                                                                                           | ≥ 90%    | ≥ 95%     | —              |
| Database                                                   | **Every function, policy and transition has tests**, enforced by a meta-test that compares `pg_proc` / `pg_policies` / `coupon_transition` with the tested list |          |           |                |

### 20.3 Property-based tests (fast-check)

- Any generated code passes its own check character; any single-character change or adjacent swap fails it.
- `normalise(display(code)) == code` for all codes; lowercase, extra spaces and hyphens are tolerated.
- WhatsApp parser: a valid token surrounded by arbitrary text/emojis in any case is found; strings without a valid token never produce `CONFIRM`.
- Money: sums of paise never overflow within limits and format correctly in `en-IN`.

### 20.4 Database test catalogue (pgTAP, minimum)

1. Each role × each function: allowed roles succeed, others get `FORBIDDEN`; inactive user always `FORBIDDEN`; 24M functions require `aal2`.
2. Each table × each role: select returns only permitted rows; insert/update/delete denied.
3. Anon key: 0 rows from every table; only `public_coupon_info` executable.
4. Every allowed coupon transition succeeds through its function; every forbidden pair raises.
5. `redeem`: happy path; each failure code; duplicates in input; 50-code limit; partial success; batch + token creation; no batch when none redeemed; idempotent replay returns identical JSON.
6. `wa_handle_inbound`: every intent; duplicate wamid; on-time vs late vs expired boundaries (exactly 10:00 and 24:00:00); token used by another number; self-confirm hold; STOP anonymisation; dispute within/after 24 h; bad-token brake; future/old timestamps clamped.
7. Claims: one open claim per dealer under concurrency; CN uniqueness; maker ≠ checker; windows at boundaries.
8. Add-only tables reject update/delete even for the service role.
9. pg_cron jobs callable directly and idempotent (running twice changes nothing more).

### 20.5 Component tests

Every screen × every state from §16.4, every result code's copy in all three languages (snapshot of text, not markup), focus management after each transition, `role=status/alert` announcements, language switch persistence.

### 20.6 End-to-end journeys (Playwright)

1. Onboarding: admin creates dealer → login link → dealer logs in (magic link) → home.
2. Redeem one → receipt → painter confirm (WhatsApp webhook simulated with a signed fixture) → "Painter confirmed ✓" appears.
3. Redeem many with a mix of valid, already-redeemed and invalid codes.
4. Two browser contexts redeem the same coupon simultaneously → one success, one "do NOT pay".
5. Network drop after Confirm → "Checking result…" → outcome resolved, no duplicate.
6. Distributor closes claim with CN → dealer acknowledges.
7. Claim to 24M → maker → checker → settled → CSV export.
8. Dispute ("NO") → coupons on hold → distributor sees held lines → 24M resolves.
9. Logged-out, inactive user, expired link, wrong role paths.
10. Every page run with axe; every journey run on 4G, 3G, 2G and flaky profiles.

### 20.7 Load and concurrency (k6, against staging with 5 lakh seeded coupons)

- 100 virtual users redeem **the same code** → exactly 1 `REDEEMED`.
- 300 redemptions/minute for 15 minutes across 200 dealers → p95 server time ≤ 300 ms, 0 errors.
- 50 inbound WhatsApp webhooks/second for 2 minutes (including 10% duplicates) → every message processed exactly once.
- Month-end: 1,000 dealer claims submitted by cron in one run → completes < 60 s.

### 20.8 Test data

`seed.sql` creates 3 distributors, 20 dealers, users for every role, 3 lots (inactive, active, blocked), coupons in every status, claims in every status, painters with each flag. Factories in tests build only what each test needs. Fixed clock in tests (`set local` time helpers) for window boundaries.

### 20.9 CI pipeline (GitHub Actions)

| Job           | Runs on                   | Gates                                                                                           |
| ------------- | ------------------------- | ----------------------------------------------------------------------------------------------- |
| `lint`        | every PR                  | ESLint, Prettier, Stylelint, sqlfluff, deno lint/fmt, markdownlint, commitlint, gitleaks, knip  |
| `typecheck`   | every PR                  | `tsc -b`, `deno check`, Supabase type drift                                                     |
| `unit`        | every PR                  | Vitest with coverage thresholds; Deno tests with coverage                                       |
| `db`          | every PR                  | `supabase start` → migrations from zero → pgTAP → plpgsql_check → RLS-enabled check → meta-test |
| `build`       | every PR                  | Vite build, size-limit budgets                                                                  |
| `e2e`         | every PR                  | Playwright (3 engines, 2 devices), axe, 4G/3G profiles                                          |
| `e2e-network` | nightly                   | 2G and flaky profiles, full journey matrix                                                      |
| `lighthouse`  | every PR (preview deploy) | Budgets in §18.1                                                                                |
| `mutation`    | nightly                   | Stryker thresholds                                                                              |
| `security`    | weekly + before release   | osv-scanner, pnpm audit, licence check, ZAP baseline on staging                                 |
| `load`        | before each release       | k6 suite (§20.7)                                                                                |
| `backup`      | weekly                    | pg_dump → encrypt → R2; monthly restore test job                                                |

A PR can merge only when all per-PR jobs are green. A release can go to production only when nightly and release jobs are green.

---

## 21. Edge-case catalogue

Each case has a test reference: **U** unit, **D** pgTAP, **E** Edge Function test, **C** component, **P** Playwright E2E, **K** k6, **M** manual.

### 21.1 Codes and QR

| ID     | Case                                | Expected                                  | Test |
| ------ | ----------------------------------- | ----------------------------------------- | ---- |
| EC-001 | Lowercase code typed                | Accepted after normalisation              | U    |
| EC-002 | Spaces/hyphens in code              | Accepted                                  | U    |
| EC-003 | `O` typed for `0`, `I`/`L` for `1`  | Accepted                                  | U    |
| EC-004 | `U` in code                         | Invalid format                            | U    |
| EC-005 | Wrong check character               | "Check the last letter" (no network call) | U, C |
| EC-006 | 12 characters (check char missing)  | Invalid format                            | U    |
| EC-007 | Full URL pasted into type box       | URL stripped, code extracted              | U    |
| EC-008 | QR of another product/brand scanned | "Not a 24M coupon"                        | C    |
| EC-009 | QR with tracking params appended    | Ignored params, code extracted            | U    |
| EC-010 | Code exists but lot not activated   | NOT_ACTIVE, logged                        | D    |
| EC-011 | Code in blocked range               | BLOCKED                                   | D    |
| EC-012 | Code voided as spoiled              | BLOCKED (void)                            | D    |
| EC-013 | Expired at exactly `expires_at`     | Expired (boundary: `>` comparison)        | D    |
| EC-014 | Code collision during generation    | Retry until quantity reached              | D    |
| EC-015 | Print file exported twice           | Second export needs reason, logged        | D, E |

### 21.2 Redemption

| ID     | Case                                                   | Expected                                                  | Test |
| ------ | ------------------------------------------------------ | --------------------------------------------------------- | ---- |
| EC-020 | Same dealer re-scans redeemed coupon                   | Amber "Already redeemed by you at…"                       | D, C |
| EC-021 | Another dealer scans redeemed coupon                   | Red "do NOT pay", logged                                  | D, C |
| EC-022 | Two phones confirm same coupon same millisecond        | Exactly one success                                       | K, P |
| EC-023 | Double tap on Confirm                                  | One request (button locked) and idempotent replay         | C, D |
| EC-024 | Bulk list contains same code twice                     | Deduplicated                                              | U, D |
| EC-025 | Bulk with 51 codes                                     | UI caps at 50; server rejects >50                         | C, D |
| EC-026 | Bulk where all invalid                                 | NONE_REDEEMED, no batch/token                             | D    |
| EC-027 | Bulk partial success                                   | PARTIAL, per-line results, one token for redeemed coupons | D, P |
| EC-028 | Dealer becomes inactive between check and confirm      | DEALER_INACTIVE at confirm                                | D    |
| EC-029 | Coupon blocked between check and confirm               | BLOCKED at confirm                                        | D    |
| EC-030 | Dealer's distributor changes between check and confirm | Uses mapping at confirm time                              | D    |
| EC-031 | 5 invalid scans in 10 minutes                          | TOO_MANY_INVALID for 10 minutes                           | D, C |
| EC-032 | Redemption at 23:59:59 on month end                    | Joins current open claim; cut-off job at 00:05 submits it | D    |
| EC-033 | Staff user redeems                                     | Recorded under staff user, dealer is owner's dealer       | D    |
| EC-034 | Coupon value differs by lot                            | Totals sum actual values                                  | D    |
| EC-035 | Wrong dealer account (shared phone)                    | 24M reversal before distributor close                     | D    |
| EC-036 | Reversal attempted after distributor close             | Refused                                                   | D    |

### 21.3 Network and device

| ID     | Case                                                     | Expected                                                 | Test |
| ------ | -------------------------------------------------------- | -------------------------------------------------------- | ---- |
| EC-040 | Offline at scan                                          | Local format check; "No internet. Don't pay yet."        | C, P |
| EC-041 | Connection drops after Confirm, before response          | "Checking result…" → outcome resolved                    | P    |
| EC-042 | Server processed but response lost                       | Retry with same key returns stored result                | D, P |
| EC-043 | Server never received request                            | Outcome lookup returns none → "Not redeemed. Try again." | P    |
| EC-044 | App closed during "Checking…"                            | On reopen, resolves pending key first                    | C, P |
| EC-045 | Access token expired at Confirm                          | Refresh once, retry same key                             | C, P |
| EC-046 | Refresh token revoked                                    | Logged-out screen with "Request new link"                | P    |
| EC-047 | Captive portal returns HTML                              | Treated as offline                                       | U    |
| EC-048 | Response fails schema validation                         | Error state, Sentry report, no success shown             | U, C |
| EC-049 | 2G network                                               | Targets in §18.5 met                                     | P    |
| EC-050 | 20% packet failure                                       | Correct outcome, no duplicates                           | P    |
| EC-051 | Camera permission denied                                 | Explainer + Type code option                             | C, M |
| EC-052 | No BarcodeDetector (iOS Safari)                          | ZXing fallback loads                                     | P    |
| EC-053 | Low light / crumpled QR                                  | Manual entry fallback                                    | M    |
| EC-054 | Scanner app opens link in in-app browser without session | "Open in Chrome" hint + login path                       | M    |
| EC-055 | New app version deployed mid-session                     | Banner; update only after current action                 | C    |
| EC-056 | Two tabs open                                            | Session sync; only one Confirm per key                   | C    |
| EC-057 | Phone clock wrong                                        | Server time used everywhere                              | D    |
| EC-058 | Very small screen (320 px)                               | No horizontal scroll                                     | P    |
| EC-059 | 200% text size                                           | Layout intact                                            | P, M |

### 21.4 Painter WhatsApp confirmation

| ID     | Case                                          | Expected                                                    | Test    |
| ------ | --------------------------------------------- | ----------------------------------------------------------- | ------- |
| EC-070 | Message exactly as prefilled                  | CONFIRMED, reply sent                                       | D, E, P |
| EC-071 | Lowercase / extra words / emojis around token | Parsed, CONFIRMED                                           | U, D    |
| EC-072 | Devanagari digits in message                  | Normalised                                                  | U       |
| EC-073 | Message at 9:59 vs 10:01                      | CONFIRMED vs LATE                                           | D       |
| EC-074 | Message after 24 h                            | EXPIRED reply                                               | D       |
| EC-075 | Same painter sends twice                      | "Already confirmed"                                         | D       |
| EC-076 | Different number sends a used token           | TOKEN_USED, flags                                           | D       |
| EC-077 | Unknown token                                 | Help reply; counts toward brake                             | D       |
| EC-078 | 5 bad tokens in 1 hour                        | Messages ignored for 1 hour                                 | D       |
| EC-079 | Painter number = same dealer's staff          | SELF_CONFIRM, coupons on hold                               | D       |
| EC-080 | Painter number = another dealer/distributor   | STAFF_NUMBER flag                                           | D       |
| EC-081 | Same number at 3 dealers in 7 days            | MULTI_DEALER flag                                           | D       |
| EC-082 | Non-Indian number                             | NON_INDIAN flag                                             | D       |
| EC-083 | Voice note / image / sticker / location       | Help reply                                                  | E, D    |
| EC-084 | Webhook delivered twice (Meta retry)          | Processed once (wamid unique)                               | D, E, K |
| EC-085 | Webhook with bad signature                    | 401, logged, nothing processed                              | E       |
| EC-086 | Webhook GET verification wrong token          | 403                                                         | E       |
| EC-087 | Status events (delivered/read)                | Ignored                                                     | E       |
| EC-088 | Message timestamp far in future/past          | Clamped                                                     | D       |
| EC-089 | Reply send fails (rate limit/5xx)             | Retried with backoff                                        | E       |
| EC-090 | Reply still failing near 24 h window          | EXPIRED_WINDOW, never paid                                  | D, E    |
| EC-091 | Webhook endpoint down for hours               | Meta retries; late messages evaluated by message time       | E, M    |
| EC-092 | Painter replies NO within 24 h                | DISPUTED, coupons on hold, top of review                    | D, P    |
| EC-093 | Painter replies NO after 24 h                 | Support note, no auto-hold                                  | D       |
| EC-094 | Painter sends STOP                            | Number anonymised; history keeps masked number              | D       |
| EC-095 | Painter with no WhatsApp                      | Dealer taps "No WhatsApp" → SKIPPED with reason             | D, C    |
| EC-096 | Dealer closes receipt before painter scans    | "Show painter QR" from history within 24 h                  | C       |
| EC-097 | Token collision with an open token            | New token generated                                         | D       |
| EC-098 | Business number banned/restricted by Meta     | Monitoring alert; redemptions continue; confirmations pause | M       |
| EC-099 | Painter forwards message from another phone   | Sender's number recorded; flags apply                       | D       |

### 21.5 Claims and settlement

| ID     | Case                                                     | Expected                               | Test |
| ------ | -------------------------------------------------------- | -------------------------------------- | ---- |
| EC-110 | Two redemptions create open claim at once                | One OPEN claim (unique index)          | D, K |
| EC-111 | Claim submitted with zero lines                          | Not allowed / skipped by cron          | D    |
| EC-112 | Distributor closes with duplicate CN number              | Refused                                | D    |
| EC-113 | CN date in future or before submission                   | Refused                                | D    |
| EC-114 | Distributor tries another distributor's claim            | FORBIDDEN                              | D    |
| EC-115 | Held line at close                                       | Moves to next claim when released      | D    |
| EC-116 | Dispute raised after distributor approval but before 24M | Line held at 24M                       | D    |
| EC-117 | 24M maker = checker                                      | Refused (DB check)                     | D    |
| EC-118 | 24M rejects after dealer credited                        | M24_REJECTED, note for recovery        | D    |
| EC-119 | Claim windows at exact boundary days                     | Inclusive rules tested                 | D    |
| EC-120 | Dealer never acknowledges CN                             | Appears in weekly review after 15 days | D    |
| EC-121 | Cron runs twice                                          | Idempotent                             | D    |

### 21.6 Masters, users, admin

| ID     | Case                                                       | Expected                                              | Test |
| ------ | ---------------------------------------------------------- | ----------------------------------------------------- | ---- |
| EC-130 | Bulk upload with bad rows                                  | Dry-run report; nothing committed until clean         | E    |
| EC-131 | Duplicate dealer mobile                                    | Refused with reason                                   | D, E |
| EC-132 | Dealer moved to new distributor                            | History row; new redemptions route to new distributor | D    |
| EC-133 | User deactivated while logged in                           | Next call FORBIDDEN                                   | D, P |
| EC-134 | Magic link used twice                                      | Second use fails; "Request new link"                  | P    |
| EC-135 | Magic link expired                                         | Same                                                  | P    |
| EC-136 | Distributor creates login for another distributor's dealer | FORBIDDEN                                             | E    |
| EC-137 | 24M user without 2FA                                       | 24M functions refuse until enrolled                   | D, P |

### 21.7 Security and abuse

| ID     | Case                                              | Expected                                    | Test |
| ------ | ------------------------------------------------- | ------------------------------------------- | ---- |
| EC-150 | Anon key used to read tables                      | 0 rows                                      | D    |
| EC-151 | Dealer reads another dealer's coupons             | 0 rows                                      | D    |
| EC-152 | Direct table insert/update via API                | Denied                                      | D    |
| EC-153 | Brute-force public coupon page                    | Per-IP limit; Cloudflare rate rule          | D, M |
| EC-154 | SQL injection strings in inputs                   | Parameterised; treated as data              | D, E |
| EC-155 | XSS in names/notes                                | Escaped by React; CSP blocks inline scripts | C, M |
| EC-156 | Oversized webhook body                            | Rejected                                    | E    |
| EC-157 | Service key leaked in bundle                      | gitleaks + build check fails                | CI   |
| EC-158 | Update/delete on audit tables (even service role) | Exception                                   | D    |

---

## 22. Weekly review and reconciliation

30-minute weekly routine for the 24M admin (logged with date and reviewer):

| View                         | Looks for                                                      |
| ---------------------------- | -------------------------------------------------------------- |
| `v_disputes`                 | Painter "NO" replies and self-confirm holds (resolve first)    |
| `v_dealer_confirmation_rate` | Dealers below 60% painter confirmation (≥ 20 coupons, 30 days) |
| `v_painter_flags`            | MULTI_DEALER, HIGH_VOLUME, STAFF_NUMBER, NON_INDIAN            |
| `v_invalid_scans`            | Users/IPs with many not-found or not-active scans              |
| `v_duplicate_attempts`       | Coupons scanned by a second dealer                             |
| `v_dealer_velocity`          | Unusual weekly volume vs dealer's usual                        |
| `v_claim_ageing`             | Claims open > 15 days; unsettled 24M claims                    |
| `v_unacked_cn`               | Dealer CNs without "Received ✓" after 15 days                  |
| `v_wa_health`                | Outbox failures, webhook errors, last inbound time             |

Reconciliation (per distributor, per month, count and ₹), asserted nightly:

```text
Redeemed = Distributor approved + Distributor rejected + Pending/held
Distributor approved = Claimed to 24M + Not yet claimed
Claimed to 24M = Settled + 24M rejected + Pending at 24M
Painter: Redeemed batches = Confirmed + Late + Disputed + Skipped + Expired + Pending
```

---

## 23. Scheduled jobs (pg_cron)

| Job                         | Schedule (IST)   | Action                                                      |
| --------------------------- | ---------------- | ----------------------------------------------------------- |
| Claim cut-off               | 00:05 on the 1st | OPEN dealer claims → SUBMITTED                              |
| Coupon expiry               | Daily 01:00      | ACTIVE past `expires_at` → EXPIRED                          |
| Painter-token expiry        | Every 15 min     | PENDING past `expires_at` → EXPIRED                         |
| WhatsApp retry              | Every minute     | `pg_net` call to `wa-sender`                                |
| Reconciliation              | Daily 02:00      | Assert identities → `recon_issue`                           |
| Clean-up                    | Weekly           | Idempotency rows > 7 days; scan attempts > 3 years archived |
| Keep-alive (Free plan only) | Daily            | UptimeRobot ping to a health function                       |

All jobs are idempotent and have pgTAP tests.

---

## 24. Environments, deployment and release

| Environment | Database                                                     | Web                   | WhatsApp             | Cost          |
| ----------- | ------------------------------------------------------------ | --------------------- | -------------------- | ------------- |
| Local       | Supabase CLI (Docker)                                        | Vite dev              | Fixtures             | ₹0            |
| Staging     | Supabase **Free** project                                    | Cloudflare preview    | Meta **test number** | ₹0            |
| Pilot       | Supabase **Free** project + daily pg_dump to R2 + keep-alive | Cloudflare production | Business number      | ₹0            |
| Production  | Supabase **Pro** (Mumbai), spend cap ON                      | Cloudflare production | Business number      | ≈ ₹2–3k/month |

- **Upgrade to Pro before rollout beyond the pilot distributor** (or earlier if the pilot exceeds ~50,000 coupons): Pro adds daily backups, no pausing, 8 GB storage.
- **Migrations only** change the schema; applied staging → production by CI with manual approval. Every migration has a tested down-path or a documented forward fix.
- **Release:** tag → CI release jobs (load, security) → production deploy → smoke test (scripted: check, redeem test coupon in a test lot, webhook ping) → monitor 30 minutes.
- **Rollback:** Cloudflare Pages instant rollback for the web app; database changes are additive (expand → migrate → contract) so the previous app version keeps working.
- **Feature flags** in `app_config` (e.g., `painter_confirmation_enabled`, `strict_painter_mode`) allow switching behaviour without deploys.

---

## 25. Observability and alerting

| Signal                   | Source                              | Alert (to 24M ops WhatsApp/email)            |
| ------------------------ | ----------------------------------- | -------------------------------------------- |
| Site down                | UptimeRobot (web + health function) | 2 consecutive failures                       |
| Front-end errors         | Sentry                              | New issue or > 1% sessions with errors       |
| Web vitals               | Sentry                              | INP or LCP p75 beyond budget for 24 h        |
| Slow queries             | `pg_stat_statements` weekly review  | > 100 ms p95                                 |
| WhatsApp inbound silence | `v_wa_health`                       | No inbound for 24 h while redemptions happen |
| WhatsApp outbox failures | `v_wa_health`                       | > 5 FAILED in 1 h                            |
| Reconciliation mismatch  | `recon_issue`                       | Any row                                      |
| Backup job               | GitHub Actions                      | Failure                                      |
| Free-plan limits (pilot) | Supabase usage page                 | > 70% of DB size                             |

---

## 26. Operations SOPs

1. **Onboard dealer:** add → Send login link on WhatsApp → dealer taps → done.
2. **New phone / logged out:** dealer taps "Request new link" → distributor resends.
3. **Staff left:** owner removes → access stops immediately.
4. **Painter dispute ("NO"):** coupons auto-held → call painter and dealer within 2 working days → release, or reject and block dealer.
5. **Self-confirm hold:** call dealer; if confirmed fraud → block dealer and reject coupons.
6. **Damaged coupon:** 24M looks up by serial → redeem on dealer's behalf with reason, or reject.
7. **WhatsApp number issue:** check Meta account health; redemptions continue; confirmations resume when fixed (late messages are still processed by message time).
8. **Block/recall:** block serial range.
9. **Month-end:** 1st cut-off → by 10th distributors close → by 15th claims to 24M → by 25th 24M settles.
10. **Weekly review** every Monday (§22). **Quarterly:** restore drill, key rotation, admin-log review.

---

## 27. Build plan, milestones and Definition of Done

### 27.1 Timeline (1 senior freelance developer, full time)

| Week  | Work                                                                                                                                               | Milestone / acceptance                                                                                 | Payment           |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------- |
| 0     | Decisions (§29); business-owned accounts; **Meta business verification + WhatsApp number**; master data; print trial of 200 codes                  | Accounts ready; Meta verification submitted                                                            | —                 |
| 1     | Monorepo, CI with all gates, lint/type/test configs, design tokens, component skeletons                                                            | **M0:** CI green on an empty app with every gate active                                                | 10%               |
| 2–3   | Schema, RLS, `assert_role`, codes, lots, print export, activation, lookup, 24M login + TOTP; pgTAP meta-test                                       | **M1:** lot generated → exported → activated; anon test passes; 100% function/policy test coverage     | 15%               |
| 4–5   | Login links, dealer app (check, redeem, bulk, type code, receipt, history, staff), service worker, network algorithm (§18.4); usability round 1    | **M2:** 1-tap redemption; same-code race test passes; network profiles 4G/3G pass                      | 20%               |
| 6     | **WhatsApp:** webhook, parser, `wa_handle_inbound`, outbox/sender, receipt QR + live status, disputes, STOP, flags                                 | **M3:** painter confirms from a real phone in staging; duplicate-webhook and bad-signature tests pass  | 15%               |
| 7–8   | Distributor stage, claim cycle, slips, claim to 24M, 24M maker/checker, CSV export, weekly review views, reconciliation                            | **M4:** coupon ACTIVE → SETTLED with painter confirmation; recon identities hold                       | 15%               |
| 9     | Hardening: a11y audit fixes, Lighthouse/size budgets, 2G/flaky profiles, k6 load, security review fixes, copy review (EN/HI/MR); usability round 2 | All per-PR, nightly and release gates green; 0 axe violations; security review clean                   | —                 |
| 10–13 | **Pilot** (Free plan): 1 distributor, 10–20 dealers, painters on WhatsApp, one full monthly cycle                                                  | **M5:** 0 duplicate payouts; ≥ 95% redemptions ≤ 2 taps; ≥ 70% painter confirmation; one cycle settled | 25% (holdback)    |
| 14–15 | Upgrade to Pro, onboarding material, rollout plan                                                                                                  | —                                                                                                      | —                 |
| 16+   | Rollout in waves                                                                                                                                   | —                                                                                                      | Support as agreed |

### 27.2 Definition of Done (every story)

- Code merged with all CI gates green (lint 0 warnings, types, coverage thresholds, e2e, axe, budgets).
- New edge cases added to §21 with tests.
- UI copy present in English, Hindi and Marathi; screenshots in PR.
- Accessibility checklist ticked (keyboard, focus, labels, announcements, contrast).
- Works on 3G profile; no new request on the dealer critical path without a budget check.
- Database change via migration with pgTAP tests; RLS reviewed.
- Logs contain no personal data; errors reported to Sentry.
- Docs/runbook updated if behaviour or operations changed.

### 27.3 Handover (part of M5)

README (architecture, setup, deploy, restore, rotate keys), ADRs, runbooks for §26, all secrets documented by name (not value) with owner, test suite runnable with `pnpm test:all`, recorded walkthrough video.

---

## 28. Budget

### 28.1 One-time

| Item                                                           | Cost           |
| -------------------------------------------------------------- | -------------- |
| Development: senior freelancer ≈ 9 weeks build + pilot support | ₹3.6–5.8 L     |
| UI/UX + accessibility review (≈ 5 days)                        | ₹25–50k        |
| Security review (freelance tester)                             | ₹25–40k        |
| WhatsApp setup (new SIM, Meta verification)                    | under ₹1k      |
| Setup (subdomain, accounts)                                    | under ₹5k      |
| Training material (Canva card, phone-shot video)               | ₹0–10k         |
| **Total**                                                      | **≈ ₹4–6.5 L** |

### 28.2 Running

| Item                                               | Pilot     | Production           |
| -------------------------------------------------- | --------- | -------------------- |
| Supabase                                           | ₹0 (Free) | ≈ ₹2,100/month (Pro) |
| Cloudflare, R2, GitHub, Sentry, UptimeRobot        | ₹0        | ₹0                   |
| WhatsApp (painter-started chats + replies in 24 h) | ₹0        | ₹0                   |
| **Total**                                          | **₹0**    | **≈ ₹2–3k/month**    |
| Optional on-call developer                         | —         | ₹5–10k/month         |

---

## 29. Decisions needed before week 1

| #   | Decision                           | Recommendation                                                         |
| --- | ---------------------------------- | ---------------------------------------------------------------------- |
| D1  | Coupon validity                    | 18 months from mfg date                                                |
| D2  | Cross-territory redemptions        | Allow; redeeming dealer's distributor pays                             |
| D3  | Claim cycle                        | Monthly, auto-submit on the 1st                                        |
| D4  | Claim windows                      | 90 days (distributor), 60 days (24M)                                   |
| D5  | Who creates dealer logins          | Distributors for own dealers; 24M for anyone                           |
| D6  | Physical coupons                   | Dealer keeps; spot-checks on request; destroy 90 days after settlement |
| D7  | Reversal authority                 | 24M admin only, before distributor close                               |
| D8  | QR subdomain                       | `c.<domain>`                                                           |
| D9  | Maker and checker                  | Two named 24M people                                                   |
| D10 | Painter confirmation strictness    | **Not mandatory** at launch (flag only); revisit after pilot data      |
| D11 | Painter windows                    | On time 10 min, late up to 24 h                                        |
| D12 | Dispute handling SLA               | Contact within 2 working days                                          |
| D13 | WhatsApp display name and helpline | "24M Painter Rewards" + helpline number                                |
| D14 | Languages                          | English, Hindi, Marathi (native-speaker review)                        |
| D15 | Upgrade to Supabase Pro            | Before rollout beyond the pilot distributor                            |

---

## 30. Risks

| Risk                             | Mitigation                                                                                                                             |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Meta verification delay          | Start in week 0; staging uses Meta test number; redemption doesn't depend on WhatsApp                                                  |
| Meta pricing or policy change    | Design never sends business-initiated messages; confirmations can be switched off by flag; Option 1 (confirm page) is a 2-day fallback |
| Dealer uses a friend's number    | Flags (MULTI_DEALER, STAFF_NUMBER), confirmation-rate review, random call-backs                                                        |
| Painters don't bother confirming | Dealer prompt + simple one-tap message; confirmation rate tracked per dealer; consider small painter incentive later                   |
| Single developer                 | Business-owned accounts, ADRs, high test coverage, handover video                                                                      |
| Free plan limits during pilot    | Usage alerts at 70%; daily backups to R2; upgrade trigger defined                                                                      |
| Supabase misconfiguration        | CI checks for RLS, anon test, meta-test; security review                                                                               |
| Poor networks at shops           | Cached app shell, tiny payloads, tested 2G/flaky profiles, unknown-outcome handling                                                    |
| Low digital literacy             | Usability rounds, icons + words, native-language copy, 1-tap flows                                                                     |

---

## 31. Upgrade path (pay only when needed)

| Trigger                             | Upgrade                                             | Added cost          |
| ----------------------------------- | --------------------------------------------------- | ------------------- |
| Pilot complete or > 50,000 coupons  | Supabase Pro                                        | ≈ ₹2k/month         |
| Painters without WhatsApp > 10%     | Add Option 1 confirm page as fallback               | ≈ 2 days dev        |
| Frequent fraud despite confirmation | Painter OTP (paid) or strict mode                   | ≈ ₹0.15–0.25/coupon |
| Manual link sharing burdensome      | Automated WhatsApp login links (business-initiated) | ≈ ₹0.12/message     |
| Weekly review finds many issues     | Automatic alert rules                               | 1–2 weeks dev       |
| > 20 lakh coupons/year              | Larger Supabase compute + storage                   | ≈ ₹1–3k/month       |

---

## 32. Appendices

### Appendix A: Copy deck (dealer, core strings)

Native-speaker review required before pilot.

| Key                    | English                                      | Hindi                                                      | Marathi                                                |
| ---------------------- | -------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| `result.valid`         | Valid coupon · ₹100                          | मान्य कूपन · ₹100                                          | वैध कूपन · ₹100                                        |
| `action.confirm`       | ₹100 paid – Confirm                          | ₹100 दिए – पुष्टि करें                                     | ₹100 दिले – पुष्टी करा                                 |
| `result.redeemed`      | Redeemed ✓                                   | रिडीम हो गया ✓                                             | रिडीम झाले ✓                                           |
| `result.already_self`  | Already redeemed by you on {date}            | आपने {date} को पहले ही रिडीम किया है                       | तुम्ही {date} रोजी आधीच रिडीम केले आहे                 |
| `result.already_other` | Already used at another shop. Do NOT pay.    | यह कूपन दूसरी दुकान पर इस्तेमाल हो चुका है। भुगतान न करें। | हे कूपन दुसऱ्या दुकानात वापरले गेले आहे. पैसे देऊ नका. |
| `result.not_found`     | Coupon not recognised. Do NOT pay.           | कूपन पहचाना नहीं गया। भुगतान न करें।                       | कूपन ओळखले गेले नाही. पैसे देऊ नका.                    |
| `result.not_active`    | Coupon not active yet. Do NOT pay. Call 24M. | कूपन अभी चालू नहीं है। भुगतान न करें। 24M को कॉल करें।     | कूपन अजून सुरू नाही. पैसे देऊ नका. 24M ला कॉल करा.     |
| `result.blocked`       | Coupon blocked. Do NOT pay.                  | कूपन ब्लॉक है। भुगतान न करें।                              | कूपन ब्लॉक आहे. पैसे देऊ नका.                          |
| `result.expired`       | Coupon expired on {date}.                    | कूपन {date} को समाप्त हो गया।                              | कूपनची मुदत {date} रोजी संपली.                         |
| `state.checking`       | Checking… don't pay yet                      | जाँच हो रही है… अभी भुगतान न करें                          | तपासणी सुरू आहे… आत्ता पैसे देऊ नका                    |
| `state.offline`        | No internet. Don't pay yet.                  | इंटरनेट नहीं है। अभी भुगतान न करें।                        | इंटरनेट नाही. आत्ता पैसे देऊ नका.                      |
| `painter.scan`         | Painter: scan to confirm on WhatsApp         | पेंटर: WhatsApp पर पुष्टि के लिए स्कैन करें                | पेंटर: WhatsApp वर पुष्टी करण्यासाठी स्कॅन करा         |
| `painter.waiting`      | Waiting for painter…                         | पेंटर का इंतज़ार…                                          | पेंटरची वाट पाहत आहे…                                  |
| `painter.confirmed`    | Painter confirmed ✓                          | पेंटर ने पुष्टि की ✓                                       | पेंटरने पुष्टी केली ✓                                  |
| `painter.no_whatsapp`  | Painter has no WhatsApp                      | पेंटर के पास WhatsApp नहीं है                              | पेंटरकडे WhatsApp नाही                                 |

### Appendix B: WhatsApp replies (free-form, inside the 24-hour window)

| Key                                 | English (Hindi/Marathi versions sent based on painter's last language choice; default Hindi + English)                |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `CONFIRMED`                         | ✅ Thank you! ₹100 from {dealer} is confirmed (coupon {serial}). If you did NOT receive the money, reply NO.          |
| `CONFIRMED` (batch)                 | ✅ Thank you! ₹{amount} for {count} coupons from {dealer} is confirmed. If you did NOT receive the money, reply NO.   |
| `ALREADY_CONFIRMED`                 | You have already confirmed this payment. Thank you!                                                                   |
| `TOKEN_USED`                        | This code was already used. If this is a mistake, call {helpline}.                                                    |
| `UNKNOWN_TOKEN`                     | We couldn't find this code. Please scan the QR on the dealer's phone again.                                           |
| `EXPIRED`                           | This code has expired. Please ask the dealer to show a new QR, or call {helpline}.                                    |
| `DISPUTE_RECORDED`                  | Sorry about this. We have recorded that you did not receive the money. 24M will call you within 2 working days.       |
| `HELP`                              | This number confirms 24M painter coupon payments. Scan the QR on your dealer's phone and press Send. Help: {helpline} |
| `PRIVACY` (first contact, appended) | We use your number only to confirm coupon payments, for 3 years. Privacy: {url}. Reply STOP to remove your number.    |
| `STOPPED`                           | Your number has been removed. Thank you.                                                                              |

### Appendix C: Configuration keys (`app_config`)

```json
{
  "coupon_validity_months": 18,
  "claim_cycle": "MONTHLY",
  "dealer_claim_window_days": 90,
  "dist_claim_window_days": 60,
  "redeem_batch_max": 50,
  "invalid_scan_brake": { "count": 5, "minutes": 10 },
  "public_lookup_limit": { "count": 30, "minutes": 10 },
  "painter_confirmation_enabled": true,
  "strict_painter_mode": false,
  "painter_on_time_minutes": 10,
  "painter_token_ttl_hours": 24,
  "painter_flags": {
    "multi_dealer": { "dealers": 3, "days": 7 },
    "high_volume": { "batches": 10, "hours": 24 }
  },
  "painter_bad_token_brake": { "count": 5, "minutes": 60 },
  "dealer_confirmation_rate_alert": { "below_pct": 60, "min_coupons": 20, "days": 30 },
  "dispute_window_hours": 24,
  "wa_sender_backoff_seconds": [30, 120, 600, 1800, 7200],
  "wa_sender_max_attempts": 6
}
```

### Appendix D: Glossary

- **CN:** Credit Note. **Dealer claim:** coupons redeemed by one dealer in a cycle. **Distributor claim:** dealer-credited coupons claimed from 24M.
- **Redemption batch:** one Confirm action (1–50 coupons) with one painter token.
- **Painter token:** 6-character code the painter sends on WhatsApp to confirm payment.
- **Customer-service window:** 24 hours after a user's WhatsApp message during which the business can reply free.
- **RLS:** Row Level Security, the database rules that decide which rows each user can see.
- **Idempotency key:** a unique ID per Confirm tap that makes retries safe.
- **Maker/checker:** two different people validate and settle a 24M claim.
