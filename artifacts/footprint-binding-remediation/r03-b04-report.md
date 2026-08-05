# R03-B04 — B5 Revision-Complete Passive Exception Lifecycle

## 1. Verdict

**R03-B04 VERDICT: COMPLETE**

This batch closes the B04-owned portions of `R02-B5-005`, `R02-B5-006`, and `R02-B5-011`. `assign_profile` now has exact pinned semantics; active approved exceptions are revision-complete and scope-bound; and approve, revoke, and supersede create immutable auditable policy successors with the existing durable invalidation intent.

Final tenant-scoped/versioned outbox hardening remains R03-B06. Final effect ordering, completion, and downstream readiness convergence remain R03-B08. Live PostgreSQL qualification remains R04. Stage 6 forwarding remains R03-B10.

## 2. Repository identity and fingerprints

| Field | Value |
|---|---|
| Repository root | `C:/Users/robsa/Documents/Codex/2026-07-13/do/work/sirkit-edit` |
| Protected original | `C:/Users/robsa/sirkit` — not modified |
| Branch | `codex/cd-13-full-flow-orchestrator` |
| HEAD | `2bd1603a775bd4b409b89710cd4e5f8d70201632` |
| Starting status paths | 1,261 |
| Starting normalized fingerprint | `9b323ad8678b0f2d3d5f4bb52725be607fafd5e40f6f6d862afbe4c9ec0b32f7` |
| Product/test-complete status paths | 1,261 |
| Product/test-complete fingerprint | `9b323ad8678b0f2d3d5f4bb52725be607fafd5e40f6f6d862afbe4c9ec0b32f7` |
| Ending status paths, including this report | 1,262 |
| Ending normalized fingerprint | `079f63e38e4dab4c92bedc9f97cb47ce0fadfd2b11352f2420f4e0cb97411689` |

All nine authorized files were already untracked at baseline, so the normalized status fingerprint—which intentionally represents untracked rows as `?? path 0 0`—does not encode their content changes. B04 attribution therefore uses task-local copies, SHA-256 hashes, no-index numstat, and line-ending checks.

Verified prerequisites:

- R03A: `SPLIT_PLAN_READY`.
- R03-B01: `COMPLETE`; report SHA-256 `d1c7685b1830698d5fc867903a8f6582b6cbcae58a7231d4e71763fe7f3d1366`.
- R03-B02: `COMPLETE`; report SHA-256 `f8f5f138f049256c43dcf9b73194f42fa72d5c13e799dbcbfdb9bba8b05cb732`.
- R03-B03: `COMPLETE`; report SHA-256 `6ba588589dfdac4b189e6d07def86731a6c270d85727dbf81e8da5efbd9b7015`.
- R03-B03 authorization: `R03-B04 YES`.
- R03A B04 assignment: exactly `R02-B5-005`, `R02-B5-006`, and `R02-B5-011`.

## 3. Assigned gaps and cross-batch dependency truth

- `R02-B5-005`: accepted `assign_profile` silently fell through to generic rules.
- `R02-B5-006`: exception decisions lacked complete component/context/policy/profile/package/footprint authority pins.
- `R02-B5-011`: component exceptions lacked explicit revoke/supersede lifecycle.

B04 owns the local action semantics, immutable decisions, service lifecycle, replay safety, and creation of the existing invalidation intent. B06 still owns explicit scoped/versioned outbox identity. B08 still owns projection/invalidation ordering, completion barriers, and final readiness reconciliation. B04 does not claim either downstream system is complete.

## 4. Verified pre-repair defects

The pre-repair trace confirmed:

1. `PassiveExceptionAction` included `assign_profile`.
2. Policy validation and `applyApprovedException` accepted it when only `targetProfileId` was present.
3. `DeterministicPassivePolicyEvaluator` handled only `opt_out` and `require_exact_part`, then continued into ordinary rule selection for `assign_profile`.
4. `PassiveComponentException` contained no component snapshot/context/policy/profile/package/footprint revision authority.
5. The approval hash omitted current component facts, context, policy head, exact profile revision/digest, package, footprint, mapping, and expected exception revision.
6. `revoke` and `cloneSuccessor` applied to the whole policy, not an individual exception.
7. `transition` returned any same-scope idempotency replay without comparing the new exception operation/decision payload.
8. The handler cast arbitrary nested `body.exception` directly to the domain type.

The baseline authorized suite had 18/19 passing; its one failure was obsolete B1 fixture debt at `PB_DECISION_EVIDENCE_REQUIRED`. The pre-repair evaluator test also demonstrated that a legacy approved exception could be treated as active without revision-complete authority.

## 5. Final revision-complete action-specific contract

The JSON payload now has explicit exception contract version `sirkit.passive-component-exception.v2`.

Every committed decision contains:

- exception ID, decision ID, monotonic decision revision, predecessor decision ID, and optional superseded-by decision ID;
- component ID and explicit assembly-variant set;
- action and a discriminated selection:
  - `opt_out` / `require_exact_part` require `{ kind: "none" }`;
  - `assign_profile` requires `{ kind: "profile", ... }` with exact profile, package, footprint, and mapping identities;
- tenant, project, branch, component, approved-against policy revision/digest, expected policy record revision, and effective policy revision;
- one authority snapshot per variant: board ID, component snapshot/revision/digest, stable component identity digest, and context dependency digest;
- assembly profile ID/revision/digest;
- actor, reason, evidence references, approval time, mutation digest, approval digest, lifecycle state, and optional expiry.

`assign_profile` additionally pins profile ID/revision/digest; package identity/revision; footprint logical asset/version/content digest; and mapping revision/content/result digests. No nullable profile/package/footprint placeholders are used for actions that select nothing.

## 6. Legacy JSON behavior

The top-level policy JSON/schema remains compatible; no database column or migration was needed. The new exception contract is versioned inside the existing durable JSON payload.

Legacy pending/rejected/revoked data remains readable. A legacy or otherwise incomplete `approved` exception is never upgraded or synthesized. Policy validation emits `PP_EXCEPTION_AUTHORITY_INCOMPLETE`, and evaluation returns `policy_stale` rather than applying or falling through. Stale or expired matching exceptions return `PP_EXCEPTION_STALE_OR_EXPIRED` and also cannot fall through.

Historical durable JSON is not rewritten. Revoke and supersede append new policy records; prior records retain the exact original decision.

## 7. Canonical digest and idempotency identity

The implementation reuses `passivePolicyDigest`, `passivePolicyId`, and the existing canonical JSON normalization.

`approvalDigest` covers the complete decision payload except the digest and derived decision ID themselves. `decisionId` is derived from that approval digest. Policy technical digest therefore covers every complete exception decision and remains deterministic under object-key ordering.

The exception mutation digest covers operation, repository scope, policy/record expectations, idempotency key, reason, complete actor/session/delegation context, and the normalized action-specific decision or lifecycle payload. It intentionally excludes request ID and server clock time so an identical HTTP retry can replay the first durable decision; the first trusted service time remains bound into the immutable approval/audit digest.

On replay, the service requires that the committed successor contain the exact mutation digest. Same scoped key plus identical decision replays. Changed action/component/context/profile/policy/evidence/reason/actor/expected revision conflicts with `PP_IDEMPOTENCY_KEY_REUSE_CONFLICT`. Repository scope prevents cross-project replay.

## 8. Exact `assign_profile` algorithm

For an active complete `assign_profile` exception, evaluation now:

1. validates policy and exception digests/contracts;
2. verifies current tenant/project/branch/component/variant scope;
3. verifies component snapshot, revision, digest, stable identity, context dependency, policy, and assembly authority;
4. locates the exact profile by pinned ID and revision;
5. compares profile digest, package identity/revision, footprint asset/version/content, and mapping revision/content/result digests;
6. validates profile technical, freshness, lifecycle, mapping, assembly, class, technology, numeric-envelope, and forbidden-risk gates;
7. produces the exact pinned profile outcome without entering generic rule selection;
8. attaches decision ID/revision/action/digests/evidence/profile revision to `appliedException`;
9. includes the exception through both policy dependency digest and evaluation result digest.

Missing/stale/mismatched authority returns a blocking `policy_stale`, `profile_unavailable`, or `mapping_unverified` result. It never selects a different generic profile.

## 9. Non-waivable safety behavior

Mandatory class, role, polarity, safety-risk, profile feasibility, mapping, assembly, technology, and physical/electrical eligibility gates run before or within exception selection. Human approval does not bypass them.

The service also constructs the prospective successor policy and evaluates every selected variant before commit. If the approved exception is not the applied decision with the exact expected outcome, commit fails `PP_EXCEPTION_NON_WAIVABLE_GATE_FAILED`. The test suite proves a polarized component cannot obtain an approved package exception and leaves the owner history unchanged.

`opt_out` and `require_exact_part` remain explicit. Unknown action values are rejected by API parsing, policy validation, and service operation checks.

## 10. Approve, revoke, supersede, and immutable history

### Approve

The service reloads current contexts, validates the complete pinned input against the current policy head and exact component/profile authorities, creates decision revision 1, evaluates non-waivable gates, and appends a policy successor with audit action `approve_exception`.

### Revoke

The service requires an active complete decision and exact expected decision revision. It creates a new decision revision with `state: revoked`, links `predecessorDecisionId`, preserves prior history, and appends audit action `revoke_exception`. Revoked decisions are not evaluated.

### Supersede

The service requires an active complete predecessor and exact expected decision revision. It creates a complete new approved exception linked to the predecessor, creates a superseded predecessor successor linked to the new decision, and appends audit action `supersede_exception`. Only the new approved successor is effective.

Identical lifecycle retry returns the original commit without new history. Changed same-key payload conflicts. Stale revision, already inactive, cross-scope, cross-variant, unsupported operation, and owner-commit failure all fail closed. Fault injection proves a failed owner commit leaves both policy history and committed invalidation history unchanged and the predecessor effective.

## 11. Current durable invalidation-intent behavior

Each successful approve, revoke, or supersede supplies exactly the affected component to the existing owner commit. The committed `PassivePolicyInvalidationEvent` contains tenant/project/branch, policy revision transition, assembly variants, affected component, deterministic Stage 2 dependency key, no board mutation, and the existing outbox topic in durable mode.

Focused tests prove one committed affected-component intent per lifecycle change and no duplicate on replay. Production `effectMode: outbox` keeps the intent in the existing owner transaction. No second invalidation system was introduced.

## 12. Explicit B06 and B08 obligations

R03-B06 must still add the final explicit owner aggregate/revision and event type/version contract plus its scoped outbox hardening.

R03-B08 must still add effect dependency/order/completion state, retries/reconciliation, terminal-failure readiness behavior, and converged B2/B3/B4/B5 downstream status. B04 records only the currently supported intent and does not claim delivery or convergence.

## 13. API/security behavior and B09 limitation

The API now exposes bounded operations `approve_exception`, `revoke_exception`, and `supersede_exception`; legacy `edit_exception` uses the same strict approve parser.

Nested payloads are allowlisted and discriminated. Unknown fields, unsupported actions, missing revision/evidence/idempotency data, malformed selection/authority, and forged body actor/context fields reject safely. Actor, tenant, project, and branch continue to come from the current server-side scope adapter rather than the body. Safe error mapping does not expose stack traces or evidence contents.

The existing header-based scope adapter is not a production authentication fix. That trust gap remains R03-B09 and is not overclaimed here.

## 14. Fields R03-B10 must forward from Stage 6

Stage 6 preview must pin and commit must forward unchanged:

- exception contract version, ID, action, component ID, assembly variants, evidence refs, and optional expiry;
- expected policy record revision plus policy ID/current revision/current technical digest;
- tenant/project/branch/component authority;
- for every variant: board ID, component snapshot ID, component revision/digest, stable identity digest, and context dependency digest;
- assembly profile ID/revision/digest;
- for `assign_profile`: exact profile ID/revision/digest, package ID/revision, footprint logical asset/version/content digest, and mapping revision/content/result digests;
- for revoke/supersede: predecessor exception ID, expected decision revision, and lifecycle decision evidence;
- idempotency key and decision reason.

The service supplies trusted actor/session data, decision time, effective policy revision, mutation digest, approval digest, decision ID, and immutable lineage. Current Stage 6 callers omit the pinned authority and therefore fail `PP_EXCEPTION_AUTHORITY_INCOMPLETE`; B04 synthesizes nothing to preserve compatibility.

## 15. Tests and fixture adaptations

The authorized tests now cover:

- exact pinned profile success versus a different generic-rule profile;
- deterministic repeated evaluation and digest binding;
- missing/stale profile, component/context/policy/variant, package/footprint, and legacy authority blocking;
- mandatory safety blocking at evaluation and commit;
- unsupported action and stale exception blocking;
- revision-complete opt-out and conflict behavior;
- approve/revoke/supersede immutable history and explicit audits;
- stale expected decision revision;
- replay without duplicate history/intent and changed-key-payload conflict;
- fresh service over the same in-memory owner repository;
- fresh service over a recreated `DurablePassivePolicyRepository` sharing the same durable workflow store;
- owner commit failure atomicity;
- strict API body parsing, forged body identity rejection, supported operations, and safe stale-revision response.

`lifecycle-preview-invalidation.test.ts` locally replaces only the obsolete B1 ready fixture with real selection/approval carrying `evidence-datasheet`. B1 validation is not bypassed or weakened.

## 16. Commands and results

| Command/phase | Exit | Result |
|---|---:|---|
| Baseline three authorized tests | 1 | 19 tests: 18 passed; one obsolete B1 fixture failure |
| Baseline complete B5 suite | 1 | 25 tests: 22 passed; two pre-existing Stage 2 failures plus the same B1 fixture failure |
| Final three authorized tests | 0 | 3 files, 30/30 passed |
| Final complete B5 suite | 1 | 5 files, 34 passed, 2 pre-existing forbidden Stage 2 failures |
| B5 1,000-component performance test | 0 | 2.375 seconds, below 5-second budget |
| B01 plus authorized B02 compatibility | 0 | 9 files, 82/82 passed |
| B03 mapping/API compatibility | 0 | 5 files, 36/36 passed |
| Durable owner compatibility filter | 1 | Stage 4 passed; legacy incomplete B5 fixture now intentionally fails `PP_EXCEPTION_AUTHORITY_INCOMPLETE`; Stage 3 skipped |
| New authorized durable-owner recreation test | 0 | included in 30/30 focused result |
| `pnpm exec tsc --noEmit --pretty false -p tsconfig.footprint-stage6.json` | 0 | focused Stage 6 graph compiles without B7 edits |
| `pnpm exec tsc --noEmit --pretty false --incremental false` | 1 | only known frozen-B7 `materializer-repository.test.ts(25,420)` unsupported `"fitted"` error |
| Task-local no-index `--check` | 1 because files differ | no whitespace findings on all nine files |

The two complete-suite Stage 2 failures were present before B04: rank-6 integration expected `resolved` but received `blocked_invalid`, and the unadapted forbidden fixture lacks B1 decision evidence. The forbidden durable-owner test still constructs the old incomplete exception shape; its fail-closed result is the intentional contract debt that B10-era fixtures/callers must update. The authorized durable repository test proves the new complete contract reloads correctly.

No formatter, generator, dependency installation, migration, live database, Git mutation, or repository-wide auto-fix command ran.

## 17. Exact task-local changed-file inventory and numstat

| File | Main change | + | - | Before SHA-256 | After SHA-256 |
|---|---|---:|---:|---|---|
| `app/lib/passive-policy/types.ts` | versioned authority/selection/decision/lifecycle/API result contract | 81 | 3 | `9626a20a543d19ec3dd807229c8a079eac6e2a4838458da86c13228803210c97` | `917949e9e68bc0227eab4654026fb85313c8e4e01617cf7cfa18e4c4ca9fc183` |
| `app/lib/passive-policy/policy.ts` | canonical decision integrity, context digest, complete/legacy validation | 43 | 3 | `f6e1458e7e8185d8ff3d409b3f275b2fe355b6b7c93a1023d353bc748241ae08` | `90d2898fe0f234c5520043003e458b9f80185403dfb0865bec70af1ef3f3c9ff` |
| `app/lib/passive-policy/evaluator.ts` | exact assign-profile branch, authority/safety/stale blocking | 48 | 17 | `a9b8d172859aa8658bac21a3f4d530deb8bda8673dd55fee4c7acf64b5f203ae` | `3db5be5263b560ebc9f6008f78a6aeea6933cdf04e8e2f3d2b43ce3ac7f9d417` |
| `app/lib/passive-policy/service.ts` | current-authority approval, immutable lifecycle, replay and intent safety | 109 | 5 | `6e8b8f22b67ad5825cf8c9a2b25c7c60d5f836268bcd9478d512d86810edec3d` | `9805459912191c3a67bbbdee6b7c70e28a2268196e2a4f5bbab9ba1eb4731c34` |
| `app/api/passive-policy/handler.ts` | bounded discriminated approve/revoke/supersede parsing | 31 | 4 | `41a63469d7beb4919eeebf17217115ac36acd52b7a594fc32c1eedde55397956` | `40ea1fc886f144c22c93fe901aa0bbb99c1e92db0061858e9f788ae512793c53` |
| `app/api/passive-policy/route.ts` | lifecycle capability and contract version disclosure | 2 | 2 | `7e363d22f16b767c136f65ad5a44d5bc704ffd00e8838be7859cea86416a2f9b` | `0749254ebcd1663480f314a7268b90e2c009be834a0cf60221fc6c0f4c892ad7` |
| `identity-value-evaluator.test.ts` | exact/stale/legacy/safety/determinism evaluator coverage | 50 | 8 | `5a41c205e012fbbcac78a51ab1e3327519df72a64028dfc099d08297499d3e2c` | `adc749ea66484916f67fd52519a713b132354a4126af9b5af91a5ce25454dbf4` |
| `lifecycle-preview-invalidation.test.ts` | B1 fixture adaptation and complete lifecycle/durability/atomicity coverage | 117 | 4 | `421fa8dfa0d9d217511937046439b3c0506b88835704b0f58a55ddeeb5d41b7c` | `325d3d2d74a97dbc5a8b5307d85e4542b247d4624efd9c9099d2770eee4415eb` |
| `route-security.test.ts` | bounded operations, forgery, unsupported and stale API cases | 32 | 1 | `b1b7737a0904b96d99cd168128d5e6f15a753f7639a14955ea1a3fc28295ecd5` | `4757b878f2762e8dc0fc480c1eab652e10234e7081b275f20db846d8d142fafa` |
| **Total** | | **513** | **47** | | |

All nine files remain LF-only with zero CR bytes. No whole-file rewrite, generated artifact, line-ending conversion, or unrelated formatting churn occurred.

## 18. Budget use

- Product/test files: **9/9**.
- Product/test churn: **560/1,200** added plus deleted lines (46.7%).
- Reports: **1/1**.
- Schema/migrations: **0**.
- B7 files: **0**.
- Unrelated task-local files: **0**.
- The 80% stop-loss threshold was not approached.

## 19. Forbidden-path confirmation

No task-local change was made to passive-policy durable persistence, invalidation target, Stage 2 adapter, physical binding, resolver, PCB sync, mapping verification, durable workflow, assignment queue, PCB components, schema, Drizzle, package files, lockfiles, environment files, or historical reports.

The protected original was untouched. Existing user changes in the dirty worktree were preserved.

## 20. R04 live PostgreSQL/restart obligations

R04 remains unauthorized until the remaining implementation batches complete. It must later run isolated live PostgreSQL qualification for process/repository recreation, interrupted owner commits, duplicate/concurrent idempotency, outbox commit/lease/delivery/redelivery/terminal failure, applied migration/schema state, and durable policy/exception/audit/invalidation reload. B04's in-memory workflow adapter recreation is not live-process/PostgreSQL proof.

## 21. Authorization for R03-B05

All three B04-owned defects are repaired inside the nine-file/1,200-line boundary. R03-B05 is therefore **AUTHORIZED: YES** under the approved R03A sequence.

R03-B06, R03-B08, B09, B10, and R04 remain outstanding as described. R04 is not authorized. Stage 6 and Stage 7 may not resume. Stop after B04.
