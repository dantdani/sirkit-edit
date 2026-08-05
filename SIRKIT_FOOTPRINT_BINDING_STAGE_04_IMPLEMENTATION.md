# Sirkit Footprint Binding Stage 4 Implementation Evidence

## 1. Verdict

BLOCKED

The deterministic three-layer pin/package-terminal/pad verification core, safe policy, immutable lifecycle adapters, Stage 1 projection, Stage 3 plan invalidation, API boundary, UI component and representative qualification corpus are implemented in the protected copy. They fail closed on numeric/name/order inference, AI/import confidence, function/polarity contradictions, incomplete coverage, illegal shorts, DNC, mechanical/shield/thermal intent, insufficient/stale/conflicting evidence and stale dependencies.

Stage 4 is not approved as production mapping authority. Stages 1–3 retain strict `BLOCKED` verdicts; the runtime route has only trusted in-memory qualification repositories; there is no single durable compare-and-swap transaction spanning atomic mapping publication, Stage 1 selected-reference successor, audit/idempotency and Stage 3 invalidation; and live PostgreSQL apply/rollback/process-restart qualification is absent. `SIRKIT_MAPPING_STAGE4` defaults to `off`, the UI is not mounted in the legacy editor, and existing production behavior is unchanged.

Smallest next action: implement the durable catalog/Stage 1 mapping repository transaction and restart recovery, then rerun Stages 1–4 against isolated PostgreSQL before enabling observe/opt-in.

## 2. Prerequisite evidence

- Stage 1: `SIRKIT_FOOTPRINT_BINDING_STAGE_01_IMPLEMENTATION.md` is `BLOCKED`; authoritative physical-binding types/repository/readiness and migration exist, but live DB/restart and repository hygiene remain unproven.
- Stage 2: `SIRKIT_FOOTPRINT_BINDING_STAGE_02_IMPLEMENTATION.md` is `BLOCKED`; resolver accepts exact approved bindings and its focused suite passes, but depends on Stage 1 durability.
- Stage 3: `SIRKIT_FOOTPRINT_BINDING_STAGE_03_IMPLEMENTATION.md` is `BLOCKED`; safe preflight/plan/apply profile is implemented, but trusted server snapshots, durable boards/plans/audits and crash/restart proof are missing.
- Stage 4 consumes existing atomic symbol/footprint parsers and exact manufacturer terminal/evidence types. It does not replace those authorities or weaken their schemas.

## 3. Repository discovery and ownership

Full map: `SIRKIT_MAPPING_VERIFICATION_STAGE_04_REPOSITORY_DISCOVERY.md`.

- Symbols/pins and footprints/pads: `app/lib/atomic/types.ts`, `app/lib/atomic/kicad-assets.ts`.
- Exact parts/package terminals/evidence: atomic catalog types and portable published snapshots.
- Existing flat mapping: `app/lib/atomic/mapping.ts`; accepted only as candidate/legacy input, not Stage 4 proof.
- Project/variant mapping reference: `app/lib/physical-binding/*`; Stage 4 creates immutable successors.
- Resolver consumer: `app/lib/footprint-resolver/*`; policy now accepts only supported approved/current Stage 4 tiers.
- PCB sync consumer: `app/lib/pcb-sync/*`; affected plans are staled without board mutation.
- Legacy guess/default paths are unchanged and not imported by Stage 4.

## 4. Implemented verification architecture

- Versioned contracts: `app/lib/mapping-verification/types.ts`.
- Canonical normalization/digests: `stable.ts`.
- Fixed risk/tier/limit policy: `policy.ts`.
- Atomic symbol/footprint plus independent package-terminal adapter: `adapters.ts`.
- Deterministic pure verifier: `verifier.ts`.
- Trusted provider boundary: `providers.ts`.
- Immutable qualification repository and scope locks: `repository.ts`.
- Separate orchestration/persist/approve/revoke/stale service: `service.ts`.
- Stage 1 immutable successor projector: `stage1-projector.ts`.
- Stage 2 dependency/Stage 3 plan invalidation: `invalidation.ts`.
- Pseudonymous metrics: `observability.ts`.
- Default-off rollout: `rollout.ts`.
- API: `app/api/mapping-verification/*`.
- UI: `app/components/pcb/MappingVerificationPanel.tsx`.

Pure verification returns claims that footprint selection, mapping approval, land-pattern certification, schematic mutation and PCB mutation are all false.

## 5. Supported capability profile

| Construct/profile | Qualification result |
|---|---|
| Exact symmetric resistor/passive with evidenced equivalence | verified exact-part |
| Polarized capacitor/diode orientation | exact-part required; reversed polarity blocked |
| Transistor/FET terminal function variants | exact-part required; function mismatch blocked |
| Multi-unit symbol and hidden power pins | representations collapsed; all logical required pins covered |
| QFN/DFN exposed pad | explicit thermal terminal and pad required |
| Connector shield/mounting pads | distinct electrical/shield/mechanical dispositions required |
| Commoned terminals/pads and stacked representations | supported only through explicit relationship/evidence |
| Electrical equivalence/permutation | explicit class, exact members/permutations and current reviewed evidence required |
| Limited direct pair | only symmetric nonpolar passive; never layout-ready |
| Numeric/name/order, legacy, vendor, API or AI graph | unverified/ambiguous/evidence-insufficient |
| Unknown risk or arbitrary unsupported construct | blocked |

## 6. Verification rules and states

The verifier checks exact scope and identities, dependency/parser versions, endpoints, cardinality, logical/terminal function, polarity, DNC, thermal/shield/mechanical classifications, equivalence, explicit-unmapped legality, complete three-layer coverage, source review/freshness/conflict and risk-tier requirements. It emits deterministic statuses: `verified`, `verified_limited`, `incomplete`, `ambiguous`, `conflicting`, `structurally_invalid`, `electrically_inconsistent`, `evidence_insufficient`, `stale_dependency`, `unsupported_construct`, `unauthorized`, or `error`.

Lifecycle is independent: verification produces no approval. Persistence creates `unreviewed`; reviewer/admin may approve/reject; later evidence/dependency changes create stale/revoked/superseded immutable successors. Exact content/digest, scope, revision and idempotency are checked at every transition.

## 7. Representative results

| Case | Expected/observed result |
|---|---|
| exact nonpolar two-terminal part | `verified`, `exact_part`, 100% at three layers |
| generic numeric `J1` | `ambiguous`, no tier, unsafe heuristic + missing evidence |
| reversed polarized capacitor | `electrically_inconsistent`, two polarity findings |
| wrong SOT-23 transistor variant | `electrically_inconsistent`, function contradiction |
| omitted QFN EP | `incomplete`, terminal and pad coverage findings |
| mapped exact QFN EP | `verified`, `exact_part` |
| hidden multi-unit power pin omitted | incomplete symbol coverage |
| USB shield and mounting pads | verified only with explicit distinct classifications/disposition |
| AI graph at confidence 1.0 | `evidence_insufficient`, no tier |
| changed footprint digest | `structurally_invalid`/stale dependency proof rejected |
| conflicting reviewed source | `conflicting` plus first-class conflict object |

## 8. Persistence and invalidation

The qualification repository stores immutable records, audit events, invalidation events and idempotent results per tenant/project/branch/component/variant with a per-scope lock and optimistic revision. Persisted verification is unapproved. Approval binds the exact mapping content digest and creates a decision ID. Revoke/stale creates successors rather than editing history.

`PhysicalBindingMappingProjector` writes a selected Stage 1 successor containing tier, mapping/result/dependency/content digest, lifecycle, approval, freshness and conflict state. `ScopedMappingInvalidationTarget` records the Stage 2 dependency key (cache remains disabled) and marks affected Stage 3 plans stale. Tests prove an applicable plan becomes stale while the board before/after is identical.

This is not yet one durable production transaction. A projector or invalidation failure relative to another store cannot be crash-recovered across process restart; therefore API mutation remains rollout-gated and strict status is blocked.

## 9. Security and operations

- Authenticated tenant/project/branch/actor/role headers are mandatory; body scope/actor is overwritten.
- Public API accepts JSON only, maximum 4 MB, and forbids uploaded context/candidate/snapshot/evidence/path/URL authority.
- Mutation requires a human editor/reviewer/admin; approval/rejection/revocation requires reviewer/admin.
- Fixed policy cannot disable review/current-evidence/coverage/mechanical gates or enable limited-direct layout.
- Caps: 4,096 pins, 4,096 terminals, 8,192 pads, 16,384 edges/findings, 4,096 evidence, batch 64, timeout 5 s.
- Cancellation propagates; batch work is chunked eight at a time.
- Inspect redacts confidential evidence locators/reviewer IDs.
- Telemetry contains pseudonym, versions, counts, status/tier, reason codes and duration—not raw tenant/project/design/evidence/secrets.
- Rollout states are `off`, `observe`, `opt_in`, `authoritative_supported_profile`; default is `off`, and mutation requires a second opt-in header.

## 10. Verification evidence

Focused Stage 4 tests cover representative electrical correctness, canonical order invariance, immutable lifecycle, concurrent approval, idempotency, real Stage 1 successor projection/readiness, Stage 3 invalidation/no board mutation, API scope/upload/rollout gates, UI truth, non-weakenable policy, evidence conflict, explicit-unmapped attack, cancellation/batch limit, confidential-evidence and telemetry redaction, limited direct-pair gating and 512-terminal bounds.

| Command | Result |
|---|---|
| focused Stage 4 API/domain/UI Vitest | 31/31 passed, 5 files |
| focused Stage 1–4 regression, bounded workers | 148/148 passed, 22 files |
| full repository Vitest, `--maxWorkers=4` | 1,390 passed, 0 failed, 9 skipped; 508/508 suites |
| Stage 4 focused ESLint, `--max-warnings=0` | 0 errors, 0 warnings |
| `pnpm exec tsc --noEmit --pretty false` | exit 0, no diagnostics |
| `pnpm exec drizzle-kit check` | exit 0, `Everything's fine` |
| `pnpm build` | exit 0; `/api/mapping-verification` present; five inherited dynamic-spawn/project-tracing warnings |
| `pnpm mapping:stage4-evidence` | exit 0; machine-readable artifact generated |
| HTTP root / Stage 4 capability route on port 3001 | 200 / 200; state truthfully `off`, all mutation/design claims false |
| broad `pnpm exec eslint . --max-warnings=0` | exit 1; inherited 30 errors/13 warnings; focused Stage 4 lint is clean |
| isolated PostgreSQL apply/rollback/restart | not run; strict blocker |

The nine skips are two real KiCad CLI tests, three ngspice worker integration tests and four live Claude PCB-edit tests. Full JSON: `artifacts/footprint-binding-stage-04/full-suite-bounded.json`. Unrun live PostgreSQL/restart checks are blockers, never passes.

## 11. Performance evidence

Windows x64, Node v24.15.0 evidence in `artifacts/footprint-binding-stage-04/qualification-evidence.json`:

| Fixture | Measurement | Budget |
|---|---:|---:|
| exact two-terminal, 100 samples | mean 1.074 ms; p50 0.770 ms; p95 2.565 ms; max 5.657 ms | p95 < 100 ms |
| exact 512 pin/terminal/pad | 42.532 ms; 100% coverage; zero findings | < 5,000 ms |

Validation and findings were not omitted to meet the budgets. These in-memory measurements do not claim network/database latency, durable transaction latency or production concurrency capacity.

## 12. Documentation and Stage 5 handoff

- `docs/mapping-verification-stage-04.md`: contracts, algorithm, tiers, lifecycle, API/UI, security and rollout.
- `SIRKIT_MAPPING_VERIFICATION_STAGE_04_REPOSITORY_DISCOVERY.md`: authority/legacy/mutation map.
- `docs/mapping-verification-stage-05-handoff.json`: exact consumer gate and prohibitions.
- `progress/2026-07-19/02-footprint-binding-stage-04.md`: concise change record.

Stage 5 may consume only active, approved, current, conflict-free `verified` mappings at accepted tiers with exact digest/dependency match. It may not turn `100n`, `J1`, package text, AI confidence or a limited direct pair into layout authority.

## 13. Limitations/deferred

- Durable mapping/audit/idempotency schema and repository.
- One atomic catalog + Stage 1 projection + Stage 3 invalidation transaction.
- Trusted server snapshot/provider wired to the actual project session.
- Isolated PostgreSQL migration apply/rollback and process-kill/restart recovery.
- Production UI mounting and observe/opt-in cutover.
- Operational load/rate-limit/capacity evidence.
- Stage 1–3 strict blockers, skipped environment/live suites and unrelated broad repository lint debt.
- Land-pattern geometry, manufacturing suitability, placement and routing are outside Stage 4.

## 14. Changed-file inventory

Production Stage 4:

- `app/lib/mapping-verification/{types,stable,policy,adapters,verifier,providers,repository,service,stage1-projector,invalidation,observability,rollout,index}.ts`
- `app/api/mapping-verification/{_scope,handler,route}.ts`
- `app/components/pcb/MappingVerificationPanel.tsx`
- Stage 1/2/3 consumers: `app/lib/physical-binding/{types,validation,readiness}.ts`, `app/lib/footprint-resolver/{types,policy,engine,stable}.ts`, `app/lib/pcb-sync/{policy,repository}.ts`

Tests/evidence:

- `app/lib/mapping-verification/__tests__/{fixtures,verification-corpus,lifecycle-invalidation,security-performance}.test.ts` (fixture file has `.ts`)
- `app/api/mapping-verification/__tests__/handler.test.ts`
- `app/components/pcb/__tests__/mapping-verification-panel.test.tsx`
- `scripts/mapping-stage4-evidence.ts`
- `artifacts/footprint-binding-stage-04/qualification-evidence.json`
- `package.json` adds only `mapping:stage4-evidence` for this stage.

Documentation:

- `SIRKIT_MAPPING_VERIFICATION_STAGE_04_REPOSITORY_DISCOVERY.md`
- `SIRKIT_FOOTPRINT_BINDING_STAGE_04_IMPLEMENTATION.md`
- `docs/mapping-verification-stage-04.md`
- `docs/mapping-verification-stage-05-handoff.json`
- `progress/2026-07-19/02-footprint-binding-stage-04.md`

No Stage 4 database migration is claimed. The protected worktree contains extensive earlier-stage edits and artifacts; they were preserved. The original `C:\Users\robsa\sirkit` was not touched.
