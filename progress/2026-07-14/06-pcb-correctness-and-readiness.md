# PCB Core Correctness — Placement, History, Rules, DRC, and Readiness

## Request

Treat schematic-import placement, undo/redo, routing-rule editing, DRC
containment, unrouted connectivity, routing feedback, and manufacturing
readiness as a correctness pass before advancing routing features. Preserve
working systems, document every material change, and keep the original Sirkit
folder untouched.

## Audit findings

- New schematic footprints deliberately used a staging strip left of the board.
- Re-sync replaced the editor board outside the history stack, so it erased the
  current undo/redo session.
- Immer patch history, drag coalescing, and atomic route commands already
  existed, but no toolbar controls or inspectable records exposed them.
- Routing intelligence displayed effective values and AI proposals, but users
  could not manually edit the complete per-net rule set.
- Connectivity already computed incomplete nets and airwires, but DRC never
  converted them into blocking violations.
- Track/via edge clearance existed, but footprints, pads, drills, whole copper
  items, zones, layers, via spans, and reference text lacked a shared board
  containment pass.
- A previous DRC result remained visible after board edits, and no always-live
  readiness state existed.
- The Smart Route interaction requested by the prior phase was already present:
  selected/faint alternatives, blocker feedback, Tab cycling, via insertion,
  atomic finish/cancel/undo, and structured route replay.

## Changes and why

### Centered, explicit schematic import

New footprints now begin as a deterministic readable cluster translated to the
board center. Courtyard-aware spreading searches stable 1 mm rings to avoid
both placed and newly imported parts. Existing footprint coordinates and
optional instance properties are preserved.

The Sync action opens a placement dialog with center, preserve-coordinate, and
spread-overlap choices. A placement report records mode, containment, overlap
count, and any warning. When the outline is too small, a persistent notice
offers the existing auto-place engine or an undoable rectangular-outline
enlargement with a 5 mm margin.

Schematic sync now commits through history as one `schematic-sync` command; it
no longer reseeds and destroys undo state. Net classes are deterministically
recomputed after sync while retaining stored AI/manual rule deltas.

### Visible, structured history

The existing Immer history gained stable record IDs, timestamps, undo/redo
labels, applied/redo state, operation type, affected-object paths, optional net
and layer, and structured details. The toolbar exposes Undo, Redo, and a session
history popover. Route commits attach candidate/mode/rule facts; manual routing
rules and schematic sync attach their own replay/debug metadata.

Transient drag behavior and the 200-command bound are unchanged. One route,
rule save, import, auto-place batch, or board enlargement remains one undo step.

### Editable routing rules

Routing intelligence now opens a larger dedicated rules dialog. A user can
select a net and edit class, track width, clearance, via outer diameter, and via
drill in millimeters. Validation rejects non-positive dimensions and drill
diameters that are not smaller than the via.

Saving creates one manual rule delta and one named history command. The existing
`getNetClass`/routing-profile path applies it to new interactive routes
immediately. DRC now merges explicitly assigned design minima with the selected
fab preset, so existing under-width tracks or undersized vias are flagged too.
Unassigned legacy boards continue to use the fab preset exactly as before.

### Fail-closed DRC and readiness

Added one model-level containment/layer check covering:

- footprint body overhang (review warning by default, explicit forbid = error,
  explicit allow suppresses the body warning only);
- every pad and drilled hole outside the outline (error);
- whole track capsules and via bodies outside the outline (error);
- copper zones outside the outline (error);
- unavailable copper layers and unsupported blind/buried via spans (error);
- footprint reference and board text outside the outline (warning).

Outside copper is not double-reported as an edge-clearance error. The existing
courtyard, clearance, short, silk, hole, zone, and manufacturer checks remain.

Every incomplete multi-pad net now creates a blocking `incompleteNet` violation
with remaining airwire count, disconnected groups, pad references, and a useful
zoom point. `DrcResult.readiness` reports ready/needs-review/not-ready, errors,
warnings, incomplete nets, and unrouted connections. The toolbar computes this
against the current committed board, so readiness cannot stay green after an
edit; the detailed DRC panel also invalidates stale results.

`PcbBoard.outline` is a required model invariant, so a serializable board cannot
silently omit its outline. Polygon/round-rectangle containment uses the existing
outline geometry boundary rather than canvas pixels.

## Verification

- New readiness tests: fully unrouted, partially routed, fully routed,
  outside-board pads/tracks, intentional connector-body overhang, and manual
  design-rule enforcement.
- Center/spread, explicit staging, too-small outline, and idempotent sync tests.
- History record metadata/redo-state and manual routing-rules UI tests.
- Full Vitest repository run: **499 passed, 9 intentionally skipped** across 83
  files; no failures.
- TypeScript: clean.
- Targeted ESLint for every changed correctness surface: zero warnings/errors.
- Production Next.js build: successful, including all 40 static pages. The same
  five known Turbopack dynamic Java/ngspice tracing warnings remain.
- RouteBench: direct/500-track p50 **0.11 ms**; walk-around p95 **0.42 ms**,
  comfortably inside the 16 ms and 50 ms gates.
- Real in-app browser verification on the Smart Route demo: the toolbar showed
  **Not ready · 1 unrouted**; batch DRC exposed the blocking `incompleteNet`;
  a 0.55 mm manual rule saved under **Undo Edit routing rules for SIGNAL**;
  one Undo restored 0.25 mm and exposed the matching Redo; the history popover
  displayed the named command and `undone` state. A fresh no-board project
  opened the centered/preserve/spread import dialog with the safe defaults
  checked. Browser console: no errors.

## Deliberately not claimed

This pass does not add shove routing, differential-pair tuning, blind/buried via
manufacturing profiles, arbitrary polygon-outline enlargement, or a full
constraint-area editor. Those remain separate features; this work establishes
the correctness gates they must obey.
