# Sirkit CD-04 Interface, Pinmux, Clock, Reset, Boot, and Debug

Date: 2026-07-17  
Branch: `codex/cd-04-interface-planning`  
Protected copy: `C:\Users\robsa\Documents\Codex\2026-07-13\do\work\sirkit-edit`  
Original: `C:\Users\robsa\sirkit` (not touched)

## Changed

- Added strict CD-1/CD-2/CD-3 human completion and digest-chain gate.
- Added typed interface, endpoint, signal/group, domain, threshold, analog/differential, timing, safe-state, connector, logical-resource, clock, reset, boot, debug/recovery, firmware, risk, coverage, decision, constraint, and handoff schemas.
- Added deterministic graph closure and electrical compatibility checks that do not use labels or nominal voltage as proof.
- Added a verified exact Stage-05 pin-function fact adapter.
- Added a deterministic joint exact pin allocator with multiple solutions, fixed/reserved/bank/peripheral/shared-resource/recovery/PCB constraints, minimal unsat cores, resource limits, certificates, and an independent exhaustive oracle.
- Added clock/reset/boot dependency-cycle and recovery checks.
- Added immutable human selection, atomic/idempotent transactions, undo, conflict handling, exact invalidation, browser/database persistence, and migration `0012`.
- Added six scoped APIs, provider-neutral AI proposal routing, `/interfaces` workspace, 35 governed fixtures, four Stage-09 packages, 43 core/API tests, and two UI tests.

## Why

CD-04 must prevent common architectural false passes: reversed endpoint perspective, nominal-voltage assumptions, unowned open-drain bias, back-power, impossible simultaneous pinmux, unbonded package functions, hidden timer/DMA conflicts, reset/clock deadlocks, unsafe boot defaults, and debug lockout. Every missing fact now remains visible and blocks the relevant claim.

## Verification

- Focused core/API: 43 passed.
- UI: 2 passed.
- Full suite with two workers: 1,040 passed, 9 skipped; 159 files passed, 2 skipped.
- Stage-09 manifest: 36 packages, zero diagnostics; CD-04 4/4 passed.
- TypeScript, focused ESLint, and production build passed.
- Build emitted `/interfaces` and all six `/api/interfaces/*` routes.

## Verdict

`CD-4 INCOMPLETE`: implementation foundation is substantial, but formal upstream signoffs, real normalized device pin facts, all 72 requested test categories, scale/expert/downstream evidence, live-provider variation, and deployed migration remain open.

