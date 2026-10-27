# ADR-0003: Painter tokens must contain a real digit

- Status: accepted
- Date: 2026-10-26

## Context

Painters reply on WhatsApp with free text such as `24M PAID K7Q2M9`, `ok bhaiya k7q2m9 👍` or
`THANKS`. The parser (§6.4) must find a 6-character Crockford token anywhere in the message.
Crockford input mapping turns `I`/`L` into `1` and `O` into `0`. Without a constraint, ordinary
6-letter words would parse as tokens: `THANKS`, `BHAIYA` (`I` → `1`) and `DELETE` (`L` → `1`).
Each false match would produce a `BAD_TOKEN` reply and count towards the bad-token brake.

## Decision

- Generated tokens (`public.gen_token6()`) always contain at least one digit `0–9`.
- The parser accepts a candidate word only if its **raw** text (before look-alike mapping)
  already contains a digit. `BHAIYA` is rejected; `K7Q2M9` and `k7q2m9` are accepted.

## Consequences

- The token space drops from 32⁶ to 32⁶ − 22⁶ ≈ 9.6 × 10⁸, which is still far beyond the
  number of live tokens.
- A painter who types `O` for `0` in a token with no other digit is not matched. The reply asks
  them to send the code exactly as shown. This is rare because the QR pre-fills the message.
- Tested in `packages/shared/src/token.test.ts` and `supabase/tests/004_codes.test.sql`.
