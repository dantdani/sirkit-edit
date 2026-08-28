# B07 — Schematic Graph Command Contract

## Operation vocabulary (all `schemaVersion: 1`, `units: "px"`, integer grid)

| Kind | Input | Inverse | Validation |
|---|---|---|---|
| `schematic_add_wire` | wire snapshot + `atIndex` | indexed delete | id reuse, ≥2 vertices, index bounds, integer coords |
| `schematic_delete_wire` | `wireId` | indexed add (exact position) | target exists |
| `schematic_update_wire_geometry` | `wireId`, full vertex array | update with prior vertices (captured pre-apply) | target exists, ≥2 vertices |
| `schematic_add_net_label` | label snapshot + `atIndex` | indexed delete | id reuse, non-empty name, orientation domain, index bounds |
| `schematic_delete_net_label` | `labelId` | indexed add | target exists |
| `schematic_update_net_label` | `labelId`, patch {position?, name?, orientation?} | patch of prior values | non-empty name, orientation domain |
| `schematic_add_component` | family + snapshot + `atIndex` | plain delete (fresh adds have no incident cleanup) | id reuse, display-reference uniqueness, index bounds |
| `schematic_set_component_properties` (extended) | theory patch gains `refDes: string \| null` | prior value + prior refDes (**null restores field ABSENCE** so undo of a first rename is digest-exact) | trimmed, non-empty, unique display (`refDes ?? id`); kicad refuses null |

Wires and labels are order-preserving collections: adds are indexed, deletes
invert to indexed adds, so array order and entity indexes survive
delete/undo/redo exactly. Duplicate operation ids, missing targets,
non-finite/non-integer coordinates, invalid rotations, malformed vertex
arrays, and empty labels all reject with nothing applied.

## Command bindings (kernel; discovery/tool exposure: NONE)

- `schematic.connect` → the six wire/label ops. One click (wire segment,
  split, junction, label add/delete) = one atomic transaction.
- `schematic.add-component` → indexed placement (theory + kicad).
- `schematic.move-rotate` → transform + wire geometry + label update (the
  gesture batch: one completed drag commits everything together).
- `pcb.undo-redo-canonical` → all of the above for verified replay.

## The graph-diff compiler (`schematic-graph.ts`)

Migrated handlers keep their existing geometry math (splits, L-bends,
consolidation, drag deltas) and hand the RESULT to
`diffSchematicGraphOps(before, after)`, which emits the primitive batch and
**simulates it**: if sequential application would not reproduce `after`
exactly (order included), it throws (`GRAPH_DIFF_ORDER`) instead of
committing something else. Fail-closed boundaries: component REMOVAL through
the diff is forbidden (`GRAPH_DIFF_COMPONENT_REMOVAL` — deletions go through
the B06 impact-plan path), and kicad identity/authority changes are
forbidden (`GRAPH_DIFF_IMMUTABLE` — replacement stays grant-gated per
B06.2). Click handlers rebuild their "after" from the canonical head INSIDE
the serialized session queue; split-part ids are minted exactly once there.

## Junction contract (pinned, unchanged semantics)

Junctions are DERIVED, not stored: the junction tool and wire drawing SPLIT
wires at shared points; rendering derives dots from points touched by ≥3
wire endpoints; connectivity derives from exact coordinate identity plus
same-name labels (union-find). `splitWiresAtPoint`/`consolidateWires` are
idempotent at an already-split point (no hidden normalization drift — tested).
Crossing-without-junction remains electrically DISCONNECTED unless split —
current behavior, preserved and now pinned by tests. No junction entity was
invented.

## Exposure

No new tool descriptor, provider schema, discovery entry, MCP surface, or
HTTP route. `schematic.connect`/`schematic.add-component` remain
not-callable/internal-only in the B04 catalog (tested); tier-1 proposals
gained NO new op kinds (theory rename from proposals stays blocked pending an
explicit activation decision).
