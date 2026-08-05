# R03-B06 — Scoped Durable Workflow and Versioned Owner-Bound Outbox

## 1. Verdict

`COMPLETE`

The B06 repository, outbox, adapters, migration, and isolated PostgreSQL qualification are implemented and pass their focused gates. After the user explicitly authorized a narrow scope expansion, `MappingVerificationResultStore.get` now requires `verificationId + tenantId + projectId + branchId`; service callers propagate authenticated scope and a fresh durable store instance reloads the result without a process-local registry, unscoped search, or default scope.

## 2. Repository identity and fingerprints

| Field | Value |
|---|---|
| Repository | `C:/Users/robsa/Documents/Codex/2026-07-13/do/work/sirkit-edit` |
| Protected original | `C:/Users/robsa/sirkit` — untouched |
| Branch | `codex/cd-13-full-flow-orchestrator` |
| HEAD | `2bd1603a775bd4b409b89710cd4e5f8d70201632` |
| Starting status paths | `1264` |
| Starting fingerprint | `a7431bf5419184a8a0ed0124ebc9370be906eb526da99fbc20e0808b452e1e5e` |
| Ending status paths | `1267` |
| Ending fingerprint | `45d8c68dacc3157682bed1fb318c15ea6d8ee74584c1cb1fc01b449a54d34c18` |

The fingerprint is SHA-256 over LF-joined, case-sensitive sorted rows of `status path added deleted`; untracked rows are `?? path 0 0`. B01–B05 report hashes remained the verified prerequisite hashes recorded in the first B06 gate report.

## 3. Assigned gaps

- `R02-B6-X01`: scoped durable aggregate identity — repository portion implemented and qualified.
- `R02-B6-006`: owner-bound versioned outbox — implemented and qualified.
- The B4 public result-store lookup signature is now explicitly scoped and fresh-instance qualified.

## 4. Phase G0 migration-authority gate

| Gate | Result |
|---|---|
| Isolated PostgreSQL | `PROVEN` |
| Server | local Docker Desktop, PostgreSQL `16.14`, pgvector `0.8.5` |
| Database naming | unique `sirkit_fb_r03_b06_*` names |
| Isolation | disposable containers, temporary data, no shared database |
| Predecessor chain `0000`–`0023` | `PASS` |
| Pre-`0024` dataset | `PASS` |

The first plain `postgres:16-alpine` probe failed at `0000` because the repository's initial migration requires the platform-provided `vector` type. That empty container was removed. The authoritative gate was repeated from zero with `pgvector/pgvector:pg16`; only `CREATE EXTENSION vector` was provisioned before the untouched chain. No ambient `DATABASE_URL`, application secret, or shared database was used.

## 5. Predecessor journal/file/hash audit

Journal entries `0006`–`0023` existed exactly once and in strict order; all referenced SQL files existed. Before B06, the journal ended at `0023`, `0024` was absent, and snapshots ended at non-authoritative `0008`. All predecessor migrations lack explicit transaction markers, so qualification applied each file with `psql --single-transaction` and `ON_ERROR_STOP=1`.

| Artifact | SHA-256 |
|---|---|
| `0022_footprint_binding_stage01.sql` | `ead8a3075420856561140b6099707137164a9a297b5a86c017e12811c05f3a41` |
| `0023_footprint_binding_durable_workflow.sql` | `97ab9df0afba33687bef3ff2d25bac6b50869eaab634731012ee0d50e33388e4` |
| `0024_footprint_binding_durable_workflow_hardening.sql` | `e827dce3a3d4bbbd1d21fcf14faf37867e1b6b187acaf0a34e8dea5255b67a88` |
| final journal | `2d20362a3077d01e2a6b05349e95455e7b867f9e11dae0ba71ff2d0c0468bd80` |

## 6. Scoped aggregate identity contract

`DurableAggregateIdentity` is `scope + aggregateType + aggregateKey`. Scope and identifiers are NFC-normalized, trimmed, bounded, and control-character rejected. Head IDs, record IDs, in-memory keys, PostgreSQL lookup predicates, uniqueness, history, and CAS now include the complete scope. No unscoped durable repository overload remains.

## 7. Head/history/replay/CAS behavior

- Head and history lookups require explicit identity.
- Record lookup requires explicit scope.
- Replay lookup requires scope plus the existing scope/idempotency key.
- PostgreSQL `FOR UPDATE` and CAS predicates include all scope columns.
- Identical type/key pairs in separate tenants/projects/branches remain independent.
- Mismatch errors expose stable codes, not other-scope contents.

## 8. Owner-bound versioned outbox contract

Every new event contains explicit scope, owner type/key/successor revision, semantic event type/version, topic, payload digest, event digest, timestamps, attempts, and lease/completion/terminal state. Callers name an owner operation but cannot supply its revision or scope; the repository derives both from the exact successful commit record.

## 9. B3/B4/B5 event contracts

| Adapter | Event type/version | Derived owner |
|---|---|---|
| B3 snapshot | `pcb-sync.snapshot-published@1` | snapshot successor |
| B3 apply | `pcb-sync.applied@1` | board successor |
| B3 stale plan | `pcb-sync.plan-staled@1` | plan successor |
| B4 projection | `mapping.stage1-project@1` | mapping record successor |
| B4 invalidation | `mapping.invalidate@1` | mapping record successor |
| B5 invalidation | `passive-policy.invalidate@1` | policy record successor |

## 10. Runtime dispatch/version validation

Dispatch validates canonical payload digest and event identity digest before handler execution. Handlers are selected by `eventType@eventVersion`, not topic alone. Unsupported versions terminate observably, bounded safe error codes are retained, and full payloads are not logged. Completion/failure acknowledgements require exact scope, event ID, worker, and per-claim lease token.

## 11. Migration `0024` inventory

The single forward migration:

- preflights scope/head/history/replay/outbox consistency;
- backfills replay scope from verified immutable records;
- backfills event owner/scope only when exactly one verified record is available;
- assigns version `1` only to the explicit B3–B5 semantic topic allowlist;
- computes canonical SHA-256 event digests with `pgcrypto` using the same field order as TypeScript;
- adds replay scope columns and outbox scope/owner/type/version/digest/lease-token/terminal-time columns;
- replaces unsafe unscoped uniqueness/history/dispatch indexes;
- adds scope, revision, state, completion, terminal, and lease checks;
- adds deferred head↔record and outbox-owner→immutable-record foreign keys.

## 12. Legacy-data fail-closed behavior

Malformed scopes, missing records, head/history disagreement, cross-scope replay, unknown event semantics, event/replay metadata mismatch, missing owners, and multi-owner ambiguity raise precise `DW0024_*` database errors. No payload field is trusted as owner authority and no sentinel owner is invented.

## 13. Clean-chain result

`PASS`. A fresh pgvector PostgreSQL database applied `0000` through journaled `0024`. Final indexes/constraints were inspected. Real `PostgresDurableWorkflowRepository` tests then passed scoped duplicate-key, history, replay, CAS, owner persistence, lease-token, and cross-scope acknowledgement checks.

## 14. Upgrade result

`PASS`. A separate database applied through `0023`, received two aggregate types with immutable history/replay plus pending, leased/retryable, completed, and terminal rows, then applied `0024` successfully. Counts remained `2 heads / 4 records / 4 replays / 4 events`.

## 15. Fail-closed result

`PASS`. A third database with one event linked to two possible immutable owner revisions failed with `DW0024_OUTBOX_OWNER_AMBIGUOUS`. Inspection proved zero `event_version` columns and zero scoped indexes were partially published while the legacy event remained. After reducing the fixture to one verifiable owner, the same migration succeeded and bound revision `2`.

## 16. Lifecycle preservation

Pending state/attempt `0`, leased state/attempt `3`/owner/expiry/error, completed state/time, and terminal failed state/attempt `8`/safe error survived unchanged. A deterministic legacy lease token was added only to the already leased row. Existing schema had no terminal timestamp, so no historical terminal time was fabricated; new terminal failures persist `terminalAt`.

## 17. Tests and commands

| Command/gate | Result |
|---|---|
| focused B06 Vitest: repository + B3–B5 owners + PostgreSQL scope | exit `0`, 3 files, 10/10 tests |
| scoped B4 store/service/lifecycle follow-up | exit `0`, 4 files, 22/22 tests; 14 are additional unique B4 tests |
| focused B06 TypeScript project | exit `0` |
| focused ESLint on authorized TypeScript paths | exit `0` |
| full TypeScript | exit `1`; only frozen assignment-queue B7 calls plus its previously reported `"fitted"` fixture error |
| B01–B05 broad regression sweep | 19 files/193 tests passed; 7 files/26 tests failed only on pre-existing `PB_DECISION_EVIDENCE_REQUIRED` fixture debt outside B06 paths |
| whitespace/diff checks | no B06 trailing whitespace; tracked `git diff --check` produced no errors |

The authorized owner-adapter suite includes real decision evidence, revision-complete passive exception authority, and a trusted PCB apply clock; it passes 3/3.

## 18. Frozen B7/B10 compatibility debt

`app/lib/assignment-queue/repository.ts` still calls unscoped `loadHead`/`getReplay` and emits events without owner/type/version. Full TypeScript reports those exact argument/contract failures. `app/lib/assignment-queue/__tests__/materializer-repository.test.ts` retains the already documented unsupported `"fitted"` fixture. No assignment-queue/B7 file changed; compatibility belongs to B10.

## 19. Task-local changed-file inventory

Eighteen product/schema/test paths changed: 14 from the original B06 boundary plus the four explicitly user-authorized B4 paths (`mapping-verification/types.ts`, `service.ts`, `durable-result-cache.test.ts`, and `lifecycle-invalidation.test.ts`). `effects-runtime.ts` did not require an edit because dispatch validation is centralized in `outbox.ts` and adapter maps provide versioned keys. This report is the one report path. No other B06-local path changed.

## 20. Budget

Task-local patch accounting is `+613 / -416` (`1029/1500`) including this report. Product/schema/test accounting before the report is `+504 / -416`. Aggregate Git numstat is not used for attribution because most authorized files were already user-owned untracked files and tracked schema/journal contain earlier-stage work.

## 21. Immutable migration hashes

`0022` and `0023` after-hashes exactly equal their before-hashes listed in section 5. Only `0024` and one matching journal entry were added. No snapshot was created or regenerated.

## 22. Isolated database cleanup

`COMPLETE`. All upgrade, clean-chain, and fail-closed containers were force-removed. `docker ps -a --filter label=sirkit.batch=r03-b06` returned no remaining container. No named volume was created; database storage used container-local temporary storage. Docker Desktop itself was left running because the user made it available.

## 23. Forbidden-path confirmation

Protected original, B7 files, historical B01–B05 reports, `0022`, `0023`, Drizzle snapshots, unrelated production/tests, project secrets, and ambient database configuration were untouched. Nothing was staged, committed, reverted, formatted globally, or pushed.

## 24. Residual obligations

- B7 assignment-queue adaptation remains B10.
- B08 ordering/readiness barriers, B09/B10 follow-ons, and R04 restart/crash qualification remain out of scope.

## 25. Authorization

`R03-B07: YES`. Both assigned gaps, the scoped B4 result-store follow-up, migration qualification, and focused release gates are complete. R04 remains unauthorized.
