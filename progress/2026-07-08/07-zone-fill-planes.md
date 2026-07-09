# Stage 11 — Zone fill + 4-layer planes

Copper pours: draw a polygon (Z key) or "Fill layer as plane", assign a net, and the fill engine
computes regions inside the polygon minus per-net-class clearances around every foreign-net
track/via/pad (+ NPTH drills + later-drawn foreign zones), inset 300 µm from the board outline,
with thermal spokes to same-net pads and connectivity-based island removal.

**Polygon lib: `polygon-clipping` 0.15.7** (the pinned substitute, not clipper2-wasm): pure-JS
Martinez–Rueda, MIT, zero init — clipper2-wasm would force async wasm bootstrapping through the
sync fill engine, Next 16 AND vitest. Its runtime exports only a default object while its d.ts
declares named exports; `clipper-adapter.ts` shims both shapes. All arcs are polygonized
CIRCUMSCRIBED, so cutouts are never smaller than the true inflation → DRC-clean by construction.

**Fills are derived state, not commands.** `Zone.fill` lives on the model (persists with the
board) but is written via a new `history.applyDerived()` — no undo entry; undoing a track edit
re-triggers a re-fill via `useZoneFills` (250 ms debounce; marks ALL zones dirty on any foreign
commit — patch introspection deferred). **Zone-vs-zone precedence is draw order: LATER zones cut
into EARLIER fills** (later zone's polygon + clearance is subtracted from earlier zones' pours).
**Explicit `clearanceOverrideNm` is absolute** (bypasses the max-of-classes rule) — that's what
lets DRC fire when an override sits below the fab rules (verification 4).

## New files
`app/lib/pcb/zones/`: `types.ts` `geometry.ts` `clipper-adapter.ts` `compute-fill.ts`
`thermals.ts` `islands.ts` `plane.ts` `command.ts` `drc-check.ts`; `app/lib/pcb/render/zones.ts`;
`app/components/pcb/ZoneTool.tsx`; `app/components/pcb/hooks/useZoneFills.ts`; tests
`compute-fill` `thermals` `islands` `plane` `zone-command` (24 tests).

## New exports (pinned surface)
- `Zone` (extended, in types.ts), `FilledRegion { outer; holes; boundingBox; areaNm2 }`
- `computeFill(input: ComputeFillInput): ComputeFillResult`; `ComputeFillInput { board; zone; effectiveClearance(itemNetId, itemLayer); boardEdgeClearanceNm? }` (default 300 µm)
- `makeEffectiveClearance(board, zone)`, `zoneClearanceNm`, `thermalParamsFor` (spoke = class trackWidth, gap = clearance/2, 4 spokes @ 45°)
- `initClipper(): Promise<void>` (no-op), `polygonDifference(subject, clip)`, `polygonUnion(polys)`, `polygonIntersection(a, b)`, `polygonInflate(polygon, deltaNm)` (+ hole-aware internals)
- `generateThermalSpokes(pad, worldPosition, worldRotationDeg, params): Vec2[][]`
- `filterIslandsByConnection(rawRegions, board, zone): { keep; dropped }` — keeps islands containing a same-net pad or overlapping a track/via that reaches a pad (Stage 6 clusters); keeps ALL when the net has no copper at all
- `makePlaneZone(board, layer, netId, options?)` — polygon = board outline; AddPlane = AddZone with this payload
- `ZoneCommand = AddZone | EditZone | DeleteZone`; `mutateBoardWithZoneCommand` / `applyZoneCommand` / `invertZoneCommand` / `zoneCommandLabel` / `cloneZone`
- `checkZoneFills(ctx)` (zone DRC), `renderZones(board, getLayer)`, `useZoneFills(): { isFilling; lastFillMs; fillAllDirty() }`
- `regionShapeDistance(region, shape, anchor)` — hole-aware zone↔copper distance (zones/geometry.ts)

## Integration hunks (flagged, owner review)
**DEVIATION (like Stages 8/9): no `commands.ts` exists** — Stage 5 history is immer-patch based, so the
zone command union is self-contained in `zones/command.ts`. In its place, `history.ts` (Stage 5) gained:
```ts
applyDerived(label: string, mutate: (draft: PcbBoard) => void): void {
  if (transientBase !== null) transientBase = produce(transientBase, mutate);
  present = produce(present, mutate);
  notify({ label });
}
```
**types.ts** (Stage 1): `FilledRegion` + Zone fields `appearance: "solid" | "hatched"`,
`connection: "solid" | "thermal"`, `clearanceOverrideNm?`, `thermal?`, `fill: FilledRegion[]`, `dirty: boolean`.
**run-drc.ts** (Stage 12) — TODO(stage11) replaced with:
```ts
import { checkZoneFills } from "../zones/drc-check"; // Stage 11
    () => checkZoneFills(ctx), // Stage 11: zone clearance + zone-to-edge + no-net warning
```
**connectivity-board.ts** (Stage 6): `CopperItemRef += { kind: "zone-region"; zoneId; regionIndex }`;
`collectItems` pushes one item per `Zone.fill` region (`anchorsInside: false`); the deferred pass routes
zone pairs through `zoneAwareDistance` → `regionShapeDistance` (hole-aware, so foreign copper inside a
clearance cutout does NOT read as a short; genuine fill contact does).
**route-tool.ts** (Stage 7): `checkClearance` obstacles now include zone regions (rank 3; board edge
bumped to rank 4); same-net zones are skipped (`o.kind === "zone" && o.netId === netId → continue` —
the pour re-flows onto committed copper); `describeBlock` says "Too close to the GND zone".
**drc/format.ts + drc/checks/connectivity.ts** (Stage 12): `refKey`/`refHighlightId`/`refLocation`/
`refWord`/`refNet`/`refLayer` handle `zone-region` (compile-forced by the union extension).
**PcbToolbar.tsx**: Zone tool button (Z, Hexagon icon, spinner while filling) + "Fill layer as plane"
(Layers icon). **PcbEditor.tsx**: `tool: "zone"`, useZoneFills + renderZones effect, ZoneTool +
AddPlaneDialog mounts, Z-key toggle. **board-persistence.ts**: pre-Stage-11 boards get zone defaults on
load. **routed-demo.ts**: zone literal gains the new required fields (`dirty: true` → fills on load).

## Perf & verification
- `computeFill` on `?pcbdemo=routed` with full-board GND zones on BOTH layers: **top ~93 ms, bottom
  ~7 ms isolated (~197 + 6 ms under full-suite load) — target < 300 ms met**; test asserts.
- `pnpm test`: 44 files / 282 passed (Stages 1–13 suites green). `pnpm tsc --noEmit` clean; eslint
  clean on touched files; `pnpm build` (Turbopack) succeeds — polygon-clipping bundles fine.
- Stage 12 integration asserted in tests: poured demo board → zero zone clearance/edge violations;
  `clearanceOverrideNm: 100_000` (< JLC 127 µm) → zone clearance violations fire.
- Stage 7 integration: zone fills are checkClearance obstacles (foreign-net blocks, same-net ignored).
- Browser flow (draw → dialog → fill; move track → re-fill ≤ 250 ms debounce + ~100 ms pour) wired but
  not manually driven here — dev server was already held by another session; engine + DRC + command
  paths are all unit-covered.

## TODOs / deferred
Web Worker fill path (engine is pure & worker-ready); keep-out (negative) zones; polygon vertex
editing (delete + redraw for now; right-click deletes in zone mode); multi-zone stitching optimization;
per-layer dirty tracking via immer patch inspection (currently any commit dirties all zones);
`renderCopper` (Stage 6) still isn't wired into the scene — zone fills render via a PcbEditor effect;
zone stats UI (areaNm2 is on the model). NPTH cutouts use `effectiveClearance(0, layer)`.
