# B16.0.21 — Changed files

## Migrated routes (all → `authenticatedJsonRoute({ maxBytes: 64_000_000, deadlineMs: 30_000 })`)

firmware-bringup: problem, propose, resources. full-flow: propose, run
(callback param `{ context: trustedContext, body }` — the route has its own
local `context` from `pinRunContext`; disclosed), transition.
release-engineering: problem, propose. All `{ context, body }` + the family
projector; business logic byte-identical EXCEPT the §D transition-gate
correction.

## §D correction

`app/api/full-flow/transition/route.ts` — actor gate `actorKind === "ai"` →
`actorKind !== "human"` (same 403 response; reproduced + documented pre-edit).

## Shared helpers (extended, NOT weakened)

All three `_scope.ts` files — ADDED the named max-bytes/deadline constants and
the Request-free projectors; `scopedCd11/12/13Json` retained (now reading the
named constant).

## Tests

- `b16-0-21-tranche-parity.test.ts` — NEW; 56 §A pins (green first run,
  pre = post; per-family scope-override seams; pass-through compile spies).
- `b16-0-21-tranche14-confinement-gate.test.ts` — NEW; 13 §C–§G gates incl.
  the corrected gate pins for all four non-human kinds.
- ratchet — `TRANCHE_14`; 37→29; floor 124.

## Regenerated via sanctioned generators only

Baseline 37→29; matrices ×2 byte-stable; manifest extracted here.

## NOT changed

All domain modules (`compileFirmwareTestBringUpProblem`,
`solveResourceAssignments`, `createCd11/12/13Proposal`,
`createAutonomousRun`/`transitionRun`/state machine,
`compileReleaseEngineeringProblem`, capability profiles), tool registry,
hashes, replay pins. `C:\Users\robsa\sirkit` untouched.
