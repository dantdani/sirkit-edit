# Stage 15 — 3D preview

Side-panel 3D render of the board: FR4 slab, copper layers (incl. in1/in2 on 4-layer stacks),
tracks as extruded capsules, vias as instanced cylinders with dark drill voids, Stage 11 zone
fills extruded per layer, semi-transparent solder-mask slabs, silk strokes from footprint
graphics, footprint placeholder boxes + refdes billboards. Orbit/zoom/pan, Top/Bottom/Iso camera
presets (300 ms smoothstep fly), six palette variants, per-group toggles (Mask/Silk/Zones/Parts/
Refdes — "show copper only" = Mask+Silk off).

**Framework path: React Three Fiber** (`three@0.185`, `@react-three/fiber@9.6` — the React 19
line — `@react-three/drei@10.7`, drei used only for `OrbitControls`). No Next 16 boundary issues:
the entire module is `next/dynamic({ ssr: false })` from PcbEditor, so three never touches the
server or the initial bundle. **Measured first-load JS delta: +206 bytes** (1,575,805 → 1,576,011;
budget < 5 KB); three (~909 KB) verified inside a lazy chunk fetched only when the panel opens.

**Rebuilds are throttled 100 ms on board commits — no per-frame board reads.** `usePcb3d` adopts
a new board snapshot at most every 100 ms (Stage 11's derived zone-fill writes ride the same
commit signal, so pours appear automatically), rebuilds via `buildScene`, and disposes the prior
scene's geometries/materials/textures. Between mutations the scene is fully static; visibility
toggles and palette changes also rebuild (rare user actions, tens of ms).

**Coordinates:** scene = mm, board in XY plane, +Z out of the board top, `camera.up = +Z`. Board
+y (down) is negated exactly once in `3d/convert.ts` — Stage 1's CCW-under-y-down rotations
become standard CCW, and the board reads correctly from above.

## New files
`app/lib/pcb/3d/`: `types.ts` `layer-heights.ts` `palette.ts` `convert.ts` `build-scene.ts`,
`geom/`: `track-shape.ts` `zone-shape.ts` `pad-shape.ts` `via-mesh.ts` `footprint-mesh.ts`
`board-substrate.ts`; `app/components/pcb/PcbPreview3D.tsx`, `hooks/usePcb3d.ts`; tests
`3d-track-shape` `3d-zone-shape` `3d-build-scene` (10 tests). New deps: three, @react-three/fiber,
@react-three/drei, @types/three.

## New exports (pinned surface)
- `SceneParams { palette; showMask; showSilk; showZones; showFootprints; showRefdes; cameraPreset? }`,
  `Palette { fr4; copper; pad; silk; mask; footprintPlastic; refdesText; background }`,
  `BuiltScene { substrate; copperMeshesByLayer; vias; silkTop; silkBottom; mask; footprints; refdesLabels; boardBoundingBoxMm }`
- `LAYER_HEIGHTS_MM` (1.6 / 0.035 / 0.025 / 0.015 / 1.0), `zStackup(is4Layer)` → slab z + height per
  layer (inner coppers at core thirds), `PALETTES` (green/red × HASL, green/blue/black/purple × ENIG),
  `DEFAULT_PALETTE_ID = "green-hasl"`
- `trackShape(a, b, widthNm): THREE.Shape` (capsule; zero-length → circle),
  `zoneRegionShape(region): THREE.Shape` (winding normalized: outer CCW, holes CW),
  `padShapes(inst, pad): THREE.Shape[]` (reuses Stage 6 padWorldShape + Stage 11 polygonizers),
  `buildViasMesh(vias, stack, palette): THREE.Group` (two InstancedMeshes: barrels + drills),
  `buildFootprintPlaceholder(fp, palette, labelStyle): THREE.Group`, `buildRefdesSprite`,
  `isPlaceholderCandidate`, `buildBoardSubstrate(board, palette)`, `outlineShape(outline)`,
  `buildScene(board, params): BuiltScene`, `disposeScene(scene)`
- `usePcb3d(board): { scene; sceneParams; setToggle; paletteId; setPaletteId }`, `PcbPreview3D({ board })`

## Deviations (documented)
- **Refdes labels are canvas-textured `THREE.Sprite`s, not drei `<Text>`** — sprites billboard for
  free and keep `buildScene` pure three (node-testable; textures degrade gracefully without DOM).
- `buildViasMesh` returns a Group of two InstancedMeshes (pinned text wanted the dark drill anyway).
- Mask "cutouts": pads/via barrels extrude PAST the semi-transparent mask slab in the finish color
  instead of boolean cutouts (higher-fidelity cutouts deferred; no CSG per the constraints).
- BuiltScene gained `mask` (its own toggleable group) alongside the pinned fields.
- Spec's diagonal-track bbox figure ("√2·10 + 0.25") was the capsule LENGTH; the test asserts the
  true axis-aligned bbox span (10.25 mm per axis) — noted inline.

## Integration hunks
**PcbToolbar.tsx** (coordinated — lead merged it with their Stage 14 fab button):
```tsx
/** Stage 15: toggle the 3D preview panel (button hidden when absent). */
onToggle3d?: () => void;
preview3dOpen?: boolean;
{onToggle3d && (<button … title="3D preview" onClick={onToggle3d}
  className={iconButtonClass(preview3dOpen === true)}><Box className="size-3.5" /></button>)}
```
**PcbEditor.tsx**: `preview3dOpen` state, lazy `dynamic(() => import("./PcbPreview3D"), { ssr: false })`,
right side sheet (w-[min(560px,85%)]) hosting `<PcbPreview3D board={state.board} />`; three mounts
only while the panel is open (GL context freed on close).

## Verification
- `pnpm test`: 47 files / 292 passed (all prior stages + Stage 14's suites green). `pnpm tsc
  --noEmit` clean; eslint clean on touched files.
- `pnpm build` succeeds; first-load delta +206 B (< 5 KB); three in a lazy chunk (grep-verified).
- Scene-graph unit tests: empty board, routed demo with a poured full-board GND plane (the
  fixture's own small zone overlaps no GND copper — islands correctly drop it), 4-layer Z spacing,
  visibility params. Rendering itself is manual-eyeball per the plan (no headless GL): panel flow,
  60 fps feel, and the six palette variants need a human pass in the browser — geometry, palettes,
  toggles, and camera-preset math are covered by the unit layer.

## TODOs / deferred
VRML/STEP footprint models (v2); blind/buried vias (render full-stack today); solder fillets;
real mask cutouts around pads; camera-state + palette persistence to localStorage; silk arcs +
text glyphs (lines/rects/polys/circles land); inner-layer copper is occluded by the opaque
substrate (visible only from board edges — substrate transparency toggle is future polish);
track InstancedMesh migration if 500+-track boards ever drop below 60 fps (tracks are currently
ONE merged ExtrudeGeometry per layer — few draw calls).
