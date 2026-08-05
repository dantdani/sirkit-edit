# CD-07 deterministic electrical calculation

Date: 2026-07-18  
Branch: `codex/cd-07-electrical-corners`  
Specification SHA-256: `8447F2C543DEDF19D8C431E35F450533A633A9AF72E67152A3CDF0DA7468BD1F`

## Changed and why

- Added `app/lib/calculation/`: exact rational quantities, strict units/temperature semantics, verified intervals, safe expressions, model approval/applicability, CD1–CD6 problem gating, explicit tolerance/correlation, corners and coverage, bounded calculators, proof-aware margins, preferred-value recomputation, CD6↔CD7 fixed points, graphs, reports, decisions, feedback, projects, transactions, and proposal-only AI.
- Added scoped calculation APIs, `/calculation`, a CD6→CD7 link, digest-pinned persistence/history, Drizzle schema, and migration `0015` without changing schematic or PCB truth.
- Registered all 93 required verification classes honestly as manifest-only and added three passing governed benchmark packages.
- Preserved SPICE as simulation rather than worst-case proof and did not reuse the legacy unknown-tolerance alternate classifier.

## Verification

- Focused CD-07 tests: 26 passed.
- Full suite: 166 files passed; 1,113 passed, 9 skipped, zero failed.
- Stage-09 manifest: 45 packages, zero diagnostics.
- CD-07 benchmark packages: 3/3 passed.
- TypeScript and focused ESLint passed.
- Production build passed with `/calculation` and eight calculation APIs; five unrelated existing file-tracing warnings remain.

## Verdict

`BLOCKED` — primary blocker `BLOCKED BY CD-6`. The protected original remains unchanged. Full licensed/manufacturer goldens, mutation evidence, expert review, advanced solver/model coverage, and downstream evidence remain incomplete.
