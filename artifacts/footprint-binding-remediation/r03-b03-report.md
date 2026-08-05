# R03-B03 — B4 Durable-First Mapping Verification Result

## 1. Verdict

**R03-B03 VERDICT: COMPLETE**

This batch closes exactly `R02-B4-002`. Mapping verification results used by authoritative mutations now come from the configured durable result store, are digest/identity/scope verified, and cannot fall back to process memory. The former process-local `results` map was removed rather than retained as a cache. No `R02-B4-005` projection/invalidation convergence work was performed.

## 2. Repository identity and fingerprints

| Field | Value |
|---|---|
| Repository root | `C:/Users/robsa/Documents/Codex/2026-07-13/do/work/sirkit-edit` |
| Protected original | `C:/Users/robsa/sirkit` — not modified |
| Branch | `codex/cd-13-full-flow-orchestrator` |
| HEAD | `2bd1603a775bd4b409b89710cd4e5f8d70201632` |
| Starting status paths | 1,259 |
| Starting normalized fingerprint | `4dc372aa92e60e0a6e42c0afe0e2deb32d803c964c18aa2ac5f1113c6acc9019` |
| Product/test-complete status paths | 1,260 |
| Product/test-complete fingerprint | `a751096726380a2149350f3b25c0fb67bd650e0d83f5038e0dfa1b99266567b6` |
| Ending status paths, including this report | 1,261 |
| Ending normalized fingerprint | `9b323ad8678b0f2d3d5f4bb52725be607fafd5e40f6f6d862afbe4c9ec0b32f7` |

The normalized fingerprint uses ordinal-sorted rows of `status + path + numstat`, with untracked rows represented as `?? <path> 0 0`. Existing dirty-tree changes remain user-owned. B03 attribution is based on task-local pre-edit copies and hashes, not on the aggregate worktree diff.

Prerequisites were verified before product edits:

- R03A: `SPLIT_PLAN_READY`.
- R03-B01: `COMPLETE`; report SHA-256 `d1c7685b1830698d5fc867903a8f6582b6cbcae58a7231d4e71763fe7f3d1366`.
- R03-B02: `COMPLETE`; report SHA-256 `f8f5f138f049256c43dcf9b73194f42fa72d5c13e799dbcbfdb9bba8b05cb732`.
- R03-B02 authorization: `R03-B03 AUTHORIZED: YES`.
- R03A batch assignment: only `R02-B4-002`, with the exact three authorized product/test paths used here.

## 3. Assigned gap

`R02-B4-002` — verification results could become consumable in process memory before durable persistence succeeded.

No other gap was assigned or claimed closed.

## 4. Verified pre-repair authority defect

Pre-repair `MappingVerificationService.rememberResult` executed:

1. `results.set(...)` on a process-local map;
2. then `await resultStore?.put(...)`.

`storedResult` read that map before calling the durable store. Both `persistVerification` and approval revalidation consumed `storedResult`, so a rejected durable `put`, a deleted durable row, or a corrupted durable row could be hidden by the valid memory copy.

A deterministic five-test pre-repair run proved the defect: 0/5 tests passed. The old implementation permitted mutation after a failed `put`, permitted mutation after durable deletion, permitted mutation despite corrupted durable payload, performed no post-write read, and surfaced an eventual collision rather than blocking corrupted durable truth at read time.

## 5. Durable result-store contract

The existing `MappingVerificationResultStore` contract remains unchanged:

- `put({ result, context, request })` persists the immutable result envelope;
- `get(verificationId)` returns the durable envelope or `null`.

Production already composes `DurableMappingContextStore` as this store. B03 did not create another repository, interface, schema field, or migration. A configured store's `put` and `get` failures propagate. Durable absence remains absence. Omission of the optional store supports only the existing non-authoritative calculation path; every authoritative result-consuming mutation now fails `MV_RESULT_STORE_UNAVAILABLE` instead of using that calculation.

## 6. Final write, read, and mutation sequence

The final write path is:

1. deterministically create the result;
2. validate its existing result digest and stable ID;
3. validate result/context/request/candidate/dependency consistency;
4. await durable `put`;
5. load the same ID using durable `get`;
6. verify the durable result's canonical technical payload, ID, digest, scope, policy, candidate, and dependency identity against the intended immutable result;
7. return the durable-verified representation.

The final authoritative read path is always `resultStore.get` followed by the same verification. `persistVerification` loads durable truth before eligibility and scope checks, then reloads it during revalidation. Approval revalidation also loads the original and refreshed result from durable truth. Reject, revoke, and mark-stale do not consume a remembered verification result; they continue to operate on the committed mapping repository head.

No owner repository commit, projection, or invalidation is reached when durable loading or integrity verification fails.

## 7. Cache decision

The process-local result map was removed completely. There is no result cache to evict, poison, restore, or treat as authority. Every authoritative read is therefore a durable read-through, and service recreation or cache lifetime cannot alter correctness. Cache eviction testing is not applicable because the safer allowed design—cache removal—was selected.

## 8. Digest and identity verification

B03 reuses `assertResultDigest`, `assertCandidateDigest`, `mappingDigest`, and the existing canonicalization; no new hash format was introduced.

Verification covers:

- requested durable key versus stable `verificationId`;
- recomputed result digest and ID;
- canonical technical result payload, excluding only the existing non-identity `requestId` and `evaluatedAt` fields;
- context ID and project/design/component/variant scope represented by the existing context/request model;
- request/result policy and candidate identity;
- context/result dependency snapshots and evidence/source revisions represented there;
- normalized candidate ID, digest, scope, and dependency digest when present.

This permits the existing immutable-store replay of the same technical result across a later request timestamp while rejecting payload, digest, ID, scope, policy, candidate, or dependency inconsistency.

Recognized blocking errors include `MV_RESULT_DIGEST_MISMATCH`, `MV_RESULT_ID_MISMATCH`, `MV_RESULT_STORE_ID_MISMATCH`, `MV_RESULT_STORE_INTEGRITY_CONFLICT`, `MV_RESULT_STORE_WRITE_NOT_VISIBLE`, and `MV_RESULT_STORE_UNAVAILABLE`. Underlying store failures are preserved rather than converted to success.

## 9. Failure and fresh-service behavior

- Rejected durable `put`: verification rejects with the original store error; neither the same service nor a fresh service can persist that result.
- Missing post-write row: verification fails `MV_RESULT_STORE_WRITE_NOT_VISIBLE`.
- Post-write envelope mismatch: verification fails `MV_RESULT_STORE_INTEGRITY_CONFLICT`.
- Durable absence after a valid verification: the same service reports the existing not-persistable outcome; no stale memory repair occurs.
- Corrupted payload or digest: recomputation fails before repository mutation, projection, or invalidation.
- Durable read outage: the store error propagates before authoritative mutation.
- Fresh service over the same test store: it loads the persisted row and completes the same permitted persistence operation without any shared map/cache object.
- No configured store: read-only deterministic calculation remains possible for compatibility, but authoritative result-consuming mutation fails `MV_RESULT_STORE_UNAVAILABLE`.

These are in-process adapter/recreation proofs, not live PostgreSQL or operating-system process restart claims.

## 10. Tests added and changed

`app/lib/mapping-verification/__tests__/durable-result-cache.test.ts` adds seven focused cases:

1. failed durable put leaves no same-service or fresh-service authority;
2. post-write durable verification and fresh-service use;
3. post-write scope mismatch blocking;
4. durable absence remains absence in the original service;
5. authoritative reload detects corrupted payload;
6. altered digest blocking and store omission remaining non-authoritative;
7. durable read outage propagation before owner mutation.

`lifecycle-invalidation.test.ts` now supplies a real in-memory durable result store and locally adapts its obsolete B1 helper with the required selection/approval decision evidence. The adaptation performs valid B1 operations; it does not bypass or weaken completed B01 validation.

Existing lifecycle assertions continue to cover status derivation, separate approval, immutable successors, projection semantics, invalidation behavior, scope/actor/revision/digest rejection, concurrency, authoritative dependency revalidation, and idempotent replay.

## 11. Commands and results

| Command or phase | Exit | Result |
|---|---:|---|
| Baseline lifecycle/invalidation | 1 | 7 tests: 5 passed, 2 failed only at obsolete forbidden helper with `PB_DECISION_EVIDENCE_REQUIRED` |
| Baseline focused Stage 6 TypeScript | 0 | passed |
| New fault suite before production repair | 1 | 5 tests, 0 passed; demonstrated all targeted old defects |
| Initial repaired fault suite | 0 | 5/5 passed |
| Final focused mapping service/lifecycle/security suite | 0 | 3 files, 21/21 passed |
| Final complete mapping-verification plus mapping API suite | 0 for the B4 files | 5 files, 36/36 passed |
| Durable owner test filtered to Stage 4 | 0 | 1 passed, 2 unrelated tests skipped |
| Completed B01 + authorized B02 compatibility set | 0 | 9 files, 82/82 passed |
| `pnpm exec tsc --noEmit --pretty false -p tsconfig.footprint-stage6.json` | 0 | focused Stage 6 graph passed |
| `pnpm exec tsc --noEmit --pretty false --incremental false` | 1 | only known frozen-B7 error: `materializer-repository.test.ts(25,420)` rejects unsupported `"fitted"` |
| Task-local no-index `--check` on three files | 1 because files differ | no whitespace findings; all three files are LF-only with zero CR bytes |

An intentionally broader non-gating sweep also reached four unrelated pre-existing fixture failures before B03 code: three in forbidden `performance-resilience.test.ts` and one Stage 3 case in forbidden `stage3-stage5-owners.test.ts`, all `PB_DECISION_EVIDENCE_REQUIRED`. Those files were not edited. The corrected completed-batch compatibility set is the 82/82 passing command above.

No formatter, generator, dependency installation, auto-fix, migration, live database, Git mutation, or repository-wide rewrite command ran.

## 12. Exact task-local changed-file inventory and numstat

| Product/test file | Purpose | + | - | Before SHA-256 | After SHA-256 |
|---|---|---:|---:|---|---|
| `app/lib/mapping-verification/service.ts` | remove memory authority; durable put/get verification; authoritative reload | 40 | 6 | `160ab4f98e109c6631833868c369e91c72dbdff171085534593e15752e5cb76c` | `0e5f47ed7754c6258bbed670de52cfce0a1f1cc7b645b6e23284169446f8e69e` |
| `app/lib/mapping-verification/__tests__/lifecycle-invalidation.test.ts` | real durable store plus valid B01 evidence fixture adaptation | 27 | 2 | `122ef57998fb1ed29f94df39689b03e76540caecdfd1eb45b326b9dfca159d1f` | `60ad483b81b90afae64837518fb69e28fccbebee1ce663c2efca4f2abdcec7d2` |
| `app/lib/mapping-verification/__tests__/durable-result-cache.test.ts` | focused B4 fault, integrity, absence, and recreation tests | 121 | 0 | new | `23a6f8c261f6841ae4010f6c9e9fc3dd1f4e6a7717fd449c6440e8c8f6bfc26a` |
| **Total** | | **188** | **8** | | |

This report is the one separately authorized report file and is not counted as a product/test file.

## 13. Budget use

- Product/test files: **3/3**.
- Product/test churn: **196/400** added plus deleted lines (49%).
- Report files: **1/1**.
- Schema/migration files: **0**.
- B7 files: **0**.
- Unrelated task-local files: **0**.
- The 80% stop-loss threshold was not approached.

## 14. Forbidden paths and concerns

No task-local modification was made to `durable.ts`, `types.ts`, `stage1-projector.ts`, `invalidation.ts`, mapping APIs, physical-binding production, resolver production, PCB-sync production/API, passive policy, durable workflow, assignment queue, PCB components, schema, Drizzle migrations, package files, lockfiles, or environment files.

No historical report was edited. The protected original was not touched. Existing user changes elsewhere in the dirty worktree were preserved.

## 15. Explicit B4-005/B08 deferral

`R02-B4-005` remains open and assigned to R03-B08. B03 did not change mapping approval semantics, Stage 1 projection semantics, outbox ordering, invalidation completion/reconciliation, downstream readiness, or automatic physical-binding approval. Existing projection/invalidation tests were preserved as regressions, not rewritten to claim convergence.

## 16. R04 live PostgreSQL and restart obligations

R04 remains unauthorized until all prerequisite implementation batches complete. It must later qualify the final system against an isolated live PostgreSQL instance, including actual repository/process recreation, interrupted commits, crash-before/after-effect boundaries, concurrent connections, replay/collision behavior, outbox lease/redelivery/terminal recovery, applied schema constraints/migrations, and durable reload. B03's in-memory store and fresh-service tests do not substitute for those obligations.

## 17. Authorization for R03-B04

R03-B03 meets its completion rules within scope and budget. The approved R03A sequence therefore authorizes **R03-B04: YES**.

R04 remains **NO**. Stage 6 may not resume. Stage 7 may not resume. Stop after B03.
