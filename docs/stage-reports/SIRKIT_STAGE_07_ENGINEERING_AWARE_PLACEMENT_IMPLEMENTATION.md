# Sirkit Stage 7 — Engineering-Aware Placement Implementation

Date: 2026-07-17  
Branch: `codex/stage-07-engineering-aware-placement`  
Working copy: `C:\Users\robsa\Documents\Codex\2026-07-13\do\work\sirkit-edit`  
Protected source: `C:\Users\robsa\sirkit` was not modified.

## 1. Executive implementation summary

Stage 7 now has an active deterministic placement foundation rather than a cosmetic crossing-count wrapper. The default `autoPlace` path captures an immutable, revision-bound problem; represents nets as O(k) hyperedges; runs feasibility before optimization; generates multiple deterministic candidates; legalizes with exact final validation; evaluates layer/direction capacity, pin escape, via pressure, HPWL, explicit electrical relationships, and stability; selects only a hard-legal candidate; previews it as a cyan non-mutating ghost; and applies it only through a stale-checked, undoable transaction.

The old pair-clique spring construction is gone from the active force initializer. Straight-airwire crossings remain compatibility diagnostics only and do not dominate candidate selection. Plane labels alone no longer suppress ordinary attraction: only a current filled zone is accepted as plane access.

This is a substantial foundation, but the final verdict remains incomplete. Controlled FreeRouting correlation across the corpus, full canvas hotspot/frontier comparison UI, comprehensive room/block solving, and several evidence-dependent thermal/RF/assembly objectives are not complete.

## 2. Prerequisite evidence

The Stage 1–6 placement-relevant gate passed before implementation:

```text
npx vitest run data-integrity pin-pad-mapping locked-copper-integrity net-reconciliation electrical-truth electrical-consistency readiness-policy schematic-parity dsn-integrity read-ses autoroute-verification build-bundle native-fab release-persistence stage-04-native-planes copper-policy drc-clearance app/lib/atomic app/lib/constraints --reporter=dot
32 files passed; 210 tests passed.
```

Verified prerequisites include stable PCB/electrical identities, pin/pad mapping, protected copper, authoritative electrical truth, readiness revision binding, native planes/fill lifecycle, same-net copper policy, atomic component storage, and compiled immutable constraint programs.

Stage 6 is not globally complete: some broader live consumers and authoring UI remain deferred. Its compiled program, exact target revisions, restrictive merges, placement graph, and transaction behavior required by Stage 7 are present and tested. Stage 7 therefore proceeded without claiming that all Stage 6 product work is complete.

## 3. Fresh baseline report

The pre-cutover deterministic legacy path was captured in `app/lib/pcb/autoplace/fixtures/stage7-legacy-baseline.json`.

| Fixture | Source crossings | Legacy result crossings | Source ratsnest | Legacy result ratsnest | Source/result via proxy | Time |
|---|---:|---:|---:|---:|---:|---:|
| 30 parts | 42 | 7 | 963,679,419 nm | 166,683,927 nm | 74 / 12 | 191 ms |
| 100 parts | 125 | 13 | 2,774,817,617 nm | 422,926,090 nm | 217 / 27 | 216 ms |

That path materialized pair springs, used four axial escape corridors, and treated crossings/ratsnest/simple via demand as routeability. Its useful deterministic PRNG, collision resolver, rotation helper, history, worker, and progress paths were retained deliberately.

Fresh active-path isolated runs:

| Fixture | Time | Ratsnest | Legacy crossing diagnostic | Hard result | Physical placement evidence |
|---|---:|---:|---:|---|---|
| 30 parts | 176 ms | 963,679,419 → 138,542,411 nm | 42 → 5 | 0 overlap/outside/pad failures | overflow 0, escape deficits 0, via pressure 2 |
| 100 parts | 1,025 ms | 2,774,817,617 → 519,935,157 nm | 125 → 16 | 0 overlap/outside/pad failures | overflow 0, escape deficits 0, via pressure 20 |

Crossing counts in this table are diagnostics, not routing proof or the primary selection metric.

## 4. Algorithm architecture

```text
board + active Stage 6 program
  → immutable placement problem and semantic hash
  → feasibility precheck
  → current + hypergraph-force + constructive seeded candidates
  → coupled side/rotation scan
  → bounded exact legalization
  → layer/direction capacity, pin escape, via pressure, objectives
  → hotspot-local refinement
  → hard-legal Pareto frontier and lexicographic selection
  → cyan ghost preview
  → explicit user approval
  → stale revalidation and atomic history transaction
```

The problem is bound to board revision, project identity, constraint program/design revision, catalog, variant, manufacturing profile, algorithm version, metric version, movement mode, seeds, regions, and capacity resolution. Semantic hashes exclude caller array order and timing.

The force initializer stores one hyperedge per signal net and one member-to-center incidence per participating component. An 80-member regression produces 80 incidences rather than 3,160 pairs. Current plane fills become `plane_access` edges and are excluded from ordinary attraction.

Termination states distinguish infeasible, no legal candidate, timed out, budget-exhausted best known, completed, stale, and post-validation regression. Cancellation throws a distinct non-mutating cancellation result.

## 5. Hard-constraint enforcement matrix

| Constraint/state | Capture/precheck | Final validator | Failure behavior |
|---|---|---|---|
| Locked/fixed/mechanical | Fixed variable and reason | Exact transform equality | Candidate illegal |
| Manual/imported/locked pad-attached copper | Component fixed | Protected transform check | Candidate illegal |
| Generated copper in preserve mode | Component fixed | Protected transform check | Candidate illegal |
| Allowed rotations/sides | Restrictive intersection; empty set rejected | Exact membership | Candidate illegal |
| Oversized instance/board area | Bounds and area rejection | Outline validation | Infeasible/illegal |
| Outline/concave notch | Conservative precheck | Exact bbox/polygon edge-crossing check | Candidate illegal |
| Pads inside board | — | Exact world-pad point check | Candidate illegal |
| Regions/keepouts | Missing geometry rejected | Exact bbox/polygon containment/intersection | Candidate illegal |
| Component envelopes | Fixed overlap precheck | Pairwise exact transformed envelopes | Candidate illegal |
| Proximity/separation distance | Compiled relation | Exact sourced distance check | Fail/unknown/unsupported |
| Connector edge | Explicit movable relation | Envelope-to-edge gap with tolerance | Candidate illegal |
| Program/target freshness | Exact active program revision | Program/design identity | Stale rejection |
| Unknown hard rule form | — | Never treated as pass | Unknown/unsupported, illegal |

Native footprint definitions currently expose conservative courtyard/body bounding boxes, not arbitrary courtyard polygons. Final legality is exact for those represented boxes, board polygons, pads, and represented regions; richer footprint polygon support remains a risk.

## 6. Routeability estimator specification

The estimator builds cutlines per enabled signal layer and preferred direction. Capacity is derived from outline span, track pitch (physical width plus clearance), component envelope obstacles, keepouts, and protected tracks. Plane-only layers receive zero ordinary signal capacity.

Demand is a deterministic star/RUDY-style cut estimate over exact terminal positions. Per-net demand is deduplicated per cutline, uses net-specific width/clearance/layer policy, and excludes connections already proven complete by Stage 2. Reports include total capacity/demand/overflow, maximum overflow, overloaded cutlines, hotspots, contributing net IDs, and capacity assumptions.

Pin escape checks eight directions against pad geometry, allowable layers, neighboring pads/components, outline, and keepouts. No allowed layer is a deficit, never a pass. Via pressure is spatial, based on layer transitions/plane access and landing capacity; unsupported via types remain unsupported.

Known deterministic channel result: a clear equal-HPWL channel and an obstructed channel have different cut capacity; the obstructed central cut records capacity 0, demand 20, overflow 20. In the legal forced-crossing corpus fixture, selected total overflow improves 63 → 30 and max overflow 15 → 11. Escape deficits worsen 0 → 7 and via pressure 0 → 5, which stays visible rather than being hidden by a composite score.

No estimator value is electrical completion, detailed routing, DRC, SI/PI, thermal, or fabrication proof.

## 7. Engineering-objective matrix

| Objective | State/source | Metric | Limitation |
|---|---|---|---|
| Wirelength | Evaluated for signal hyperedges | Pin-aware weighted HPWL | Not routed length |
| Routing congestion | Evaluated | Cutline overflow/capacity | Coarse estimate |
| Pin escape | Evaluated/unknown | 8-direction feasible fraction | Not routed fanout |
| Via pressure | Evaluated/unsupported | Transition demand/landing capacity | Not actual via count |
| Decoupling | Explicit relationship | Closest same-rail terminal distance | Not performance proof |
| Critical loop | Explicit relationship | Member loop perimeter | Not EMI/PI proof |
| Plane/return access | Current filled zone only | Access transition demand | Dirty/absent fill is not access |
| High-speed ordering | Explicit differential/termination relation | Pair-span mismatch and chain distance | Stage 8 routing/tuning required |
| Sensitive separation | Source-backed distance only | Normalized distance violation | No invented RF/EMI facts |
| Thermal intent | Source-backed distance only | Geometric separation | No thermal analysis |
| Mechanical edge | Explicit connector edge | Edge gap | No enclosure model inference |
| Assembly/test | Relationship preserved | Unknown without proven checker | Never converted to pass |
| Stability | Evaluated | Displacement per board diagonal/instance | Does not model all rework cost |

Unknown/unsupported objectives retain null raw and normalized values. In priority selection they receive an explicit conservative penalty rather than an accidental zero. `evaluatedWeightedPenalty` contains evaluated metrics only and is labeled accordingly.

## 8. Candidate and scoring contract

Every candidate contains stable ID/hash, problem/board/program/algorithm/metric versions, seed, initializer, exact placements and move diffs, copper plan, hard report, congestion/escape/via reports, normalized objective report, legacy diagnostics, phase stats, warnings, selected flag, and selection reason.

Selection is lexicographic:

1. hard legality;
2. explicit objective priority (`routing_congestion`, `pin_escape`, `wirelength`, `via_pressure`, critical loop, decoupling, stability by default);
3. evaluated weighted penalty;
4. stable semantic hash.

The hard-legal non-dominated set is retained as a Pareto frontier. Candidate IDs do not include wall time, worker scheduling, or array order. The UI says selected/best-known; it does not claim mathematical or global optimum.

## 9. Existing-copper/movement policy

Four modes are explicit:

- `initial_unrouted`: movable unless locked/fixed/protected;
- `preserve_routed`: pad-attached generated copper also fixes the component;
- `generated_copper_ripup`: may remove only affected unlocked AI/autorouter tracks and vias;
- `selected_scope`: only selected permitted components move.

Exact pad-attached manual/imported/legacy/locked tracks and vias freeze their component. Generated removals are listed in preview with affected nets and `resultingConnectivity: incomplete`. Zones are not deleted; every accepted placement invalidates their derived fill for deterministic recomputation. Apply independently rechecks that every removal is still present and generated.

No board outline is silently expanded. The compatibility wrapper allows the old generated-outline behavior only when explicitly authorized; user-authored outlines never resize silently.

## 10. Evidence and transaction contract

Problem, candidate, run, and transaction IDs are semantic and revision-bound. Apply verifies candidate hash/ID, problem identity, board revision, active program hash, fresh hard report equality, and generated-copper ownership. It then updates footprints, removes approved generated copper, dirties fills, clears active constraint evaluation, and records before/after revisions and snapshots in one history operation.

Exact revert restores footprint transforms, removed tracks/vias/zones, and zone snapshots, and reproduces the original semantic board revision in tests. Replay bundles contain hashes, seeds, graph/capacity policy, candidates, reports, and termination, but omit filesystem paths, API keys, secrets, and wall-time identity.

## 11. Consumer migration table

| Consumer/path | Old behavior | New service/report | Compatibility behavior | Tests |
|---|---|---|---|---|
| Auto-place wrapper | Direct legacy result | Stage 7 run/candidate evidence | Legacy result fields retained | auto-place, expansion |
| Force initializer | Complete pair graph | O(k) hyperedge stars | Two-pin spring behavior retained | high-fanout, force tests |
| Worker | Legacy phases/result | Same active Stage 7 wrapper with bounded progress/cancel | Existing message contract retained | full regression |
| UI preview/apply | Immediate mutation | Cyan ghost, metrics, Apply/Discard | One undo history entry | type/lint/full suite |
| Placement API | None/provider-specific risk | Bounded provider-neutral preview POST | No apply endpoint | API test |
| AI tools | Composite/crossing analysis; apply tool | Deterministic preview/evidence/explain | AI apply removed; user approval required | service/API/AI test |
| Routing intelligence | Straight crossing emphasis | Capacity/escape/via evidence | Legacy crossing remains labeled diagnostic | capacity tests |
| Constraint compiler | Placement distances marked future | Stage 7 hard validator coverage | Existing programs migrate with stored project ID | Stage 6 + Stage 7 tests |
| Persistence/revision | Project ID implicit | Constraint state stores compile project ID | Optional field migrates old boards | full regression |

## 12. Before/after quality report

The machine-readable per-fixture report is `app/lib/pcb/placement/fixtures/stage7-quality-report.json`. It records settings, termination, time, legal candidate count, source and selected HPWL, total/max overflow, escape deficits, via pressure, moves, and the skipped router-evaluation reason.

| Fixture | Source → selected overflow | Source → selected HPWL (nm) | Escape | Via pressure | Result |
|---|---:|---:|---:|---:|---|
| Simple LED | 0 → 0 | 21.8M → 7.7M | 0 → 0 | 0 → 0 | completed |
| Forced crossing 2L | 63 → 30 | 458.0M → 280.3M | 0 → 7 | 0 → 5 | completed, tradeoff visible |
| Four signal layers | 0 → 0 | 356.4M → 260.0M | 0 → 0 | 0 → 0.188 | completed |
| Signal/plane access | 0 → 0 | 12.4M → 2.8M | 0 → 0 | 0 → 0.125 | completed |
| Crowded MCU | 0 → 0 | 228.0M → 225.6M | 0 → 0 | 0.429 → 0.429 | completed |
| MCU decoupling | 0 → 0 | 40.0M → 15.9M | 0 → 0 | 0 → 0.125 | completed |
| Switching regulator | 0 → 0 | 17.0M → 15.8M | 0 → 0 | 0 → 0 | completed |
| USB differential | 0 → 0 | 80.0M → 82.946M | 0 → 0 | 0 → 0 | completed; source required edge legalization |
| RF/antenna/crystal | 0 → 0 | 13.2M → 10.773M | 1 → 1 | 0 → 1 | completed; deficit visible |
| Connector/mechanical | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | completed |
| Thermal separation | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | stable/source-backed proxy |
| Assembly variant | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | stable |
| Routed/protected | 0 → 0 | 20.0M → 20.0M | 0 → 0 | 0 → 0 | protected/stable |
| Deliberately infeasible | 0 | 0 | 0 | 0 | rejected before search |
| Equal HPWL/capacity | 72 → 72 | 458.0M → 458.0M | 0 → 0 | 0 → 0 | only current legal; capacity comparison is separately tested |

This corpus is an engineering regression set, not a competitive QoR benchmark.

## 13. Estimator validation report

Validation currently covers analytical channel cases, signal-versus-plane layers, fixed obstacles, width/clearance changes, keepouts/protected tracks, remaining electrical connections, eight-direction pad blockage, no-layer deficits, spatial via pressure, and unsupported via policy. The known equal-HPWL case proves that capacity distinguishes geometry that HPWL cannot.

Controlled detailed-router evaluation was not run across the Stage 7 corpus. Therefore no Spearman/Pearson correlation or completion-rank claim is made. FreeRouting is integrated elsewhere, but per-candidate isolated router passes, nondeterminism attribution, calibration/holdout partitions, and documented misprediction statistics remain required before completion.

Known estimator risks include coarse cut resolution, star decomposition demand bias, conservative envelope obstacle capacity, no negotiated detailed path search, and inability to prove escape/return-path success.

## 14. UI/API/AI workflow

The toolbar starts a cancellable worker preview. The panel shows candidate hash, termination, moves/rotations/flips, overflow, overloaded cutlines, via pressure, escape deficits/unknowns, objective values/weights, hard violations, generated copper removals, limitations, and Apply/Discard. Candidate transforms render as a translucent cyan ghost while the board/history remains unchanged.

Apply rechecks the board revision and uses the same deterministic transaction as the service. Discard restores live transforms without a mutation. The preview API accepts bounded board/options JSON and returns the same reports. AI can build, preview, inspect, compare, explain, and obtain replay evidence; it has no coordinate setter or placement-apply tool.

Missing UI work: interactive Pareto candidate switching, per-cutline/hotspot canvas overlays, constraint-object focus, side-by-side candidate comparison, and richer infeasibility remediation.

## 15. Files changed

- Data/contracts: `app/lib/pcb/placement/types.ts`, `stable.ts`, project identity in Stage 6 state/revision.
- Problem/graph: `problem.ts`, `hypergraph.ts`, `geometry.ts`.
- Physical estimators: `capacity.ts`, `escape.ts`, `objectives.ts`.
- Solver/selection: `engine.ts`, active `autoplace/force-directed.ts`, `autoplace/auto-place.ts`.
- Exact validation/transactions: `validator.ts`, `transaction.ts`, concave polygon fixes in `autoplace/geometry.ts`.
- Service/API/AI: `service.ts`, placement preview route, PCB tool service/schemas/routing analysis.
- Worker/UI: `useAutoPlace.ts`, `PlacementSetup.tsx`, `PcbEditor.tsx`, preview support in `render/scene.ts`.
- Compatibility: `autoplace/types.ts`, explicit outline expansion tests/policy.
- Fixtures/tests: five Stage 7 suites, 15-fixture corpus, legacy baseline JSON, quality report JSON.
- Documentation: this report and `progress/2026-07-17/05-stage-07-engineering-aware-placement.md`.

## 16. Test evidence

```text
# Stage 7 targeted
npx vitest run app/lib/pcb/placement/__tests__ --reporter=dot
5 files passed; 39 tests passed.

# Force + active compatibility
npx vitest run app/lib/pcb/__tests__/auto-place.test.ts app/lib/pcb/__tests__/placement-expansion.test.ts --reporter=dot
2 files passed; 11 tests passed.

# Full repository
npx vitest run --reporter=dot
124 files passed, 2 skipped; 777 tests passed, 9 skipped.

# Static checks
npx tsc --noEmit
passed.

npx eslint <Stage 7 and touched paths>
passed with 0 errors and 0 warnings.
```

`npm run lint` still reports 30 errors and 15 warnings in unrelated inherited React ref/effect code (`BomView`, `CommandPalette`, `SilkTool`, `useLivePreview`, inspectors, `PadstackEditor`, and `app/page.tsx`). Stage 7 touched-path lint is clean.

`npm run build` compiled successfully and emitted `.next/BUILD_ID`; Turbopack reported five pre-existing broad file-trace warnings around dynamic Java/NGSpice executable spawning and `next.config.ts` tracing.

Controlled router-evaluation tests were skipped because a Stage 7 per-candidate evaluation harness/corpus attribution was not configured. This is a completion blocker, not a pass.

## 17. Performance and limits

- 30-part isolated active run: 176 ms.
- 100-part isolated active run: 1,025 ms.
- 100-part run during the fully parallel test suite: 3,372 ms; its test intentionally logs rather than asserts this shared-machine time.
- 80-member high-fanout graph: one hyperedge, 80 incidences.
- Candidate count is bounded to 2–8; seeds to 8; iterations to 2,000; timeout to 120 seconds; local refinement to 3 passes and 16 hotspot components.
- API body is bounded to 8 MB.
- Worker cancellation and phase progress are supported.
- Memory was not instrumented, so no memory claim is made.
- No cross-run geometry/routeability cache is used. This is deliberately safe: immutable problems and in-memory run lookup avoid reusing metrics after any semantic change. A future cache must include every board/program/profile/variant/algorithm/metric/mode/region/resolution input.
- Remaining O(n²) work includes component repulsion and final overlap validation; spatial indexing at larger production scale remains work.

## 18. Compatibility notes

The legacy 1.15 placement envelope remains the default. Existing spacing preferences and deterministic seeds are honored. Legacy result fields and worker messages remain available, but the active candidate is selected by Stage 7 evidence. Existing placed/routed boards default to preserve-routed mode. Manual/imported/locked copper is never stretched or silently retargeted.

Old constraint states gain an optional persisted `projectId` on migration so real project programs are not incorrectly revalidated against the string `placement`. Zone `dirty`/fill state is excluded from target identity because it is derived evaluation state. Program activation may dirty fills without making its own design revision stale.

Custom footprints without trustworthy courtyards fall back to body/pad bounds with visible confidence. Missing Stage 5 facts or Stage 6 relationships remain unknown/not-applicable; no name-only thermal/RF/current intent is invented. Schema/API versions are `sirkit.placement-problem.v1`, `sirkit.placement-candidate.v1`, `engineering-placement/1.0.0`, and `placement-capacity/1.0.0`.

## 19. Remaining risks

1. No controlled FreeRouting rank/correlation report across the 15-fixture corpus.
2. No full per-candidate route-evaluation pass attribution or external-router nondeterminism model.
3. Room/block/group relations are represented but do not yet have a complete hierarchical block solver.
4. Footprint final geometry is exact for represented conservative boxes, not arbitrary courtyard polygons.
5. Via attachment is detected at exact pad centers; more complex fanout attachment topology needs authoritative copper-component ownership.
6. Thermal, RF/analog, assembly/test, enclosure, and many high-speed facts remain unknown without sourced models/checkers.
7. The capacity estimator can mis-rank detailed-routing cases; resolution and conservative obstacles affect results.
8. Canvas hotspot/frontier/constraint overlays and interactive candidate switching are incomplete.
9. Large-scale repulsion/final overlap remain O(n²); memory and thousand-part production scale are unmeasured.
10. Full-repository lint has unrelated inherited failures even though Stage 7 paths are clean.
11. Stage 8 professional routing/tuning, Stage 9 competitive benchmarking, and SI/PI/thermal signoff are explicitly not complete.

## 20. Completion verdict

Stage 7 has replaced the dangerous active foundations: no pair-clique attraction, no crossing-dominant selection, no four-corridor escape model, no silent outline growth, no unapproved apply, no stale candidate commit, and no optimistic conversion of unknown engineering facts.

It does not yet meet every acceptance criterion because controlled router correlation, complete advanced UI evidence exploration, full room/block handling, and several sourced engineering checkers remain unfinished.

STAGE 7 INCOMPLETE
