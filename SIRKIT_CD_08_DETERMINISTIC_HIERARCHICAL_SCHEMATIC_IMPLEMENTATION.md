# Sirkit CD-08 Deterministic Hierarchical Schematic Compiler

Date: 2026-07-18  
Branch: `codex/cd-08-hierarchical-schematic`  
Specification SHA-256: `120CE1E1693CB1EE8902013F5E1154FEAA1CDC49010EBA2135E85F3911853D59`  
Protected working copy: `C:\Users\robsa\Documents\Codex\2026-07-13\do\work\sirkit-edit`  
Protected original: `C:\Users\robsa\sirkit` (unchanged)

## Outcome

Sirkit now has a fail-closed CD-08 foundation in which electrical meaning exists as a coordinate-independent, versioned semantic graph. Exact components, units, logical pins, physical pads, nets, endpoints, terminal dispositions, rails/returns, explicit ties, hierarchy, typed ports, structured bundles, variants, annotation, external identities, diagram views, semantic diffs, KiCad manifests, round-trip certificates, completeness reports, candidates, PCB synchronization, approvals, and transactions have separate contracts.

The implementation does not certify the current project. CD-08 requires a current human-approved CD-07 report, which does not exist; CD-07 is itself formally blocked by CD-06. The default CD-08 profile also enables no KiCad version because the repository has no independently verified read/write semantic adapter. Syntax inspection is quarantined and cannot create an approval certificate.

## Baseline audit and migration decision

| Existing path | Current behavior / risk | CD-08 decision |
|---|---|---|
| `lib/schematic-types.ts`, `app/lib/connectivity.ts` | Reconstruct connectivity from wire vertices, co-located pins, and matching label text. Coordinates and names can become electrical authority. | Preserve for legacy editor compatibility; never certify or silently migrate it into CD-08. |
| `app/lib/netlist.ts`, `lib/schematic-to-netlist.ts`, validation/cross-check paths | Consume the coordinate/name union-find result. | CD-08 netlists and PCB sync consume explicit stable net/endpoint membership only. |
| `lib/build-auto-layout.ts`, `lib/auto-layout.ts` | Layout creates wire geometry and unstable identifiers. | CD-08 diagram layout is a pure view over a pinned graph and cannot add/remove endpoints or merge/split nets. |
| `app/lib/kicad-export.ts` | One-way hand-built S-expression export; round trip is explicitly out of scope. | Not used for CD-08 certification. Candidate generation remains blocked until a versioned adapter passes independent reparse/equivalence. |
| `app/lib/kicad/sexp.ts`, `extract.ts` | General parser has no CD-08 resource contract; extraction does not reconstruct the full schematic graph. | Added a strict byte/depth/token-limited quarantine parser. It inspects syntax/version only and never claims semantic import. |
| `app/lib/atomic/*`, CD-06 catalog/evaluations | Strong exact published part, symbol, footprint, terminal/pad mapping, package, evidence, and selected-CAD proof. | Reused as the only component/pin materialization authority. |
| Existing PCB bridge/persistence | Has useful stable pin/pad and net concepts but mixes legacy schematic state. | Added an immutable candidate-only PCB synchronization contract; no compilation path mutates accepted PCB state. |

The migration policy is deliberate: visually touching items, identical labels, references, UUIDs, or database order are insufficient proof. Legacy projects require explicit reviewed rebinding into semantic IDs.

## Implemented architecture

- `app/lib/schematic-compiler/types.ts` defines the versioned problem, graph, view, artifact, proof, synchronization, candidate, project, and transaction contracts.
- `problem.ts` checks CD-1 through CD-7 in order and pins the exact digest chain. The real chain returns `BLOCKED BY CD-7`.
- `atomic-binding.ts` requires the exact CD-06 assignment, exact selected CAD-bundle certificate, published atomic revision, approved mapping, exact package/symbol/footprint revisions, and complete terminal/pad coverage.
- `compiler.ts` instantiates the exact CD-06 component skeleton and CD-07 values without consulting legacy geometry. Uncompiled recipe connectivity remains explicitly `blocked_unresolved`.
- `graph.ts` provides immutable successors, explicit connection/disconnection by variant, stable net identity, distinct rails/returns, explicit ties, external UUID collision protection, reciprocal membership checks, hierarchy-cycle checks, and deterministic validation.
- `hierarchy.ts`, `variants.ts`, and `annotation.ts` implement typed sheets/ports/bundles, canonical per-variant projections, stable reference allocation, reservations/tombstones, and deterministic external UUID derivation.
- `diagram.ts` creates deterministic view-only placements and orthogonal routes. It detects overlaps/ambiguous crossings and verifies that the source graph digest did not change.
- `diff.ts` separates connectivity, hierarchy, annotation, variant, part/value/footprint, and diagram-only changes.
- `safe-sexpression.ts`, `kicad-adapter.ts`, `artifact.ts`, and `equivalence.ts` enforce parser/path/resource limits, candidate-only manifests, and independent graph equivalence. Unsupported constructs and parser failure block completion.
- `completeness.ts`, `candidate.ts`, and `sync.ts` require exact role/pin/value/variant/hierarchy/round-trip coverage before a reviewable candidate and emit a non-destructive PCB handoff.
- `project.ts` and `transactions.ts` provide integrity checks, optimistic concurrency, idempotency, atomic bundle commits, human-only approval, and AI mutation denial.
- `agent-tools.ts` plus `/api/schematic-compiler/propose` use the shared provider-neutral LLM router for typed stable-ID proposals only. AI cannot emit raw KiCad/SVG, coordinates, electrical authority, approvals, or PCB changes.

## Product, API, and storage surfaces

- `/schematic-compiler?project=<project-id>` is linked from CD-07. The current project shows `BLOCKED BY CD-7`. When prerequisites are real, activation creates a parallel semantic state and exact component skeleton without overwriting the legacy schematic or PCB.
- The workspace exposes hierarchy, variants, generated diagram selection, exact part/package/mapping provenance, pin disposition, rails/returns, completeness, round-trip state, and semantic-versus-diagram diff.
- Ten scoped APIs cover prerequisite compilation, graph validation, variant projection, view-only layout, KiCad quarantine inspection, diagnostic comparison, semantic diff, proposal-only AI, transactions, and proof-gated export.
- `lib/persistence.ts` stores `schematicCompilationProgram` plus immutable history. Any CD-1 through CD-7 digest change archives the current CD-08 state. Imports require an explicit CD-08 project-fork migration.
- `drizzle/0016_cd08_semantic_schematic_compiler.sql` adds immutable signoff, problem, graph, diagram, artifact, certificate, completeness, diff, PCB-sync, candidate, decision, and idempotent transaction records.

## Safety invariants with automated evidence

| Invariant | Enforcement |
|---|---|
| Coordinates and text do not create connectivity | explicit endpoint membership tests and authority benchmark |
| Every exact pin has one disposition per variant | graph cardinality validation and atomic fixture tests |
| Rewiring cannot leave phantom endpoints | reciprocal cleanup and rewire/disconnect tests |
| Rails/grounds remain distinct unless explicitly tied | stable-net and explicit-tie tests |
| Layout cannot mutate electrical truth | graph-digest immutability and deterministic-view tests |
| Hierarchy/bundles are identity-based | cycle, reciprocity, and exact-member validation |
| UUID/reference/name are not semantic identity | stable annotation, rename, ordering, and collision tests |
| KiCad syntax parsing is not semantic certification | quarantine API and unsupported-adapter tests |
| Round-trip mismatch blocks candidate materialization | lost-endpoint, unsupported-construct, and parse-failure tests |
| AI cannot mutate or approve | proposal schema, API, and transaction authorization tests |
| PCB is never silently changed | candidate-only synchronization contract and authority benchmark |

## Verification

- Focused CD-08 domain/API tests: 49 passed.
- Complete Sirkit suite: 170 files passed, 1,162 tests passed, 9 skipped, zero failed.
- Governed Stage-09 manifest: 48 packages, zero diagnostics.
- CD-08 benchmark packages: 3/3 passed, including the 10,000-object deterministic scale package.
- All 106 required verification classes are registered with immutable hashes and honestly marked `manifest_only`.
- TypeScript and focused ESLint passed.
- Production build passed and emitted `/schematic-compiler` plus ten CD-08 APIs. Five unrelated pre-existing Turbopack file-tracing warnings remain.

## Honest limitations

- No production CD-07 report exists, so the real project cannot lawfully enter CD-08.
- No KiCad version is enabled in the production capability profile. The legacy exporter is not a certified round-trip adapter.
- The 106-case corpus is a governed manifest, not full licensed source graphs, native KiCad goldens, mutation evidence, expert review, or hardware validation.
- The deterministic layout engine is a safe bounded foundation, not yet the specified production-quality obstacle/channel/page-partition optimizer.
- Full recipe/interface/rail topology compilation, merge/split review workflows, repeated-channel expansion, native KiCad library-table resolution, CLI oracle runs, incremental reflow, undo/redo/replay UI, and collaboration merge UX require further verified implementation.
- CD-08 completion would still not prove ERC, SPICE/simulation closure, SI/PI, EMC, thermal, safety, manufacturing release, or PCB completion.

## Formal verdict

### `BLOCKED`

Primary blocker: `BLOCKED BY CD-7`. The semantic compiler foundation, safety gates, APIs, UI, persistence, migration, tests, and governed verification manifest are implemented, but the prerequisite production report, certified KiCad semantic adapter, complete corpus evidence, and expert signoff required for a genuine CD-08 completion verdict do not exist.
