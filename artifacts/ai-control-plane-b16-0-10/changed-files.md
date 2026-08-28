# B16.0.10 — Changed files

## Migrated routes (boundary boilerplate → canonical wrapper; business logic byte-preserved)

Each replaced its `import { authorizeRequest }` + `import { readBoundedJsonObject,
boundedJsonRefusalResponse }` + handwritten `POST(req)` prologue with
`import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers"` and
`export const POST = authenticatedJsonRoute({ maxBytes: 16_000_000, deadlineMs:
45_000 }, async ({ body: rawBody }) => …)`; the final `}` became `});`. Nothing
else in any file changed.

1. `app/api/schematic/route.ts`
2. `app/api/schematic/build/route.ts`
3. `app/api/schematic/build-multi/route.ts`
4. `app/api/schematic/cross-verify/route.ts`
5. `app/api/schematic/edit/route.ts`
6. `app/api/schematic/edit-build/route.ts`
7. `app/api/schematic/layout-critic/route.ts`
8. `app/api/schematic/review/route.ts`

## Tests

- `app/api/__tests__/b16-0-10-tranche-parity.test.ts` — NEW; the 57-pin §A/§D/§E
  suite (run green pre-migration, kept green unchanged post-migration).
- `app/lib/auth/__tests__/b16-0-8-migration-ratchet.test.ts` — `TRANCHE_3` pins
  added; `BASELINE_MAX` 121→113 (downward only), `MIGRATED_FLOOR` 32→40 (upward
  only).

## Regenerated through sanctioned generators only

- `app/lib/auth/__tests__/_raw-route-baseline.json` — 121→113 via
  `generate-b16-0-8-baseline.ts` (8 removed, 0 added).
- `artifacts/ai-control-plane-b16-0-7/route-wrapper-matrix.csv` +
  b16-0-4 matrices — regenerated ×2, byte-stable; copies + the 8-row
  manifest extracted into this stage's dir.

## Explicitly NOT changed

`app/lib/prompts.ts` (sha1 `eb08600b…`), `app/lib/llm/*`, `app/lib/build-loop.ts`,
`app/lib/auth/route-handlers.ts`, all other routes, provider configuration,
tool exposure, replay pins, hashes. `C:\Users\robsa\sirkit` untouched.
