# PCB quickstart

sirkit's PCB module takes a schematic to a manufacturable board: footprints sync
from the schematic, auto-place and autoroute do the heavy lifting, DRC checks the
result against a real fab's rules, and one click produces a Gerber bundle their
quote tool accepts.

## Try the demo

Open **`/dashboard?pcbdemo=story`** (any project page's PCB tab honors the query
param). You get a 40 × 30 mm "ESP32 breakout" with 16 footprints ready for
placement, then drive the whole flow from the keyboard (press `?` for the full
cheat sheet).

## Prerequisites

Rendering, placement, DRC, and KiCad export are self-contained. Two features
shell out to local tools:

| Feature | Tool | Setup |
| --- | --- | --- |
| Autoroute | [Freerouting](https://github.com/freerouting/freerouting) v2.2.4 + private Java 25 runtime | `npm run setup:freerouting` (no hosted API key) |
| Fab bundle | KiCad 8+ `kicad-cli` | `KICAD_CLI` (defaults to `kicad-cli` on PATH) |

The Freerouting setup clones the reviewed v2.2.4 source and downloads the
official executable JAR plus Eclipse Temurin JRE into `vendor/freerouting`.
Sirkit invokes that CLI headlessly with the Freerouting API server and anonymous
analytics disabled. `FREEROUTING_JAR` and `FREEROUTING_JAVA` remain optional
operator overrides; they are not API credentials.

KiCad 8 names gerbers `-F_Cu.gbr`; KiCad 9/10 use protel extensions like
`-F_Cu.gtl` — sirkit handles both and renames per fab preset, so any KiCad ≥ 8
works. Missing tools fail with a toast telling you which setup command or
variable is needed.

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

The dialog now offers two engines. **KiCad-assisted fallback** remains the
default while external acceptance gates are open. **Sirkit native beta** builds
a deterministic Gerber X2/X3 + XNC package, parses every image back through an
independent reader, and exposes the stage checklist and file hashes before
download. Native export is fail-closed: stale pours and DRC/parse-back errors
cannot be overridden. See `docs/native-fab-compiler.md` for the trust boundary,
CLI, and deferred production gates.

Along the way: press `Z` to pour a ground plane, `S` to add silkscreen text,
lines, rects, or circles (0.15 mm stroke, JLC's minimum, by default).

## Manual routing, trace width, and vias

### Schematic import placement

Click the prominent **Schematic → PCB** control once to run the safe default:
center a readable new-part cluster and spread courtyard overlaps while leaving
every already-placed footprint untouched. Its small arrow opens advanced
placement choices, including preserve coordinates for trusted PCB imports.
Sources without PCB coordinates use the visible staging area. If the cluster
cannot fit, Sirkit offers **Auto-arrange parts** or **Enlarge board to fit**.
Sync is one named, undoable history command. There is no footprint-assignment
drawer; automatic resolution failures are reported directly in the sync toast.

Press **R** or click the Route tool. A **New route setup** card appears over the
canvas before any copper is committed:

- **Copper width** can follow the starting net's class/AI rule, use a common
  preset from 0.15–2.00 mm, or accept an exact custom width.
- **Via preset** can follow the net class/AI rule or use any governed padstack
  in the board library. Press **V** during routing to place it and change layer.
- The chosen values are captured when the starting pad is clicked, persisted
  with the board, and create normal undoable routing commands. They do not
  silently resize existing copper.

The same **R** tool is now Smart Route. Move toward the destination and it first
tries the two shortest horizontal/vertical/45-degree postures. If fixed copper,
a pad, via, hole, board edge, zone, or routing keepout blocks those postures, it
searches clockwise and counter-clockwise walk-around paths. The selected path is
bright; legal alternatives are faint. Press **Tab** to cycle them, click to
commit the whole preview atomically, or **Escape** to discard it without
touching the board. The setup card reports Direct / Walking around / No legal
path and the deterministic search time.

Smart Route is deliberately fail-closed: its independent validator must accept
the complete path before click can write copper. This phase is single-ended and
single-layer and does not shove existing traces; those larger capabilities are
tracked in `docs/smart-interactive-routing.md`.

To resize existing copper, select one or more tracks and edit **Width** in the
Properties inspector; the pending value is checked against the active fab
preset before commit. Select a via to choose/fork its padstack or edit size and
drill while preserving the padstack usage rules.

The right-side **Routing intelligence** section shows the effective width and
via dimensions per net. **Classify nets deterministically** identifies common
power/ground/high-current names. The AI advisor accepts design intent such as
“2 A USB-C input, 1 oz copper, 10 °C rise” and returns a reviewable width,
clearance, and via proposal. Nothing changes until **Apply proposal**; applying
is one undoable history entry. Unsafe annular-ring recommendations are rejected
at the API boundary.

Click **Edit routing rules** for the larger per-net editor. Track width,
clearance, via outer diameter, via drill, and class are entered in millimeters
and saved together as one undoable command. Interactive routing uses the new
values immediately; batch DRC also treats them as minimums for existing copper.

The toolbar now exposes Undo, Redo, and a session history menu with command
names, timestamps, operation type, and affected objects. Routing records add
the selected net, layer, candidate, path mode, and exact rule snapshot used.

### Board readiness

The always-visible toolbar badge reports **Ready**, **Needs review**, or **Not
ready**, including the remaining unrouted-connection count. DRC blocks
manufacturing readiness for incomplete nets, pads/holes/tracks/vias/zones
outside the outline, copper on unavailable layers, unsupported via spans,
shorts, clearance failures, and illegal courtyard overlaps. Intentional
connector-body overhang can be reviewed explicitly, but its pads and holes must
still remain inside the manufactured board.

Top and bottom copper use high-contrast coral and blue. The grid is neutral and
subdued; click a layer row to make it active and dim other copper, use the eye
icon for visibility, or toggle the grid from the toolbar.

### Multilayer autoroute

Open **Multilayer routing** in the right panel and choose a stackup profile.
Four-layer boards can use signal/plane, all-signal, or dense routing profiles.
Each copper layer shows its physical identity, role, preferred direction,
autoroute permission, and post-route utilization. Plane layers require an
explicit net. **Isolate** shows only the active layer; **Show copper** restores
every enabled copper layer.

Before the local engine starts, Sirkit verifies that the DSN contains the exact
enabled layer count/order, positive widths and clearances, valid pad references,
and via padstacks that connect every routable layer. Existing copper is exported
as protected wiring. SES import rejects unknown nets, layers, or padstacks as a
whole instead of hiding lost routes.

Autoroute results are **Complete** or **Partial** based on actual schematic-pad
connectivity, not on whether FreeRouting happened to return some tracks. Sirkit
runs one global pass, then bounded higher-effort retries for only the remaining
nets. A candidate is retained only when it improves connectivity or DRC without
disconnecting a complete net, creating a short, or introducing a new physical
DRC error. Manual, imported, and locked copper is never ripped up by these
retries. The complete accepted candidate still imports as one Undo step.

If routing stops partial, the panel lists every unresolved connection by net and
exact endpoint pads, its measured blockers, and a suggested local repair; click
one to center the canvas on the airwire. Developers can reproduce real-engine
checks with `npm run pcb:verify-multilayer` (forced Inner 1 / Inner 2) and
`npm run pcb:verify-two-layer-vias` (forced top/bottom transition with two vias).

Auto-place expands only generated/explicitly approved board regions by exactly
10 percent in width and height. Independently, every footprint receives a
virtual placement envelope of 15 percent by default (Comfortable); Compact is
10 percent and Spacious is 20 percent. The envelope also includes the larger of
the resolved trace/clearance and via-landing margins. It affects placement and
routeability analysis only—footprint definitions, pads, copper, DSN, and Gerber
geometry are unchanged. User-authored outlines are never silently resized.
Placement runs in a dedicated worker; its toolbar control shows percentage and
becomes **Cancel** while active. A cancelled or stale candidate leaves the board
unchanged. Placement and any approved expansion undo together.

### AI board repair

Run DRC and open **Board Repair**, then choose **Fix with AI**. Sirkit sends the
selected OpenAI or Anthropic brain the same versioned, exact PCB snapshot and
read-only tool contract. The native repair planner remains authoritative: it
groups violations by root cause, marks protected/user-authored changes for
approval, and creates a board candidate without mutating the open design.

Choose groups and click **Preview fixes**. The preview reports errors, warnings,
unrouted connections, moved footprints, rerouted nets, and newly introduced
violations. Apply is disabled if the board revision changed, DRC regressed, new
error-level violations appeared, or the candidate made no measurable progress.
Accepted changes commit as one engineering-history event and **Undo repair**
rolls back the whole transaction. Rules cannot be weakened to make DRC pass;
affected-net reroutes preserve unrelated copper and refill zones before final
connectivity and DRC verification. Planning and preview show phase, percentage,
elapsed time, and an abortable **Cancel** control. Approval-gated local moves can
repair board-containment and courtyard-overlap violations through the same
preview gate.

## Where to go next

- Smart Route architecture, safety model, RouteBench, and limitations:
  `docs/smart-interactive-routing.md`.

- `?` — every keyboard shortcut, grouped, always current.
- The fab dialog's preset picker — JLCPCB 2/4-layer, PCBWay, OSH Park; each is a
  JSON preset under `app/lib/pcb/fab/presets/`, so adding a fab is data-only.
- AI design rules — `POST /api/pcb/ai-rules/from-brief` turns "this board has a
  2 A motor rail" into per-net-class width/clearance rules.
- Export → KiCad (toolbar) hands you a `.kicad_pcb` that opens in KiCad 8+.
