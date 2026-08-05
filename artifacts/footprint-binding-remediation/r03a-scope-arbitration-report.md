# R03A Scope Arbitration and Executable Repair-Batch Split

Date: 2026-07-19  
Machine-readable plan: `artifacts/footprint-binding-remediation/r03a-repair-batches.json`

## 1. Verdict

**R03A VERDICT: SPLIT_PLAN_READY**

The earlier `R03 VERDICT: BLOCKED_SCOPE_REVIEW` was correct for one 20-file/1,500-line patch. It is not a terminal program result. All 18 source gaps now reconcile exactly into ten bounded, topologically ordered batches plus one evidence-only R04 obligation. No source gap is lost, duplicated, or converted into speculative Stage 6/7 work.

The challenged classification is:

| Primary category | Count |
|---|---:|
| A - true B1-B6 implementation defect | 12 |
| B - evidence-only obligation | 1 |
| C - B7 consumer compatibility change | 1 |
| D - authentication integration decision | 1 |
| E - migration-authority decision | 3 |
| F - duplicate/superseded/false-positive | 0 |
| G - Stage 6/7 feature work | 0 |

Seventeen source gaps still require implementation or bounded integration work. `R02-SCHEMA-001` is reclassified as evidence-only: historical 0023 must remain immutable, while clean/incompatible-existing migration behavior belongs to isolated R04 qualification.

## 2. Repository identity and status fingerprint

| Field | Value |
|---|---|
| Repository root | `C:/Users/robsa/Documents/Codex/2026-07-13/do/work/sirkit-edit` |
| Protected original | `C:/Users/robsa/sirkit` (not active; not modified) |
| Branch | `codex/cd-13-full-flow-orchestrator` |
| HEAD | `2bd1603a775bd4b409b89710cd4e5f8d70201632` |
| Starting changed paths | 1,254 |
| Starting fingerprint | `3a2ed60c195503c644048b6f4c1344a188fb4c2a92e03c2db1eb88069e86aa4f` |
| Staged/deleted/renamed/type-changed/unmerged | 0 / 0 / 0 / 0 / 0 |
| Required reports missing | 0 |

Required input hashes:

| Input | SHA-256 |
|---|---|
| R01 manifest | `599205e5a614a13e1b0eefef624aeb3d1e6554e7a404d9f5c6262e9699f3ea55` |
| R01 report | `b85416d9f316bf48a8402bdba5ea1b0ceba7fce6a9221a610ceecb4167ccf1fb` |
| R02 audit | `0e18b915fa408059957a12b5b2438985ce767f3ce1b0b59121a742fe26fa3fdb` |
| R03 blocker report | `ff51ab2502321dc72423fecdc7444f46de35f0075c445bb4a1c9e17894788489` |

## 3. R04 and R05 dependency truth

R04 and R05 did not fail qualification. They were not eligible to execute:

- R03 stopped before product edits with 0/18 gaps closed.
- R04 therefore returned `BLOCKED_R03_PREREQUISITE` without creating or connecting to PostgreSQL.
- R05 therefore returned `BLOCKED_STALE_OR_MISSING_EVIDENCE` without running the release gate.

Those are dependency results. After R03-B01 through R03-B10 complete, R04 must run from scratch against an isolated PostgreSQL instance, followed by a fresh R05 gate.

## 4. Exact 18-gap register

The JSON artifact contains the lossless structured record for every field required by R03A: exact requirement, original status/severity, symbols, paths, root cause, minimum repair, prior estimate, tests, dependencies, blocker claims, challenged classification, evidence, and disposition. The full register is summarized below without removing technical substance.

### `R02-B1-004`

- **Requirement/status/severity/owner:** explicit selection/approval with actor, reason, timestamp, evidence and expected revision; `FAIL`; `P1_AUTHORITY`; B1.
- **Symbols/paths:** `PhysicalBindingTransitionRequest`, `PhysicalBindingAuditEvent`, `PhysicalBindingService.transition`; `physical-binding/types.ts`, `transitions.ts`, `validation.ts`.
- **Root cause/minimum repair:** request/audit lack decision evidence. Add evidence references to validation, digest, and audit with compatible contract versioning.
- **Tests/dependencies/blockers:** missing/tampered evidence and digest/audit tests; no prerequisite gap; a narrow B7 caller must later forward evidence.
- **Classification/disposition:** A; `R03-B01`.

### `R02-B1-006`

- **Requirement/status/severity/owner:** idempotency prevents duplicate approval; `FAIL`; `P1_AUTHORITY`; B1.
- **Symbols/paths:** `PostgresPhysicalBindingRepository.commit`; `physical-binding/server-repository.ts`.
- **Root cause/minimum repair:** duplicate lookup checks only project-scoped key, not owner/request digest. Replay only identical committed requests; conflict on changed owner/payload.
- **Tests/dependencies/blockers:** same/same replay, same/different conflict, cross-component collision; coordinate with `R02-B1-010`; no auth/migration/B7 blocker.
- **Classification/disposition:** A; `R03-B01`.

### `R02-B1-010`

- **Requirement/status/severity/owner:** audit and current head cannot disagree; `FAIL`; `P0_SAFETY`; B1.
- **Symbols/paths:** `PostgresPhysicalBindingRepository.commit`; `physical-binding/server-repository.ts`.
- **Root cause/minimum repair:** four `onConflictDoNothing` inserts are not equivalence-checked before head publication. Compare existing immutable row identity/digest/payload or abort.
- **Tests/dependencies/blockers:** collision rollback for binding/audit/migration/assessment and unchanged head; none.
- **Classification/disposition:** A; `R03-B01`.

### `R02-B1-011`

- **Requirement/status/severity/owner:** authorization enforced at service/API boundary; `FAIL`; `P1_AUTHORITY`; shared B1/B3/B4/B5.
- **Symbols/paths:** four API `_scope.ts` modules for physical bindings, PCB sync, mapping and passive policy.
- **Root cause/minimum repair:** caller headers assert trusted identity/scope/role. Adapt a product-supplied `TrustedEngineeringRequestContextProvider`; do not create a user-auth platform here.
- **Tests/dependencies/blockers:** forged role, membership, body substitution and valid-session cases; real platform auth authority is a batch-specific blocker.
- **Classification/disposition:** D; `R03-B09`.

### `R02-B1-012`

- **Requirement/status/severity/owner:** practical constraints prevent malformed/orphan records; `FAIL`; `P0_SAFETY`; B1.
- **Symbols/paths:** B1 Drizzle tables, `db/schema.ts`, historical 0022.
- **Root cause/minimum repair:** selected revision, assessment/migration references, positive revisions and states are application conventions. Add a forward integrity migration after existing-data audit; never edit 0022.
- **Tests/dependencies/blockers:** orphan/state/revision rejection and valid-history preservation; depends on migration authority/B6 scope work.
- **Classification/disposition:** E; `R03-B07`.

### `R02-B2-006`

- **Requirement/status/severity/owner:** versioned project passive policy and traceable per-component exception are production resolver inputs; `FAIL`; `P1_AUTHORITY`; B2.
- **Symbols/paths:** `FootprintResolutionService`, `DisabledCandidateSource`, `PassivePolicyCandidateSource`; resolver adapters/service, Stage 5 adapter and PCB-sync route.
- **Root cause/minimum repair:** production Stage 3 uses the disabled default passive source. Build one production composition root with durable B1/B4/B5/library inputs.
- **Tests/dependencies/blockers:** production construction, revision digest, exception trace and read-only batch tests; depends on repaired B5 exception lifecycle.
- **Classification/disposition:** A; `R03-B05`.

### `R02-B2-X01`

- **Requirement/status/severity/owner:** one consistent global/exact assembly-variant applicability contract; `FAIL`; `P2_INTEGRATION`; B2.
- **Symbols/paths:** resolver validation/engine and mapping Stage 1 projector.
- **Root cause/minimum repair:** engine treats empty variants as global while validation/projector require `.includes()`. Centralize one predicate.
- **Tests/dependencies/blockers:** empty/global, exact, nonmatching and multi-variant cases; none.
- **Classification/disposition:** A; `R03-B05`.

### `R02-B3-003`

- **Requirement/status/severity/owner:** restart-safe lifecycle and no partial plan/audit/board inconsistency; `FAIL`; `P1_RECOVERY`; B3.
- **Symbols/paths:** `PcbSynchronizationService.apply`, `updatePlanLifecycle`, `commitAppliedBoard`; PCB-sync service/durable/types.
- **Root cause/minimum repair:** `applying` commits separately with no death recovery. Remove unsafe prepublication or use a recoverable lease/state machine.
- **Tests/dependencies/blockers:** fault before final commit, fresh-repository retry, no partial publication, idempotent retry; none.
- **Classification/disposition:** A; `R03-B02`.

### `R02-B3-006`

- **Requirement/status/severity/owner:** apply revalidates exact current authority and rejects stale plans; `FAIL`; `P0_SAFETY`; B3.
- **Symbols/paths:** `PcbSynchronizationService.apply`; `pcb-sync/service.ts`.
- **Root cause/minimum repair:** revalidation uses `plan.createdAt`. Use trusted current apply time/current heads and reject clock regression.
- **Tests/dependencies/blockers:** approval expiry, changed head, clock regression, unchanged success; final resolver composition required.
- **Classification/disposition:** A; `R03-B02`.

### `R02-B3-014`

- **Requirement/status/severity/owner:** no production PCB-sync/board authority only in process/browser state; `FAIL`; `P1_AUTHORITY`; B3.
- **Symbols/paths:** `PcbEditor.handleSync`, `syncFromSchematic`, `loadCurrentBoard`, `saveCurrentBoard`; `PcbEditor.tsx`, `netlist-bridge.ts`, `board-persistence.ts`.
- **Root cause/minimum repair:** editor mutates through legacy sync and saves browser authority. Switch the exact caller to durable B3; local state becomes explicit import/cache only.
- **Tests/dependencies/blockers:** durable editor sync, server revision precedence, legacy import, export authority; depends on repaired B3/auth and requires proven narrow B7 behavior compatibility.
- **Classification/disposition:** C; `R03-B10`.

### `R02-B4-002`

- **Requirement/status/severity/owner:** verification results durable/revisioned/evidence-bound; `FAIL`; `P1_AUTHORITY`; B4.
- **Symbols/paths:** `MappingVerificationService.rememberResult` and `results`; `mapping-verification/service.ts`.
- **Root cause/minimum repair:** Map is written before durable `put`. Persist first and make any cache read-through/non-authoritative.
- **Tests/dependencies/blockers:** put failure, reload, cache poison/digest mismatch; none.
- **Classification/disposition:** A; `R03-B03`.

### `R02-B4-005`

- **Requirement/status/severity/owner:** one B1 projection authority and durable/recoverable invalidation on mapping change; `FAIL`; `P1_AUTHORITY`; B4.
- **Symbols/paths:** durable mapping commit, mapping service, projector and invalidation.
- **Root cause/minimum repair:** projection/invalidation are independent unordered effects, owner reports success early, mapping approval directly approves B1. Add explicit effect status/order/barrier and distinct B1 decision semantics.
- **Tests/dependencies/blockers:** effect failures/duplicates/revoke/readiness and approval separation; depends B4 durable result and repaired B6.
- **Classification/disposition:** A; `R03-B08`.

### `R02-B5-005`

- **Requirement/status/severity/owner:** exception is an explicit authoritative operation; `FAIL`; `P0_SAFETY`; B5.
- **Symbols/paths:** passive exception action, service and evaluator.
- **Root cause/minimum repair:** `assign_profile` is accepted but ignored. Implement pinned-profile behavior or reject; never fall through.
- **Tests/dependencies/blockers:** pinned/missing/stale/risky profile cases; depends on complete exception fields and has a later B7 forwarding hunk.
- **Classification/disposition:** A; `R03-B04`.

### `R02-B5-006`

- **Requirement/status/severity/owner:** exception records complete chosen identity/evidence and expected policy/context/component revisions; `FAIL`; `P1_AUTHORITY`; B5.
- **Symbols/paths:** `PassiveComponentException`, mutation request, passive service.
- **Root cause/minimum repair:** no pinned fact/context/profile/footprint revision set. Make a revision-bound decision with exact authority/evidence.
- **Tests/dependencies/blockers:** stale authorities, cross-scope, key conflict and reload reproduction; later B7 caller must forward fields.
- **Classification/disposition:** A; `R03-B04`.

### `R02-B5-011`

- **Requirement/status/severity/owner:** removal/supersession cannot leave stale ready state; `FAIL`; `P2_INTEGRATION`; B5.
- **Symbols/paths:** passive service/types/API handler.
- **Root cause/minimum repair:** no revoke/remove/supersede action. Add revision-checked successor, audit and invalidation.
- **Tests/dependencies/blockers:** revoke/retry/stale-head/invalidation; depends on B5 decision fields and B6 event contract.
- **Classification/disposition:** A; `R03-B04`.

### `R02-B6-006`

- **Requirement/status/severity/owner:** outbox has durable owner revision, event type/version and complete retry/terminal identity; `FAIL`; `P1_RECOVERY`; B6.
- **Symbols/paths:** durable event/commit types, memory/PostgreSQL repositories, outbox, schema and historical 0023.
- **Root cause/minimum repair:** owner aggregate/revision and event version are absent. Add them through forward 0024 and bind identity/digest/dispatch.
- **Tests/dependencies/blockers:** owner/version persistence, payload conflict, lease/reload; migration authority and later B7 repository compatibility required.
- **Classification/disposition:** E; `R03-B06`.

### `R02-B6-X01`

- **Requirement/status/severity/owner:** aggregate identity and every lookup/CAS enforce tenant/project/branch; `FAIL`; `P1_AUTHORITY`; B6.
- **Symbols/paths:** durable repository `loadHead/history`, PostgreSQL implementation, head/record unique indexes.
- **Root cause/minimum repair:** identity is type/key only despite scope columns. Make scope mandatory and migrate unique/index identity with collision audit.
- **Tests/dependencies/blockers:** colliding cross-tenant keys, scoped history/CAS and migration preflight; migration authority and B7 repository compatibility required.
- **Classification/disposition:** E; `R03-B06`.

### `R02-SCHEMA-001`

- **Requirement/status/severity/owner:** incompatible pre-existing 0023 objects must not be silently treated as intended shape; `FAIL`; `P2_OPERATIONS`; B6 operations.
- **Symbols/paths:** historical 0023 and Drizzle journal.
- **Root cause/minimum repair:** `IF NOT EXISTS` matters only when deployment is already drifted. Keep 0023 immutable and prove clean, compatible-existing, incompatible-existing and recovery behavior in isolated PostgreSQL.
- **Tests/dependencies/blockers:** R04 Q2/Q4 migration scenarios; no code dependency.
- **Classification/disposition:** B; R04 evidence-only.

Extracted gap count: **18 exactly**.

## 5. Challenged classifications

The prior findings were not accepted mechanically:

- The 12 A gaps have direct contradictory code paths and are genuine code defects.
- `R02-B1-011` is not a normal API patch because the repository has no trustworthy human identity/session/membership source. It is isolated as D rather than blocking transaction work.
- The three E gaps need real forward schema changes, but historical applied state is unknown. They are isolated behind one migration-authority gate.
- `R02-B3-014` is a real prerequisite defect whose final consumer switch crosses exactly two frozen B7-classified files; it is C, not broad permission to work on Stage 6.
- `R02-SCHEMA-001` moves from repair to B evidence. Rewriting 0023 cannot safely cure a pre-existing drift scenario; isolated schema-shape/recovery proof is the correct obligation.
- No gap is duplicate/false-positive and none of the 18 belongs to Stage 6/7 feature development.

## 6. Root-cause consolidation

The 18 findings collapse into these coherent roots:

1. B1 decision/replay/immutable persistence integrity.
2. B3 plan application lifecycle/current-time safety.
3. B4 durable-first verification result.
4. B5 complete exception semantics/lifecycle.
5. B2 final production input composition/variant contract.
6. B6 scoped aggregate/versioned owner-bound outbox schema.
7. B1 relational constraints after migration authority.
8. B4/B5 downstream-effect convergence on repaired B6.
9. Trusted request context for protected mutation APIs.
10. Proven B7 contract compatibility and browser-authority retirement.
11. R04 migration-drift and live recovery evidence.

No batch combines unrelated roots merely to reduce batch count.

## 7. B7 dependency proofs

Four exact consumer dependencies are proven. All are isolated in final `R03-B10`; none authorizes new queue/workbench behavior.

| Owning gaps | Changed prerequisite | Exact B7 caller | Minimum compatibility hunk | Kind |
|---|---|---|---|---|
| `B1-004` | mandatory decision evidence | `assignment-queue/service.ts:47` constructs `PhysicalBindingTransitionRequest` | queue decision types/service/tests forward pinned evidence | compile + behavior |
| `B5-005/006/011` | revision-complete passive exception | `assignment-queue/types.ts:131`, `service.ts:48` | types/service/revalidation tests forward exact fields and lifecycle action | compile + behavior |
| `B6-006/X01` | scoped repository and owner-bound event | `assignment-queue/repository.ts` uses unscoped `loadHead` and emits outbox effects | repository plus focused tests supplies scope/owner | compile + behavior |
| `B3-014` | durable B3 board revision client | `PcbEditor.tsx:353` calls legacy sync and imports local board persistence | editor call, persistence demotion, legacy importer boundary, tests | behavior |

Why B3 cannot hide compatibility solely inside B1-B6: `syncFromSchematic` currently accepts only schematic, optional board and resolver/placement options. It has no trusted project/actor/expected-board revision, and returns a locally mutated board. `board-persistence.ts` separately loads/saves project PCB authority from `localStorage`. A hidden fetch inside that signature would invent identity and still leave the browser board authoritative.

Rejected B7 claims:

- A type import by itself does not justify editing B7; only the four concrete constructor/call contracts above do.
- Stage 6 UI redesign, new actions, queue materialization, bulk workflow, pagination, and Stage 7 resync behavior are forbidden in `R03-B10`.
- B7 authentication itself is not required to close B1-B6 gap `B1-011`; it remains part of the original Stage 6 completion work after R05 authorizes resumption.

## 8. Authentication decision record

**Decision: BATCH-SPECIFIC BLOCKER (`R03-B09`)**

| Question | Finding |
|---|---|
| Actor/session retrieval | No production human session retrieval exists. |
| Tenant/project membership | No membership repository or middleware exists. |
| Existing helpers | `engineering/authorization.ts` maps a supplied actor role to capabilities; `pcb-sync/authorization.ts` trusts the supplied actor. |
| Trusted source | Only the engineering-effects/assignment-worker bearer secret is trusted, and it is machine-only. |
| Current error model | Stable per-domain unauthorized/scope-mismatch codes. |
| Audit identity | `EngineeringActor` with actor ID/kind/session/role/delegation. |
| Current tests | API tests construct self-asserted `x-sirkit-*` headers; worker tests cover only secret equality. |

No NextAuth, Clerk, Auth0, Supabase Auth, Lucia, Better Auth, session middleware, `currentUser`, `getServerSession`, or equivalent is present. Supabase appears only as a PostgreSQL connection compatibility comment.

The selected bounded contract is `TrustedEngineeringRequestContextProvider`, returning verified tenant/project/branch membership and a verified `EngineeringActor`. `R03-B09` may adapt the four B1-B5 scope modules only after the real product provider is supplied. It must not create a new login/session/membership platform or treat the worker secret as a user identity.

This blocks only B09 and downstream B10/R04, not code-only batches B01-B05.

## 9. Migration-authority decision record

**Decision: BATCH-SPECIFIC BLOCKER (`R03-B06`)**

- Journal/files 0006-0023 exist once in strict order; latest verified ID is 0023.
- TypeScript schema and 0022/0023 agree on current table shape.
- Required B6 owner/event/scope fields and required B1 constraints are genuinely absent.
- Package scripts expose `drizzle-kit generate` and `push`, not a documented authoritative migrate/deploy command.
- Snapshots stop at 0008.
- `.env.local` exists, but its values were not read and no database was contacted; it is not applied-state authority.

History policy:

1. Never edit, rewrite, renumber, squash or reorder 0022/0023.
2. `R03-B06` first proves an isolated disposable target or receives authoritative deployment migration inventory.
3. If the gate passes, add only `0024_footprint_binding_durable_workflow_hardening.sql`.
4. `R03-B07` may then add only `0025_footprint_binding_integrity.sql`.
5. R04 later applies/qualifies the whole chain; it does not manufacture down migrations.

Unknown applied state does not block B01-B05.

## 10. Dependency graph

```text
R03-B01  B1 decision/repository integrity -----------+
R03-B02  B3 apply lifecycle/current time ------------+
R03-B03  B4 durable-first result ----+               |
R03-B04  B5 exception lifecycle -----+--> R03-B05    |
                                       B2 composition |
R03-B06  migration gate + B6 foundation --> R03-B07  |
                    |                     B1 schema   |
                    +------------------> R03-B08 -----+
                         B4/B5 effects                 |
R03-B09  trusted request context ---------------------+
                                                        v
                                                  R03-B10
                                            B7 compatibility only
                                                        |
                                                        v
                                                       R04
                                                        |
                                                        v
                                                       R05
                                                        |
                                      original Stage 6 prompt, if authorized
```

Independent batches must still run sequentially in this dirty working tree. The recommended execution order is the numeric order, even where dependency arrows permit another order.

## 11. Ordered repair batches

| Batch | Gaps | Root | Depends on | Files | Churn | Migration | Successor |
|---|---|---|---|---:|---:|---|---|
| `R03-B01` | B1-004/006/010 | B1 decision/repository integrity | - | 9 | 780 | none | B02 |
| `R03-B02` | B3-003/006 | B3 apply lifecycle/time | - | 6 | 620 | none | B03 |
| `R03-B03` | B4-002 | B4 durable-first result | - | 3 | 240 | none | B04 |
| `R03-B04` | B5-005/006/011 | B5 exception lifecycle | - | 9 | 980 | none | B05 |
| `R03-B05` | B2-006/X01 | B2 production composition/variant | B04 | 10 | 920 | none | B06 |
| `R03-B06` | B6-006/X01 | migration gate + B6 scope/outbox | - | 15 | 1,380 | proposed 0024 | B07 |
| `R03-B07` | B1-012 | B1 relational integrity | B06 | 6 | 680 | proposed 0025 | B08 |
| `R03-B08` | B4-005 | B4/B5 effect convergence | B03/B04/B06 | 13 | 1,250 | none | B09 |
| `R03-B09` | B1-011 | trusted request context | platform provider | 10 | 1,050 | none | B10 |
| `R03-B10` | B3-014 | B7 contract compatibility only | B01/B02/B04/B05/B06/B08/B09 | 11 | 1,280 | none | R04 |

Every batch is at or below 20 files, 1,500 churn and one forward migration. Estimates include focused tests. Exact allowed/forbidden paths are in the JSON plan.

## 12. Budget proof and temporary contracts

- B01-B05 are code-only and do not need migration applied-state authority.
- B06 is the largest batch at 15 files/1,380 churn; it must stop at 80% if actual scope grows and may not absorb B1 constraints.
- B07 is a separate migration because B1 relational integrity is a distinct root and architectural seam.
- B08 consumes B06's event fields; it may not add another schema.
- B09 cannot start without a real provider; it may define/adapt the narrow interface but not a login platform.
- B10 is last. During B06-B09 the Stage 6 flag remains default-off; unsafe legacy B7 overloads may not be enabled in production. B10 removes the narrow temporary compatibility surface and proves frozen compatibility.

No batch may run concurrently in this dirty tree. Each must capture task-local hashes/numstat, use `apply_patch`, avoid broad formatting/generation, and produce an attributable report.

## 13. Tests and acceptance criteria by batch

### B01

- Missing/tampered decision evidence; digest/audit inclusion.
- Same-key/same-request replay; same-key/different request/owner conflict.
- Binding/audit/migration/assessment collision rollback and unchanged head.
- Accept only if no conflicting immutable row can be published and stale CAS remains deterministic.

### B02

- Fault after apply begins but before final commit; fresh-repository retry.
- Approval expires between preflight/apply; changed head and clock regression.
- Accept only if plan remains retryable and final board/plan/audit/replay publication is atomic in the repository contract.

### B03

- Durable `put` failure leaves no cache; fresh service reload; digest mismatch.
- Accept only if process memory cannot authorize mapping mutation.

### B04

- `assign_profile` pinned/missing/stale/risky cases.
- Component/context/profile revision conflict, cross-scope, replay conflict.
- Revoke/supersede successor, audit and invalidation intent.
- Accept only if every accepted action has explicit semantics and complete authority fields.

### B05

- Real production composition uses versioned passive policy/exception input.
- Dependency digest changes on policy/exception revision.
- Global/exact/nonmatching/multi-variant cases across B1/B2/B4.
- Accept only if production and tests use the same deterministic read-only resolver inputs.

### B06

- Isolated migration-authority preflight before journal edit.
- Same aggregate key in different scopes; scoped history/CAS.
- Owner revision/event version persistence and payload conflict.
- Lease/retry reload plus B3-B5 adapter contracts.
- Accept only if 0022/0023 hashes stay unchanged and no unscoped production B1-B5 lookup remains.

### B07

- Existing-data integrity preflight; orphan/state/revision rejection; valid history retained.
- Accept only if bad data fails visibly and 0025 is the only new migration.

### B08

- Projection/invalidation order and status; one-effect/terminal failure.
- Duplicate/redelivery, mapping approval separation, revoke plan staling, reconciled count.
- Accept only if owner success cannot masquerade as readiness success.

### B09

- Verified session; forged header/body substitution; cross-project membership; audit actor.
- Accept only if a real provider is named and all four mutation API families fail closed without it.

### B10

- B1 evidence, B5 complete exception and B6 scoped/event contract forwarding.
- Durable editor sync; server revision beats local copy; explicit legacy import; no auto-apply.
- Focused frozen B7 compile/tests and assertion that no Stage 6 behavior surface expanded.
- Accept only if local board state is non-authoritative and only the proven hunks changed.

## 14. Evidence-only obligations assigned to R04

Reclassified source gap:

- `R02-SCHEMA-001`: clean, compatible-existing, incompatible-existing and recovery behavior for historical 0023.

Existing R02 evidence gaps retained:

- `R02-E-B1-001`
- `R02-E-B3-001`
- `R02-E-B4-001`
- `R02-E-B5-001`
- `R02-E-B6-001`
- `R02-E-SCHEMA-001`
- `R02-E-TOOLING-001`

R04 remains unauthorized until B01-B10 complete.

## 15. Stage 6 and Stage 7 deferral

No source gap is category G. However, all actual Stage 6 feature/completion work remains deferred:

- no queue/workbench redesign;
- no new assignment actions or bulk behavior;
- no Stage 6 auth expansion beyond compatibility;
- no Stage 7 persistence/library revision/resync work;
- no routed-copper work.

The original Stage 6 prompt may run only after R04 completes and R05 explicitly authorizes resumption. Stage 7 remains prohibited until that Stage 6 prompt independently returns `COMPLETE`.

## 16. Unresolved material decisions

Only two decisions remain:

1. **AUTH-PLATFORM-01 (`R03-B09`)**: identify the external product identity/session/project-membership authority that will implement the trusted request-context interface.
2. **MIGRATION-STATE-01 (`R03-B06`)**: provide authoritative applied state for 0022/0023, or approve the batch's isolated-database-first forward-only gate before 0024/0025.

Neither decision blocks recommended next batch B01.

## 17. R03A write confirmation

R03A created exactly:

1. `artifacts/footprint-binding-remediation/r03a-repair-batches.json`
2. `artifacts/footprint-binding-remediation/r03a-scope-arbitration-report.md`

No existing report, production source, test, schema, migration, configuration, lockfile, B7, Stage 7, or protected-original file changed. Final fingerprint/count confirmation follows creation.

## 18. Recommended next batch

Run **`R03-B01` - B1 decision and repository integrity** next. It is code-only, does not depend on authentication or migration authority, fits the original stop-loss, and establishes safe decision/replay semantics consumed by later compatibility work.

## Final fields

```text
R03A VERDICT: SPLIT_PLAN_READY
SOURCE GAPS: 18
TRUE IMPLEMENTATION GAPS: 17
EVIDENCE-ONLY GAPS: 1
DUPLICATE/FALSE-POSITIVE GAPS: 0
DEFERRED STAGE 6/7 GAPS: 0
REPAIR BATCHES: 10 - R03-B01, R03-B02, R03-B03, R03-B04, R03-B05, R03-B06, R03-B07, R03-B08, R03-B09, R03-B10
AUTHENTICATION DECISION: BATCH-SPECIFIC BLOCKER
MIGRATION DECISION: BATCH-SPECIFIC BLOCKER
PROVEN B7 COMPATIBILITY BATCH: YES
NEXT ACTION: R03-B01
R04 AUTHORIZED: NO
R05 AUTHORIZED: NO
STAGE 6 MAY RESUME: NO
STAGE 7 MAY RESUME: NO
FILES WRITTEN: exactly two
```
