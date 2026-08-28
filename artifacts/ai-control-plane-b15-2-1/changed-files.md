# B15.2.1 — changed files (exact paths)

## New production modules

- `app/lib/pcb/geometry-exact.ts` — the exact BigInt integer-polygon
  authority (point/segment containment, simple-polygon validity).
- `app/lib/pcb/proposal/pcb-edit-proposal-sealer.internal.ts` — the
  module-private raw sealer (import-gated).
- `app/lib/pcb/proposal/pcb-edit-proposal-service.ts` — the ONE high-level
  entry `createSealedPcbEditProposal`, which compiles internally and seals.

## Modified production modules

- `app/lib/pcb/proposal/bounded-edit-compiler.ts` — exact geometry (§A),
  `placementConstraints` + full envelope on move AND rotate (§B),
  dimension-update rendered-geometry validation (§C), semantic rule
  verification over every net (§D), padstack/updated-track minima; removed
  the sampled `segmentInsideOutline` and the local
  `doubleSignedArea`/`segmentsProperlyIntersect`.
- `app/lib/pcb/proposal/sealed-pcb-edit-proposal.ts` — removed the public
  `sealPcbEditProposal`/`assemblePcbEditProposal` exports and dead
  types/`deepFreeze`; added `validateImpactShape` and full nested-shape
  validation to the verifier.

## Tests

- `app/lib/pcb/proposal/__tests__/b15-2-1-residual-closure.test.ts` — NEW
  (15 permanent tests: R17–R21 + the AST seal-boundary gate + negative
  tripwire).
- `app/lib/pcb/proposal/__tests__/b15-2-core-closure.test.ts` — footprint
  fixtures moved to type-correct `placementConstraints`; R16 seal tests use
  the service and the internal raw sealer.
- `app/lib/pcb/proposal/__tests__/b15-1-corrective-closures.test.ts` and
  `b15-bounded-edit-core.test.ts` — seal fixtures use
  `createSealedPcbEditProposal`.

## Not touched

Registry, action registry, agent gateway/loop, `PcbEditor`, provider
adapters, durability/recovery, and every deterministic-artifact generator
are byte-unchanged.
