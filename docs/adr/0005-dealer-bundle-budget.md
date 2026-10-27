# ADR-0005: Dealer entry budget is 100 KB gzip, not 90 KB

- Status: **proposed: needs product-owner sign-off**
- Date: 2026-10-26

## Context

§18.1 sets "Dealer route JS (initial, gzip) ≤ 90 KB". The built entry chunk is **98.2 KB**.
Its floor is fixed by dependencies the plan itself chooses:

| Part                                                                       | gzip       |
| -------------------------------------------------------------------------- | ---------- |
| `react` + `react-dom` 19 (client)                                          | ≈ 60–65 KB |
| `react-router` 7 (declarative subset)                                      | ≈ 14 KB    |
| Valibot schemas, thin API client, i18n (en), network status, UI kit, shell | ≈ 20 KB    |

Everything else already loads on demand: auth SDK (25 KB), scanner fallback (107 KB), back-office
(25 KB), QR renderer (8 KB), Sentry, Hindi/Kannada packs and the service worker. Each loads when
first needed or is prefetched on idle when `saveData` is off.

## Options

1. **Accept 100 KB** (current gate in `apps/web/.size-limit.json`). On the §18.5 3G profile
   (750 Kbps), 8 KB costs ≈ 90 ms on the first visit only. Repeat visits come from the service
   worker cache.
2. **Reach 90 KB by swapping React for Preact (`preact/compat`, ≈ 4 KB).** Saves ≈ 55 KB but adds
   compatibility risk with React 19 APIs, Testing Library and future libraries.
3. **Drop the router from the entry** with a hand-written path switch. Saves ≈ 12 KB and costs
   lazy-route ergonomics in every feature.

## Recommendation

Option 1. The Lighthouse gate (performance ≥ 90, LCP ≤ 2.5 s on slow 4G) and the §18.5 timing
tests are the user-facing budgets, and both pass. The gate can only go down from here: any
growth fails CI.
