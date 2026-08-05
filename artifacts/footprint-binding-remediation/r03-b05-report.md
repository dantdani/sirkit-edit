# R03-B05 — B2 Production Passive-Policy Composition and Unified Variant Contract

Date: 2026-07-19

## 1. Verdict

**R03-B05 VERDICT: COMPLETE**

R03-B05 closes `R02-B2-006` and `R02-B2-X01` inside the exact ten-file product/test boundary and the 1,200-line stop-loss. Production single, batch, and Stage 3 resolution now converge on one canonical source composition. That composition reads the durable B1 physical-binding authority and the durable B5 passive-policy context/policy authority, while B4 mapping certificates and footprint-library materialization revisions remain revision-bound inputs embedded in B1/B5 binding records. No resolver path writes any of those authorities.

The resolver now treats an explicit empty assembly-variant list as global everywhere B05 is authorized to repair, while missing or malformed scope remains invalid. A real B5 policy revision or B04 exception lifecycle change now changes the resolver dependency/decision identity and causes B02's unchanged rebuilt-plan comparison to reject the old plan without publishing a board.

B06 outbox scoping/versioning, B08 effect convergence, B09 trusted human authentication, B10 Stage 6 caller/fixture compatibility, and R04 live PostgreSQL/crash qualification remain outstanding.

## 2. Repository identity and fingerprints

| Field | Value |
|---|---|
| Repository root | `C:/Users/robsa/Documents/Codex/2026-07-13/do/work/sirkit-edit` |
| Protected original | `C:/Users/robsa/sirkit` — not active and not modified |
| Branch | `codex/cd-13-full-flow-orchestrator` |
| HEAD | `2bd1603a775bd4b409b89710cd4e5f8d70201632` |
| Starting status paths | 1,262 |
| B04-reported ending fingerprint | `079f63e38e4dab4c92bedc9f97cb47ce0fadfd2b11352f2420f4e0cb97411689` |
| B05-local starting fingerprint | `72b57f5a00c5b2dfa46bebf94175e17e365b4b2c8bf4c3834b4f9c4e22950fc8` |
| Product/test-complete status paths | 1,263 |
| Product/test-complete B05-local fingerprint | `4e7f23513fe2c863b5e90fd514856e6b52ba0095cd0c16e5f9bc34caabe882fb` |
| Ending status paths, including this report | 1,264 |
| Ending B05-local fingerprint | `a7431bf5419184a8a0ed0124ebc9370be906eb526da99fbc20e0808b452e1e5e` |

The B05-local fingerprint is SHA-256 over LF-joined, case-sensitive sorted rows of `status path added deleted`; untracked rows are `?? path 0 0`. The B04 report hash and its 1,262-path ending state matched the current prerequisite boundary. Because all authorized implementation paths were already untracked except the newly created `variant-scope.ts`, task attribution uses the required task-local copies, SHA-256 hashes, and no-index numstat rather than aggregate Git diff alone.

Task-local baseline directory:

`C:/Users/robsa/AppData/Local/Temp/sirkit-r03-b05-baseline-20260719-01`

## 3. Assigned gaps and B04 dependency proof

Assigned exactly:

- `R02-B2-006`: production resolver omitted the real durable B5 passive-policy input.
- `R02-B2-X01`: empty/global assembly-variant semantics contradicted each other across resolver validation and B4 projection.

Prerequisites verified:

- R03A verdict: `SPLIT_PLAN_READY`.
- R03-B01 report: `COMPLETE`, SHA-256 `d1c7685b1830698d5fc867903a8f6582b6cbcae58a7231d4e71763fe7f3d1366`.
- R03-B02 report: `COMPLETE`, SHA-256 `f8f5f138f049256c43dcf9b73194f42fa72d5c13e799dbcbfdb9bba8b05cb732`.
- R03-B03 report: `COMPLETE`, SHA-256 `6ba588589dfdac4b189e6d07def86731a6c270d85727dbf81e8da5efbd9b7015`.
- R03-B04 report: `COMPLETE`, SHA-256 `b5c4a53d7a103b2aedda701c72d16613fe296356a8165e8f65ab4c4ddca100fc`.
- R03-B04 explicitly authorized R03-B05.
- R03A assigns only `R02-B2-006` and `R02-B2-X01` to B05 and makes B05 depend on B04.

No prerequisite drift was found.

## 4. Verified pre-repair defects

Production construction was partial:

- `app/api/pcb-sync/route.ts` constructed `FootprintResolutionService` with only `PostgresPhysicalBindingRepository`.
- the default source list installed `DisabledCandidateSource("passive_policy", ...)`;
- the default service option set `allowStage5PassivePolicy` false;
- the real `PassivePolicyCandidateSource` appeared only in focused tests;
- production Stage 3 therefore could not expose policy, context, profile, component fact, or exception revisions to B3's rebuilt-plan digest comparison.

Variant applicability was contradictory:

- both physical-binding repositories and the resolver engine treated `assemblyVariantIds: []` as global;
- `validateResolutionContext` unconditionally required `.includes(requestedVariant)` and rejected the same global set;
- `PhysicalBindingMappingProjector.project` repeated that contradictory `.includes()` check.

Baseline focused policy/E2E verification had 8/13 passing. Its five failures were pre-existing B01 fixture debt: the authorized E2E file called a shared helper that attempted `select`/`approve` without the now-required decision evidence. The baseline full resolver-plus-Stage-2 sample had 24/42 passing, with the same fixture debt plus the known rank-6 B5 integration failure.

## 5. Final production resolver composition map

`productionFootprintCandidateSources` is the single source factory. It supplies, in deterministic source-kind order:

1. selected B1 binding;
2. approved exact-part binding;
3. explicit component assignment;
4. symbol-attached fact;
5. normalized package/B4 mapping input;
6. legacy suggestion;
7. human suggestion;
8. AI catalog suggestion;
9. real `PassivePolicyCandidateSource` backed by `DurablePassivePolicyContextStore(getDurableWorkflowRepository())`;
10. the still-disabled and explicitly deferred Stage 10 generated-overlay source.

The composition is versioned as `sirkit.footprint-source-composition/2.1.0`.

Consumption paths:

- the standalone resolver API's existing default `FootprintResolutionService` construction receives the canonical default source set;
- `resolve`, `explain`, and `resolveBatch` all use the same service context assembly, normalization, precedence, and digest logic;
- Stage 3 now explicitly calls `createProductionFootprintResolutionService` instead of manually constructing a partial resolver;
- the existing assignment-queue runtime also receives the same default composition, but Stage 6 compatibility remains B10 and was not modified.

No duplicate resolver, route-local resolver, fake mapping authority, or new persistence/cache authority was added.

## 6. Authority, precedence, and read-only contract

The composition preserves the existing policy precedence:

1. effective selected B1 authority;
2. approved exact-part authority;
3. explicit approved component assignment;
4. approved symbol fact;
5. approved package/B4 mapping authority;
6. approved project passive-policy candidate;
7. suggestion-only sources.

An effective selected B1 revision short-circuits B5 collection with `PP_STAGE1_SELECTION_PRECEDENCE`. An exact B1 resolution test proves `selected_stage1` wins and the passive source returns `empty`.

B4 and library authority do not require a second repository in the resolver: the durable B1 row already carries exact mapping certificate/revision/content/dependency/result fields and footprint asset version/content/source revisions. B5 profiles carry the equivalent exact package, footprint, and mapping pins. Those records and their digests enter the normal resolver candidate and context digests.

Resolution calls only repository/context `find`/`get` operations. The ephemeral B5-shaped binding is never committed to B1. It is an in-memory normalized candidate carrying policy approval evidence, not an automatic B1 selection/approval transaction. No binding, mapping, policy, library, PCB, invalidation, outbox, or cache write occurs.

## 7. B5 adapter and revision-complete B04 exception behavior

The Stage 2 adapter is now version `sirkit.passive-policy-stage2-adapter/1.1.0` and consumes the existing B04 evaluator output rather than reimplementing exception or safety decisions.

Its dependency set covers:

- policy ID, revision number, revision ID, technical digest, rule-language version, and evaluator version;
- complete passive context dependency snapshot;
- component snapshot ID, component revision ID, and component dependency digest;
- assembly-profile ID, revision ID, and dependency digest;
- selected profile ID/revision/digest;
- exact package revision;
- exact footprint asset revision/content digest;
- exact B4 mapping revision/content/result digests;
- B04 applied exception decision ID/revision/action, approval digest, mutation digest, evidence, and the complete exception authority record through one aggregate authority digest;
- evaluator result digest and final virtual binding record digest.

The virtual approval now includes explicit B01 decision-evidence refs drawn from the published policy/profile/exception/result evidence. This repairs the pre-existing rank-6 `PB_DECISION_EVIDENCE_REQUIRED` rejection without weakening B01 validation.

Policy publication time, not resolver request time, timestamps the virtual authority record. Therefore request ID/time changes that do not cross an expiry boundary leave candidate, dependency, and decision digests unchanged. Exception expiry and other evaluator-relevant time changes still change the result.

An active complete `assign_profile` exception is traceable through resolution evidence and dependency refs. Revocation changes both dependency and decision digests. Incomplete legacy approved exceptions produce `PP_STAGE2_POLICY_STALE`, no ready binding, and no fallback to generic package guessing. B04's evaluator continues to enforce non-waivable safety and exact pinned profile/package/footprint/mapping authority.

## 8. Dependency, decision, and cache identity

The resolver context identity now includes:

- every B1 binding-set and binding record digest;
- B4 mapping and library pins already covered by those record digests;
- source-composition version;
- variant-contract version and normalized variant scopes;
- resolver policy schema/cache behavior/version;
- expected component and binding-set revisions;
- each enabled source version/status/candidate record digest/dependency list;
- the complete B5 dependency set listed above;
- the requested assembly variant.

Identical authority inputs remain deterministic. Request ID, actor context, trace level, and unrelated timestamps are excluded from the technical context digest. A policy revision or B04 exception lifecycle change modifies the context dependency, batch dependency, resolved-binding dependency, and decision digest.

The resolver cache remains explicitly disabled (`no-cache/1`). No cache or unsafe reuse path was introduced.

## 9. B02 stale-plan integration proof

The authorized E2E suite invokes the real B3 interfaces without editing B3 implementation/tests:

1. build a Stage 3 preflight through `PcbSynchronizationService` and the canonical production resolver;
2. obtain a ready exact plan from B5 policy revision N;
3. replace the authoritative context with policy revision N+1;
4. call B02 apply revalidation;
5. observe `blocked_stale`, blocker `PS_PLAN_STALE`, `boardChanged: false`, and no board record.

A second real Stage 3 scenario preflights with an active revision-complete B04 exception, revokes that decision in the authoritative policy successor, and proves the old plan is rejected identically with no board publication.

Unchanged B5 authority is also resolved twice with different request IDs/times and produces identical dependency and decision digests. No B3 implementation file changed. This closes B05 input visibility and deterministic stale comparison only; it does not claim B06/B08 delivery convergence.

## 10. Unified assembly-variant semantics and consumers

`variant-scope.ts` defines version `sirkit.assembly-variant-scope/1.0.0`:

- explicit `[]` means global/all requested variants;
- a nonempty list applies only to an exact member;
- missing/undefined scope is invalid, never global;
- a missing/invalid requested variant is invalid;
- malformed IDs and over-limit lists are invalid;
- duplicates are removed and values are sorted deterministically;
- order does not change normalized meaning or digest.

Consumers repaired within the exact B05 boundary:

- resolver context validation accepts global B1 sets and rejects malformed scopes precisely;
- resolver variant digest uses normalized scope plus the contract version;
- B5 adapter validates policy applicability through the shared inspector where the B5 schema permits it;
- B4 Stage 1 projector accepts global/exact/multi scopes and rejects malformed/nonmatching scopes.

The B1 repositories and the existing resolver engine were inspected and already implement the required empty/global and exact-member behavior; both paths were forbidden or unnecessary to edit. Existing B5 top-level policies and B04 component exceptions require explicit nonempty scopes by their owning schemas, so missing/empty values remain invalid there. Empty B5 rule-matcher scope remains the existing global rule meaning.

Tests cover global, exact, nonmatching, multi, duplicate/order, missing request, missing authority, malformed authority, resolver/projector agreement, and identity preservation for a global binding across two requested variants.

## 11. Stage 3 route behavior

`app/api/pcb-sync/route.ts` now exports `stage3FootprintResolver` from the canonical factory. Its GET capability response exposes only safe composition facts:

- composition version;
- passive policy is durable/read-only;
- generated overlay is disabled;
- cache is disabled;
- resolver does not mutate binding, policy, or PCB state.

Authentication architecture, feature gate, bounded request handling, error mapping, snapshot ownership, board resource provider, repository, telemetry, and apply behavior are unchanged. Seven existing route tests pass.

## 12. Missing-source and failure behavior

- Stage 5 must be requested explicitly by policy version.
- Custom/qualification source sets must explicitly set `allowStage5PassivePolicy`; they are not silently promoted.
- A Stage 5 policy request without a real passive source fails `FR_STAGE5_PASSIVE_POLICY_SOURCE_UNAVAILABLE`.
- A required durable B5 context/policy load failure returns source status `unavailable` and blocker `PP_STAGE2_AUTHORITY_UNAVAILABLE`.
- Missing B5 authority never selects `0603`, a first candidate, or any hidden package default.
- A selected B1 binding prevents an irrelevant B5 context load and preserves non-passive behavior.
- Cancellation remains cancellation rather than being mislabeled unavailable.
- B5 evaluator blockers become exact resolver blockers through error diagnostics; stale/incomplete authority cannot disappear as an informational empty result.

## 13. Tests added/changed and fixture adaptations

Only the two authorized resolver test files changed.

`policy-request.test.ts` adds:

- production composition/source-version/no-disabled-hook assertions;
- scope normalization/global/exact/multi/duplicate/malformed/missing cases;
- actual B4 projector global/exact/nonmatching consumer behavior.

`resolution-e2e.test.ts` adds/adapts:

- local B01-complete decision fixtures without changing the shared forbidden fixture;
- canonical single/batch B5 resolution;
- missing durable B5 fail-closed behavior;
- deterministic unchanged authority and policy-revision invalidation;
- complete B04 exception trace and revocation dependency changes;
- incomplete legacy exception blocking;
- exact B1 precedence;
- global and multi-variant resolver behavior;
- actual B3 stale-plan rejection for both policy revision and exception revocation.

The previously failing rank-6 test now passes. One non-authorized Stage 2 test still fails before reaching its assertion because the shared forbidden resolver fixture omits B01 decision evidence. Eleven other non-authorized resolver tests fail for the identical reason. B05 did not edit that shared fixture because it is outside the exact path boundary; focused B05 fixtures use the real complete B01 contract.

## 14. Commands and results

| Command/family | Exit | Result |
|---|---:|---|
| Baseline authorized policy + E2E | 1 | 8 passed, 5 pre-existing B01 fixture failures |
| Baseline resolver + Stage 2 sample | 1 | 24 passed, 18 failed: shared B01 fixture debt plus rank-6 failure |
| Final authorized policy + E2E | 0 | 2 files, 25/25 passed |
| Complete footprint-resolver suite | 1 | 39 passed, 11 shared B01 fixture failures; no new B05 failure |
| Complete passive-policy suite | 1 | 31 passed, 1 shared B01 fixture failure; rank-6 case passes |
| B04 evaluator/lifecycle | 0 | 26/26 passed |
| B03 mapping lifecycle/corpus | 0 | 19/19 passed |
| B02 current-authority/preflight-apply | 0 | 20/20 passed |
| Existing PCB-sync API route | 0 | 7/7 passed |
| Complete B1 physical-binding suite | 0 | 36/36 passed |
| `pnpm exec tsc --noEmit --pretty false -p tsconfig.footprint-stage6.json` | 0 | passed; no B7 edit |
| `pnpm exec tsc --noEmit --pretty false --incremental false` | 0 | passed |
| Task-local no-index `diff --check` | 0 | all ten files; zero whitespace errors |

No formatter, generator, dependency installation, migration, live database, Git mutation, or repository-wide auto-fix command ran.

## 15. Exact task-local changed-file inventory and numstat

| File | Main change | + | - | Before SHA-256 | After SHA-256 |
|---|---|---:|---:|---|---|
| `app/lib/footprint-resolver/adapters.ts` | one durable production source composition | 25 | 12 | `b35059bac942bd24844e89c589b19d07eef60c0c774994244c23bee2a50a3a80` | `4640760dc3f990385620ef471758fc89426aad8ab66a74f7caee22e83ff061b0` |
| `app/lib/footprint-resolver/service.ts` | production factory, explicit capabilities, source gating, digest versions | 38 | 4 | `6991475729565a9ae73c41718669f776bbb3277c64d8472a06b1dd1dc58e726f` | `7d8a141a098192ae4ee449622cd954bbcf97282fbbf4c7e7c67bf9468e6618c5` |
| `app/lib/footprint-resolver/validation.ts` | global-set agreement and exact B5 blocker propagation | 9 | 2 | `70b2f035602acadb3872eced5925e36a367814f148128b4bfa0f43906d879101` | `03dbe2cbe045d00811ce3202aa0c419886b6b393e9081f89e5d9b3f157ab0f1a` |
| `app/lib/footprint-resolver/policy.ts` | correct explicit Stage 5 production/custom-source contract note | 1 | 1 | `d4b45012c226d33edbbf075e0841b432e87256a057f3d02a87d92f52abce2e77` | `9f3beb078a69203d5ffcfd341f4d3a39853f32d8c71fd3baa154c1711164787d` |
| `app/lib/footprint-resolver/variant-scope.ts` | shared versioned variant inspector/normalizer | 51 | 0 | `ABSENT` | `873b65615d29381ecf76e430a54b4fa5d467a0613e24eab1a25ace0a19932440` |
| `app/lib/passive-policy/stage2-adapter.ts` | B04 trace/dependencies, B01 evidence, stable timestamps, unavailable/blocking states | 68 | 17 | `947706918cae90399bb191f5bc6191f4a3b07a82868229b5870323d459a6a43b` | `e05b7647ed3ced903968f87de12fb5180a191ab7d67f0ea176a5cc2cd29a2dcc` |
| `app/api/pcb-sync/route.ts` | canonical factory and safe capability exposure | 4 | 3 | `03671d67b5f6aaab8529f4f03b76f9b41b8ee01c21614b34524459aa74d51830` | `400aba9c9fd576e39fc7403cea10ba1f9d5fa34dd92a3e2ffb554d89b0add2df` |
| `app/lib/mapping-verification/stage1-projector.ts` | shared global/exact scope applicability | 4 | 1 | `a933469480fa2b5291b94d700d473bf0ab9002bad0c0086346c8db3f592b09e8` | `9258e7726684a740a0498ddbac2877e42ce042850d8155de0e3d31e18f893d6c` |
| `app/lib/footprint-resolver/__tests__/policy-request.test.ts` | composition, variant, projector contract tests | 37 | 0 | `b143462b0d669116e69e08e5386f5a452a90a3e8d6de68ebda323e28cc4e64b0` | `1a2412881d78ace69093bfe94704452c4cbbd6e2e78238843d065eca9e5fac57` |
| `app/lib/footprint-resolver/__tests__/resolution-e2e.test.ts` | B1-complete, B5/B04/B02/variant E2E proof | 212 | 3 | `af584589cd580734c19013443a8a409f3f57e2c0af637ab1bbf08b50ed81264f` | `02913a0f38aa14316eb35ff6b653a8fd5bd925b6f98e18005b2ada413004c1dd` |
| **Total** | | **449** | **43** | | |

Every baseline and final implementation/test file is LF-only. No whole-file replacement, line-ending conversion, generated artifact, formatting churn, or unrelated rewrite occurred.

## 16. Budget use

- Product/test files: **10/10**.
- Product/test churn: **492/1,200** added plus deleted lines.
- Report files: **1/1**.
- Schema/migration files: **0**.
- B7 files: **0**.
- Unrelated files: **0**.
- The 80% stop-loss threshold was not approached.

## 17. Forbidden-path confirmation

B05 changed no file under:

- `app/lib/physical-binding/**`;
- `app/lib/pcb-sync/**`;
- `app/api/pcb-sync/__tests__/**`;
- B4 service/durable/invalidation paths;
- B5 types/policy/evaluator/service/durable/invalidation/API paths;
- durable-workflow, assignment-queue, PCB UI, schema, migrations, package/lock, environment, or protected-original paths.

Existing dirty-tree work remains user-owned. No Git stage, commit, reset, restore, checkout, clean, stash, merge, rebase, or push operation ran.

## 18. Residual obligations

- **R03-B06:** add scoped/versioned outbox ownership only after its migration-authority gate.
- **R03-B08:** order effects, add completion/readiness barriers, and converge B4/B5 invalidations.
- **R03-B09:** integrate trusted human session/project-membership authority.
- **R03-B10:** update the frozen Stage 6 callers/shared fixtures and complete production editor compatibility.
- **R04:** qualify live PostgreSQL recreation, crash/retry, concurrent replay, outbox recovery, applied migration constraints, and durable reload.

B05 does not claim cross-store atomicity after B02's final revalidation, outbox delivery completion, or live-process durability.

## 19. Authorization

Both B05 gaps are closed inside scope and budget with passing focused tests and type checks. **R03-B06 is authorized: YES, subject to its required migration-authority gate.**

R04 remains unauthorized. Stage 6 and Stage 7 may not resume.

```text
R03-B05 VERDICT: COMPLETE
GAPS ASSIGNED: R02-B2-006, R02-B2-X01
PRODUCTION RESOLVER COMPOSITION: PASS
DURABLE B5 SOURCE: PASS
B04 EXCEPTION TRACEABILITY: PASS
POLICY/EXCEPTION DIGEST INVALIDATION: PASS
B02 STALE-PLAN INTEGRATION: PASS
UNIFIED VARIANT CONTRACT: PASS
RESOLUTION READ-ONLY: PASS
PRODUCT/TEST FILES CHANGED: 10/10
DIFF CHURN: +449 / -43 (492/1200)
FOCUSED TESTS: PASS
FOCUSED TYPE CHECK: PASS
FROZEN B7 FILES CHANGED: NO
SCHEMA/MIGRATIONS CHANGED: NO
UNRELATED FILES CHANGED: NO
R03-B06 AUTHORIZED: YES
R03-B06 MIGRATION GATE STILL REQUIRED: YES
R04 AUTHORIZED: NO
STAGE 6 MAY RESUME: NO
STAGE 7 MAY RESUME: NO
REPORT: artifacts/footprint-binding-remediation/r03-b05-report.md
```
