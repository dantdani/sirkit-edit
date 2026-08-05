# Stage 1 electrical identity and data-integrity foundation

Date: 2026-07-16

## Why this changed

Four P0 correctness failures allowed electrical meaning or protected engineering data to become ambiguous: numeric net reordering could reinterpret copper, pad-count footprint acceptance could lose connections, ordinary tools could mutate locked copper, and duplicate references could reach PCB/export boundaries.

## What changed

- Added serialized stable net IDs and canonical component-ID/pin endpoint sets.
- Replaced numeric/name preservation with deterministic endpoint reconciliation and atomic routed split/merge/delete conflicts.
- Remapped tracks, vias, zones, pad assignments, stackup planes, routing history, and direct rule targets through the reconciliation result.
- Added deterministic legacy migration without changing numeric net-to-object associations.
- Replaced pad-count acceptance with exact or explicit pin-pad mapping, complete pad accounting, and lossless duplicate-pad DSN identities.
- Added shared board-global reference validation across sync, DSN, KiCad, BOM, position, and native manufacturing outputs.
- Enforced locked track/via/zone invariants in edits, stretch/junction drag, rip-up, autoroute, repair, AI/native tools, zones, padstacks, and history.
- Extended revision hashing so stable IDs, reference/mapping changes, and lock changes invalidate stale candidates.

## Safety policy

- Sync builds and validates a complete candidate before one history transaction.
- Routed ambiguous topology never guesses, deletes, renets, or moves copper; it rejects with structured diagnostics.
- Pin-pad mapping never uses count, order, position, numeric coercion, or AI inference.
- Locked objects are immutable until an explicit unlock transaction.
- Display references retain spelling, but exported uniqueness is board-global under trimmed uppercase comparison.

## Verification

- Stage-focused integration/unit run: 92/92 passed.
- Full repository suite: 582 passed, 9 pre-existing external/live cases skipped; no Stage 1 test skipped.
- Standalone netlist validation: all pass.
- TypeScript: pass.
- Changed-file ESLint: pass.
- Optimized Next.js production build: pass, including 41/41 static pages.
- Full repository lint still reports 32 errors and 14 warnings in unrelated unchanged React files; all Stage 1 files are clean.

The complete behavior tables, mutation-path audit, file inventory, migration notes, test evidence, and remaining risks are in `SIRKIT_STAGE_01_DATA_INTEGRITY_IMPLEMENTATION.md`.
