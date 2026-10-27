# ADR-0001: Stack as planned, with recorded deviations

- Status: accepted
- Date: 2026-10-26

## Context

The plan (§3.1) fixes the stack: React 19 + Vite PWA on Cloudflare Pages, Supabase Postgres with
all rules in PL/pgSQL functions, Deno Edge Functions for privileged and webhook work, pnpm
workspaces, GitHub Actions. While building it, a few details had to change. Each is recorded
here so reviewers can find the reason.

## Decision

Keep the planned stack. Accept these deviations:

| Plan                                       | Built                                                           | Why                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------ | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| React Router 7 data mode                   | Declarative `<BrowserRouter>` + `lazy()` routes                 | Data mode pulled ≈ 14 KB more into the dealer entry chunk; loaders weren't needed because each dealer screen makes exactly one call (§18.2 rule 4).                                                                                                                                                                          |
| `db` job runs `supabase start`             | Plain PostgreSQL 17 + `supabase/test-support/shim.sql`          | The shim provides the Supabase parts the migrations rely on (`anon`/`authenticated`/`service_role`, `auth.uid()`/`auth.jwt()`, default grants in `public`). It runs in seconds with no Docker, and the same script runs locally and in CI. The real Supabase stack is still exercised by staging deploys and the smoke test. |
| "Supabase type drift" check in `typecheck` | Valibot schemas for every RPC response, no generated types      | The web client only calls RPCs. Their JSON shapes are validated at runtime (`apps/web/src/lib/api/schemas.ts`), so generated table types would describe tables the client never reads.                                                                                                                                       |
| `@zxing/browser` latest                    | `@zxing/browser` 0.1.5 + `@zxing/library` 0.21.3                | Newer `@zxing/library` 0.2x requires Node 24; the repo targets Node 22 LTS.                                                                                                                                                                                                                                                  |
| Supabase in Mumbai (`ap-south-1`)          | Project created in Tokyo (`ap-northeast-1`)                     | The project already existed. **Move to Mumbai before the pilot**: it means about 60 ms less RTT from India, and DPDP data-residency expectations apply (§6.9). Region cannot be changed in place. Create a Mumbai project and re-run the migrations.                                                                         |
| Playwright WebKit for iPhone 13 locally    | Chromium locally, all three engines in CI (`E2E_ALL_ENGINES=1`) | The dev container ships only Chromium. CDP network profiles run on Chromium only, because WebKit and Firefox have no CDP throttling.                                                                                                                                                                                         |
| Languages English, Hindi, Marathi (§16.6)  | English, Hindi, **Kannada**                                     | Product decision after the plan: Kannada replaces Marathi in the app and in painter WhatsApp replies (migration 0014). The WhatsApp parser still recognises `NO`, `STOP` and the existing Hindi dispute phrases; Kannada painters are told to reply `NO` in Latin letters.                                                   |

## Consequences

- Every deviation is reversible without a schema change.
- The Mumbai move is the only one with an operational deadline: before real painter data arrives.
