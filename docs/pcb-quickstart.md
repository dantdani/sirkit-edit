# PCB quickstart

sirkit's PCB module takes a schematic to a manufacturable board: footprints sync
from the schematic, auto-place and autoroute do the heavy lifting, DRC checks the
result against a real fab's rules, and one click produces a Gerber bundle their
quote tool accepts.

## Try the demo

Open **`/dashboard?pcbdemo=story`** (any project page's PCB tab honors the query
param). You get a 40 × 30 mm "ESP32 breakout" with 16 footprints staged, unplaced,
left of the board — then drive the whole flow from the keyboard (press `?` for
the full cheat sheet).

## Prerequisites

Rendering, placement, DRC, and KiCad export are self-contained. Two features
shell out and need local tools, configured in `.env.local`:

| Feature | Tool | Env var |
| --- | --- | --- |
| Autoroute | [Freerouting](https://github.com/freerouting/freerouting) JAR + Java 21+ | `FREEROUTING_JAR` (and `JAVA_HOME` if `java` isn't on PATH) |
| Fab bundle | KiCad 8+ `kicad-cli` | `KICAD_CLI` (defaults to `kicad-cli` on PATH) |

KiCad 8 names gerbers `-F_Cu.gbr`; KiCad 9/10 use protel extensions like
`-F_Cu.gtl` — sirkit handles both and renames per fab preset, so any KiCad ≥ 8
works. Missing tools fail with a toast telling you which variable to set.

## The five-click flow

1. **Auto-place** (`Ctrl+P`) — force-directed placement pulls every staged
   footprint onto the board and untangles the ratsnest.
2. **Autoroute** (`Ctrl+E`) — Freerouting routes the nets; the result imports as
   a single undo step and reports a post-route DRC error count.
3. **Run DRC** (`Ctrl+D`) — the violations panel checks the board against the
   active fab preset (JLCPCB 2-layer by default); click a row to zoom to it.
4. **3D preview** (`Ctrl+3`) — inspect the board; silkscreen and zones render too.
5. **Send to fab** (`Ctrl+B`) — pick a preset, pass the DRC gate, and download
   `<board>-<fab>-<date>.zip` with Gerbers, drill files, pick-and-place CSVs, and
   a BOM. Upload it to jlcpcb.com/quote (or pcbway.com) as-is.

Along the way: press `Z` to pour a ground plane, `S` to add silkscreen text,
lines, rects, or circles (0.15 mm stroke, JLC's minimum, by default).

## Where to go next

- `?` — every keyboard shortcut, grouped, always current.
- The fab dialog's preset picker — JLCPCB 2/4-layer, PCBWay, OSH Park; each is a
  JSON preset under `app/lib/pcb/fab/presets/`, so adding a fab is data-only.
- AI design rules — `POST /api/pcb/ai-rules/from-brief` turns "this board has a
  2 A motor rail" into per-net-class width/clearance rules.
- Export → KiCad (toolbar) hands you a `.kicad_pcb` that opens in KiCad 8+.
