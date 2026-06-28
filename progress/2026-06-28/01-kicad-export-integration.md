# KiCad export — verify & UI integration

**Date:** 2026-06-28
**Status:** Done. Already-shipped backend; verified + confirmed UI wiring.

## STEP 1 needed? No.

Both backend pieces already existed and were fully implemented (not stubs):

- `app/lib/kicad-export.ts` — `exportToKicadSch(input: KicadExportInput): string`,
  KiCad 8.x S-expression format (`version 20240114`).
- `app/api/export/kicad/route.ts` — `POST` handler, loads parts via
  `ensurePartLoaded`, returns `application/octet-stream` attachment.

Verified against the codebase that all referenced symbols are real and consistent:
- `KICAD_SCALE_PX_PER_MM` (≈7.874) in `app/lib/geometry.ts`.
- `CachedPart` shape (`symbolRaw`, `libraryName`, `name`, `footprintHint`,
  `datasheet`) in `app/lib/parts-cache.ts`.
- `SchematicState` (`components`, `wires`, `kicadComponents?`, `netLabels?`) in
  `lib/schematic-types.ts`.

## STEP 2 — UI wiring

`app/page.tsx` already had a working `handleExportKicad()` (line ~2663) wired to
the header **Export** button (`onClick={handleExportKicad}`, line ~2739). It posts
`{ state: { components, kicadComponents, wires, netLabels }, title }`, downloads the
blob as `sirkit-export.kicad_sch`, and surfaces errors via `alert`. Left as a direct
button (no dropdown) since a functional handler was already present — the spec's
DropdownMenu path only applies when the button is a bare placeholder.

## Verification

- `tsc --noEmit` over the whole project: **exit 0**, no errors.
- Determinism: invoked `exportToKicadSch` twice on the same sample state
  (Theory resistor/cap/ground + wire + power/ground/label net labels) →
  byte-identical output (`identical: true`, 3259 bytes). UUIDs are SHA-256-derived;
  the only time-varying field is `title_block` date, stable within a day.
- Output header is well-formed (`kicad_sch` / `version 20240114` / `lib_symbols` …).

## Not done (manual)

- Opening a generated file in a real KiCad 8.x install — needs one manual smoke test.
