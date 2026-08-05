# Sirkit CD-03 Power, Ground, Protection, and Sequencing Architecture

Date: 2026-07-17  
Branch: `codex/cd-03-power-architecture`  
Protected working copy: `C:\Users\robsa\Documents\Codex\2026-07-13\do\work\sirkit-edit`  
Protected original: `C:\Users\robsa\sirkit`

## Outcome

Sirkit now has a typed CD-03 architecture layer for source envelopes, load profiles, operating scenarios, exact concurrency, rails, power transfers, ground/return domains, sequencing, reset/brownout behavior, boundary threats, protection intent, transient support, budgets, battery-runtime uncertainty, thermal uncertainty, downstream handoffs, and proposed-not-active Stage-6 constraints.

Production entry remains fail closed: an integrity-valid accepted CD-01 package, a human-selected CD-02 candidate, and a human completion signoff pinned to both exact digests are mandatory. Accepted/selected fixtures were used for implementation without weakening that rule.

## Product and safety boundaries

- `/power?project=<project-id>` records explicit upstream human signoff, generates bounded alternatives, exposes raw gates/budgets/objectives, and records human selection with risk acknowledgement.
- APIs cover problem compilation, deterministic alternatives, candidate compilation, raw comparison, provider-neutral AI proposal, and enriched-pin reconciliation.
- Both OpenAI and Anthropic use the shared `LLMRouter` and the same strict tool schema. Provider failure is not silently switched.
- The low-voltage profile is limited to declared source kinds, 60 V input, 25 W continuous power, bounded graph/scenario sizes, and supported abstract topology/threat classes.
- Missing cost, efficiency, loss, usable battery energy, duty cycle, thermal paths, fault energy, or external review never becomes a favorable score or a pass.
- Ground names are not electrical truth. Return domains and per-class loop intents are explicit, with physical proof deferred.
- No part number, package, component recipe, value, net name, or coordinate is allowed in a CD-03 proposal.
- Stage-6 relationships remain `proposed_not_active` and `not_enforced`; downstream obligations remain `planned_not_verified`.

## Persistence and collaboration

Power problems, candidates, human selections, upstream signoffs, and transaction records have immutable browser and database persistence boundaries. Transactions are atomic, idempotent, optimistic-concurrency checked, and undoable. Upstream CD-1/CD-2 changes archive the prior CD-3 state instead of silently rebinding it. Enriched component pin groups can force a candidate revision and invalidate exact handoffs/constraints.

Migration: `drizzle/0011_cd03_power_architecture.sql`.

## Verification

| Check | Result |
|---|---|
| Final CD-03 plus Stage-09 focused run | 9 files, 61 passed |
| Complete serial Sirkit suite | 152 files passed, 2 skipped; 997 tests passed, 9 skipped |
| TypeScript | passed |
| Focused ESLint | passed, zero warnings/errors |
| Production build | passed; `/power` and six power APIs emitted |
| Governed Stage-09 corpus | 32 packages, zero diagnostics |
| CD-03 governed fixture families | 32 |
| CD-03 Stage-09 packages | 4/4 passed |

Benchmark run IDs and the 65-category acceptance matrix are in `artifacts/cd-03/implementation-evidence.json` and `artifacts/cd-03/test-matrix.json`.

The production build still reports the five pre-existing broad dynamic executable tracing warnings for Java/FreeRouting and ngspice. They are not CD-03 failures.

## Remaining signoff gaps

- The repository-wide CD-01 and CD-02 completion verdicts remain incomplete; no real project has supplied a formally complete production chain.
- No paid live OpenAI/Anthropic CD-03 proposal variation was run.
- No independent qualified power-domain reviewer performed the blind rubric.
- Downstream CD-4 through CD-13 and PCB consumers have not verified the emitted obligations.
- The database migration is implemented and build-checked but not applied to an external production database.

## Completion verdict

### `CD-3 INCOMPLETE`

The implementation foundation is substantial and regression-clean, but a truthful complete signoff still requires the upstream production signoffs, a real project, live-provider variation, independent expert review, downstream evidence, and deployed persistence.
