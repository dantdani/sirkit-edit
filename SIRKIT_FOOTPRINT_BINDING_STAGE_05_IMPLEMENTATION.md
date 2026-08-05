# Sirkit Footprint Binding Stage 5 Implementation Evidence

## 1. Verdict

BLOCKED

The protected copy now contains a versioned, deterministic, conservative project passive-package policy core; explicit package/profile identity; three distinct modes; mandatory exclusions; immutable lifecycle/audit; full-project preview; a default-off Stage 2 rank-6 adapter; precise Stage 3 plan invalidation; security-gated API; truthful read-only UI; tests; evidence; and documentation. Final Stage 5 checks pass 27/27, the Stage 1–5 serial regression passed 173/173 before the final two additional Stage 5 assertions, and focused TypeScript/ESLint are clean.

Production authority remains blocked. Stages 1–4 retain `BLOCKED` verdicts; live projects do not expose one durable authoritative generic-passive fact snapshot; policy commit, Stage 1 projection, audit/idempotency and Stage 3 invalidation are not one crash-safe PostgreSQL transaction; process-restart/apply/rollback proof is absent; the repository-wide non-incremental type check and Next production build did not terminate within bounded attempts; and one unrelated existing PCB-repair performance test still fails its 250 ms budget in isolation.

Deployment state is `SIRKIT_PASSIVE_POLICY_STAGE5=off`; the UI is unmounted; public Stage 2 remains on policy `1.0.0`; legacy production behavior is unchanged. Smallest next action: implement the durable server fact/policy/Stage 1/Stage 3 transaction and recovery path, then qualify PostgreSQL apply/rollback/process-kill restart and complete repository build/type verification before observe mode. Until then, enabling this as authority risks stale/wrong package decisions, unapplied invalidation, and inconsistent project data; it does not directly risk PCB mutation because Stage 5 has no board-write path.

## 2. Prerequisite evidence

Full gate: `SIRKIT_PASSIVE_POLICY_STAGE_05_PREREQUISITE_GATE.md`.

| Stage | Consumed contract | Verified behavior | Current prerequisite status |
|---|---|---|---|
| 1 | `sirkit.physical-binding.v1`, physical readiness `v1` | Stable instance identity, immutable revisions, exact selected-binding precedence, package/asset/mapping references | `BLOCKED`: durable live project/restart transaction unproven |
| 2 | resolver `2.0.0`, default policy `1.0.0` | Fixed authority ranks; `passive_policy` reserved rank 6; default disabled/cache off | `BLOCKED`: depends on durable Stage 1 and trusted source cutover |
| 3 | PCB-sync snapshot/plan/apply contracts | Dependency-bound plans; affected validated/applicable plan becomes stale; board record remains identical | `BLOCKED`: durable trusted snapshot/plan/board/audit/recovery missing |
| 4 | mapping verifier `4.0.0` | Only approved/current/active/conflict-free `verified` exact-part/package-family/curated-pair mappings accepted | `BLOCKED`: atomic catalog + Stage 1 mapping publication/restart missing |

Contract artifacts are `docs/physical-binding-stage-02-handoff.json`, `docs/footprint-resolver-stage-03-handoff.json`, `docs/pcb-sync-stage-04-handoff.json`, and `docs/mapping-verification-stage-05-handoff.json`. Focused Stage 1–5 regression completed 173/173 tests across 59 suites with one worker; a four-worker run exposed only Stage 3 benchmark contention and the same benchmark passed alone at 9.873 s.

## 3. Repository discovery and legacy defaults

Full ownership/default map: `SIRKIT_PASSIVE_POLICY_STAGE_05_REPOSITORY_DISCOVERY.md`.

- Stage 1 `ComponentPhysicalClassification` owns physical class/mounting/polarity but not enough live role/rating detail by itself.
- Atomic `EngineeringClaim`/`Quantity` and CD8 graph types can represent typed value/evidence/conflict/variant facts, but the browser schematic does not yet project a durable authoritative per-generic-passive snapshot.
- Stage 2 already reserved `passive_policy` at authority rank 6 through a disabled adapter.
- Stage 3 plans already pin resolver evidence/dependencies but its runtime persistence boundary is not production durable.
- Stage 4 supplies exact mapping profile references and rejects limited-direct mappings for layout.
- `lib/footprint-assign.ts` defaults R/C/L/FB to 0603 by refdes; `app/lib/pcb/package-map.ts` and `app/lib/pcb/netlist-bridge.ts` interpret free text/package/refdes. Stage 5 imports none of these paths and does not convert them into authority.
- Those legacy paths were inventoried but not removed: safe retirement requires explicit Stage 1 candidate migration, shadow comparison, durable transaction/restart qualification, then cutover. No silent legacy reinterpretation was introduced.

## 4. Implemented policy architecture

- Versioned contracts: `app/lib/passive-policy/types.ts`.
- Canonical serialization/digests: `stable.ts`.
- Dimension-specific bounded SI parser: `value.ts`.
- Explicit imperial/metric identities and profile validation: `package-profile.ts`.
- Rule/schema/lifecycle limits and validation: `policy.ts`.
- Authoritative fact snapshot adapter: `adapters.ts` and trusted provider boundary `providers.ts`.
- Pure deterministic safety/matcher/precedence/profile evaluator: `evaluator.ts`.
- Immutable in-memory qualification repository: `repository.ts`.
- Human lifecycle/approval/publish/revoke/successor orchestration: `service.ts`.
- Complete read-only project evaluation/diff: `preview.ts`.
- Stage 2 ephemeral policy candidate: `stage2-adapter.ts`; opt-in policy plumbing in `app/lib/footprint-resolver/{types,policy,service,engine}.ts`.
- Stage 3 precise plan invalidation: `invalidation.ts` and `app/lib/pcb-sync/repository.ts`.
- Pseudonymous metrics and default-off rollout: `observability.ts`, `rollout.ts`.
- Scoped API: `app/api/passive-policy/{_scope,handler,route}.ts`.
- Truthful unmounted UI: `app/components/pcb/PassivePackagePolicyPanel.tsx`.

No Stage 5 database migration was added because the required durable transaction design is not yet qualified. The in-memory repository is explicit qualification infrastructure, not claimed production persistence.

## 5. Supported capability profile

| Area | Supported Stage 5 profile |
|---|---|
| Classes | Ordinary nonpolar SMD resistor and MLCC capacitor only |
| Ordinary roles | Decoupling, bypass, pull-up/down, bias, ordinary series signal, LED current limiting, generic noncritical use |
| Mandatory exclusions | Polarized, bulk, high-voltage/mains/safety, high-power/current, pulse/surge, current-sense/shunt, precision/low-tempco, RF, timing, ripple/DC-bias critical, arrays/networks, adjustable, power magnetics, unknown risk/class/role |
| Unsupported classes | Inductor/ferrite and all other passive-like/specialized/electromechanical/IC classes remain unresolved in this conservative release |
| Required facts | Exact/approved class, subclass, role, technology, polarity, rule-specific value/rating quantities, risk flags, variant/domain/tag context, evidence |
| Modes | `exact_part_required`, `characterized_generic`, `layout_reservation`; each has distinct gates and gaps |
| Package identity | Explicit normalized chip pair only; bare codes rejected; `0603 metric` differs from `0603 imperial` |
| Profile proof | One exact immutable footprint/content digest plus one accepted current Stage 4 mapping revision/result/dependency digest |
| Accepted mapping tiers | `exact_part`, `package_family`, `curated_pair`; never `limited_direct_pair` |
| Assembly assumption | Approved named assembly profile, SMD allowed, explicit minimum chip length/process |
| Bounds | 256 rules, 128 exclusions, 2,048 exceptions, 64 terms, 128 profiles, 4,096 preview components/trace steps, 8 MB, 5 s evaluation, 2 s lock |

Every eligible result retains exact-part, rating, derating, lifecycle/availability, assembly and manufacturing-evidence gaps as applicable. `manufacturingReady`, exact-part selection, availability/derating certification, schematic mutation and PCB mutation are always false.

## 6. Rule and lifecycle behavior

The evaluator freezes one trusted scope/dependency snapshot; validates schema/digest/lifecycle; checks population and exact Stage 1 override; applies non-bypassable class/role/risk/polarity exclusions; evaluates approved component exceptions and global exclusions; evaluates every bounded declarative rule; validates exact profile/asset/mapping/assembly/envelope compatibility; and decides by maximum specificity then maximum priority. Equal winners for one immutable profile merge with provenance. Equal winners for different profiles return `conflicting_rules`; array order cannot choose.

Unknown facts never become false-safe facts. Characterized mode requires every rule-required fact. Reservation mode permits only rule-named unknown keys and emits one gap per unknown. Exact-part-required mode needs approved compatible exact-part evidence but never creates/selects that part. An effective approved Stage 1 selection suppresses policy entirely.

Approved component exceptions may opt out, require exact part, or select one approved profile; contradictory current exceptions block. Lifecycle is create draft → validate → submit → independent human approve → project-admin publish. Published content is immutable; revoke/successor preserves history. Technical digest excludes lifecycle/display metadata so approval remains bound to exact rule content. Scope locks, expected revision/digest, immutable audit events and idempotency prevent concurrent/double publication in qualification tests. There is no physical rollback edit: revoke or successor creates a new record.

## 7. Representative policy results

| Case | Deterministic result | Important truth |
|---|---|---|
| Approved 100 nF nonpolar MLCC decoupler, characterized | `eligible_characterized_generic` | 0603 imperial/1608 metric layout profile; six manufacturing gaps; never exact/manufacturing-ready |
| 100 nF reservation, working voltage explicitly permitted unknown | `eligible_layout_reservation` | Warning plus named voltage/redesign gap |
| 100 nF with insufficient authoritative facts | `missing_required_facts` | Value text does not infer role/voltage/technology/package |
| No project policy | `not_applicable` with `PP_POLICY_NOT_CONFIGURED` blocker | No hidden fallback/default |
| 10 µF bulk role | `excluded_specialized_role` | Exact component decision required |
| Polarized/safety capacitor | `excluded_safety` | Mandatory exclusion cannot be overridden |
| Ordinary 10 kΩ pull-up plus power fact | `eligible_characterized_generic` | Layout profile only |
| Current-sense/high-power resistor | `excluded_specialized_role`/mandatory safety exclusion | Specialized validation/exact part required |
| Exact-part-required, no compatible exact proof | `missing_required_facts` | Policy cannot invent an exact part |
| Exact-part-required with compatible approved non-effective proof | `eligible_exact_part` | `selectsExactPart` still false |
| Effective current approved Stage 1 binding | policy `not_applicable`; Stage 2 rank 1 selected | Exact authority wins over rank 6 |
| Bare `0603` | `PP_PACKAGE_ALIAS_AMBIGUOUS` | Metric/imperial semantics must be explicit |
| `0603 metric` vs `0603 imperial` | 0201/0603 vs 0603/1608 identity | Materially distinct profiles |
| Equal winning 0603/0805 rules | `conflicting_rules` | Human/policy correction; no first-match behavior |
| Stale Stage 4 mapping | `mapping_unverified` | Profile cannot enter Stage 2 |

## 8. Preview, integration, and invalidation

Preview sorts and evaluates the complete trusted project/variant snapshot in chunks of 16 and reports every result/status, changed component, selected profile, manufacturing-gap counts, Stage 2 dependency keys, Stage 3 plan count, routed-board risk IDs and `boardChanged: false`. A 1,000-component fixture produced 1,000 results without sampling.

Stage 1 exact selection remains rank 1 and suppresses the policy source. Qualification policy `1.1.0-stage5-passive-policy` and `PassivePolicyCandidateSource` require explicit service opt-in; public/default resolver policy `1.0.0` rejects it. A qualified policy binding is ephemeral, current/approved for layout only, uses the exact profile asset and accepted Stage 4 mapping, is layout-ready, and remains manufacturing-not-ready.

Stage 2 cache stays disabled. Publication/revocation computes dependency keys only for changed stable component IDs. Stage 3 invalidates only validated/applicable plans in the same tenant/project/branch/board scope whose resolver evidence names an affected component. The integration test changed one plan to `stale` and proved the board record before/after was equal. No placement, copper, zone, outline, stackup, connectivity, schematic, BOM or exact-part record is mutated.

The invalidation call currently occurs outside one durable policy/Stage 1/Stage 3 database transaction. A process failure between stores cannot be recovered from this in-memory qualification implementation; rollout therefore remains off.

## 9. Security and operations

- Authenticated tenant/project/branch/actor/role scope is mandatory and body scope/actor cannot override it.
- API accepts JSON only, 64 KB maximum, and scoped IDs/operations only. Client context, facts/profiles, snapshots, assets/mappings, evidence, path/URL/file inputs are rejected.
- Human authority is mandatory for policy mutation. Editors/admins edit; reviewer/admin approves; project admin publishes/revokes. AI is suggestion-only and is denied lifecycle authority.
- Read operations require rollout above off. Mutations additionally require `opt_in` and an explicit acknowledgement header.
- Value/unit/package/rule parsers are bounded; controls/markup, malformed IDs, wrong dimensions, comma forms, non-finite values, excessive collections/terms and unknown executable constructs fail closed.
- Preview propagates cancellation between chunks. Adapter collection uses the Stage 2 timeout. Scope locks have a 2 s bound.
- Cache is deliberately disabled. Dependency digests and immutable snapshots avoid stale-result reuse.
- Metrics contain pseudonymous project key, versions, operation/status/mode/reason counts and duration; not raw facts, evidence, content, paths, URLs, API keys or project names.
- Remaining operational risks: in-memory lifecycle state, no rate-limit/load/capacity qualification, no crash recovery, unproven broad build/type/lint, and a pre-existing PCB-repair performance failure.

## 10. Verification evidence

Environment: Windows x64 `10.0.26200`, Node `v24.15.0`, pnpm `11.2.2`, Vitest `3.2.6`, Next `16.2.6`.

| Command/check | Purpose | Exit/result | Passed / failed / skipped | Notes |
|---|---|---:|---:|---|
| `pnpm install --lockfile-only --frozen-lockfile --ignore-scripts` | lockfile validation | 0 | n/a | Already up to date |
| final Stage 5 Vitest command, one worker | unit/integration/API/UI/security/property/perf | 0 | 27 / 0 / 0 | `artifacts/footprint-binding-stage-05/stage5-suite.json` |
| Stage 1–5 serial Vitest command, one worker | prerequisite/consumer regression | 0 | 173 / 0 / 0 | 59 suites; before two final additive Stage 5 assertions |
| full repository Vitest, four workers | repository regression | 1 | 1,411 / 4 / 9 | 1,424 tests; four load/perf failures, no Stage 5 failure |
| isolated Stage 3 performance | contention diagnosis | 0 | 4 / 0 / 0 | 500-component case 9.873 s < 10 s |
| isolated route-preview performance | contention diagnosis | 0 | included file pass | p95 33.426 ms |
| isolated 100-footprint auto-place | contention diagnosis | 0 | 1 / 0 / 7 filtered | 4.064 s |
| isolated PCB-repair snapshot performance (twice) | inherited performance gate | 1 | 0 / 1 / 7 filtered | 529–812 ms, budget 250 ms; correctness tests pass |
| `pnpm exec tsc -p tsconfig.stage5.json --pretty false` | changed dependency graph | 0 | no diagnostics | Production, consumers, tests, API/UI, evidence included |
| full `tsc --noEmit --incremental false` | whole repository types | interrupted | unproven | CPU-active 11 min, no diagnostics, bounded attempt stopped |
| focused ESLint with `--max-warnings=0` | changed files | 0 | 0 errors/warnings | Clean |
| broad ESLint | whole repository lint | interrupted | unproven | Six-minute bounded attempt, no final report |
| `pnpm exec drizzle-kit check` | migration metadata consistency | 0 | n/a | `Everything's fine` |
| database apply/rollback/process restart | durable qualification | not run | unproven | Required production blocker; no Stage 5 migration added |
| `pnpm build` twice | Next production build | interrupted | unproven | Optimization did not exit in ~8 min with dev server or ~6 min without; no diagnostic |
| `pnpm passive-policy:stage5-evidence` | representative/performance evidence | 0 | all assertions pass | Machine JSON generated |
| JSON parse + targeted `git diff --check` | artifact/whitespace integrity | 0 | valid/clean | No formatter script exists |
| HTTP root + `/api/passive-policy` on 3001 | live integration | 0 | 200 / 200 | off, qualification-only, manufacturing/PCB mutation false |

The four full-suite failures were Stage 3 500-component timing, auto-place timeout, route-preview timeout and PCB-repair snapshot timing under parallel load. The first three passed isolated. The PCB-repair test remains a genuine unrelated repository-wide performance failure and was not weakened or edited. Nine skips are environment/live-tool suites already present in the repository.

## 11. Performance evidence

Machine artifact: `artifacts/footprint-binding-stage-05/qualification-evidence.json`.

| Fixture | Measurement | Budget | Result |
|---|---:|---:|---|
| ordinary characterized evaluation, 100 samples | mean 2.274 ms; p50 2.029 ms; p95 4.103 ms; max 6.510 ms | p95 < 100 ms | pass |
| complete 1,000-component preview | 1,522.442 ms | < 5,000 ms | pass |
| serialized 1,000-component preview | 7,929,530 bytes | < 8,000,000 bytes | pass, 70,470-byte headroom |
| Stage 3 invalidation fixture | 1 affected component / 1 dependent plan | exact scope | pass; board unchanged |

Trace expansion was tested against the 8 MB cap. A verbose per-rule trace exceeded the cap and was rejected; the final result uses four compact phase trace steps while preserving complete rule dispositions and gates in dedicated fields. Peak process memory and production database/network latency were not measured and remain unproven. No correctness gate or result was sampled/omitted to meet time; preview includes all 1,000 results.

## 12. Documentation and Stage 6 handoff

- `SIRKIT_PASSIVE_POLICY_STAGE_05_PREREQUISITE_GATE.md`: strict Stage 1–4 gate.
- `SIRKIT_PASSIVE_POLICY_STAGE_05_REPOSITORY_DISCOVERY.md`: authority/default/mutation ownership map.
- `docs/passive-package-policy-stage-05.md`: technical, operational and user semantics with worked examples.
- `docs/passive-package-policy-stage-06-handoff.json`: precise assignment-queue consumer contract.
- `progress/2026-07-19/03-footprint-binding-stage-05.md`: concise change/reason/safety log.
- `artifacts/footprint-binding-stage-05/*`: machine evidence and test reports.

Stage 6 may queue missing facts, exact-part requirements, conflicts, unavailable profiles, unverified mappings, stale policy and unsupported/error outcomes. It must pin project/component/variant/policy/result/dependency identities; display full dispositions/gates/trace/gaps; treat profiles as non-authoritative suggestions; allow only exact component/footprint choice, approved exception, authoritative fact provision, opt-out or policy-edit request; require human role approval; persist immutable Stage 1 decisions that outrank/opt out of policy; rerun Stages 5/2/3; stale old items on dependency changes; forbid bulk approval for specialized parts; and never edit a PCB directly. Stage 6 was not implemented.

## 13. Limitations and deferred work

- Stage 6: ambiguity/assignment queue, user decision workflow and durable Stage 1 persistence; explicitly not implemented.
- Stage 7: richer engineering-aware feasibility/placement use after exact decisions; Stage 5 does no placement.
- Stage 8: routing effects/high-speed constraints; Stage 5 does no routing/copper.
- Stage 9: competitive QoR/capacity benchmarks beyond this evaluator; peak memory and operational load remain unmeasured.
- Stage 10: durable collaboration/persistence/recovery transaction, audit replication and production rollout.
- Immediate prerequisite debt: trusted live passive fact projection, durable policy/profile repositories, atomic Stage 1/3 invalidation transaction, PostgreSQL migration apply/rollback, process-kill recovery, cache/rate/capacity operations.
- Legacy 0603/refdes defaults remain in live legacy code until the durable cutover; they are not consumed by Stage 5.
- Conservative capability excludes inductor/ferrite and all specialized components.
- Public policy create/edit API and mounted UI are intentionally absent while blocked.
- Full non-incremental TypeScript, broad lint and production build did not complete bounded attempts; one unrelated PCB-repair performance gate fails.
- Original `C:\Users\robsa\sirkit` was not targeted by any write; all Stage 5 work is in the protected copy.

## 14. Changed-file inventory

Production code:

- `app/lib/passive-policy/{types,stable,value,package-profile,policy,adapters,evaluator,providers,preview,repository,invalidation,observability,rollout,service,stage2-adapter,index}.ts`
- `app/api/passive-policy/{_scope,handler,route}.ts`
- `app/components/pcb/PassivePackagePolicyPanel.tsx`
- Stage 2 consumers: `app/lib/footprint-resolver/{types,policy,service,engine}.ts`
- Stage 3 consumer: `app/lib/pcb-sync/repository.ts`
- `package.json` adds `passive-policy:stage5-evidence` only for this stage.
- `tsconfig.stage5.json` defines the deterministic changed-graph typecheck.

Schemas/migrations:

- Versioned TypeScript schemas are in `app/lib/passive-policy/types.ts`.
- No database migration was added; durable persistence design/qualification is a blocker, not simulated as complete.

Tests/fixtures/evidence:

- `app/lib/passive-policy/__tests__/{fixtures.ts,identity-value-evaluator.test.ts,lifecycle-preview-invalidation.test.ts,stage2-integration.test.ts,performance-property.test.ts}`
- `app/api/passive-policy/__tests__/route-security.test.ts`
- `app/components/pcb/__tests__/passive-package-policy-panel.test.tsx`
- `scripts/passive-policy-stage5-evidence.ts`
- `artifacts/footprint-binding-stage-05/{qualification-evidence.json,stage5-suite.json,focused-stage1-5.json,focused-stage1-5-serial.json,full-suite.json}` plus dev-server stdout/stderr used to keep port 3001 running.

Documentation:

- `SIRKIT_PASSIVE_POLICY_STAGE_05_PREREQUISITE_GATE.md`
- `SIRKIT_PASSIVE_POLICY_STAGE_05_REPOSITORY_DISCOVERY.md`
- `SIRKIT_FOOTPRINT_BINDING_STAGE_05_IMPLEMENTATION.md`
- `docs/passive-package-policy-stage-05.md`
- `docs/passive-package-policy-stage-06-handoff.json`
- `progress/2026-07-19/03-footprint-binding-stage-05.md`

The working tree already contained extensive unrelated Stage 1–10, CD1–13, PCB, LLM, API, schema, migration and documentation changes from earlier work. They were preserved and not cleaned, reset, reformatted, staged or committed by Stage 5.
