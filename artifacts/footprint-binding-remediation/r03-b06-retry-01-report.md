# R03-B06 Retry 01 — Scoped Durable Workflow and Versioned Owner-Bound Outbox

## 1. Current verdict

`COMPLETE`

This is a new qualification result produced after Docker Desktop became available. It does not reuse the prior blocked result. The complete isolated-PostgreSQL gate, predecessor chain, existing B06 implementation, migration `0024`, clean-chain test, representative upgrade test, and fail-closed migration test were rerun. All B06 completion gates pass.

R03-B07 is authorized because, and only because, this new verdict is `COMPLETE`. R04, Stage 6, and Stage 7 remain unauthorized.

## 2. Repository identity and retry fingerprints

| Field | Value |
|---|---|
| Repository | `C:/Users/robsa/Documents/Codex/2026-07-13/do/work/sirkit-edit` |
| Protected original | `C:/Users/robsa/sirkit` — not accessed for writes |
| Branch | `codex/cd-13-full-flow-orchestrator` |
| HEAD | `2bd1603a775bd4b409b89710cd4e5f8d70201632` |
| Starting status paths | `1267` |
| Starting fingerprint | `45d8c68dacc3157682bed1fb318c15ea6d8ee74584c1cb1fc01b449a54d34c18` |
| Ending status paths | `1268` |
| Ending fingerprint | `f02115b7f9c575c5cded59c11b4f59999bb89533c5ddb6ab2000a490ef1d2709` |

The fingerprint is SHA-256 over LF-joined, case-sensitive sorted rows of `status path added deleted`; untracked rows are represented as `?? path 0 0`. The sole retry-local status addition is this report.

The user-designated historical report `r03-b06-report.md` was evidence only and was not used as the new verdict. Its before/after SHA-256 remained `705c4533c7c722369d4c717d31d90f4c49890dc1cc6c948dbcae74f3a7c32375`.

## 3. Assigned gaps and retry scope

- `R02-B6-X01`: mandatory tenant/project/branch-scoped aggregate identity and scoped head/history/replay/CAS behavior.
- `R02-B6-006`: explicit owner aggregate/revision, event type/version, canonical payload/event digests, and durable outbox lifecycle state.

The B06 implementation and `0024` already existed at the retry baseline. This run audited and qualified that exact implementation rather than rewriting working code. No production, schema, migration, test, B7, or unrelated file was modified during retry 01.

## 4. Phase G0 isolated migration-authority gate

The user-required Docker preflight ran first and passed:

| Command | Result |
|---|---|
| `docker context use desktop-linux` | exit `0`; current context `desktop-linux` |
| `docker version` | exit `0`; Client `29.3.1`, Server Engine `29.3.1`, Docker Desktop `4.67.0` |
| `docker info` | exit `0`; Linux/amd64 Docker server available through WSL2 |

The successful authoritative upgrade-gate database was a newly created `pgvector/pgvector:pg16` container named `sirkit_fb_r03_b06_retry01_upgrade_20260720111010_5d78f530` with database `sirkit_fb_r03_b06_retry01_upgrade_5d78f530`. It used network mode `none`, no published port, tmpfs database storage, and labels `sirkit.batch=r03-b06-retry-01` and `sirkit.disposable=true`.

Inside the container, `current_database`, `current_user`, and `server_version` reported the expected unique B06 database, `postgres`, and PostgreSQL `16.14`. After provisioning only the repository-required `vector` extension, the public user-table count was `0`. No ambient `DATABASE_URL`, existing application database, shared host, persistent volume, or project secret was used.

```text
MIGRATION GATE: PASS
ISOLATED DATABASE: PROVEN
PREDECESSOR CHAIN THROUGH 0023: PASS
PREDECESSOR LATEST ID: 0023_footprint_binding_durable_workflow
0022/0023 HASHES CAPTURED: YES
PRE-0024 DATASET CREATED: YES
```

## 5. Prerequisite and migration-chain audit

The prerequisite evidence was rechecked:

- R03A verdict is `SPLIT_PLAN_READY`.
- R03-B01 through R03-B05 each report `COMPLETE`.
- R03-B05 authorizes R03-B06 subject to the migration gate.
- The assigned gaps are exactly `R02-B6-006` and `R02-B6-X01`.

Journal entries `0000` through `0024` exist exactly once, have unique ascending indexes, and every referenced SQL file exists. Entries `0006` through `0023` are present exactly once and ordered. The retry baseline correctly ends at the already implemented `0024`; the predecessor qualification deliberately sliced the same journal through `0023` before testing `0024` separately.

The latest Drizzle snapshot remains `0008_snapshot.json`; no snapshot was created or treated as authoritative for later migrations. Migrations `0022`, `0023`, and `0024` contain no internal `BEGIN`, `COMMIT`, or `CONCURRENTLY`, so the isolated harness supplied `ON_ERROR_STOP=1` and `--single-transaction` for each file.

## 6. Final scoped aggregate identity contract

`DurableWorkflowScope` requires `tenantId`, `projectId`, and `branchId`. `DurableAggregateIdentity` combines that canonical scope with `aggregateType` and `aggregateKey`. Scope and identifiers are validated and canonicalized before identity, head ID, record ID, map key, digest, or query construction.

There is no production overload that defaults scope or searches all scopes. The shared repository interface requires a full identity for `loadHead` and `history`, explicit scope for record/replay operations, and explicit scope on every commit. Head and record uniqueness includes all three scope fields plus aggregate type/key and revision where applicable.

## 7. Head, history, replay, commit, and CAS behavior

Both in-memory and PostgreSQL implementations use the complete canonical identity for reads and writes. Commit validation rejects mixed-scope records or an outbox owner outside the same transaction. Replay lookup is scoped by tenant/project/branch, scope key, and idempotency key. PostgreSQL compare-and-swap predicates include exact scope, aggregate identity, and expected revision.

The live PostgreSQL test committed the same aggregate type/key and the same replay key in two tenants, then proved independent heads, history, replay, and CAS. It also proved cross-scope outbox acknowledgement fails with the bounded `DW_OUTBOX_LEASE_CONFLICT` error rather than exposing another scope's data.

## 8. Owner-bound, versioned outbox contract

Every `DurableOutboxEvent` contains:

- stable event ID and full tenant/project/branch scope;
- owner aggregate type, key, and committed successor revision;
- semantic event type and positive schema version, separately from transport topic;
- idempotency key, canonical payload digest, and canonical event digest;
- pending/processing/completed/failed state, attempts, availability, lease owner/token/expiry, bounded last error, completion time, and terminal time where available.

Adapters supply an owner reference and event semantics, but the repository binds scope and successor owner revision from the transaction. Same-ID/different-owner, type, version, or payload conflicts are rejected. Replay returns the already committed event rather than publishing another event.

## 9. B3/B4/B5 adapter contracts

| Adapter | Explicit events | Owner authority |
|---|---|---|
| B3 PCB sync | `pcb-sync.snapshot-published@1`, `pcb-sync.applied@1`, `pcb-sync.plan-staled@1` | snapshot, board, or plan successor committed in the same scoped transaction |
| B4 mapping | `mapping.stage1-project@1`, `mapping.invalidate@1` | exact mapping record successor in the scoped commit |
| B5 passive policy | `passive-policy.invalidate@1` | exact policy/exception successor in the scoped commit |

The B4 result-store public lookup also requires `verificationId + tenantId + projectId + branchId`. Focused tests prove fresh-instance durable reload, absence authority, corruption rejection, scoped post-write verification, and outage propagation without a process-local fallback.

## 10. Runtime dispatch and version validation

Before dispatch, `assertDurableOutboxEvent` recomputes and verifies both payload and event digests. Handlers are selected by `eventType@eventVersion`, not topic alone. Missing/unsupported contracts fail as `DW_OUTBOX_HANDLER_UNSUPPORTED`; corrupted payload/digest fails before handler execution. Completion and failure acknowledgement require the exact event scope, worker, and lease token.

The repository/outbox suite proves safe retry, expired-lease recovery with a distinct token, cross-scope acknowledgement rejection, corrupt-payload rejection, and explicit type/version dispatch. B08 dependency ordering and readiness barriers were not added.

## 11. Migration `0024` design inventory

`0024_footprint_binding_durable_workflow_hardening.sql` has SHA-256 `e827dce3a3d4bbbd1d21fcf14faf37867e1b6b187acaf0a34e8dea5255b67a88`. The journal has exactly one matching entry and SHA-256 `2d20362a3077d01e2a6b05349e95455e7b867f9e11dae0ba71ff2d0c0468bd80`.

The migration:

- preflights malformed aggregate scope, head/current-record disagreement, history-owner disagreement, scoped collisions, malformed/cross-scope replay data, unsupported legacy topics, and ambiguous event ownership;
- adds three non-null replay scope columns;
- adds eleven outbox columns: three scope fields, three owner fields, event type/version/digest, lease token, and terminal time;
- deterministically backfills replay scope and outbox ownership only from verified immutable replay/record relationships;
- assigns the explicitly supported legacy event version `1` and computes a canonical event digest;
- derives a legacy lease token only for an already-processing row;
- replaces six unscoped/old operational indexes with six scoped/owner indexes, including three unique indexes;
- adds ten check constraints and three deferrable foreign keys.

Nine of the eleven new outbox columns are non-null; lease token and terminal time remain nullable because they are lifecycle-state dependent.

## 12. Legacy-data preflight and fail-closed behavior

The migration never guesses an owner from arbitrary payload data. An event must be linked by replay metadata to exactly one verified immutable record whose stored scope and aggregate identity match. Ambiguous, absent, malformed, cross-scope, or unsupported data aborts the transaction with a stable `DW0024_*` marker.

The controlled ambiguity fixture linked one event to two valid revisions. `0024` exited `3` with `DW0024_OUTBOX_OWNER_AMBIGUOUS`. Post-failure inspection found zero `event_version` columns, zero replay scope columns, zero new owner indexes, while the original event and both records remained. This proves no partial schema or data publication.

## 13. Clean-chain result

`PASS`.

A separate fresh database in container `sirkit_fb_r03_b06_retry01_clean_20260720111133_b25d78c4` applied all 25 journaled migrations `0000` through `0024` in exact order. It used tmpfs storage and only an ephemeral `127.0.0.1` port for the repository test.

Final inspection found four durable-workflow tables, all eleven expected outbox columns, six expected scoped indexes, and thirteen expected constraints. The live repository test passed `2/2` and left two isolated heads, records, replays, and outbox events across two distinct tenants; both events persisted owner revision, event version, payload digest, and event digest.

## 14. Upgrade result

`PASS`.

The upgrade database applied `0000` through `0023`, then held two aggregate types in two scopes with `2` heads, `4` immutable records, `4` replays, and `4` outbox events. The lifecycle fixtures were pending, processing/leased with attempt `3`, completed with completion time, and failed/terminal with attempt `8`.

The initial seed command exposed an explicit SQL timestamp-cast harness error. Because the seed ran with `--single-transaction`, verification showed `0|0|0|0` rows afterward. A corrected atomic seed was then applied to that still-clean predecessor database before `0024`; no partial fixture was reused.

After `0024`, counts remained `2|4|4|4`. A digest over every pre-existing outbox column was identical before and after: `9ab12936c6d2ea30be2b251cf6e64108`. All four events acquired the exact scope, aggregate owner/revision, semantic event type, and version `1` expected from their verified replay records.

## 15. Fail-closed and supported-rerun result

`PASS`.

A third fresh network-isolated database applied through `0023`, received the controlled two-owner ambiguity, and rejected `0024` atomically as described in section 12. After changing only the fixture replay to the single verifiable current owner, the same unmodified `0024` completed successfully and bound:

```text
amb-event | tenant-amb/project-amb/main | mapping.record.v1/amb-key@2 | mapping.invalidate@1
```

This qualifies the supported recovery boundary without claiming raw SQL is generally idempotent after success; production migration bookkeeping still owns once-only application.

## 16. Lease, retry, completion, and terminal preservation

The pre-existing outbox-column digest equality proves the migration preserved state, attempts, next-available time, lease owner/expiry, bounded error code, creation time, completion time, payload, and payload digest exactly. The processing event received deterministic token `legacy-lease:seed-event-leased:3` while retaining its owner, expiry, attempt count, and error.

The old schema had no terminal timestamp, so `0024` did not fabricate one. It preserved the failed terminal state and safe error; new terminal transitions persist `terminalAt`. Full process-kill/redelivery qualification remains R04.

## 17. Tests, commands, and exit results

| Command or gate | Result |
|---|---|
| requested Docker context/version/info preflight | all exit `0`; Client and Server available |
| predecessor migrations `0000`–`0023` | `24/24` applied with transaction/error-stop |
| clean migrations `0000`–`0024` | `25/25` applied with transaction/error-stop |
| PostgreSQL tenant-scope repository test | exit `0`, `2/2` tests |
| combined B06/B3–B5/B4 focused Vitest | exit `0`, `5/5` files, `24/24` unique tests |
| focused TypeScript compiler API project | exit `0`, `14` roots, `0` diagnostics |
| focused ESLint | exit `0`, `17` files |
| full `tsc --noEmit --pretty false --incremental false` | exit `2`, exactly `14` diagnostics limited to frozen B7 paths |
| broad B01–B05 directory sweep | `17/24` files and `185/211` tests passed; all `26` failures are the pre-existing `PB_DECISION_EVIDENCE_REQUIRED` fixture debt outside B06 |
| tracked B06 `git diff --check` | exit `0` |

The broad sweep does not block B06: every failure has the same known B1 fixture cause, none is in a B06-local file, and all focused B06 gates pass.

## 18. Frozen B7/B10 compatibility debt

Full TypeScript reports only:

- `app/lib/assignment-queue/repository.ts`: old unscoped workflow call shapes and outbox effects missing `owner`, `eventType`, and `eventVersion`;
- `app/lib/assignment-queue/__tests__/materializer-repository.test.ts`: the already documented unsupported `"fitted"` applicability fixture.

B10 must add explicit scope/identity arguments, versioned owner-bound event contracts, and update the obsolete fixture. No unsafe B06 overload was added and neither B7 path changed.

## 19. Retry-local changed-file inventory

| Path | Classification | Retry change | Reason |
|---|---|---:|---|
| `artifacts/footprint-binding-remediation/r03-b06-retry-01-report.md` | report | `+281 / -0` | preserve the new Docker-backed evidence and verdict without overwriting historical evidence |

Production/schema/migration/test files changed by retry 01: `0`. Existing B06 implementation files were read and exercised but not modified. No formatting, generated-file cleanup, line-ending rewrite, or unrelated rewrite occurred.

## 20. Stop-loss budget

| Budget item | Used |
|---|---:|
| Production/schema/migration/test files | `0/15` |
| Product churn | `+0 / -0` |
| Report files | `1/1` |
| Total retry-local churn | `+281 / -0` (`281/1500`) |
| New migrations | `0` during retry; existing authorized `0024` requalified |
| B7 files | `0` |
| Unrelated files | `0` |

## 21. Immutable migration and prerequisite hashes

| File | Before | After | Result |
|---|---|---|---|
| `0022_footprint_binding_stage01.sql` | `ead8a3075420856561140b6099707137164a9a297b5a86c017e12811c05f3a41` | same | byte-identical |
| `0023_footprint_binding_durable_workflow.sql` | `97ab9df0afba33687bef3ff2d25bac6b50869eaab634731012ee0d50e33388e4` | same | byte-identical |
| historical `r03-b06-report.md` | `705c4533c7c722369d4c717d31d90f4c49890dc1cc6c948dbcae74f3a7c32375` | same | byte-identical |

B01–B05 report hashes also remained the captured prerequisite values. No migration or report history was edited.

## 22. Isolated database cleanup

`COMPLETE`.

Three successful-gate containers were present at cleanup: upgrade, clean-chain, and fail-closed. All were force-removed by the retry label. A final `docker ps -aq --filter label=sirkit.batch=r03-b06-retry-01` returned `0` containers. No named volume was created; each database used tmpfs. Docker Server remained available and Docker Desktop was left running.

The earlier throwaway container stopped by PowerShell's handling of a harmless PostgreSQL `NOTICE` had already been removed before the authoritative gate restarted. It contributed no evidence to the passing verdict.

## 23. Forbidden-path and safety confirmation

- The protected original `C:/Users/robsa/sirkit` was not modified.
- The historical B06 report was not overwritten.
- No `.env` value, ambient application database URL, shared database, or persistent database volume was used.
- No B7, B08, B09, B10, Stage 6, Stage 7, API, PCB component, package, lockfile, or unrelated path changed.
- `0022`, `0023`, snapshots, and the existing `0024`/journal identity remained byte-identical.
- Nothing was staged, committed, pushed, reset, restored, formatted globally, regenerated, moved, or deleted.

## 24. Residual obligations

- R03-B07 may implement only its separately authorized B1 relational-integrity batch.
- B08 still owns effect ordering, completion barriers, and downstream readiness convergence.
- B09 remains responsible for trusted authentication concerns.
- B10 remains responsible for frozen assignment-queue/Stage 6 compatibility.
- R04 remains responsible for process restart, crash, redelivery, and deployed PostgreSQL qualification.
- Stage 6 and Stage 7 may not resume from this B06 verdict alone.

## 25. Authorization and final result block

```text
R03-B06 VERDICT: COMPLETE
GAPS ASSIGNED: R02-B6-006, R02-B6-X01
MIGRATION GATE: PASS
ISOLATED POSTGRESQL: PROVEN
SCOPED AGGREGATE IDENTITY: PASS
SCOPED HEAD/HISTORY/REPLAY/CAS: PASS
OWNER-BOUND VERSIONED OUTBOX: PASS
EVENT IDENTITY/DIGEST VALIDATION: PASS
LEASE/RETRY STATE PRESERVATION: PASS
MIGRATION 0024 CLEAN CHAIN: PASS
MIGRATION 0024 UPGRADE: PASS
MIGRATION FAIL-CLOSED CASE: PASS
0022/0023 BYTE-IDENTICAL: YES
PRODUCT/SCHEMA/TEST FILES CHANGED: 0/15
DIFF CHURN: +281 / -0 (281/1500)
FOCUSED TESTS: PASS
FOCUSED TYPE CHECK: PASS
FROZEN B7 FILES CHANGED: NO
B7 COMPATIBILITY DEBT: RECORDED_FOR_B10
UNRELATED FILES CHANGED: NO
ISOLATED DATABASE CLEANUP: COMPLETE
R03-B07 AUTHORIZED: YES
R04 AUTHORIZED: NO
STAGE 6 MAY RESUME: NO
STAGE 7 MAY RESUME: NO
REPORT: artifacts/footprint-binding-remediation/r03-b06-retry-01-report.md
```
