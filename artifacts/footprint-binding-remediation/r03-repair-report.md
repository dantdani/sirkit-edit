# R03 Minimal Durability and Transaction Repair Report

Date: 2026-07-19  
Repository: `C:/Users/robsa/Documents/Codex/2026-07-13/do/work/sirkit-edit`  
Protected original: `C:/Users/robsa/sirkit`

## 1. Verdict

**R03 VERDICT: BLOCKED_SCOPE_REVIEW**

No production code, test, schema, migration, configuration, lockfile, frozen B7 path, or historical report was changed. The R03 pre-edit stop-loss gate proves that closing all 18 R02 implementation gaps cannot credibly fit within the authorized maximum of 20 source/schema/test files and 1,500 total added plus deleted lines.

The conservative lower-bound repair is 34 distinct source/schema/test files, with a likely 34-42-file implementation and approximately 1,800-2,600 lines of task-local churn. This excludes this report. Three independent boundary blockers also require explicit decisions before repair:

1. `R02-B3-014` cannot be fully closed without changing `app/components/pcb/PcbEditor.tsx` and `app/lib/pcb/board-persistence.ts`, both explicitly frozen B7-only paths.
2. `R02-B1-011` requires a trusted server authentication/session and project-membership authority. No such adapter exists in the authorized B1-B6 closure; caller-controlled headers are used throughout the application.
3. `R02-B1-012`, `R02-B6-006`, `R02-B6-X01`, and `R02-SCHEMA-001` plausibly require one forward migration, but the repository does not establish whether 0022/0023 have been applied in any environment. R03 is prohibited from editing migration history without that authority decision.

The prompt requires all assigned implementation gaps to close for `COMPLETE`; it forbids silently enlarging scope or implementing an arbitrary subset. R03 therefore stopped before product edits and before adding failing tests whose fixes could not be completed inside the approved budget.

## 2. Repository identity and baseline

| Field | Verified value |
|---|---|
| Git root | `C:/Users/robsa/Documents/Codex/2026-07-13/do/work/sirkit-edit` |
| Protected original active | No |
| Branch | `codex/cd-13-full-flow-orchestrator` |
| HEAD | `2bd1603a775bd4b409b89710cd4e5f8d70201632` |
| R01 | `COMPLETE` |
| R02 | `COMPLETE` |
| R02 report SHA-256 | `0e18b915fa408059957a12b5b2438985ce767f3ce1b0b59121a742fe26fa3fdb` |
| R03 starting changed paths | 1,251 |
| R03 starting tracked numstat | 134 files, +6,510 / -1,456 relative to HEAD |
| R02-ending status fingerprint | `df3abcc537d4caf9702579b04fcf1ff59a61e8534fff8bedec93442847d685d3` |
| Candidate-file hash manifest | 49 inspected candidate paths; aggregate SHA-256 `4a976bdcc733e8661737625aab51016a884b3c25cedf1ac4f7edf64a5ab61df4` |
| Unexpected drift before R03 | None |

The candidate-file hash manifest is the SHA-256 of ordinally sorted `path<TAB>file-sha256` rows for the 49 existing files in the pre-edit mapping. It includes the two frozen files only to prove the cross-stage dependency; it does not authorize editing them.

## 3. R02 implementation gaps accepted

All 18 R02 implementation gaps were assigned to R03:

1. `R02-B1-004`
2. `R02-B1-006`
3. `R02-B1-010`
4. `R02-B1-011`
5. `R02-B1-012`
6. `R02-B2-006`
7. `R02-B2-X01`
8. `R02-B3-003`
9. `R02-B3-006`
10. `R02-B3-014`
11. `R02-B4-002`
12. `R02-B4-005`
13. `R02-B5-005`
14. `R02-B5-006`
15. `R02-B5-011`
16. `R02-B6-006`
17. `R02-B6-X01`
18. `R02-SCHEMA-001`

The seven `R02-E-*` items remain evidence-only and were not converted into code changes.

## 4. Gap-to-change ledger

The estimates below are repair estimates, not edits performed. Per-row file counts overlap; the deduplicated conservative lower bound is 34 files.

| Gap | Root cause and smallest credible repair | Exact proposed implementation boundary | Focused tests required | Data/migration/compatibility | Estimate |
|---|---|---|---|---|---:|
| `R02-B1-004` | Approval/selection decisions lack mandatory decision evidence. Add typed evidence references, validation, digest/audit inclusion, and backward-compatible schema version handling. | `app/lib/physical-binding/types.ts`, `validation.ts`, `transitions.ts` | `readiness-transitions.test.ts`, API/serialization case | JSON contract version; possibly query columns | 4-5 files, 120-190 lines |
| `R02-B1-006` | Idempotency lookup is project-wide and does not verify aggregate/request digest. Bind replay to set/component and reject same-key/different-request. | `app/lib/physical-binding/server-repository.ts`, types as needed | `state-conflict-contract.test.ts` plus PostgreSQL-adapter contract fixture | Likely unique-index change or stored owner ID | 2-4 files, 100-180 lines |
| `R02-B1-010` | `onConflictDoNothing` can preserve different immutable content and still publish a head. Load/compare existing digest/payload and abort before head CAS. | `app/lib/physical-binding/server-repository.ts` | collision/rollback cases for binding, audit, migration, assessment | No schema required if collision checks suffice | 2 files, 100-160 lines |
| `R02-B1-011` | API scope and role are caller-asserted headers. Introduce one verified session/project-membership adapter and derive all B1/B3/B4/B5 scopes from it. | New trusted auth adapter outside the current family boundary; four `_scope.ts` files; their API security tests | forged role, cross-tenant, missing session, membership mismatch, legitimate session | Product auth/session authority must be selected; compatibility changes for every caller | 9-12 files, 300-500 lines |
| `R02-B1-012` | B1/B6 database invariants are conventions rather than constraints. Add safe forward constraints after an existing-data audit. | `app/lib/db/schema.ts`, one new forward migration, `drizzle/meta/_journal.json`, schema tests | orphan/state/revision/JSON agreement migration tests | Migration required; cannot rewrite 0022/0023 | 4-6 files, 250-450 lines |
| `R02-B2-006` | Production Stage 3 constructs B2 with the passive source disabled. Add one production resolver composition root with durable B1/B4/B5 inputs. | `app/api/pcb-sync/route.ts`, `app/lib/footprint-resolver/service.ts` or a bounded composition module, `app/lib/passive-policy/stage2-adapter.ts` | production-construction, policy-change, exception trace, Stage 3 preflight tests | No new schema; depends on B5 repair | 3-5 files, 160-260 lines |
| `R02-B2-X01` | Empty variant scope means global in the engine but invalid in context validation/projector. Centralize and reuse one applicability predicate. | `app/lib/footprint-resolver/validation.ts`, shared scope helper, `app/lib/mapping-verification/stage1-projector.ts` | empty/global, exact, mismatch, multi-variant cases | Backward compatible | 3-4 files, 70-120 lines |
| `R02-B3-003` | Apply publishes `applying` separately and has no recoverable lease/claim. Add a recoverable state machine or remove the unsafe precommit state. | `app/lib/pcb-sync/service.ts`, `durable.ts`, `types.ts`; possibly B6 lease primitive | fault before/after lifecycle/final commit, stale claim recovery | May require plan apply owner/lease fields in the same forward migration | 4-6 files, 220-360 lines |
| `R02-B3-006` | Apply revalidates at `plan.createdAt`. Revalidate using a trusted current apply time and current authority heads/digest. | `app/lib/pcb-sync/service.ts` | approval expires between preflight/apply; clock regression; changed dependency head | No migration expected | 2 files, 60-110 lines |
| `R02-B3-014` | Shipping UI uses legacy sync and browser-persisted board authority. Route UI through durable B3 and demote/import legacy state. | `app/lib/pcb/netlist-bridge.ts`, **frozen** `app/components/pcb/PcbEditor.tsx`, **frozen** `app/lib/pcb/board-persistence.ts`; export integration as needed | UI/API authority, legacy import, multi-session/reload, export uses committed board | Cross-stage compatibility and possible board-import metadata | 5-8 files, 300-500 lines; frozen-path blocker |
| `R02-B4-002` | Mapping result cache is populated before durable put. Persist first; make cache read-through and non-authoritative. | `app/lib/mapping-verification/service.ts` | injected durable-put failure, restart, cache-poison rejection | No migration | 2 files, 50-100 lines |
| `R02-B4-005` | Projection and invalidation are independent unordered effects with no completion barrier; mapping approval silently becomes B1 approval. Add explicit pending/applied/failed projection state, ordering, and B1 decision contract. | `app/lib/mapping-verification/service.ts`, `durable.ts`, `stage1-projector.ts`, `types.ts`, B6 types/repository/outbox | one-effect failure, terminal poison, duplicate, revoke, readiness barrier, B1 approval separation | Likely outbox owner/dependency/status schema in forward migration | 6-9 files, 350-550 lines |
| `R02-B5-005` | `assign_profile` is accepted but evaluator ignores it. Implement pinned-profile semantics or reject the action until complete. | `app/lib/passive-policy/evaluator.ts`, `service.ts`, `types.ts` | assign success/missing/stale/risky cases | Coupled to complete exception fields | 3-4 files, 120-190 lines |
| `R02-B5-006` | Exception decision lacks component/context/profile/footprint revisions and evidence. Make it a revision-bound authoritative decision. | `app/lib/passive-policy/types.ts`, `service.ts`, validation/policy code, API handler | stale fact/profile/context, cross-project/variant, same-key payload conflict, reload fixture | JSON contract version; maybe query columns | 4-6 files, 220-340 lines |
| `R02-B5-011` | No revoke/remove/supersede exception operation. Add lifecycle action, audit, revision guard, and durable invalidation. | `app/lib/passive-policy/types.ts`, `service.ts`, `app/api/passive-policy/handler.ts` | revoke/retry/stale head/B2/B3 invalidation | Backward-compatible API extension | 4-5 files, 150-240 lines |
| `R02-B6-006` | Outbox omits explicit owner aggregate revision and event version. Extend commit input/event/schema and bind fields into identity/digest. | `app/lib/durable-workflow/types.ts`, `repository.ts`, `server-repository.ts`, `outbox.ts`, B4/B5 emitters | owner metadata, version rejection, replay, lease, duplicate delivery | Forward migration/backfill for pending events | 7-10 files, 300-480 lines |
| `R02-B6-X01` | Aggregate identity/lookup is not tenant/project/branch scoped. Make scope mandatory in identity and every load/history/CAS. | `app/lib/durable-workflow/types.ts`, `repository.ts`, `server-repository.ts`, all durable B3/B4/B5 callers | same key across tenants/projects, scoped history, CAS isolation | Forward index/key migration and collision audit | 8-12 files, 350-600 lines |
| `R02-SCHEMA-001` | 0023 `IF NOT EXISTS` can mask incompatible objects. Add forward schema-version/shape assertion; do not rewrite 0023. | one new migration after verified latest ID, `app/lib/db/schema.ts`, `_journal.json`, migration checks | clean, compatible-existing, incompatible-existing scenarios in R04; static assertions in R03 | Migration authority decision required | 3-4 files, 100-220 lines |

### Deduplicated lower-bound estimate

Even aggressively sharing tests and migrations, the minimum coherent set contains:

- 5 B1 domain/repository/test files;
- 6 authentication/scope/test files, assuming one reusable trusted adapter and only one consolidated security test;
- 6 schema/B6 files, including one forward migration;
- 3 B2 composition/scope/test files;
- 5 B3 lifecycle/legacy-authority files, two of which are frozen;
- 4 B4 projection/cache files;
- 5 B5 exception/evaluator/API files.

That is **34 files before this report**, not the authorized 20. A realistic test-complete implementation is 34-42 files. The credible churn range is **1,800-2,600 total added plus deleted lines**, exceeding the 1,500-line limit before work begins.

## 5. Implemented repairs by owner

None. Partial implementation would violate the completion contract because the remaining gaps are interdependent:

- B6 event/scope changes affect B3-B5 durable adapters.
- B4/B5 correctness depends on the repaired B6 event contract.
- B2 production composition depends on complete B5 exception semantics.
- B3 complete revalidation depends on B1/B2/B4/B5 current authority inputs.
- B7 consumes these contracts but is frozen.

## 6. Authority and transaction design after R03

Unchanged from the R02-audited state. The intended post-repair design remains:

- verified server session/member scope at every mutation boundary;
- B1 as the only physical-binding approval authority;
- B2 as read-only deterministic resolution;
- B3 as the durable plan/apply/board/audit authority;
- B4 verification durably persisted before use, with explicit B1 projection status and invalidation completion;
- B5 revision-complete exception decisions with revoke/supersede;
- B6 scope-safe CAS/replay/outbox primitives with explicit owner revision and event version;
- browser state reduced to a non-authoritative cache/import source.

No claim is made that this design is implemented by R03.

## 7. Schema and migration changes

None.

Historical migrations 0022 and 0023 were not edited. No 0024 migration was created, and `_journal.json`/`schema.ts` were not changed.

Before a migration-bearing repair may start, the user/release authority must state whether 0022 and/or 0023 have been applied in any local, development, staging, or production database. The approved strategy should be one forward successor migration, never rewriting already-applied history.

## 8. Tests added or changed

None. The prompt requires a failing test to be paired with a repair when practical. Because the pre-edit stop-loss gate blocked all repairs, adding tests alone would consume the dirty-tree budget without closing a gap and would leave an intentionally failing tree.

## 9. Commands run

| Command family | Exit/result | Mutation result |
|---|---|---|
| Read complete R03 prompt | 0 | No mutation |
| Git root/branch/HEAD/status/numstat checks | 0 | R02 ending state matched; no drift |
| Parse R01 manifest and R02 report/gap IDs | 0 | 18 implementation gaps confirmed |
| Targeted `rg` construction/auth/legacy PCB/durable workflow inspection | Read-only; one search reported absent root `middleware.ts` after returning matches | No mutation; no trusted auth middleware found |
| Proposed-file classification and SHA-256 capture | 0 | 49 existing candidate paths hashed; two frozen B7 dependencies identified |

No test, typecheck, formatter, generator, dependency command, migration, seeder, database command, or build was run in R03 because the mandatory pre-edit budget gate failed.

## 10. Failed or unrun tests

R03 focused tests: **not run**. This is a scope blocker, not a test pass. R02's earlier 175/176 combined result and isolated B5 performance pass remain historical evidence only; they do not qualify any R03 repair.

The following required R03 scenarios remain unrun: durable fresh-instance reload, same-key replay/different-payload conflict, owner rollback, lease expiry, duplicate effect, mapping/policy invalidation, stale plan apply, complete exception decision, unauthorized API mutation, production-memory fail-closed, and frozen B7 compatibility.

## 11. Task-local changed-file inventory

R03-attributable file:

| Path | Owner | Reason |
|---|---|---|
| `artifacts/footprint-binding-remediation/r03-repair-report.md` | R03 report | Records the mandatory pre-edit blocker, exact ledger, and proposed split. |

No source/schema/test file has R03-attributable numstat. Final report numstat/hash is verified after creation. No pre-existing changed line was reverted or rewritten.

## 12. Stop-loss budget usage

| Budget | Authorized | Used | Estimated required | Result |
|---|---:|---:|---:|---|
| Source/schema/test files | 20 | 0 | 34-42 | Blocked before edit |
| Total added + deleted lines | 1,500 | 0 | 1,800-2,600 | Blocked before edit |
| New forward migrations | 1 | 0 | 1 likely | Authority unknown |
| R03 report | 1 | 1 | 1 | Within budget |

The report is excluded from the 20-file source/schema/test count, as required.

## 13. Frozen B7 and Stage 7 confirmation

No B7 or Stage 7 file changed.

`R02-B3-014` specifically requires a new containment decision because its smallest complete production repair crosses into:

- `app/components/pcb/PcbEditor.tsx`
- `app/lib/pcb/board-persistence.ts`

Both are explicitly frozen by R03. A change only to `netlist-bridge.ts` would not remove browser board authority and therefore would not close the gap.

## 14. Unrelated pre-existing changes

All unrelated and pre-existing user changes were preserved. Nothing was deleted, restored, reset, formatted, generated, staged, committed, moved, or cleaned. The protected original repository was not modified.

## 15. Remaining implementation gaps

All 18 assigned implementation gaps remain open:

`R02-B1-004`, `R02-B1-006`, `R02-B1-010`, `R02-B1-011`, `R02-B1-012`, `R02-B2-006`, `R02-B2-X01`, `R02-B3-003`, `R02-B3-006`, `R02-B3-014`, `R02-B4-002`, `R02-B4-005`, `R02-B5-005`, `R02-B5-006`, `R02-B5-011`, `R02-B6-006`, `R02-B6-X01`, `R02-SCHEMA-001`.

## 16. Evidence-only obligations

The seven R04/R05 evidence gaps remain unchanged:

- `R02-E-B1-001`
- `R02-E-B3-001`
- `R02-E-B4-001`
- `R02-E-B5-001`
- `R02-E-B6-001`
- `R02-E-SCHEMA-001`
- `R02-E-TOOLING-001`

R04 is not authorized yet because no R03 implementation gap is closed.

## 17. Proposed split for user approval

The safe way forward is a series of separately contained repair passes with their own budgets and stop gates:

1. **R03-A - B6/schema foundation:** `R02-B6-006`, `R02-B6-X01`, `R02-SCHEMA-001`, and the constraint portion of `R02-B1-012`. Requires migration-authority confirmation. Estimated 8-12 files.
2. **R03-B - trusted API authority:** `R02-B1-011` across B1/B3/B4/B5. Requires selection or identification of the real session/project-membership authority and approval for a shared auth path outside the current family list. Estimated 7-11 files.
3. **R03-C - B1/B2 authority correctness:** `R02-B1-004`, `R02-B1-006`, `R02-B1-010`, remaining `R02-B1-012`, `R02-B2-006`, `R02-B2-X01`. Estimated 9-13 files.
4. **R03-D - B4/B5 projection and exception lifecycle:** `R02-B4-002`, `R02-B4-005`, `R02-B5-005`, `R02-B5-006`, `R02-B5-011`. Estimated 10-14 files.
5. **R03-E - B3 apply and UI authority:** `R02-B3-003`, `R02-B3-006`, `R02-B3-014`. Requires explicit permission to edit the two frozen B7/shared UI-persistence paths. Estimated 7-11 files.
6. **R03-F - compatibility verification:** affected B1-B6 type/tests plus frozen B7 compile only; no B7 edit unless separately approved.

Each pass should recapture the dirty-tree baseline, remain task-local, and stop before R04. Approval should answer two prerequisite questions: whether 0022/0023 have ever been applied, and which trusted authentication/session/project-membership authority Sirkit must use.

## Final fields

```text
R03 VERDICT: BLOCKED_SCOPE_REVIEW
GAPS ASSIGNED: 18 - R02-B1-004, R02-B1-006, R02-B1-010, R02-B1-011, R02-B1-012, R02-B2-006, R02-B2-X01, R02-B3-003, R02-B3-006, R02-B3-014, R02-B4-002, R02-B4-005, R02-B5-005, R02-B5-006, R02-B5-011, R02-B6-006, R02-B6-X01, R02-SCHEMA-001
GAPS CLOSED: 0 - NONE
FILES CHANGED BY R03: 1 (report only)
R03 DIFF CHURN: +243 / -0 (report only)
MIGRATION ADDED: NONE
FOCUSED TESTS: PARTIAL
FROZEN B7 CHANGED: NO
UNRELATED FILES CHANGED: NO
R04 AUTHORIZED: NO
STAGE 6 MAY RESUME: NO
STAGE 7 MAY RESUME: NO
```
