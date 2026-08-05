# Sirkit CD-04 Interface, Pinmux, Clock, Reset, Boot, and Debug Planning

Date: 2026-07-17  
Branch: `codex/cd-04-interface-planning`  
Specification digest: `3ADD58FA44736F8596B62C504542FCCCF936196A34DF242E43AA2994505EB64C`  
Protected working copy: `C:\Users\robsa\Documents\Codex\2026-07-13\do\work\sirkit-edit`  
Protected original: `C:\Users\robsa\sirkit` (unchanged)

## Outcome

Sirkit now has a repository-native CD-04 planning layer for immutable prerequisite snapshots, typed interfaces/endpoints/signals/groups, electrical and voltage-domain contracts, state-dependent safety, connectors, logical pin resources, exact verified pin-function facts, deterministic joint allocation, clock/reset dependency graphs, boot/debug/recovery and firmware obligations, alternatives, decisions, handoffs, inactive constraints, transactions, persistence, APIs, AI proposals, UI, and Stage-09 evidence.

The implementation is fail closed. It does not parse a terminal name, net label, MPN family, nominal rail, or LLM prose into exact engineering truth. Missing domain mappings, thresholds, safe states, timing, recovery, bond-out, alternate functions, errata, or physical evidence remain `unknown`, `unsupported`, or `external_review_required`.

## Core implementation

- `app/lib/interfaces/types.ts` defines versioned CD-04 problem, contract, allocation, clock/reset/boot/debug, firmware, risk, decision, handoff, and transaction objects.
- `problem.ts` enforces exact `CD-1 COMPLETE`, `CD-2 COMPLETE`, and `CD-3 COMPLETE` human signoffs and digest chains. Current incomplete CD-3 candidates are rejected with `BLOCKED BY CD-3`.
- `graph.ts` validates endpoint closure, drivers/receivers, contention, group membership, differential polarity, ownership, domain references, and orphan objects.
- `electrical.ts` compares source-backed threshold corners and analog ranges. Nominal voltage is never used as a logic proof. A separate threshold oracle is used in differential tests.
- `pin-facts.ts` adapts only published exact Stage-05 part/package/mapping facts with `source_backed` or `verified` evidence. It never interprets names or family metadata.
- `allocation.ts` solves all required resources jointly, with terminal uniqueness, same/distinct peripheral instances, bank/domain rules, bond-out, errata, fixed assignments, shared-resource conflicts, simultaneous-use limits, debug/boot recovery reservations, and PCB feedback. It returns multiple canonical allocations, bounded resource-limit results, search certificates, and deletion-minimized unsat cores. A separately coded exhaustive oracle checks small cases.
- `dependencies.ts` validates clock and reset graphs, startup availability, recovery policy, boot strap sampling/reuse, and canonical dependency cycles.
- `handoff.ts` creates typed CD-3 feedback plus CD-5 through CD-13 and PCB-6/7/8 obligations. Stage-06 proposals remain `proposed_not_active` and `not_enforced`.
- `transactions.ts`, `project.ts`, and browser/database persistence provide immutable revisions, authorization, optimistic concurrency, idempotency, atomic rollback, undo, exact upstream invalidation, and history retention.

## Product surfaces

- `/interfaces?project=<project-id>`: candidate list, typed interface matrix, logical resources, clock/reset/boot/debug views, safe-state matrix, raw hard gates, and handoffs.
- APIs: `/api/interfaces/problem`, `alternatives`, `candidates`, `compare`, `allocate`, and `propose`.
- The AI proposal route uses the shared provider-neutral `LLMRouter`, works with the selected OpenAI or Anthropic brain, and submits only a strict protocol/topology/resource proposal. Deterministic code adds the digest, validates, and compiles; AI cannot approve or apply a selection.
- Migration: `drizzle/0012_cd04_interface_planning.sql` creates immutable signoff, problem, candidate, decision, pin-fact, allocation, and transaction tables.

## Verification evidence

| Check | Result |
|---|---|
| CD-04 domain/API focused tests | 7 files, 43 passed |
| CD-04 UI tests | 1 file, 2 passed |
| Complete Sirkit suite, bounded to two workers | 159 files passed, 2 skipped; 1,040 tests passed, 9 skipped |
| Isolated pre-existing route-preview performance case | 24/24 passed; 11.199 ms p95 |
| TypeScript | passed |
| Focused ESLint | passed with zero warnings/errors |
| Production build | passed; 71 pages, `/interfaces`, and six CD-04 APIs emitted |
| Governed Stage-09 manifest | 36 packages, zero diagnostics |
| CD-04 required fixture families | 35, all CC0 generated fixtures |
| CD-04 Stage-09 packages | 4/4 passed |

Stage-09 run IDs:

- Corpus: `benchmark-run:c04c27181098687e13aaf8b6bd28d1e3`
- Allocation oracle: `benchmark-run:027ad45184a3c46f85304ef1adc8b9e0`
- Electrical oracle: `benchmark-run:8905bb620271212a5e74f077f80bcdc9`
- Adversarial schema: `benchmark-run:632fd9d9bf1d53dcd1cd31258fde4aa8`

The production build still reports five existing Turbopack dynamic executable/file-tracing warnings for Java/FreeRouting, ngspice, and `next.config.ts`. They are not caused by CD-04.

## Honest remaining gaps

- Repository-level CD-01, CD-02, and CD-03 reports remain incomplete, so no real project currently satisfies the formal CD-04 production entrance gate.
- Stage-05 now has a strict CD-04 adapter, but the real catalog does not yet contain normalized alternate-function, bank, bond-out, shared-resource, and errata records for production MCU/FPGA parts.
- The current compiler creates deterministic skeletons from explicit CD-02 flows; it does not fabricate detailed protocol lanes, connector contacts, clock frequencies, reset timing, boot straps, safe electrical defaults, or recovery paths when upstream sources omit them.
- The 35 fixture manifest and critical analytical paths are tested, but the full requested 72-category matrix, thousand-endpoint performance qualification, mutation coverage for every dependency type, expert protocol review, and downstream CD-5–CD-13 calibration are not complete.
- No paid live OpenAI/Anthropic proposal variation, qualified interface/pinmux reviewer, hardware measurement, firmware implementation, or external production database migration was run.

## Final verdict

### `CD-4 INCOMPLETE`

The core architecture and correctness engines are implemented and regression-clean, but a truthful `CD-4 COMPLETE` requires the formal upstream production chain, real exact device facts, complete source contracts, all 72 test categories, scale/expert/downstream evidence, and deployed persistence.

