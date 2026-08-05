# Sirkit Stage 8 — Professional Interactive and High-Speed Routing

Date: 2026-07-17  
Branch: `codex/stage-08-professional-routing`  
Base commit: `2bd1603a775bd4b409b89710cd4e5f8d70201632`  
Evidence: `artifacts/stage-08/audited-baseline.json`, `artifacts/stage-08/verification.json`

## 1. Executive implementation summary

Stage 8 now has an authoritative routing domain foundation instead of UI-owned trace gestures. It includes immutable snapshots, layer-aware topology/contact, stable anchors and IDs, exact interior splitting, stackup-aware via transitions, protected-copper policy, immutable candidate deltas, stale-checked atomic commit/revert, exact path measurement, bounded shove/tuning foundations, typed differential-pair identity, and a provider-neutral service.

The live tool changed materially: route clicks and vias remain candidate-only; Backspace and Escape affect only that candidate; reaching a valid same-net pad/via/track/junction/current-zone anchor creates one history command. Arbitrary straight angles are a persisted posture. Right-click rip-up now defaults to one selected segment. Existing walk-around, exact clearance, DRC, connectivity, history, stackup, constraints, DSN/SES, fabrication, and AI-provider infrastructure were adapted rather than replaced.

## 2. Prerequisite evidence

Stages 1–7 were exercised through the full suite. Verified contracts include semantic PCB revisions and stable net/pad identity; authoritative electrical truth; readiness separation; native same-net plane/fill lifecycle; atomic component/pad models; compiled hierarchical constraints; placement snapshots/candidates; locked copper; history; DRC; and 2/4-layer DSN/SES behavior.

Commands:

- `npm test -- --reporter=dot`: 125 files passed, 2 skipped; 792 passed, 9 skipped.
- Earlier prerequisite gate: 37 selected Stage 1–7 files, 249 tests passed.
- `npx tsc --noEmit`, targeted ESLint, and `npm run build`: passed.

No prior-stage blocker was found. The incomplete verdict is caused by remaining Stage 8 work, not a missing prerequisite.

## 3. Audited-baseline reproduction

| Finding | Fresh source | Before | After / test | Status |
|---|---|---|---|---|
| Arbitrary angles rejected | `smart-routing/validator.ts` | `NON_OCTILINEAR` | Native straight arbitrary posture; end-to-end test | Fixed |
| Track start snapped to endpoint | `route-tool.ts` old `hitTrack` | nearest endpoint | projected stable interior anchor and split test | Fixed |
| Binary layer flip | old `flipCopperLayer` | top↔bottom only | physical stackup transition test from `In1.Cu` | Fixed |
| Nondeterministic IDs | old `Math.random` salt | process-dependent | canonical semantic IDs and digest tests | Fixed |
| Per-click mutation | old `commitRouting`/`placeVia` | multiple history entries | candidate-only multi-click transaction test | Fixed |
| Backspace global undo | old `options.undo` | unrelated history risk | candidate-step pullback test | Fixed |
| Whole-net default rip-up | old `buildRipupNetCommand` call | unrelated branches removed | selected-segment test | Fixed |
| Lock-only protection | route/stretch/rip-up boundaries | provenance bypass | centralized provenance matrix test | Fixed for migrated paths |

Machine-readable details are in `artifacts/stage-08/audited-baseline.json`.

## 4. Routing architecture

`RoutingSnapshot` pins design, electrical, library, stackup, constraints, zone fill, protected state, and engine versions. `RouteTopologyGraph` represents native straight edges, exact intersections, branch nodes, and layer transitions. `RouteRequest`, immutable `RouteCandidate`, `RouteResult`, and `RouteCommitTransaction` separate intent, preview, evidence, and apply.

The active flow is: persisted controls → exact anchor → candidate state → smart direct/walk preview → native delta and source splits → local clearance/electrical validation → one history command → stale check → electrical truth and full-board DRC → atomic apply. Rendering consumes preview data and never decides topology. FreeRouting remains an adapter through the pre-existing autoroute candidate/import boundary.

## 5. Geometry support matrix

| Feature | Model/preview | Connectivity/DRC | Measurement/edit | Persistence/export |
|---|---|---|---|---|
| Arbitrary straight | Supported | Supported | exact `hypot`; route/split supported | native `Track`; existing KiCad/DSN/fab paths |
| Octilinear/orthogonal | Supported | Supported | supported | supported |
| Arc copper | Explicitly unsupported | not silently flattened | unsupported | unsupported |
| Width transition | per-segment widths retained | checked per object | topology retains boundaries; full tuning boundary workflow incomplete | native tracks |
| Through via | 2/4-layer physical span | contacts every spanned layer | named vertical-length model | supported by existing save/KiCad/DSN/SES/fab paths |
| Blind/buried/microvia | Explicitly unsupported | rejected by capabilities/rules | unsupported | not emitted as supported |
| Junction/interior branch | Supported | authoritative topology | exact split/lineage | native successor tracks |
| Serpentine tuning | Native straight segments | candidate validation available | single straight path foundation | editable native tracks |

## 6. Routing-mode specification

- Highlight/stop: direct posture only; collision stops without detour or mutation.
- Walk-around: deterministic direct candidates, then bounded CW/CCW fixed-copper search; existing copper remains fixed.
- Shove: typed mode and bounded solver foundation. Only isolated eligible straight obstacles are currently movable; a blocked live route is reported rather than pretending shove succeeded.

Requests pin node/moved-object/iteration/timeout budgets. Failures distinguish blocked, infeasible, budget exhausted, unsupported, stale, and invalid.

## 7. Shove/springback design

`solveBoundedShove` uses the central movability policy, stable object order, explicit iteration/object/displacement budgets, and snapshots `{original,current}` for springback. Locked, imported, unknown, manual-out-of-scope, and anchored-junction obstacles fail explicitly. It does not accumulate pointer-state drift because every result starts from the immutable snapshot.

Current limit: topology-preserving cascades, attached vias, corners, and full live pointer integration remain unimplemented.

## 8. Multilayer and via policy

The layer graph comes from `getBoardStackup` and `routableCopperLayers`; compiled allowed/forbidden-layer and via-type constraints filter choices. A supported through-via spans the physical outer layers and contacts every enabled copper layer; continuation target is a separate explicit choice. Deterministic default picks nearest physical order, including `In1.Cu`/`In2.Cu`. Paired-via construction requires symmetric choices for both pair members.

Blind, buried, and microvias are false capabilities. The four-layer test verifies `In1.Cu → F.Cu/In2.Cu/B.Cu` choices and no binary fallback.

## 9. Differential-pair contract

Identity and polarity come only from an active typed Stage 6 `differential_pair` relationship. Names such as `USB_DP/USB_DM` are non-authoritative. The implemented constructor supports an exact straight, parallel, two-trace pair with copper-edge gap and symmetric paired through-vias. Missing/conflicting members, polarity mismatch, incompatible layers, or wrong gap fail explicitly.

Cornered pair search, inside/outside corner compensation, neckdowns, bounded uncoupling/recoupling, coupled-length evidence, and pair tuning remain incomplete.

## 10. Measurement specification

Straight length is `sqrt(dx²+dy²)` in integer-nanometer coordinates. Measurement requires explicit endpoint topology nodes and a unique simple path; zero paths is disconnected and two paths is `ambiguous_path`, never an inferred shortest path. Planar totals are per layer. Via contribution uses policy `uniform-stack-elevation/1.0.0`: configured board thickness is distributed over physical copper order because the current stackup lacks dielectric elevation fields. Pair skew is signed `P−N` and absolute `|P−N|` when both paths are measured.

Analytical tests cover a 3-4-5 arbitrary track (5 mm) and a square loop reported ambiguous. Arc, coupled/uncoupled, and invalidation workflows remain incomplete.

## 11. Tuning specification

`tuneStraightTrack` accepts an explicit source track, requested added length, corridor, pitch, maximum amplitude, same-net spacing, and candidate key. For each pitch element, maximum addition is `2*sqrt((pitch/2)²+amplitude²)−pitch`; capacity and residual are reported. Output is deterministic native straight copper with lineage.

Implemented tests cover feasible deterministic addition and insufficient corridor. Removing old tuning, arbitrary branched-path selection, exact pair/common/skew tuning, and bus/group tuning remain incomplete.

## 12. Existing-copper mutation matrix

| Class | New route contact | Shove/drag/tune/rip-up/reroute |
|---|---|---|
| Locked | contact only | denied |
| Imported | contact only | denied pending explicit migration |
| Manual selected | contact; interior may split when explicitly selected | allowed only with `selected_manual_movable` |
| Manual unselected | preserved | denied |
| Unknown provenance | contact only | denied until classified |
| Generated AI/autorouter | contact | allowed only inside explicit mutation scope |

The migrated route candidate, stretch, and selected rip-up boundaries revalidate this policy. A complete audit of every older repair/autorouter edit entry path remains required.

## 13. Autorouter integration report

Existing local FreeRouting remains candidate-before-apply with DSN preflight, job artifacts, strict SES reading, protected copper, verification, and one import command. Full regression tests passed, including multilayer DSN/SES suites. Stage 8 did not make FreeRouting authoritative and did not restore any API-key dependency.

Still required: a Stage 8-specific coverage matrix for every compiled routing constraint, stale job/permutation evidence, unsupported SES geometry corpus, and exact preservation tests across all provenance classes.

## 14. Constraint enforcement matrix

| Constraint | Resolver | Interactive | Commit | External router | State |
|---|---|---|---|---|---|
| Width/clearance/via dimensions | netclass + compiled program | exact local guard | full DRC | DSN rules | enforced |
| Allowed/forbidden layers | Stage 6 effective rules | transition filter | revision + DRC | existing DSN mapping | partial coverage |
| Via type | effective rule | through-only capability | validation | DSN padstack | through enforced; others unsupported |
| Differential identity/gap | typed relationship/netclass | straight constructor | candidate validation | not fully represented | partial |
| Length/skew/tuning | measurement/tuner | evidence foundation | no complete hard evaluator | not covered | incomplete |
| Max vias/regions/uncoupled length | active program | no complete evaluator | not complete | coverage incomplete | incomplete |

Unsupported and not-evaluated hard requirements remain typed and cannot be silently treated as passed.

## 15. Connectivity and evidence contract

Candidate construction compares authoritative electrical truth before/after and reports remaining intended connections, opens closed, new shorts, ambiguous contacts, and zone evidence. Local preview is labeled `interactive_local`; commit is `authoritative_commit`, rechecks all pinned revisions, recomputes electrical truth, blocks new shorts, runs full-board DRC, and blocks newly introduced errors. Route completion is not equated with global DRC, Stage 3 readiness, or SI signoff. Only zones on affected copper layers are marked dirty.

## 16. Transaction and replay contract

Candidate digest covers pinned revisions, request, native geometry, constraints/settings, deterministic seed, deltas, validation, and evidence. Commit rejects semantic revision changes, applies one delta, records before/after revisions and zone snapshots, and supports exact revert when the board still matches the committed revision. Preview, Backspace, and cancel never mutate the board. History stores one command and candidate metadata.

`replayBundleRef` is stable metadata; a persisted, independently executable replay bundle is not yet implemented.

## 17. UI/API/AI workflow

UI controls persist Highlight/Walk/Shove plus 90°/45° A/45° B/Any-angle. The provider-neutral `ProfessionalRoutingService` exposes snapshot, stable anchors, via choices, route preview, commit primitive for trusted callers, and explicit path measurement. Shared OpenAI/Anthropic tools expose only read/preview operations with stable anchor/object IDs. `preview_route_connection` has no raw `start`, `end`, or `points` fields and cannot commit.

A dedicated HTTP Stage 8 routing endpoint and full candidate-inspection panel are still absent.

## 18. Import/export fidelity report

Native straight tracks, widths, source metadata, vias, and zones remain compatible with existing project persistence. Existing KiCad, DSN/SES, native Gerber/fabrication, and canvas rendering suites passed in the full run. Arbitrary-angle straight tracks use the existing native primitive and therefore avoid approximation in the model.

Not proven by new Stage 8-specific round trips: interior-split lineage metadata through every external format, tuning structures through KiCad/SES, pair identity/constraints through exports, and unsupported arc/blind-via import diagnostics.

## 19. Before/after quality report

The 18 required fixtures have stable declarations in `routing/corpus.ts`, but only representative concrete boards are executable today: simple connection, interior branch, wrong/net-0, walk-around, protected shove, four-layer transition, arbitrary angle, tuning corridor, existing routed selection rip-up, and branch loop. These tests assert geometry, candidate mutation count, protection, connectivity/DRC gate, measurement, and deterministic identities—not screenshots.

The dense MCU, full USB/long-pair, DDR bus, concrete plane current/stale, full autorouter round trip, and large stress fixture evidence rows remain missing. Therefore no complete 18-row before/after quality claim is made.

## 20. Test evidence

- Focused: `npx vitest run app/lib/pcb/__tests__/stage-08-professional-routing.test.ts app/lib/pcb/__tests__/route-tool.test.ts --reporter=dot` → 35 passed.
- Full: `npm test -- --reporter=dot` → 125 files passed, 2 skipped; 792 passed, 9 skipped.
- Type/lint/build: all passed.

Covered: arbitrary topology/measurement, exact anchors, net-0/wrong-net policy, 4-layer transitions, atomic/stale/revert transactions, protection, ambiguous loops, tuning capacity, protected shove, pair identity, AI schema, 18 declarations, live candidate pullback/cancel, interior splitting, selected rip-up, walk-around, DRC/connectivity, Stage 1–7 regressions, existing import/export/autorouter tests.

Not covered to completion: geometry fuzz/property suite, full shove cascades/springback UI, via/corner/junction drag, full differential geometry/tuning, all external-router failure modes, all 18 executable fixtures, and all 31 requested categories. Nine repository skips remain; see machine evidence.

## 21. Performance report

Environment: Windows, Node v24.15.0, Intel Core Ultra 5 125U (12 cores/14 logical), test build.

| Fixture/operation | Samples | p50 | p95 | max | Result |
|---|---:|---:|---:|---:|---|
| 500 tracks, focused direct preview | 200 | 5.934 ms | 9.313 ms | 11.315 ms | pass |
| 500 tracks, loaded full-suite direct preview | 200 | 18.492 ms | 53.062 ms | 99.130 ms | p50 gate pass; tail recorded |
| forced obstacle walk-around | 80 | not captured | 0.321 ms | not captured | p95 <50 ms pass |

No complete shove, pair, measurement, tuning, commit stress, cancellation, or dense-board benchmark suite exists yet.

## 22. Files changed

- `app/lib/pcb/routing/*`: snapshot, topology, anchors, layers, protection, split, candidate/commit, measurement, shove, tuning, differential pair, service, corpus, public exports.
- `route-tool.ts`, `route-tool.commands.ts`, route preview and React hook: candidate-only live transaction, exact anchors, stackup vias, atomic command, selected rip-up.
- routing profile/types and `RoutingControls.tsx`: persisted mode/posture.
- smart-routing types/candidates/validator/engine: arbitrary posture and explicit mode behavior.
- PCB AI schemas/service: provider-neutral stable-ID routing tools.
- tests/demo/progress/artifacts: behavioral coverage and evidence.

No database migration was required; fields are optional for legacy project compatibility.

## 23. Compatibility and migration notes

Legacy boards without routing mode/posture default to Walk around and 45° A. Existing tracks/vias without provenance are treated as unknown and preserved by Stage 8 mutation paths; a future explicit backfill must classify them rather than guess. Track/via provenance fields are additive. Users will notice that intermediate clicks/vias are not committed, Backspace no longer undoes prior global work, arbitrary angles are selectable, 4-layer via continuation is physical, and right-click removes one selected segment.

Older direct command types remain for compatibility, but the live interactive path now uses `CommitRouteCandidate`. Rollback can remove the new optional controls and command path without changing stored native track geometry.

## 24. Remaining risks and later-stage recommendations

Known Stage 8 limitations:

- implement topology-preserving shove cascades, attached vias/corners, live springback, and budgets;
- implement segment/corner/junction/via drag on candidate topology;
- implement cornered differential pairs, neckdown, bounded uncoupling/recoupling, paired completion, and exact pair tuning;
- implement selected-path removal/tuning and DDR-like group targets;
- turn all 18 declarations into concrete fixtures and complete all required test categories;
- add dedicated routing HTTP API, candidate inspector, persisted replay bundles, superseded-pointer cancellation, and full performance matrix;
- finish constraint coverage and external autorouter preservation/strictness audits;
- verify Stage 8-specific native/KiCad/DSN/SES/fabrication round trips and provenance migration.

Manufacturing limits remain explicit: no arcs, blind/buried vias, or microvias. Stage 9 should own broader benchmark evidence, Stage 10 collaboration/verification can consume these stable candidates, and SI/PI/EM/thermal signoff remains outside this routing implementation.

## 25. Completion verdict

The authoritative foundation and the safer live route transaction are implemented and verified, but the exact remaining items above are required before the specification's completion bar is met.

### STAGE 8 INCOMPLETE
