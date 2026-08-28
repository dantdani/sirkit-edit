# B16.0.20 — Changed files

## Migrated routes (all → `authenticatedJsonRoute({ maxBytes: 64_000_000, deadlineMs: 30_000 })`)

`{ body }`: measure. `{ context, body }` + `modelSimulationScopeFromContext`:
denominator, execute, problem, propose, readiness.

Business logic byte-identical EXCEPT the §C execute-gate correction:
`actorKind !== "human" && role !== "automation"` → `actorKind !== "human"`
(a strict narrowing; reproduced + documented pre-edit).

## Shared helper (extended, NOT weakened)

- `app/api/model-simulation/_scope.ts` — ADDED
  `MODEL_SIMULATION_API_DEADLINE_MS = 30_000` +
  `modelSimulationScopeFromContext(context)`. `scopedJson` retained.

## Tests

- `b16-0-20-tranche-parity.test.ts` — NEW; 44 §A pins (green first run,
  pre = post; scope-override seam for actor-gate testing; pass-through spies
  over the REAL compile/authorize/readiness functions).
- `b16-0-20-simulation-confinement-gate.test.ts` — NEW; 9 §C/§D/§I/§J gates
  incl. the corrected ai+automation → 403 pin and the zero-process scan.
- ratchet — `TRANCHE_13`; 43→37; floor 116.

## Regenerated via sanctioned generators only

Baseline 43→37; matrices ×2 byte-stable; manifest extracted here.

## NOT changed

`authorizeSimulationExecution`, `compileSimulationVerificationProblem`,
`compileSimulationCoverageDenominator`, `evaluateMeasurement`/`evaluateAssertion`,
`evaluateSimulationReadiness`, `createSimulationChangeProposal`, capability
profile, the blocked-runner 501 contract, tool registry, hashes, replay pins.
No runner implementation. `C:\Users\robsa\sirkit` untouched.
