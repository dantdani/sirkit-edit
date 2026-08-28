# B16.0.16 — Changed files

## Migrated routes (boundary prologue → canonical wrapper; business logic byte-preserved)

All → `authenticatedJsonRoute({ maxBytes: 12_000_000, deadlineMs: 30_000 })`:

1. `app/api/calculation/corners/route.ts` — `{ body }`
2. `app/api/calculation/evaluate/route.ts` — `{ body }`
3. `app/api/calculation/export/route.ts` — `{ context, body }` + `calculationScopeFromContext`
4. `app/api/calculation/feedback/route.ts` — `{ body }`
5. `app/api/calculation/problem/route.ts` — `{ context, body }`
6. `app/api/calculation/propose/route.ts` — `{ context, body }`
7. `app/api/calculation/report/route.ts` — `{ context, body }`
8. `app/api/calculation/transaction/route.ts` — `{ context, body }`

Each: raw `POST(request)` + `scopedJson(request)` prologue replaced; the rest of
the handler byte-identical. `object` retained where used.

## Shared helper (extended, NOT weakened)

- `app/api/calculation/_scope.ts` — ADDED `CALCULATION_API_DEADLINE_MS = 30_000`
  and `calculationScopeFromContext(context)` (delegates to shared `flatScopeOf`).
  `scopedJson`, `object`, `CalculationApiScope`, `CALCULATION_API_MAX_BYTES`
  UNCHANGED and retained.

## Tests

- `app/api/__tests__/b16-0-16-tranche-parity.test.ts` — NEW; 67 route pins
  (pre = post).
- `app/lib/auth/__tests__/b16-0-16-calculation-confinement-gate.test.ts` — NEW;
  12 AST-backed confinement + no-misleading-authority gates.
- `app/lib/auth/__tests__/b16-0-8-migration-ratchet.test.ts` — `TRANCHE_9`
  pins; `BASELINE_MAX` 80→72; `MIGRATED_FLOOR` 73→81.

## Regenerated through sanctioned generators only

- `_raw-route-baseline.json` — 80→72 (8 removed, 0 added).
- wrapper + b16-0-4 matrices ×2, byte-stable; tranche manifest extracted here.

## Explicitly NOT changed

calculation algorithms, interval arithmetic, model registry, transaction
semantics, feedback logic, report digest verification, the `propose` prompt/
tool schema/provider config, approval behavior, tool registry exposure,
database migrations, authoritative hashes, replay pins. `C:\Users\robsa\sirkit`
untouched.
