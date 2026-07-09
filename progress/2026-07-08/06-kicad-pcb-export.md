# 06 — KiCad .kicad_pcb export (Stage 13)

`POST /api/pcb/export/kicad-pcb` emits a KiCad 8.x board (`version 20240108`,
`generator "sirkit"`) directly from `PcbBoard` — no intermediate model. **The
exported file is self-contained**: no external `.kicad_mod` references; every
footprint's pads and graphics are emitted inline.

## New files
- `app/lib/pcb/kicad/`: `types.ts`, `units.ts`, `layer-map.ts`, `sexpr-emit.ts`,
  `emit-board.ts`, `emit-footprint.ts`, `emit-track.ts`, `emit-via.ts`,
  `emit-zone.ts` (placeholder), `emit-setup.ts`, `emit-net-class.ts`,
  `write-pcb.ts`, `export-client.ts` (browser download helper)
- `app/api/pcb/export/kicad-pcb/route.ts` — manual shape validation (no zod in
  dep tree, same posture as `/api/pcb/autoroute`); no auth (MVP).
- Tests: `kicad-units`, `kicad-layer-map`, `kicad-emit-footprint`,
  `kicad-emit-track-via`, `kicad-write-pcb`, `kicad-cli-oracle` (+ golden
  fixture `__tests__/fixtures/routed-demo.kicad_pcb`, regenerate with
  `UPDATE_GOLDEN=1`).

## New exports (signatures)
- `nmToMm(nm: Nm): string` (exactly 6 decimals), `mmToNm(mm: number|string): Nm`,
  `nmVec2ToMm(v: Vec2)`, `formatDeg(deg: number): string` (normalizes to (-180, 180])
- `LAYER_MAP: Record<LayerId, string>`, `toKicadLayer(id)`,
  `toKicadLayerCanonical(id)`, `layerHeaderEntries(stackup)`
- `emitFootprint(inst, board, netlist)`, `emitTrack(track, board, netlist)`,
  `emitVia(via, board, netlist)`, `emitZone(zone, board, netlist)` → `""` until
  Stage 11, `emitSetup(rules: DrcRules)`, `emitNetClass(netClass, netsInClass)`
- `writeKicadPcb(board, netlist, options?: WriteKicadPcbOptions): string`,
  `netlistFromBoard(board): PcbNetlist`, `downloadKicadPcb(board, netlist|null)`

## Integration hunks (coordinated files)
`PcbToolbar.tsx`: `onExportKicad?: () => void` prop + hidden-when-absent button
(pattern-matches onRunDrc); `FileDown` added to the lucide import.
`PcbEditor.tsx` (2 lines):
```tsx
import { downloadKicadPcb } from "@/app/lib/pcb/kicad/export-client"; // Stage 13 integration
onExportKicad={() => { const b = boardRef.current; if (b) void downloadKicadPcb(b, netlist); }} // Stage 13
```

## Decisions & deviations
- **Rotation: NO sign flip.** The spec's "negate CW→CCW" is already baked into
  the model — sirkit stores KiCad-convention CCW-positive degrees
  (`geometry.ts`, `select-move.ts:424`; the UI's 90°-CW rotate stores 270).
  Emit = identity normalized to (-180, 180], so one CW turn emits `-90.000000`
  (pinned test passes) and `.kicad_mod`-parsed angles round-trip unchanged.
- Board-file quirks encoded: pad/text positions are footprint-local, their
  ANGLES are absolute (footprint angle folded in); bottom-side bakes the
  x-mirror into local coords + flips layers + subtracts local rotations.
- Full-copper THT pads collapse to KiCad's `*.Cu` wildcard (never names inner
  layers on a 2-layer board).
- Setup rules ride v5-legacy tokens (`trace_clearance`/`trace_min`/
  `via_min_size`/`via_min_drill`); `net_class` blocks are v5-style — KiCad 6+
  still parses both and imports them on open (design rules live in `.kicad_pro`
  natively, which we deliberately don't emit).
- `q()` always quotes (KiCad 8 style). Numbers always 6 decimals (pinned),
  cosmetically different from KiCad's trailing-zero trim — parser-fine.

## Measurements & verification
- Demo export: **39,513 bytes** on `?pcbdemo=routed` (8 footprints, 17 tracks,
  2 vias, 4 nets, 0 zones).
- `pnpm test`: 39 files / 258 passed, 1 skipped (oracle) — all prior stages green.
- `tsc --noEmit`: clean except 2 pre-existing errors in Stage 11's in-flight
  `zones/drc-check.ts` (not touched — theirs).
- kicad-cli oracle: **skipped** (no `KICAD_CLI` in this env). Manual
  KiCad-8-open test: **pending** — no KiCad on this machine; golden fixture is
  generator-output, re-verify in KiCad before trusting it as ground truth.

## TODOs
- **TODO(stage11)**: `emitZone` returns `""` (zero zones emitted). When zone
  fill lands, emit polygon + filled_polygon in `emit-zone.ts` and re-run the
  oracle. Emit site marked in `write-pcb.ts`.
- Blind/buried vias deferred (emitter already writes the actual layer pair).
- 3D `(model ...)` refs deferred to Stage 15; `.kicad_pro` emission deferred
  (KiCad opens `.kicad_pcb` standalone); unicode net names untested.
- Custom/polygon pads emit as `custom` w/ tiny anchor — unreachable today
  (Stage 1 parser rects them), revisit if pad polygons land.
