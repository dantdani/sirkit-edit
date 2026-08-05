# R03-B01 B1 Decision Evidence and Repository Integrity Report

Date: 2026-07-19
Verdict: **COMPLETE**

## 1. Scope and repository identity

R03-B01 closed exactly `R02-B1-004`, `R02-B1-006`, and `R02-B1-010`. The verified R03A plan said `SPLIT_PLAN_READY`, assigned those three gap IDs to `R03-B01`, and listed no dependencies. No B02, R04, Stage 6, Stage 7, authentication, schema, migration, resolver, PCB-sync, mapping, passive-policy, or shared-workflow work was performed.

| Field | Value |
|---|---|
| Repository | `C:/Users/robsa/Documents/Codex/2026-07-13/do/work/sirkit-edit` |
| Protected original | `C:/Users/robsa/sirkit` (not active; not modified) |
| Branch | `codex/cd-13-full-flow-orchestrator` |
| HEAD | `2bd1603a775bd4b409b89710cd4e5f8d70201632` |
| Starting changed paths | 1,256 |
| Starting normalized status fingerprint | `b874a0b77c117f87390f5e2e4a19c58b2f6f3afa6f2ef37cf3e9ea1da02c1b55` |
| Starting task-local copy | `C:/Users/robsa/AppData/Local/Temp/sirkit-r03-b01-baseline-20260719` |
| Starting task-local manifest digest | `9d239eb461e586d5e73ed0aaed4b027b1fc1eb86c3edcaa93703fff79cc3a5d3` |
| Ending changed paths | 1,258 (the new contract test and this report are the only new paths) |
| Ending normalized status fingerprint | `bcba4d7a4ebc6dc0732ee916ce41c476236e37619810046960f6fdc55cfc5d8a` |

The eight pre-existing allowed files were copied before editing and hashed individually. The ninth allowed test did not exist. Task-local no-index diffs below compare those copies to the final files, avoiding attribution of the large cumulative uncommitted tree to this batch.

## 2. Verified defects

### R02-B1-004

`PhysicalBindingTransitionRequest` had actor, reason, time, expected revision, and idempotency but no decision-evidence field. `applyPhysicalBindingTransition` selected and approved without evidence. Approval output and `PhysicalBindingAuditEvent` therefore could not identify the evidence used by the decision.

### R02-B1-006

`PhysicalBindingService.transition` returned any current audit with the same key without comparing the request. `InMemoryPhysicalBindingRepository` compared only the set ID. `PostgresPhysicalBindingRepository.commit` queried tenant/project/branch/key and returned the requested set without comparing aggregate ownership or canonical request identity.

### R02-B1-010

PostgreSQL used four unchecked `onConflictDoNothing()` calls for binding revisions, audit events, migration records, and readiness assessments. The set head was updated before audit/migration/assessment collisions were examined. A mismatched immutable row could therefore be ignored while the head advanced.

## 3. Decision-evidence contract

- `decisionEvidenceRefs` narrowly extends transition, approval, and audit JSON contracts while remaining TypeScript-optional for frozen historical/B7 callers.
- Runtime semantics are fail-closed: `select` and `approve` require at least one reference. No other action gained an evidence requirement.
- References are NFC-normalized, bounded to 64 entries and 512 characters per ID, validated against the existing B1 identifier grammar, deduplicated, and sorted canonically.
- Every reference must already be present in the binding's authoritative evidence snapshot. An unknown/tampered or cross-binding reference fails with `PB_DECISION_EVIDENCE_NOT_FOUND`; no candidate order, AI explanation, ranking, URL, or default is promoted into evidence.
- The canonical transition request digest includes every request field and normalized decision evidence. Changing evidence, action, target, expected revision, actor, reason, or time changes the digest.
- Approval successors persist exact normalized evidence in `approval.decisionEvidenceRefs`; their record digest is evidence-bound. Selection and approval audit events persist the same exact references and their event digest is evidence-bound.
- Persisted approved bindings are revalidated: missing, malformed, duplicated, noncanonical, over-limit, or snapshot-mismatched decision evidence is reported as a B1 validation issue.
- B1 has stable evidence-reference IDs and a binding evidence snapshot, but no independent evidence-revocation registry. This batch therefore proves structural identity and attachment to the exact binding snapshot; it does not claim external evidence availability or PostgreSQL restart proof. Those are qualification obligations, not synthesized authority.

## 4. Idempotency ownership and request identity

The ownership tuple is:

```text
trusted tenantId + projectId + branchId + aggregate binding-set setId
```

The replay identity is that owner plus the canonical full logical-request digest. The PostgreSQL uniqueness scope remains tenant/project/branch/key; no schema or global namespace was invented.

- Same scoped key + same set + same canonical request returns the prior committed state.
- Canonically equivalent evidence order/duplicates reproduce the same digest and replay.
- Same scoped key + different set/component throws `PB_IDEMPOTENCY_SCOPE_CONFLICT`.
- Same owner/key + different request throws `PB_IDEMPOTENCY_REQUEST_CONFLICT`.
- A key in another project remains isolated and can be used independently.
- The in-memory adapter now uses the same trusted project scope rather than imposing accidental global uniqueness.
- Precheck replay verifies the complete stored audit row against the intended audit row, so a tampered actor, reason, evidence set, digest, or payload cannot be hidden by an otherwise matching key.
- If concurrent transactions race, an optimistic-lock loser re-reads the winning audit. It replays only after the same owner/request and exact audit equivalence checks; otherwise the loser returns the explicit conflict.

## 5. Immutable collision and transaction order

All four insert-only row families now use insert-then-load-and-compare semantics inside the existing Drizzle transaction. Complete intended and stored rows are canonicalized (including timestamps) and compared. Exact equivalence continues; any difference throws one of:

```text
PB_IMMUTABLE_BINDING_CONFLICT
PB_IMMUTABLE_AUDIT_CONFLICT
PB_IMMUTABLE_MIGRATION_CONFLICT
PB_IMMUTABLE_ASSESSMENT_CONFLICT
```

No row is overwritten and no conflicting row content is placed in an error.

Final transaction order:

1. Scoped replay lookup and owner/request/audit equivalence check.
2. Begin the existing PostgreSQL transaction.
3. Read and verify the expected set-head revision.
4. Insert-or-verify all immutable binding revisions.
5. Insert-or-verify all immutable audit events.
6. Insert-or-verify migration records, when present.
7. Insert-or-verify readiness assessments, when present.
8. Publish/update the current set head last with compare-and-swap.
9. On an optimistic-lock race only, re-read and strictly verify the winner before replay.
10. Reload the committed aggregate.

A mismatch at steps 4-7 throws before step 8. The database transaction rolls back earlier inserts, so no later row or head remains. A transaction-capable rollback test double proves this for every family. This is not claimed as live PostgreSQL crash/restart qualification; R04 owns that evidence.

## 6. Exact changed-file inventory

| File | Gaps | Main symbols/hunks | + | - | Coverage |
|---|---|---|---:|---:|---|
| `app/lib/physical-binding/types.ts` | 004, 006 | decision evidence, aggregate owner and request digest JSON fields | 9 | 0 | transition/state tests |
| `app/lib/physical-binding/transitions.ts` | 004 | normalization, validation, request digest, evidence-bound approval | 41 | 1 | readiness transitions |
| `app/lib/physical-binding/validation.ts` | 004 | persisted approval evidence integrity | 12 | 1 | state conflict contract |
| `app/lib/physical-binding/stable.ts` | 004 | canonical set treatment for decision evidence | 1 | 1 | digest/order tests |
| `app/lib/physical-binding/repository.ts` | 004, 006 | commit request digest, strict replay, audited evidence, scoped memory replay | 46 | 13 | retry/concurrency/owner tests |
| `app/lib/physical-binding/server-repository.ts` | 006, 010 | strict replay precheck, four insert-or-verify paths, head-last ordering, race replay | 109 | 28 | server repository contract |
| `app/lib/physical-binding/__tests__/readiness-transitions.test.ts` | 004, 006 | evidence, digest, owner, isolation and retry regressions | 69 | 8 | 9 tests total |
| `app/lib/physical-binding/__tests__/state-conflict-contract.test.ts` | 004 | persisted missing/tampered evidence validation | 14 | 0 | 6 tests total |
| `app/lib/physical-binding/__tests__/server-repository-contract.test.ts` | 006, 010 | transaction-capable fake; exact/mismatched rows; concurrent replay/conflict; rollback | 195 | 0 | 8 tests |
| **Total** | | | **496** | **52** | **548/1000 churn** |

No whole-file rewrite, generated output, formatting churn, or line-ending conversion occurred. Every changed source/test file remains LF-only. Task-local `git diff --no-index --check` passed.

Task-local SHA-256 attribution:

| File | Before | After |
|---|---|---|
| `types.ts` | `0439e062464f4afd17a9cb9a8ac823a0da55281d462e5eed6b9d3ddaaa0c956c` | `32f9955d754c4b2bb984ff9ce8fc0ff225e1f9f53f750ad2c14a7fed0dc7c05d` |
| `transitions.ts` | `09704651de122936253bd2b5499de3c642004ac59566ea4f93a73c1b3f1a95b2` | `e350813eb8a9dde4e33c8753059f669d1fe1dca8ca961234415737627bb56c98` |
| `validation.ts` | `f3c39434816c4dca65e4bcc847277c9aac3780ce28375fad30a375434a4909bc` | `cca897233fddf7b00d2902b52b924a26b1e6b9357150abc071ed2cd87e51a17c` |
| `stable.ts` | `cb06cca0831177d4c5b9488d9ef1f63347b6461529d7264bfffba397293b4583` | `6d57e97a1f7d307dd5a439aab6de7c3a444d61feec780049e4e390b9b1b831cd` |
| `repository.ts` | `43869a9dbab4e3e695ea700e3e5273fe79546fa7b30ce256429e7fa21661b4eb` | `621c161d67bbbb117b91fd0354a694375a915b202d1e54ebbfcb7a40797d95a1` |
| `server-repository.ts` | `8489d349462e3b37abae55c9cff974dfbefee5873d7f3281a6f47f60015eb514` | `a802915a78c24464cf36573f1e3f5304b39ec2e9e5c57f39846580fca527e22f` |
| `readiness-transitions.test.ts` | `d5a9ee18099ceb6f370eed591e770a90c626b3194c213594446b84f4f5929be2` | `054ad6db48c93627bc5f6a7f22d976513904b2cf215fbb94fb9f11e83b4e02bd` |
| `state-conflict-contract.test.ts` | `14f0099091f8b17d572ae4837c25b47f63faf00490688872da26db7aa1cc6315` | `c2373d74ee105ef3f6ce761eb32f4457d5fc965dbdc1aa94ae3118d2713d444f` |
| `server-repository-contract.test.ts` | absent | `49b58a1990952f0c9b5034f1b7e1d81d9a79ffdb4cc1a8c199f8345f3585ae62` |

## 7. Verification results

| Command | Exit | Result |
|---|---:|---|
| `pnpm exec vitest run app/lib/physical-binding` before repair | 0 | 5 files, 25/25 tests passed; established baseline |
| `pnpm exec vitest run app/lib/physical-binding/__tests__/server-repository-contract.test.ts` | 0 | 1 file, 8/8 tests passed |
| `pnpm exec vitest run app/lib/physical-binding` final | 0 | 6 files, 36/36 tests passed |
| `pnpm exec tsc --noEmit --pretty false -p tsconfig.footprint-stage6.json` | 0 | frozen Stage 6/B7 compile graph passed without B7 edits |
| `pnpm exec tsc --noEmit --pretty false --incremental false` | 2 | only pre-existing frozen B7 test error: `materializer-repository.test.ts(25,420)` uses unsupported `"fitted"`; no R03-B01 error |
| task-local `git diff --no-index --check` | 0 | passed for all nine product/test paths |

One additional diagnostic suite covered physical binding plus frozen resolver/mapping/assignment consumers: 17 files and 108 tests, with 86 passing and 22 failing. Every failure was the intentional `PB_DECISION_EVIDENCE_REQUIRED` fail-closed result from out-of-scope legacy test fixtures/B7 callers that still omit pinned decision evidence. The prompt explicitly forbids editing or relaxing those callers in B01. This is compile-compatible but runtime-blocked compatibility debt for R03-B10; Stage 6 remains unqualified and must not be treated as authoritative.

## 8. Negative assertions and boundaries

- Missing evidence is never defaulted: **PASS**.
- Candidate/ranking/AI suggestion cannot become decision evidence: **PASS**.
- AI approval remains unauthorized: **PASS**.
- A duplicate key cannot suppress another component operation: **PASS**.
- Another project/tenant result is not returned or exposed: **PASS**.
- `onConflictDoNothing` cannot conceal mismatched immutable content: **PASS**.
- A collision cannot advance the head or retain later rows: **PASS** in the transaction-capable harness.
- Replay creates no duplicate audit/history/head update: **PASS**.
- Schema/migrations changed: **NO**.
- B7/Stage 6 files changed: **NO**.
- Stage 7 files changed: **NO**.
- Authentication/platform decisions made: **NO**.
- Protected original changed: **NO**.

## 9. Remaining obligations and authorization

R03-B01 is complete within 9/9 product/test files, 548/1000 churn, and one report. R03-B02 is authorized by the approved split plan. R04 remains unauthorized until the implementation batches that precede it are complete; it must later run real PostgreSQL restart, crash, concurrent-connection, constraint, and migration qualification. Stage 6 may not resume until B10 supplies pinned decision evidence and the later release gates authorize it. Stage 7 remains prohibited.

```text
R03-B01 VERDICT: COMPLETE
GAPS ASSIGNED: R02-B1-004, R02-B1-006, R02-B1-010
GAPS CLOSED: R02-B1-004, R02-B1-006, R02-B1-010
PRODUCT/TEST FILES CHANGED: 9/9
DIFF CHURN: +496 / -52 (548/1000)
DECISION EVIDENCE: PASS
IDEMPOTENCY OWNER/DIGEST: PASS
IMMUTABLE COLLISION ROLLBACK: PASS
FOCUSED TESTS: PASS
FOCUSED TYPE CHECK: PASS
FROZEN B7 FILES CHANGED: NO
SCHEMA/MIGRATIONS CHANGED: NO
UNRELATED FILES CHANGED: NO
R03-B02 AUTHORIZED: YES
R04 AUTHORIZED: NO
STAGE 6 MAY RESUME: NO
STAGE 7 MAY RESUME: NO
REPORT: artifacts/footprint-binding-remediation/r03-b01-report.md
```
