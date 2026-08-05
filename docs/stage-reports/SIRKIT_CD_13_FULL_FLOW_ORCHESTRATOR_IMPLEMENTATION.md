# Sirkit CD-13 full-flow orchestrator implementation

## Outcome

Sirkit now has a typed CD-13 foundation for requirements-to-release orchestration. It registers all 22 CD/PCB owners, pins an immutable run context, creates event-sourced runs, meters stage jobs under hard budgets, preserves final-verification reserve, builds canonical isolated candidate branches, compares feasible candidates with uncertainty-aware Pareto rules, normalizes typed feedback, computes minimal conflict/hitting sets, backjumps to the closest causally sufficient owner, learns scoped nogoods, detects semantic cycles/stagnation, builds evidence/trace/replay records, and computes exactly one of seven runtime verdicts.

The planning model is proposal-only. It cannot commit run transitions, lower-stage truth, PCB coordinates/copper, approvals, arbitrary tools or external side effects.

## Requirement traceability

| Requirement family | Implementation |
|---|---|
| Stage ownership/capability | `registry.ts`, `adapters.ts`, `prerequisite.ts` |
| Request/context/autonomy/budget | `request.ts`, `budget.ts` |
| Durable event state and terminal semantics | `state-machine.ts`, `project.ts` |
| Idempotent jobs, leases and stale results | `jobs.ts` |
| Hierarchical decisions/candidates/branches | `candidates.ts`, `search.ts` |
| Fidelity and final reserve | `search.ts`, `budget.ts` |
| Raw objectives, uncertainty and Pareto | `objectives.ts` |
| Typed feedback, diagnosis and backjump | `feedback.ts` |
| Semantic cycles/stagnation | `cycles.ts` |
| Evidence, traces and four replay modes | `evidence.ts` |
| Seven deterministic runtime verdicts | `verdict.ts` |
| Proposal-only AI and side-effect containment | `agent-tools.ts`, API policy |
| Persistence/migration/API/UI/benchmarks | local persistence, Drizzle `0021`, `/api/full-flow/*`, `/full-flow`, 161-case corpus and three benchmark packages |

## Production-file change ledger

| File | Purpose, invariant and compatibility | Verification / remaining risk |
|---|---|---|
| `app/lib/full-flow/types.ts` | Versioned run, registry, event, job, candidate, objective, feedback, evidence, replay and verdict schemas. Additive. | TypeScript; deployed providers still need conformance. |
| `stable.ts` | Canonical CD-13 IDs/digests. | Semantic identity tests; browser-safe hash is not a signing primitive. |
| `registry.ts` | 22-stage capability descriptors, intersection and version checks. | Missing-stage negative test; generated descriptors require native qualification. |
| `adapters.ts` | Provider-neutral request/response and ownership enforcement. | Partial/tamper rules; concrete stage adapters remain. |
| `prerequisite.ts` | Exact implementation-stage CD-12/registry gate. | `BLOCKED BY CD-12` tests. |
| `request.ts` | Typed brief/outcome/autonomy/context and approved default budget. | Request/API tests; natural-language extraction remains CD-1 proposal work. |
| `budget.ts` | Exact integer-cost accounting, stage/candidate/backtrack/question limits and final reserve. | Reserve tests; distributed reservations need backend transactions. |
| `state-machine.ts` | Legal lifecycle graph, immutable chained events, optimistic transitions and terminal immutability. | Event/AI/terminal negative tests; deployed checkpoint compaction remains. |
| `jobs.ts` | Idempotency keys, leases, budget admission, stale/cancelled result retention and duplicate commit check. | Job tests; no deployed queue/worker daemon. |
| `project.ts` | Aggregate run/project construction and integrity validation. | Run pin/event tests; append-only server repository still needed. |
| `candidates.ts` | Canonical assignments, immutable parent/delta branches, graph edges, nogoods and pruning. | Duplicate/sibling tests. |
| `search.ts` | Nine fidelity levels, bounded enumeration/frontier and final-reserve policy. | Bound/fidelity tests; learned search is intentionally absent. |
| `objectives.ts` | Raw vectors and robust interval Pareto dominance. | Missing/overlap negative tests; target/ordinal utility remains incomparable. |
| `feedback.ts` | Typed native feedback, minimal hitting sets, deepest repair stage, scoped nogood. | Diagnosis/backjump tests; large-graph solver optimization remains. |
| `cycles.ts` | Semantic repeat, decision reversal, feedback repeat and stagnation action. | A→B→A/bound tests. |
| `evidence.ts` | Claim support checks, ordered traces, replay bundles and divergence classes. | Dangling/replay tests; signing/redaction provider integration remains. |
| `verdict.ts` | Deterministic exclusive runtime verdict and allowed/prohibited claims. | All seven verdicts tested. |
| `agent-tools.ts` | Narrow proposals and unreachable generic/approval/external tools. | Authority tests. |
| `corpus.ts`, `benchmark.ts`, `index.ts` | 161-case qualification manifest and executable authority/scale metadata. | Corpus/benchmark validation; manifest is not executed evidence. |
| `app/api/full-flow/_scope.ts` | Size/tenant/project/branch/actor boundary. | Route tests. |
| `run/route.ts` | Human-created draft run with explicit prerequisite result. | API test; no lower-stage artifact is created. |
| `propose/route.ts` | Bounded proposal-only AI surface. | API authority test. |
| `transition/route.ts` | Integrity-checked non-LLM transition endpoint. | AI rejection test; production authorization service remains. |
| `FullFlowWorkspace.tsx`, `/full-flow/page.tsx` | Run/gate/candidate/budget/blocker review UI. | TypeScript/build; not an authoritative decision surface. |
| `lib/persistence.ts` | CD-13 local state/history validation, CD-12 successor archival and explicit import boundary. | Full suite; browser storage is not the production event store. |
| `app/lib/db/schema.ts`, migration `0021`, journal | Append-only context/run/event/invocation/candidate/verdict/replay/project records. | Schema compile; deployment migration not applied here. |
| Benchmark corpus/executor | Three CD-13 packages using existing public runner. | Expected total: 63 packages, zero diagnostics. |

## Security and operational controls

- User/retrieved/provider content remains data, not instruction; only allowlisted typed proposals exist.
- AI actors cannot commit transitions or authoritative stage results.
- Late/stale/cancelled outputs remain auditable artifacts but cannot mutate the current state.
- Hard gates are evaluated before Pareto ranking; missing/overlapping metrics cannot dominate by omission.
- Costs, candidates, stage calls, retries, questions, backtracks and semantic repeats are bounded.
- Ordinary tools cannot shell, write arbitrary files/databases/geometry, message, purchase, manufacture, operate lab tools or approve/release.
- Hidden-holdout requests pin `candidateCanAccessOracle: false`; full ACL/leakage qualification remains a blocker.

## Verification status

- Focused CD-13/API suite: 16 tests passed.
- Full serial regression: 182 files passed, 1,239 tests passed; 2 files/9 tests skipped.
- TypeScript and focused ESLint: passed with zero errors/warnings.
- Production build: passed; `/full-flow` and all three `/api/full-flow/*` routes are present. Existing Turbopack dynamic process-path warnings remain outside CD-13.
- Benchmark registry: 63 packages, zero diagnostics; three packages cover CD-13 manifest, authority and bounded scale.
- Diff whitespace check and credential scan: passed.
- Original protection: `C:\Users\robsa\sirkit` contains no CD-13 directory, migration or report.

## Completion verdict

`BLOCKED`

Primary blocker: `BLOCKED BY CD-12`, transitively CD-11/CD-10. Current justified full-flow milestone is a durable `created` draft run with capability/proposal analysis only. Complete native adapter conformance, deployed queue/recovery, executed full-board corpus, hidden-holdout/statistical evidence, security/chaos/mutation campaigns and qualified cross-domain review are also missing. The implemented foundation is safe to retain and extend.
