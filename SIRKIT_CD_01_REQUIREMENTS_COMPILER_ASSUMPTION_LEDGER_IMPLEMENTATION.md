# Sirkit CD-1: Requirements Compiler and Assumption Ledger

Date: 2026-07-17  
Branch: `codex/cd-01-requirements-compiler`  
Protected copy: `C:\Users\robsa\Documents\Codex\2026-07-13\do\work\sirkit-edit`  
Original preserved: `C:\Users\robsa\sirkit`

## 1. Executive implementation summary

CD-1 now has a provider-neutral, deterministic core that turns pinned source revisions and validated structured extraction candidates into one immutable `DesignRequirementsPackage`. The package retains requirement/source lineage, explicit hypotheses/assumptions/defaults, quality diagnostics, typed conflicts, versioned capability decisions, risk-ranked questions, draft Stage 6 proposals, planned verification obligations, a complete acceptance matrix, traceability, semantic diffs, and downstream invalidation keys.

AI output cannot confirm requirements, approve assumptions/packages, activate constraints, erase conflicts, or mark planned verification passed. This stage does not select architecture, parts, values, schematic connections, or PCB geometry.

Machine-readable evidence is under `artifacts/cd-01/`.

## 2. PCB Stage 1–10 prerequisite evidence

| Stage | Reused contract | Verified boundary |
|---|---|---|
| 1 | stable identity/protected mutation | CD-1 identity is stable by project + lineage key, not wording/order |
| 2 | electrical vocabulary | requirements use deferred roles and do not create a second electrical graph |
| 3 | evidence/readiness states | obligations start `planned`; no requirement or plan becomes pass evidence |
| 4 | stackup/manufacturing vocabulary | requirements can demand physical outcomes without claiming realization |
| 5 | typed component facts/evidence | component facts remain context/evidence, not user requirements |
| 6 | quantities, conditions, constraints | exact units reused; lowering produces a draft proposal only |
| 7 | placement capability vocabulary | downstream responsibility can be planned without placement claims |
| 8 | routing capability vocabulary | unsupported/limited high-speed behavior remains visible |
| 9 | governed corpus/oracles/licenses | four executable CD-1 packages added; 18 fixtures declared |
| 10 | actors, digests, revision vectors, dependencies, conflicts | adapter reuses these contracts; canonical Stage 10 operations remain PCB-only |

The verified Stage 10 limitation prevented an unsafe attempt to encode requirements as nanometre PCB operations. It does not block the deterministic compiler, but it does prevent claiming full product-wide collaboration cutover.

## 3. Existing-intent inventory

The machine-readable inventory is `artifacts/cd-01/intent-inventory.json`. Principal findings:

| Current source | Risk | Decision |
|---|---|---|
| schematic/build prompt | request-scoped free text can bypass CD-1 | later cut over through immutable ingestion; not silently changed here |
| chat `designConstraints` | untyped parallel truth | deprecate as authority; use stable package/constraint refs |
| Stage 6 documents | real typed constraint truth | preserve; link only through justified draft lowering |
| fabrication/manufacturing profiles | defaults can resemble intent | retain as named profile source/default |
| Stage 5 claims | catalog fact can resemble requirement | keep as feasibility context/evidence |
| Stage 3 checks | planned work can resemble evidence | keep separate; no CD-1 pass |
| Stage 9 expectations | test oracle can resemble product requirement | keep benchmark-scoped |
| legacy prose/constraints | authority/provenance often missing | import prose as proposed; report orphan constraints |

## 4. Requirements architecture

Pipeline:

```text
pinned untrusted source artifacts
→ strict structured extraction candidates
→ schema/unit/source-span validation
→ stable lineage + deterministic normalization
→ quality/conflict/capability analysis
→ assumptions + risk-ranked questions
→ draft Stage 6 proposal + planned obligations
→ coverage/traceability/diff/invalidation
→ approval-gated immutable package revision
```

`app/lib/requirements/compiler.ts` is deterministic and contains no LLM SDK. Provider/model/prompt/tool references live only in extraction provenance.

## 5. Schema specification

`app/lib/requirements/types.ts` defines the full JSON-only contracts for sources, requirements packages and revisions, authority/strength/status, predicates, assumptions, defaults, questions, conflicts, capabilities, obligations, proposals, traceability, coverage, diffs, and transactions.

Package identity is stable by project. Requirement identity is stable by project plus explicit lineage key. Semantic change increments revision and retains `previousRevisionId`.

## 6. Source and authority policy

- Every source is pinned by logical ID, exact source version, artifact digest, tenant/project, media type, capture time, access policy, privacy class, and benchmark-use policy.
- Source text is always `untrusted_evidence`; instruction-like content becomes a cited diagnostic.
- Same source ID/version with different content is rejected as an immutable collision.
- Confirming authority is restricted to explicit project-owner/stakeholder/organizational/contractual classes plus human approval.
- Manufacturer, legacy, AI, observation, and untrusted sources cannot silently confirm project intent.

## 7. Units, predicates, and conditions

CD-1 reuses Stage 6 `ConstraintQuantity`, `TypedRequirement`, exact decimal comparison, unit normalization, and `ConditionExpression`. Numeric bounds retain inclusivity. Target tolerances retain separate plus/minus quantities. Conditions evaluate `true`, `false`, or `unknown`; unknown does not erase a hard requirement.

Additional CD-1 predicate forms cover named qualitative rubrics, external evidence, and temporal sequences. Scientific notation, unsupported units, dimension mismatch, malformed ranges, and out-of-bounds source spans are rejected.

## 8. Extraction and deterministic compiler

Extraction envelopes require source span, stable candidate/lineage identity, typed classification, predicate/units, conditions, missing fields, ambiguity, confidence, rationale, actor, and provider-version references where applicable. Unknown fields and AI-confirmed status are rejected.

Canonical ordering covers requirements, sources, approvals, diagnostics, conflicts, questions, proposal items, obligations, graph nodes/edges, and coverage. Reordered equivalent candidates produce the same package digest.

Automatic compound splitting and broad semantic similarity remain incomplete; compounds are diagnosed for explicit review.

## 9. Assumption/default policy

Unknown, hypothesis, assumption, default, and confirmed requirement are distinct records. Assumption risk is raised deterministically from affected domains/criticality/capability. Safety/high-energy/supply/temperature premises cannot be under-classified. AI cannot self-approve; high-risk acceptance needs authorized human approval and expiry/invalidation.

Rejection, expiry, invalidation, or confirmation increments assumption history and emits exact requirement/decision/dependency invalidation keys. Defaults retain named profile revision, authority, override policy, condition, and status.

## 10. Quality and conflict report

Implemented diagnostics cover vague terms, missing subjects, missing numeric reference conditions, compounds, aspirations, ambiguous references, external standard scope, extraction ambiguity/missing fields, duplicates, and unassessed capability.

Implemented typed conflicts cover empty numeric ranges, exact-value contradiction, empty allowed/forbidden intersection, and capability limits. Each retains stable IDs, normalized values, conditions, minimal contributing set, severity, explanation, and permitted actions. Budget overcommitment, mandate-vs-function, and generalized semantic refinement remain incomplete.

## 11. Capability profile report

`embedded-low-voltage-v1@1.0.0` is immutable and digest-checked. It models low-voltage embedded work, common interfaces, USB Full Speed, regulated DC, 2–4 layer PCB, precision analog exploration, external compliance, and explicitly unsupported/external domains including mains, life safety, high-energy battery, intrinsic safety, RF/microwave, high-current power, and DDR-class links.

Support states remain distinct: supported/verifiable, limited, exploration-only, external review, unsupported, and unknown. A confirmed hard unsupported demand blocks autonomous progression.

## 12. Clarification-question report

Questions derive from deterministic diagnostics/conflicts. The score breakdown explicitly records safety, feasibility, downstream impact, architecture sensitivity, wrong-assumption cost, capability impact, verification impact, default availability, and user effort. Stable sorting places high-risk blockers first. Questions cite the exact requirement and why the answer matters.

## 13. Requirement-to-constraint lowering

`app/lib/requirements/lowering.ts` emits `ConstraintPatchProposal` with `activationState: not_active`. Explicit stable roles can lower to draft Stage 6 definitions for trace width, clearance, via geometry, route length, pair skew, and target impedance. Power/interface/outline/component roles remain typed and deferred until owning stages resolve stable objects. No component, rail, net, or interface is invented.

Unsupported mappings remain visible with a limitation and do not delete the requirement.

## 14. Verification and acceptance matrix

Every active hard/target/externally mandated requirement receives a planned obligation. Methods include analysis, ERC/application check, simulation, PCB checks, demonstration, supplier evidence, external certification, and human rubric. Responsible stages/authorities and required inputs are explicit.

Coverage exposes no-plan/planned/partial/full/not-run/pass/fail/unknown/unsupported/external/stale. At CD-1, generated obligations are `planned` with empty evidence refs.

## 15. Traceability and invalidation

The graph links source → requirement → assumption/question/conflict → proposal/obligation. Semantic diff covers source, requirement fields, assumptions, capabilities, and obligations. Changed requirement/assumption keys invalidate matching downstream artifacts plus the package dependency key.

Product-wide invalidation awaits Stage 10 intent-domain cutover.

## 16. UI, API, and AI workflow

- `RequirementsWorkspace` separates confirmation, capability, questions, blockers, and evidence axes; “Evidence passed” starts at `0 (planned only)`.
- Scoped APIs ingest sources, compile packages, and expose server-owned capability metadata.
- The compile API requires tenant/project/actor scope headers and replaces caller-supplied capability profiles with the server registry.
- AI tools are represented by the strict extraction/transaction contracts. AI confirmation/approval operations are rejected.

The workspace component is not yet connected to live project navigation or the schematic generation gate.

## 17. Collaboration, persistence, and security

Local project persistence accepts only integrity-valid packages bound to the project ID. PostgreSQL migration `0009` stores immutable sources, package revisions, transaction records, and capability profiles. The server repository validates exact source-set/profile/package/transaction bindings in one database transaction.

The transaction adapter reuses Stage 10 actors, project revision vectors, digests, and dependency patterns. Concurrent overlap produces semantic conflict. Unsafe answer/conflict close operations without a structured requirement patch are rejected. Requirements undo/restore, production server sync, and full canonical Stage 10 integration remain incomplete.

## 18. Benchmark and quality report

The 18 governed fixture declarations cover every required corpus category. Four executable Stage 9 packages passed independent analytical oracles:

| Package | Result | Runtime |
|---|---:|---:|
| determinism | pass | 18.4 ms |
| malicious source | pass | 9.1 ms |
| vague hidden holdout | pass | 16.8 ms |
| 500-requirement scale | pass, 3/3 | 0.90 / 1.45 / 2.24 s |

The scale case produced 500 requirements and 500 acceptance rows. A declared expert rubric exists, but qualified blind review was not run.

## 19. Incremental/full equivalence and performance

Atomic transactions perform deterministic full recompilation and semantic diff. Reordering tests prove digest equality. A complete incremental compiler and long mutation-sequence differential oracle are not implemented, so incremental/full equivalence is partial.

UI filter, collaboration merge, PDF/OCR ingestion, and model extraction p50/p95/cost are not measured.

## 20. Files changed

- Core: `app/lib/requirements/{types,stable,source,conditions,validation,compiler}.ts`
- Policy/analysis: `assumptions.ts`, `capability.ts`, `diagnostics.ts`, `questions.ts`
- Derivatives: `lowering.ts`, `verification.ts`, `traceability.ts`
- Collaboration/migration: `transactions.ts`, `migration.ts`
- Corpus/benchmark: `corpus.ts`, `benchmark.ts`, Stage 9 types/corpus/executor
- Consumers: requirements APIs, `RequirementsWorkspace.tsx`, `lib/persistence.ts`
- Database: `app/lib/db/schema.ts`, `drizzle/0009_cd01_requirements_compiler.sql`
- Tests: five CD-1 core/API suites plus UI test
- Evidence: this report, progress entry, `scripts/cd1-evidence.ts`, `artifacts/cd-01/*`

## 21. Test evidence

See `artifacts/cd-01/test-matrix.json` for all 45 categories.

```text
CD-1 + Stage 9 focused: 74 passed
Stage 9 corpus validation: 24 packages, 0 diagnostics
CD-1 benchmark runs: 4 passed
Full suite single worker: 895 passed, 9 skipped
Default parallel full suite: 891 passed, 9 skipped, 4 timing failures
Exact affected tests isolated: 40 passed
TypeScript: passed
Focused ESLint: passed, zero warnings
Production build: passed
```

The parallel failures were performance-only: 30-part auto-place took 603 ms versus 500 ms, 100-part auto-place and 500-track route preview exceeded the 5-second file timeout under whole-suite contention, and repair snapshot was ~290 ms versus 250 ms. The exact three affected files passed 40/40 in isolation (representative 100-part/route/snapshot results: ~3.0 s, ~2.9 s, and 102 ms). No functional assertion failed.

## 22. Remaining limitations

1. Live project creation, chat, and schematic/build paths do not yet require an accepted CD-1 package.
2. Stage 10 canonical state/operation union is PCB-only; full requirements undo/restore/server collaboration/invalidation is not deployed.
3. PDF/DOCX/OCR/table/revision-bar and provider-backed extraction adapters are absent.
4. Compound split/merge, refinement, budget, mandate, source-revision, and verification-impossibility algorithms are incomplete.
5. Only four of 18 corpus categories are executable Stage 9 packages; no qualified expert/model-provider study ran.
6. Auth headers are a scoped API boundary, not production identity/authentication deployment.
7. Database migration was generated but not applied to an external database.
8. Default parallel PCB performance gates remain contention-sensitive despite isolated and serial pass evidence.

## 23. Completion verdict

The deterministic CD-1 foundation is real and usable, but unchecked applicable acceptance criteria remain.

### `CD-1 INCOMPLETE`
