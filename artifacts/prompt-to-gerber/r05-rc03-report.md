# R05-RC03 Autonomous Placement and Routing Capability Qualification

## 1. Verdict and repository fingerprints

**Verdict: `COMPLETE`.** Sirkit now has an explicit, fail-closed Autonomous PCB Capability Profile v1 and a deterministic coordinator that evaluates eligibility, builds isolated placement candidates, rejects physically illegal candidates, routes a bounded subset through the existing RC02 contract, independently re-verifies the returned PCB, and commits exactly one selected board only after all gates pass. Three consecutive no-edit runs on the measured golden board completed with zero placement violations, remaining connections, shorts, and route-blocking DRC errors.

This verdict qualifies the bounded v1 envelope only. It does not authorize Gerber output or a manufacturing release.

| Item | Evidence |
|---|---|
| Working repository | `C:\Users\robsa\Documents\Codex\2026-07-13\do\work\sirkit-edit` |
| Protected original | `C:\Users\robsa\sirkit` exists and was not modified |
| Branch | `codex/cd-13-full-flow-orchestrator` |
| HEAD | `2bd1603a775bd4b409b89710cd4e5f8d70201632` |
| Starting status fingerprint | `0edee71a1a715fb6902a9c8a77b5b624cb2276de3019c59b0134200f7a5ea275` (343 short-status entries) |
| Final status fingerprint | `e16b535fbaae22ab7f0da17af4f9b9f802f1fe699c7ef43a1a1cddd32fe8288d` (345 short-status entries; normalized LF, no terminal newline) |
| R03-B10D Retry 02 | `COMPLETE_DEMO` |
| R05-RC01 | `artifacts/prompt-to-gerber/r05-rc01-report.md`: `COMPLETE` |
| R05-RC02 | `artifacts/prompt-to-gerber/r05-rc02-report.md`: `COMPLETE` |
| Starting TypeScript | exit 0, zero diagnostics |
| Final TypeScript | exit 0, zero diagnostics |
| FreeRouting | bundled `2.2.4`; 57,766,203 bytes; SHA-256 `f5ed374182900ccc78e473518bbb9f6b869f4a07159495f663a76f52bb10523b` |
| Java | bundled Temurin OpenJDK `25.0.3+9` LTS |

The repository was substantially dirty before RC03. All pre-existing dirty and untracked work was preserved. No reset, clean, stash, stage, commit, push, rebase, broad formatting, dependency update, lockfile update, migration, database, or runtime/binary update was performed.

## 2. Current placement, AI, and native mutation call graph

```text
Provider-neutral AI tool call
  -> PCBToolService.call
     -> evaluate_autonomous_capability
        -> evaluateAutonomousCapability (pure; no board mutation)
     -> qualify_autonomous_layout
        -> qualifyAutonomousLayout
           -> pre-placement capability evaluation
           -> runEngineeringPlacement (seeded candidates; isolated boards)
           -> hard legality reports
           -> applyPlacementCandidate (isolated candidate only)
           -> pre-autoroute capability re-evaluation
           -> injected RC02 AutonomousRouteExecutor
              -> boardToDsn / validateDsn / bundled FreeRouting
              -> strict SES import / completeAutoroute
           -> verifyAutorouteCandidate against exact returned board
           -> protected-copper byte comparison
           -> post-layout capability re-evaluation
           -> deterministic successful-candidate ranking
           -> PCB history.execute once, with source-revision recheck

Native/manual placement
  -> Stage 7 runEngineeringPlacement preview
  -> applyPlacementCandidate
  -> hard legality + source/constraint revision checks
  -> history transaction / undo

Interactive routing
  -> route-tool selection/preview
  -> shared routing protection policy
  -> RouteCommand
  -> apply mutation boundary (protection rechecked)
  -> history transaction / undo

Autoroute/reroute/repair
  -> RC02 completion controller / repair preview
  -> exact candidate revision + reconstructed connectivity + DRC
  -> protected copper restored/revalidated
  -> stale-preview check
  -> one history transaction or no mutation
```

The complete placement-to-route-to-verify sequence is callable through provider-neutral native tools. It has no dependency on DOM state, UI clicks, or local component state. `PCBToolService` still keeps ordinary placement as preview-only; the new autonomous tool is the explicitly bounded exception and can commit only a fully verified result.

## 3. Autonomous PCB Capability Profile v1

Machine-readable ID: `sirkit.autonomous-pcb-capability.v1`  
Evaluation schema: `sirkit.autonomous-capability-evaluation.v1`

| Limit | Exact v1 value |
|---|---:|
| Routable copper layers | exactly `copperTop`, `copperBottom` |
| Via type | full top-to-bottom through-via only |
| Maximum board width | 100 mm |
| Maximum board height | 80 mm |
| Maximum board area | 8,000 mm² |
| Maximum components | 25 |
| Maximum pads | 64 |
| Maximum electrical nets | 30 |
| Maximum required connections | 30 |
| Maximum placement candidates | 4 |
| Maximum routed candidates | 2 |
| Maximum total controller runtime | 180,000 ms |

The limits are conservative relative to the measured 50 mm x 32 mm, 15-component, 15-pad, 5-net, 10-connection fixture. Exact boundary tests prove 100 mm x 80 mm is accepted and an additional nanometre is rejected; 25 components is the maximum and 26 is rejected.

Evaluation is pure and deterministic. It returns `eligible`, `unsupported`, `incomplete_authority`, or `invalid`, plus:

- profile ID/version, source PCB semantic revision, declaration identity/revision, and rule digest;
- evaluated board dimensions, stackup, routable layers, and exact object counts;
- sorted stable blocker codes with object IDs;
- a deterministic evaluation digest;
- separate `placementMayStart`, `autoroutingMayStart`, and `manufacturingReleaseMayEventuallyBeConsidered` gates.

It runs before placement, before autoroute, and after layout. A semantic revision mismatch produces `CAP_SOURCE_REVISION_STALE` and invalidates the evidence.

## 4. Supported and unsupported feature matrix

| Area | v1 result | Gate/evidence |
|---|---|---|
| Two-layer rigid PCB | Supported | exactly top and bottom routable copper |
| Rectangular/rounded-rectangular closed outline | Supported | positive safe-integer nanometre dimensions |
| Full through-vias | Supported | both top and bottom layers required |
| Ordinary low-speed digital/analog and low-voltage power | Supported when explicitly declared | `ordinary_low_speed_low_voltage` declaration |
| 0603/0805, SOIC/TSSOP, THT headers, proven non-HDI packages | Supported when exact authority is proven | qualification by exact footprint ID plus RC01 mapping |
| Current native conductive zones | Supported | fill proof must be current |
| Explicit compiled critical-placement constraints | Supported | every declared constraint ID must exist in the active compiled program |
| Four-layer/signal-plane stackup | Rejected | `CAP_TWO_LAYER_SIGNAL_STACKUP_REQUIRED` |
| Native/internal plane declaration | Rejected | `CAP_NATIVE_PLANE_UNQUALIFIED` |
| Blind/buried/microvia/via-in-pad | Rejected | `CAP_VIA_TYPE_UNSUPPORTED` |
| BGA/HDI escape packages | Rejected | `CAP_PACKAGE_UNSUPPORTED` |
| Differential/high-speed/RF/controlled-impedance class | Rejected | `CAP_ELECTRICAL_CLASS_UNSUPPORTED` |
| High-voltage/mains/safety creepage | Rejected | electrical/safety blocker |
| High-current or thermal-critical layout | Rejected | `CAP_THERMAL_CLASS_UNSUPPORTED` |
| Flex/rigid-flex/special construction | Rejected | `CAP_CONSTRUCTION_UNSUPPORTED` |
| Unknown risk metadata | Not eligible | `CAP_RISK_DECLARATION_MISSING` or `CAP_RISK_CLASSIFICATION_UNKNOWN` |
| Missing footprint/pin-pad authority | Not eligible | footprint qualification, authority, parity, or connected-pad blocker |
| Stale zone fill/rules/placement/routing evidence | Not eligible | explicit authority/invalid blocker |
| Out-of-envelope size/count/runtime | Rejected | stable limit blocker |

No electrical or safety class is inferred from a net name, capacitor value, reference designator, or free-form prompt.

## 5. C-03, C-05, and C-08 disposition

### C-03 locked copper

The audited stretch and net-rip-up paths were traced to `route-tool.ts`, `route-tool.commands.ts`, the shared `routing/protection.ts` classifier, batch edit validation, repair transactions, and RC02 candidate construction. The original audited defect is already retired in the current protected copy:

- stretch checks protection at selection/junction time and `StretchTrack` checks it again at the command mutation boundary;
- rip-up collects locked objects as protected and rechecks the current board while applying;
- generic batch edits fail the whole command if a locked object is mixed with mutable objects;
- automated repair removes only unlocked generated (`ai`/`autorouter`) copper;
- imported/manual/unknown-provenance copper is preserved by automated paths;
- RC02 candidate construction restores protected geometry before verification.

RC03 adds six focused regressions proving locked stretch denial, locked track/via rip-up preservation, mixed batch rejection, width/layer/position/padstack/zone/delete denial, malicious autoroute replacement denial, and stale AI preview denial after a new lock. C-03 is therefore recorded as already fixed and now qualification-locked, not falsely claimed as newly rewritten.

### C-05 native plane conductivity

Not fixed by RC03. Four-layer and native-plane designs fail closed before placement. Conductive-plane reconciliation remains outside v1.

### C-08 four-layer manual switching

Outside the no-edit two-layer profile. The experimental/manual feature may remain, but it cannot receive v1 autonomous status.

## 6. Placement legality and critical-constraint contract

Every placement candidate is generated by the existing Stage 7 engine and must pass its hard report before routing. The hard report covers footprint/courtyard overlap, outside-board geometry, pad outside-board geometry, keepouts, legal side/rotation, fixed/locked/mechanical state, compiled constraints, RC01 identity preservation, and protected copper. Candidate application rechecks the source PCB revision, placement problem revision, active constraint-program hash, candidate hash, protected copper, and post-application hard legality.

Critical intent is never guessed. The versioned declaration supports only:

- `none` when no critical intent exists;
- `fully_declared` with exact constraint IDs that must be active in the compiled placement program;
- `required_but_missing`, which blocks before placement.

Tests cover fixed/locked byte equivalence, keepout and inside-board validation, stale/tampered candidate rejection, deterministic replay, missing critical metadata, and declared constraint IDs absent from the active program.

## 7. Bounded candidate search and actual routing feedback

1. Clamp requested candidate count to 1-4, routed-candidate count to 1-2, and runtime to at most 180 seconds.
2. Deduplicate deterministic seeds and create one Stage 7 placement run.
3. Reject every hard-illegal candidate without applying or routing it.
4. Rank legal placements deterministically by selected marker, weighted placement penalty, ratsnest length, and candidate ID.
5. Apply only to isolated candidate boards through the existing revision-bound Stage 7 transaction function.
6. Re-evaluate capability at `pre_autoroute` with zero-overlap/outside/pad-outside evidence.
7. Route at most two candidates through the existing RC02 executor.
8. Independently run `verifyAutorouteCandidate` on the exact returned board. Proxy score cannot produce success.
9. Accept only RC02 `complete` plus exactly zero remaining connections, shorts, and route-blocking DRC errors.
10. Re-evaluate capability at `post_layout`, then rank successful real routes by via count, routed length, placement penalty, and candidate ID.
11. Revalidate source revision and protected copper, then invoke the optional commit callback once.

Partial, failed, timed-out, cancelled, stale, or invalid route results remain blocked. If every bounded attempt fails, the authoritative input board is unchanged.

## 8. Protected-copper policy

The coordinator snapshots locked, human, imported, and unknown-provenance tracks/vias before placement. Every returned route must preserve this set byte-for-byte. Placement itself must report protected state preserved. RC02 and repair boundaries retain their existing source-revision and lock validation. The AI rip-up test proves that adding a lock after preview makes apply fail rather than using stale authorization.

An explicit user unlock is a separate undoable transaction. No route or repair operation silently unlocks, clones, renets, moves, or deletes protected copper.

## 9. Qualification coordinator contract

`qualify-layout.ts` is orchestration over existing engines; it is not another placer, router, connectivity engine, or DRC engine.

Inputs:

- authoritative `PcbBoard`, semantic revision derived from it, and exact `DrcRules`;
- explicit `AutonomousDesignDeclaration`;
- project ID, deterministic seeds, bounded placement/routing counts, runtime, and cancellation signal;
- injected RC02 `AutonomousRouteExecutor`;
- optional atomic commit callback.

Outputs (`sirkit.autonomous-layout-qualification.v1`):

- deterministic run ID, source revision, and capability evaluation;
- complete placement run and every placement/routing attempt;
- hard legality, seed, initializer, objective, ratsnest, and rejection reasons;
- RC02 status, pass IDs, DSN/SES digests, runtime versions, connectivity/DRC counts, vias, and routed length;
- selected board, verification, revision, and final capability only on success;
- exact blocker list, elapsed time, and whether authority was mutated/committed.

`PCBToolService.qualifyAutonomousLayout` checks the current history revision immediately before `history.execute`, replaces the authoritative board in one transaction, and verifies that the committed semantic revision equals the selected verified revision.

## 10. Golden-board fixture

The measured fixture begins unrouted and uses normal legal staging positions:

- 50 mm x 32 mm rectangular, rigid, two-layer board;
- 15 exact through-hole endpoint/module footprints and 15 pads;
- five independent low-speed peripheral nets, each with three authoritative endpoints;
- ten required connections total;
- stable net IDs, endpoint keys, RC01 sync identities, and exact pin/pad mappings;
- explicit ordinary low-speed/low-voltage, ordinary thermal/safety, rigid construction declaration;
- JLCPCB two-layer explicit rules;
- no RF, high speed, differential pair, high voltage, plane, BGA, pre-routed copper, or inferred critical intent.

The topology is deliberately conservative: it is materially larger than the RC02 LED/simple fixture but stays inside the package and routing evidence demonstrated reliably by the current engine. An earlier denser all-SMD trial completed only 8/10 connections and was correctly rejected rather than used to inflate the profile.

## 11. Three real bundled-FreeRouting runs

Every run started from the same deep-equal authoritative unrouted board. Each created three placement candidates, routed at most the best two, selected by real route evidence, invoked the commit callback exactly once, and left the source object unchanged.

| Run | Run ID | Placement candidate / seed | DSN / SES digest | Router/pass | Vias | Length | Runtime | Final revision | Result |
|---:|---|---|---|---|---:|---:|---:|---|---|
| 1 | `autolayout-8122f555` | `placement-candidate:dbbb5dbdc23658e42db83fff` / 101 | `dsn-e99a278e` / `ses-9cfe65f5` | 2.2.4 / `rc03-placement-candidate:dbbb5dbdc23658e42db83fff-p1-63ab955a` | 0 | 68,596,334.839 nm | 10,419 ms | `pcb2-82c32e0f68b94690` | PASS |
| 2 | `autolayout-c3d64f28` | same / 101 | `dsn-e99a278e` / `ses-d8e96c21` | 2.2.4 / same pass ID | 0 | 68,596,334.839 nm | 10,602 ms | `pcb2-82c32e0f68b94690` | PASS |
| 3 | `autolayout-578429d7` | same / 101 | `dsn-e99a278e` / `ses-c65b7cd1` | 2.2.4 / same pass ID | 0 | 68,596,334.839 nm | 10,124 ms | `pcb2-82c32e0f68b94690` | PASS |

For all three runs: placement overlaps = 0, footprints outside = 0, pads outside = 0, protected-state violations = 0, remaining connections = 0, shorts = 0, and route-blocking DRC errors = 0. FreeRouting emitted different SES byte digests, but the authoritative routed PCB semantic revision was identical.

## 12. Truthful failure and no-mutation cases

| Case | Result | Mutation/router evidence |
|---|---|---|
| Four-layer signal/plane board | blocked before placement | router calls 0; stable stackup/plane blocker |
| 26-component over-limit board | blocked | deep-equal before/after; router calls 0 |
| Missing critical placement metadata | blocked | router calls 0 |
| Missing/unknown risk declaration | not eligible | pure evaluator only |
| Blind/non-through via, BGA/HDI, high-speed, RF, high-voltage, flex, thermal | blocked | stable feature blocker |
| Pre-cancelled run | `cancelled` | router calls 0; no commit |
| Stale router source revision | blocked | source deep-equal; no commit |
| RC02 partial status | blocked | source deep-equal; no commit |
| Locked-copper stretch/rip/edit/autoroute attack | denied/preserved | exact copper assertions pass |
| Lock added after AI preview | apply rejected | mixed net preserved; no stale authorization |

## 13. Qualification commands and results

| Command/gate | Result |
|---|---|
| `npx vitest run app/lib/pcb/__tests__/autonomous-layout-qualification.test.ts --pool=threads --maxWorkers=1 --testTimeout=180000` | 5/5 passed; three real runs |
| Auto-place/envelope/collision/routeability and all Stage 7 placement suites | 64/64 passed across 10 files |
| Route command/history/tool-service/lock plus RC01 identity and RC02 completion/verification/boundary suites | 88 passed, 1 conditional integration test skipped across 13 files; real simple/crossing RC02 tests passed |
| `npx vitest run app/lib/pcb/__tests__/route-tool.test.ts --pool=threads --maxWorkers=1` | 25/25 passed; 500-track p95 27.976 ms, below 50 ms budget |
| Focused total | **182 passed, 1 skipped, 0 failed** |
| `npx tsc --noEmit` | exit 0, zero diagnostics (baseline and final) |
| `npx eslint` on all seven RC03 product/test files | exit 0, zero findings |
| `git diff --check` on tracked RC03 files | exit 0 |

The Stage 7 crowded-corpus test emits its expected diagnostic that four forced-overflow components remain overlapping; its assertions pass because the engine truthfully reports/reduces the physical overflow. Such a candidate cannot pass the RC03 hard legality gate.

No database was needed because the final authoritative commit uses the existing in-memory PCB history transaction boundary.

## 14. Exact files and RC03 churn

Product/test files changed by RC03: **7** (limit 15).  
Stage-specific product/test churn: **+1,094 / -0** (limit 1,800 combined).

The working tree predates RC03 and cannot be measured against `HEAD` as if all existing changes belonged to this stage. RC03 churn was calculated from the frozen starting line counts/content for the three already-dirty files plus the four newly created files: new files 1,037 lines; `pcb-tool-service.ts` +44; `pcb-tool-schemas.ts` +2; `pcb-repair-agent.test.ts` +11. RC03 made no deletions.

| Classification | File | Final SHA-256 | Lines | RC03 change |
|---|---|---|---:|---:|
| Production, new | `app/lib/pcb/autonomous/capability-profile.ts` | `83c7a15c1692433c952df86c87790067cbb14f04b7d37d31078429a26df703f8` | 252 | +252 / -0 |
| Production, new | `app/lib/pcb/autonomous/qualify-layout.ts` | `e81847ad1320b71bbb86e6a9d7060f060b03d8e086d8d82fad5e412215208e59` | 323 | +323 / -0 |
| Production | `app/lib/pcb/ai/pcb-tool-service.ts` | `49346f410763d705ff5344c028cad2dada61f2f986d37da53f01d6337f434ba5` | 520 | +44 / -0 |
| Production | `app/lib/pcb/ai/pcb-tool-schemas.ts` | `2e7c3f9eb4d460b934c1ece1fa36dd9fc3144ad4e17861c44b744302eff6febe` | 61 | +2 / -0 |
| Cross-boundary test, new | `app/lib/pcb/__tests__/autonomous-layout-qualification.test.ts` | `44abaa09bc511743db3421e80a9f9c4efcd1d2c444d17aeb8b5c3cceae191cf7` | 313 | +313 / -0 |
| Focused test, new | `app/lib/pcb/__tests__/locked-copper-integrity.test.ts` | `d7096142afd91284452fbe288d8594863b706607676fbde1d08c81eec2c91569` | 149 | +149 / -0 |
| Focused existing test | `app/lib/pcb/__tests__/pcb-repair-agent.test.ts` | `a4048c2b742600669ebd4b527468ae92789e92c6dddbb975f03919ea0b524505` | 222 | +11 / -0 |

The only non-product/test file created is this required report.

## 15. Forbidden-path and cleanup confirmation

- No RC01 schematic/PCB-sync/DSN authority file changed.
- No RC02 SES/autoroute/DRC correctness file changed.
- No editor, assignment, authentication, Gerber, manufacturing exporter, plane implementation, schema, migration, dependency, lockfile, binary, or bundled runtime changed by RC03.
- `route-tool.ts`, `route-tool.commands.ts`, `auto-place.ts`, `routeability.ts`, `envelope.ts`, and `snapshot.ts` required no product edit; their existing engines/public contracts were reused and regression-tested.
- Pre-existing `package.json`, lockfile, migration/schema, and unrelated worktree changes remain present but are outside and unchanged by this RC03 batch.
- No generated DSN, SES, route, Gerber, database, or runtime artifacts were committed or retained by RC03.
- Nothing was staged, committed, pushed, cleaned, reset, stashed, or reformatted broadly.

## 16. Authorization after RC03

`R05-MFG01` Gerber/manufacturing release hardening is authorized to begin because the bounded RC03 prerequisite is complete. This is authorization for the next qualification stage only.

Actual Gerber release, manufacturing release, and R04D final qualification remain **not authorized** until their own hardening and acceptance gates pass.
