# B16.0.14 — Changed files

## New

- `app/lib/pcb/footprint-search-service.ts` — the shared, Request-free hybrid
  footprint-search service (algorithm lifted verbatim from the public route).
- `app/api/__tests__/b16-0-14-tranche-parity.test.ts` — 14 behavioral pins
  (pre = post) for both routes.
- `app/lib/auth/__tests__/b16-0-14-selector-envelope-gate.test.ts` — 13 wrapper
  runtime proofs + structural tripwires.

## Wrapper module

- `app/lib/auth/route-handlers.ts` — added `selectorEnvelopeJsonRoute`
  (+ its options/input types + declarative legacy refusal contract) and the
  three imports it composes (`policyFor`, `requireSameOrigin`+`forbidden`,
  `resolveTrustedRequestContext`).

## Migrated routes

- `app/api/pcb/apply-authorization/route.ts` — → `selectorEnvelopeJsonRoute`
  (64 KB/10 s); raw POST handler + `authorizeRequest`/`readBoundedJsonBody`/
  `requireSameOrigin`/`new URL` removed; snapshot builder unchanged.
- `app/api/pcb/assign/suggest/route.ts` — → `authenticatedJsonRoute`
  (16 MB/45 s); `const origin = new URL(req.url).origin` + `fetch(...)` removed;
  `runSearch` now calls `searchFootprints(...)`. Prompt/tools/validator unchanged.
- `app/api/pcb/footprints/search/route.ts` — inline algorithm replaced by a
  `searchFootprints(...)` call; `publicRoute({ query: true })`, validation, and
  error mapping unchanged.

## Analyzer / ratchet / gate

- `app/lib/auth/__tests__/_boundary-analysis.ts` — `selectorEnvelopeJsonRoute`
  added to `APPROVED_ROUTE_WRAPPERS`.
- `app/lib/auth/__tests__/b16-0-8-migration-ratchet.test.ts` — `TRANCHE_7`
  pins; `BASELINE_MAX` 84→82; `MIGRATED_FLOOR` 69→71.
- `app/lib/auth/__tests__/b16-0-2-gates.test.ts` — §C recognized-authority
  regex now includes `selectorEnvelopeJsonRoute` (a real canonical bounded
  authority).

## Regenerated through sanctioned generators only

- `_raw-route-baseline.json` — 84→82 (2 removed, 0 added).
- wrapper + b16-0-4 matrices ×2, byte-stable; tranche manifest extracted here.

## Explicitly NOT changed

`app/lib/llm/*`, `app/lib/prompts.ts`, the approval controller / apply-
reauthorization protocol, `resolveTrustedRequestContext`, the excluded
`/api/pcb/qualify` and `/api/pcb/release`, provider config, tool exposure,
replay pins, hashes. `C:\Users\robsa\sirkit` untouched.
