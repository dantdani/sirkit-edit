# Sirkit Smart Interactive Routing — Phase 0/1 architecture

## Delivered scope

This implementation turns the existing **R** tool into one Smart Route tool. It
preserves Sirkit's editor, board model, Pixi scene, DRC geometry, connectivity,
net classes, and Immer history. The new subsystem supplies the missing candidate
and transaction layers:

1. adapt the canonical board into an immutable, revisioned routing world;
2. resolve effective rules with field-level provenance;
3. generate both direct H/V/45 postures;
4. when direct copper is blocked, search bounded clockwise and
   counter-clockwise obstacle-boundary paths;
5. rank candidates with a deterministic score;
6. accept only candidates that pass an independent validator;
7. preview the primary path and legal alternatives on the current canvas;
8. commit copper and a structured history event atomically.

No editor rewrite and no external/GPL router code were used. The implementation
is clean-room TypeScript built on Sirkit's own integer-nanometer model.

## Component map

| Surface | Responsibility |
| --- | --- |
| `smart-routing/types.ts` | Schema-versioned world, rules, intent, candidate, diagnostics, transaction contracts. |
| `smart-routing/world.ts` | Canonical board adapter and full semantic world revision. |
| `smart-routing/spatial-index.ts` | Per-layer Flatbush broad phase. |
| `smart-routing/rules.ts` | Manufacturing/net-class/DRC/board/session precedence and explanations. |
| `smart-routing/candidates.ts` | Direct postures, bounded sparse graph, CW/CCW walk-around. |
| `smart-routing/scoring.ts` | Length/bend/via/movement/congestion/stability score terms. |
| `smart-routing/validator.ts` | Independent topology, angle, self-crossing, clearance, edge, hole, and keepout gate. |
| `smart-routing/transaction.ts` | Copy-on-write preview lifecycle, structured commit record, replay. |
| `smart-routing/ai-tools.ts` | Typed AI intent/ranking/inspection boundary; no coordinates or authority. |
| `route-tool.ts` | Existing interaction state machine; now consumes Smart Route results. |
| `render/route-preview.ts` | Current Pixi overlay, selected path, faint alternatives, blocked halo. |
| `RoutingControls.tsx` | Direct / Walking around / No legal path status and Tab affordance. |

## Contracts and invariants

All physical coordinates and dimensions are integer nanometers. The world
revision hashes the complete routing semantics: outline, pad placement/shape/
layers/drill, track endpoints/width/layer/net, vias, filled zones, and keepouts.
Array ordering cannot alter the revision.

The immutable `RoutingWorld` is cached for a board identity and rebuilt after a
history commit. Candidate generation reads it but cannot mutate it. A preview
transaction contains the base revision, intent, candidates, and selection. A
cancel returns a closed transaction and proves the current board revision still
matches the base. No transient copper is written to `PcbBoard`.

Every accepted path must satisfy all of these:

- starts and ends at the requested points;
- has no zero-length or non-H/V/45 segment;
- has no non-adjacent self-intersection;
- clears layer-relevant tracks, vias, pads, filled zones, NPTH holes, keepouts,
  and the board edge;
- uses the resolved track width and clearance;
- passes `validateSmartRoute`, which imports no candidate-generation code.

The existing exact `checkClearance` remains the copper/edge authority. Phase 1
also corrects two pre-existing guard defects: NPTH holes now obstruct all copper
layers, and a top-only SMD pad no longer blocks a bottom-layer track.

## Walk-around search

The generator first evaluates both established direct 45-degree postures. It
only pays the walk-around cost when neither is legal. The walk search:

- queries a route corridor through the layer spatial index;
- removes the source/target same-net item and same-net pours;
- inflates each obstacle box by trace radius, resolved clearance, and one grid
  guard step;
- creates stable corner nodes and legal two-posture H/V/45 visibility edges;
- runs deterministic shortest-path search once on each side of the first
  blocker (CW and CCW);
- simplifies collinear points, validates the complete path independently, then
  sorts by score and stable candidate ID.

The box boundary is a conservative traversal hull; final clearance is still
computed against the real capsule/circle/pad/region geometry. Conservatism may
reject a path that an exact polygon-offset router could find, but it cannot make
an illegal path committable.

## Rules and explanations

The resolver records every applied source. Hard manufacturing floors are
followed by the net class and optional effective DRC minimums. Board route
preferences select explicit track/via choices without going below those hard
minimums. Session values can tighten constraints but cannot weaken clearance or
edge safety. The setup card exposes the resulting path decision; detailed
sources remain in the typed result/debug data.

## Commit, undo, replay, and determinism

Preview IDs and candidate IDs are semantic hashes, not random IDs. Repeated
world + intent + rules produce byte-equivalent candidate geometry and ordering.
Only final track IDs use the editor's established unique-ID generator.

On click, the route tool rebuilds final track objects, creates one
`RoutingHistoryEvent`, and sends both through `CommitRouteSegment`. Immer records
the copper and event as one undo entry. The event contains base revision,
candidate ID/mode/direction, points, segment IDs, effective rules, score, and
explanation. Replay refuses a different base revision and re-runs the
independent validator before returning tracks.

## AI boundary

AI is intentionally outside the pointer-move hot path and outside the geometry
trust boundary. The typed bridge permits only:

- intent suggestions such as shorter / fewer bends / more clearance;
- ranking IDs of candidates already generated and validated by the engine;
- inspection of result facts and limitations.

Unknown or illegal candidate IDs are discarded. AI cannot submit points,
approve a violation, mutate a preview, or bypass commit validation. Existing AI
net-class rules can still influence width/via choices through the deterministic
rule resolver.

## Performance and RouteBench

Open `/?pcbdemo=smart-route`, switch to PCB, press **R**, then route from J1 to
J2 to exercise the golden fixed-blocker CW/CCW fixture in the real editor.

Run:

```text
pnpm pcb:routebench
```

The benchmark warms the engine, then reports direct routing on a 500-track
world and CW/CCW walk-around around a fixed blocker. It fails the process when
direct p50 is at least 16 ms or walk-around p95 is at least 50 ms. The route-tool
suite separately times the integrated pointer-move path.

## Compatibility and migration

- `routingKeepouts` and `routingHistory` are optional additive board fields.
- Boards without them load unchanged and behave as if both arrays were empty.
- Existing route width/via preferences, tracks, vias, zones, connectivity, DRC,
  persistence, exporters, and history remain authoritative.
- Existing direct routing gestures and V / Backspace / Escape / X continue to
  work; Tab now cycles all legal candidates, including the two old postures.
- No automatic migration or destructive rewrite is required.

## Risk register

| Risk | Current control | Remaining work |
| --- | --- | --- |
| Preview corrupts the board | Immutable world + copy-on-write transaction + cancel revision test. | Preserve invariant for shove transactions. |
| Generator and checker share a blind spot | Validator is independent of candidate generation; exact legacy guard is final authority. | Add a second geometric oracle for exact offset hulls. |
| Nondeterministic result ordering | Semantic revisions, stable hashes, explicit sort tie-breaks, fixed-seed tests. | Include platform replay corpus in CI. |
| Dense maze exceeds interaction latency | Direct fast path, cached world/index, 12-obstacle bounded search, RouteBench gate. | Hierarchical corridor expansion and worker cancellation. |
| Conservative boxes report false blocked | Never commits unsafe copper; visible blocked state. | Exact convex/concave offset boundaries. |
| AI attempts geometry or an unsafe choice | Typed candidate-ID-only bridge and legal-candidate filter. | Optional reviewed advisor UI, never pointer hot path. |
| History replay on changed board | Strict base-revision refusal and revalidation. | Explicit user-controlled rebase workflow. |

## Honest limitations and deferred larger specification

Phase 1 is a safe Walk-around MVP, not the entire long-term router:

- one copper layer per candidate; V still places a manual via;
- single-ended nets only;
- H/V/45 segments only;
- existing copper remains fixed; no shove, springback, or via shove;
- no differential-pair, length-tuning, impedance, or return-path engine;
- no rule-area editor (typed keepouts can be loaded/persisted today);
- conservative rectangle traversal around arbitrary obstacle geometry;
- at most 12 nearby obstacles in the interactive search, so very dense mazes can
  return **No legal path** even when a much larger search might find one.

These are fail-closed limits. The next engineering phase is shove with mobility
classes and rollback, followed by via-aware multi-layer routing. Neither is
claimed or silently approximated here.
