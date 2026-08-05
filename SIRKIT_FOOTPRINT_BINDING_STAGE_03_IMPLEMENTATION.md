# Sirkit Footprint Binding Stage 3 Implementation Evidence

## 1. Verdict

BLOCKED

The Stage 3 safety engine is implemented and its supported Sirkit JSON-board profile is executable: complete read-only preflight, Stage 2-only resolution, exact mapping/materialization, stable reconciliation, immutable plan, separately authorized staged apply, atomic audit/replay semantics, recovery, UI/API contracts and router handoff all pass focused qualification.

It is not approved as production schematic-to-PCB authority. The current product stores schematic/PCB projects in browser `localStorage`; Stage 3 has no durable server snapshot/board/plan/audit transaction qualified across process restart. Stage 1/2 isolated PostgreSQL apply/rollback/restart remains unproven, nine repository tests are skipped, default maximum-parallel full runs expose an unrelated PCB-repair timing flake, and broad repository lint still has 30 errors/13 warnings outside Stage 3. `SIRKIT_PCB_SYNC_STAGE3` therefore defaults to `off`, the legacy button remains unchanged, and there is no current design-data risk from this implementation.

Smallest next action: implement a durable compare-and-swap repository plus trusted server-side project snapshot coordinator, then run isolated PostgreSQL and crash/restart qualification before any opt-in cutover.

## 2. Prerequisite evidence

- Stage 1 model/service/readiness/migration: `app/lib/physical-binding/{types,repository,readiness}.ts`, `drizzle/0022_footprint_binding_stage01.sql`, `docs/physical-binding-stage-02-handoff.json`.
- Stage 1 report: `SIRKIT_FOOTPRINT_BINDING_STAGE_01_IMPLEMENTATION.md`; strict verdict remains `BLOCKED` on live database/restart and repository hygiene, while its focused contract suite passes 25/25.
- Stage 2 sole resolver: `app/lib/footprint-resolver/service.ts#FootprintResolutionService`, policy `sirkit.footprint-resolution-policy/1.0.0`, handoff `docs/footprint-resolver-stage-03-handoff.json`.
- Stage 2 report: `SIRKIT_FOOTPRINT_BINDING_STAGE_02_IMPLEMENTATION.md`; focused resolver suite passes 39/39.
- Stage 3 accepts only `status === resolved` with exact `resolvedBinding`, layout readiness, asset version/content digest, binding revision and verified mapping. All other statuses block. Stage 1/2 production schemas were not weakened or migrated.

## 3. Repository discovery and legacy flow

Full flow map: `SIRKIT_PCB_SYNC_STAGE_03_REPOSITORY_DISCOVERY.md`.

- UI entry: `app/components/pcb/SyncButton.tsx`; caller/mutation boundary: `app/components/pcb/PcbEditor.tsx#handleSync`.
- Legacy sync/decision/mutation: `app/lib/pcb/netlist-bridge.ts#syncFromSchematic`, internal `resolveFootprint`, `buildNetlist`, `app/lib/pcb/package-map.ts#guessPackageToken/#heuristicFootprint`.
- Separate legacy default path: `lib/footprint-assign.ts`.
- Mapping helper: `app/lib/pcb/pin-pad-mapping.ts`; it is not promoted to Stage 4 authority.
- Board model/revision/persistence: `app/lib/pcb/types.ts`, `app/lib/pcb/revision.ts`, `app/lib/pcb/board-persistence.ts`, `lib/persistence.ts`.
- Downstream router: `app/lib/pcb/dsn/*`, `app/api/pcb/autoroute/route.ts`.
- Existing bridge can resolve/default and build a changed candidate in one call, then client history/local storage publishes it. Stage 3 imports none of its decision functions.

## 4. Implemented architecture

- Contracts/schemas: `app/lib/pcb-sync/types.ts`.
- Snapshot canonicalization/technical IDs: `stable.ts`.
- Versioned safe policy: `policy.ts`.
- Snapshot and exact atomic resource adapters: `providers.ts`.
- Board record, inspector and risk classifier: `board.ts`.
- Stable component/net reconciliation: `reconciliation.ts`.
- Pure readiness/gate engine: `engine.ts`.
- Deterministic immutable plan: `plan.ts`; lifecycle: `lifecycle.ts`.
- Orchestration, complete Stage 2 batches and revalidation: `service.ts`.
- Explicit mutation and post-stage validator: `executor.ts`.
- Lock/transaction/idempotency/audit adapter: `repository.ts`.
- Human authorization: `authorization.ts`.
- Router handoff: `handoff.ts`.
- Feature rollout/comparison/legacy guard: `rollout.ts`.
- Pseudonymized metrics: `observability.ts`.
- API: `app/api/pcb-sync/{_scope,handler,route}.ts`.
- UI: `app/components/pcb/PcbSyncReadinessPanel.tsx`.

## 5. Supported capability profile

| Profile | Result |
|---|---|
| New `sirkit-json-pcb/1` board | supported by engine, staging and tests |
| Empty/unplaced/placed unrouted Sirkit board | supported when every exact operation is safe |
| Routed board metadata-only refdes rename | supported; unrelated board state must be identical |
| Routed/zoned/constrained/locked structural change | visible blocked operation; deferred to Stage 8 |
| Unknown root board construct | blocked, never dropped |
| Arbitrary `.kicad_pcb` parse-modify-write | unsupported; no lossless transaction is proven |
| Durable restart-safe publication | unproven; in-memory qualification adapter only |
| Placement quality/routing/zone repair | explicitly not performed |

New components receive deterministic staging-strip coordinates, not placement optimization. The only supported board backend is the repository's canonical Sirkit JSON model.

## 6. Readiness and representative preflight results

| Case | Deterministic result | Board mutation |
|---|---|---|
| exact mapped STM32 fixture/new board | `ready_to_apply`; create board/net/component/pad operations | none during preflight |
| same committed design | `ready_no_changes`; validated preserve-only plan | none |
| generic `J1` | `blocked_component_resolution`, exact reference/stable ID | none/no board created |
| value-only `100n` | `blocked_component_resolution`; output contains no `0603` | none |
| missing pin mapping | `blocked_mapping`, `PS_MAPPING_PIN_MISSING` | none/no partial transfer |
| refdes rename on routed board | metadata-only applicable plan | none until explicit apply |
| footprint replacement on routed/zoned board | `blocked_board_risk`, Stage 8 reason | none/copper preserved |
| routed net-membership change | `blocked_net_integrity` or board risk with exact net finding | none/copper preserved |
| stale board revision | `blocked_stale_snapshot` | none |
| unknown board construct | `blocked_board_risk` | none |

Every result includes component/net/board assessments, global gates, all blockers/warnings, exact counts, policy versions and bounded safe trace. `summary.boardChanged` is always false.

## 7. Plan and apply behavior

Plans bind exact scope, snapshot/board revisions and digests, sorted explicit operations, blocked operations, gates, resolver decisions, immutable footprint materializations, expected component/net sets and policy versions. Technical identity ignores request time/actor/display summary but includes all engineering inputs; reordered snapshot arrays and different request IDs/times produce the same plan.

Preview creates only a `validated` plan. `prepare_apply` may create `applicable` only when there are material safe operations and no blocker. Apply requires exact plan ID/digest/lifecycle, human editor/admin, `apply_exact_plan`, idempotency key and non-expired plan. Under a per-board lock it reruns complete preflight, requires the same plan digest, clones, executes decoded operations, serializes/reparses, validates and atomically publishes. Unknown operation kinds, tampered plans and blocked plans fail closed.

## 8. Connectivity behavior

Components reconcile by `componentInstanceId`, never refdes. Nets reconcile by `stableNetId`, never display name. Each schematic member must map through one verified mapping artifact to exact pad numbers. Stage 3 checks mapping certificate/verifier, symbol/footprint asset identities and every pin/pad. It blocks missing/unmapped pins, duplicate stable identities, pad ownership conflicts, label collisions, unintended merge/split, and routed membership changes. Power/ground classification is retained but never used to invent a connection. Applied instances persist binding/asset/mapping/symbol/plan identity in `FootprintInstance.syncIdentity`.

## 9. Rollout and router handoff

`SIRKIT_PCB_SYNC_STAGE3` states are `off`, `observe`, `opt_in`, `authoritative_safe_profile`; invalid/missing values resolve to `off`. Observation comparisons classify legacy guesses/defaults, partial mutation and board risk without altering production behavior. Apply requires `opt_in`/authoritative state and an additional HTTP opt-in header. Per-component fallback is forbidden; rollback can only switch the whole feature version.

`sirkit.pcb-router-handoff.v1` is built only inside the committed result and pins board revision/digest, plan/audit, variant, counts, structural pass and placement/routing state. No handoff is emitted by preflight or failed apply.

## 10. Security and operations

- Scope headers are mandatory and overwrite request-body tenant/project/branch/actor.
- Preview is readable by project roles; prepare requires editor/admin; apply requires a human editor/admin. AI cannot apply.
- Public API requires JSON, caps payloads at 8 MB, accepts no snapshot/board/path upload, and uses `no-store`.
- Board names reject traversal, separators, stream/device-unsafe characters and client target extensions.
- Policy caps: 4,096 components, 32,768 nets, 131,072 operations, 8,192 trace steps, 2-second lock, 15-minute plan TTL.
- Stage 2 requests are deterministic batches of 256 with four-batch concurrency; resources parse in chunks of 16.
- Telemetry pseudonymizes project identity and records only versions/counts/status/codes/risk/duration; raw tenant/project, board/schematic data and secrets are absent.
- Audit and idempotency records are atomic with board/plan in the adapter. Deployment rate limits, durable capacity and restart recovery remain unproven.

## 11. Verification evidence

| Command | Exit/result | Evidence |
|---|---|---|
| focused Stage 1+2+3/API/UI Vitest | 0; 117/117, 17 files | includes 25 Stage 1, 39 Stage 2, 53 Stage 3 |
| Stage 3 focused ESLint with `--max-warnings=0` | 0; 0 errors/0 warnings | all new production/API/UI/tests/evidence script |
| `pnpm exec tsc --noEmit --pretty false` | 0; no diagnostics | whole repository |
| full Vitest, `--maxWorkers=4` | 0; 1,359 pass, 0 fail, 9 skipped | `artifacts/footprint-binding-stage-03/full-suite-bounded.json` |
| default-parallel full Vitest attempts | nonzero; 2 then 1 unrelated timing assertions | isolated rerun 18/18 passes; artifacts retained |
| `pnpm exec drizzle-kit check` | 0; `Everything's fine` | no Stage 3 migration added |
| `pnpm build` | 0 | Next 16.2.6; `/api/pcb-sync` present; five unrelated dynamic-spawn tracing warnings |
| broad `pnpm exec eslint . --max-warnings=0` | 1; 30 errors/13 warnings | same unrelated count as Stage 2; zero Stage 3 findings |
| `pnpm pcb-sync:stage3-evidence` | 0 | machine-readable performance/resilience evidence |
| HTTP root and `/api/pcb-sync` | 200/200 on port 3001 | API truthfully reports state `off`, qualification-only |
| isolated PostgreSQL apply/rollback/restart | not run | strict prerequisite/persistence blocker |

The nine skips are three ngspice environment tests, two real KiCad CLI oracle tests and four live Claude-assist tests. Because required unrun checks and restart persistence remain unproven, the verdict cannot be `COMPLETE`.

## 12. Atomicity and recovery evidence

`atomicity-recovery.test.ts` injects failures after lock, revalidation, stage, mutation, serialization, reparse, validation, before commit and during commit. Each precommit failure leaves board, audits and replay record unchanged and resets an applying plan to applicable. It also proves postcommit response uncertainty recovery, retry by identical idempotency key, simultaneous apply serialization, idempotency collision rejection, staged-output mismatch, unknown-operation rejection, legal lifecycle enforcement and lock timeout. Routed-board tests prove copper/zones are unchanged when structural work blocks. The remaining gap is real durable process-kill/restart recovery, not in-process transaction behavior.

## 13. Performance evidence

Windows x64, Node v24.15.0; `artifacts/footprint-binding-stage-03/qualification-evidence.json`:

| Fixture | Result |
|---|---|
| 20 exact small previews | mean 5.556 ms, p95 7.059 ms, max 20.947 ms |
| 500 unresolved components | 515.259 ms; 500 assessments; 1,502 complete blockers; 1.868 MB result; 6 trace steps |
| Stage 2 partitioning | exact batches 256 + 244 |
| 16 concurrent previews | 44.065 ms; one technical plan digest |

Budgets are 2 s small preview and 10 s blocked-500 preview. Validation/blockers were not omitted to meet them. Live PostgreSQL/network latency, large fully resolved atomic-catalog parsing and crash recovery are not measured.

## 14. Documentation and Stage 4 handoff

- `docs/pcb-sync-stage-03.md`: architecture, schemas, gates, identity/connectivity, apply/recovery, API/UI, rollout, security, metrics, budgets and examples.
- `SIRKIT_PCB_SYNC_STAGE_03_REPOSITORY_DISCOVERY.md`: exact legacy call/mutation/retirement map.
- `docs/pcb-sync-stage-04-handoff.json`: mapping verifier contract.
- `progress/2026-07-19/01-footprint-binding-stage-03.md`: concise change record.

Stage 4 must publish a new immutable approved mapping certificate pinned to symbol/footprint/exact-part/package/variant/verifier dependencies, represent multi-pad/shared/mechanical/no-connect/hidden/exposed-pad intent explicitly, and invalidate Stage 3 plans on any dependency change. It may not choose a footprint, invent connectivity or mutate a board.

## 15. Limitations and deferred work

- Stage 3 rollout: durable server snapshot coordinator, board/plan/audit/replay database repository, filesystem-safe staging where applicable, process-kill/restart recovery and explicit operational cutover.
- Qualification: isolated PostgreSQL Stage 1/2/3 apply/rollback/restart; review/enable nine skipped environment/live tests; stabilize unrelated performance assertions under default parallelism; clear broad lint debt.
- Board formats: no arbitrary KiCad board mutation until a lossless supported parser/serializer transaction is proven.
- Stage 4: create/verify mappings; Stage 3 consumes only current approved mappings.
- Stage 5: passive default policy; `100n` remains blocked without authoritative package data.
- Stage 6: assignment-resolution queue.
- Stage 7/8: quality placement and routed structural change/copper protection.
- Stage 9/10: richer suggestions/generated assets remain non-authoritative.

## 16. Changed-file inventory

Production code:

- `app/lib/pcb-sync/authorization.ts`
- `app/lib/pcb-sync/board.ts`
- `app/lib/pcb-sync/engine.ts`
- `app/lib/pcb-sync/executor.ts`
- `app/lib/pcb-sync/handoff.ts`
- `app/lib/pcb-sync/index.ts`
- `app/lib/pcb-sync/lifecycle.ts`
- `app/lib/pcb-sync/observability.ts`
- `app/lib/pcb-sync/plan.ts`
- `app/lib/pcb-sync/policy.ts`
- `app/lib/pcb-sync/providers.ts`
- `app/lib/pcb-sync/reconciliation.ts`
- `app/lib/pcb-sync/repository.ts`
- `app/lib/pcb-sync/rollout.ts`
- `app/lib/pcb-sync/service.ts`
- `app/lib/pcb-sync/stable.ts`
- `app/lib/pcb-sync/types.ts`
- `app/lib/pcb-sync/validation.ts`
- `app/api/pcb-sync/_scope.ts`
- `app/api/pcb-sync/handler.ts`
- `app/api/pcb-sync/route.ts`
- `app/components/pcb/PcbSyncReadinessPanel.tsx`
- `app/lib/pcb/types.ts` — only Stage 3 addition is immutable `syncIdentity`; file also contains pre-existing earlier-stage edits.
- `app/lib/pcb/revision.ts` — Stage 3 extends canonical footprint revision identity; file was already part of earlier work.
- `package.json` — adds only `pcb-sync:stage3-evidence` for this stage; other diff entries predate Stage 3.

Tests/fixtures/evidence:

- `app/lib/pcb-sync/__tests__/fixtures.ts`
- `app/lib/pcb-sync/__tests__/preflight-apply.test.ts`
- `app/lib/pcb-sync/__tests__/board-risk.test.ts`
- `app/lib/pcb-sync/__tests__/atomicity-recovery.test.ts`
- `app/lib/pcb-sync/__tests__/contracts-security-property.test.ts`
- `app/lib/pcb-sync/__tests__/performance-resilience.test.ts`
- `app/api/pcb-sync/__tests__/route.test.ts`
- `app/components/pcb/__tests__/pcb-sync-readiness-panel.test.tsx`
- `scripts/pcb-sync-stage3-evidence.ts`
- `artifacts/footprint-binding-stage-03/qualification-evidence.json`
- `artifacts/footprint-binding-stage-03/full-suite.json`
- `artifacts/footprint-binding-stage-03/full-suite-rerun.json`
- `artifacts/footprint-binding-stage-03/full-suite-bounded.json`

Schemas/migrations: none. Stage 3 defines versioned runtime schemas in TypeScript and consumes existing Stage 1/atomic tables; a durable repository migration is deliberately not claimed.

Documentation:

- `SIRKIT_PCB_SYNC_STAGE_03_REPOSITORY_DISCOVERY.md`
- `SIRKIT_FOOTPRINT_BINDING_STAGE_03_IMPLEMENTATION.md`
- `docs/pcb-sync-stage-03.md`
- `docs/pcb-sync-stage-04-handoff.json`
- `progress/2026-07-19/01-footprint-binding-stage-03.md`

The protected worktree contains extensive earlier Sirkit-stage changes. They were preserved. The original `C:\Users\robsa\sirkit` was not touched.
