# R03-B02 B3 Apply Lifecycle and Current-Time Revalidation Safety Report

Date: 2026-07-19

## 1. Verdict

**R03-B02 VERDICT: COMPLETE**

R03-B02 closes the B3-owned implementation defects `R02-B3-003` and `R02-B3-006` inside the approved six-file boundary. Complete production B2/B5 passive-policy input composition remains assigned to R03-B05. Real PostgreSQL/process-termination/restart qualification remains assigned to R04.

## 2. Repository identity and prerequisites

| Field | Value |
|---|---|
| Repository | `C:/Users/robsa/Documents/Codex/2026-07-13/do/work/sirkit-edit` |
| Protected original | `C:/Users/robsa/sirkit` (not active; not modified) |
| Branch | `codex/cd-13-full-flow-orchestrator` |
| HEAD | `2bd1603a775bd4b409b89710cd4e5f8d70201632` |
| Starting changed paths | 1,258 |
| Starting normalized status fingerprint | `bcba4d7a4ebc6dc0732ee916ce41c476236e37619810046960f6fdc55cfc5d8a` |
| Ending changed paths | 1,259 (only this report is a new path) |
| Ending normalized status fingerprint | `4dc372aa92e60e0a6e42c0afe0e2deb32d803c964c18aa2ac5f1113c6acc9019` |
| R03A verdict | `SPLIT_PLAN_READY` |
| R03-B01 verdict | `COMPLETE` |
| R03-B01 authorization | `R03-B02 YES` |
| B02 plan gaps | `R02-B3-003`, `R02-B3-006` |
| Task-local baseline | `C:/Users/robsa/AppData/Local/Temp/sirkit-r03-b02-baseline-20260719` |
| Baseline manifest digest | `cae0fb4e5f0ecc126ee9b7cb07d4807dcba4d3516d949ae508a43a62330413a3` |

Required artifact hashes were verified before editing. The current B01 report hash was `d1c7685b1830698d5fc867903a8f6582b6cbcae58a7231d4e71763fe7f3d1366`; none of B01's files changed in B02.

## 3. Verified pre-repair defects

### R02-B3-003: stranded applying lifecycle

`PcbSynchronizationService.apply` performed this sequence:

1. load the durable applicable plan;
2. revalidate;
3. durably call `setPlanLifecycle(..., "applying")` in a separate commit;
4. stage and validate the board;
5. atomically commit board, applied plan, audit, replay, and outbox;
6. in `catch`, reset `applying` to `applicable`.

Process death between steps 3 and 5 skips `catch`. A fresh process then loaded lifecycle `applying`, while the apply request contract expected `applicable`, leaving no owner, lease, expiry, or deterministic reclaim rule.

### R02-B3-006: preflight-time revalidation

The revalidation request explicitly set `requestedAt: plan.createdAt`. Approval expiry was therefore evaluated at plan creation, not apply. Final audit/result/router timestamps also came from caller-controlled `request.requestedAt`.

## 4. Selected lifecycle strategy

B02 uses permitted **Strategy A: remove the unsafe authoritative precommit**.

The existing final durable workflow transaction already publishes board, plan, audit stream, replay result, and outbox together with expected-revision checks. A separate durable `applying` state added no safe ownership information and created the crash trap. B02 therefore:

- removes the service's durable `applying` write;
- treats `applying` only as a process-local execution view;
- stages and validates from the durable applicable plan;
- publishes lifecycle `applied` only inside the final atomic commit;
- removes correctness dependence on catch-time lifecycle reset;
- accepts a historical persisted `applying` plan as an explicitly recoverable pre-B02 state when no replay exists;
- still rejects `validated`, `stale`, `applied`, `aborted`, and `failed` plans.

No lease was approximated from timestamps. No lock, table, schema field, migration, or workflow framework was added.

## 5. Final lifecycle and transaction order

The apply flow is now:

1. capture one trusted server apply instant;
2. validate the request shape;
3. return only an exact existing replay;
4. load and digest-check the plan;
5. require lifecycle `applicable`, or historical recoverable `applying`;
6. enforce plan/apply chronology and expiry;
7. authorize the actor through the existing provider;
8. enter the existing board serialization boundary;
9. recheck replay and reload the current durable plan;
10. re-fetch snapshot, resolver authorities, materializations, policy versions, and board state at the trusted apply instant;
11. require the rebuilt plan digest/status to equal the stored plan;
12. stage, serialize, parse, and validate a process-local board;
13. re-fetch and revalidate all currently exposed inputs a second time immediately before publication;
14. atomically commit board record, plan `applied`, audit stream, replay, and `pcb-sync.applied` outbox event;
15. return the committed result, or recover/replay the exact durable result.

The durable adapter also verifies the current plan lifecycle inside the final publication path. Its plan-head revision participates in the workflow compare-and-swap, so concurrent invalidation or another apply cannot be overwritten.

## 6. Interruption and fresh-process behavior

| Interruption point | Durable result | Fresh-instance outcome |
|---|---|---|
| Before execution/invalid time or lifecycle | no mutation | corrected request/plan may retry |
| After lock | no mutation | retry |
| After initial revalidation | no mutation | retry |
| After staging/mutation/serialization/validation | staged data is process-local only | retry |
| Before final commit | no mutation | retry |
| During final durable commit | transaction-capable workflow rolls back records/outbox/replay | fresh repository adapter retries |
| After final commit before response | complete board/plan/audit/replay/outbox exists | exact replay/commit-uncertainty response |
| Historical stranded `applying` | no final replay/board publication | fresh durable repository and service complete it atomically |

Tests instantiate new `DurablePcbSyncRepository` and `PcbSynchronizationService` objects over the same `InMemoryDurableWorkflowRepository`; they do not reuse one in-memory service as restart proof. Real process kill and PostgreSQL restart are deliberately not claimed.

## 7. Concurrency and idempotency

- Identical concurrent attempts produce one `applied` result and one `idempotent_replay` result.
- The durable adapter marks a workflow-level replay as `idempotent_replay` and never reports it as a second board mutation.
- Same key with a different plan/digest throws `PS_IDEMPOTENCY_SCOPE_CONFLICT`.
- Different-key concurrent attempts against one plan produce one winner and one explicit revision-stale loser.
- Durable workflow optimistic conflicts are translated to `PS_DURABLE_PUBLICATION_REVISION_CONFLICT` rather than an opaque internal error.
- The loser cannot reset or overwrite the winner; catch no longer writes lifecycle state.
- Board, plan, audit, replay, and outbox counts remain single-publication.

## 8. Trusted-time contract

`PcbSyncTrustedClock` is injected at the service boundary. Production defaults to the server process clock; tests inject deterministic values.

- Apply captures exactly one millisecond-precision ISO instant.
- Caller/body/header time never controls expiry, revalidation, audit time, result completion time, or router-handoff time.
- The legacy request timestamp remains syntax-validated but is not an authority clock.
- Invalid trusted clock output fails with `PS_TRUSTED_CLOCK_INVALID`.
- Apply earlier than plan creation or the current board update fails with `PS_APPLY_CLOCK_REGRESSION`.
- Invalid plan chronology fails with `PS_PLAN_TIME_INVALID`.
- Plan expiry uses a closed boundary: `applyAt >= expiresAt` is expired.
- Binding approval expiry follows the resolver's existing closed boundary and is tested both after expiry and exactly at expiry.
- Equality with plan creation/board update is allowed; equality with expiry is rejected.

The same captured instant is used for both revalidation passes, durable commit time, audit occurrence, apply completion, and router handoff generation.

## 9. Current-authority revalidation

Each apply now reloads every authority exposed through the current B3/B2 interfaces:

- authoritative schematic snapshot digest and schematic revision;
- project/design/component/net/assembly-variant revisions in the snapshot;
- library snapshot revision and footprint materialization digests;
- Stage 1 binding-set digests and selected binding revision returned by the resolver;
- mapping certificate/revision data returned by the resolver/materialization;
- current resolver dependency and decision digests;
- current resolution and synchronization policy versions;
- approval state and expiry at trusted apply time;
- current board revision/digest and board risk state;
- current durable plan digest, lifecycle, and head revision.

Tests change schematic, library, binding, mapping, policy/dependency, and board inputs and prove apply remains non-mutating and blocked stale.

R03-B02 does not claim the missing production passive-policy/component-exception composition from `R02-B2-006`; R03-B05 must wire those additional B5 inputs into the resolver composition. Once exposed there, their dependency digests already participate in the same B3 rebuilt-plan comparison without another lifecycle redesign.

## 10. Time-of-check/time-of-use guards and residual

B02 performs an initial current-state revalidation and a second revalidation after staging and immediately before the final durable commit. The final commit independently compare-and-swaps the board head and plan head, catching board or lifecycle changes after the second check.

The schematic/resolver/physical-binding/mapping/policy providers are separate authorities and are not members of the B3 workflow transaction. A change in one of those stores after the second revalidation but before the B3 commit cannot be atomically compare-and-swapped with the current interfaces. Closing that cross-store interval would require a shared owner-revision transaction/barrier beyond B02's authorized boundary. B02 does not conceal or overclaim that limitation; B05/B06/B08 compose and converge the remaining authority/invalidation inputs, and R04 must qualify the live behavior.

## 11. Atomic publication boundary

The supported atomic boundary is the durable workflow commit containing:

- the Sirkit PCB board record;
- plan lifecycle `applied`;
- audit stream successor;
- idempotency replay result;
- `pcb-sync.applied` outbox event.

Board staging before that commit is process-local JSON and cannot become authoritative. B02 does not claim atomic publication of an external KiCad file or any browser/local-storage board; those are outside this transaction and the browser-authority compatibility work remains assigned to R03-B10.

## 12. Tests and B01 compatibility adaptation

The three authorized test files locally replace only the obsolete `readyRepository` fixture behavior. The replacement performs real B1 selection and approval with explicit `evidence-datasheet` decision evidence. This is a test compatibility adaptation to the completed B01 contract, not a B1 implementation change, default, or bypass.

Added/strengthened coverage includes:

- every precommit fault point;
- historical `applying` recovery with fresh durable adapters;
- workflow rollback during final commit and fresh-adapter retry;
- post-commit response uncertainty and fresh-service replay;
- identical and conflicting concurrent durable attempts;
- trusted-time override resistance, invalid clock, regression, and equality boundaries;
- plan and approval expiry at current apply time;
- current schematic/library/binding/mapping/policy/board changes;
- second revalidation catching a dependency change after staging;
- API expiry/conflict output with no internal detail leakage;
- B01 fail-closed evidence behavior through the combined compatibility suite.

## 13. Verification commands and results

| Command | Exit | Result |
|---|---:|---|
| Initial three authorized test files | 1 | 31 tests: 3 passed, 28 failed only with pre-existing `PB_DECISION_EVIDENCE_REQUIRED` fixture debt |
| Same tests after authorized B01 fixture adaptation | 0 | 31/31 passed; clean defect-test baseline |
| Final three authorized B02 test files | 0 | 46/46 passed |
| B1 plus authorized B3 compatibility suite | 0 | 9 files, 82/82 tests passed |
| `pnpm exec tsc --noEmit --pretty false -p tsconfig.footprint-stage6.json` | 0 | frozen Stage 6 focused graph compiled without B7 edits |
| `pnpm exec tsc --noEmit --pretty false --incremental false` | 1 | only pre-existing frozen B7 test error at `materializer-repository.test.ts(25,420)` for unsupported `"fitted"`; no B02 error |
| Task-local no-index diff check | 0 | all six files passed |

No formatter, generator, dependency install, migration command, live database, repository-wide auto-fix, or Git mutation command ran.

## 14. Exact task-local diff and budget

| File | Gaps | Main change | + | - |
|---|---|---|---:|---:|
| `app/lib/pcb-sync/service.ts` | 003, 006 | Strategy A lifecycle, trusted clock, dual current revalidation, deterministic recovery | 53 | 21 |
| `app/lib/pcb-sync/durable.ts` | 003, 006 | final lifecycle guard, exact replay status, explicit CAS conflict | 18 | 4 |
| `app/lib/pcb-sync/types.ts` | 006 | trusted clock contract | 3 | 0 |
| `app/lib/pcb-sync/__tests__/atomicity-recovery.test.ts` | 003, 006 | B01 fixture adaptation; durable interruption/fresh adapter/concurrency | 99 | 5 |
| `app/lib/pcb-sync/__tests__/preflight-apply.test.ts` | 006 | B01 fixture adaptation; trusted time/current authorities/TOCTOU | 127 | 3 |
| `app/api/pcb-sync/__tests__/route.test.ts` | 006 | B01 fixture adaptation; caller-time and expiry API boundaries | 51 | 2 |
| **Total** | | | **351** | **35** |

Budget use: 6/6 product/test files, 386/800 added+deleted lines, one report, zero migrations, zero schema files, zero B7 files, zero unrelated files. The 80% stop-loss threshold was not approached.

Task-local SHA-256 attribution:

| File | Before | After |
|---|---|---|
| `service.ts` | `c5dd7e6008563f350db4561cdc590a4df9c9801f619057931ed56088e28986da` | `f22041a57abeb70ed22d3954a7e799945fc9fda8cabf42db34c403151558688b` |
| `durable.ts` | `4284905d6edf079bd5d7aac8429848e1eca4373dc91f9e317a1692dfd19d9ccb` | `49e15acc2f4bde07371f0035b5d69ac70b17dd27c48d733fb300b7f37fb1e509` |
| `types.ts` | `68bb09455844edc399359637c17492907e32f24caff9a60ded15dc24301127a7` | `e77e733991cda3a38c06c9d38ff91b109c1010f4da9837663a2a1fbdfddc1216` |
| `atomicity-recovery.test.ts` | `ce5c2135a4d92a0992afc9ddbd7cb40ca557add1482c71460b5b8129fc2609dd` | `b6425e50db1b55da04a8a495ac83e80a8d0281121142905abcd1ed34b47630c7` |
| `preflight-apply.test.ts` | `e7e62ffc91e6dd5518f473f7df3efb671ad39e713f4f581cb6adb515661421ea` | `8024a623ab1836854fa51e6b6d9392dca75624b07ef500d5d89470ac6923b463` |
| `route.test.ts` | `e8f31c15b34611f7cc4c249b570bf39c141db1d0b6a440b934735a020d8773d2` | `d22e4c74952d76a95f70a10ae0bd69eaf4b5abd26dcb71f34d003a8cb0e452c3` |

All six files remain LF-only. There was no whole-file deletion, generated output, line-ending conversion, or unrelated formatting churn.

## 15. Boundaries and authorization

- Physical-binding/B01 implementation changed: **NO**.
- Footprint resolver production changed: **NO**.
- Mapping/passive-policy/durable-workflow implementation changed: **NO**.
- Assignment queue/B7 changed: **NO**.
- Browser/editor/local-board authority changed: **NO**.
- Schema/migration changed: **NO**.
- Protected original changed: **NO**.
- Complete B2/B5 production composition claimed: **NO; deferred to R03-B05**.
- Live PostgreSQL/process crash qualification claimed: **NO; deferred to R04**.

R03-B03 is authorized by the approved repair sequence. R04, Stage 6, and Stage 7 remain unauthorized.

```text
R03-B02 VERDICT: COMPLETE
GAPS ASSIGNED: R02-B3-003, R02-B3-006
B3-003 LIFECYCLE REPAIR: PASS
B3-006 CURRENT-TIME REPAIR: PASS
B3-006 AVAILABLE AUTHORITY REVALIDATION: PASS
B3-006 B2/B5 PRODUCTION INPUT: DEFERRED_TO_R03-B05
PRODUCT/TEST FILES CHANGED: 6/6
DIFF CHURN: +351 / -35 (386/800)
INTERRUPTION/FRESH-SERVICE TESTS: PASS
CONCURRENT APPLY TESTS: PASS
FOCUSED TESTS: PASS
FOCUSED TYPE CHECK: PASS
BOARD CHANGED DURING REVALIDATION: NO
FROZEN B7 FILES CHANGED: NO
SCHEMA/MIGRATIONS CHANGED: NO
UNRELATED FILES CHANGED: NO
R03-B03 AUTHORIZED: YES
R04 AUTHORIZED: NO
STAGE 6 MAY RESUME: NO
STAGE 7 MAY RESUME: NO
REPORT: artifacts/footprint-binding-remediation/r03-b02-report.md
```
