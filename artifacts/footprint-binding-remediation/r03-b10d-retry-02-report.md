# R03-B10D Retry 02 — Scoped Revalidation and Durable Editor Integration

## 1. Verdict and repository fingerprints

`COMPLETE_DEMO`

| Item | Evidence |
|---|---|
| Working repository | `C:\Users\robsa\Documents\Codex\2026-07-13\do\work\sirkit-edit` |
| Protected original | `C:\Users\robsa\sirkit`; not modified |
| Branch | `codex/cd-13-full-flow-orchestrator` |
| HEAD | `2bd1603a775bd4b409b89710cd4e5f8d70201632` |
| Starting all-path status | `1,275` entries |
| Starting fingerprint | `e9e9950efafb578e55fd6059229de56d237f466bbdbe3b3675cdb0a89bece3a5` |
| Pre-report all-path status | `1,277` entries; the two additional entries are the authorized new client and client/editor test |
| Post-report all-path status | `1,278` entries; the separately authorized report is the third addition |
| Post-report status fingerprint | `f6ddcdf2288d1ea794fe760cd49dda594849c660f06bc68fd94a033a8ac5b068` |

The repository was already substantially dirty/untracked. No reset, clean, stash, stage, commit, push, rebase, broad format, dependency update, schema change, or migration generation was performed. Unrelated work was preserved.

## 2. Prerequisite verification

- U01 report: `COMPLETE`.
- Retry 01 report: `BLOCKED_SCOPE`, with no Retry 01 product/test edits.
- Retry 02 reproduced the documented assignment baseline before repair: 14 TypeScript diagnostics and 5/13 assignment tests passing, with the remaining tests failing at unscoped B06 calls.
- Final full TypeScript: exit `0`, zero diagnostics.
- Final assignment suite: 14/14 passing after adding B5 and cross-scope coverage.

## 3. Authentication deferral

Authentication remains `DEFERRED_BY_USER`. `R02-B1-011` remains open. The `x-sirkit-*` headers are demo transport, not production identity. No auth provider, middleware, user/membership table, login UI, dependency, or secret was added. Durable aggregates, replays, events, handlers, PCB loads, and client requests still enforce exact tenant/project/branch scope.

## 4. Retry 01 blocker resolution

The queue repository now requires exact scope plus opaque item ID for every item read. Revalidation payloads carry tenant, project, branch, item, decision, source snapshot, expected item revision, and expected item digest. `revalidation.ts` consumes the durable envelope, verifies payload/envelope scope and owner identity before domain work, and performs only the exact scoped lookup. No cross-tenant search, default scope, unscoped overload, or process-local scope registry exists.

## 5. Versioned event, owner, and handler contract

The producer emits:

```text
eventType: assignment.revalidation-requested
eventVersion: 2
topic: assignment.revalidation-requested
ownerAggregateType: assignment-queue.decision.v1
ownerAggregateKey: <committed decision id>
ownerAggregateRevision: 1
payload: exact scope + item/decision/snapshot/revision/digest
```

The consumer registers only `assignment.revalidation-requested@2` using `durableEventContractKey`. It verifies the canonical durable event digest, exact event type/version/topic, decision owner type/key/revision, and payload scope. A payload/envelope mismatch fails with `AQ_REVALIDATION_EVENT_SCOPE_MISMATCH` before any domain call. The PostgreSQL gate recreated queue repository, service, coordinator, and dispatcher objects before successful dispatch.

## 6. Legacy event policy

No v1 or unversioned handler is registered. A historical `assignment.revalidation-requested@1` therefore fails closed through the established dispatcher outcome `DW_EFFECT_HANDLER_MISSING`; it is terminal after bounded handling and is not silently marked complete. Missing scope is never guessed from item ID.

## 7. B1, B5, and B6 compatibility

### B1

Decision evidence is required for select/approve, canonicalized, pinned into decision input/plan/operation digests, rechecked at commit, and forwarded unchanged as `decisionEvidenceRefs`. Missing evidence fails before owner mutation. Changed evidence makes the plan stale. The B1 transition also confirms every reference exists on the selected binding.

### B5

The authoritative plan stores `PassivePolicyExceptionApproveMutationRequest`, including exact scope, owner record/revision/digest, component/variant context, policy and assembly authority, selection/mapping/footprint identities where applicable, actor, reason, time, evidence, and idempotency. Service validation rejects absent, legacy-partial, stale-owner, cross-scope, cross-component, cross-variant, changed, or evidence-free authority. Execute forwards the pinned mutation unchanged. The forbidden legacy panel still constructs its historical partial UI payload; the request compatibility shape lets the old panel compile, but the service rejects that shape with `AQ_POLICY_EXCEPTION_REQUIRED` and never treats it as B5 authority. No generic fallback exists.

### B6

All heads use `durableAggregateIdentity(scope,type,key)`. Lists, replays, commits, and outbox claims are scoped. Every emitted effect has owner, type, version, topic, and digest-bound payload. Source keys now canonicalize only their six declared identity fields, preventing runtime extra fields from changing persistence identity. Identical replay is idempotent; changed plan/evidence/payload reuse conflicts. A qualification test stores the same opaque item ID in two project scopes and proves isolation.

## 8. TypeScript inventory

| State | Result |
|---|---|
| Before | 14 diagnostics: obsolete `fitted`, old durable method arities, and incomplete outbox effects |
| After | 0 diagnostics; `npx tsc --noEmit --pretty false` exit `0` |

No `any`, `@ts-ignore`, excluded file, default scope, or unsafe repository overload was added.

## 9. Editor call graph before and after

Before:

```text
PcbEditor -> loadCurrentBoard() -> local SavedProject.pcb
Sync -> syncFromSchematic() -> local board mutation/placement
board changes -> debounced saveCurrentBoard()
export -> current local editor board
```

After:

```text
PcbEditor -> PcbSyncClient.loadBoard() -> durable authoritative GET
Sync -> buildPcbSyncPublicationGraph(actual schematic)
     -> publish_demo_snapshot
     -> durable preflight
     -> show blockers or retain applicable plan (no board mutation)
Apply button -> guarded apply_exact_plan + opt-in
             -> authoritative GET
             -> verify committed revision/digest/content
             -> adopt board and cache exact record
export/fab -> last verified authoritative record only
```

`PcbEditor` contains no call to `syncFromSchematic` and no call to `saveCurrentBoard`.

## 10. Client and stable demo identity

`PcbSyncClient` is an injected-fetch client shared by editor and tests. It applies identical demo scope/actor headers for publish, preflight, apply, and GET; does not send body scope/actor overrides; sends the apply opt-in header and exact confirmation; classifies not-found, blocked, stale, conflict, retryable, and terminal failures; and validates response schemas. Board adoption additionally rebuilds the board record with `makeBoardRecord` and rejects revision/digest/content mismatch.

The editor derives stable identity from the persisted local project pointer:

```text
tenant: local
project: <persisted project id>
branch: main
design: design:<project id>
board: board:<project id>
variant: variant-default
```

Snapshot aggregate revision is cached separately and only used as the next expected publication CAS value. Publication and apply idempotency keys derive from stable source/plan identity.

## 11. Browser cache and import authority rules

- Authoritative cache keys include tenant/project/branch/board.
- Cached content is accepted only when its stored revision and digest exactly match server authority and a locally rebuilt record matches both.
- A newer/different server revision rejects the cache.
- Server `not_found` remains no committed board; no empty authority record is fabricated.
- Existing `SavedProject.pcb` is exposed only through `loadLegacyBoardImport()`.
- Ordinary editor mutations are not persisted as server authority.
- KiCad/fabrication export reads only the last verified authoritative board (demo fixtures remain intentionally local).

## 12. Test results

| Gate | Result |
|---|---|
| Assignment + editor/client final focused run | 19 passed, 1 PostgreSQL-gated skipped in ordinary run |
| Broader B3/B5/B6/B8 + route run | 89 passed, 1 PostgreSQL-gated skipped |
| Physical-binding B1 suite | 37 passed, 6 environment-gated skipped |
| Real U01 PostgreSQL ready/blocked/stale route gate | 1 passed, 10 filtered |
| Real editor client -> handlers -> PostgreSQL gate | 1 passed, 4 filtered |
| Real assignment v2 PostgreSQL/recreation gate | 1 passed |
| Focused ESLint, all 12 product/test paths | exit `0`, no findings |
| Full TypeScript | exit `0`, zero diagnostics |

## 13. Isolated database and migration evidence

| Item | Evidence |
|---|---|
| Image | `pgvector/pgvector:pg16` |
| PostgreSQL | `16.14` |
| pgvector | `0.8.5` |
| Migration chain | 26/26, exact `0000` through `0025`, `ON_ERROR_STOP=1`, each in its own transaction |
| First combined gate rows | `18 records / 10 replays / 6 outbox events` |
| Final same-client + assignment gate rows | `16 records / 8 replays / 5 outbox events` |
| Cleanup | `RETRY02_CLEANUP_PRESENT=False` |

The first attempt correctly failed before migration 0000 until the disposable database installed the required `vector` extension. No migration was skipped or altered. All Retry02 containers were removed.

## 14. Real ready-flow identities and digests

```text
snapshotId       pcb-sync-snapshot:c0e41694d9d4e8b894b429ad220df3f7
snapshotRevision 1
snapshotDigest   pb1-ae183529164719612423df2999fb4b7575ab7bc3be8c46ed726f5595cb2934fe
planId           pcb-sync-plan:828e8f487782a74ee458707e69e03bef
planDigest       pb1-30086a8a5e840f60c929570c9a552fb37c6cd12a19f1aebbdabd26e33cbffd67
boardRevision    pcb2-da38df77e0ea98ac
boardDigest      pb1-cda1c7fe09785d748b6d463cab0920a26d875d41133f73ca6b0ae657d9d10c2b
reloadDigest     pb1-cda1c7fe09785d748b6d463cab0920a26d875d41133f73ca6b0ae657d9d10c2b
```

The separate same-client gate used the actual `PcbSyncClient`, handler composition, durable snapshot/repository implementation, guarded apply, and recreated PostgreSQL repository GET.

## 15. Assignment restart, redelivery, and scope evidence

The v2 event was loaded from PostgreSQL with exact decision owner revision, then handled by recreated repository/service/coordinator/dispatcher instances. It superseded the prior blocker and materialized the current one. Identical redelivery returned harmlessly after proving the same decision/plan outcome. A digest-valid forged payload with a different project was rejected before domain work. Same opaque item key in two projects returned only the record from the supplied exact scope.

## 16. Blocked and stale/conflict no-mutation evidence

- Missing authoritative footprint: preflight `blocked_component_resolution`; target board remained absent.
- Changed publication with stale expected snapshot revision: HTTP 409 / `PS_SNAPSHOT_REVISION_CONFLICT`; previously committed board remained deeply identical.
- Ready preflight: repository confirmed the board absent before explicit Apply.
- Apply/result GET mismatch: client/editor test rejected adoption and preserved the current board.
- Concurrent/double Apply: `applyingRef` prevents a second request while the first is active.

## 17. Exact files and conservative churn ledger

Twelve product/test files changed, exactly the authorized set. Because the seven assignment files were already untracked at baseline, Git cannot reconstruct their baseline numstat. The containment ledger therefore conservatively counts every current line of those seven files as added and every baseline line as deleted, then adds measured editor/persistence/netlist delta and the two new files:

```text
conservative additions: 790
conservative deletions: 548
total conservative churn: 1,338
limit: 1,600
```

This is a strict upper bound; actual Retry02 churn is materially smaller. Files:

1. `app/lib/assignment-queue/types.ts`
2. `app/lib/assignment-queue/service.ts`
3. `app/lib/assignment-queue/repository.ts`
4. `app/lib/assignment-queue/revalidation.ts`
5. `app/lib/assignment-queue/__tests__/service.test.ts`
6. `app/lib/assignment-queue/__tests__/revalidation.test.ts`
7. `app/lib/assignment-queue/__tests__/materializer-repository.test.ts`
8. `app/components/pcb/PcbEditor.tsx`
9. `app/lib/pcb/board-persistence.ts`
10. `app/lib/pcb/netlist-bridge.ts`
11. `app/lib/pcb-sync/client.ts`
12. `app/components/pcb/__tests__/pcb-sync-authority.test.tsx`

## 18. Forbidden paths and cleanup

No Retry02 change was made to AssignmentQueuePanel, PcbToolbar, assignment API, assignment materializer/adapters, PCB-sync API/domain/U01 files, auth, Drizzle/schema, migrations, dependencies/lockfiles, router, placement, autorouter, DRC, Gerber, AI editor, component search, Stage 6, or Stage 7. No generated artifact remains. Only this required report was added outside the 12 product/test paths.

## 19. Authorization

R04D demo follow-on is authorized. Production R04 is not authorized. Authentication and human membership remain open. Stage 6 demo and Stage 7 remain out of scope and may not resume from this report.
