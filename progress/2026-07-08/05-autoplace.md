# Stage 8 — One-click auto-place

## What changed

Force-directed auto-place (the pinned algorithm — SA fallback never needed; the
30-fp fixture converges in ~120 iterations, well inside the 400 budget):
springs between netlist-connected footprints, 1/d² Coulomb repulsion
(bbox-gap broad phase at 20 mm), soft boundary force, seeded-grid initial
positions for off-board parts. **Rotation is post-process, not per-iteration**
(4-way 90° scoring against each pad's connected external pads).
**Collision resolution runs after grid snap, not before** (per-axis hard clip
into the outline → ≤8 greedy grid-step nudges along the centroid vector → BFS
spiral). Locked footprints (`locked === true`, forward-compatible optional
flag) are respected everywhere: force sources but never integrated, rotation
kept, act as immovable obstacles, omitted from the result/undo payload.

## New files (all owned)

- `app/lib/pcb/autoplace/types.ts` — `AutoPlaceParams`, `AUTO_PLACE_DEFAULTS`,
  `resolveParams`, `FootprintPlacement`, `AutoPlaceResult`, `AutoPlaceRotation`
- `app/lib/pcb/autoplace/prng.ts` — `mulberry32(seed)`, `fnv1a(s)`,
  `hashBoardNetlist(board, netlist | null)`
- `app/lib/pcb/autoplace/geometry.ts` — internal helpers (extra file, owned
  dir): `localCourtyardBBox`, `worldCourtyardBBox`, `bboxesOverlap` (strict,
  mirrors Stage 5's select-move semantics), outline fit/clip primitives
- `app/lib/pcb/autoplace/force-directed.ts` —
  `runForceDirected(input: ForceDirectedInput): ForceDirectedResult`
- `app/lib/pcb/autoplace/rotation.ts` —
  `optimizeRotations(board, positions, lockedIds): Map<string, 0|90|180|270>`,
  `snapRotation`
- `app/lib/pcb/autoplace/collision-resolver.ts` —
  `resolveCollisions(board, placements, gridNm)`
- `app/lib/pcb/autoplace/command.ts` — `AutoPlaceApplyCommand`,
  `buildAutoPlaceCommand`, `mutateBoardWithAutoPlace`, `applyAutoPlaceCommand`,
  `invertAutoPlaceCommand`
- `app/lib/pcb/autoplace/auto-place.ts` —
  `autoPlace(board, netlist | null, params?): AutoPlaceResult`, `isLocked`,
  `ratsnestLengthNm`
- `app/components/pcb/hooks/useAutoPlace.ts` — `useAutoPlace(editor)` →
  `{ state, lastResult, lastError, run() }`
- Tests: `auto-place.test.ts`, `force-directed.test.ts`, `rotation.test.ts`,
  `collision-resolver.test.ts`, `autoplace-command.test.ts`, shared
  `autoplace-fixture.ts`

## Integration hunks (lead / Stage 5 owner review)

**No `commands.ts` hunk.** The plan pinned extending a `PlacementCommand`
union, but Stage 5 as landed has no command layer (immer-patch history only).
Following the Stage 9 `AutorouteImport` precedent, `AutoPlaceApply` is
self-contained in `autoplace/command.ts`; the live editor commits it as ONE
entry via `history.execute("Auto-place", d => mutateBoardWithAutoPlace(d, cmd))`
— single Ctrl+Z reverts the whole batch (round-trip tested). Zero read-only
file changes.

`PcbToolbar.tsx` (button + 2 props, mirrors the Stage 9 button):

```tsx
  /** Stage 8: one-click auto-place (button hidden when absent). */
  onAutoPlace?: () => void;
  autoPlacing?: boolean;
  …
      {onAutoPlace && (
        <button type="button" title="Auto-place footprints" aria-label="Auto-place footprints"
          onClick={onAutoPlace} disabled={autoPlacing}
          className={`${iconButtonClass(false)} disabled:opacity-50`}>
          {autoPlacing ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
        </button>
      )}
```

`PcbEditor.tsx` (wiring, exactly like Stage 9 — flagged, not in the pinned
file list, needed for the button to function):

```tsx
import { useAutoPlace } from "./hooks/useAutoPlace"; // Stage 8 integration
  …
  const autoPlace = useAutoPlace({
    getHistory: () => historyRef.current,
    getNetlist: () => netlist,
    toast: setToast,
  });
  …
          onAutoPlace={() => void autoPlace.run()}
          autoPlacing={autoPlace.state === "running"}
```

## Measured (30-fp fixture, demo-style netlist)

- elapsedMs: **~60 ms** (target < 500) · 118 iterations, converged
- rats-nest: 963.7 mm → 89.0 mm = **−90.8 %** (target ≥ 60 %)
- 100-fp synthetic: **168 ms**, 139 iterations, converged, rats-nest −91 %,
  collision-free, inside outline (goal < 2 s)
- Determinism: two runs → byte-identical placements (JSON compare, test-enforced)

## Deviations from the pinned sketch

- `hashBoardNetlist(board, netlist | null)` instead of `(boardId, netlist.hash)`
  — `PcbBoard` has no `id`; seed hashes outline + nets + footprint identity
  (positions excluded so re-runs after manual tweaks keep the seed). `netlist`
  is nullable: connectivity comes from the board's own `padNets` (same source
  the rats-nest uses); the netlist only sharpens the seed.
- `gridNm` defaults to 100 μm via params — there is no `board.grid` field.
- No exported `checkPlacementCollision` exists; Stage 5's primitive is private
  to `select-move.ts` (read-only). `autoplace/geometry.ts` mirrors its exact
  semantics (courtyardBBox ?? bodyBBox+0.25 mm, strict world-bbox overlap).
- Rotation scoring is per-pad (each connected pad vs its own net's external
  pads) — subsumes the pinned single-centroid scheme; same test outcomes,
  meaningful rotations for multi-net ICs.
- BFS spiral escalates ring step ×1/×8/×32 (grid-aligned, ≤2500 cells/pass):
  one 50-ring pass at 100 μm only reaches 5 mm — not enough to escape a
  cluster crowded around a 10 mm IC (found by the fixture test).
- Pinned default `repulsionK` (4e14) is gentle by design; the repulsion unit
  test boosts it to exercise the path. Hard separation is the resolver's job.

## TODOs (post-MVP)

- Web Worker path deferred (compute is ~60 ms inline; hook yields one frame
  for the spinner).
- Group-aware placement (decoupling caps next to their ICs) deferred.
- Simulated-annealing fallback available conceptually but never activated —
  force-directed converges inside budget.
- `locked` flag doesn't exist on `FootprintInstance` yet; auto-place reads it
  forward-compatibly and tests inject it.

## Verification

- `pnpm test` — 5 new suites green; Stages 1/4/5/6/7/9/10/12 suites still green.
- `pnpm tsc --noEmit` clean.
- Browser `?pcbdemo=`: Auto-place clusters by net < 500 ms; one Ctrl+Z reverts;
  re-run on same board → identical placements. (Default demo grid serves as
  the naive-grid fixture; no `?pcbdemo=unplaced` variant needed.)
