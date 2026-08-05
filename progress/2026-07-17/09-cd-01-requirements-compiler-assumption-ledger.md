# CD-1 — Requirements Compiler and Assumption Ledger

Implemented the safe CD-1 foundation in the protected `sirkit-edit` copy on branch `codex/cd-01-requirements-compiler`.

## What changed

- Added immutable, access-classified source revisions with exact spans, bounded excerpts, integrity digests, JSON/resource limits, and a prompt-injection evidence boundary.
- Added typed package, requirement, predicate, condition, source, hypothesis, assumption, default, question, conflict, capability, obligation, constraint-proposal, coverage, traceability, diff, and semantic-transaction contracts.
- Reused Stage 6 exact decimal quantities/conditions and emitted only draft, review-required constraint proposals. Deferred roles cannot invent nets/components or claim enforcement.
- Added deterministic quality/conflict analysis, high-risk assumption policy, versioned `embedded-low-voltage-v1` capability assessment, explicit question scoring, planned verification obligations, and an all-hard-requirement acceptance matrix.
- Added a Stage-10-compatible requirements transaction adapter with shared actors/digests/revision vectors, atomic recompilation, dependency invalidation keys, authorization, and no-last-writer-wins conflicts.
- Added local project persistence, PostgreSQL immutable revision tables/repository, scoped source/compile/capability APIs, and a status-separated requirements workspace component.
- Added 18 governed CD-1 fixture declarations plus four executable Stage 9 packages for determinism, malicious input, vague holdout behavior, and 500-requirement scale.

## Why

Sirkit’s current schematic/chat prompts can move directly from free text to design work, while Stage 6 constraints, Stage 3 evidence, defaults, and user intent are separate concepts. CD-1 adds the traceability root that keeps missing information visible and makes AI output a proposal instead of authority.

## Verification

- CD-1/Stage 9 focused: 7 files, 74 tests passed.
- Stage 9 registry: 24 packages, zero validation diagnostics; all four CD-1 benchmark runs passed.
- Full single-worker correctness oracle: 136 files passed, 2 skipped; 895 tests passed, 9 skipped.
- Default parallel run: 891 passed and 4 pre-existing timing gates failed under worker contention; the exact three files passed 40/40 in isolation.
- TypeScript, focused ESLint, and production build passed. Build retained five inherited FreeRouting/NGSpice dynamic executable tracing warnings.

Detailed evidence: `SIRKIT_CD_01_REQUIREMENTS_COMPILER_ASSUMPTION_LEDGER_IMPLEMENTATION.md` and `artifacts/cd-01/`.

Verdict: `CD-1 INCOMPLETE` — live intent-path cutover, complete Stage 10 requirements operations/undo/server collaboration, document/model extraction adapters, full conflict algorithms, all-fixture E2E, expert/provider/privacy studies, and authenticated deployment remain.
