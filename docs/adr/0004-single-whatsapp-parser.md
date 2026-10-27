# ADR-0004: One WhatsApp parser, in TypeScript

- Status: accepted
- Date: 2026-10-26

## Context

The plan places the message grammar in `packages/shared` (§6.4) and outlines `wa_handle_inbound`
in SQL (§13.2). A second parser in PL/pgSQL would have to match the TS one exactly: token
rule, keyword lists in three languages, emoji handling. Two parsers drift.

## Decision

- `parseWaMessage()` in `packages/shared` is the only parser. `scripts/sync-shared.mjs` copies it
  into `supabase/functions/_shared/lib/` for Deno, and CI fails if the copy drifts.
- `wa-webhook` verifies the Meta signature, parses each message, and calls
  `wa_handle_inbound(wamid, from, body, type, msg_ts, intent, token)` with the result.
- SQL owns every state change and rule: deduplication by `wamid`, windows, self-confirm hold,
  disputes, STOP and the bad-token brake. It treats `intent`/`token` as untrusted input and
  validates the token format again.

## Consequences

- The parser is property-tested once, at 100% coverage, and the same code runs in production.
- A database-only replay of raw messages must go through the Edge Function (or call the parser),
  because SQL alone cannot classify free text. That is acceptable: replays are an ops tool.
