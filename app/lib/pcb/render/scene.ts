/**
 * PCB scene graph (PCB Stage 3) — the pinned `PcbScene` API that Stage 5
 * (placement) drives and Stage 6 (copper) extends with more containers.
 *
 * Architecture notes (load-bearing):
 * - World space is MILLIMETER floats (world = nm / 1e6): a 100 mm board spans
 *   100 world units. Raw nanometers must never reach Pixi — f32 vertex
 *   precision dies around 1e8. The nm→mm conversion happens exactly once, at
 *   geometry-build time (render/footprint.ts) or transform assignment.
 * - One shared GraphicsContext per (footprint def, layer); every instance is
 *   a lightweight Graphics referencing it — 400 resistors cost one geometry
 *   build. This instancing is the perf budget.
 * - `eventMode: 'none'` on EVERY object. All interaction is one stage-level
 *   DOM pointer listener + the flatbush pick index — per-object Pixi
 *   interaction is the classic 10k-object trap.
 * - Container paint order (bottom → top) is the Stage 6 contract:
 *   grid, fabBottom, courtyardBottom, silkBottom, maskBottom, copperBottom,
 *   in2, in1, copperTop, maskTop, silkTop, courtyardTop, fabTop, holes
 *   (drills punched in background color above all copper), edge, overlay,
 *   handles.
 */

import {
  Application,
  BitmapText,
  Container,
  Graphics,
  GraphicsContext,
} from "pixi.js";
import { Viewport } from "pixi-viewport";

import type { PcbBoard, FootprintDef, FootprintInstance, Track, Via } from "../types";
import type { LayerId } from "../layers";
import { COPPER_LAYERS } from "../layers";
import { NM_PER_MM } from "../units";
import type { Vec2, BBox } from "../geometry";
import { transformPoint } from "../geometry";
import type { Airwire } from "../ratsnest";
import {
  planFootprint,
  mirrorPlan,
  pixiRotation,
  rotateLocalMm,
  type FootprintPlan,
  type RenderLayerKey,
  type DrawOp,
  type TextOp,
} from "./footprint";
import {
  BACKGROUND_COLOR,
  ACCENT_COLOR,
  HOVER_ALPHA,
  DIMMED_COPPER_ALPHA,
  layerColor,
  layerVisibleByDefault,
} from "./colors";
import { drawGrid, gridNeedsRebuild, type GridCoverage, type ViewRectMm } from "./grid";
import { drawOutline, outlineBBoxNm, outlineHandleSpots, type HandleSpot } from "./outline";
import { footprintWorldBBox } from "../edit/arrange";
import {
  buildPickIndex,
  buildBoardPickEntries,
  PICK_TOLERANCE_NM,
  type PickIndex,
  type PickResult,
  type PickEntry,
} from "./pick";
import type { SelectionRef } from "../edit/commands"; // Stage 17
import { silkItemPolylines } from "../silk/geometry";
import { renderCopper } from "./copper";
import { renderZones } from "./zones";
import { renderSilkItems } from "./silk";
import { renderDimensions } from "./dimensions";
import { dimensionGeometry } from "../dimensions/geometry";

export type { PickResult, OutlineHandleId } from "./pick";

export interface ScenePointerEvent {
  /** Pointer position in model space (integer nanometers). */
  world: Vec2;
  screen: { x: number; y: number };
  type: "down" | "move" | "up" | "leave";
  buttons: number;
  /** Modifier keys at event time (ctrl includes meta). Stage 5 addition. */
  modifiers: { alt: boolean; ctrl: boolean; shift: boolean };
  /** Pre-resolved hit test (handles win over footprints). */
  pick: PickResult | null;
}

export interface PcbScene {
  mount(el: HTMLDivElement): Promise<void>;
  destroy(): void;
  /** Full rebuild is acceptable and expected (outline-only changes fast-path). */
  setBoard(board: PcbBoard): void;
  setLayerVisible(layer: LayerId, visible: boolean): void;
  /** Dims other copper layers to 35% alpha. */
  setActiveLayer(layer: LayerId): void;
  /** Teal outline overlay (footprint ids — kept for Stage 12 zoom-to flash). */
  setSelection(ids: string[]): void;
  /** Stage 17: ref-based selection overlay — copper, pads and text included. */
  setSelectionRefs(refs: SelectionRef[]): void;
  setHover(id: string | null): void;
  onPointer(cb: (e: ScenePointerEvent) => void): () => void;
  /** Screen (canvas CSS px) → model space (nm). */
  worldFromScreen(x: number, y: number): Vec2;
  zoomToFit(): void;
  /** Recenter on a world point (nm); optionally set zoom (px/mm). Stage 12 zoom-to. */
  centerOn(world: Vec2, pxPerMm?: number): void;
  stats(): { primitives: number; fpsAvg: number; fpsMin: number };
  // ── Stage 5 additions (pinned — Stages 6/7 consume) ──────────────────────
  /** Overlay airwires: 1px screen-constant, #71717a @ 50%. */
  setAirwires(wires: Airwire[]): void;
  /** Fast path: transform-only update during drag; NO geometry rebuild. The
   *  pick index is intentionally left stale — `setBoard` (drop/undo/sync)
   *  remains the full-rebuild path that refreshes it. */
  setInstanceTransform(id: string, at: Vec2, rotationDeg: number, side: "top" | "bottom"): void;
  /** Translucent, non-mutating candidate transforms; null restores live board transforms. */
  setPlacementPreview(preview: Array<{ id: string; at: Vec2; rotationDeg: number; side: "top" | "bottom" }> | null): void;
  /** Stage 6 hooks copper rendering here. Throws for paste layers (no
   *  container in the pinned paint order). */
  getLayerContainer(layer: LayerId): Container;
  /** Tool previews live above all layers and never inherit layer visibility. */
  getOverlayContainer(): Container;
  /** Red 50% tint on the dragged instance. Survives setBoard rebuilds until
   *  cleared — courtyard violations persist across drops. */
  setGhost(id: string, state: "none" | "illegal"): void;
  // ── Stage 3/5 extensions (not part of the pinned surface) ────────────────
  /** 'pan' adds left-drag panning; middle-drag pans in both tools. */
  setTool(tool: "select" | "pan"): void;
  setGridVisible(visible: boolean): void;
  /** Marquee query passthrough (see pick.ts): bboxes fully inside `rect`. */
  pickIn(rect: BBox): PickResult[];
  /** Marquee rectangle overlay (nm); null hides it. */
  setMarquee(rect: BBox | null): void;
  // ── [B17-D] view-session mirror ─────────────────────────────────────────
  /** What the viewport shows: centre (nm), zoom (px/mm) and the host size (CSS px); null before mount. */
  viewState(): { centerNm: Vec2; pxPerMm: number; viewportPx: { width: number; height: number } } | null;
  /** Fires after the viewport moved, zoomed, was fitted/centred or resized (the editor mirrors it onto the bus). */
  onViewChange(cb: () => void): () => void;
  /** Net-highlight overlay (amber outlines), independent of the selection overlay. */
  setHighlightRefs(refs: SelectionRef[]): void;
  /** [B17-E] Translucent ghost of a routing candidate's copper (the board is unchanged until Apply); null clears it. */
  setRoutePreview(routes: { tracks: Track[]; vias: Via[] } | null): void;
}

/** Paint order, bottom → top. Stage 6 inserts copper content into these. */
const CONTAINER_ORDER = [
  "grid",
  "fabBottom",
  "courtyardBottom",
  "silkBottom",
  "maskBottom",
  "copperBottom",
  "in2",
  "in1",
  "copperTop",
  "maskTop",
  "silkTop",
  "courtyardTop",
  "fabTop",
  "holes",
  "edge",
  "overlay",
  "handles",
] as const;
type ContainerKey = (typeof CONTAINER_ORDER)[number];

const MIN_PX_PER_MM = 0.1;
const MAX_PX_PER_MM = 400;
/** Base font size (canvas px) for the shared auto-generated bitmap font. */
const TEXT_BASE_PX = 24;
/** Handle square edge in screen px (scaled inversely with zoom). */
const HANDLE_PX = 6;
/** Handle pick tolerance in screen px. */
const HANDLE_PICK_PX = 8;

/** Airwire stroke: 1px screen-constant, zinc-500 @ 50%. */
const AIRWIRE_COLOR = 0xcbd5e1;
const AIRWIRE_ALPHA = 0.62;
/** Ghost tint: 50% blend toward red (multiplicative, halves G/B). */
const GHOST_TINT = 0xff8080;

const mm = (nm: number): number => nm / NM_PER_MM;
/** [B17-D] net-highlight outline (amber): distinct from the teal selection. */
const HIGHLIGHT_COLOR = 0xf59e0b;

interface InstanceText {
  bt: BitmapText;
  op: TextOp;
  baseTint: number;
}

interface InstanceRecord {
  id: string;
  def: FootprintDef;
  at: Vec2;
  rotationDeg: number;
  side: "top" | "bottom";
  bboxNm: BBox;
  /** One Graphics per rendered layer, sharing the def's GraphicsContext. */
  parts: Graphics[];
  texts: InstanceText[];
}

interface SideGeometry {
  plan: FootprintPlan;
  contexts: Map<RenderLayerKey, GraphicsContext>;
}

interface DefGeometry {
  top: SideGeometry;
  /** Mirrored geometry, built lazily the first time a def renders bottom. */
  bottom?: SideGeometry;
}

export function createPcbScene(): PcbScene {
  let app: Application | null = null;
  let viewport: Viewport | null = null;
  let hostEl: HTMLDivElement | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let destroyed = false;
  let mounted = false;

  const containers = new Map<ContainerKey, Container>();
  const defCache = new WeakMap<FootprintDef, DefGeometry>();

  let board: PcbBoard | null = null;
  let didInitialFit = false;

  // Desired view state — kept even before mount so it applies on mount.
  const layerVisible = new Map<LayerId, boolean>();
  let activeLayer: LayerId = "copperTop";
  let gridVisible = true;
  let tool: "select" | "pan" = "select";
  let selectionRefs: SelectionRef[] = [];
  let highlightRefs: SelectionRef[] = [];
  let routePreview: { tracks: Track[]; vias: Via[] } | null = null;
  let hoverId: string | null = null;
  /** [B17-D] the outline colour the overlay drawers use (selection teal; highlight amber while highlight refs draw). */
  let overlayColor: number = ACCENT_COLOR;
  const viewCallbacks = new Set<() => void>();
  const notifyView = (): void => { for (const cb of viewCallbacks) cb(); };

  let instances: InstanceRecord[] = [];
  const instanceById = new Map<string, InstanceRecord>();
  let pickIndex: PickIndex = buildPickIndex([]);
  let handleSpots: HandleSpot[] = [];
  const handleGraphics: Graphics[] = [];

  let airwires: Airwire[] = [];
  let marqueeRect: BBox | null = null;
  /** Ghost states survive setBoard rebuilds (persistent courtyard violations). */
  const ghosts = new Map<string, "illegal" | "preview">();
  const placementPreviewIds = new Set<string>();
  const placementPreviewPreviousGhost = new Map<string, "illegal" | undefined>();

  // Overlay children, created lazily in paint order: airwires under the
  // selection/hover boxes, marquee on top.
  let airwireG: Graphics | null = null;
  let routePreviewG: Graphics | null = null;
  let highlightG: Graphics | null = null;
  let selectionG: Graphics | null = null;
  let marqueeG: Graphics | null = null;

  let primitives = 0;
  let footprintPrimitives = 0;

  // FPS: rolling 60-frame window; fpsMin = worst window over the last 10 s.
  const frameMs: number[] = [];
  let frameMsSum = 0;
  const windowHistory: { t: number; fps: number }[] = [];

  let gridCoverage: GridCoverage | null = null;
  const pointerCallbacks = new Set<(e: ScenePointerEvent) => void>();

  // Kept so destroy() can detach exactly what mount() attached.
  let detachDom: (() => void) | null = null;

  // ── Helpers ────────────────────────────────────────────────────────────────

  const container = (key: ContainerKey): Container => {
    const c = containers.get(key);
    if (!c) throw new Error(`PcbScene container missing: ${key}`);
    return c;
  };

  function pxPerMm(): number {
    return viewport ? viewport.scale.x : 1;
  }

  function viewRectMm(): ViewRectMm {
    if (!viewport) return { minX: -100, minY: -100, maxX: 100, maxY: 100 };
    const b = viewport.getVisibleBounds();
    return { minX: b.x, minY: b.y, maxX: b.x + b.width, maxY: b.y + b.height };
  }

  function drawOpsInto(ctx: GraphicsContext, ops: DrawOp[], color: number): void {
    for (const op of ops) {
      if (op.op === "circle") {
        ctx.circle(op.cx, op.cy, op.r);
      } else if (op.op === "poly") {
        ctx.poly(op.points, op.closed);
      } else {
        const sx = op.cx + op.r * Math.cos(op.startAngle);
        const sy = op.cy + op.r * Math.sin(op.startAngle);
        ctx.moveTo(sx, sy);
        ctx.arc(op.cx, op.cy, op.r, op.startAngle, op.endAngle, op.anticlockwise);
      }
      const fill = op.op !== "arc" && op.fill;
      const strokeWidth = op.strokeWidth;
      if (fill) ctx.fill({ color });
      if (strokeWidth > 0) {
        ctx.stroke({ width: strokeWidth, color, cap: "round", join: "round" });
      }
    }
  }

  function buildSideGeometry(plan: FootprintPlan): SideGeometry {
    const contexts = new Map<RenderLayerKey, GraphicsContext>();
    for (const [layerKey, ops] of plan.ops) {
      const ctx = new GraphicsContext();
      const color = layerKey === "holes" ? BACKGROUND_COLOR : layerColor(layerKey);
      drawOpsInto(ctx, ops, color);
      contexts.set(layerKey, ctx);
    }
    return { plan, contexts };
  }

  function geometryFor(def: FootprintDef, side: "top" | "bottom"): SideGeometry {
    let cached = defCache.get(def);
    if (!cached) {
      cached = { top: buildSideGeometry(planFootprint(def)) };
      defCache.set(def, cached);
    }
    if (side === "top") return cached.top;
    if (!cached.bottom) {
      cached.bottom = buildSideGeometry(mirrorPlan(cached.top.plan));
    }
    return cached.bottom;
  }

  function instanceBBoxNm(
    def: FootprintDef,
    at: Vec2,
    rotationDeg: number,
    side: "top" | "bottom",
  ): BBox {
    const b = def.bodyBBox;
    const corners: Vec2[] = [
      { x: b.minX, y: b.minY },
      { x: b.maxX, y: b.minY },
      { x: b.maxX, y: b.maxY },
      { x: b.minX, y: b.maxY },
    ];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const c of corners) {
      const p = transformPoint(c, at, rotationDeg, side === "bottom");
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return { minX, minY, maxX, maxY };
  }

  /**
   * Text transform for both sides. Bottom text keeps `at`, mirrors in local X
   * (scale.x < 0) and composes rotation as θ − r (mirror conjugates the local
   * rotation) — X-mirrored glyphs, the KiCad readable-through-the-board
   * convention.
   */
  function placeText(
    bt: BitmapText,
    op: TextOp,
    at: Vec2,
    rotationDeg: number,
    side: "top" | "bottom",
  ): void {
    const local = rotateLocalMm(op.xMm, op.yMm, rotationDeg);
    bt.position.set(mm(at.x) + local.x, mm(at.y) + local.y);
    // Approximate: glyph cap height ≈ 0.7 × fontSize; KiCad size is the
    // glyph height. Stroke-font fidelity is post-MVP.
    const k = (op.sizeMm * 1.45) / TEXT_BASE_PX;
    if (side === "top") {
      bt.rotation = pixiRotation(rotationDeg + op.rotationDeg);
      bt.scale.set(k, k);
    } else {
      bt.rotation = pixiRotation(rotationDeg - op.rotationDeg);
      bt.scale.set(-k, k);
    }
  }

  // ── Rebuild passes ─────────────────────────────────────────────────────────

  const FOOTPRINT_CONTAINERS: ContainerKey[] = [
    "fabBottom",
    "courtyardBottom",
    "silkBottom",
    "maskBottom",
    "copperBottom",
    "in2",
    "in1",
    "copperTop",
    "maskTop",
    "silkTop",
    "courtyardTop",
    "fabTop",
    "holes",
  ];

  /** Apply (or clear) the ghost tint on every display object of a record. */
  function applyGhost(rec: InstanceRecord): void {
    const state = ghosts.get(rec.id);
    const tint = state === "illegal" ? GHOST_TINT : state === "preview" ? ACCENT_COLOR : 0xffffff;
    const alpha = state === "preview" ? 0.68 : 1;
    for (const gfx of rec.parts) { gfx.tint = tint; gfx.alpha = alpha; }
    for (const t of rec.texts) { t.bt.tint = state ? tint : t.baseTint; t.bt.alpha = alpha; }
  }

  type InstancePlacement = Pick<
    FootprintInstance,
    "id" | "def" | "at" | "rotationDeg" | "side"
  >;

  /** Create the display objects for one instance and register its record. */
  function buildInstance(inst: InstancePlacement): InstanceRecord {
    const geom = geometryFor(inst.def, inst.side);
    const xMm = mm(inst.at.x);
    const yMm = mm(inst.at.y);
    const rot = pixiRotation(inst.rotationDeg);

    const parts: Graphics[] = [];
    for (const [layerKey, ctx] of geom.contexts) {
      // Paste (and any future layer without a container) is planned but not
      // rendered — the pinned container order has no paste entries.
      const target = containers.get(layerKey as ContainerKey);
      if (!target) continue;
      const gfx = new Graphics({ context: ctx });
      gfx.eventMode = "none";
      gfx.position.set(xMm, yMm);
      gfx.rotation = rot;
      target.addChild(gfx);
      parts.push(gfx);
    }

    const texts: InstanceText[] = [];
    for (const t of geom.plan.texts) {
      const textTarget = containers.get(t.layer as ContainerKey);
      if (!textTarget) continue;
      const bt = new BitmapText({
        text: t.text,
        style: { fontFamily: "Arial", fontSize: TEXT_BASE_PX, fill: 0xffffff },
      });
      bt.eventMode = "none";
      const baseTint = layerColor(t.layer);
      bt.tint = baseTint;
      bt.anchor.set(0.5);
      placeText(bt, t, inst.at, inst.rotationDeg, inst.side);
      textTarget.addChild(bt);
      texts.push({ bt, op: t, baseTint });
    }

    const rec: InstanceRecord = {
      id: inst.id,
      def: inst.def,
      at: inst.at,
      rotationDeg: inst.rotationDeg,
      side: inst.side,
      bboxNm: instanceBBoxNm(inst.def, inst.at, inst.rotationDeg, inst.side),
      parts,
      texts,
    };
    instanceById.set(rec.id, rec);
    applyGhost(rec);
    return rec;
  }

  function destroyInstanceObjects(rec: InstanceRecord): void {
    for (const gfx of rec.parts) gfx.destroy({ children: true, context: false });
    for (const t of rec.texts) t.bt.destroy();
    rec.parts = [];
    rec.texts = [];
  }

  function rebuildFootprints(b: PcbBoard): void {
    for (const key of FOOTPRINT_CONTAINERS) {
      const c = container(key);
      for (const child of c.removeChildren()) {
        child.destroy({ children: true, context: false });
      }
    }
    instances = [];
    instanceById.clear();
    footprintPrimitives = 0;

    // Ghosts for instances that left the board (re-sync) must not leak.
    const liveIds = new Set(b.footprints.map((f) => f.id));
    for (const id of [...ghosts.keys()]) {
      if (!liveIds.has(id)) ghosts.delete(id);
    }

    for (const inst of b.footprints) {
      const rec = buildInstance(inst);
      instances.push(rec);
      footprintPrimitives += geometryFor(inst.def, inst.side).plan.primitives;
    }
  }

  function rebuildOutline(b: PcbBoard): void {
    const edge = container("edge");
    let g = edge.children[0] as Graphics | undefined;
    if (!g) {
      g = new Graphics();
      g.eventMode = "none";
      edge.addChild(g);
    }
    drawOutline(g, b.outline);

    // Handles (screen-constant squares, scaled inversely with zoom).
    const handles = container("handles");
    for (const child of handles.removeChildren()) child.destroy();
    handleGraphics.length = 0;
    handleSpots = outlineHandleSpots(b.outline);
    for (const spot of handleSpots) {
      const h = new Graphics();
      h.eventMode = "none";
      h.rect(-HANDLE_PX / 2, -HANDLE_PX / 2, HANDLE_PX, HANDLE_PX)
        .fill(layerColor("edge"))
        .stroke({ width: 1, color: BACKGROUND_COLOR });
      h.position.set(mm(spot.x), mm(spot.y));
      handles.addChild(h);
      handleGraphics.push(h);
    }
    updateHandleScales();
  }

  /** Item arrays of the board the pick index was last built from. Immer's
   *  structural sharing makes reference equality a precise dirty check —
   *  outline drags keep every array and skip the rebuild entirely. */
  let pickSource: {
    footprints: unknown;
    tracks: unknown;
    vias: unknown;
    zones: unknown;
    silkItems: unknown;
    dimensions: unknown;
  } | null = null;

  function rebuildPickIndex(b: PcbBoard): void {
    if (
      pickSource &&
      pickSource.footprints === b.footprints &&
      pickSource.tracks === b.tracks &&
      pickSource.vias === b.vias &&
      pickSource.zones === b.zones &&
      pickSource.silkItems === b.silkItems &&
      pickSource.dimensions === b.dimensions
    ) {
      return;
    }
    pickSource = {
      footprints: b.footprints,
      tracks: b.tracks,
      vias: b.vias,
      zones: b.zones,
      silkItems: b.silkItems,
      dimensions: b.dimensions,
    };
    const entries: PickEntry[] = instances.map((r) => ({
      result: { kind: "footprint", id: r.id },
      bbox: r.bboxNm,
    }));
    // Stage 17: copper, pads, zone outlines and silk text join the index.
    entries.push(...buildBoardPickEntries(b, PICK_TOLERANCE_NM));
    pickIndex = buildPickIndex(entries);
  }

  function updateHandleScales(): void {
    const s = 1 / pxPerMm();
    for (const h of handleGraphics) h.scale.set(s);
  }

  /** The overlay's children, in paint order: airwires, highlight, selection, marquee. */
  function overlayGraphics(): { air: Graphics; route: Graphics; hl: Graphics; sel: Graphics; marquee: Graphics } {
    const overlay = container("overlay");
    if (!airwireG) {
      airwireG = new Graphics();
      airwireG.eventMode = "none";
      overlay.addChild(airwireG);
    }
    if (!routePreviewG) {
      routePreviewG = new Graphics();
      routePreviewG.eventMode = "none";
      overlay.addChild(routePreviewG);
    }
    if (!highlightG) {
      highlightG = new Graphics();
      highlightG.eventMode = "none";
      overlay.addChild(highlightG);
    }
    if (!selectionG) {
      selectionG = new Graphics();
      selectionG.eventMode = "none";
      overlay.addChild(selectionG);
    }
    if (!marqueeG) {
      marqueeG = new Graphics();
      marqueeG.eventMode = "none";
      overlay.addChild(marqueeG);
    }
    return { air: airwireG, route: routePreviewG, hl: highlightG, sel: selectionG, marquee: marqueeG };
  }

  function redrawAirwires(): void {
    const g = overlayGraphics().air;
    g.clear();
    if (airwires.length === 0) return;
    const width = 1 / pxPerMm(); // 1px screen-constant
    for (const w of airwires) {
      g.moveTo(mm(w.from.x), mm(w.from.y));
      g.lineTo(mm(w.to.x), mm(w.to.y));
    }
    g.stroke({ width, color: AIRWIRE_COLOR, alpha: AIRWIRE_ALPHA });
  }

  function redrawMarquee(): void {
    const g = overlayGraphics().marquee;
    g.clear();
    if (!marqueeRect) return;
    const r = marqueeRect;
    g.rect(mm(r.minX), mm(r.minY), mm(r.maxX - r.minX), mm(r.maxY - r.minY))
      .fill({ color: ACCENT_COLOR, alpha: 0.08 })
      .stroke({ width: 1 / pxPerMm(), color: ACCENT_COLOR, alpha: 0.9 });
  }

  /** Selected-footprint id set (hover suppression + bbox outlines). */
  function selectedFootprintIds(): Set<string> {
    const out = new Set<string>();
    for (const ref of selectionRefs) {
      if (ref.kind === "footprint") out.add(ref.id);
    }
    return out;
  }

  function strokeBBoxNm(g: Graphics, b: BBox, scale: number): void {
    g.roundRect(mm(b.minX), mm(b.minY), mm(b.maxX - b.minX), mm(b.maxY - b.minY), 4 / scale)
      .stroke({ width: 2 / scale, color: overlayColor });
  }

  /** Per-redraw item lookup — one O(board) pass instead of a per-ref linear
   *  scan (marquee-select on a big board redraws every frame). */
  interface OverlayLookup {
    tracks: Map<string, PcbBoard["tracks"][number]>;
    vias: Map<string, PcbBoard["vias"][number]>;
    zones: Map<string, PcbBoard["zones"][number]>;
    silk: Map<string, NonNullable<PcbBoard["silkItems"]>[number]>;
    dimensions: Map<string, NonNullable<PcbBoard["dimensions"]>[number]>;
  }

  function buildOverlayLookup(b: PcbBoard): OverlayLookup {
    return {
      tracks: new Map(b.tracks.map((t) => [t.id, t])),
      vias: new Map(b.vias.map((v) => [v.id, v])),
      zones: new Map(b.zones.map((z) => [z.id, z])),
      silk: new Map((b.silkItems ?? []).map((s) => [s.id, s])),
      dimensions: new Map((b.dimensions ?? []).map((d) => [d.id, d])),
    };
  }

  /** Stage 17: per-kind selection outlines. Footprints/text keep the bbox
   *  roundRect; vias/pads/zones get shape outlines; tracks get a halo (a
   *  crisp capsule outline reads worse at thin widths). */
  function drawSelectedRef(
    g: Graphics,
    ref: SelectionRef,
    scale: number,
    lookup: OverlayLookup,
  ): void {
    switch (ref.kind) {
      case "footprint": {
        const rec = instanceById.get(ref.id);
        if (rec) strokeBBoxNm(g, rec.bboxNm, scale);
        return;
      }
      case "via": {
        const via = lookup.vias.get(ref.id);
        if (!via) return;
        g.circle(mm(via.at.x), mm(via.at.y), mm(via.size) / 2 + 2 / scale).stroke({
          width: 2 / scale,
          color: overlayColor,
        });
        return;
      }
      case "track": {
        const t = lookup.tracks.get(ref.id);
        if (!t) return;
        g.moveTo(mm(t.start.x), mm(t.start.y))
          .lineTo(mm(t.end.x), mm(t.end.y))
          .stroke({
            width: mm(t.width) + 4 / scale,
            color: overlayColor,
            alpha: 0.45,
            cap: "round",
          });
        return;
      }
      case "zone": {
        const z = lookup.zones.get(ref.id);
        if (!z || z.polygon.length < 3) return;
        g.poly(
          z.polygon.map((p) => ({ x: mm(p.x), y: mm(p.y) })),
          true,
        ).stroke({ width: 2 / scale, color: overlayColor });
        return;
      }
      case "text": {
        const item = lookup.silk.get(ref.id);
        if (!item || item.kind !== "text") return;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const line of silkItemPolylines(item)) {
          for (const p of line) {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
          }
        }
        if (minX === Infinity) return;
        const pad = Math.round(item.strokeWidthNm / 2);
        strokeBBoxNm(g, { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad }, scale);
        return;
      }
      case "dimension": {
        const dimension = lookup.dimensions.get(ref.id);
        if (!dimension) return;
        const geometry = dimensionGeometry(dimension);
        strokeBBoxNm(g, geometry.bbox, scale);
        return;
      }
      case "pad": {
        // Read the live instance record (updated during transient drags) so
        // selected pad outlines track the drag, not the last committed board.
        const rec = instanceById.get(ref.footprintId);
        const fp = rec ?? board?.footprints.find((f) => f.id === ref.footprintId);
        const pad = fp?.def.pads.find((p) => p.number === ref.padNumber);
        if (!fp || !pad) return;
        const mirror = fp.side === "bottom";
        const center = transformPoint(pad.at, fp.at, fp.rotationDeg, mirror);
        const sh = pad.shape;
        if (sh.kind === "circle") {
          g.circle(mm(center.x), mm(center.y), mm(sh.radius) + 2 / scale).stroke({
            width: 2 / scale,
            color: overlayColor,
          });
          return;
        }
        // Oriented outline: pad-local corners → world via the instance+pad
        // transform (mirror conjugates the pad's local rotation).
        const rot = mirror ? fp.rotationDeg - pad.rotationDeg : fp.rotationDeg + pad.rotationDeg;
        const corners: Vec2[] =
          sh.kind === "polygon"
            ? sh.points.map((p) => (mirror ? { x: -p.x, y: p.y } : p))
            : [
                { x: -sh.width / 2, y: -sh.height / 2 },
                { x: sh.width / 2, y: -sh.height / 2 },
                { x: sh.width / 2, y: sh.height / 2 },
                { x: -sh.width / 2, y: sh.height / 2 },
              ];
        g.poly(
          corners.map((c) => {
            const w = transformPoint(c, center, rot, false);
            return { x: mm(w.x), y: mm(w.y) };
          }),
          true,
        ).stroke({ width: 2 / scale, color: overlayColor });
        return;
      }
    }
  }

  /** [B17-E] the routing candidate ghost: screen-constant-ish translucent copper in the accent colour. */
  function redrawRoutePreview(): void {
    const g = overlayGraphics().route;
    g.clear();
    if (!routePreview) return;
    for (const track of routePreview.tracks) {
      g.moveTo(mm(track.start.x), mm(track.start.y)).lineTo(mm(track.end.x), mm(track.end.y)).stroke({ width: Math.max(mm(track.width), 1.5 / pxPerMm()), color: ACCENT_COLOR, alpha: 0.55, cap: "round" });
    }
    for (const via of routePreview.vias) {
      g.circle(mm(via.at.x), mm(via.at.y), Math.max(mm(via.size) / 2, 2 / pxPerMm())).fill({ color: ACCENT_COLOR, alpha: 0.45 });
    }
  }

  function redrawOverlay(): void {
    redrawRoutePreview();
    const g = overlayGraphics().sel;
    g.clear();
    const scale = pxPerMm();
    const radius = 4 / scale;

    if (hoverId && !selectedFootprintIds().has(hoverId)) {
      const rec = instanceById.get(hoverId);
      if (rec) {
        const b = rec.bboxNm;
        g.roundRect(mm(b.minX), mm(b.minY), mm(b.maxX - b.minX), mm(b.maxY - b.minY), radius)
          .fill({ color: ACCENT_COLOR, alpha: HOVER_ALPHA * 0.35 })
          .stroke({ width: 1.5 / scale, color: ACCENT_COLOR, alpha: HOVER_ALPHA });
      }
    }
    const lookup = board && (selectionRefs.length > 0 || highlightRefs.length > 0) ? buildOverlayLookup(board) : null;
    if (selectionRefs.length > 0 && lookup) {
      for (const ref of selectionRefs) drawSelectedRef(g, ref, scale, lookup);
    }
    const hl = overlayGraphics().hl;
    hl.clear();
    if (highlightRefs.length > 0 && lookup) {
      overlayColor = HIGHLIGHT_COLOR;
      try { for (const ref of highlightRefs) drawSelectedRef(hl, ref, scale, lookup); } finally { overlayColor = ACCENT_COLOR; }
    }
  }

  function maybeRebuildGrid(force = false): void {
    if (!viewport) return;
    const gridContainer = container("grid");
    gridContainer.visible = gridVisible;
    if (!gridVisible) return;
    let g = gridContainer.children[0] as Graphics | undefined;
    if (!g) {
      g = new Graphics();
      g.eventMode = "none";
      gridContainer.addChild(g);
    }
    const view = viewRectMm();
    if (force || gridNeedsRebuild(gridCoverage, view, pxPerMm())) {
      gridCoverage = drawGrid(g, view, pxPerMm());
    }
  }

  function applyLayerState(): void {
    for (const key of FOOTPRINT_CONTAINERS) {
      if (key === "holes") continue; // holes track copper visibility below
      // Inner copper does not exist on a 2-layer board — never render it
      // there, whatever the visibility map says (the panel hides the rows).
      if ((key === "in1" || key === "in2") && board?.stackup !== 4) {
        container(key).visible = false;
        continue;
      }
      const visible = layerVisible.get(key as LayerId) ?? layerVisibleByDefault(key as LayerId);
      container(key).visible = visible;
    }
    container("edge").visible = layerVisible.get("edge") ?? layerVisibleByDefault("edge");
    // Drill holes show whenever any copper layer shows.
    container("holes").visible = COPPER_LAYERS.some(
      (l) => layerVisible.get(l) ?? layerVisibleByDefault(l),
    );
    // Active copper dims the other copper layers.
    const activeIsCopper = COPPER_LAYERS.includes(activeLayer);
    for (const l of COPPER_LAYERS) {
      container(l as ContainerKey).alpha =
        activeIsCopper && l !== activeLayer ? DIMMED_COPPER_ALPHA : 1;
    }
  }

  function applyDragPlugin(): void {
    if (!viewport) return;
    viewport.plugins.remove("drag");
    viewport.drag({ mouseButtons: tool === "pan" ? "left-middle" : "middle" });
  }

  // ── Picking ────────────────────────────────────────────────────────────────

  function pickAtWorld(world: Vec2): PickResult | null {
    // Handles first (linear scan — there are at most a handful), using a
    // screen-constant tolerance converted to nm at the current zoom.
    const tolNm = (HANDLE_PICK_PX / pxPerMm()) * NM_PER_MM;
    for (const spot of handleSpots) {
      if (Math.abs(world.x - spot.x) <= tolNm && Math.abs(world.y - spot.y) <= tolNm) {
        return { kind: "outline-handle", handle: spot.handle };
      }
    }
    return pickIndex.pickAt(world, PICK_TOLERANCE_NM);
  }

  function worldFromScreen(x: number, y: number): Vec2 {
    if (!viewport) return { x: 0, y: 0 };
    const p = viewport.toWorld(x, y);
    return { x: Math.round(p.x * NM_PER_MM), y: Math.round(p.y * NM_PER_MM) };
  }

  function emitPointer(type: ScenePointerEvent["type"], ev: PointerEvent): void {
    const screen = { x: ev.offsetX, y: ev.offsetY };
    const world = worldFromScreen(screen.x, screen.y);
    const e: ScenePointerEvent = {
      world,
      screen,
      type,
      buttons: ev.buttons,
      modifiers: { alt: ev.altKey, ctrl: ev.ctrlKey || ev.metaKey, shift: ev.shiftKey },
      pick: type === "leave" ? null : pickAtWorld(world),
    };
    for (const cb of pointerCallbacks) cb(e);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async function mount(el: HTMLDivElement): Promise<void> {
    if (mounted || destroyed) return;
    hostEl = el;
    const pixiApp = new Application();
    await pixiApp.init({
      background: BACKGROUND_COLOR,
      antialias: true,
      resolution: typeof devicePixelRatio === "number" ? devicePixelRatio : 1,
      autoDensity: true,
      width: Math.max(el.clientWidth, 1),
      height: Math.max(el.clientHeight, 1),
    });
    // React 19 StrictMode double-mount: destroy() may have run mid-init.
    if (destroyed) {
      pixiApp.destroy(true, { children: true, texture: true });
      return;
    }
    app = pixiApp;
    mounted = true;
    el.appendChild(pixiApp.canvas);

    const vp = new Viewport({
      screenWidth: Math.max(el.clientWidth, 1),
      screenHeight: Math.max(el.clientHeight, 1),
      events: pixiApp.renderer.events,
      disableOnContextMenu: true,
    });
    viewport = vp;
    vp.wheel().pinch().clampZoom({ minScale: MIN_PX_PER_MM, maxScale: MAX_PX_PER_MM });
    applyDragPlugin();
    pixiApp.stage.addChild(vp);

    for (const key of CONTAINER_ORDER) {
      const c = new Container();
      c.eventMode = "none";
      containers.set(key, c);
      vp.addChild(c);
    }

    vp.on("zoomed", () => {
      maybeRebuildGrid();
      updateHandleScales();
      redrawOverlay();
      redrawAirwires(); // screen-constant stroke widths
      redrawMarquee();
      notifyView();
    });
    vp.on("moved", () => { maybeRebuildGrid(); notifyView(); });

    // FPS bookkeeping.
    pixiApp.ticker.add(() => {
      const dt = pixiApp.ticker.deltaMS;
      frameMs.push(dt);
      frameMsSum += dt;
      if (frameMs.length > 60) frameMsSum -= frameMs.shift() ?? 0;
      const fps = frameMs.length > 0 ? 1000 / (frameMsSum / frameMs.length) : 0;
      const now = performance.now();
      windowHistory.push({ t: now, fps });
      while (windowHistory.length > 0 && windowHistory[0].t < now - 10_000) {
        windowHistory.shift();
      }
    });

    // One stage-level DOM listener set — never per-object Pixi handlers.
    const canvas = pixiApp.canvas;
    const onDown = (ev: PointerEvent): void => emitPointer("down", ev);
    const onMove = (ev: PointerEvent): void => emitPointer("move", ev);
    const onUp = (ev: PointerEvent): void => emitPointer("up", ev);
    const onLeave = (ev: PointerEvent): void => emitPointer("leave", ev);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    detachDom = () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
    };

    resizeObserver = new ResizeObserver(() => {
      if (!app || !viewport || !hostEl) return;
      const w = Math.max(hostEl.clientWidth, 1);
      const h = Math.max(hostEl.clientHeight, 1);
      app.renderer.resize(w, h);
      viewport.resize(w, h);
      maybeRebuildGrid();
      notifyView();
    });
    resizeObserver.observe(el);

    // Apply whatever state arrived before mount.
    if (board) setBoard(board);
    applyLayerState();
    maybeRebuildGrid(true);
    redrawAirwires();
  }

  function destroy(): void {
    destroyed = true;
    pointerCallbacks.clear();
    detachDom?.();
    detachDom = null;
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (app) {
      app.destroy(true, { children: true, texture: true });
      app = null;
    }
    viewport = null;
    containers.clear();
    instances = [];
    instanceById.clear();
    handleGraphics.length = 0;
    airwireG = null;
    selectionG = null;
    marqueeG = null;
    mounted = false;
  }

  function setBoard(b: PcbBoard): void {
    const prev = board;
    board = b;
    if (!mounted || !app) return; // applied on mount

    // Outline drags pass a board with the SAME footprints array — skip the
    // expensive footprint rebuild and only refresh outline + handles.
    const footprintsUnchanged = prev !== null && prev.footprints === b.footprints;
    if (!footprintsUnchanged) {
      rebuildFootprints(b);
    }
    // One authoritative render pass. Keeping copper, zones, and user silk in
    // the scene prevents a footprint rebuild from clearing content that a
    // React effect happened to draw first.
    const copper = renderCopper(b, (layer) => container(layer as ContainerKey));
    const zones = renderZones(b, (layer) => container(layer as ContainerKey));
    const silk = renderSilkItems(b, (layer) => container(layer as ContainerKey));
    const dimensions = renderDimensions(b, (layer) => container(layer as ContainerKey));
    primitives = footprintPrimitives + copper.primitives + zones.primitives + silk.items + dimensions.items;
    // Stage 17: copper-only commits (same footprints array via immer sharing)
    // must still refresh the pick index; it dirty-checks its own sources.
    rebuildPickIndex(b);
    rebuildOutline(b);
    applyLayerState();
    redrawOverlay();

    if (!didInitialFit) {
      didInitialFit = true;
      zoomToFit();
    }
  }

  function zoomToFit(): void {
    if (!viewport || !hostEl) return;
    // R06 Section 9: fit must frame the board AND every placed footprint.
    // Newly synchronized components are deliberately staged OUTSIDE the board
    // outline (negative-x staging strip); an outline-only fit left them
    // rendered but permanently out of view.
    let bb = board
      ? outlineBBoxNm(board.outline)
      : { minX: 0, minY: 0, maxX: 100 * NM_PER_MM, maxY: 80 * NM_PER_MM };
    for (const fp of board?.footprints ?? []) {
      const fpBox = footprintWorldBBox(fp);
      if (!Number.isFinite(fpBox.minX) || !Number.isFinite(fpBox.minY) || !Number.isFinite(fpBox.maxX) || !Number.isFinite(fpBox.maxY)) continue;
      bb = {
        minX: Math.min(bb.minX, fpBox.minX),
        minY: Math.min(bb.minY, fpBox.minY),
        maxX: Math.max(bb.maxX, fpBox.maxX),
        maxY: Math.max(bb.maxY, fpBox.maxY),
      };
    }
    const wMm = Math.max(mm(bb.maxX - bb.minX), 1);
    const hMm = Math.max(mm(bb.maxY - bb.minY), 1);
    const sw = Math.max(hostEl.clientWidth, 1);
    const sh = Math.max(hostEl.clientHeight, 1);
    const scale = Math.min(
      Math.max(Math.min(sw / wMm, sh / hMm) * 0.85, MIN_PX_PER_MM),
      MAX_PX_PER_MM,
    );
    viewport.setZoom(scale, false);
    viewport.moveCenter(mm(bb.minX) + wMm / 2, mm(bb.minY) + hMm / 2);
    maybeRebuildGrid(true);
    updateHandleScales();
    redrawOverlay();
    notifyView();
  }

  function centerOn(world: Vec2, pxPerMm?: number): void {
    if (!viewport || !hostEl) return;
    if (pxPerMm !== undefined) {
      viewport.setZoom(Math.min(Math.max(pxPerMm, MIN_PX_PER_MM), MAX_PX_PER_MM), false);
    }
    viewport.moveCenter(mm(world.x), mm(world.y));
    maybeRebuildGrid(true);
    updateHandleScales();
    redrawOverlay();
    notifyView();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  function updateInstanceTransform(id: string, at: Vec2, rotationDeg: number, side: "top" | "bottom"): void {
    const rec = instanceById.get(id);
    if (!rec) return;
    if (side !== rec.side) {
      destroyInstanceObjects(rec);
      instanceById.delete(id);
      const next = buildInstance({ id, def: rec.def, at, rotationDeg, side });
      const index = instances.indexOf(rec);
      if (index >= 0) instances[index] = next;
      else instances.push(next);
      redrawOverlay();
      return;
    }
    rec.at = at;
    rec.rotationDeg = rotationDeg;
    const xMm = mm(at.x);
    const yMm = mm(at.y);
    const rotation = pixiRotation(rotationDeg);
    for (const gfx of rec.parts) {
      gfx.position.set(xMm, yMm);
      gfx.rotation = rotation;
    }
    for (const text of rec.texts) placeText(text.bt, text.op, at, rotationDeg, side);
    rec.bboxNm = instanceBBoxNm(rec.def, at, rotationDeg, side);
    redrawOverlay();
  }

  function setPlacementPreview(preview: Array<{ id: string; at: Vec2; rotationDeg: number; side: "top" | "bottom" }> | null): void {
    for (const id of placementPreviewIds) {
      const live = board?.footprints.find((footprint) => footprint.id === id);
      if (live) updateInstanceTransform(id, live.at, live.rotationDeg, live.side);
      const previous = placementPreviewPreviousGhost.get(id);
      if (previous) ghosts.set(id, previous);
      else ghosts.delete(id);
      const rec = instanceById.get(id);
      if (rec) applyGhost(rec);
    }
    placementPreviewIds.clear();
    placementPreviewPreviousGhost.clear();
    for (const transform of preview ?? []) {
      placementPreviewIds.add(transform.id);
      placementPreviewPreviousGhost.set(transform.id, ghosts.get(transform.id) === "illegal" ? "illegal" : undefined);
      ghosts.set(transform.id, "preview");
      updateInstanceTransform(transform.id, transform.at, transform.rotationDeg, transform.side);
      const rec = instanceById.get(transform.id);
      if (rec) applyGhost(rec);
    }
  }

  return {
    mount,
    destroy,
    setBoard,

    setLayerVisible(layer: LayerId, visible: boolean): void {
      layerVisible.set(layer, visible);
      if (mounted) applyLayerState();
    },

    setActiveLayer(layer: LayerId): void {
      activeLayer = layer;
      if (mounted) applyLayerState();
    },

    setSelection(ids: string[]): void {
      selectionRefs = ids.map((id) => ({ kind: "footprint", id }));
      if (mounted) redrawOverlay();
    },

    setSelectionRefs(refs: SelectionRef[]): void {
      selectionRefs = [...refs];
      if (mounted) redrawOverlay();
    },

    setHover(id: string | null): void {
      if (hoverId === id) return;
      hoverId = id;
      if (mounted) redrawOverlay();
    },

    onPointer(cb: (e: ScenePointerEvent) => void): () => void {
      pointerCallbacks.add(cb);
      return () => pointerCallbacks.delete(cb);
    },

    worldFromScreen,
    zoomToFit,
    centerOn,

    stats(): { primitives: number; fpsAvg: number; fpsMin: number } {
      const fpsAvg =
        frameMs.length > 0 ? 1000 / (frameMsSum / frameMs.length) : 0;
      let fpsMin = fpsAvg;
      for (const w of windowHistory) fpsMin = Math.min(fpsMin, w.fps);
      return {
        primitives,
        fpsAvg: Math.round(fpsAvg * 10) / 10,
        fpsMin: Math.round(fpsMin * 10) / 10,
      };
    },

    setTool(t: "select" | "pan"): void {
      tool = t;
      if (mounted) applyDragPlugin();
    },

    setGridVisible(visible: boolean): void {
      gridVisible = visible;
      if (mounted) maybeRebuildGrid(true);
    },

    // ── Stage 5 additions ──────────────────────────────────────────────────

    setAirwires(wires: Airwire[]): void {
      airwires = wires;
      if (mounted) redrawAirwires();
    },

    setInstanceTransform: updateInstanceTransform,
    setPlacementPreview,

    getLayerContainer(layer: LayerId): Container {
      if (layer === "pasteTop" || layer === "pasteBottom") {
        throw new Error(`PcbScene has no container for paste layers (${layer})`);
      }
      return container(layer);
    },

    getOverlayContainer(): Container {
      return container("overlay");
    },

    setGhost(id: string, state: "none" | "illegal"): void {
      if (state === "none") ghosts.delete(id);
      else ghosts.set(id, state);
      const rec = instanceById.get(id);
      if (rec) applyGhost(rec);
    },

    // ── [B17-D] view-session mirror ────────────────────────────────────────
    viewState(): { centerNm: Vec2; pxPerMm: number; viewportPx: { width: number; height: number } } | null {
      if (!viewport || !hostEl || !mounted) return null;
      const c = viewport.center;
      return {
        centerNm: { x: Math.round(c.x * NM_PER_MM), y: Math.round(c.y * NM_PER_MM) },
        pxPerMm: viewport.scale.x,
        viewportPx: { width: Math.max(hostEl.clientWidth, 1), height: Math.max(hostEl.clientHeight, 1) },
      };
    },

    onViewChange(cb: () => void): () => void {
      viewCallbacks.add(cb);
      return () => { viewCallbacks.delete(cb); };
    },

    setHighlightRefs(refs: SelectionRef[]): void {
      highlightRefs = [...refs];
      if (mounted) redrawOverlay();
    },

    setRoutePreview(routes: { tracks: Track[]; vias: Via[] } | null): void {
      routePreview = routes ? { tracks: [...routes.tracks], vias: [...routes.vias] } : null;
      if (mounted) redrawRoutePreview();
    },

    pickIn(rect: BBox): PickResult[] {
      return pickIndex.pickIn(rect);
    },

    setMarquee(rect: BBox | null): void {
      marqueeRect = rect;
      if (mounted) redrawMarquee();
    },
  };
}
