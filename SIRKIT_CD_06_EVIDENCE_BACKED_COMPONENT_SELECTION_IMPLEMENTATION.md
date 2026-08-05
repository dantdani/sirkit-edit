# Sirkit CD-06 Evidence-Backed Component Selection and BOM Candidate Engine

Date: 2026-07-18  
Branch: `codex/cd-06-component-selection`  
Specification SHA-256: `255A3279CBC92E70D5FAE161A3014173C3E9E17895A9A7E3CC1A0DF8E04D9EF8`  
Protected working copy: `C:\Users\robsa\Documents\Codex\2026-07-13\do\work\sirkit-edit`  
Protected original: `C:\Users\robsa\sirkit` (unchanged)

## Outcome

Sirkit now has a repository-native CD-06 foundation that compiles exact component-role requirements, queries immutable atomic catalog snapshots, resolves exact manufacturer-scoped identities, evaluates hard evidence gates, reconciles exact CD-3/CD-4/CD-5 obligations, records timestamped sourcing observations, and constructs complete joint preliminary BOM candidates.

The engine fails closed. Unknown, conflict, stale, unsupported, external-review, provider-failure, search-limit, and resource-limit states remain distinct. A typical or absolute-maximum value cannot prove a guaranteed operating bound. A supplier SKU is never electrical identity. CAD file presence alone is not proof of package or terminal mapping. Alternatives are independently evaluated and never automatically substituted. AI is proposal-only; a human reviewer/project-admin must approve a candidate.

## Baseline preservation

- The existing Stage-5 atomic catalog and `ProjectComponentPin` path remain the source of immutable part/CAD evidence.
- The legacy `app/lib/bom/build.ts` value/grouping and distributor facade remains available to existing clients, but it is not treated as the authoritative CD-06 decision engine.
- The older one-instance `atomic/agent-tools.ts` proposal path remains intact. CD-06 adds a stricter joint role/BOM path instead of silently changing its semantics.
- Existing schematic and PCB state are never mutated by CD-06 activation, evaluation, selection, or export.

## Core implementation

- `types.ts`, `stable.ts`, and `capability.ts`: immutable typed contracts, deterministic IDs/digests, strict unknown policy, capability classes, resource limits, freshness limits, and exact CD-1-through-CD-5 signoff.
- `role-compiler.ts` and `problem.ts`: compile selected published CD-5 role slots into typed requirements while preserving upstream IDs, conditions, assumptions, mandates, reconciliation needs, and downstream obligations. Exact chain mismatches fail in prerequisite order.
- `identity.ts` and `catalog.ts`: manufacturer-namespace identity, incomplete/ambiguous/revoked states, evidence-backed aliases, immutable catalog manifests, stable pagination, and category proof from reviewed claims.
- `gates.ts`, `logic.ts`, and `reconciliation.ts`: four-valued/evidence-state logic; category, electrical, environmental, package, terminals, CAD, lifecycle, sourcing, and CD-3/CD-4/CD-5 gates; exact CAD/package/mapping certificates; no silent unknown pass.
- `sourcing.ts`: immutable provider observations, freshness, provider-failure states, MOQ/order-multiple rounding, pack-versus-each normalization, safe integer minor-currency arithmetic, and explicit tax/shipping/duty unknowns.
- `solver.ts`, `objectives.ts`, and `bom.ts`: deterministic bounded joint enumeration, compatibility and hard budget constraints, complete-role coverage, unsat explanations, raw objective vectors, Pareto analysis, exact assignment aggregation, and preliminary-only exports.
- `alternatives.ts`, `fixed-point.ts`, `feedback.ts`, and `handoffs.ts`: independent alternative proof, no automatic substitution, bounded expansion/oscillation detection, typed CD-7-through-CD-13 feedback, and planned-not-verified downstream contracts.
- `decision.ts`, `project.ts`, and `transactions.ts`: human-only approval, optimistic concurrency, authorization, idempotency, atomic rollback, immutable invalidation successors, deep reference/digest validation, and project history.
- `agent-tools.ts`: narrow proposal-only AI catalog-search filters. The shared provider-neutral LLM router can propose pinned IDs but cannot evaluate, select, approve, suppress gates, invent properties, or modify schematic/PCB truth.

## Product, persistence, and API surfaces

- `/component-selection?project=<project-id>` shows role coverage, exact identity/package, CAD certificate state, hard gates and conditions, CD-3/CD-4/CD-5 reconciliation, objective vectors, sourcing timestamps, alternatives, obligations, authority, and audit history.
- Ten scoped APIs cover problem compilation, catalog query/identity resolution, one/batch evaluation, joint solve, sourcing normalization, alternatives, transactions, deterministic export, downstream feedback, and proposal-only AI.
- Browser persistence stores `componentSelectionProgram` separately from schematic, PCB, and legacy per-instance atomic pins. Upstream/catalog changes archive the superseded CD-06 state rather than rebinding it.
- `drizzle/0014_cd06_component_selection.sql` and the Drizzle schema add immutable signoff, problem, catalog, sourcing, offer, evaluation, candidate, alternative, decision, and idempotent transaction records.
- Exports include a canonical nested JSON bundle and always state `NOT_RELEASED_FOR_PURCHASING_OR_PRODUCTION`.

## Requirement-to-evidence matrix

| CD-06 invariant | Implementation | Automated evidence |
|---|---|---|
| Exact manufacturer identity, no fuzzy merge | `identity.ts`, `catalog.ts` | manufacturer namespace, incomplete MPN, deterministic query tests |
| Unknown/conflict/stale never pass a hard gate | `logic.ts`, `gates.ts` | four-valued logic and hard-evidence tests |
| Typical/absolute maximum cannot prove operating bounds | `gates.ts` | absolute-maximum adversarial test |
| Exact CAD/package/terminal proof | `gates.ts`, atomic validation | exact CAD and reconciliation test |
| Immutable sourcing with correct quantity arithmetic | `sourcing.ts` | MOQ, multiple, pack, price, freshness tests |
| Joint rather than row-by-row selection | `solver.ts` | globally infeasible local choices and independent oracle test |
| Hard budget cannot be offset by a preference | `solver.ts` | unknown hard-cost budget test |
| BOM is exact and preliminary | `bom.ts`, export API | exact aggregation and release-label test |
| Alternatives are independent and not automatic | `alternatives.ts` | downgrade-to-search and `automaticSubstitutionAllowed=false` test |
| Expansion terminates or reports oscillation | `fixed-point.ts` | oscillation test |
| AI cannot approve or transact | `decision.ts`, `transactions.ts`, proposal API | AI approval and AI transaction rejection tests |
| CD-5 must actually be complete and current | `problem.ts`, page gate | end-to-end `BLOCKED BY CD-5` test |
| APIs are scoped and fail closed | ten API routes | nine API-boundary tests |

## Governed corpus and benchmark evidence

All 94 minimum corpus classes from the specification are registered with immutable hashes in `component-selection/corpus.ts`. They are deliberately marked `manifest_only`; a manifest is not misreported as licensed datasheet evidence, supplier replay, expert golden, hardware validation, or complete mutation coverage.

- Manifest: `benchmark-run:fdcb49a2445c539281f06370b17c3712` — passed, 94 visible manifest-only cases, zero invalid hashes.
- Authority boundary: `benchmark-run:0f923a94779cd9461d8822151e3e65c7` — passed.
- Deterministic 10,000 exact-identity scale: `benchmark-run:7d9bd6cc7b37095b841fbf0a0682036c` — passed.
- Complete governed Stage-09 manifest: 42 packages, zero diagnostics.

## Verification

| Check | Result |
|---|---|
| Focused CD-06 domain/API tests | 2 files, 23 passed |
| Complete Sirkit suite | 165 files passed; 1,087 tests passed, 9 skipped, 0 failed |
| TypeScript | passed |
| Focused ESLint | passed with zero warnings/errors |
| Production build | passed; CD-06 page and ten CD-06 API routes emitted |
| CD-06 benchmark packages | 3/3 passed |

The build retains five existing Turbopack file-tracing warnings for Java/FreeRouting, ngspice, and `next.config.ts`; none originates in CD-06.

## Honest remaining blockers

- The repository's real CD-05 state is not complete (and CD-05 is itself formally blocked by CD-04), so production CD-06 activation correctly displays `BLOCKED BY CD-5`.
- No production reviewed CD-5 recipe pack is selected, and no production exact catalog candidate pool is available for a real complete joint BOM.
- The 94 required corpus classes are governed manifests, not full licensed source captures, goldens, holdouts, supplier replays, mutation/metamorphic fixtures, or expert-reviewed evidence.
- Only the bounded deterministic enumerator is implemented. Large industrial problems may need a separately verified CP-SAT/SMT/MILP backend with proof/certificate parity.
- No approved live sourcing provider is configured. The API returns provider unavailable rather than inventing price, stock, or lead time.
- Currency/FX normalization across snapshots, account-pricing retention policy, full legal/compliance review, expert signoff, hardware evidence, and CD-7-through-CD-13 validation remain incomplete.
- CD-06 does not claim final values, released BOM, schematic/ERC, simulation, firmware, PCB, SI/PI/EMC, safety, certification, purchasing, or production release.

## Formal verdict

### `BLOCKED`

Primary blocker: `BLOCKED BY CD-5`. The safe CD-06 architecture, APIs, UI, persistence, tests, and governed manifests are implemented and regression-clean, but the prerequisite production evidence and full verification corpus required for a genuine CD-06 completion verdict do not yet exist.
