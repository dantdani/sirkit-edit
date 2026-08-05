# Sirkit CD-05 Executable Circuit Knowledge and Reference-Design Compiler

Date: 2026-07-17  
Branch: `codex/cd-05-circuit-knowledge`  
Specification SHA-256: `27B5C3DB3BAA0B7C7CAA4998966C26D70D4DE82191009E0F5A9E81DA384D2FBD`  
Protected working copy: `C:\Users\robsa\Documents\Codex\2026-07-13\do\work\sirkit-edit`  
Protected original: `C:\Users\robsa\sirkit` (unchanged)

## Outcome

Sirkit now has a repository-native CD-05 foundation for evidence-backed executable circuit recipes. It separates source capture, extracted proposals, reviewed recipe definitions, compiled artifacts, project bindings, composition plans, lifecycle, and UI state. The compiler describes semantic roles, ports, terminal contracts, topology, applicability, parameters, equations, constraints, verification obligations, and typed downstream handoffs without selecting exact components or values and without creating schematic or PCB objects.

The system fails closed. It does not use `eval`, arbitrary scripts, imports, plugins, filesystem, network, process, clock, random state, or an LLM as a circuit-truth engine. OCR/LLM claims are always quarantined. Published matching accepts only exact, immutable recipe revisions whose compiler artifact is publication-eligible. Unknown, stale, conflict, unsupported, external-review, and resource-limit states remain visible.

## Prerequisite and authority gates

- `problem.ts` requires exact human `CD-1 COMPLETE` through `CD-4 COMPLETE` signoffs, selected compatible revisions, complete hard gates, typed CD-5 handoffs, and a matching digest chain.
- A second signoff pins PCB Stage 1-6, 9, and 10 foundation revisions. A mismatch returns the corresponding `BLOCKED BY PCB STAGE N` verdict.
- The current repository CD-04 report has verdict `CD-4 INCOMPLETE`; therefore a real production CD-05 activation correctly returns `BLOCKED BY CD-4`.
- AI can submit only a quarantined proposed claim or novel proposal. Human reviewer/project-admin authority is required for approval, publication, and selection.

## Core implementation

- `types.ts`, `stable.ts`, and `capability.ts`: versioned immutable schemas, stable IDs/digests, supported/external-review/unsupported scope, resource limits, and exact prerequisite signoffs.
- `source.ts`: source/license/record/evidence/location closure, content and excerpt hashes, freshness, source conflicts, authority, redistribution controls, and machine-extraction quarantine.
- `expression.ts` and `model-registry.ts`: bounded typed AST, static dimensional checking, deterministic evaluation, precision limits, unknown propagation, and a closed versioned model-adapter registry owned by CD-7.
- `graph.ts` and `compiler.ts`: canonical order-independent topology identity, role/port/terminal/cardinality/reference checks, forbidden shorts/output contention/orphans, evidence closure, equation DAG checks, review/publication gates, structured diagnostics, and non-overclaiming CD-6/CD-7/CD-8/CD-9/PCB handoffs.
- `applicability.ts`, `overlay.ts`, and `composition.ts`: executable applicability states, exact scope hierarchy, restricted typed refinement, empty/widened range rejection, canonical order-independent composition, full port contract signatures, explicit shareability, conflicts, limits, certificates, and independent oracles.
- `matching.ts`, `novel.ts`, and `lifecycle.ts`: published-only hard filtering, complete obligation coverage, no exact selection, Pareto records without invented scores, project-restricted novel designs, transition authorization, and semantic change classification.
- `library.ts`, `project.ts`, and `transactions.ts`: immutable libraries/projects, optimistic concurrency, scope, authorization, idempotency, atomic rollback, inverse operations, stale dependency invalidation, and semantic diff.

## Product and persistence surfaces

- `/circuit-knowledge?project=<project-id>` shows the pinned chain, recipe requests, coverage, recipe/review/evidence/compiler states, quarantine count, and explicit authority/defer boundaries.
- APIs: `/api/circuit-knowledge/problem`, `compile`, `applicability`, `compose`, and `propose` use bounded JSON bodies and mandatory tenant/project/branch/actor scope headers.
- The `propose` API uses the shared provider-neutral `LLMRouter`; its strict tool result is re-created as a quarantined low-confidence claim and checked against the pinned evidence bundle.
- Browser persistence stores exact CD-05 state separately from schematic/PCB state, retains superseded history, and invalidates CD-05 on upstream digest changes.
- `drizzle/0013_cd05_circuit_knowledge.sql` and the Drizzle schema add immutable upstream/PCB signoffs, problems, source bundles, recipe definitions, compiler artifacts, libraries, and idempotent transaction records.

## Corpus and Stage-09 integration

The 42 required fixture families have unique immutable governed manifest entries. They are deliberately marked `manifest_only`; no claim is made that the licensed source captures, expert goldens, exact overlays, downstream calibration, or full end-to-end fixture implementations exist. Stage-09 now has three CD-05 packages:

- Corpus manifest: `benchmark-run:6172588e976ed5ea0a48a6863eea358b` — passed while reporting 42 manifest-only cases and zero full evidence fixtures.
- Authority boundary: `benchmark-run:ba645ea89e78693a382611b799e703e4` — passed.
- Deterministic 10,000-recipe identity scale: `benchmark-run:7f7b0c06337e5ca5ea155c4d88e27e48` — passed in 42.237 ms.

The complete Stage-09 manifest has 39 packages and zero validation diagnostics.

## Verification evidence

| Check | Result |
|---|---|
| CD-05 focused domain/API tests | 3 files, 22 passed |
| Complete Sirkit suite | 165 files passed; 1,064 tests passed, 9 skipped, 0 failed |
| TypeScript | passed |
| Focused ESLint | passed with zero warnings/errors |
| Production build | passed; 77 pages generated; `/circuit-knowledge` and five APIs emitted |
| Governed Stage-09 manifest | 39 packages, zero diagnostics |
| CD-05 benchmark packages | 3/3 passed |

The build retains five pre-existing Turbopack file-tracing warnings for Java/FreeRouting, ngspice, and `next.config.ts`; none originates in CD-05.

## Honest remaining blockers

- The selected real CD-04 production revision is not complete, so the production entry gate is blocked.
- The 42 required cases are governed manifests, not full immutable licensed source/evidence/golden/holdout/expert fixtures.
- No production recipe pack is published; the default project library is intentionally empty rather than populated with undocumented conventional circuits.
- The full 75-category test matrix, all mutation/metamorphic properties, full overlay/errata families, expert review, hardware evidence, and CD-6 through CD-13 downstream calibration are incomplete.
- No production database migration was applied to an external database, and no live paid-provider AI variation was used as evidence.
- Exact components/packages, values, pins/nets, schematic/ERC, simulation, firmware, PCB, SI/PI/EMC, safety, protocol, and certification remain downstream and unverified.

## Formal verdict

### `BLOCKED BY CD-4`

The CD-05 safety architecture and core compiler are implemented and regression-clean, but the exact production prerequisite chain stops at the repository's current `CD-4 INCOMPLETE` verdict. CD-05 also retains the corpus, expert, lifecycle, and downstream gaps above; none is hidden by the blocked verdict.
