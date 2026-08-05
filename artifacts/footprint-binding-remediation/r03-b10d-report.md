# R03-B10D Demo Completion Report

## 1. Verdict

`BLOCKED_CONTRACT`

R03-B10D cannot safely produce the required real editor demo within the exact authorized paths. The durable PCB API supports preflight and guarded apply, but it exposes neither an authoritative board-load operation nor a trusted live-schematic snapshot publication/coordinator path. The editor therefore cannot load the committed board after apply or prove authoritative reload, and its current in-browser schematic has no matching durable snapshot/revision on the server.

No product or test file was modified. This report is the only B10D-created file.

## 2. Repository identity and safety baseline

| Item | Evidence |
|---|---|
| Working repository | `C:\Users\robsa\Documents\Codex\2026-07-13\do\work\sirkit-edit` |
| Protected original | `C:\Users\robsa\sirkit` was not the working target and was not modified |
| Branch | `codex/cd-13-full-flow-orchestrator` |
| HEAD | `2bd1603a775bd4b409b89710cd4e5f8d70201632` |
| Starting status-path count | 1,272 |
| Starting fingerprint | `32a2ead6f5209c21d74fd9bfeb10224c5586f2aaf7268d0fd9397bd0142a223e` |
| Ending status-path count | 1,273 |
| Ending fingerprint | `c8d23edd60b44a51b3fc6fcf3307688bf116d45e12b53f9d82e22f1e29c99cfb` |

The tree was already substantially dirty/untracked. All eleven authorized paths were hashed before diagnosis. No reset, clean, stash, stage, commit, push, rebase, formatting pass, migration, schema command, dependency operation, or database mutation was performed.

### Authorized-file baseline ledger

| Path | Lines | SHA-256 |
|---|---:|---|
| `app/lib/assignment-queue/types.ts` | 144 | `19199c4208cad5c0579faa7f8e00cb223d07e6107f82b091a2dc94accbd08da2` |
| `app/lib/assignment-queue/service.ts` | 54 | `bb0f7fb2513d1560626a91a8907d85b30968a6d28ebeca6408cab9e5f2d57f3f` |
| `app/lib/assignment-queue/repository.ts` | 48 | `9eaaf67c7d0dffb5838bd9ca6e1b57176ec454cad053026cb0ae9cc5c67a21cc` |
| `app/lib/assignment-queue/__tests__/service.test.ts` | 56 | `46b91a92485b0e724ac727266d544cb916181e88950543d41d7f49befdf75fa8` |
| `app/lib/assignment-queue/__tests__/revalidation.test.ts` | 47 | `aa9df59fab017798fa582f2a9da894c3d138fbc0152272bcd57f74ee6e74f3e4` |
| `app/lib/assignment-queue/__tests__/materializer-repository.test.ts` | 52 | `8bc36df7d3cb9b62da58208eceda214d4358b7c30b03ba11dcb86a059371ea7c` |
| `app/components/pcb/PcbEditor.tsx` | 1,338 | `d3781cf4061b7872f239e0bb8767110d5b1c0fd171f3c3008b881db1e29c654b` |
| `app/lib/pcb/board-persistence.ts` | 120 | `03ace729aac3422712e2247f458e56bc37a992fea043c3e4cd59dcaa21395e40` |
| `app/lib/pcb/netlist-bridge.ts` | 899 | `459ea5a0e4f33ee85c0fe07765d14b571693a2f28ade907eecaaae9d1af04f19` |
| `app/lib/pcb-sync/client.ts` | absent | `MISSING` |
| `app/components/pcb/__tests__/pcb-sync-authority.test.tsx` | absent | `MISSING` |

## 3. Authentication decision

Authentication is `DEFERRED_BY_USER` for the single-workspace YC demo. R03-B10D did not implement or modify Supabase Auth, Clerk, Auth.js, middleware, membership/user tables, or any trusted identity provider.

`R02-B1-011` remains open. The current `x-sirkit-*` header transport in `app/api/pcb-sync/_scope.ts` is caller-provided demo context, not trusted production identity. Production deployment remains blocked on a trusted request-context and project-membership provider.

## 4. B08 TypeScript discrepancy

The B08 zero-diagnostic claim is **not reproducible**.

The first short-yield TypeScript invocations returned no text while the compiler was still running. The command was then rerun and polled to actual process completion for approximately 69 seconds:

```text
cmd /d /s /c "pnpm exec tsc --noEmit --pretty false && echo TSC_PASS"
exit code: 1
diagnostics: 15
```

Fourteen diagnostics are the same frozen B7 compatibility failures reported by B06/B07:

- one obsolete assignment fixture uses `applicability: "fitted"`;
- assignment repository calls use the pre-B06 unscoped durable-workflow signatures;
- assignment outbox effects omit B06 `owner`, `eventType`, and `eventVersion`.

The fifteenth diagnostic is newer and outside B10D's authorized paths:

```text
app/lib/durable-workflow/__tests__/stage3-stage5-owners.test.ts(143,67)
TS2339: Property 'toPolicyRevisionId' does not exist on type
       '{ affectedComponentIds: string[]; }'.
```

That line was introduced in B08's authorized test changes. B08 did not modify B7 files, so it could not have repaired the fourteen B7 diagnostics. The clean B08 conclusion resulted from treating an unfinished, silent compiler process as success rather than from a safe compatibility repair or a changed TypeScript configuration.

No unsafe unscoped overload exists in the current durable-workflow interface. The queue repository is simply stale against the completed B06 signature.

## 5. Assignment-queue B1/B5/B6 compatibility diagnosis

These repairs are all feasible inside the B10D assignment paths, but were not implemented after the blocking PCB contract was proven.

### B1 evidence gap

`AssignmentCandidateReference` contains general `evidenceRefs`, but the decision request/plan does not pin the exact B1 decision evidence chosen at preview. `AssignmentQueueService.execute()` constructs `PhysicalBindingTransitionRequest` without `decisionEvidenceRefs`. Select/approve therefore cannot satisfy B1, and changed evidence cannot participate in the plan/input digest.

Required repair: add an exact decision-evidence field to the request and immutable plan/operation contract, include it in `decisionInputDigest`, validate it during preview, forward it unchanged during apply, and prove same-key changed evidence conflicts. Generic evidence must not be synthesized at execute time.

### B5 revision-complete exception gap

`policyException` is only a `Pick` of exception ID/action/profile/variants/reason/evidence. It omits the B04/B05 revision-complete selection and authority snapshot: component/variant facts, policy record/revision/digest, context dependency, assembly profile, package/footprint/mapping identities and revisions, approval/mutation evidence, and exact actor/time inputs.

`AssignmentQueueService.execute()` currently creates a legacy incomplete `PassiveComponentException`; the completed passive-policy service correctly rejects this with `PP_EXCEPTION_AUTHORITY_INCOMPLETE`.

Required repair: pin the complete B04 input in preview, digest it, revalidate it before mutation, and pass it unchanged. Missing/stale authority must fail rather than downgrade to generic policy behavior.

### B6 scoped repository gap

`DurableAssignmentQueueRepository` passes `(aggregateType, aggregateKey)` to `loadHead` instead of a scoped aggregate identity, passes a scope key where a durable scope object is required, and emits unowned/unversioned outbox records. These calls produce the documented TypeScript failures and runtime `DW_TENANT_ID_INVALID` errors.

Required repair: use `durableAggregateIdentity(scope, type, key)` for every head/history read, pass full tenant/project/branch to replay and commit operations, bind every effect to an owner aggregate committed in the same transaction, and assign semantic event type/version. No unscoped overload is acceptable.

## 6. Current assignment test evidence

Command:

```text
pnpm vitest run \
  app/lib/assignment-queue/__tests__/service.test.ts \
  app/lib/assignment-queue/__tests__/revalidation.test.ts \
  app/lib/assignment-queue/__tests__/materializer-repository.test.ts
```

Result: exit 1; 5 passed, 8 failed across 13 tests. Every failure reaches the obsolete B6 repository call and stops with `DW_TENANT_ID_INVALID`. This is baseline evidence, not a B10D regression.

## 7. Before/required editor sync call graph

### Current live behavior

```text
User clicks “Schematic → PCB” or Sync
  -> PcbEditor.handleSync()
  -> buildNetlist(browser SchematicState)
  -> syncFromSchematic(browser schematic, browser/local board)
  -> browser footprint API heuristics and local board mutation
  -> dispatch/set-board or history mutation
  -> debounced saveCurrentBoard()
  -> localStorage SavedProject.pcb becomes current authority
```

`PcbEditor.tsx` imports and invokes `syncFromSchematic` directly at lines 31 and 353. The empty-state button calls `handleSync` directly, so it performs local mutation in one user action; it is not a durable preflight followed by a separate explicit apply.

### Required but currently impossible graph

```text
Authoritative schematic revision + explicit demo scope
  -> trusted server coordinator publishes/acquires matching PCB-sync snapshot
  -> durable client loads authoritative board record
  -> durable preflight shows real plan/blockers
  -> explicit Apply with exact plan and revision guards
  -> durable commit
  -> authoritative board-load returns committed content/revision/digest
  -> editor replaces view; local storage receives matching cache only
  -> reload loads server board and optionally validates cache equivalence
```

The missing server operations are not implementable in the authorized client/editor/local-persistence files.

## 8. Proven PCB contract blocker

### Existing API capabilities

`app/api/pcb-sync/handler.ts` supports only POST operations:

- `preflight`
- `apply`

The GET route returns feature capabilities and version metadata only. It does not return a board record.

`PcbSyncApplyResult` contains committed revision and digest, but not `PcbSyncBoardRecord.board`. The durable repository has `getBoard()`, yet no API exposes it to the editor. `app/api/pcb-sync/_scope.ts` also rejects client-uploaded board contents, correctly preventing the client from substituting local state as authority.

Therefore an authorized `client.ts` could learn that a revision committed, but it could not retrieve the committed board content required by the prompt. Reconstructing the board locally with `syncFromSchematic` would create competing authority and violate the acceptance criteria.

### Missing trusted schematic snapshot publication

`PcbEditor` receives only `SchematicState`, whose type has components/wires and no design ID, server schematic revision, assembly variant revision, or durable snapshot identity. The current project pointer is local browser storage.

The production API's `DurablePcbSyncSnapshotStore` is instantiated but no live production coordinator publishes a snapshot. Repository search found publication only in tests. The API deliberately has no arbitrary snapshot-upload operation.

Consequently a real editor preflight would normally fail `PS_SNAPSHOT_NOT_FOUND` or revision/scope validation. Supplying a fabricated revision or uploading a client-authored snapshot through the new client would violate the prompt.

## 9. Server-versus-local authority status

Current `board-persistence.ts` explicitly treats `SavedProject.pcb` in localStorage as the current board. On editor initialization, `loadCurrentBoard()` supplies the working board. Every editor board change is debounced back through `saveCurrentBoard()`. There is no server revision bound to the local record, so it cannot be validated as a matching cache.

The required demotion is conceptually safe—local records need scope, authoritative server revision/digest, cache status, and an explicit legacy-import path—but it cannot be completed until a server board-load contract exists. Demoting local authority now would leave the editor unable to load any non-demo board.

## 10. Preflight/apply state model and blockers

The existing B3 domain already represents `ready_to_apply`, `ready_no_changes`, blocked statuses, stale plans, revision conflicts, resolver blockers, and guarded apply. The API also requires `x-sirkit-pcb-sync-opt-in: true` for apply.

What is missing is the editor/client integration state machine:

- no `pcb-sync/client.ts` exists;
- no editor-side durable preflight result exists;
- no explicit durable plan-ready versus board-applied state exists;
- no authoritative board reload is possible;
- no test file exists for editor authority.

Footprint and mapping blockers in B3 are truthful, but the editor never receives them because it calls the legacy local bridge. Implementing a client that hard-codes success or translates blocked results into an empty board was rejected.

## 11. Explicit apply and idempotency status

The server apply contract already requires plan ID/digest, lifecycle `applicable`, confirmation `apply_exact_plan`, idempotency key, human authorization, plan revalidation, and atomic expected-board-revision commit. It safely distinguishes idempotent replay and stale/conflict outcomes.

The current editor does not use this contract. Its sync button immediately mutates local board state after local conversion. B10D therefore cannot claim explicit durable apply, duplicate-click protection at the server boundary, or stale-plan no-mutation behavior in the UI.

## 12. Real integration smoke

Not run. No disposable PostgreSQL/Supabase resource was created because the static contract trace proved that the same client used by the editor could not:

1. publish/acquire a matching live schematic snapshot;
2. load current authoritative board contents;
3. reload committed board contents after apply.

Running a repository-only smoke test would prove the already-qualified B3 service, not the required editor/client/API integration, and would not satisfy `COMPLETE_DEMO`.

Committed board revision/digest before/after reload: **not available**.

Ready flow commit/reload: **not run**.

Blocked flow no-mutation: **not run through the editor client**.

Stale/conflict no-mutation: **not run through the editor client**.

## 13. Exact unblock scope

The smallest responsible successor must explicitly authorize and define:

1. a scoped read operation that exposes `PcbSyncBoardRecord` from the durable repository, likely in `app/api/pcb-sync/route.ts` with API tests;
2. a trusted demo schematic coordinator that derives and publishes the B3 snapshot from a server-authoritative schematic revision—never an arbitrary client snapshot upload;
3. the authoritative identifiers/revision supplied to `PcbEditor` or its surrounding project context;
4. one out-of-scope B08 TypeScript test fix in `app/lib/durable-workflow/__tests__/stage3-stage5-owners.test.ts`;
5. authorization to test the new API/coordinator boundary.

After those contracts exist, the eleven B10D paths can safely implement the queue repairs, durable client, explicit editor apply, server-priority cache, and component authority tests.

## 14. Qualification summary

| Check | Result |
|---|---|
| Full TypeScript, polled to completion | FAIL; 15 diagnostics |
| B08 discrepancy | EXPLAINED |
| Assignment focused tests | 5 passed / 13 total; 8 baseline B6 failures |
| PCB authority test | Not run; authorized file absent |
| Real demo smoke | Not run; blocked contract |
| Focused lint | Not run; no product/test changes |
| Migration/schema qualification | Not applicable; unchanged |

## 15. B10D-local file and churn inventory

| File | Added | Deleted |
|---|---:|---:|
| Product/test files | 0 | 0 |
| `artifacts/footprint-binding-remediation/r03-b10d-report.md` | report only | 0 |

Product/test files changed: 0.

Product/test churn: `+0 / -0`.

No forbidden file, auth file, schema, migration, dependency, lockfile, generated artifact, or unrelated product/test file changed.

## 16. Remaining production blockers

- `R02-B1-011`: trusted human identity and membership authorization remains open and explicitly deferred.
- Durable board load is not exposed to the editor.
- Trusted live schematic snapshot publication is absent.
- Editor project/design/board/schematic revision context is browser-local and incomplete.
- B1/B5/B6 assignment compatibility remains unimplemented.
- Full TypeScript has the fourteen B7 diagnostics plus one out-of-scope B08 test diagnostic.
- Local browser board state remains authoritative in the current editor.
- No real editor-client integration smoke can be run until the server contract is expanded.

## 17. Authorization decision

R04D demo qualification is **not authorized** because B10D is not complete.

Production R04 is not authorized. Stage 6 demo may not resume. Stage 7 remains unauthorized.
