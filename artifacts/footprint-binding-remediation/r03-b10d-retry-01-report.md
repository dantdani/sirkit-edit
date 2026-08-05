# R03-B10D Retry 01 — Durable Editor and Queue Integration Report

## 1. Verdict

`BLOCKED_SCOPE`

Retry 01 cannot safely complete inside the exact authorized paths. The completed B06 durable-workflow contract requires tenant/project/branch on every aggregate read and dispatches effects by exact `eventType@eventVersion`. The forbidden file `app/lib/assignment-queue/revalidation.ts` still performs an unscoped `getItem(payload.itemId)` and registers handler key `assignment.revalidation-requested` without a version.

Repairing only the authorized repository would require an unsafe unscoped overload, a non-durable in-memory scope registry, a global cross-tenant lookup, or changing the semantic meaning of `itemId`. Each option violates the prompt. No product or test file was modified.

## 2. Repository identity and fingerprints

| Item | Evidence |
|---|---|
| Working repository | `C:\Users\robsa\Documents\Codex\2026-07-13\do\work\sirkit-edit` |
| Protected original | `C:\Users\robsa\sirkit`; not modified |
| Branch | `codex/cd-13-full-flow-orchestrator` |
| HEAD | `2bd1603a775bd4b409b89710cd4e5f8d70201632` |
| Starting all-path status count | `1,274` |
| Starting fingerprint | `9604c5f93c5c12fdc6746726496e2024cea4aa17d036cb25007179097fc49a5c` |
| Ending all-path status count | `1,275` (the one authorized report) |
| Ending fingerprint | `e9e9950efafb578e55fd6059229de56d237f466bbdbe3b3675cdb0a89bece3a5` |

The tree was already substantially dirty/untracked. No reset, clean, stash, stage, commit, push, rebase, formatting pass, dependency change, schema action, migration action, database mutation, or server launch was performed.

### Authorized-path baseline

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

## 3. U01 prerequisite verification

`artifacts/footprint-binding-remediation/r03-b10d-u01-report.md` exists and records `COMPLETE`. It explicitly authorizes R03-B10D Retry 01 to consume:

- `publish_demo_snapshot` with validated canonical publication, digest binding, idempotency, and CAS;
- scoped authoritative board GET with `found`, `not_found`, and `not_modified`;
- existing durable preflight and guarded apply;
- the repaired B08 test narrowing.

U01 paths were not modified or reopened.

## 4. Authentication boundary

Authentication remains `DEFERRED_BY_USER`. `R02-B1-011` remains open. Existing `x-sirkit-*` values are demo context transport, not trusted production identity. No auth package, middleware, user/membership table, login UI, or production-security claim was added.

## 5. Assignment compatibility analysis

### B1 decision evidence

The current request/plan does not pin `decisionEvidenceRefs`. `AssignmentQueueService.execute()` constructs a `PhysicalBindingTransitionRequest` without it, so completed B1 correctly rejects select/approve with `PB_DECISION_EVIDENCE_REQUIRED`.

This repair is feasible within the authorized `types.ts`, `service.ts`, and tests: add exact evidence to request and immutable plan/operation, include it in decision/plan digests, validate it before mutation, and pass it unchanged to B1. It was not partially implemented because the B6 blocker prevents a complete releasable queue flow.

### B5 revision-complete exception authority

The current `policyException` is only a `Pick<PassiveComponentException>` and omits the complete authority required by B5. The existing authoritative type is `PassivePolicyExceptionApproveMutationRequest`, whose `exception` can carry `RevisionCompletePassiveComponentException` authority: exact component/variant facts, context dependencies, policy record/revision/digest, assembly profile, package/footprint/mapping revisions and digests, decision evidence, actor/time, idempotency, and expected owner revision.

This repair is also feasible in the authorized queue types/service/tests by pinning the complete approve mutation in the plan digest, checking it against the queue item/scope/owner, and forwarding it unchanged. No parallel exception model is needed.

### B6 scoped durable repository — blocking issue

The repository currently uses obsolete calls such as:

```text
workflow.loadHead(aggregateType, aggregateKey)
workflow.getReplay(scopeKey, idempotencyKey)
outbox: { topic, payload }
```

The completed B06 interface requires:

```text
loadHead(durableAggregateIdentity(scope, aggregateType, aggregateKey))
getReplay(scope, scopeKey, idempotencyKey)
outbox: { owner, eventType, eventVersion, topic, payload }
```

The authorized repository can be repaired for reconcile, plans, decisions, replay, commits, and owner-bound effects. However, its safe `getItem` method must then require exact tenant/project/branch. The production revalidation coordinator currently contains:

```ts
const item = await this.options.queueRepository.getItem(payload.itemId);
```

`AssignmentRevalidationPayload` contains only `itemId`, `decisionId`, and `sourceSnapshotId`. The opaque hashed item ID does not encode recoverable scope. After process restart the repository cannot safely infer tenant/project/branch.

The same forbidden file registers:

```ts
new Map([["assignment.revalidation-requested", handler]])
```

but `DurableOutboxDispatcher` resolves only `durableEventContractKey(event.eventType, event.eventVersion)`, for example `assignment.revalidation-requested@2`. Therefore any correctly versioned B06 assignment effect would terminate with `DW_EFFECT_HANDLER_MISSING` unless the forbidden revalidation file changes.

## 6. TypeScript inventory

Full TypeScript was run to actual completion before any edit. It returned exactly the expected 14 diagnostics:

- one obsolete `applicability: "fitted"` fixture;
- obsolete unscoped durable-workflow method arities in `assignment-queue/repository.ts`;
- assignment outbox effects missing `owner`, `eventType`, and `eventVersion`.

After diagnosis the inventory remains unchanged because no product/test file was modified. The B08 `toPolicyRevisionId` diagnostic remains fixed.

## 7. Editor sync call graph

### Current behavior

```text
PcbEditor initialization
  -> loadCurrentBoard()
  -> localStorage current project
  -> SavedProject.pcb becomes current board

Sync click / empty-state CTA
  -> ensurePartLoaded()
  -> syncFromSchematic(schematic, local board)
  -> local footprint/net conversion and local PCB mutation
  -> history.execute() or dispatch(set-board)
  -> setLastSyncHash()
  -> debounced saveCurrentBoard()
  -> SavedProject.pcb remains authority
```

`PcbEditor` still imports and calls `syncFromSchematic`. Every non-demo board change is persisted after 750 ms, and unmount flushes it. `board-persistence.ts` describes the saved project `pcb` field as the board and creates a local project on first save.

### Required behavior

The required publish -> durable preflight -> plan-ready -> separate explicit apply -> authoritative GET -> verified adoption graph was not partially installed. Local authority was not removed because leaving the editor midway between two authority models would be unsafe.

## 8. PCB client and stable identity

`app/lib/pcb-sync/client.ts` remains absent. No client success was faked. The existing local scope helper can supply a stable project ID once a current project exists, but Retry 01 did not create design/board/variant identity policy or issue network calls after the queue stop condition was reached.

## 9. Schematic publication boundary

`netlist-bridge.ts` currently provides deterministic `buildNetlist`, `netlistHash`, and the legacy board-mutating `syncFromSchematic`. It has not yet been extended with the non-mutating U01 publication graph conversion. Duplicate reference/pin/net and connected-pin completeness requirements therefore remain pending Retry 01.

## 10. Preflight/apply/reload state machine

Not implemented. The editor still has a single local `syncing` path rather than distinct publishing, preflighting, plan-ready, applying, reloading, blocked, and stale states. No auto-apply was introduced.

## 11. Local cache/import authority

Not changed. `loadCurrentBoard()` still returns local saved PCB content as current authority, and `saveCurrentBoard()` still writes editor state to `SavedProject.pcb`. The required server revision/digest-bound cache and explicit legacy-import classification remain pending.

## 12. Blocker/no-mutation behavior

No product state was mutated during this attempt. No queue owner, board, project record, local cache, server snapshot, outbox event, or database row was created. Consequently no blocked response was misrepresented as success and no local PCB authority was reintroduced.

## 13. Qualification results

| Gate | Baseline result |
|---|---|
| Full TypeScript | `14` expected assignment diagnostics, exit `1` |
| Three assignment tests | `5 passed / 13 total`; `8` fail with `DW_TENANT_ID_INVALID` |
| U01 report verification | `COMPLETE`; Retry 01 authorized |
| PCB authority tests | not run; files do not yet exist |
| Focused lint | not run; no product/test edits |
| Real PostgreSQL smoke | not run; static scope blocker precedes safe composition |

## 14. Isolated database evidence

No disposable PostgreSQL resource was created. Running a repository-only smoke while the production revalidation consumer cannot receive a correctly scoped/versioned event would not prove the required queue/editor integration and could not satisfy `COMPLETE_DEMO`.

## 15. Ready-flow identities

Not available. Snapshot, plan, board, and reload identities were not generated in Retry 01. U01's prior server-only identities remain historical prerequisite evidence, not a claim for this client/editor retry.

## 16. Blocked and stale/conflict smoke

Not run through a Retry 01 client/editor because the client and authority state machine were intentionally not partially created after the stop condition. U01's prior server-only no-mutation proofs remain intact.

## 17. Exact files and churn

Product/test files changed: `0`.

Product/test churn: `+0 / -0`.

The only created file is this separately authorized report:

- `artifacts/footprint-binding-remediation/r03-b10d-retry-01-report.md`

## 18. Forbidden paths and cleanup

No forbidden file changed. In particular, `app/lib/assignment-queue/revalidation.ts`, assignment API routes, PCB-sync API/domain/U01 files, toolbar/panel files, auth, schema, migrations, router, placement, autorouter, DRC, Gerber, AI editor, component search, Stage 6, and Stage 7 files are untouched.

No container, database, environment override, generated artifact, background process, or temporary file requires cleanup.

## 19. Smallest safe successor and authorization

The smallest safe successor adds exactly one production path to the Retry 01 authorization:

- `app/lib/assignment-queue/revalidation.ts`

That successor must:

1. add tenant/project/branch to `AssignmentRevalidationPayload`;
2. emit a deliberately versioned owner-bound event, recommended `assignment.revalidation-requested@2`;
3. verify payload scope equals `DurableOutboxEvent.scope`;
4. call scoped repository reads with `{ tenantId, projectId, branchId }` plus `itemId`;
5. register the handler with `durableEventContractKey("assignment.revalidation-requested", 2)`;
6. preserve or explicitly reject any legacy event rather than silently reinterpreting it;
7. qualify dispatch after repository/service recreation.

No schema or migration expansion is needed. After that one-file scope authorization, the existing Retry 01 path list is sufficient for B1/B5/B6, client/editor/cache work, and the real PostgreSQL smoke.

`R04D` is not authorized. Production R04, Stage 6 demo resumption, and Stage 7 remain unauthorized.
