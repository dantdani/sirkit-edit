# Footprint assignment (PCB seam) — ported from SchGen's get_fp

Date: 2026-07-02 · Status: done (type-checked, lint-clean, unit-tested)

## Why
A schematic symbol isn't enough to lay out a board — every component needs a PCB
**footprint** (land pattern). This is the missing prerequisite for the PCB/Gerber
pillar (cf. the Allegro X AI discussion). Adapted the useful, deterministic core
of microsoft/SchGen's `get_fp` (its `DEFAULT_MAP_RCL` + "keep existing footprint"
logic) into Sirkit — WITHOUT adopting SchGen's LLM-emits-code generator or its
1 GB footprint-library scan.

## What we already had
- Parts carry `footprintHint`, extracted from the symbol's `Footprint` property
  (`app/lib/kicad/extract.ts`).
- `kicad-export.ts` already wrote `footprintHint` into the exported `.kicad_sch`
  Footprint property — but only the raw hint (empty when the symbol had none).

## Change
`lib/footprint-assign.ts` (new, pure, deterministic — no LLM, no library scan):
- `resolveFootprint(input)` → `{ footprint, source }`:
  1. **hint** — trust the symbol's own footprint id when it's a real
     `Library:Name` (via `isFootprintId`, which rejects empty / wildcard
     *filters* like `C_*` / multi-colon / whitespace).
  2. **default** — category default by refDes prefix (SMD 0603 for R/C/L, SOD-123
     for D, SOT-23 for Q, LED land for LED-named diodes). Mirrors SchGen's forced
     RCL defaults; 0603 (1608 metric) chosen as a common hand-solderable default
     (configurable in `CATEGORY_DEFAULTS`).
  3. **none** — unresolved (ICs/connectors are too package-variable): returns
     `null`, SURFACED not guessed, so callers can flag "needs footprint".
- `assignFootprints(components, parts)` → per-refDes list (the batch API a future
  `.kicad_pcb` exporter / "needs footprint" UI will consume).

`app/lib/kicad-export.ts`:
- Builds `footprintByRefDes` via `assignFootprints` and writes THAT into each
  symbol's Footprint property (hint OR default), instead of the raw hint. Parts
  that resolve to `null` export with an empty Footprint exactly as before — no
  regression.

## Philosophy fit
Footprint choice is mechanically load-bearing, so it stays deterministic
("agents propose, deterministic code disposes"). SchGen's own approach (LLM emits
coordinates as Python, executed directly) is exactly what Sirkit avoids — we lifted
only the deterministic mapping.

## Tests (`pnpm test:netlist`) — 8 new assertions
real hint trusted · wildcard filter rejected→default · R/L/Q defaults · diode vs
LED disambiguation · unresolved IC → null · batch assignment (hint+default+null).

## Verification
`npx tsc --noEmit` clean · `npm run test:netlist` ALL PASS · eslint clean on the
three changed files.

## Not done yet (next steps toward PCB)
- No `.kicad_pcb` export yet — that needs footprint PAD geometry (an
  `organized_fp.json`-style index of KiCad footprint libs), then placement →
  freerouting/DRC. `assignFootprints` is the seam it will build on.
- No description-based fuzzy matching against a footprint library (SchGen's other
  half); deferred until a footprint index is ingested. Category defaults + hints
  cover the common cases without that 1 GB dependency.
- Not surfaced in the UI (e.g. "N parts need a footprint") — easy follow-up using
  the `source: "none"` entries.
