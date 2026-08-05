# Sirkit CD-12 supply-chain and release-engineering implementation

## Outcome

Sirkit now has a provider-neutral, deterministic CD-12 foundation that consumes rather than rewrites CD-1 through CD-11 and PCB-stage truth. It models exact manufacturer/supplier identities, total assembly-variant projections, authoritative BOM lineage, volatile non-reserved sourcing observations, exact-decimal procurement scenarios, full-dimension alternates, lifecycle/supply risk, exact package/process evidence, site-scoped manufacturing capability, DFM/DFT review, CD-11 manufacturing/test bindings, inner artifact manifests, change/exception/approval governance, risk registers, immutable release manifests and fixed release-level gates.

The system explicitly distinguishes `CAD-ready`, `quote-ready`, `build-ready` and `production-released`. It cannot purchase, send an external request, approve a substitution/waiver/release, create manufacturing bytes, or convert an unexecuted plan into physical evidence.

## Requirement traceability

| CD-12 concern | Implementation |
|---|---|
| Mandatory upstream gate | `problem.ts` validates an integrity-current ready CD-11 decision/package first, then exact PCB/upstream/policy pins. |
| Exact identity | `identity.ts` keeps manufacturer, exact MPN/package/grade, supplier and supplier SKU separate and evidence-bound. |
| Variants and BOM | `bom.ts` requires exactly one population state per usage/variant, preserves usage lineage and excludes DNP from fitted quantities. |
| Volatile providers and procurement | `providers.ts` represents partial/auth/throttle/schema failures; `procurement.ts` applies claim freshness, source authorization, MOQ/MPQ/multiples, exact string-decimal money and non-commitment semantics. |
| Lifecycle and risk | `risk.ts` separates observed factors, model scores, missing-data uncertainty and hard blockers. |
| Alternates | `alternates.ts` requires all 13 compatibility domains; unknown/stale/not-evaluated dimensions prevent drop-in. |
| Assembly and factory | `manufacturing.ts` distinguishes evidence-backed site capability, marketing claims, deterministic preflight and external review. |
| CD-11 production flow | `bindManufacturingTestPackage` binds variants to exact firmware/configuration/identity/fixture/test/calibration references while retaining `definition_only`. |
| Artifacts and archive safety | Per-entry source/generator/settings/digest/convention metadata, required-member checks, case collision/path traversal rejection and cross-consistency certificates. |
| Changes/exceptions/approvals | `governance.ts` validates effectivity, expiry, residual risk, exact subject digest and segregation; side-effect functions fail closed. |
| Release readiness | `readiness.ts` evaluates a fixed evidence matrix sequentially and reports highest justified level plus next-gate witnesses. Physical evidence and human production authority are independent mandatory gates. |
| Persistence and replay | `project.ts`, `lib/persistence.ts`, schema and migration provide immutable digests, optimistic concurrency, audit, archival and explicit import/fork boundaries. |
| AI boundary | Narrow proposal API is proposal-only. It exposes no approval, purchasing, external messaging, raw exporter or artifact-write tool. |

## Production-file change ledger

| File | Purpose / invariants | Verification and compatibility |
|---|---|---|
| `app/lib/release-engineering/types.ts` | Versioned authoritative schemas for all CD-12 identities, evidence, BOM/supply/manufacturing/governance/release and future build records. | TypeScript compile; additive. |
| `stable.ts` | Canonical stable IDs/digests and set ordering. | Determinism/digest tests; reuses repository canonical JSON. |
| `capability.ts` | Explicit supported, external-review and unsupported profile with quotas/policies. | Benchmark scale/authority; additive. |
| `problem.ts` | Fail-first CD-11 and PCB prerequisite gate with exact revision lock. | Unit/API negative tests; no weakening of CD-11. |
| `identity.ts` | Reviewed manufacturer/part/supplier/SKU graph, expiry, conflict, broker and secret checks. | Foundation/type tests; CD-6 remains source input. |
| `bom.ts` | Deterministic population matrix, usage-preserving BOM and independent quantity/DNP certificate. | Golden and negative unit tests; old BOM API unchanged. |
| `providers.ts` | Provider-neutral ingestion result and visible failure states. | Validation rules; no live provider or credential added. |
| `procurement.ts` | Freshness/authorization normalization, exact demand, exact decimals, pack/MOQ allocation and infeasibility witnesses. | Exact-cost/non-reservation test; scenarios have no order side effect. |
| `risk.ts` | Transparent observed/model/missing-data supply risk with hard-blocker precedence. | TypeScript and foundation integration; no forecast presented as fact. |
| `alternates.ts` | Mandatory dimension matrix, conditions, reverification and safe classification. | Unknown-dimension negative test. |
| `manufacturing.ts` | Exact capability matching, DFM/DFT request compilation, CD-11 binder and artifact/cross-consistency manifest. | Marketing-only and incomplete-archive negative tests. |
| `governance.ts` | ECO/exception scope, approval digest/segregation and side-effect denial. | Authority tests; additive. |
| `readiness.ts` | Fixed sequential release evidence matrices and immutable candidate/manifest materialization. | Production-without-evidence negative test. |
| `project.ts` | Aggregate lifecycle, validation, optimistic transaction audit and precise supersession. | AI-transaction denial/digest tests. |
| `agent-tools.ts` | Narrow typed proposal surface only. | API and unit authority tests. |
| `corpus.ts`, `benchmark.ts`, `index.ts` | 162-case governed qualification manifest, authority/scale executors and exports. | Corpus integrity and benchmark validation. |
| `app/api/release-engineering/_scope.ts` | Size-bounded tenant/project/branch/actor scope. | Route tests; independent API namespace. |
| `problem/route.ts`, `propose/route.ts` | Human-only authoritative problem compile and proposal-only AI endpoint. | Route tests; no external effects. |
| `app/components/release-engineering/ReleaseEngineeringWorkspace.tsx`, `app/release-engineering/page.tsx` | Review UI showing exact current level, blockers and non-claim warnings. | TypeScript/build; additive route. |
| `lib/persistence.ts` | CD-12 current/history storage, CD-11 pin checks, precise archival and unsafe-import rejection. | Existing full suite plus TypeScript; old projects remain readable. |
| `app/lib/db/schema.ts`, `drizzle/0020_cd12_supply_chain_release.sql`, journal | Append-only server records for problems/BOM/snapshots/artifacts/candidates/manifests/assessments/projects. | Drizzle schema compile; forward additive migration. |
| Benchmark type/corpus/executor files | Registers `release_engineering` and three executable packages. | Benchmark validation reports 60 packages. Existing packages unchanged. |

## Security and operations

- All external descriptions, evidence locators and archive names are untrusted; secrets, traversal, absolute paths, control characters and case collisions fail closed.
- Credentials remain referenced by backend secret-system IDs; none are stored in offers, projects, logs or design exports.
- Stable derivations and volatile sourcing data have different identities/freshness. Provider failure never becomes zero stock or empty success.
- Metrics should record only IDs/states/counts/timings for provider failure/freshness, BOM conflicts, shortages, alternate gaps, DFM findings, artifact mismatch, stale approvals and release blockers. Commercial values/design payloads require policy-based redaction.
- Incident response: revoke provider/signing integration, mark affected snapshots/reviews/approvals stale, supersede dependent candidates/artifacts, retain immutable history, and re-evaluate from pinned trusted inputs.

## Verification status

- Focused CD-12/API tests: 12 passed.
- Full serial regression: 180 files passed, 1,223 tests passed, 2 files/9 tests skipped.
- TypeScript and focused ESLint: passed with zero errors/warnings.
- Production build: passed; `/release-engineering` and both CD-12 APIs are present in the route manifest. Existing Turbopack broad-process-path warnings remain outside CD-12.
- Benchmark validation: 60 packages, zero diagnostics; three are CD-12 manifest/authority/scale packages.
- Corpus: 162 deterministic manifest cases, all deliberately `blocked`/`manifest_only` until real evidence exists.
- Diff whitespace check and credential scan: passed. The original `C:\Users\robsa\sirkit` contains no CD-12 directory, migration or report.

## Completion verdict

`BLOCKED`

Primary blocker: `BLOCKED BY CD-11`. The current repository has no runtime CD-11 ready package; CD-11 is itself blocked by CD-10. Current justified release level is `draft` only. Provider/factory/physical/qualified-review evidence required by the 50-deliverable completion rule is also absent. The safe CD-12 foundation, schemas, migrations, gates, API/UI, persistence, corpus and tests are complete and should be retained.
