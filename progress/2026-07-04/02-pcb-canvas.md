# PCB Stage 3 — Board canvas shell + layer system

Date: 2026-07-04 · Status: done (perf gate passed, verified in real Chrome)

WebGL board canvas (PixiJS v8 + pixi-viewport v6) behind the PCB tab: pan/zoom,
adaptive grid, per-layer compositing, layer panel, editable outline, flatbush
hit-testing, offline demo board. **Stage 5 consumes `PcbScene`; Stage 6 adds
copper into the container list below — the container order is the contract.**

## New files
- `app/components/pcb/`: `PcbEditor.tsx` (shell, useReducer), `PcbCanvas.tsx`
  (Pixi lifecycle, StrictMode-safe), `LayerPanel.tsx`, `PcbToolbar.tsx`, `DebugHud.tsx`
- `app/lib/pcb/render/`: `scene.ts`, `footprint.ts` (PURE planner — no Pixi, so
  vitest runs in node), `outline.ts`, `grid.ts`, `colors.ts`, `pick.ts`
- `app/lib/pcb/demo/`: `demo-board.ts`, `fixtures.ts` (GENERATED — header says so)
- `scripts/gen-demo-fixtures.ts`; tests `render/__tests__/{pick,footprint-geometry}.test.ts`
- Deps added (exactly as specified): `pixi.js 8.19.0`, `pixi-viewport 6.0.3`, `flatbush 4.6.2`

## Modified files
- `app/page.tsx` ⚠️ contended, lead review — my entire diff (5 lines; the file
  also carries unrelated pre-existing local changes from another workstream):
```diff
 import { useState, useRef, ... } from "react";
+import dynamic from "next/dynamic";
+const PcbEditor = dynamic(() => import("@/app/components/pcb/PcbEditor"), { ssr: false }); // Pixi needs window
 import ReactMarkdown from "react-markdown";
@@
+              ) : view === "pcb" ? (
+                <PcbEditor />
               ) : (
                 <div className="absolute inset-0 flex ...">
-                  {view === "pcb"       && "PCB layout canvas"}
                   {view === "3d"        && "3D view"}
```
- `package.json`/`pnpm-lock.yaml` (the three deps). Nothing else.

## New exports (pinned)
- `render/scene.ts`: `createPcbScene(): PcbScene`; `PcbScene` exactly as spec'd
  (`mount/destroy/setBoard/setLayerVisible/setActiveLayer/setSelection/setHover/
  onPointer/worldFromScreen/zoomToFit/stats`) **plus 2 documented Stage 3
  extensions**: `setTool("select"|"pan")`, `setGridVisible(boolean)`.
  `ScenePointerEvent` as spec'd; `PickResult` re-exported from `render/pick.ts`.
- `render/pick.ts`: `buildPickIndex(entries): PickIndex` (`pickAt`, `pickIn`
  = containment marquee), `PickResult`, `OutlineHandleId`.
- `render/footprint.ts`: `planFootprint(def): FootprintPlan` (per-layer mm draw
  ops + primitive counts), `pixiRotation(deg) = -deg·π/180`, `rotateLocalMm`.
- `render/outline.ts`: `drawOutline`, `outlineHandleSpots`,
  `applyHandleDrag(outline, handle, worldNm)` (pure, clamps ≥10×10 mm).
- `demo/demo-board.ts`: `buildDemoBoard(density: "default"|"high"): PcbBoard`.

## Perf gate (verification #2)
`?pcbdemo=high` → HUD: **primitives 16,600 · fpsAvg 60.0 · fpsMin 60.0** after
11 s of continuous scripted pan/zoom (wheel zoom-to-cursor at an orbiting
point). Zero page errors. Chrome 149.0.7827.197 (headless=new, GPU on), this
dev machine (Windows 11). Idle fpsMin dips (~12) are the initial scene build
frame only; during pan/zoom no window dropped below 60.

## Verification summary
1 ✓ demo board renders: teal pads / zinc silk / amber outline / #09090b bg; UI
shows displayName only. 2 ✓ perf (above). 3 ✓ Top Copper eye-toggle hides pads
same frame; Bottom Copper active dims top copper to 35%; stackup 4 reveals
Inner 1/2 rows (13→15 panel rows). 4 ✓ 80×60 preset leaves primitives at 838;
SE-handle drag 160×120→130×100 live; over-drag clamps (height pinned at 10 mm);
roundrect renders arc corners. 5 ✓ hover tracks, click selects one, Escape
clears. 6 ✓ 60/60 vitest, `tsc --noEmit` clean, eslint clean. 7 ✓ page.tsx
hunk above.

## Fixed during verification
- Planner emits paste-layer ops but the pinned container list has no paste
  containers → scene now skips layers without a container (crash fix).
- `in1`/`in2` are defaultVisible in LAYERS → on 2-layer boards those containers
  are force-hidden (THT pads were painting amber/pink inner copper).

## TODOs / known limitations
- Bottom-side instances not rendered (mirroring = Stage 5; TODO in scene.ts).
- Picking is bbox-level (pad-exact = Stage 5). Text metrics approximate
  (BitmapText scale ≈ KiCad size; stroke-font fidelity post-MVP).
- Pads rotated off-axis tessellate roundrect corners (6 seg/90°) — exact enough
  visually; native roundRect used only via polygon path.
- High-density demo overflows the 160×120 outline bottom (row-flow packer) —
  cosmetic, perf build only.
