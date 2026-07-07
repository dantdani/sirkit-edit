# Stage 5 — Manual placement + rats-nest (worker B)

## What changed
The board is now editable: immer-patch undo/redo stack, click/shift/marquee selection,
grid-snapped move with live courtyard-collision feedback (illegal drops snap back,
Alt forces with a persistent red ghost), R/F/arrow/Escape/Ctrl+Z keys, bottom-side
mirrored rendering (deferred from Stage 3), and live per-net-cached MST airwires.

## New files
- `app/lib/pcb/history.ts` — pinned `PcbHistory`; immer `produceWithPatches`, 200-entry cap.
- `app/lib/pcb/ratsnest.ts` — pinned `Airwire` + `computeRatsnest`; per-net cache.
- `app/lib/pcb/side.ts` — `oppositeLayer` / `effectivePadLayers`.
- `app/lib/pcb/tools/select-move.ts` — gesture state machine + keyboard; owns the
  derived `violations: Set<string>` (never in `PcbBoard`) and rAF-throttled airwires.
- Tests: `__tests__/history.test.ts`, `ratsnest.test.ts`, `side.test.ts` (21 tests).

## Modified
- `render/scene.ts` — pinned additions (below) + per-instance records (transform fast
  path), bottom-side rendering, ghost tints surviving rebuilds, overlay airwires/marquee,
  `modifiers` on `ScenePointerEvent`, extensions `pickIn(rect)` / `setMarquee(rect|null)`.
- `render/footprint.ts` — `mirrorPlan(plan)`: ops mirrored in local X, layers through
  `oppositeLayer`; scene builds a second lazy `GraphicsContext` set per def for bottom.
- `demo/demo-board.ts` — deterministic demo `padNets` (12 nets default / 100 high,
  ~half of pads netted) so airwires are exercisable in `?pcbdemo=`. Flagging: Stage 3
  file, additive change only.
- `package.json` — `immer ^10` (the one allowed dependency).

## New exports (signatures)
```ts
createHistory(initial: PcbBoard): PcbHistory
interface PcbHistory { present; execute(label, mutate); undo(); redo();
  canUndo; canRedo; subscribe(cb): () => void; transient(mutate) }  // as pinned
interface Airwire { netId: number; from: Vec2; to: Vec2 }           // nm, world
computeRatsnest(board: PcbBoard, changedNets?: number[]): Airwire[]
padWorldPosition(inst: FootprintInstance, pad: Pad): Vec2
oppositeLayer(layer: LayerId): LayerId
effectivePadLayers(pad: Pad, side: 'top' | 'bottom'): LayerId[]
mirrorPlan(plan: FootprintPlan): FootprintPlan
createSelectMoveTool(deps): { handlePointer(e); handleKey(e): boolean; refreshAirwires(); destroy() }
// PcbScene additions (pinned): setAirwires, setInstanceTransform, getLayerContainer, setGhost
// PcbScene extensions (not pinned): pickIn(rect: BBox), setMarquee(rect: BBox | null)
```

## PcbEditor.tsx changes (FLAG FOR LEAD — rebase me onto your merge)
Mechanical wiring only; hunks:
1. Imports: `createHistory`/`PcbHistory`, `createSelectMoveTool`/`SelectMoveTool`.
2. New refs `historyRef`, `moveToolRef`, `selectionRef` (+ `state.selection` in the refs effect).
3. New effect "History + move tool lifecycle": boards not emitted by the stack
   (`history.present !== state.board`) reseed history + tool; `history.subscribe`
   dispatches `set-board`. Undo does NOT span a re-sync (deliberate).
4. Pointer switch: footprint select/hover branches replaced by
   `moveToolRef.current?.handlePointer(e)`; outline-handle drag unchanged, but on
   pointer-up commits ONE `execute("Edit outline")` entry.
5. Keydown: `moveToolRef.current?.handleKey(e)` first, Escape fallback kept.
6. `onStackupChange`/`onOutlineChange`/`handleAssign` route through `history.execute`
   (fall back to plain dispatch when no history yet).

## Perf (verification #3)
Node benchmark of the exact per-frame drag work, `high` demo (600 inst, >10k prims,
100 nets), 20-instance marquee, worst case (all 100 nets changed), 600 frames:
- per-frame CPU avg **6.9 ms** (p50 6.6, p99 11.4) vs 18.2 ms budget @55 fps:
  transient 2.4 + ratsnest 4.4 + collision 0.1.
- gesture-start obstacle index 7.0 ms (once per drag); full ratsnest (drop/undo) 7.5 ms.
- Render side is transform-only (no geometry rebuild), i.e. cheaper than Stage 3's
  proven 60 fps full-scene load. **HUD `fpsAvg` in-browser still needs a manual pass**
  (no browser automation available in this environment) — expect ≥55.
- Perf notes: immer auto-freeze deliberately kept ON (freeze flag is immer's fast
  path; OFF made transient 4× slower). `computeRatsnest(board, changed)` gathers pads
  for changed nets only; Prim on typed arrays (still O(k²), no spatial index).

## Verification results
- `pnpm tsc --noEmit`: clean for everything except worker A's in-flight
  `connectivity-board.ts` / its test (mid-edit while I ran; not mine).
- `pnpm test`: 116/117 pass; the 1 failure is worker A's in-flight perf assertion.
  All Stage 5 tests pass: execute/undo/redo deep-equal; 200-cap eviction; transient+
  execute = ONE entry restoring pre-transient; 25 seeded gestures + 25 undos deep-equal;
  4-pad square → 3 airwires @ 30 mm (< worst chain); `changedNets` cache identity;
  bottom pad mirroring (mirror-before-rotate); `oppositeLayer` involution; PinHeader
  THT pads on all 4 copper layers both sides; silk/text swap+mirror in `mirrorPlan`.
- Manual browser pass (R/F/arrows, Alt-drop, bottom-copper visual) pending — code
  paths covered by tests; page serves 200 on `?pcbdemo=high`.

## TODOs / carve-outs honored
- Collision is bbox-level (exact courtyard polygons = Stage 12 DRC).
- Bottom text is X-mirrored (KiCad readable-through-board convention) — by design.
- Marquee live-updates selection per move event; fine at 60 Hz, revisit if React
  render cost ever shows up.
- No delete (toast points at re-sync), no non-90° rotation, no auto-pan.

## Flag to Stage 6
`getLayerContainer(layer)` and `setAirwires(wires)` are live (paste layers throw —
no container in the pinned paint order). `computeRatsnest` internals are yours to
replace with `computeConnectivity().airwires` at the wave-end integration window;
the editor call sites live in `tools/select-move.ts` (`runAirwires`, one place).
