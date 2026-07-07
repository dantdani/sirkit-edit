# PCB Stage 6 — Copper model: tracks/vias/zones + board connectivity engine

Copper is now real: track/via/zone rendering (`render/copper.ts`) and the
board connectivity engine (`connectivity-board.ts`) — union-find over
geometrically touching copper — with cluster-MST airwires, routing completion,
shorts, and orphans. Full rebuild every call, zero caching (pinned decision).
Zones render as unfilled outlines and are **not conductive until Stage 11**.

## ⚠️ For downstream stages

- **Stage 7** starts from `?pcbdemo=routed` (`buildRoutedDemo`) and must route
  its live clearance guard through the `geometry-copper.ts` distances.
- **Stage 9** imports `computeConnectivity` for post-route stats.
- **Stage 12** consumes `shorts` / `orphans` (orphan handling deferred to it).

## New files (all mine per wave-2 ownership; no existing file touched)

- `app/lib/pcb/geometry-copper.ts`, `app/lib/pcb/connectivity-board.ts`
- `app/lib/pcb/render/copper.ts`, `app/lib/pcb/demo/routed-demo.ts`
- `app/lib/pcb/__tests__/geometry-copper.test.ts` (20 tests), `__tests__/connectivity-board.test.ts` (10)

## Pinned exports

```ts
// geometry-copper.ts — ≤0 = touching, Infinity = no shared copper layer
segmentDistance(a1, a2, b1, b2: Vec2): Nm
trackTrackDistance(a, b: Track): Nm
trackViaDistance(t: Track, v: Via): Nm
trackPadDistance(t: Track, inst: FootprintInstance, pad: Pad): Nm
viaViaDistance(a, b: Via): Nm
padWorldPosition(inst, pad): Vec2
// additive: padPadDistance, viaPadDistance (engine needs the full pair matrix),
//           trackShape/viaShape/padWorldShape, padCopperLayers, viaSpannedLayers

// connectivity-board.ts
type CopperItemRef = {kind:'pad';instanceId;padNumber} | {kind:'track';id} | {kind:'via';id}
interface NetConnectivity { netId; clusters: CopperItemRef[][]; complete }
interface BoardConnectivity { nets: Map<number,NetConnectivity>;
  completion: {routedNets; totalNets; percent}; airwires: Airwire[];
  shorts: [CopperItemRef,CopperItemRef][]; orphans: CopperItemRef[] }
computeConnectivity(board: PcbBoard): BoardConnectivity

// render/copper.ts — "holes" added to the getLayer key (via drills need it)
renderCopper(board, getLayer: (layer: LayerId | "holes") => Container): { primitives: number }
```

Perf (test g, 4,940 items, 200 instances): **best 17.7 ms** (runs 23.0/17.7/27.8;
steady ~12 ms standalone) vs 50 ms budget. Best-of-3 full rebuilds — single
cold-call timing swung 45–64 ms on the same binary from Windows scheduler noise.
Engine fast paths (both output-identical, not approximations): exact shared
anchor point = touch without shape math; same-net pair already in one cluster
skips `shapeDistance`.

## ⚠️ Pending integration hunks (Stage 5 NOT merged by wave end — for the lead)

**A. `render/scene.ts`** — inside `setBoard`, copper rebuilds with footprints:
```ts
import { renderCopper } from "./copper";
// in setBoard():
if (!footprintsUnchanged) {
  rebuildFootprints(b);
  primitives += renderCopper(b, (l) => container(l as ContainerKey)).primitives; // Stage 6
  rebuildPickIndex();
}
```
(`container` = Stage 5's `getLayerContainer`; copper LayerIds + "holes" are all
ContainerKeys, hence the narrowing cast. Inside the `!footprintsUnchanged`
branch so the outline-drag fast path doesn't double-draw/double-count.)

**B. airwire source swap** — wherever Stage 5 feeds its overlay from
`computeRatsnest(board)`, replace with `computeConnectivity(board).airwires`
(same `{netId, from, to}` shape). Delete no Stage 5 code — `computeRatsnest`
stays for tests/fallback. Local pinned `Airwire` decl in connectivity-board.ts
then becomes `import type { Airwire } from "./ratsnest"`; the private layer
mapping in geometry-copper.ts swaps to side.ts's `effectivePadLayers`.

**C. `PcbEditor.tsx`** (lead's file) — reach the demo:
```ts
import { buildRoutedDemo } from "@/app/lib/pcb/demo/routed-demo";
// in the init useState, demoParam !== null branch:
board: demoParam === "routed" ? buildRoutedDemo()
     : buildDemoBoard(demoParam === "high" ? "high" : "default"),
```
Optional: `console.info(computeConnectivity(board).completion)` surfaces 2/3
until a HUD chip exists (Stage 7's job).

## Routed demo (`buildRoutedDemo`) — invariants asserted in tests

8 instances, nets GND(1)/VCC(2)/SIG(3) via local stub `padNets`. 13 copperTop
tracks (incl. two-segment 45° bend), 2 copperBottom tracks joined through 2
vias (VCC), unfilled GND zone, SIG deliberately incomplete → exactly 1 airwire,
one VCC stub crossing a GND track → exactly 1 short, one netId-0 track → 1
orphan. Completion reads 2/3 (66.7%).

## Verification

- `pnpm test`: **117/117 (13 files)** — 30 new; Stage 1–5 suites untouched and green.
- `pnpm tsc --noEmit`: clean. No new dependencies.
- `git diff --stat`: new files only; zero lines in contended/Stage-1/scene files.
- `?pcbdemo=routed` visual check **blocked on hunks A+C** (Stage 5 unmerged);
  demo correctness is pinned by the fixture tests above in the meantime.

## TODOs

- Zones non-conductive + unfilled until Stage 11 (hatch skipped; outline+15% fill).
- Orphans reported, handling deferred to Stage 12; net-0 pads never short (by spec).
- Test (e) checks pad-MST against a hand-computed MST; swap in the
  `computeRatsnest` cross-check once Stage 5 lands.
- Post-MVP: arc tracks, zone-as-conductor, teardrops, incremental connectivity.
