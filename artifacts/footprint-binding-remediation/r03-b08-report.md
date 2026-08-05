# R03-B08 Projection and Invalidation Convergence Report

## 1. Verdict

`COMPLETE`

- Assigned gap: `R02-B4-005`
- Gaps closed: 1
- Migrations: none
- Schema changes: none
- R03-B09 authorization: **YES**
- R03-B10, R04, Stage 6, and Stage 7 authorization: **NO**

## 2. Repository safety and baseline

| Item | Evidence |
|---|---|
| Working repository | `C:\Users\robsa\Documents\Codex\2026-07-13\do\work\sirkit-edit` |
| Protected original | `C:\Users\robsa\sirkit` was not the working target and was not modified |
| Branch | `codex/cd-13-full-flow-orchestrator` |
| HEAD | `2bd1603a775bd4b409b89710cd4e5f8d70201632` |
| Starting status-path count | 1,271 |
| Starting status fingerprint | `983cf5cfebfcdef3100ba27e12983265a93f3434c156045dc014c4c3905bda59` |
| Ending status-path count | 1,272 |
| Ending status fingerprint | `32a2ead6f5209c21d74fd9bfeb10224c5586f2aaf7268d0fd9397bd0142a223e` |

The tree was already substantially dirty. B08 used the captured per-authorized-file SHA-256 ledger to distinguish this batch from pre-existing work. No reset, clean, stash, reformat, stage, commit, rebase, or push was performed. No repository-local `AGENTS.md` was present.

## 3. Scope and exclusions

B08 closes only `R02-B4-005`: durable convergence of B4 mapping projection and mapping/passive invalidation. It does not change assignment-queue code, B7 code, APIs/authentication, Drizzle/schema/migrations, PCB editor/router code, component search, the AI editor, dependencies, lockfiles, generated files, or any B01-B07 report.

Twelve authorized product/test files changed. The authorized mapping invalidation adapter was audited but did not require a content change. The only created file is this report.

## 4. Prerequisite verification

The following authoritative reports were located under `artifacts/footprint-binding-remediation/` and verified before production edits:

| Prerequisite | Report | Verdict used by B08 |
|---|---|---|
| R03-B03 durable mapping result authority | `r03-b03-report.md` | `COMPLETE` |
| R03-B04 passive exception lifecycle | `r03-b04-report.md` | `COMPLETE` |
| R03-B05 production policy composition | `r03-b05-report.md` | `COMPLETE` |
| R03-B06 owner-bound/versioned outbox | `r03-b06-retry-01-report.md` | `COMPLETE` |
| R03-B07 relational integrity | `r03-b07-report.md` | `COMPLETE`; B08 authorized |

The historical `r03-b06-report.md` blocked result was not treated as current; Retry 01 is authoritative.

## 5. Baseline defect proof

The pre-edit focused baseline passed 21/21 tests, but one test encoded the defect by expecting B4 mapping projection to make B1 layout-ready. The assertion was first changed to the required authority boundary before production edits. It failed as expected:

```text
expected 'approved' to be 'unreviewed'
app/lib/mapping-verification/__tests__/lifecycle-invalidation.test.ts
6 passed, 1 failed
```

Inspection established the other defects:

1. `successorBinding()` copied an accepted B4 mapping decision into B1 `approval.state = "approved"` and synthesized valid B1 technical validation.
2. Mapping projection and invalidation were two same-time `@1` events with no durable prerequisite; topic selection could claim invalidation independently.
3. Both mapping and passive handlers discarded the invalidation adapter's outcome.
4. Outbox-mode owner results wrote `stage3PlansStaled: 0` before invalidation ran.
5. No durable owner-revision readiness read distinguished pending, retryable, terminal, and completed effects.
6. A successful side effect followed by lost acknowledgement had no durable domain receipt proving the already-completed work and its count.

## 6. Final owner/effect state model

Owner commit and downstream readiness are now separate facts:

- Owner commit means the immutable owner successor and its B06 effects were accepted atomically.
- `MappingVerificationService.convergence()` and `PassivePolicyService.convergence()` read exact owner-revision state from durable owner, outbox, and effect-receipt truth.
- `pending` means a required event is unclaimed/processing or its prerequisite is legitimately incomplete.
- `retryable_failed` means B06 retains a bounded error and retry eligibility.
- `terminal_failed` means the event failed terminally, a required contract/receipt is absent or unsupported, or projection terminally blocks its dependent invalidation.
- `completed` requires the exact B06 event to be completed and its exact event/owner-bound receipt to exist. A receipt alone cannot make readiness complete.
- Passive owner revisions with no affected components have an explicit `not_required` invalidation and converge with count zero.
- Every non-completed state is not ready.

The receipt is not a second decision owner or a second queue. It is an immutable result record in the existing generic durable-workflow store, keyed by the B06 `eventId` and bound to the event digest, scope, owner aggregate type/key/revision, and semantic type/version. No new table, column, index, queue, singleton, or process-local completion map was added.

## 7. Event contracts

| Owner | Event contract | Ordering payload | Prerequisite | Handler and failure behavior | Reconciliation |
|---|---|---|---|---|---|
| `mapping-verification.record.v1` / deterministic mapping-scope key / exact record revision | `mapping.stage1-project@1` | Immutable mapping record, actor, owner idempotency key | None | Verifies B06 digest and exact stored owner payload; projector errors remain retryable until B06 exhaustion, then terminal | Projection receipt stores the exact Stage 1 reference |
| Same exact mapping owner | `mapping.invalidate@2` | Exact mapping scope, owner revision ID/number, certificate transition, reason/time, `{eventType: mapping.stage1-project, eventVersion: 1}` | Same-scope/type/key/revision `mapping.stage1-project@1` must be B06-completed and receipted | Unique per-owner topic prevents blocked events from being bulk-claimed; mismatched owner/payload fails closed | Receipt stores sorted dependency keys and authoritative distinct stale-plan count |
| `passive-policy.record.v1` / deterministic policy key / exact record revision | `passive-policy.invalidate@1` | Exact project/branch, variants, components, policy revision transition, reason/time | None; independent from mapping projection | Verifies B06 digest and payload against the exact stored owner revision | Receipt stores sorted dependency keys and authoritative distinct stale-plan count |

Mapping invalidation moved to semantic version 2 because adding a prerequisite and owner-revision fields changes payload meaning. Historical `mapping.invalidate@1` is not reinterpreted. Convergence classifies it unsupported/not-ready, and the B08 runtime selects only valid ready `@2` per-owner topics.

## 8. B4 mapping verification remains distinct from B1 approval

The projector may project a verified mapping reference, but every new physical-binding successor is now:

```text
approval.state = unreviewed
technicalValidation.state = pending
technicalValidation.reasonCodes = [MV_MAPPING_APPROVAL_REQUIRED]
```

It no longer copies the B4 actor, reason, decision ID, approval state, or validation into B1 authority. The projected B1 audit now includes B07's required aggregate-set owner and canonical request digest. Same-revision duplicate projection proves mapping-content equivalence; conflicting content, stale mapping revisions, stale binding lineage, dependency mismatch, variant mismatch, and cross-scope input fail closed.

The regression test then performs a separate B1 revalidation and B1 approval using the normal `PhysicalBindingService`, a distinct idempotency key, and `decisionEvidenceRefs: ["evidence-datasheet"]`. Layout becomes ready only after that operation.

## 9. Durable ordering and restart behavior

Each mapping invalidation v2 topic is unique to its owner revision. The runtime:

1. dispatches requested mapping projection events first;
2. reloads durable outbox state;
3. selects a mapping invalidation topic only when the exact same owner scope/type/key/revision projection is completed and receipted;
4. dispatches independent passive invalidation without waiting on unrelated mapping owners.

Pending prerequisites are never claimed by the normal runtime, so they do not gain attempts or enter a busy retry loop. A terminal projection leaves its dependent invalidation physically pending with zero attempts, while the owner convergence read exposes the dependency as `terminal_failed / MV_PROJECTION_TERMINAL_BLOCK`.

Because eligibility is recalculated from the repository, runtime/service recreation observes the same ordering and state. One owner's receipt cannot satisfy another owner or revision.

## 10. Duplicate delivery, acknowledgement loss, and exact counts

Handlers verify the B06 digest and exact stored owner before consulting the receipt. For the same event:

- a completed receipt makes duplicate handler delivery a no-op;
- projection idempotency prevents a second B1 successor;
- plan invalidation only transitions previously active applicable plans to stale;
- acknowledgement loss leaves the event retryable but preserves its receipt and exact outcome;
- redelivery reads the receipt, does not rerun the target, and completes the B06 acknowledgement;
- changed payload under the same logical identity remains protected by B06 payload/event digests.

`stage3PlansStaled` means the number of distinct, previously active applicable PCB preflight plans durably transitioned to stale by the logical invalidation. The first adapter result is reconciled with exact `pcb-sync.plan-staled` durable child events using the logical mapping certificate or passive-policy revision prefix. This also preserves the original count if a process stops after PCB transitions but before writing the effect receipt. Component IDs, variant IDs, dependency keys, and explicitly supplied board scopes are deduplicated.

Outbox owner records now expose `stage3PlansStaled: null` while work is pending instead of a false zero. The stable number is available only in convergence outcome. A genuinely effect-free passive owner revision uses zero with `not_required`.

## 11. Invalidation scope

Mapping invalidation is limited to the exact tenant/project/branch/board/component/variant and old/new certificate transition stored in the owner event. Passive invalidation is limited to the exact tenant/project/branch, distinct affected components, variant set, and from/to policy revisions. The durable passive adapter delegates project-wide board enumeration to the existing PCB-sync authority; the scoped adapter deduplicates explicit board scopes. Unaffected projects, branches, boards, components, and variants are not selected.

Resolver results remain content/dependency-current rather than being mutated in a parallel cache table. New mapping/policy revision digests and Stage 2 dependency keys make older resolver authority non-current; Stage 3 plans are durably transitioned through the existing PCB-sync repository.

## 12. Failure matrix

| Projection | Invalidation | Owner convergence | Runtime action |
|---|---|---|---|
| Pending | Pending, attempts 0 | Pending | Dependent topic is not claimed |
| Retryable failed | Pending, attempts 0 | Retryable failed | Retry projection only |
| Terminal failed | Derived terminal block; event remains unclaimed | Terminal failed | Never run dependent invalidation |
| Completed | Pending | Pending | Invalidation becomes eligible |
| Completed | Retryable failed | Retryable failed | Retry exact invalidation event |
| Completed | Terminal failed | Terminal failed | Keep visible and not ready |
| Completed | Completed with receipt/outcome | Completed | Ready/converged |
| Completed without receipt | Corrupt/missing completion evidence | Terminal failed | Fail closed |

## 13. Qualification evidence

| Command / check | Result |
|---|---|
| Pre-edit focused baseline | Exit 0; 21/21 tests passed |
| Authority defect proof after assertion change, before production repair | Expected exit 1; 6/7 passed; received B1 `approved` instead of `unreviewed` |
| Three authorized focused test files | Exit 0; 23/23 passed |
| Final durable owner convergence file | Exit 0; 5/5 passed |
| Final passive lifecycle/invalidation file | Exit 0; 11/11 passed |
| Complete mapping-verification plus durable-workflow suites, isolated | Exit 0; 43/43 passed, 2 PostgreSQL-only tests skipped |
| Passive performance property rerun in isolation | Exit 0; 3/3 passed; 1,000-component preview 3.229 s |
| TypeScript: `pnpm exec tsc --noEmit --pretty false` | Exit 0; no diagnostics |
| Focused ESLint for all changed product/test files | Exit 0; no diagnostics |
| PCB-sync + footprint-resolver breadth | Exit 1; 85 passed, 25 failed; every failure is the pre-existing frozen `PB_DECISION_EVIDENCE_REQUIRED` fixture debt |
| Passive Stage 2 integration breadth | One unchanged `PB_DECISION_EVIDENCE_REQUIRED` fixture failure; two tests passed |

The parallel mapping/passive/durable diagnostic also produced one passive performance timing failure under suite contention (6.871 s against 5 s). Its isolated rerun passed at 3.229 s, so it is not a B08 functional regression. Across the broad frozen fixtures, the known evidence debt remains 26 failing cases (25 PCB/resolver plus 1 passive Stage 2), all outside B08's authorized paths.

B03 durable-result tests passed, B04 revision-complete passive lifecycle tests passed, B05 variant/applicability tests passed, and affected B06 repository/outbox owner/type/version/digest/lease behavior passed.

## 14. B08-local churn

Churn was calculated against the captured pre-B08 authorized-file contents, not against Git's already-dirty/untracked baseline.

| File | Added | Deleted |
|---|---:|---:|
| `app/lib/mapping-verification/types.ts` | 15 | 2 |
| `app/lib/mapping-verification/service.ts` | 3 | 2 |
| `app/lib/mapping-verification/durable.ts` | 97 | 18 |
| `app/lib/mapping-verification/stage1-projector.ts` | 11 | 11 |
| `app/lib/passive-policy/types.ts` | 14 | 2 |
| `app/lib/passive-policy/service.ts` | 2 | 1 |
| `app/lib/passive-policy/durable.ts` | 62 | 24 |
| `app/lib/passive-policy/invalidation.ts` | 4 | 2 |
| `app/lib/durable-workflow/effects-runtime.ts` | 11 | 5 |
| `app/lib/mapping-verification/__tests__/lifecycle-invalidation.test.ts` | 22 | 2 |
| `app/lib/passive-policy/__tests__/lifecycle-preview-invalidation.test.ts` | 2 | 1 |
| `app/lib/durable-workflow/__tests__/stage3-stage5-owners.test.ts` | 65 | 9 |
| **Total** | **308** | **79** |

Product/test files changed: 12 of the maximum 13. Total product/test churn: 387 lines, below the 1,500-line limit. `app/lib/mapping-verification/invalidation.ts` retained its baseline hash and is not counted as changed.

No forbidden file, frozen B7 file, schema, migration, dependency, lockfile, or generated artifact changed in B08.

## 15. Remaining risks and R04 obligations

1. Historical mapping invalidation `@1` events are deliberately not reinterpreted as `@2`; they remain visibly not-ready and require an explicit newer owner revision or a future authorized operational reconciliation procedure.
2. Effect workers still depend on regular invocation; a durable pending/retryable state is safe but not self-executing without worker scheduling.
3. PostgreSQL-only tenant-scope tests were skipped by their existing environment gate in the isolated unit run. B06 Retry 01 and B07 already provide the authoritative PostgreSQL qualification for the unchanged storage schema.
4. R04 should exercise operational restart/worker scheduling, historical `@1` reconciliation policy, monitoring/alerting for terminal effects, and production-scale outbox backlog behavior.
5. The 26 frozen decision-evidence fixture failures remain assigned outside B08 and were not edited around.

## 16. Authorization

All B08 completion gates pass. `R02-B4-005` is closed and R03-B09 is authorized.

R03-B10, R04, Stage 6, and Stage 7 remain unauthorized by this batch.
