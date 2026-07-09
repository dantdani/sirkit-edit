# Stage 7 — Interactive routing tool (worker B)

## What changed
A pad-to-pad interactive router: click a pad (or track endpoint) to start; a 45°-constrained
two-segment preview follows the cursor; a **live clearance guard** (shared verbatim with
Stage 12 DRC) refuses illegal geometry in real time (red preview + halo + tooltip, no commit);
`V` drops a via and flips the active copper layer; drag a track endpoint to stretch (connected
same-net segments move with it); right-click rips up a whole net. Every action is one undoable
command through Stage 5's immer history.

## New files (owned)
- `app/lib/pcb/route-tool.ts` — state machine + `checkClearance` + `fortyFiveCorner` (PURE, node-testable).
- `app/lib/pcb/route-tool.commands.ts` — `RouteCommand` + apply/invert (PURE).
- `app/lib/pcb/render/route-preview.ts` — dashed Pixi preview overlay + tooltip event.
- `app/components/pcb/hooks/useRouteTool.ts` — React glue (pointer/keyboard/preview/airwire).
- `app/lib/pcb/__tests__/route-tool.test.ts`, `route-tool.commands.test.ts` (22 tests).

## New exports (signatures)
```ts
// route-tool.ts
type RouteToolState = {kind:'idle'} | {kind:'routing'; netId; activeLayer; trackWidth; clearance;
  anchor; preview:{corner;end;legal;blockedBy?;blockedText?}; preferHorizontalFirst}
  | {kind:'stretching'; trackId; grabbedEnd:'a'|'b'; segments:Track[]; preview:{end;legal;blockedBy?;blockedText?}}
interface RouteToolAPI { state; onPointerDown(world,{shiftKey,altKey}); onPointerMove(world);
  onPointerUp(world); onKey('V'|'Escape'|'Backspace'|'X'|'Tab'); cancel(); ripupNetAt(world):boolean; snapshot() }
createRouteTool(getBoard, applyCommand, options?): RouteToolAPI   // options: {undo,getActiveLayer,netClass,grid}
fortyFiveCorner(anchor, end, preferHorizontalFirst): Vec2
checkClearance(board, ClearanceGuardInput): ClearanceGuardResult   // ← Stage 12 imports THIS verbatim
interface ClearanceGuardInput { candidateSegments:Track[]; candidateVias?; ignoreItemIds?; netId; clearance; edgeClearance? }
interface ClearanceGuardResult { legal; blockedBy?:CopperItemRef; distance?; blockedByEdge? }
// route-tool.commands.ts
type RouteCommand = CommitRouteSegment | PlaceViaAndFlipLayer | StretchTrack | RipupNet
applyRouteCommand(board,cmd):PcbBoard;  invertRouteCommand(cmd):RouteCommand
mutateBoardWithCommand(draft,cmd):void;  buildRipupNetCommand(board,netId);  routeCommandLabel(cmd,board?)
// render/route-preview.ts
renderRoutePreview(toolState, getLayer, overlayContainer): void   // emits 'routeTooltip' {text:string|null}
// hooks/useRouteTool.ts
useRouteTool(editor:{scene,getHistory,getActiveLayer?,toast?}): {activate,deactivate,active}
```

## Measured perf (test h)
`route onPointerMove` with 500 existing tracks: **avg 0.24–0.42 ms, p95 0.5–1.2 ms** (budget 8 ms).
Guard rebuilds a flatbush of all copper each move; no caching needed at this scale.

## For Stage 12 (DRC)
`checkClearance(board, input)` is the pinned batch primitive — **import it verbatim**, do not fork.
Rules: same-net → legal iff d≤0 or d≥clearance; other-net/net-0 → require d≥clearance; board edge
is an obstacle at `edgeClearance` (default 0.25 mm). First offender is deterministic
(pads<tracks<vias<edge). `blockedByEdge` is an additive field (edges have no `CopperItemRef`).

## For Stage 10 (net classes)
Defaults hard-coded in `route-tool.ts` (`DEFAULT_TRACK_WIDTH` 0.25 mm, `DEFAULT_CLEARANCE` 0.2 mm,
`DEFAULT_VIA_SIZE` 0.8 / drill 0.4 mm). Pass `options.netClass = getNetClass` when Stage 10 lands —
lazy, no code change to the tool.

## Integration hunks (FLAG FOR LEAD — I applied them; rebase onto the Wave-3 merge)
`git diff --stat`: `PcbEditor.tsx` +40/-8, `PcbToolbar.tsx` +12/-3 (larger than the ≤12-line
target: the tool-mode union touches several spots and the "R" toggle + `?pcbdemo=routed` wiring
add lines). Exact hunks:

**PcbEditor.tsx**
```tsx
// imports
import { buildRoutedDemo } from "@/app/lib/pcb/demo/routed-demo";
import { useRouteTool } from "./hooks/useRouteTool";
// EditorState.tool  &  EditorAction "set-tool": "select" | "pan"  →  "select" | "pan" | "route"
// init (?pcbdemo): add the routed branch
const board = demoParam === "routed" ? buildRoutedDemo()
  : buildDemoBoard(demoParam === "high" ? "high" : "default");
return { board, demo: true, lastSyncHash: null as string | null };
// after the history-lifecycle effect:
const routeTool = useRouteTool({ scene, getHistory: () => historyRef.current,
  getActiveLayer: () => state.activeLayer, toast: setToast });
const { activate: activateRoute, deactivate: deactivateRoute } = routeTool;
useEffect(() => { state.tool === "route" ? activateRoute() : deactivateRoute(); },
  [state.tool, activateRoute, deactivateRoute]);
// scene tool effect:
scene?.setTool(state.tool === "route" ? "select" : state.tool);
// select pointer handler — bail in route mode:
if (toolRef.current === "route") return;
// keydown — "R" toggles route mode; route-mode keys owned by the hook:
if (toolRef.current !== "route" && moveToolRef.current?.handleKey(e)) return;
const editable = e.target instanceof HTMLElement && (e.target.tagName === "INPUT"
  || e.target.tagName === "TEXTAREA" || e.target.isContentEditable);
if ((e.key === "r" || e.key === "R") && !e.ctrlKey && !e.metaKey && !editable) {
  e.preventDefault();
  dispatch({ type: "set-tool", tool: toolRef.current === "route" ? "select" : "route" });
  return;
}
if (toolRef.current === "route") return;
```
**PcbToolbar.tsx**: import `Spline`; widen `tool`/`onToolChange` to include `"route"`; add a route
button (`onToolChange("route")`, active when `tool === "route"`).

## Design notes / deviations (spec vs reality)
- **nanoid is NOT installed** (spec said it was). Ids use a salted counter (`rt-t-<salt>-<n>`), no new dep.
- **`geometry.polygonEdgeDistance` doesn't exist**; edge clearance computed from outline edge segments
  via `segmentDistance` − width/2. Edge check is proximity-to-boundary (prevents crossing); it does
  not detect a fully-outside-and-far track (not producible interactively).
- **No context-menu hook exists** (spec assumed Stage 5 made one). Ripup is right-click (`buttons & 2`)
  → `ripupNetAt` → `RipupNet` through history. A menu UI is deferred.
- **Airwire source**: select-move installs pad-MST (`computeRatsnest`); the routed-demo UX needs
  cluster-MST. The hook refreshes `computeConnectivity().airwires` on commit **while route mode is
  active** (rAF-deferred so it wins). The permanent editor swap remains Stage 6's wave-end item.
- Stretch preview shows the live moved segments via an additive `segments` field on the stretching state.
- The tooltip text is computed in the tool (needs board + net names) and emitted by the renderer.

## Adversarial review (13-agent workflow: 5 review dims → per-finding verify)
Found + fixed 6 real defects; verifier **rejected** 1 false positive (different-net stretch —
already guarded). Fixes (all with regression tests):
- **[high] airwire race** — select-move's pad-MST `setAirwires` overwrote the route tool's
  connectivity airwires (independent rAF handles, coalesced-render guard let pad-MST run last).
  Fix: airwires now use a dedicated cancel+re-registered rAF so they're ordered AFTER select-move's
  synchronous history subscriber and win the frame. (`useRouteTool.ts`)
- **[med] off-grid pad overshoot** — snapping a corner that had already collapsed onto an off-grid
  pad center emitted a doubled-back stub and could falsely trip clearance. Fix: skip the snap when
  `rawCorner === end`. (`route-tool.ts` resolveRouting)
- **[med] wrong-layer auto-finish** — routing auto-completed onto a same-net pad with no copper on
  the active layer (leaving an unconnected stub). Fix: require `padHit.layer === activeLayer` to
  complete/snap. (`route-tool.ts`)
- **[low] off-board edge check** — `checkClearance` edge test was unsigned proximity only; a wholly
  off-board candidate passed. Fix: added a point-in-outline test (matters for Stage 12 DRC reuse).
- **[low] roundrect edges** — `outlineSegments` treated roundrect as a sharp rect. Fix: chord-
  approximated corner arcs.
- **[low] pendingGrab leak** — `ripupNetAt` didn't clear a pending track-grab when idle. Fix: always
  `cancel()`.
- **[low, NOT fixed — documented] preview on toggleable layer**: the preview overlay is parented to
  the `edge` (Board Outline) container, so hiding that layer hides the in-progress trace. The clean
  fix needs a non-layer overlay accessor on `scene.ts` (read-only this wave) — flag for Stage 5/6
  to add `getOverlayContainer()`; `edge` (default-visible, stable across rebuilds) is the best
  reachable parent today.

## TODOs (deferred, per spec)
- Push-and-shove / walkaround: **permanently out of MVP.**
- Free-angle mode, length matching, diff pairs, teardrops, meanders: out.
- Via padstack customization + true 4-layer via posture: post-Stage-10 (`flipCopperLayer` is 2-layer).
- Mid-track T-junction split on "extend": deferred (extend starts from the nearest endpoint).
- Preview overlay parent needs a `scene.getOverlayContainer()` (see review note).

## Verification
1. `pnpm test` — 143/143 pass incl. 26 new (4 review-regression); perf test prints avg/p95/max,
   asserts avg & p95 < 8 ms (measured avg ~0.23 ms). ✅
2. `pnpm tsc --noEmit` clean. `pnpm eslint` (all Stage 7 files) clean. ✅
3. Dev server compiles + serves `?pcbdemo=routed` (200), no bundler errors. ✅ (manual browser
   route-to-completion / undo / ripup is the remaining hands-on check — the tool logic is unit-covered.)
4. Illegal-input: covered by `route-tool.test.ts` (guard rejection = no-op commit; deterministic
   offender; off-board edge; wrong-layer no-finish).
5. Adversarial multi-agent review: 6 confirmed defects fixed + regression-tested, 1 false positive
   rejected, 1 documented limitation (see section above).
