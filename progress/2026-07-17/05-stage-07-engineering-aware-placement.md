# Stage 7 engineering-aware placement

## What changed

- Replaced active complete-pair spring graphs with deterministic O(k) hyperedge stars.
- Added immutable revision/program-bound placement problems, feasibility diagnostics, and exact candidate hashes.
- Added layer/direction cut capacity, physical demand/overflow, eight-direction escape, and spatial via pressure.
- Added explicit sourced objectives for decoupling, loops, plane access, high-speed ordering, separation, thermal intent, mechanical edge, and stability; unknown stays unknown.
- Added deterministic multi-start candidates, hard-legal selection, Pareto evidence, budgets, progress, cancellation, and replay.
- Added preserve/rip-up/selected-scope copper policies for tracks and vias.
- Added stale-checked atomic apply/revert and derived fill/evaluation invalidation.
- Migrated worker, API, AI, and UI to the shared Stage 7 candidate; AI cannot apply.
- Added cyan non-mutating canvas preview with explicit Apply/Discard.
- Fixed concave-outline/region exactness and the Stage 6 zone-dirty target-revision bug.
- Added 15 original corpus fixtures, legacy baseline, quality artifact, and 39 Stage 7 tests.

## Why

The previous active routeability model could prefer visually compact but physically congested placements, materialized high-fanout pair cliques, checked only four escape directions, and did not make candidate evidence/application boundaries strong enough. The new path prioritizes hard legality and exposes individual physical tradeoffs without claiming routed or signoff proof.

## Verification

- Stage 1–6 placement gate: 32 files / 210 tests passed.
- Stage 7: 5 files / 39 tests passed.
- Full suite: 124 passed, 2 skipped; 777 tests passed, 9 skipped.
- TypeScript: passed.
- Stage 7/touched lint: clean.
- Production build: compiled and emitted BUILD_ID with five inherited dynamic tracing warnings.
- Full lint: 30 inherited React errors and 15 warnings outside Stage 7 remain.

## Evidence and limitations

- Legal forced-crossing corpus case: overflow 63 → 30; max overflow 15 → 11; HPWL 458.0M → 280.3M nm; escape/via tradeoff remains visible.
- Isolated active runs: 30 parts 176 ms; 100 parts 1,025 ms.
- Controlled FreeRouting correlation, richer hotspot/frontier UI, full room/block solving, and evidence-dependent engineering checkers remain incomplete.

Verdict: `STAGE 7 INCOMPLETE`.
