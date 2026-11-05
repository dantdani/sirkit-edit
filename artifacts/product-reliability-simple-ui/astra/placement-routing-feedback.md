# Astra increment E — bounded placement → routing feedback and the capability matrix (PR-F fF, 2026-10-17)

Tree `codex/astra-foundation`, base `e581755` (checkpoint D). Builder fF. The owner's directive, section 10 ("Placement–routing
feedback"), with CONTINUATION F. Everything below was read or run on this date; labels follow the program's: **CONFIRMED** (executed
offline, or read at the cited file:line), **INFERRED**, **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**. No process, network, model or
distributor call was made by this increment: the FreeRouting engine in every run is the routing path's test double (a fake
`AutoroutePassExecutor`), and the live spend record (`../live-spend.json`) is unchanged.

## 1. What exists now

| Piece | Where | Status |
| --- | --- | --- |
| The feedback loop | `app/lib/pcb/experiments/placement-routing-feedback.ts` — `runPlacementRoutingFeedback(input)` → `sirkit.placement-routing-feedback.v1` | CONFIRMED offline (`pr-f-placement-routing-feedback`, 10 cases) |
| The capability matrix (data + resolver) | `app/lib/pcb/experiments/routing-capability-matrix.ts` — 18 rows × 4 stages, every cell an anchor resolved to `file:line` | CONFIRMED (159 citations resolve; `pr-f-capability-matrix`, 8 cases) |
| The generator | `scripts/generate-pr-f-routing-capability-matrix.ts` → `routing-capability-matrix.csv`, `routing-capability-matrix-summary.json` (this folder); registered in `scripts/generate-b24-maps.ts` `GENERATOR_OUTPUTS` | CONFIRMED (run; the drift gate byte-compares) |
| The layout-experiment computation's extension | `app/lib/computation/request-executors.ts` — `createComputationRequestExecutors({ layoutExperiment })`: an injected runner replaces the (worker-less) engine host for `sirkit.computation.layout-experiment` only; the kind's wall clock, output bound and output validator still apply; `layoutExperimentEvidenceBody(record, seed)` shapes the loop's record into the validator's body | CONFIRMED offline (case 10); DORMANT in production — no composition root binds a runner (OD-159's approval route is still absent) |

Not built, by design: a second router runner (routing is `completeAutoroute` over the injected pass executor — the engine
`runRoutingCandidate` and the autoroute route use), an apply path (the retained candidate is the shared sealed
`sirkit.layout-candidate.v1` routing candidate a human previews and applies through `applyLayoutCandidate`), a tool descriptor (no
registry, exposure or manual changes; the agent does not reach this loop in this increment), any page change.

## 2. The loop (directive 10, left to right)

```
constraints -> stackup -> [per placement candidate: placement -> routing -> import -> checks -> suggestions] -> comparison
```

Over an **isolated, revision-bound snapshot**: `{ board, revision, rules }`; `pcbRevisionId(board)` must equal `revision` or the
run refuses `snapshot_revision_mismatch` before anything is recorded; the board is `structuredClone`d at entry and never read again
(case 1 asserts the input is deep-equal before and after). Nothing touches a `PcbHistory`, a store or the live editor.

1. **constraints** — the active constraint program's hash, its enforcement coverage (counts by support; the required constraints the
   compiler marks `unsupported` / `declarative_only` / `unknown`), what the DSN writer itself declares it cannot carry
   (`boardToDsn(board).integrity.constraintLoss`), and the baseline metrics of the snapshot as given.
2. **stackup** — the approved profile and via policy must be **qualified** and equal the snapshot's: `QUALIFIED_STACKUP_PROFILES`
   admits `simple-2` only (what `evaluateAutonomousCapability` qualifies: two routable signal layers, full through vias); the three
   four-layer profiles are refused `stackup_unqualified` with the reason (no qualification exists in this build —
   `CAP_TWO_LAYER_SIGNAL_STACKUP_REQUIRED`, `CAP_NATIVE_PLANE_UNQUALIFIED`); `QUALIFIED_VIA_POLICIES = ["through"]`; a non-through
   existing via refuses too. A different layer count or profile invalidates dependent approvals (the refusal says so).
3. **placement** — the GIVEN sealed `PlacementLayoutCandidate` (B17-E; the agent's or the editor's producer) is verified against the
   snapshot (`verifyLayoutCandidate`: digest intact, not expired, same revision, hard-legal) and applied to the CLONE through
   `applyPlacementCandidate` (never a history). No candidate = the snapshot routed as placed (`as-placed`).
4. **routing** — `completeAutoroute(placed, rules, executor, { maxGlobalPasses })` through the injected port
   `PlacementRoutingExecutorPort` (the same shape as `RoutingExecutorFactory` of `sirkit.routing.propose`). Absent or unresolvable
   → the run refuses `routing_engine_unavailable` as DATA with the stages above recorded (case 2; a thrown resolver's message is
   redacted). The engine is resolved only when a routing stage is not already journaled.
5. **import** — the router's accepted pass must carry SES parse and semantic evidence (`parserStatus`/`semanticStatus` success); the
   routed copper is sealed as the shared routing candidate (`produceRoutingCandidate`, producer `agent`) over the PLACED revision.
6. **checks** — `verifyAutorouteCandidate` (connectivity per net + the DRC), `runPhysicalConstraintChecks` when a compiled program
   exists (else `not_run`), `runApplicationChecks` when an application snapshot is given (else `not_run` — the loop never invents
   voltages or rails), and the **invariants** against the snapshot (section 4).
7. **suggestions** — data only: each unrouted net → `reroute_net` / `revise_placement` (from the completion's own blockers and
   repairs), `enable_layer` when a second signal layer is the named repair (a fresh stackup approval), `resolve_drc` per DRC kind,
   `limitation` per required constraint nothing proves. Every incomplete net, every unsupported required constraint, every
   `unsupported` export loss and every non-passing physical check is an **unproven constraint** on the attempt.
8. **comparison** — the baseline, one row per attempt (valid / decision / metrics), the declared ordering, the retained attempt.

### Bounds (`PLACEMENT_ROUTING_FEEDBACK_BOUNDS`, clamped — a request may only tighten them)

| Bound | Value | Source |
| --- | --- | --- |
| `maxCandidates` (attempts) | 4 | `AUTONOMOUS_PCB_CAPABILITY_PROFILE_V1.limits.maxPlacementCandidates` |
| `maxRouterPasses` (compute per attempt) | 3 | the production router's `maxGlobalPasses` default (`production-router.ts`) |
| `maxWallClockMs` | 180 000 | `AUTONOMOUS_PCB_CAPABILITY_PROFILE_V1.limits.maxRuntimeMs`; checked between stages, passed to the port as its timeout |
| `maxOutputBytes` | 262 144 | the serialized record; over it → `output_bound_exceeded` with digests and metrics only (no routes, checks, suggestions) |
| `maxSuggestions` / `maxUnproven` | 16 / 64 | list bounds |

Tokens and cost are not this loop's: it calls no model (the Astra turn that would request an experiment is bounded by the agent run's
own budget and the computation kind's `budgetSeconds`).

### Cancellation and crash recovery

The `AbortSignal` is checked between every stage (`termination: "cancelled"`, nothing retained — the human cancelled) and handed to
the executor port. Every stage result is appended to the `FeedbackJournal` BEFORE the next stage starts, keyed by the run key (snapshot
revision, rules digest, candidate digests, approved stackup, bounds, label), the attempt and the stage's INPUT digest (the snapshot /
placed / routed revision it ran over). A resumed run with the same journal reuses exactly those stages (`resumed: true` in the trace,
`resumedStages` counted) and never resolves the engine for a journaled routing stage (case 4: four stages resumed, the engine port
never called); a different snapshot or different bounds resume nothing (case 5). The default journal is in memory
(`InMemoryFeedbackJournal`); a durable journal is the caller's.

## 3. The ordering — "retain the best valid candidate"

`BEST_CANDIDATE_ORDERING = ["connectivity_complete", "drc_errors", "unrouted", "vias", "wire_length_nm", "attempt_id"]`,
implemented by `compareFeedbackMetrics` (connectivity complete first; then fewer DRC errors; fewer unrouted connections; fewer vias;
shorter wire length; the attempt id by code points). Only VALID attempts rank (`rankFeedbackAttempts`); an attempt is valid when its
import validated and every invariant held. Case 6 pins the comparator pairwise and, in integration over three placement candidates
with one scripted to route nothing, that the retained attempt is the comparator's minimum and the scripted one is `invalid`, never
retained.

## 4. The invariants — never by relaxing anything

`checkFeedbackInvariants(snapshot, routed, baselineRequired, verification)` compares the routed candidate with the SNAPSHOT: the nets
(ids, names, stable ids, endpoint keys), the per-net width / clearance / via dimensions (`getNetClass`) and `netClassing`, the
pad-to-net assignments, the required connections per net, the protected copper (locked / human / imported / legacy), the constraint
program hash. Any difference makes the attempt `invalid` with the reason. Case 7: a router that routes the board **complete** while
lowering net 1's clearance is reported `routing: complete`, `metrics.connectivityComplete: true` — and `decision: invalid`, nothing
retained. The honest router keeps the locked human track byte-identical in the retained candidate's routes.

## 5. The capability matrix — what survives export, routing, import and the independent check

`routing-capability-matrix.csv` (18 rows, 159 citations; the summary beside it). Statuses: `exact`, `conservative`, `advisory`,
`post_route_check`, `not_applicable`, `unsupported`. Verdicts as read from the tree on this date:

| Verdict | Rows |
| --- | --- |
| **survives** | connectivity-conservation; via-policy-board (per-class size / drill, through, `(vias on|off)`, via costs); stackup-layer-roles |
| **survives-conservatively** | net-class-width-clearance (one rule per class at the most restrictive member's values; `constraintLoss: conservative`); mechanical-envelope (outline exported; the edge keep-out is NOT a DSN rule — DRC catches it after import) |
| **placement-only** (the router moves no footprint; proved at placement) | decoupling-proximity; sensitive-analog-separation-placement; connectors |
| **check-only** (found after import, never obeyed during routing) | via-policy-per-net (type / span / count); layer-policy-per-net; differential-skew (static length difference) |
| **advisory-only** | switching-loops (a perimeter proxy objective; no post-route loop-area checker) |
| **scope-only** | critical-net-priority (realized as `includeNetIds` / `selectedNetIds` scope and sequence; the placement intent states the engine takes no net-priority input) |
| **unsupported** (nothing proves them on autorouted copper) | keepouts; sensitive-analog-routing-separation; return-paths; differential-coupling-separation; impedance |

Directive 10's "do not assume FreeRouting enforces" rows are pinned `unsupported` at the routing stage by the gate:
differential-coupling-separation, differential-skew, impedance, return-paths, via-policy-per-net.

**Findings worth the owner's attention (CONFIRMED by reading the cited lines):**

- **Routing keepouts are not carried and not checked for autorouted copper.** `write-dsn.ts` emits no keepout; DRC's ten checks
  (`run-drc.ts:119-128`) include no keepout check; only the INTERACTIVE Smart Route validator refuses a route entering a keepout
  (`smart-routing/validator.ts`), and placement treats keepouts as regions. A required keepout is therefore an explicit limitation of
  the FreeRouting path until the writer carries it and DRC checks it.
- **Edge clearance is not a DSN rule**: FreeRouting may route to the outline; DRC `edgeClearance` catches it afterwards (the candidate
  stays unproven, never silently accepted).
- **Return paths, differential coupling and impedance** have no export construct, no FreeRouting rule and no independent checker
  (`return_reference` has no `DEFAULT_SUPPORT` entry → the compiler's `unsupported` fallback; `target_impedance` is declared
  `unsupported`; `differential_pair` is `compiled_for_consumer` for a later stage). `BoardStackup` carries thickness only — no
  dielectric data, so no impedance claim is possible (directive 9).
- **Skew** is measurable after import (`physical-checker.ts` `pair_skew`), so a skew requirement is checked, not enforced.

## 6. Evidence

- `app/lib/pcb/experiments/__tests__/pr-f-placement-routing-feedback.test.ts` — 10 cases (stage chain and journal; engine absent;
  unqualified stackup / stale snapshot; cancellation then resume; resume key; ordering; invariants; unproven net with suggestions;
  bounds; the computation runner path). 18/18 with the matrix gate, `timeout 600 pnpm exec vitest run --reporter=dot app/lib/pcb/experiments`.
- `app/lib/pcb/experiments/__tests__/pr-f-capability-matrix.test.ts` — drift (byte compare of CSV and summary), every citation's line
  holds its anchor, kinds are members of `ConstraintKind` / `RelationshipKind`, compiler support entries are the compiler's own lines,
  closed status / verdict sets, reasons on every unsupported cell and row, the directive-10 pins and the dated findings.
- Existing suites that import the touched modules: `autoroute-completion`, `b17-e-layout-candidates`, `b22-b-approval`,
  `b22-b-bounded-host`, `b22-b-no-generic-exec`, `b22-a2-process-census` green; `b22-closeout-statements` has two failures that
  predate this increment (its page pins line numbers of `b20-b4-withhold-proposals.test.ts`, which the concurrent fB builder's
  additions shifted by two lines; nothing in this increment touches that file or that page).
- `tsc`: 0 errors in this increment's files (one error remains in another builder's `app/lib/pcb/candidates/stackup-candidate.ts:202`);
  `eslint`: 0 on the touched files.
- Not run here: `autonomous-layout-qualification` (it starts the REAL bundled FreeRouting through `createAutonomousGoldenRealRouter`;
  no module it imports was changed) and the whole suite.

## 7. Live blockers (exact; nothing here is a live claim)

| Blocker | What this increment cannot establish | Unblocks |
| --- | --- | --- |
| **LB-3** (live routing in CI; the contained routing platform) and **LB-8** (a routed board in a browser journey) | Whether the real FreeRouting 2.2.4 completes, under the bounds above, the boards an Astra placement candidate produces; every run here is the fake executor. The loop's engine port is the production `freerouting-pass-executor.ts` path when a composition root resolves it — no composition root does so for this loop yet. | a qualified runner or container profile with the runtime (LB-3); an extended route recording for the journey (LB-8) |
| **LB-7** (a real model's chat execution) and **LB-9** (live specialist disagreement / fallback / quota) | Whether Astra (`gpt-6-astra`, qualifiable only — increment A) proposes placement candidates that route better than the deterministic baseline; the directive's section 13 comparison (deterministic placement + FreeRouting vs Astra-guided placement + the same FreeRouting, identical budgets) needs a live model AND the contained router. | owner credits with a spend cap (price table + `--spend-cap`, OD-216); the live-spend record stays 0.19 USD of 5.00 |
| **spend** | No token / cost bound is this loop's to enforce — the agent run's budget and the computation kind's `budgetSeconds` bound the turn that would request an experiment. | the same owner record |

## 8. Honest notes and open items for the lead

- The loop is reachable from no production surface: the agent has no tool that calls it (adding one is a registry change this
  increment did not make — the lead decides), and the layout-experiment computation reaches it only through the injected
  `layoutExperiment` runner, which no composition root binds (the request's `basis.canonicalRevisionDigest` would have to be resolved to
  a snapshot server-side; the kind's closed input `{ experiment: "placement", seed, budgetSeconds }` carries no candidate — a new
  enum value or field would be a registry-digest change).
- Four-layer profiles are refused as unqualified; the directive's "qualified two- AND four-layer profiles" is therefore
  **two-layer only in this build** until a four-layer qualification (stackup, planes, via spans, DRC) exists.
- Application checks run only over a given `ApplicationCheckSnapshot`; the loop never invents voltages, rails or decoupling facts.
- The matrix's citations are line numbers of files other builders edit concurrently (notably `app/lib/pcb/placement/intent.ts`); a
  moved line changes the CSV and the drift gate asks for a regeneration — `pnpm exec tsx scripts/generate-pr-f-routing-capability-matrix.ts`.
- `generate-b24-maps.ts` was re-run after registering the generator; the B24-F inventory lists the CSV as `byte-pinned-outside-CI`
  (check `bytes`) and the summary as `content-checked`, both by `pr-f-capability-matrix.test.ts`; `b24-f-generator-inventory` is green.
  The `generators` count line of `artifacts/ai-control-plane-b24/executive-summary.md` moved 30 -> 31 with a dated note (section 3).
  `b24-f-verdict-lines` case 6 still lists count lines that are the concurrent builders' to move (registry-tools 52 -> 56,
  agent-exposed-tools 40 -> 44, agent-exposed-proposal-tools 6 -> 9, agent-only-tools 31 -> 35, control-sites 636 -> 640,
  control-surfaces 64 -> 65): their descriptors and controls, not this increment's.
- Pin moves by this increment: exactly one (the generators count above). No registry, exposure, MCP, tier or manual pin moved: no
  descriptor was added.
