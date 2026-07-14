# PCB — post-MVP backlog

Deferred deliberately. Each entry names the blocker or the design question
that made it post-MVP; none are accidental omissions. Stages append here
instead of building these.

## Routing

- **Push-and-shove routing** — interactive rerouting of neighbor tracks while
  dragging; needs an incremental spatial index + rip-up cost model. The Stage 7
  clearance guard only blocks.
- **Length matching / tuning meanders** — needs net-pair constraints in the
  net-class model and a meander generator.
- **Bus routing** — grouped parallel track gestures.
- **Differential pairs** — paired routing with gap control; DSN export already
  models classes, but the editor has no pair concept.

## Editing

- **Footprint editor** — footprint geometry is owned by `FootprintDef.rawSexpr`
  (Stage 1/13 invariant: verbatim re-emission). Editing pads on the board would
  desync screen from export; a real footprint editor must round-trip the
  s-expression.
- **Pad padstacks** — same invariant: padstacks stay via-only (Stage 17)
  until the footprint editor exists.
- **Teardrops** — generated copper needs to live outside `tracks[]` or export
  breaks; likely a derived-geometry pass like zone fills.
- **Copy/paste of board items** — needs an id-remapping design (stable ids are
  the schematic bridge's anchor; blind duplication would collide).
- **Locked-item UI beyond the toggle** — lock badges, lock-all/none, and a
  locked filter in a future selection panel.
- **Per-item DRC waivers** — waiving a violation needs persistence + UI in the
  DRC panel and export gate awareness.
- **Interactive dragging of copper items** (tracks/vias) — selection is
  Stage 17; re-dragging existing copper with 45° re-snap is push-and-shove
  lite and shares its geometry problems.
- **Visibility-aware picking** — Stage 17 picking hits items on hidden layers;
  filtering needs layer info in the pick index and a scene-side visibility
  check.
- **Per-pad addressing for duplicate pad numbers** — `SelectionRef` pads key
  on `(footprintId, padNumber)` (pinned; `padNets` itself is number-keyed), so
  same-numbered pads (thermal/GND multi-pads) collapse to the first match in
  picking/inspection. Precise addressing needs a pad index in the model.

## Sync

- **Migrating move/rotate gesture tools onto edit commands** — the Stage 5
  gesture paths (transient/execute) predate the command layer; unifying them
  is mechanical but touchy (drag perf), post-MVP.
