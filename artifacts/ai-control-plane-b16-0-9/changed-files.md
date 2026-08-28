# B16.0.9 — Changed files

## Production — the 17 migrated route files (uniform transformation)

Each replaced the handwritten `authorizeRequest → kind-guard →
readBoundedJsonObject(8_000_000 / 30_000)` boilerplate with
`export const POST = authenticatedJsonRoute({ maxBytes: 8_000_000, deadlineMs:
30_000 }, async ({ context, body: rawBody }) => …)`; business logic verbatim;
`authorizeRequest`/bounded-json imports removed:

- `app/api/architecture/{alternatives,candidates,compare,problem,propose}/route.ts`
- `app/api/power/{alternatives,candidates,compare,problem,propose,reconcile}/route.ts`
- `app/api/interfaces/{allocate,alternatives,candidates,compare,problem,propose}/route.ts`

No wrapper module changes were needed — `authenticatedJsonRoute` expressed
every historical contract (no new variant introduced).

## Ratchet / gates / tests

| File | Change |
|---|---|
| `app/lib/auth/__tests__/_raw-route-baseline.json` | regenerated via the sanctioned generator: 138 → 121 (removals only) |
| `app/lib/auth/__tests__/b16-0-8-migration-ratchet.test.ts` | pins BASELINE_MAX 138→121, MIGRATED_FLOOR 15→32; `TRANCHE_2` (17 exact methods) added to the revert gate |
| `app/lib/auth/__tests__/b16-0-7-wrapper-adoption-gate.test.ts` | adoption floor ≥15 → ≥32 |
| `app/api/__tests__/b16-0-9-tranche-parity.test.ts` | NEW — 111 permanent pins (§A boundary matrix ×17, per-route refusals, §D provider zero-call/routing/error-normalization with a fake adapter) |

## Artifacts

`artifacts/ai-control-plane-b16-0-9/` (12 docs + manifest + matrix copies);
shared matrices regenerated ONLY via `generate-b16-0-4-artifacts.ts` /
`generate-b16-0-7-artifacts.ts` / `generate-b16-0-8-baseline.ts`.

## Explicitly NOT changed

`route-handlers.ts` (no new wrapper variant needed), the analyzer, all other
route files (118 raw + 3 factories stay in the baseline), provider
configuration, DB, exposed tools. `C:\Users\robsa\sirkit` untouched.
