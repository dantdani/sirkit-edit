# 02 — Fab dialog + Gerbers + drill + pick-and-place + BOM (Stage 14)

"Send to fab" is live: preset picker → **hard DRC gate (override is opt-in —
the checkbox is the ONLY way past it, and the server re-runs the check
regardless of what the client claims)** → kicad-cli Gerbers/Excellon → CPL +
BOM CSVs → `<boardName>-<fabId>-<yyyy-mm-dd>.zip` download.

## New files
- `app/lib/pcb/fab/`: `types.ts`, `presets/*.fab.json` (jlcpcb-2l/4l,
  pcbway-standard, oshpark-4l) + `presets/index.ts`, `kicad-cli-runner.ts`,
  `emit-bom.ts`, `emit-position.ts`, `build-bundle.ts`
- `app/api/pcb/export/gerbers/route.ts` (manual validation — zod isn't in the
  dep tree; constraint allowed jszip only, which was added: jszip@3.10.1)
- `app/components/pcb/FabDialog.tsx`, `hooks/useFabExport.ts`
- Tests: `fab-presets`, `emit-bom`, `emit-position`, `kicad-cli-runner`
  (mocked spawn), `build-bundle` (fake runner fabricates CLI outputs),
  `api/pcb/export/gerbers/__tests__/route.test.ts`; oracle test extended.

## New exports (signatures)
`FabPreset`, `LayerBundleEntry`, `BomColumn`, `BundleInput`, `BundleResult`,
`FabExportGatedByDrc`, `KicadCliError`; `FAB_PRESETS`, `getFabPreset(id)`,
`getFabPresetForDrc(drcId)`; `runKicadCli(input): Promise<RunKicadCliResult>`;
`computeBomRows(board, netlist): BomRow[]`, `emitBomCsv(rows, columns): string`;
`emitPositionCsv(board, format, side): string`;
`buildFabBundle(input, opts?): Promise<BundleResult>` (opts = test seam:
`{ cliPath?, runner? }`); `useFabExport(editor): FabExportHandle`.

## Cross-stage completion: zone emission (kicad/emit-zone.ts)
Stage 13's `TODO(stage11)` is closed: zones now emit outline + computed fills.
KiCad's `filled_polygon` can't hold holes, so hole-carrying regions are
fractured by subtracting 0.1 µm slits (clipper `differenceWithHoles`);
`(filled_areas_thickness no)` keeps plotted copper exactly at Stage 11's
clearances. `buildFabBundle` re-pours dirty zones server-side (`computeFill`
is pure) so gerbers never ship stale copper. Golden fixture regenerated.

## Toolbar hunk (verbatim; no dropdown component exists in the repo, so the
## "Export submenu" is two sibling icon buttons per toolbar idiom)
```tsx
{onSendToFab && (
  <button type="button" title="Send to fab (Gerbers, drill, BOM, pick-and-place)"
    aria-label="Send to fab" onClick={onSendToFab} className={iconButtonClass(false)}>
    <Factory className="size-3.5" />
  </button>
)}
```
PcbEditor: `fabDialogOpen` state, `useFabExport({ getBoard, getNetlist })`,
`onSendToFab` prop, `<FabDialog … onZoomToViolation={drc.zoomToViolation} />`.

## Decisions & deviations
- **Gerber collection is scan-based, not name-predicted**: KiCad 8 writes
  `-F_Cu.gbr`/`-F_SilkS.gbr`; KiCad 9/10 write `-F_Cu.gtl`/`-F_Silkscreen.gto`.
  Matched on the layer segment (canonical + user name), extension-agnostic,
  then renamed per `layerBundle[].fileSuffix` (data, never code).
- **Oracle DRC comparison is on ERROR counts**, not totals: measured on KiCad
  10, one orphan track = two `track_dangling` warnings + airwires live in a
  separate list, so raw totals can't meet ±10 % even on the demo. Errors agree
  (1 = the baked-in short).
- POS rotation follows the Stage 13 rule (model is already KiCad
  CCW-positive; normalize to (-180, 180], never sign-flip) — pinned test
  `270 stored → -90.0000` passes. POS/BOM CSVs are ours (per-fab columns);
  gerbers/drills are kicad-cli's (pinned: never emit RS-274X/Excellon).
- BOM values/MPNs come from the Stage 4 netlist by instance id; demo boards
  (no netlist) group by footprint with empty value/MPN columns.

## Verification
- `pnpm test`: 53 files, 325 passed, 2 oracle tests skipped without KICAD_CLI.
- With `KICAD_CLI` set (KiCad **10.0** installed locally): both oracle tests
  pass against the real CLI — our .kicad_pcb loads, 7 gerbers + PTH/NPTH
  drills plot, DRC error counts match.
- Real bundle on the routed demo: 13 files, 8 702 bytes, **elapsedMs ≈ 658 ms**
  (budget ≤ 8 s). Zip saved to the session scratchpad
  (`…/scratchpad/kicadtest/sirkit-demo-jlcpcb-2l-2026-07-09.zip`) — **manual
  jlcpcb.com/quote upload still pending** (needs a browser + account; the zip
  is ready to drag in). GTL verified RS-274X (`%FSLAX`…`M02*`).
- `tsc --noEmit` clean; eslint clean on all touched files.

## Env
`KICAD_CLI` — path to kicad-cli (documented in .env.example); defaults to
PATH lookup; missing → clean `kicad-cli-missing` 500, dialog shows the hint.

## TODOs (deferred by design)
- DigiKey/Mouser BOM enrichment (live part sourcing) — later workflow.
- Assembly-file variants beyond jlcpcb/pcbway/oshpark; per-fab panelization
  (tabs/mouse bites); automated fab-quote API integration.
- Demo zone is dropped by island filtering (contains no GND copper) — correct
  behavior, but means the demo GTL has no pour; a plane added via the Zone
  tool exports with copper (covered by build-bundle zone test).
