# Sirkit CD-02 Functional Architecture and Alternative Synthesis

Date: 2026-07-17  
Branch: `codex/cd-02-functional-architecture`  
Protected working copy: `C:\Users\robsa\Documents\Codex\2026-07-13\do\work\sirkit-edit`  
Protected original: `C:\Users\robsa\sirkit`

## Outcome

Sirkit now has an authoritative CD-02 functional-architecture layer between accepted requirements and detailed circuit implementation. It compiles an exact accepted CD-01 package into an immutable architecture problem; validates provider-neutral candidate proposals; represents blocks, ports, flows, modes, domains, boundaries, responsibilities, resources, risks, coverage, feasibility, and downstream obligations; generates material alternatives; compares them without rewarding missing data; and records human selection as a reversible semantic transaction.

The old schematic planner remains downstream and was not silently redefined as architecture truth.

## Implemented boundaries

- Production compilation rejects a CD-01 package unless its schema/digest is valid and its status is exactly `accepted_for_architecture_exploration`.
- Blocking questions, blocking conflicts, unconfirmed hard requirements, unsupported hard requirements, and unpinned capability assessments fail closed.
- Architecture proposals cannot contain parts, manufacturers, MPNs, symbols, footprints, pins, pads, nets, BOM rows, component values, or diagram coordinates.
- Strict runtime validation rejects unknown fields, malformed collections, invalid enums, hierarchy cycles, orphan blocks, incompatible port/flow directions, unconnected required ports, invalid state machines, dangling domains/boundaries, foreign requirements, foreign verification obligations, and undeclared dependency cycles.
- Stable engineering IDs derive from the problem digest, candidate lineage, semantic role, and candidate-local identity. Labels and diagram coordinates do not define identity.
- Root-only requirement references do not count as coverage.
- Feasibility gates run before objective comparison. Unknown resource/capability evidence remains unknown.
- Cost, power, energy, and area are never assigned favorable proxy values when data is missing.
- CD-03, CD-04, and Stage-06 handoffs are explicit `proposed_not_active` obligations; they do not invent detailed objects or activate constraints.
- AI can propose typed candidates but cannot accept requirements, select/reject architecture, acknowledge risk, or silently change providers.
- OpenAI and Anthropic use the same architecture system instructions and tool schema through `LLMRouter`; provider failure returns the existing explicit 503 recovery contract.

## Alternative synthesis and decision support

The bounded deterministic synthesizer emits centralized, modular, and independently supervised alternatives. The compiler rejects duplicate structural signatures. Comparison retains raw metrics, excludes unknown objectives from favorable scoring, ranks only feasible candidates, records dominance edges, and shows sensitivity/exclusion reasons. A human reviewer or project administrator must provide rationale and acknowledge material risks before selection.

## Product surface

- `/architecture?project=<project-id>` loads the persisted project architecture.
- An accepted CD-01 package can start CD-02 from the page.
- The page can generate bounded alternatives, display deterministic diagrams, coverage, feasibility, uncertainty, raw objectives, and semantic comparisons, then record a human selection.
- APIs: `/api/architecture/problem`, `/candidates`, `/alternatives`, `/compare`, and `/propose`.
- Local project persistence validates the complete architecture state and pins it to the project CD-01 digest.
- Drizzle migration `0010_cd02_functional_architecture.sql` adds immutable problems, candidates, comparisons, selection decisions, and semantic transaction records.

## Verification evidence

| Check | Result |
|---|---|
| CD-02 focused library/API/UI tests | 59 passed |
| CD-02 plus Stage-09 focused run | 72 passed |
| Complete serial Sirkit suite | 144 files passed, 2 skipped; 954 tests passed, 9 skipped |
| TypeScript | passed |
| Focused ESLint | passed, zero warnings/errors |
| Production build | passed; `/architecture` and all five architecture APIs emitted |
| Stage-09 corpus validation | 28 packages, zero diagnostics |
| CD-02 governed fixtures | 20 unique families across development, validation, hidden holdout, and stress partitions |
| CD-02 Stage-09 benchmark runs | 4/4 passed |

Benchmark run IDs:

- Problem corpus: `benchmark-run:81344362377659b3d519750c148e31e8`
- Material alternatives: `benchmark-run:9c58dec6e6d5547185f1e731319e513e`
- Hard coverage: `benchmark-run:d28114341ec4bee2d58a3394cdf39957`
- Adversarial schema: `benchmark-run:8b851b42b8b8ff4cc7e53029de65d555`

The production build still reports the pre-existing Turbopack broad dynamic executable-path warnings for Java/FreeRouting and ngspice. They are not CD-02 failures.

## Remaining signoff gaps

- The repository-wide CD-01 verdict remains `CD-1 INCOMPLETE`; the user explicitly authorized CD-02 foundation work while the production gate remains strict.
- No real project supplied a current accepted CD-01 package for a live CD-02 selection session; acceptance evidence uses integrity-valid accepted fixtures and the governed corpus.
- The architecture LLM route has not been exercised against paid live OpenAI and Anthropic requests in this verification run.
- No independent domain expert has reviewed the generated alternatives or risk allocations.
- Quantitative resource roll-up deliberately remains `not_evaluated` until compatible units and allocation evidence exist.
- CD-03/CD-04 consumers do not yet resolve the emitted obligations, and Stage-06 proposals remain inactive as required.
- The database migration is implemented and build-checked but was not applied to an external production database.

## Completion verdict

### `CD-2 INCOMPLETE`

The implementation foundation is substantial and regression-clean, but the prerequisite, live-provider, real-project, expert-review, downstream-consumer, and deployed-database evidence required for a truthful full signoff is not yet available.
