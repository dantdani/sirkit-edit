# CD-05 executable circuit knowledge and reference-design compiler

Date: 2026-07-17  
Branch: `codex/cd-05-circuit-knowledge`  
Specification SHA-256: `27B5C3DB3BAA0B7C7CAA4998966C26D70D4DE82191009E0F5A9E81DA384D2FBD`

## Changed and why

- Added `app/lib/circuit-knowledge/` so recipe sources, claims, reviews, definitions, compiled artifacts, bindings, composition, and project decisions have one typed authority model instead of scattered AI prompts and demo constants.
- Added strict CD-1 through CD-4 and PCB Stage 1-6/9/10 signoff gates so CD-05 cannot run against an unpinned or incomplete upstream state.
- Added source/license/conflict/freshness checks and mandatory exact evidence locations so circuit truth cannot come from unreviewed prose or LLM memory.
- Added a closed bounded expression AST, dimensional type checking, precision/resource limits, registered CD-7 model adapters, equation DAG checks, and independent oracles because arbitrary code or silent numeric convention is unacceptable for circuit knowledge.
- Added semantic port/role/terminal/topology validation, applicability, exact-scope overlays, deterministic composition, hard-filtered matching, complete coverage states, and project-restricted novel design paths.
- Added review/publication/lifecycle gates plus authorized atomic transactions, inverse operations, idempotency, stale invalidation, project history, and semantic diff.
- Added five scoped APIs, proposal-only shared-router AI, `/circuit-knowledge`, browser persistence, Drizzle schema, and migration `0013`.
- Added a governed 42-case manifest and three Stage-09 packages. All 42 entries say `manifest_only`; this prevents a manifest from being misreported as full source/golden/expert evidence.

## Verification

- Focused CD-05: 22/22 tests passed.
- Full suite: 165 files passed; 1,064 passed, 9 skipped, 0 failed.
- TypeScript and focused ESLint passed.
- Production build passed and emitted 77 pages, the CD-05 workspace, and five APIs.
- Stage-09 manifest: 39 packages, zero diagnostics; all three CD-05 packages passed.

## Verdict

`BLOCKED BY CD-4`. The protected original remains unchanged. The working copy contains the safe CD-05 foundation, but the real CD-04 verdict is incomplete and full licensed corpus/expert/downstream evidence is not yet complete.
