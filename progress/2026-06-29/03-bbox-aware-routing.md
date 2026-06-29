# Bbox-aware wire routing (body-accurate obstacles)

**Date**: 2026-06-29 · **Status**: Shipped

## Diagnosis first (the plan was aimed at the wrong layer)
The brief asked to add `Bbox`, a segment/box intersection test, Z-bend detours,
and obstacle-passing to `routeWire`. All of that **already exists** in
`lib/build-auto-layout.ts` (`Bbox`, `segHitsBbox`/`pathViolations`, `routeWireInfo`'s
direct→L→Z→fallback search, `routeWireEndpoints` pin-escape) — and the live layout
routes via `routeWireEndpoints`/`routeOrFail`, **not** the `routeWire` wrapper the
brief targets. Re-implementing the brief would have duplicated code and changed
nothing observable.

A throwaway repro running the real `autoLayoutBuild` on an adversarial netlist
showed the router already produces **zero** body crossings (it converts unroutable
nets to labels). The real bug was the **obstacle boxes**: `obstacleFor`/`footprintBox`
derived them from pin-tip extents only. For a part with pins on ONE side (USB
connector, switch, single-row header), that collapses to a ~24px sliver at the pin
column while the body extends the other way — so a "clean" wire crosses the
*visible* body. Repro boxes: `J1` 24×56, `SW1`/`U2` 24×24. The plan's "pin extents
+ 30px padding" wouldn't fix this (pads the empty side, still misses a deeper body).

## Fix (root cause)
Added an accurate, body-aware box used by both routing and collision spacing:
- `componentBodyBox(instance, part)` — unions pin-tip extents with the symbol's
  **drawn body**, parsed from `symbolRaw` via the existing `kicad/sexp` parser
  (rectangle/polyline/polygon/arc/circle coords; pins & text skipped), transformed
  symbol-mm → world px with the same scale/y-flip/rotation as `kicadPinWorldPos`.
  Cached per part (`WeakMap`); a malformed/graphic-less symbol falls back to pins.
- `obstacleFor` and `footprintBox` now build on it (min-dim clamp / clearance resp.).
  Removed the old `OBSTACLE_DEFLATE` heuristic.
- Theory (`lib/auto-layout.ts`): `compBox` was a fixed 48px square; now uses a
  per-type size table (passives 60×20, sources 40×60, ground 30×30) with rotation.

After the fix the same repro boxes are `J1` 60×94, `SW1` 60×55, `U2` 40×40, `U1`
80×160 — and `wires=38 labels=9` vs `37/9` before (no fallback regression).

## Deviations from the brief (deliberate)
- Real paths are `lib/build-auto-layout.ts` / `lib/auto-layout.ts` (brief said
  `app/lib/`). Only `geometry.ts` is under `app/lib/` and needed no change.
- Did NOT add `segmentIntersectsBbox`/`polylineIntersectsAnyBbox`/`Bbox` to
  `geometry.ts` — equivalents already exist and the router uses them.
- Used the symbol's actual drawn body (the brief's stated intent — "actual symbol
  extents, not heuristic estimates") instead of pin-extent + fixed padding.

## Modified files (only these two)
- `lib/build-auto-layout.ts` — `componentBodyBox` (+ `symbolBodyMm`,
  `collectGraphicPoints`), body-aware `obstacleFor`/`footprintBox`, dropped
  `OBSTACLE_DEFLATE`, imports `rotateXY` + `kicad/sexp` helpers.
- `lib/auto-layout.ts` — type/rotation-aware `compBox` + `THEORY_COMPONENT_SIZES`.

## Known limitations
- Body box is an axis-aligned union of pin extents + graphic extents; an arc is
  approximated by its endpoints/mid (no bulge), good enough at this scale.
- A regression test belongs in `scripts/netlist-validation.test.ts`, but that file
  is outside the allowed edit set for this task.

## Verification
- `npx tsc --noEmit` clean; `pnpm test:netlist` ALL PASS; `eslint` on both files clean.
- Repro (throwaway, since deleted): obstacle boxes now match drawn bodies for
  one-sided parts; 0 self/third-party body crossings.
- TODO (visual): regenerate the Arduino + 3-pin circuit and confirm the wire routes
  around the part body, not through it.
