# Smart Interactive Routing — Phase 0/1 and Walk-around MVP

## Request

Implement the immediate assignment from
`Sirkit_Smart_Interactive_Routing_Agent_Prompt.md` without rewriting the PCB
editor or weakening safety: audit first, build deterministic foundations, then
deliver one-layer H/V/45 direct and CW/CCW walk-around routing with live preview,
atomic commit/cancel/undo, structured history, tests, and RouteBench.

## Audit findings

Sirkit already had the right load-bearing foundation: integer-nanometer board
geometry, exact shape distances, a shared live/batch clearance guard, layer/net
types, Flatbush, connectivity, net-class/routing profiles, Pixi preview, typed
route commands, and Immer undo/redo. The route tool's missing behavior was
candidate generation: it built one two-segment posture and hard-blocked at the
first obstacle.

Two guard defects were found while mapping the new engine:

1. NPTH pads were skipped completely, so interactive copper could cross a hole.
2. pad distance calls did not honor the candidate track/via layer at the guard
   boundary, making a top-only SMD pad obstruct bottom copper.

Both were corrected before Smart Route consumed the guard.

## Changes and why

### Deterministic core

Added `app/lib/pcb/smart-routing/` with schema-versioned contracts, a full
semantic world hash, immutable board adapter, per-layer spatial index,
field-provenance rule resolver, direct candidate generator, bounded CW/CCW
walk-around graph, explicit score breakdown, independent validator,
copy-on-write transactions, replay, and typed AI boundaries.

The generator uses conservative expanded obstacle boxes for traversal but every
finished route is checked against real Sirkit copper/region geometry. This
choice makes the MVP safe while leaving exact offset hulls as a measurable
future improvement.

### Existing editor integration

`createRouteTool` now caches the routing world per board identity, resolves both
direct postures, and invokes walk-around only when both are blocked. The selected
polyline and faint legal alternatives render through the existing Pixi overlay.
Tab cycles candidates. Click commits the selected multi-segment path. Escape/X
cancel without a board write; V and Backspace retain their old behavior.

`RoutingControls` now displays Smart Route ready, Direct route, Walking around,
or No legal path, the alternative index/Tab hint, explanation, and measured
search time.

The golden fixture is also available in the real editor at
`/?pcbdemo=smart-route` for repeatable visual/manual QA.

### Atomic history and replay

Accepted routes append an optional `RoutingHistoryEvent` in the same
`CommitRouteSegment` command as their tracks. Undo/redo therefore changes copper
and its engineering record together. The pure command inverse also removes and
restores events. Replay requires the original semantic world revision and runs
the independent validator again.

### AI trust boundary

The AI adapter can express preferences, rank IDs of already-legal candidates,
and inspect result facts. It cannot return geometry, mutate the board, approve a
violation, or run in the pointer hot path. Existing AI/net-class width and via
rules feed the deterministic rule resolver.

## Additive board fields

- `routingKeepouts?: RoutingKeepout[]`
- `routingHistory?: RoutingHistoryEvent[]`

Legacy boards need no migration and read both as empty.

## Verification completed so far

- Golden direct and fixed-blocker CW/CCW fixtures.
- Independent validation of every returned candidate.
- Fixed-seed randomized obstacle property test.
- Cancel/no-mutation and semantic replay tests.
- NPTH all-layer and SMD layer-isolation regressions.
- Route-command history apply/invert round-trip.
- Integrated route-tool direct/walk/blocked/Tab/atomic commit tests.
- Routing status component test.
- Targeted result: 39 tests passed before the additional status assertion.
- Integrated direct preview with 500 tracks remained below the 16 ms target;
  walk-around remained below the 50 ms p95 target.
- `pnpm pcb:routebench` passes both fail-fast gates.
- TypeScript passed after core and editor integration.

## Explicitly deferred

Shove/springback, via shove, automatic layer changes, differential pairs,
length/impedance tuning, rule-area editing UI, exact polygon offset traversal,
and worker-based hierarchical search are not implemented or claimed. See
`docs/smart-interactive-routing.md` for the architecture, risk register,
benchmark command, migration notes, and exact limitations.

## Final verification

- Full Vitest repository run: **489 passed, 9 intentionally skipped** across 82
  files; no failures.
- TypeScript: clean (`tsc --noEmit` and the production build type phase).
- Targeted ESLint over every new routing module, route integration, renderer,
  hook, status component, tests, and benchmark: zero warnings/errors.
- `PcbEditor.tsx` still has its two pre-existing React ref-during-render lint
  findings in the context-menu/palette builders and two pre-existing dependency
  warnings; the production compiler accepts the file. This phase did not hide
  or rewrite those unrelated surfaces.
- RouteBench final sample: direct/500-track **p50 0.14 ms**; walk-around/single
  blocker **p95 0.78 ms**. Both fail-fast targets pass with wide margin.
- Production `next build`: successful, including static generation of all 40
  pages. The five previously documented Turbopack warnings about dynamic Java/
  ngspice executable tracing remain; none originates in Smart Route.
- Real in-app browser on `/?pcbdemo=smart-route`: status changed to **Walking
  around**, displayed **1/2** and **2/2** after Tab, previewed both paths,
  committed four segments (primitive count **3 to 7**), and one Ctrl+Z while
  still in Route mode restored the board (**7 to 3**).
- Browser QA exposed and fixed a tool-mode keyboard gap: undo/redo are now
  editor-global, so an auto-completed route remains reachable by Ctrl+Z.
