# CD-06 evidence-backed component selection and BOM candidates

Date: 2026-07-18  
Branch: `codex/cd-06-component-selection`  
Specification SHA-256: `255A3279CBC92E70D5FAE161A3014173C3E9E17895A9A7E3CC1A0DF8E04D9EF8`

## Changed and why

- Added `app/lib/component-selection/` for immutable role requirements, exact identity/catalog snapshots, hard evidence gates, exact CAD/CD-3/CD-4/CD-5 reconciliation, sourcing observations, joint BOM solving, Pareto vectors, alternatives, fixed-point feedback, human decisions, and atomic transactions.
- Kept legacy BOM and one-instance atomic selection paths intact; CD-06 is the stricter authoritative conceptual-design path and never mutates schematic/PCB state.
- Added proposal-only AI search through the shared LLM router. AI cannot pass gates, invent facts, select/approve parts, claim interchangeability, transact, or release a BOM.
- Added ten scoped APIs, `/component-selection`, browser persistence with history/invalidation, deep digest/reference validation, Drizzle schema, and migration `0014`.
- Added a 94-case governed manifest, three passing Stage-09 packages, 14 focused domain tests, and nine API tests. Manifest-only cases remain visibly incomplete.

## Verification

- Focused CD-06: 23/23 tests passed.
- Full suite: 165 files passed; 1,087 passed, 9 skipped, 0 failed.
- TypeScript and focused ESLint passed.
- Production build passed and emitted the CD-06 page plus ten APIs; five unrelated existing tracing warnings remain.
- Stage-09 manifest: 42 packages, zero diagnostics; all three CD-06 packages passed.

## Verdict

`BLOCKED` — primary blocker `BLOCKED BY CD-5`. The protected original remains unchanged. The working copy contains the safe CD-06 foundation, but the real CD-05 production selection and the full licensed/expert/downstream verification evidence do not yet exist.
