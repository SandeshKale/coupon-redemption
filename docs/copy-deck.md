# Copy deck

The copy deck from Appendix A (dealer strings) and Appendix B (WhatsApp replies) is implemented
in code, so it cannot drift from what users see:

| Content                      | Source of truth                                                                          | Tested by                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| App strings, English         | `apps/web/src/lib/i18n/en.ts` (the dictionary type: other languages must have every key) | `tsc` (missing key = type error), `i18n.test.tsx`                  |
| App strings, Hindi / Marathi | `apps/web/src/lib/i18n/hi.ts`, `mr.ts`                                                   | same                                                               |
| Result-code copy             | `apps/web/src/features/dealer/resultCopy.ts` → dictionary keys                           | `dealer.test.tsx`, every code in three languages                   |
| WhatsApp replies             | `wa_template` rows (migration 0008), per language                                        | `supabase/tests/020_painter_wa.test.sql`, `021_wa_outbox.test.sql` |

## Native-speaker review: required before the pilot

The Hindi and Marathi strings were drafted by the developer and have **not** been reviewed by
native speakers. Before the pilot (§27.1 week 9 "copy review EN/HI/MR"):

1. Give the reviewer `hi.ts` / `mr.ts` next to `en.ts`. Each is a flat key → string map in the
   same order as `en.ts`.
2. The reviewer checks the money-safety strings first: every "Do NOT pay" and "Checking result…
   don't pay again" variant must be unambiguous.
3. Changes go through a normal PR. Copy-only PRs still run the full CI.

## Content rules (§16.6)

- The result comes first, in the first five words ("Valid. Pay ₹100.", "Do NOT pay.").
- ₹ amounts use `en-IN` grouping (₹1,00,000), never decimals for whole rupees.
- No blame: "This code was already used on 12 Oct", not "You entered a used code".
- Buttons are verbs ("Confirm payment", "Scan next").
