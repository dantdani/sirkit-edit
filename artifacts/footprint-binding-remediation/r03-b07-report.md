# R03-B07 — Forward Physical-Binding Relational Integrity

## 1. Verdict

`COMPLETE`

R03-B07 closes exactly `R02-B1-012`. Migration `0025_footprint_binding_integrity.sql` adds practical PostgreSQL-enforced revision, state, selected-owner, audit-owner, migration-owner, and readiness-owner integrity without reopening B01–B06 or implementing B08, B09, B10, R04, Stage 6, or Stage 7.

R03-B08 is authorized because every B07 completion gate passed. R04, Stage 6, and Stage 7 remain unauthorized.

## 2. Repository identity and fingerprints

| Field | Value |
|---|---|
| Repository | `C:/Users/robsa/Documents/Codex/2026-07-13/do/work/sirkit-edit` |
| Protected original | `C:/Users/robsa/sirkit` — untouched |
| Branch | `codex/cd-13-full-flow-orchestrator` |
| HEAD | `2bd1603a775bd4b409b89710cd4e5f8d70201632` |
| Starting status paths | `1268` |
| Starting fingerprint | `f02115b7f9c575c5cded59c11b4f59999bb89533c5ddb6ab2000a490ef1d2709` |
| Ending status paths | `1271` |
| Ending fingerprint | `983cf5cfebfcdef3100ba27e12983265a93f3434c156045dc014c4c3905bda59` |

The fingerprint is SHA-256 over LF-joined, case-sensitive sorted `status path added deleted` rows; untracked rows are represented as `?? path 0 0`. Pre-existing user changes were preserved. B07-local attribution was calculated from the captured path hashes and reconstructed task baseline, not from the repository-wide dirty tree.

## 3. Assigned gap and explicit exclusions

The only assigned and closed gap is `R02-B1-012`: practical physical-binding relational invariants were not enforced by PostgreSQL.

B07 did not change durable-workflow identity/outbox behavior, authentication, assignment queue, UI, AI editor, component search, PCB routing, B08 convergence, B09, B10, R04, Stage 6, or Stage 7. The qualified B06 Retry 01 implementation and migration `0024` were treated as predecessors.

## 4. Isolated PostgreSQL authority

The authority gate used Docker Desktop context `desktop-linux`, Docker Engine `29.3.1`, image `pgvector/pgvector:pg16`, and PostgreSQL `16.14`.

Four uniquely named disposable B07 containers were used:

| Purpose | Isolation |
|---|---|
| pre-edit migration gate | network `none`, tmpfs database, no published port |
| clean chain and live repository tests | tmpfs database, ephemeral `127.0.0.1` port only |
| representative upgrade | network `none`, tmpfs database, no published port |
| fail-closed legacy data | network `none`, tmpfs database, no published port |

Each container had labels `sirkit.batch=r03-b07` and `sirkit.disposable=true`. Database names used the `sirkit_fb_r03_b07_*` prefix. The initial public user-table count was zero after provisioning only the repository-required `vector` extension. No ambient `DATABASE_URL`, `.env` value, existing developer database, shared service, persistent volume, or production-like host was used.

## 5. Migration-chain and journal audit

Before editing, the journal contained one unique ascending entry for every migration `0000` through `0024`, every referenced SQL file existed, and `0025` was absent. The untouched chain applied successfully through `0024` on a new empty PostgreSQL database before product edits.

The final journal contains exactly one new entry:

```text
idx 25 | 0025_footprint_binding_integrity | breakpoints true
```

The clean-chain database applied all 26 migrations `0000` through `0025` in exact journal order with `ON_ERROR_STOP=1` and an external `--single-transaction` per file. `0025` contains no internal transaction control and no `CONCURRENTLY` operation.

| File | SHA-256 |
|---|---|
| `0025_footprint_binding_integrity.sql` | `0e37c666c065c16d38b676ba5aeb538051207a9b478eb96c1e06c68bcee4d909` |
| final `_journal.json` | `e2e84351c5ec96f27fd1338b65d0e534089f467c44ab58285efe848c3972dca5` |

## 6. Protected migration hashes

| Migration | Before SHA-256 | After SHA-256 | Result |
|---|---|---|---|
| `0022_footprint_binding_stage01.sql` | `ead8a3075420856561140b6099707137164a9a297b5a86c017e12811c05f3a41` | same | byte-identical |
| `0023_footprint_binding_durable_workflow.sql` | `97ab9df0afba33687bef3ff2d25bac6b50869eaab634731012ee0d50e33388e4` | same | byte-identical |
| `0024_footprint_binding_durable_workflow_hardening.sql` | `e827dce3a3d4bbbd1d21fcf14faf37867e1b6b187acaf0a34e8dea5255b67a88` | same | byte-identical |

No historical migration or Drizzle snapshot was edited, reordered, regenerated, or replaced.

## 7. Foreign-key constraint matrix

All six foreign keys use `ON DELETE NO ACTION`, `ON UPDATE NO ACTION`, and `DEFERRABLE INITIALLY DEFERRED`. `NO ACTION` preserves audit/history evidence while deferral permits the existing head-last initial transaction to insert audit evidence before the owning set becomes visible at commit.

| Constraint | Child columns | Parent columns | Invariant | Preflight marker | PostgreSQL proof |
|---|---|---|---|---|---|
| `physical_binding_set_selected_revision_fk` | set selected revision + tenant/project/branch/board/component/variant digest | revision ID + identical full scope | selected revision exists and belongs to the exact binding-set scope | `PB0025_SELECTED_REVISION_OWNER_INVALID` | orphan/cross-scope selected rejection; rollback test |
| `physical_binding_audit_set_owner_fk` | audit aggregate set + tenant/project/branch/component | set ID + matching scope/component | audit belongs to a real scoped aggregate set | `PB0025_AUDIT_SET_OWNER_INVALID` | orphan audit set rejection |
| `physical_binding_audit_from_revision_owner_fk` | from revision + binding ID + tenant/project/branch/component | matching revision owner tuple | audit source revision exists and has the declared binding/scope owner | `PB0025_AUDIT_REVISION_OWNER_INVALID` | orphan source rejection |
| `physical_binding_audit_to_revision_owner_fk` | to revision + binding ID + tenant/project/branch/component | matching revision owner tuple | audit successor exists and has the declared binding/scope owner | `PB0025_AUDIT_REVISION_OWNER_INVALID` | orphan target rejection |
| `physical_binding_migration_revision_owner_fk` | candidate revision + tenant/project/branch/component | matching revision tuple | migration result refers to an existing candidate in the declared scope | `PB0025_MIGRATION_REVISION_OWNER_INVALID` | orphan migration candidate rejection |
| `physical_readiness_revision_owner_fk` | binding revision + binding record digest | revision ID + record digest | readiness result is attached to the exact immutable revision content | `PB0025_ASSESSMENT_REVISION_OWNER_INVALID` | missing/wrong-digest assessment rejection |

PostgreSQL catalog inspection reported all six as type `f`, deferrable, initially deferred, with update/delete action code `a` (`NO ACTION`). Drizzle `0.45` cannot express FK deferrability; `schema.ts` mirrors columns, names, and actions and contains a concise comment identifying SQL migration `0025` as authoritative for deferral.

## 8. Check-constraint matrix

| Constraint | Table/columns | Rule | Preflight marker | Test |
|---|---|---|---|---|
| `physical_binding_revision_number_check` | revisions.`revision` | `> 0` | `PB0025_REVISION_NUMBER_INVALID` | non-positive revision rejection |
| `physical_binding_revision_lifecycle_check` | revisions.`lifecycle_state` | exact seven-value domain vocabulary | `PB0025_REVISION_STATE_INVALID` | invalid lifecycle rejection |
| `physical_binding_revision_approval_check` | revisions.`approval_state` | exact six-value approval vocabulary | `PB0025_REVISION_STATE_INVALID` | invalid approval rejection |
| `physical_binding_revision_technical_check` | revisions.`technical_state` | `pending/valid/invalid/unsupported` | `PB0025_REVISION_STATE_INVALID` | invalid technical state rejection |
| `physical_binding_revision_freshness_check` | revisions.`freshness_state` | `current/stale/unknown/missing_source` | `PB0025_REVISION_STATE_INVALID` | invalid freshness rejection |
| `physical_binding_revision_conflict_check` | revisions.`conflict_state` | `none/present` | `PB0025_REVISION_STATE_INVALID` | invalid conflict state rejection |
| `physical_binding_revision_applicability_check` | revisions.`applicability_state` | `applicable/not_applicable/unknown` | `PB0025_REVISION_STATE_INVALID` | invalid applicability rejection |
| `physical_binding_revision_identity_check` | revision identity/scope/digests/actor | all required text nonblank | `PB0025_IDENTITY_BLANK` | migration preflight and catalog test |
| `physical_binding_set_revision_number_check` | sets.`revision` | `> 0` | `PB0025_SET_REVISION_INVALID` | non-positive set revision rejection |
| `physical_binding_set_identity_check` | set identity/full scope/digest | all required text nonblank | `PB0025_IDENTITY_BLANK` | migration preflight and catalog test |
| `physical_binding_audit_action_check` | audits.`action` | exact transition plus create/migrate/mapping vocabulary | `PB0025_AUDIT_ACTION_INVALID` | invalid action rejection |
| `physical_binding_audit_identity_check` | audit IDs, owner columns, scope, digest | all required text nonblank | `PB0025_IDENTITY_BLANK`, `PB0025_AUDIT_OWNER_METADATA_INVALID` | migration preflight and catalog test |
| `physical_binding_migration_status_check` | migrations.`status` | `migrated/skipped/ambiguous/failed` | `PB0025_MIGRATION_STATUS_INVALID` | invalid status rejection |
| `physical_binding_migration_identity_check` | migration identity/scope/source/owner/digest | all required text nonblank | `PB0025_IDENTITY_BLANK` | blank source preflight |
| `physical_readiness_layout_state_check` | assessments.`layout_state` | `ready/not_ready/not_applicable` | `PB0025_READINESS_STATE_INVALID` | invalid layout rejection |
| `physical_readiness_manufacturing_state_check` | assessments.`manufacturing_state` | same exact vocabulary | `PB0025_READINESS_STATE_INVALID` | invalid manufacturing rejection |
| `physical_readiness_identity_check` | assessment identity/revision/digests/policy | all required text nonblank | `PB0025_IDENTITY_BLANK` | migration preflight and catalog test |

Catalog qualification found all 17 named checks as type `c`.

## 9. Supporting uniqueness and audit-column inventory

Five narrow unique indexes supply exact composite parent keys:

- `physical_binding_revision_selected_owner_uniq`;
- `physical_binding_revision_audit_owner_uniq`;
- `physical_binding_revision_migration_owner_uniq`;
- `physical_binding_revision_assessment_owner_uniq`;
- `physical_binding_set_audit_owner_uniq`.

Audit rows gained non-null `aggregate_set_id`, `from_revision_id`, and `to_revision_id`. Existing rows are backfilled only from the immutable audit JSON after preflight verifies all three values and both owners. The repository now writes those columns directly, requires them at the persistence boundary, loads audits by exact aggregate set, and loads migration records by the set's exact candidate revision IDs instead of a broader component-only query.

## 10. Existing-data preflight and fail-closed results

The representative valid dataset passed every preflight. A separate pre-`0025` database then exercised 13 invalid legacy classes one at a time:

```text
PB0025_IDENTITY_BLANK
PB0025_REVISION_NUMBER_INVALID
PB0025_SET_REVISION_INVALID
PB0025_REVISION_STATE_INVALID
PB0025_AUDIT_ACTION_INVALID
PB0025_MIGRATION_STATUS_INVALID
PB0025_READINESS_STATE_INVALID
PB0025_SELECTED_REVISION_OWNER_INVALID
PB0025_AUDIT_OWNER_METADATA_INVALID
PB0025_AUDIT_SET_OWNER_INVALID
PB0025_AUDIT_REVISION_OWNER_INVALID
PB0025_MIGRATION_REVISION_OWNER_INVALID
PB0025_ASSESSMENT_REVISION_OWNER_INVALID
```

Every attempt exited `3` with the exact stable marker. After each failure the rollback shape was `0 new audit columns | 0 new owner indexes | 0 new FKs | 2 revisions | 1 set | 2 audits | 1 migration | 1 assessment`. No row was rewritten or removed. Each invalid fixture was explicitly corrected, and the unchanged migration then completed successfully with all six FKs and all rows intact.

## 11. Clean-chain qualification

`PASS`.

An empty PostgreSQL 16.14 database applied `0000` through `0025` in journal order. Catalog shape was exactly `6 deferred FKs | 17 checks | 5 supporting indexes`. The two authorized focused files passed `15/15` tests, including direct PostgreSQL enforcement and a real repository transaction.

The repository test proved:

- insert-only revision, audit, migration, and assessment rows remain writable;
- an initial audit may precede its set within the same transaction, but no partial state is visible at commit;
- identical retry is idempotent;
- selection creates a successor revision and moves the selected head atomically;
- bad selected ownership at deferred commit rolls back the earlier valid revision insertion and pointer update.

## 12. Representative `0024` to `0025` upgrade

`PASS`.

The source dataset was produced through the real PostgreSQL repository and contained:

```text
2 revisions | 1 set | 2 audits | 1 migration | 1 assessment | 1 active selected revision
```

Only pre-`0025` columns were transferred to a fresh database at migration `0024`. Before/after table-content digests were identical:

```text
revisions   d7f9628126608136d781ce7ec4d3d102
sets        3a0673cc4c9ea32dbb852543911827ee
audits      57ce7b95806816f87780834362888704
migrations  523f7f14863b03ea31f3668993ce7582
assessments 287bf597c57e20f7098703cdc1bd692d
```

The set remained at revision `2` with the same selected revision. Both revision numbers and record digests, both event digests, the migration record digest, and the assessment digest were identical before and after. Both audit rows received exact relational owner columns equal to their immutable JSON. A post-upgrade invalid selected owner was rejected by `physical_binding_set_selected_revision_fk`.

## 13. Tests and diagnostics

| Command/gate | Result |
|---|---|
| clean focused test files | exit `0`, `2/2` files, `15/15` tests |
| complete physical-binding suite | exit `0`, `7/7` files, `43/43` tests |
| affected B06 workflow/mapping suite | exit `0`, `5/5` files, `24/24` tests |
| focused TypeScript compiler project | exit `0`, `4` roots, `0` diagnostics |
| focused ESLint | exit `0`; one pre-existing warning in the unchanged server-contract test |
| full TypeScript | exit `2`, exactly `14` diagnostics in frozen assignment-queue/B7 paths |
| broad B01–B05 diagnostic sweep | `18/25` files and `186` tests passed, `6` live-only tests skipped, `26` tests failed only with known `PB_DECISION_EVIDENCE_REQUIRED` fixture debt |

The 14 full-TypeScript diagnostics are identical to B06: unscoped assignment-queue calls, missing owner/type/version event fields, and the obsolete `"fitted"` test fixture. The 26 broad failures are the previously documented B1 fixture debt. Neither diagnostic class is caused by B07, and forbidden files were not edited.

## 14. Exact B07-local file inventory and budget

| Path | Purpose | Added | Deleted |
|---|---|---:|---:|
| `app/lib/db/schema.ts` | mirror checks, owner keys, columns, and FKs | 54 | 6 |
| `drizzle/0025_footprint_binding_integrity.sql` | forward preflight and constraints | 230 | 0 |
| `drizzle/meta/_journal.json` | one successor entry | 7 | 0 |
| `app/lib/physical-binding/server-repository.ts` | supply/load exact relational owners | 8 | 3 |
| `app/lib/physical-binding/__tests__/schema-integrity.test.ts` | static and live PostgreSQL qualification | 217 | 0 |

Product/schema/test files changed: `5/6`. Product/schema/test churn: `+516 / -9`, total `525/900`. The authorized existing `server-repository-contract.test.ts` was exercised but did not require a B07 edit. This report is the sole report file and has `+255 / -0` report-only churn.

No generated file, lockfile, package manifest, snapshot, assignment-queue file, or unrelated path changed. There was no formatting or line-ending rewrite.

## 15. Cleanup and safety confirmation

All four containers labeled `sirkit.batch=r03-b07` were force-removed. Final labeled-container count was `0`; no named volume existed because database storage used tmpfs. Docker Desktop and Docker Engine were left running.

The protected original repository was untouched. Nothing was staged, committed, pushed, reset, restored, stashed, rebased, cleaned, globally formatted, or regenerated.

## 16. Deliberately unenforced relationships and residual risk

- `binding_set.candidateRevisionIds` remains an immutable JSON list rather than a relational join table. `0025` enforces the selected pointer against the exact full scope, but cannot add an FK for every JSON array element without a new normalized membership table outside B07's model/scope.
- Audit rows identify their exact set and exact globally unique source/target revisions. The audit SQL row does not contain board/variant columns, so a single composite FK cannot directly compare those fields between both parent tables. The exact set ID, global revision IDs, binding ID, tenant/project/branch/component checks, immutable event digest, and repository construction provide the practical boundary; a fully normalized audit-owner join would require a larger successor model.
- Drizzle mirrors every FK name, column tuple, action, check, and unique index, but cannot declare `DEFERRABLE INITIALLY DEFERRED` in the installed API. Migration `0025` remains authoritative for deferrability.
- No destructive delete workflow was introduced. Every FK uses `NO ACTION`; any future explicit deletion feature must preserve audit/history truth.
- R04 must still qualify deployed restart/crash/redelivery behavior; B07 only qualifies transactional PostgreSQL integrity.

These limitations do not leave the assigned practical orphan, scope, revision, selected-owner, migration-owner, assessment-owner, or persisted-state classes unenforced.

## 17. Successor authorization

`R03-B08 AUTHORIZED: YES`.

B08 may consume the completed B06 owner/version fields and this B07 integrity boundary for its separately scoped effect-ordering/readiness work. It may not rewrite `0025` or absorb B09/B10/R04/Stage 6/Stage 7.

## 18. Final result block

```text
R03-B07 VERDICT: COMPLETE
GAP ASSIGNED: R02-B1-012
GAPS CLOSED: 1
MIGRATION ADDED: 0025_footprint_binding_integrity.sql
POSTGRESQL GATE: PASS
CLEAN CHAIN 0000-0025: PASS
UPGRADE 0024-0025: PASS
FAIL-CLOSED LEGACY DATA: PASS
FOCUSED TESTS: 15/15
PRODUCT/SCHEMA/TEST FILES CHANGED: 5
PRODUCT/SCHEMA/TEST DIFF CHURN: +516 / -9
0022-0024 BYTE-IDENTICAL: YES
FROZEN B7 CHANGED: NO
UNRELATED FILES CHANGED BY B07: NO
R03-B08 AUTHORIZED: YES
R04 AUTHORIZED: NO
STAGE 6 MAY RESUME: NO
STAGE 7 MAY RESUME: NO
REPORT: artifacts/footprint-binding-remediation/r03-b07-report.md
```
