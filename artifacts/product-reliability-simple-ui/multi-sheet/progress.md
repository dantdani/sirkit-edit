# Multi-sheet schematics (runbook section J) — progress ledger

Compact, resumable record of section J (`artifacts/astra-guided-pcb/PROMPT_TO_PCB_RELIABILITY_AND_SIMPLE_UI.md` lines 234-392). Decisions:
OD-255 (defaults) in `artifacts/remaining-builder-program/OWNER_DECISIONS.md`. Branch `codex/astra-foundation`.

## Read-only maps (2026-10-22)

Four maps of the current source (the model, the editor and downstream path, the AI path, the workload limits) found:

- `app/lib/schematic-compiler/{types,hierarchy,graph}.ts` hold a sheet / port / binding vocabulary with ZERO production callers; the
  editor's nets have no ids (geometry), so the compiler's id-binding store cannot be reused, its rules can.
- Net identity is computed in two stages with no single authority: one geometric union that joins same-named labels across the whole
  state (`app/lib/connectivity.ts` `buildNetUnionFind`), then each consumer (PCB publication, ERC, SPICE) re-derives naming and merges
  ground kinds differently (AGND / DGND publish as one "GND" today).
- PCB publication hard-codes `hierarchyPath ["root"]`; the canonical schematic `sirkit.schematic.v1` drops absent optional fields from
  its digest, so an optional sheet set keeps old digests identical.
- Generation tasks plan at most 8 blocks with shared nets and merge them into one flat page.

## Increments

| # | increment | state | evidence |
|---|---|---|---|
| J1 | sheet contract, one project connectivity authority, canonical sheet operations (library only; single-sheet byte identity) | in progress | — |
| J2 | consumers on project connectivity (PCB publication, ERC, design checks, BOM, missing parts) with byte-identity proofs | next | — |
| J3 | the Sheets navigator, overview, open / create / rename / delete, ports and sheet pins, follow a signal, move to sheet; persistence and undo | — | — |
| J4 | project-wide outputs (SPICE, native hierarchical KiCad export) and "Organize into sheets" | — | — |
| J5 | sheet-aware generation (blocks become sheets), sheet-aware inspection and the organise proposal tool; fixture multi-sheet journeys | — | — |
| J6 | workload limits stated truthfully, queue proof (J7-1 .. J7-3) | — | — |
| J7 | CI admission, browser evidence, verdict | — | — |
