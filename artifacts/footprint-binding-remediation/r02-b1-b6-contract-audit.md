# R02 B1-B6 Durability and Transaction Contract Audit

Date: 2026-07-19  
Repository: `C:/Users/robsa/Documents/Codex/2026-07-13/do/work/sirkit-edit`  
Protected original: `C:/Users/robsa/sirkit` (not touched)

## 1. Audit verdict

**R02 AUDIT: COMPLETE**

The audit is exhaustive for the R01-authorized B1-B6 closure. It does **not** qualify B1-B6 for production and does **not** authorize Footprint Binding Stage 6 or Stage 7. Substantial architecture exists, but all six blocks fail at least one required contract. The highest-risk findings are:

- PCB apply revalidation evaluates time-sensitive approval state using the plan's old `createdAt` timestamp, so an approval that expires after preflight can still apply.
- The shipping PCB editor still invokes legacy `syncFromSchematic` and persists board authority in browser `localStorage`, alongside the durable Stage 3 API.
- Mapping verification writes a process-local result cache before durable persistence; a failed persistence can leave memory acting as authority.
- Mapping projection and plan invalidation are independent outbox effects without a completion barrier, while the owner API reports success immediately.
- Passive-policy `assign_profile` exceptions are accepted and persisted but ignored by the evaluator; exception records also lack required pinned revisions and have no removal/revocation operation.
- API identity, tenant, project, actor, and role are accepted from caller-controlled `x-sirkit-*` headers without a verified server session boundary.
- B1 immutable-row conflicts are silently ignored before the head is updated, allowing a colliding row to disagree with the intended aggregate/audit state.

R03 is required for the 18 bounded implementation gaps in this report. R04 remains mandatory for PostgreSQL migration, transaction, crash, lease, replay, restart, and performance qualification.

## 2. Repository identity and R01 gate verification

| Field | Verified value |
|---|---|
| Git root | `C:/Users/robsa/Documents/Codex/2026-07-13/do/work/sirkit-edit` |
| Branch | `codex/cd-13-full-flow-orchestrator` |
| HEAD | `2bd1603a775bd4b409b89710cd4e5f8d70201632` |
| R01 verdict | `COMPLETE` |
| R01 normalized start fingerprint | `20dabce5a550d29ec7f6d4ee7430cf81ccdf08e9e9eb55a5daf9b9e937752a13` |
| R01 normalized end fingerprint | `20dabce5a550d29ec7f6d4ee7430cf81ccdf08e9e9eb55a5daf9b9e937752a13` |
| R02 pre-audit path count | 1,250 = 1,248 R01 baseline paths + exactly two R01 artifacts |
| B1-B6 closure | 237 changed paths |
| B7-only frozen set | 29 changed paths |
| Unexplained drift before audit | 0 paths |

The R01 normalized fingerprint was recomputed before R02 work with the two self-describing R01 outputs excluded and matched exactly. Both R01 artifacts existed and were internally consistent. The mutation guard used around executable verification was unchanged at `50dcc84485486a365abb2f9fdb2c0857b2e0f9e132e5119ee812af349d1f1078` before and after each test family. No source, test, schema, migration, configuration, lockfile, or historical report was edited.

## 3. Exact scope and exclusions

The path-level scope authority is `artifacts/footprint-binding-remediation/r01-boundary-manifest.json`. This audit inspected the manifest's exact 237-path `B1-B6` closure, including the identified shared schema, migration, atomic-catalog, PCB-core, and rollout hunks. It did not treat the other 1,011 baseline paths as repair authority. In particular, 783 `PRESERVE_UNTOUCHED` paths, 215 `GENERATED_EVIDENCE_PRESERVE` paths, and unrelated portions of 63 `SHARED_HUNK_REVIEW` paths remained read-only.

The exact 29 B7-only frozen paths were:

1. `app/api/assignment-queue/__tests__/_scope.test.ts`
2. `app/api/assignment-queue/_scope.ts`
3. `app/api/assignment-queue/materialize/route.ts`
4. `app/api/assignment-queue/revalidate/route.ts`
5. `app/api/assignment-queue/route.ts`
6. `app/components/pcb/__tests__/assignment-queue-panel.test.tsx`
7. `app/components/pcb/AssignmentQueuePanel.tsx`
8. `app/components/pcb/PcbEditor.tsx`
9. `app/components/pcb/PcbToolbar.tsx`
10. `app/lib/assignment-queue/__tests__/fixtures.ts`
11. `app/lib/assignment-queue/__tests__/materializer-repository.test.ts`
12. `app/lib/assignment-queue/__tests__/revalidation.test.ts`
13. `app/lib/assignment-queue/__tests__/service.test.ts`
14. `app/lib/assignment-queue/adapters.ts`
15. `app/lib/assignment-queue/index.ts`
16. `app/lib/assignment-queue/materializer.ts`
17. `app/lib/assignment-queue/repository.ts`
18. `app/lib/assignment-queue/revalidation.ts`
19. `app/lib/assignment-queue/rollout.ts`
20. `app/lib/assignment-queue/runtime.ts`
21. `app/lib/assignment-queue/service.ts`
22. `app/lib/assignment-queue/stable.ts`
23. `app/lib/assignment-queue/types.ts`
24. `app/lib/pcb/board-persistence.ts`
25. `progress/2026-07-19/04-footprint-binding-stage-06-blocked.md`
26. `SIRKIT_ASSIGNMENT_QUEUE_STAGE_06_PREREQUISITE_GATE.md`
27. `SIRKIT_ASSIGNMENT_QUEUE_STAGE_06_REPOSITORY_DISCOVERY.md`
28. `SIRKIT_FOOTPRINT_BINDING_STAGE_06_IMPLEMENTATION.md`
29. `tsconfig.footprint-stage6.json`

The three shared B7 paths (`PcbEditor.tsx`, `PcbToolbar.tsx`, and `board-persistence.ts`) were inspected only to establish whether a second production PCB-sync authority exists. They were not modified. Stage 6 implementation was not inspected as proof of B1-B6 readiness and was not repaired.

## 4. B1 - durable physical-binding authority

| # | Requirement | Status | Evidence and conclusion | Gap |
|---:|---|---|---|---|
| 1 | Production records persist in PostgreSQL | `UNPROVEN` | `app/api/physical-bindings/route.ts` constructs `PostgresPhysicalBindingRepository`; `server-repository.ts` targets the 0022 tables. No live migration/database/restart qualification was permitted. | `R02-E-B1-001` |
| 2 | Memory adapters are explicit and cannot silently become production authority | `PASS` | `InMemoryPhysicalBindingRepository` is a named adapter in `repository.ts`; the production route explicitly constructs PostgreSQL and has no catch/fallback to memory. Focused tests construct memory deliberately. | - |
| 3 | Candidates are immutable/revisioned successors | `PASS` | Domain transitions create new revision IDs and predecessor links; historical rows are inserted rather than updated. State/conflict tests passed. | - |
| 4 | Selection/approval records actor, reason, timestamp, evidence, and expected revision | `FAIL` | Transition requests carry actor/reason/time/expected set revision, and bindings carry evidence references, but approval/selection decisions do not require an explicit decision-evidence field. | `R02-B1-004` |
| 5 | Stale-head approval cannot succeed | `PASS` | Service expected-revision checks and PostgreSQL compare-and-swap head update reject stale revisions; state-conflict tests passed. | - |
| 6 | Idempotency prevents duplicate approval | `FAIL` | The PostgreSQL precheck scopes the key only by tenant/project/branch, not by binding set/component. A key reused by a different set can be treated as a duplicate and return the requested state without executing it. | `R02-B1-006` |
| 7 | Exact component/package/footprint/mapping identities are lossless | `PASS` | `types.ts`, `identity.ts`, and `validation.ts` use explicit structured identities and revisions, not a footprint string. Canonical identity tests passed. | - |
| 8 | Approval is distinct from AI ranking/suggestion | `PASS` | Resolver dispositions do not invoke B1 transition approval; human/system authority is explicit in transition types and authorization. | - |
| 9 | Ready/blocking state reloads identically after restart | `UNPROVEN` | Readiness is deterministic from stored binding data, but the API `assess` path does not persist assessment results and restart equivalence has no live PostgreSQL evidence. | `R02-E-B1-001` |
| 10 | Audit and current head cannot disagree after commit | `FAIL` | `PostgresPhysicalBindingRepository.commit` uses `onConflictDoNothing()` for immutable binding/audit/migration/assessment rows without verifying the existing row's digest, then advances the head. A collision can preserve different immutable content while publishing the intended head/audit aggregate. | `R02-B1-010` |
| 11 | Authorization is enforced server-side | `FAIL` | `_scope.ts` trusts caller-supplied identity, actor kind, and role headers. UI opt-in headers do not establish an authenticated principal or membership. | `R02-B1-011` |
| 12 | Practical constraints prevent malformed/orphan rows | `FAIL` | 0022 has not-null and unique indexes but no foreign keys/check constraints for selected revisions, assessment/migration references, positive revisions, lifecycle/state enums, or denormalized JSON/column agreement. | `R02-B1-012` |

**B1: FAIL**

## 5. B2 - deterministic, read-only resolution

| # | Requirement | Status | Evidence and conclusion | Gap |
|---:|---|---|---|---|
| 1 | Identical authority inputs produce identical normalized output/digest | `PASS` | Stable sort/dedup/digest logic in `engine.ts`, `normalize.ts`, and `stable.ts`; determinism/property tests passed. | - |
| 2 | Resolution reads but never approves/mutates B1 | `PASS` | Candidate sources and service expose reads only; no B1 commit/transition call exists. Security/read-only tests passed. | - |
| 3 | Precedence and conflicts are explicit | `PASS` | Policy and engine encode source precedence, dispositions, conflict classes, and blockers. | - |
| 4 | Exact approved binding outranks weaker suggestions | `PASS` | Explicit exact/selected authority wins over catalog/default candidates; end-to-end resolver tests passed. | - |
| 5 | Ambiguity blocks; no first-candidate guess | `PASS` | Equal/conflicting candidates produce blocker/conflict output; no array-first acceptance path was found. | - |
| 6 | Passive policy is a versioned input, not hidden global default | `FAIL` | Production Stage 3 constructs `FootprintResolutionService(new PostgresPhysicalBindingRepository())` with default disabled passive source and `allowStage5PassivePolicy=false`. The real `PassivePolicyCandidateSource` is only integrated in focused tests. | `R02-B2-006` |
| 7 | Per-component passive exception is explicit/traceable | `FAIL` | B2 can represent a passive source, but production construction never supplies it; B5 exception defects therefore cannot be traced through the production resolver path. | `R02-B2-006`, `R02-B5-006` |
| 8 | Cache keys contain all affecting revisions | `NOT_APPLICABLE` | The B2 cache mode is explicitly disabled; no resolver-result cache is used as authority. If caching is later enabled, this requirement becomes mandatory. | - |
| 9 | Stale caches cannot make obsolete state ready | `NOT_APPLICABLE` | No authoritative B2 cache exists; outputs are recomputed. | - |
| 10 | Output includes source, disposition/confidence, blockers, evidence | `PASS` | Normalized candidates and resolution results expose origin records, disposition, issues, conflicts, evidence, dependency snapshot, and digests. | - |
| 11 | Special/complex packages are not guessed from value or pin count | `PASS` | Candidate adapters require structured authority records; connector/crystal/IC/polarized/BGA/QFN/exposed-pad cases remain blocked absent authority. Safety tests passed. | - |
| 12 | API and batch paths remain read-only | `PASS` | Service single/batch paths share read-only sources; Stage 3 consumes the batch interface without mutation. | - |

Cross-contract defect: `validation.ts` requires `assemblyVariantIds.includes(requestedVariant)`, while the B1 repository and resolver engine define an empty variant array as global applicability. A valid global B1 binding is loaded and then rejected as a scope mismatch. This is `R02-B2-X01`.

**B2: FAIL**

## 6. B3 - durable PCB synchronization state

| # | Requirement | Status | Evidence and conclusion | Gap |
|---:|---|---|---|---|
| 1 | Schematic snapshots are durable/revision-addressed | `UNPROVEN` | `DurablePcbSyncSnapshotStore` writes B6 records and is constructed by the production API; no live 0023/restart proof. | `R02-E-B3-001` |
| 2 | Plans are durable, immutable/revisioned, and digest-bound | `UNPROVEN` | Plan records/digests include relevant dependency sets and lifecycle revisions; only memory-backed executable evidence exists. | `R02-E-B3-001` |
| 3 | Plan lifecycle survives restart | `FAIL` | Apply publishes lifecycle `applying` in a separate commit. A process death after that commit leaves the plan stuck; no startup recovery or lease-based apply ownership exists. | `R02-B3-003` |
| 4 | Board/revision/audit are durable | `UNPROVEN` | `DurablePcbSyncRepository` stores board, audit, replay, and plan records through B6, but live PostgreSQL/reload was not qualified. | `R02-E-B3-001` |
| 5 | Re-preflight does not mutate the board | `PASS` | Preflight computes and persists a plan only; board publication is confined to apply. Tests passed. | - |
| 6 | Apply revalidates exact current schematic/binding/mapping/policy/library/board revisions | `FAIL` | Revalidation sets `requestedAt: plan.createdAt`, so time-sensitive approvals are checked at preflight time, not apply time. Production resolver also omits B5. | `R02-B3-006`, `R02-B2-006` |
| 7 | Stale/invalidated plan cannot apply | `FAIL` | Digest/revision checks are strong, but an approval expiring after plan creation remains accepted because of the old revalidation timestamp; missing production B5 input is another blind spot. | `R02-B3-006`, `R02-B2-006` |
| 8 | Apply is atomic or equivalently staged | `UNPROVEN` | Final board + applied-plan + audit + replay + outbox commit is one B6 request, but no live PostgreSQL fault-injection proof exists. | `R02-E-B3-001` |
| 9 | Partial failure cannot report success or leave inconsistent state | `FAIL` | The final commit is atomic in design, but the prior independent `applying` lifecycle commit can be stranded on crash. | `R02-B3-003` |
| 10 | Idempotent retries do not duplicate board/audit | `UNPROVEN` | Replay records and deterministic IDs exist and memory tests pass; PostgreSQL retry/crash qualification is absent. | `R02-E-B3-001` |
| 11 | Manual assignments are preserved absent authorized exact supersession | `PASS` | Reconciliation/plan logic preserves existing manual assignments and tests cover the behavior. | - |
| 12 | Routed/constrained board states are protected | `PASS` | Board-risk classification and plan blockers prevent unsafe replacement; focused board-risk tests passed. | - |
| 13 | Router handoff only follows readiness and committed board | `PASS` | Handoff is constructed from the committed apply result/audit and rejects unresolved state. | - |
| 14 | No production authority exists only in process/browser state | `FAIL` | `PcbEditor.tsx` still calls legacy `app/lib/pcb/netlist-bridge.ts::syncFromSchematic`; `board-persistence.ts` persists the board/current project/sync hash in browser `localStorage`. This is a second production synchronization authority beside `/api/pcb-sync`. `lib/footprint-assign.ts` also remains in the export path. | `R02-B3-014` |

**B3: FAIL**

## 7. B4 - durable mapping verification and invalidation

| # | Requirement | Status | Evidence and conclusion | Gap |
|---:|---|---|---|---|
| 1 | Symbol pins, package terminals, and footprint pads are separate identities | `PASS` | Separate typed collections/edges and normalized stable IDs exist in `types.ts`, `adapters.ts`, and `verifier.ts`. | - |
| 2 | Results are durable, revisioned, and evidence-bound | `FAIL` | Durable result storage exists, but `MappingVerificationService.rememberResult` writes `results.set(...)` before awaiting `resultStore.put(...)`. A failed DB write leaves a process-local result that later mutation paths can consume. | `R02-B4-002` |
| 3 | Approval requires actor and revision checks | `PASS` | Mutation requests contain actor, expected revision, reason, idempotency, and explicit approve/reject/revoke actions; lifecycle tests passed. | - |
| 4 | Complex pin/pad cases are represented safely | `PASS` | Exposed pads, repeated/commoned pads, stacked pins, multi-unit symbols, no-connects, orientation, and equivalence are explicit and covered by the verification corpus. | - |
| 5 | Projection into B1 creates no competing authority | `FAIL` | Owner commit returns success and a projected-looking Stage 1 reference before separate `mapping.stage1-project` and `mapping.invalidate` effects complete. The projector directly creates an approved B1 successor via `mapping_update`, conflating mapping approval with physical-binding approval and allowing B4/B1/B3 to disagree. | `R02-B4-005` |
| 6 | Supersede/revoke invalidates every dependent result/plan | `FAIL` | Durable intents exist, but the two independent events have no dependency/order/completion barrier; terminal failure can leave B1 or B3 stale while B4 is active. | `R02-B4-005` |
| 7 | Invalidation survives crashes | `UNPROVEN` | B6 outbox delivery is wired, but crash-before/after-effect evidence against PostgreSQL is absent. | `R02-E-B4-001` |
| 8 | Owner mutation and invalidation intent commit atomically | `PASS` | `DurableMappingRepository.commit` places the mapping record and both outbox intents in one B6 commit; memory transaction tests passed. | - |
| 9 | Failed/ambiguous mapping cannot become ready structurally | `PASS` | Verification blockers and status checks gate approval/projection; corpus tests passed. | - |
| 10 | Reload preserves status and invalidation obligations | `UNPROVEN` | Durable records/outbox exist, but process-restart/PostgreSQL evidence is absent. | `R02-E-B4-001` |
| 11 | Duplicate effect delivery is idempotent | `UNPROVEN` | Deterministic successor/event IDs and handlers are plausible; no live duplicate/crash delivery qualification was run. | `R02-E-B4-001` |
| 12 | Direct API calls cannot bypass authorization | `FAIL` | Mapping `_scope.ts` trusts caller-supplied actor/role/scope headers; mutation opt-in is not authentication. | `R02-B1-011` |

The stored invalidation event records `stage3PlansStaled: 0` in outbox mode and is never reconciled with the eventual effect result, so the audit record cannot prove actual invalidation completion.

**B4: FAIL**

## 8. B5 - durable passive policy and explicit exceptions

| # | Requirement | Status | Evidence and conclusion | Gap |
|---:|---|---|---|---|
| 1 | Policy/context are durable and versioned | `UNPROVEN` | Production API constructs durable B6 repositories/context stores, but live PostgreSQL/restart qualification is absent. | `R02-E-B5-001` |
| 2 | Policy revisions are immutable successors | `PASS` | Mutations create new revision/revision IDs and supersedes links; lifecycle tests passed. | - |
| 3 | Defaults are limited to authorized ordinary passive classes | `PASS` | Evaluator confines house profiles to recognized resistor/capacitor classes and explicit rules. | - |
| 4 | Risky/specialized parts do not inherit unsafe defaults | `PASS` | Safety exclusions run before profile selection for polarized, bulk, high-voltage, high-power, precision, RF, safety-critical, and incomplete-fact cases. Property tests passed. | - |
| 5 | Per-component exception is an explicit authoritative operation | `FAIL` | The operation is explicit, but `assign_profile` is accepted/persisted and then ignored by `evaluator.ts`, which handles only `opt_out` and `require_exact_part`. | `R02-B5-005` |
| 6 | Approval records all chosen identity/revision/evidence/idempotency fields | `FAIL` | Exception/approval data lacks pinned expected context/component revision, chosen footprint identity/revision, package-profile revision, and decision evidence; request expected revision protects only the policy head. | `R02-B5-006` |
| 7 | Exceptions survive restart and reproduce | `UNPROVEN` | Exceptions are embedded in durable policy successors, but no live reload/re-evaluation evidence exists. | `R02-E-B5-001` |
| 8 | Exception applies only to intended component/project/revision | `FAIL` | Component/project/variant identity is present, but component/context/profile revision is not pinned; later facts/profile revisions can change meaning without a new exception decision. | `R02-B5-006` |
| 9 | Changes durably invalidate B2 results and B3 plans | `FAIL` | B3 outbox invalidation exists, but production B2/B3 construction does not consume the passive source, and invalidation completion has no barrier/status. | `R02-B2-006`, `R02-B4-005` |
| 10 | Default is visible and not presented as exact manufacturer binding | `PASS` | Passive candidate source/dispositions identify policy origin and non-exact authority; integration tests cover it. | - |
| 11 | Exception removal/supersession cannot leave stale ready state | `FAIL` | No revoke/remove/supersede exception operation exists; `applyApprovedException` replaces by ID but always writes approved state. | `R02-B5-011` |
| 12 | Server auth and tenant/project isolation are enforced | `FAIL` | API scope/role are self-asserted headers; generic B6 aggregate identity also omits scope from uniqueness. | `R02-B1-011`, `R02-B6-X01` |

**B5: FAIL**

## 9. B6 - shared transaction, replay, and outbox foundation

| # | Requirement | Status | Evidence and conclusion | Gap |
|---:|---|---|---|---|
| 1 | Aggregate heads use CAS/equivalent concurrency guard | `PASS` | PostgreSQL commit locks/reads the head and updates with expected revision; memory tests cover stale revision rejection. | - |
| 2 | Immutable records and heads commit in one PostgreSQL transaction | `UNPROVEN` | `PostgresDurableWorkflowRepository.commit` uses one Drizzle transaction, but live fault injection was prohibited. | `R02-E-B6-001` |
| 3 | Replay is transactionally bound to owner mutation | `UNPROVEN` | Replay insert is in the same transaction; live rollback/retry proof is absent. | `R02-E-B6-001` |
| 4 | Owner/audit/outbox intent commit atomically | `UNPROVEN` | Consumers place records/audits/effects into one B6 request, but no live PostgreSQL interrupted-commit evidence exists. | `R02-E-B6-001` |
| 5 | Consumers do not trust in-memory events for correctness | `FAIL` | B4 can consume its pre-durable result `Map`; the actual PCB editor/browser remains a separate state authority. | `R02-B4-002`, `R02-B3-014` |
| 6 | Outbox contains full durable owner/event/retry identity | `FAIL` | Events contain ID, scope key, topic, idempotency, payload digest, state, attempts, availability, lease/error/completion times, but no explicit owner aggregate/type/revision or explicit event type/version separate from topic/payload convention. | `R02-B6-006` |
| 7 | Claim/leasing is concurrency-safe and worker-death recoverable | `UNPROVEN` | `FOR UPDATE SKIP LOCKED`, lease owner, and expiry are implemented; concurrent PostgreSQL/worker-death tests are absent. | `R02-E-B6-001` |
| 8 | Duplicate delivery is safe | `UNPROVEN` | Handlers are designed around deterministic/idempotent operations, but live duplicate delivery across crash boundaries is not qualified. | `R02-E-B6-001` |
| 9 | Crash between effect and ack has a defined recovery strategy | `UNPROVEN` | Strategy is lease expiry plus redelivery into idempotent handlers; implementation is plausible but unproved against live stores. | `R02-E-B6-001` |
| 10 | Poison events are bounded and observable | `PASS` | Attempts are bounded (max 8), then terminal failure with error state; dispatcher tests passed. | - |
| 11 | Multi-aggregate commits share a real transaction boundary | `PASS` | B3/B4/B5 durable repositories use one PostgreSQL B6 repository/transaction; no file/store cross-boundary atomicity claim was found. | - |
| 12 | B1/B4/B5 changes deterministically stale Stage 3 plans | `FAIL` | Separate effects have no completion barrier; passive policy is absent from production resolver construction; terminal outbox failure can leave plans current. | `R02-B2-006`, `R02-B4-005` |
| 13 | Restart preserves pending invalidations | `UNPROVEN` | Durable rows exist in design, but restart/lease-expiry qualification was not run. | `R02-E-B6-001` |
| 14 | Effect inspection/retry APIs enforce auth/project scope | `NOT_APPLICABLE` | No inspection or manual-retry API exists. The only endpoint dispatches a global worker batch behind a server secret. This requirement becomes applicable when inspection/retry operations are added. | - |
| 15 | Production cannot silently fall back to memory | `PASS` | `runtime.ts` returns only a `PostgresDurableWorkflowRepository`; database failure propagates and there is no memory catch/fallback. | - |

Cross-contract defect: durable head/record uniqueness is `(aggregate_type, aggregate_key)` and `loadHead/history` do not accept or verify tenant/project/branch. Current callers usually hash scope into keys, but the shared foundation does not enforce this invariant and can alias tenants if a caller supplies the same key. This is `R02-B6-X01`.

**B6: FAIL**

## 10. Schema and migration consistency matrix

| Area | Static result | Status/gap |
|---|---|---|
| Forward order 0006-0023 | All 18 SQL files exist once and `_journal.json` lists them sequentially; 0022 is B1, 0023 is B6. | `PASS` static chronology |
| Unjournaled dependency | No B1-B6 dependency on an unjournaled migration was found. B3's atomic catalog dependency legitimately requires 0006/0007. | `PASS` |
| Schema/table projection | `app/lib/db/schema.ts` contains all tables/columns queried by B1/B6 and created by 0022/0023. | `PASS` static shape |
| B1 integrity constraints | Selected binding revisions, migration candidates, assessments, lifecycle/state values, positive revisions, and JSON/column agreement lack practical FK/check enforcement. | `FAIL` - `R02-B1-012` |
| B6 tenant isolation | Head/record unique identities omit tenant/project/branch and lookup methods are unscoped. | `FAIL` - `R02-B6-X01` |
| B6 relational integrity | Heads point to record IDs and records to head IDs only by convention; no FK/check enforces revision/state/lease/attempt invariants. | `FAIL` - `R02-B1-012`, `R02-B6-X01` |
| Outbox contract columns | Retry/lease/state fields exist, but explicit owner aggregate/revision and event version are missing. | `FAIL` - `R02-B6-006` |
| Timestamp/timezone | Drizzle uses `withTimezone: true`; SQL uses timezone-aware defaults/types consistently for audited tables. | `PASS` static shape |
| JSON serialization | Domain payloads are JSONB and stable digests are computed in code; no database constraint proves denormalized columns equal JSON content. | `FAIL` - `R02-B1-012` |
| Migration 0023 idempotence | `CREATE ... IF NOT EXISTS` can silently accept an incompatible pre-existing table/index rather than proving the expected shape. | `FAIL` - `R02-SCHEMA-001` |
| Drizzle snapshots | Snapshots stop at 0008 while journal/SQL continue through 0023. The intended migration authority/generation policy is undocumented. | `UNPROVEN` - `R02-E-SCHEMA-001` |
| Live apply/rollback/restart | Not run by R02; no shared/user database was accessed. | `UNPROVEN` - `R02-E-SCHEMA-001` |

Authority when code and database disagree must be the successfully qualified migration/schema contract, not JSON payload convention. Today the TypeScript schema and SQL agree structurally, but the database cannot enforce several invariants the domain assumes.

## 11. In-memory authority findings

| Use | Construction trace | Classification | Conclusion |
|---|---|---|---|
| `InMemoryPhysicalBindingRepository` | Explicitly constructed by tests; production B1 route uses PostgreSQL. | test/development adapter | Safe as currently wired. |
| In-memory B3 repository/providers | Explicit named classes used by focused tests; production `/api/pcb-sync` uses durable stores. | test/development adapter | Safe as adapters, not live-durability evidence. |
| In-memory B4 provider/repository | Explicit named classes in tests; production route uses durable stores. | test/development adapter | Safe as adapters. |
| In-memory B5 provider/repository | Explicit named classes in tests; production route uses durable stores. | test/development adapter | Safe as adapters. |
| `InMemoryDurableWorkflowRepository` | Explicit test repository; `runtime.ts` constructs PostgreSQL only. | test/development adapter | No silent production fallback. |
| Maps/Sets in resolver, verifier, planner, evaluator | Local dedup/index/sort structures rebuilt from request data. | harmless local computation | Not authority. |
| B2 resolver cache | Explicitly disabled. | not applicable | No stale-cache authority today. |
| B1/B4/B5 telemetry event arrays/maps | Observability only; not consulted for decisions. | harmless bounded process telemetry | Not authority. |
| B6 module singleton | Singleton holds a PostgreSQL repository object, not records. | safe runtime singleton | Database remains authority. |
| `MappingVerificationService.results` | Production service writes the map before durable `resultStore.put`; later mutations can read it. | **confirmed production authority defect** | `R02-B4-002`. |
| Legacy PCB editor + browser persistence | `PcbEditor` calls legacy `syncFromSchematic`; board/current project/sync hash persist in `localStorage`. | **confirmed production authority defect** | `R02-B3-014`. |
| Mapping/passive outbox audit count | Owner records store `stage3PlansStaled: 0` before delivery and never reconcile actual count. | suspected/confirmed audit incompleteness | Included in `R02-B4-005`; audit cannot prove completion. |

Search terms included `new Map`, `Map<`, `Set<`, `globalThis`, `singleton`, `inMemory`, `memoryRepository`, `cache`, `mock`, `fake`, `fallback`, and `defaultRepository`. Matches were traced through production API construction rather than flagged mechanically.

## 12. Commands run, exit codes, and mutation checks

| Command family | Exit | Result | Before/after mutation check |
|---|---:|---|---|
| Git identity, R01 manifest/report parsing, changed-path/fingerprint checks | 0 | Root/branch/HEAD and R01 boundary verified; 1,250 paths before R02 output. | No mutation |
| Static `rg`, `rg --files`, and read-only source/migration/schema inspection | 0 | Construction, identity, cache, outbox, API-scope, legacy PCB, and migration paths traced. | No mutation |
| `pnpm exec vitest run app/lib/physical-binding app/lib/footprint-resolver app/lib/pcb-sync app/lib/mapping-verification app/lib/passive-policy app/lib/durable-workflow app/api/pcb-sync app/api/mapping-verification app/api/passive-policy` | 1 | 27 files; 176 tests; 26 files and 175 tests passed. Only failure: B5 1,000-component performance test took 7,206 ms vs 5,000 ms threshold under parallel combined-suite contention. | Guard `50dcc8...f1078` unchanged; 0 paths mutated |
| `pnpm exec vitest run app/lib/passive-policy/__tests__/performance-property.test.ts` | 0 | 3/3 passed; 1,000-component case completed in 2,181 ms in isolation. | Same guard unchanged; 0 paths mutated |
| `pnpm exec tsc --noEmit --pretty false --incremental false` | 2 | Only reported error is in frozen B7 file `app/lib/assignment-queue/__tests__/materializer-repository.test.ts(25,420)`: `"fitted"` is not assignable to the current type. No B1-B6-only typecheck config exists. | Same guard unchanged; 0 paths mutated |

No formatter, generator, installer, migration, seeder, evidence writer, build with output, or live database command was run. The parallel performance miss is not treated as a deterministic functional defect because the isolated test passed, but suite-load performance remains an R04 obligation. The full typecheck is not green and R02 did not touch the frozen B7 error.

## 13. Complete gap register

There are **18 implementation gaps** and **7 evidence-only gaps**. Every `FAIL`/`UNPROVEN` matrix row cites at least one registered gap.

### 13.1 Implementation defects

#### `R02-B1-004` - decision evidence is not mandatory

- **Owner/severity/requirements:** B1, `P1_AUTHORITY`, B1.4.
- **Implementation/symbols:** `app/lib/physical-binding/types.ts::PhysicalBindingTransitionRequest`, approval/selection records; `transitions.ts`.
- **Evidence/defect:** actor, reason, time, idempotency, and expected revision exist; no explicit decision-evidence field is required for selection/approval. Binding evidence is not equivalent to evidence for the decision.
- **Stage 6 risk:** assignment workbench could present a binding as human-approved without durable proof of what evidence supported the choice.
- **Narrow remediation/file boundary:** extend B1 transition/approval types, validation, stable digest, audit projection, API tests; preserve historical rows through schema-version compatibility.
- **Schema/migration:** likely JSON contract/version change; add columns only if decision evidence must be queryable independently.
- **Tests/R03-R04/dependencies:** R03 contract/unit/API tests for missing/tampered evidence; R04 reload/query proof. Depends on `R02-B1-012` if relationalized.

#### `R02-B1-006` - idempotency namespace is broader than the aggregate

- **Owner/severity/requirements:** B1, `P1_AUTHORITY`, B1.6.
- **Implementation/symbols:** `app/lib/physical-binding/server-repository.ts::commit`; 0022 audit idempotency unique index.
- **Evidence/defect:** duplicate lookup uses tenant/project/branch/key but not set/component. Reusing a key for another set suppresses a legitimate operation.
- **Stage 6 risk:** one component's retry token can make another component appear processed without a transition.
- **Narrow remediation/file boundary:** bind idempotency to aggregate/set identity or verify the existing event's owner and digest before returning duplicate.
- **Schema/migration:** likely adjust the unique index and/or store set ID.
- **Tests/R03-R04/dependencies:** R03 cross-component collision and same-request replay tests; R04 concurrent PostgreSQL retry. Depends on `R02-B1-010` collision handling.

#### `R02-B1-010` - ignored immutable-row conflicts can disagree with the head

- **Owner/severity/requirements:** B1, `P0_SAFETY`, B1.10.
- **Implementation/symbols:** `app/lib/physical-binding/server-repository.ts::commit`, inserts using `onConflictDoNothing()`.
- **Evidence/defect:** conflicting rows are not loaded and digest-compared before head CAS. The transaction may advance a head using intended in-memory state while a different existing immutable row remains.
- **Stage 6 risk:** wrong footprint/mapping history can be published or audited as approved.
- **Narrow remediation/file boundary:** on conflict, require exact identity/digest/payload equivalence; otherwise abort the transaction with a stable collision error before head publication.
- **Schema/migration:** no migration necessarily required; stronger constraints may accompany `R02-B1-012`.
- **Tests/R03-R04/dependencies:** R03 repository collision tests for each immutable table; R04 concurrent PostgreSQL fault tests. Depends on `R02-B1-006` semantics.

#### `R02-B1-011` - caller-controlled headers act as authentication

- **Owner/severity/requirements:** shared B1/B3/B4/B5 API boundary, `P1_AUTHORITY`, B1.11, B4.12, B5.12.
- **Implementation/symbols:** `app/api/physical-bindings/_scope.ts`, `app/api/pcb-sync/_scope.ts`, `app/api/mapping-verification/_scope.ts`, `app/api/passive-policy/_scope.ts`.
- **Evidence/defect:** request headers directly define tenant/project/actor/role. Opt-in headers prove intent only, not identity or membership.
- **Stage 6 risk:** a direct caller can claim reviewer/admin authority and mutate another project.
- **Narrow remediation/file boundary:** introduce one trusted server auth/session adapter, derive scope/roles from verified claims and project membership, and reject mismatched client hints.
- **Schema/migration:** possibly membership/audit-session references, depending on the existing auth store.
- **Tests/R03-R04/dependencies:** R03 forged-header/cross-tenant/API tests; R04 deployed middleware/session integration. Depends on `R02-B6-X01` for storage isolation.

#### `R02-B1-012` - database does not enforce assumed B1/B6 integrity

- **Owner/severity/requirements:** B1/schema, `P0_SAFETY`, B1.12 and schema matrix.
- **Implementation/symbols:** `app/lib/db/schema.ts`; `drizzle/0022_footprint_binding_stage01.sql`; B6 head/record tables.
- **Evidence/defect:** missing FK/check constraints permit orphan selected revisions/assessments/migrations, invalid revisions/states, and head/record disagreement by convention.
- **Stage 6 risk:** malformed persistence can be loaded as authoritative assignment state.
- **Narrow remediation/file boundary:** add constraints that are safe for existing data, plus a pre-migration integrity audit and explicit quarantine path for bad rows.
- **Schema/migration:** yes, forward migration required; do not rewrite 0022/0023 if already potentially deployed.
- **Tests/R03-R04/dependencies:** R03 schema assertions and migration plan; R04 clean/dirty dataset apply and rollback. Depends on `R02-E-SCHEMA-001`.

#### `R02-B2-006` - passive policy is not wired into the production resolver

- **Owner/severity/requirements:** B2/B3/B5/B6, `P1_AUTHORITY`, B2.6-7, B3.6-7, B5.9, B6.12.
- **Implementation/symbols:** `app/lib/footprint-resolver/adapters.ts`, `policy.ts`, `service.ts`; `app/api/pcb-sync/route.ts`; `app/lib/passive-policy/stage2-adapter.ts`.
- **Evidence/defect:** default sources contain a disabled passive hook; production Stage 3 does not provide `PassivePolicyCandidateSource` or enable the Stage 5 policy version. Tests wire it manually.
- **Stage 6 risk:** passive assignments/readiness differ between tests and the application; policy changes may not affect PCB sync.
- **Narrow remediation/file boundary:** create a production resolver composition root using durable B1/B4/B5/library inputs and use it for single, batch, and Stage 3 paths.
- **Schema/migration:** no new schema expected; relies on qualified B5/B6 data.
- **Tests/R03-R04/dependencies:** R03 production-composition and policy-change preflight tests; R04 restart/outbox integration. Depends on `R02-B5-005`, `R02-B5-006`, and `R02-B4-005`.

#### `R02-B2-X01` - global variant semantics disagree

- **Owner/severity/requirements:** B2 cross-contract, `P2_INTEGRATION`, B2/B1 scope semantics.
- **Implementation/symbols:** `app/lib/footprint-resolver/engine.ts::validateBinding` treats empty variants as global; `validation.ts::validateResolutionContext` requires `.includes()`.
- **Evidence/defect:** the same valid global binding is admitted by repository/engine logic and rejected by context validation.
- **Stage 6 risk:** ordinary globally applicable footprints can remain inexplicably blocked.
- **Narrow remediation/file boundary:** centralize one `variantApplies` predicate and reuse it in repository, validation, engine, B4 projector, and tests.
- **Schema/migration:** no.
- **Tests/R03-R04/dependencies:** R03 empty/global, exact, nonmatching, and multi-variant tests. Also update B4 projector's empty-variant rejection.

#### `R02-B3-003` - apply lifecycle can remain permanently `applying`

- **Owner/severity/requirements:** B3, `P1_RECOVERY`, B3.3 and B3.9.
- **Implementation/symbols:** `app/lib/pcb-sync/service.ts::apply`; `durable.ts::updatePlanLifecycle` and `commitAppliedBoard`.
- **Evidence/defect:** `applying` commits before the final transaction. Process death bypasses catch/reset and no lease/recovery scanner owns stale applying plans.
- **Stage 6 risk:** board sync becomes unretryable or operators may bypass safeguards to recover it.
- **Narrow remediation/file boundary:** either include claim/applying/finalization in a recoverable lease/state machine or avoid publishing `applying` before the atomic final commit; define deterministic stale-claim recovery.
- **Schema/migration:** may need apply owner/lease/attempt fields.
- **Tests/R03-R04/dependencies:** R03 fault points around every lifecycle commit; R04 kill/restart PostgreSQL tests. Depends on `R02-E-B6-001`.

#### `R02-B3-006` - apply revalidates approvals at the old plan time

- **Owner/severity/requirements:** B3, `P0_SAFETY`, B3.6-7.
- **Implementation/symbols:** `app/lib/pcb-sync/service.ts::apply`, revalidation request `requestedAt: plan.createdAt`.
- **Evidence/defect:** approval expiry and other time-sensitive validity are evaluated at preflight time during apply.
- **Stage 6 risk:** an expired/revoked-time-window footprint may be committed to the PCB.
- **Narrow remediation/file boundary:** require a trusted apply timestamp, re-fetch all current authority heads, bind the revalidation digest to that timestamp/current revisions, and reject clock regressions.
- **Schema/migration:** likely no; audit may record both preflight and apply evaluation times.
- **Tests/R03-R04/dependencies:** R03 fake-clock expiry-between-preflight/apply test and current-revision tests; R04 transaction-time/database-clock qualification. Depends on `R02-B2-006` for complete inputs.

#### `R02-B3-014` - legacy browser PCB synchronization remains authoritative

- **Owner/severity/requirements:** B3/B6, `P1_AUTHORITY`, B3.14 and B6.5.
- **Implementation/symbols:** `app/components/pcb/PcbEditor.tsx`; `app/lib/pcb/netlist-bridge.ts::syncFromSchematic`; `app/lib/pcb/board-persistence.ts`; `app/lib/kicad-export.ts`; `lib/footprint-assign.ts`.
- **Evidence/defect:** UI sync and board persistence bypass durable B3, creating two resolvers/sync authorities.
- **Stage 6 risk:** assignment queue and durable readiness can disagree with the board the user sees/exports.
- **Narrow remediation/file boundary:** route UI preflight/apply through B3; retain legacy code only as a clearly non-authoritative importer/migration adapter; persist a server revision reference client-side, not the authoritative board.
- **Schema/migration:** board import/migration metadata may be needed.
- **Tests/R03-R04/dependencies:** R03 UI/API composition, legacy-board import, and export-authority tests; R04 restart/multi-session tests. Do not edit frozen B7 hunks until the R03 boundary is approved.

#### `R02-B4-002` - verification memory cache precedes durable persistence

- **Owner/severity/requirements:** B4/B6, `P1_AUTHORITY`, B4.2 and B6.5.
- **Implementation/symbols:** `app/lib/mapping-verification/service.ts::rememberResult`, `results` map.
- **Evidence/defect:** map write occurs before awaited durable store; a thrown put leaves consumable memory-only state.
- **Stage 6 risk:** mapping approval can rely on verification evidence that never committed.
- **Narrow remediation/file boundary:** persist first, then optionally populate a bounded read-through cache; on mutation reload/verify digest from durable store and make cache non-authoritative.
- **Schema/migration:** no expected.
- **Tests/R03-R04/dependencies:** R03 injected put-failure/restart/cache-poison tests; R04 durable reload. Independent of other fixes.

#### `R02-B4-005` - projection/invalidation have no completion barrier or single decision authority

- **Owner/severity/requirements:** B4/B5/B6, `P1_AUTHORITY`, B4.5-7, B5.9, B6.12.
- **Implementation/symbols:** `app/lib/mapping-verification/durable.ts`, `service.ts`, `stage1-projector.ts`, `invalidation.ts`; B6 handlers.
- **Evidence/defect:** mapping owner commit enqueues two unordered effects and returns a Stage 1 reference immediately. Mapping approval directly produces an approved B1 successor. Terminal failure can split B4, B1, and B3; invalidation counts remain zero in the owner audit.
- **Stage 6 risk:** queue can call a component ready while binding projection or plan invalidation failed.
- **Narrow remediation/file boundary:** define one saga/readiness projection with explicit pending/applied/failed effect status, dependency ordering, idempotent completion, and a clear rule that B4 verification does not silently substitute for B1 physical-binding approval.
- **Schema/migration:** likely effect-owner/status/dependency fields or a projection-status aggregate.
- **Tests/R03-R04/dependencies:** R03 effect-order, one-effect-fails, terminal poison, revoke, and readiness-barrier tests; R04 crash/redelivery/restart. Depends on `R02-B6-006` and `R02-E-B6-001`.

#### `R02-B5-005` - `assign_profile` exception is persisted but ignored

- **Owner/severity/requirements:** B5, `P0_SAFETY`, B5.5.
- **Implementation/symbols:** `app/lib/passive-policy/types.ts`, `service.ts::applyApprovedException`, `evaluator.ts::evaluate`.
- **Evidence/defect:** evaluator branches only for `opt_out` and `require_exact_part`; `assign_profile` falls through to generic rules.
- **Stage 6 risk:** UI/API can claim a package-profile exception was applied while a different profile/default is used.
- **Narrow remediation/file boundary:** either implement exact pinned profile resolution/validation or reject/remove the action until supported; never silently fall through.
- **Schema/migration:** depends on profile revision pinning in `R02-B5-006`.
- **Tests/R03-R04/dependencies:** R03 assign-profile success/missing/stale/risky-part tests. Must be fixed with `R02-B5-006`.

#### `R02-B5-006` - exception decisions are not revision/evidence complete

- **Owner/severity/requirements:** B5/B2, `P1_AUTHORITY`, B5.6 and B5.8, B2.7.
- **Implementation/symbols:** `app/lib/passive-policy/types.ts::PassiveComponentException` and mutation request; `service.ts` approval digest.
- **Evidence/defect:** no pinned context/component/profile/footprint revision or explicit evidence set; expected revision covers the policy head only.
- **Stage 6 risk:** an old exception can change meaning as facts/library/profile data changes.
- **Narrow remediation/file boundary:** make exception a revision-bound decision containing component fact digest, context revision, chosen profile/package/footprint identity/revision, evidence, actor/reason/time, and expected heads.
- **Schema/migration:** JSON version change; queryable decision columns optional.
- **Tests/R03-R04/dependencies:** R03 stale fact/profile/context and cross-project/variant tests; R04 reload reproducibility. Depends on `R02-B5-005`.

#### `R02-B5-011` - no exception revoke/remove/supersede operation

- **Owner/severity/requirements:** B5, `P2_INTEGRATION`, B5.11.
- **Implementation/symbols:** `app/lib/passive-policy/service.ts`; API mutation operations; exception lifecycle types.
- **Evidence/defect:** exception edit always writes an approved exception and replaces by ID; no explicit revocation/removal state and invalidation path exists.
- **Stage 6 risk:** stale ready state persists after a user intends to withdraw an exception.
- **Narrow remediation/file boundary:** add revision-checked revoke/supersede operations, audit action, durable invalidation, and readiness transition.
- **Schema/migration:** likely JSON schema-version change only.
- **Tests/R03-R04/dependencies:** R03 revoke/retry/stale-head/B2/B3 invalidation tests; R04 restart/redelivery. Depends on `R02-B4-005`.

#### `R02-B6-006` - outbox omits explicit owner revision and event version

- **Owner/severity/requirements:** B6, `P1_RECOVERY`, B6.6.
- **Implementation/symbols:** `app/lib/durable-workflow/types.ts::DurableOutboxEvent`, `server-repository.ts`, schema/0023.
- **Evidence/defect:** topic/scope/payload conventions do not durably identify the owner aggregate revision or event schema version.
- **Stage 6 risk:** operators/handlers cannot prove which committed owner revision produced an effect or safely evolve payloads.
- **Narrow remediation/file boundary:** add owner aggregate type/key/revision and event type/version, bind them into event identity/digest, and validate on dispatch.
- **Schema/migration:** yes, forward migration/backfill for pending events.
- **Tests/R03-R04/dependencies:** R03 schema/repository/handler-version tests; R04 migration and mixed-version dispatch. Supports `R02-B4-005`.

#### `R02-B6-X01` - aggregate identity is not tenant scoped by the foundation

- **Owner/severity/requirements:** B6/shared isolation, `P1_AUTHORITY`, B5.12 and schema matrix.
- **Implementation/symbols:** `app/lib/db/schema.ts`, 0023 unique indexes, `server-repository.ts::loadHead/history`.
- **Evidence/defect:** uniqueness/lookup use only aggregate type/key. Scoped key generation is a caller convention, not an enforced repository invariant.
- **Stage 6 risk:** a new or defective caller can alias aggregate state across tenants/projects.
- **Narrow remediation/file boundary:** include tenant/project/branch in head/record identity and every lookup/CAS, or make an opaque repository-generated scoped key impossible to misuse.
- **Schema/migration:** yes, key/index/FK migration with collision audit.
- **Tests/R03-R04/dependencies:** R03 same-key cross-tenant tests; R04 migration/concurrency. Coordinate with `R02-B1-011`.

#### `R02-SCHEMA-001` - 0023 can mask incompatible pre-existing objects

- **Owner/severity/requirements:** schema/B6, `P2_OPERATIONS`, schema consistency.
- **Implementation/symbols:** `drizzle/0023_footprint_binding_durable_workflow.sql` uses `CREATE TABLE/INDEX IF NOT EXISTS`.
- **Evidence/defect:** deployment can skip creation because a same-named but incompatible object exists, then application code assumes the desired shape.
- **Stage 6 risk:** durability can fail only at runtime or, worse, use incorrectly constrained tables.
- **Narrow remediation/file boundary:** add an explicit schema-shape/version assertion migration or startup qualification; use forward migrations for changes rather than relying on silent existence checks.
- **Schema/migration:** yes.
- **Tests/R03-R04/dependencies:** R03 static migration assertions; R04 clean, expected-existing, and incompatible-existing database scenarios. Depends on migration authority decision in `R02-E-SCHEMA-001`.

### 13.2 Evidence-only gaps

#### `R02-E-B1-001` - B1 PostgreSQL/restart/readiness proof

- **Owner/severity/requirements:** B1, `P3_EVIDENCE`, B1.1 and B1.9.
- **Current implementation/evidence:** PostgreSQL route/repository and deterministic readiness code; memory unit tests only.
- **Missing proof/risk:** no 0022 apply, process restart, committed reload, concurrent CAS, or persisted assessment qualification. Stage 6 cannot rely on wiring alone.
- **Remediation/file boundary/schema:** R04 ephemeral PostgreSQL harness and evidence artifact; no production fix unless tests expose one. Migration 0022 included.
- **Focused qualification/dependencies:** clean migration, create/select/approve/reload, readiness equality, concurrent stale head, rollback. Run after B1 R03 fixes.

#### `R02-E-B3-001` - B3 PostgreSQL atomicity/restart/idempotency proof

- **Owner/severity/requirements:** B3, `P3_EVIDENCE`, B3.1-2, B3.4, B3.8, B3.10.
- **Current implementation/evidence:** durable repositories and in-memory atomicity/recovery tests.
- **Missing proof/risk:** no database fault injection, restart, replay, or final board/audit/plan equality proof.
- **Remediation/file boundary/schema:** R04 ephemeral PostgreSQL crash harness/evidence; 0023 plus any R03 lifecycle migration.
- **Focused qualification/dependencies:** kill before/after each commit, duplicate apply, reload board/plan/audit/replay, concurrent board CAS. Run after `R02-B3-003`, `R02-B3-006`, and B6 fixes.

#### `R02-E-B4-001` - B4 outbox/restart/duplicate-delivery proof

- **Owner/severity/requirements:** B4, `P3_EVIDENCE`, B4.7, B4.10-11.
- **Current implementation/evidence:** durable mapping repository/outbox and deterministic handlers; memory lifecycle tests.
- **Missing proof/risk:** no crash between owner/effect/ack, worker restart, duplicate delivery, poison recovery, or reload evidence.
- **Remediation/file boundary/schema:** R04 worker/PostgreSQL harness and evidence; no code change unless failure observed.
- **Focused qualification/dependencies:** project + invalidate ordering, duplicate deliveries, terminal/retry recovery, reload mapping/status/obligation. Requires `R02-B4-002`, `R02-B4-005`, and B6 repair.

#### `R02-E-B5-001` - B5 durable policy/exception reload proof

- **Owner/severity/requirements:** B5, `P3_EVIDENCE`, B5.1 and B5.7.
- **Current implementation/evidence:** durable B6 policy/context stores and memory tests.
- **Missing proof/risk:** no PostgreSQL restart/re-evaluation proof that policy and exception results reproduce.
- **Remediation/file boundary/schema:** R04 ephemeral database fixtures/evidence.
- **Focused qualification/dependencies:** publish, exception decision, restart, exact output/digest equality, policy supersession/invalidation. Requires B5 implementation fixes.

#### `R02-E-B6-001` - live transaction, lease, crash, replay, and restart proof

- **Owner/severity/requirements:** B6, `P3_EVIDENCE`, B6.2-4, B6.7-9, B6.13.
- **Current implementation/evidence:** one Drizzle transaction, CAS, replay/outbox rows, `SKIP LOCKED`, leases, max attempts; memory dispatcher tests.
- **Missing proof/risk:** transaction/source inspection cannot prove database behavior under concurrency or process death.
- **Remediation/file boundary/schema:** R04 disposable PostgreSQL and multiple worker processes; evidence only unless defects appear.
- **Focused qualification/dependencies:** rollback at every write, two-worker claim, lease expiry, effect-before-ack crash, duplicate replay, poison terminal state, restart. Run after B6 schema/event fixes.

#### `R02-E-SCHEMA-001` - migration/snapshot/release policy is unqualified

- **Owner/severity/requirements:** schema/operations, `P3_EVIDENCE`, schema consistency.
- **Current implementation/evidence:** sequential 0006-0023 SQL/journal; snapshots only through 0008; SQL 0006-0023 untracked in the captured tree and journal tracked-modified.
- **Missing proof/risk:** no declared authority policy, live apply, rollback/forward-repair, existing-data audit, or schema drift check.
- **Remediation/file boundary/schema:** R04 migration policy plus disposable-database qualification and evidence; never regenerate snapshots in R02/R03 casually.
- **Focused qualification/dependencies:** clean and prior-version databases, expected schema introspection, invalid-row preflight, rollback/forward recovery. After all R03 migration decisions.

#### `R02-E-TOOLING-001` - whole-closure type/performance evidence is not clean

- **Owner/severity/requirements:** cross-block evidence, `P3_EVIDENCE`, release qualification.
- **Current implementation/evidence:** 175/176 focused tests passed; isolated B5 performance passed at 2,181 ms; combined run exceeded 5,000 ms at 7,206 ms; full no-emit typecheck is blocked only by frozen B7 `"fitted"` type error.
- **Missing proof/risk:** no B1-B6-only typecheck config and no stable controlled-load performance qualification.
- **Remediation/file boundary/schema:** R04 may add non-production test configuration/evidence after R03; B7 error remains outside R02/R03 unless separately authorized.
- **Focused qualification/dependencies:** serial and controlled-parallel repeated performance samples, B1-B6 typecheck, full suite after B7 is independently repaired. No schema work.

## 14. Proposed R03 repair boundary

R03 is authorized only for these exact implementation gap IDs:

`R02-B1-004`, `R02-B1-006`, `R02-B1-010`, `R02-B1-011`, `R02-B1-012`, `R02-B2-006`, `R02-B2-X01`, `R02-B3-003`, `R02-B3-006`, `R02-B3-014`, `R02-B4-002`, `R02-B4-005`, `R02-B5-005`, `R02-B5-006`, `R02-B5-011`, `R02-B6-006`, `R02-B6-X01`, `R02-SCHEMA-001`.

Recommended dependency order:

1. B6 scoped identity/outbox/schema contract and migration strategy.
2. Shared authenticated API scope.
3. B1 collision/idempotency/evidence/integrity rules.
4. B4 durable-first result handling and projection/invalidation saga barrier.
5. B5 revision-complete exception lifecycle and evaluator semantics.
6. One production B2 composition root and global-variant consistency.
7. B3 current-time revalidation, recoverable apply lifecycle, and elimination/migration of legacy UI authority.

R03 must remain inside the R01 237-path closure plus a separately justified shared-auth boundary if no existing trusted auth adapter lies in that closure. Any need to edit a B7-only frozen path, including the mixed UI files, requires a new containment decision; it is not silently authorized by this report. R03 must add focused tests with each repair and must not claim live PostgreSQL qualification.

## 15. R04 evidence-only obligations

R04 is mandatory even after every R03 repair passes. It must close:

- `R02-E-B1-001`
- `R02-E-B3-001`
- `R02-E-B4-001`
- `R02-E-B5-001`
- `R02-E-B6-001`
- `R02-E-SCHEMA-001`
- `R02-E-TOOLING-001`

R04 must use a disposable PostgreSQL instance, never a shared/user/development/production database. It must apply the actual migration chain, introspect constraints/indexes, exercise concurrency and fault points, kill/restart application and workers, prove replay/idempotency and effect redelivery, verify exact reload digests, qualify performance under documented hardware/load, and emit immutable evidence with commands, versions, timestamps, seeds, exit codes, and database cleanup confirmation.

## 16. Unexpected repository drift

None. The pre-existing tree was dirty by design and remained contained. No accidental whole-file deletion, generated-artifact cleanup, formatting rewrite, line-ending conversion, dependency install, or unrelated rewrite occurred during R02. Git emitted existing LF-to-CRLF warnings during read-only diff inspection; no file was touched and the mutation fingerprints/path sets remained unchanged.

## 17. Changed-file confirmation

R02 created exactly one file:

`artifacts/footprint-binding-remediation/r02-b1-b6-contract-audit.md`

No existing file changed. The expected final changed-path count is 1,251. Excluding this self-describing R02 report, the ending changed-path set and mutation fingerprint equal the 1,250-path pre-R02 snapshot. The protected repository `C:/Users/robsa/sirkit` was not accessed for writes.

## 18. Final readiness fields

```text
R02 AUDIT: COMPLETE
B1: FAIL
B2: FAIL
B3: FAIL
B4: FAIL
B5: FAIL
B6: FAIL
IMPLEMENTATION GAPS: 18
EVIDENCE-ONLY GAPS: 7
R03 REQUIRED: YES
R04 REQUIRED: YES
STAGE 6 MAY RESUME: NO
STAGE 7 MAY RESUME: NO
```

`R02 AUDIT: COMPLETE` means the contract audit and gap inventory are complete. It does not mean any prerequisite block passed.
