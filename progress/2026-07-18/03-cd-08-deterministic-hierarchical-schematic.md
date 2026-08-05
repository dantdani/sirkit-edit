# CD-08 deterministic hierarchical schematic compiler

Date: 2026-07-18  
Branch: `codex/cd-08-hierarchical-schematic`  
Specification SHA-256: `120CE1E1693CB1EE8902013F5E1154FEAA1CDC49010EBA2135E85F3911853D59`

## Changed and why

- Added `app/lib/schematic-compiler/`: prerequisite gating, exact CD-06/CD-07 materialization, coordinate-independent graph authority, dispositions, hierarchy, bundles, variants, stable annotation/UUIDs, pure diagram views, semantic diffs, bounded KiCad quarantine parsing, candidate manifests, independent equivalence, completeness, PCB sync, candidates, decisions, projects, transactions, and proposal-only AI.
- Added ten scoped APIs, `/schematic-compiler`, a CD-07 link, digest-pinned persistence/history, Drizzle schema, and migration `0016` without overwriting legacy schematic or PCB state.
- Registered all 106 required verification classes honestly as manifest-only and added three passing benchmark packages.
- Preserved the legacy editor for compatibility, but did not certify or silently migrate coordinate/name-derived connectivity. The one-way legacy KiCad exporter is not reused as round-trip proof.

## Verification

- Focused CD-08 tests: 49 passed.
- Full suite: 170 files passed; 1,162 passed, 9 skipped, zero failed.
- Stage-09 manifest: 48 packages, zero diagnostics.
- CD-08 benchmark packages: 3/3 passed.
- TypeScript, focused ESLint, and production build passed; five unrelated existing file-tracing warnings remain.

## Verdict

`BLOCKED` — primary blocker `BLOCKED BY CD-7`. CD-07 is itself blocked by CD-06, and no certified KiCad semantic adapter or complete licensed/expert verification corpus exists. The protected original remains unchanged.
