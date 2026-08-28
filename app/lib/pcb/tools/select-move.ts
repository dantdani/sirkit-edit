/**
 * Selection + move tool (PCB Stage 5; Stage 17 adds copper-level selection) —
 * the pointer/keyboard state machine over `ScenePointerEvent`.
 *
 * Gestures: click = select (replace), Shift-click = toggle, Ctrl-click = add,
 * drag-on-empty = marquee, drag-on-selected-footprint = move (0.5 mm grid
 * snap; Ctrl disables). Copper/pads/text select but don't drag (routing owns
 * copper gestures); double-click a track to select its whole net; right-click
 * emits a context-menu request. During a move every frame goes through
 * `history.transient()` + the scene's transform fast path; the drop calls
 * `execute()` once — one undo step per gesture.
 *
 * Selection lives in the Stage 17 global `SelectionStore` (refs, not ids) —
 * the scene overlay, inspector and command layer all read the same store.
 *
 * Courtyard collision is bbox-level by design (exact polygons are Stage 12's
 * DRC problem): an illegal drop snaps back unless Alt forces it, and forced
 * placements keep a red ghost (a derived `violations` set held HERE, never in
 * `PcbBoard`) until a later legal move.
 *
 * Keys: R rotate 90° CW about the selection-bbox center, F flip side, arrows
 * nudge by 0.5 mm (Shift = 0.1 mm), Escape clear/cancel, Ctrl+Z / Ctrl+Shift+Z
 * / Ctrl+Y undo/redo. Delete removes selected copper/zones/silk text through
 * the edit-command layer; footprints stay — the schematic is the source of
 * truth; removal happens by re-sync.
 */

import Flatbush from "flatbush";
import type { FootprintDef, FootprintInstance, PcbBoard } from "../types";
import type { Vec2, BBox } from "../geometry";
import { transformPoint } from "../geometry";
import { mmToNm } from "../units";
import type { PcbScene, ScenePointerEvent } from "../render/scene";
import type { PickResult } from "../render/pick";
import type { PcbHistory } from "../history";
import { computeElectricalTruth } from "../electrical-truth";
import type { SelectionStore } from "../selection";
import type { SelectionRef } from "../edit/commands";
import { refKey } from "../edit/commands";
import { applyEdits } from "../edit/apply";
import { selectNet } from "../selection-queries";
// B03: gesture commits route through the canonical executor when the host
// bound a session to this history; without one, behavior is unchanged.
import { applyEditsCanonical, canonicalSessionFor, historyBindingState } from "../../engineering/editor-adapter";
import { isBareHistoryAuthorized } from "../../engineering/pcb-bare-authority.internal";
import type { EngineeringOperation } from "../../engineering/types";

const GRID_NM = mmToNm(0.5);
const FINE_NM = mmToNm(0.1);
/** bodyBBox inflation when a def has no courtyard layer. */
const COURTYARD_FALLBACK_NM = mmToNm(0.25);
/** Screen px of pointer travel before a down becomes a drag. */
const DRAG_THRESHOLD_PX = 4;

/** Right-click payload — the host mounts the menu (a React concern). */
export interface ContextMenuRequest {
  screen: { x: number; y: number };
  world: Vec2;
  pick: PickResult | null;
}

export interface SelectMoveToolDeps {
  scene: PcbScene;
  history: PcbHistory;
  /** Stage 17 global selection store — synchronous, shared with the scene
   *  overlay, inspector and command layer. */
  selection: SelectionStore;
  toast(message: string): void;
  onContextMenu?(request: ContextMenuRequest): void;
}

export interface SelectMoveTool {
  handlePointer(e: ScenePointerEvent): void;
  /** Returns true when the event was consumed (and preventDefault called). */
  handleKey(e: KeyboardEvent): boolean;
  /** Full airwire recompute — call once after the tool is wired to a board. */
  refreshAirwires(): void;
  destroy(): void;
}

interface MoveOrigin {
  at: Vec2;
  rotationDeg: number;
  side: "top" | "bottom";
  ref: string;
}

interface Obstacles {
  index: Flatbush | null;
  boxes: BBox[];
}

type Gesture =
  | { kind: "idle" }
  | {
      kind: "pending-move";
      downScreen: { x: number; y: number };
      downWorld: Vec2;
      targetId: string;
      /** Shift was held on down: click toggles, drag adds-then-moves. */
      toggle: boolean;
    }
  | {
      kind: "pending-marquee";
      downScreen: { x: number; y: number };
      downWorld: Vec2;
      additive: boolean;
    }
  | { kind: "marquee"; downWorld: Vec2; additive: boolean; baseSelection: SelectionRef[] }
  | {
      kind: "move";
      downWorld: Vec2;
      moveIds: string[];
      anchorId: string;
      origins: Map<string, MoveOrigin>;
      /** Footprint-local courtyard bbox per moved instance. */
      locals: Map<string, BBox>;
      changedNets: number[];
      obstacles: Obstacles;
      lastDelta: Vec2;
      illegal: boolean;
    };

const snapTo = (v: number, step: number): number => Math.round(v / step) * step;

function snapVec(p: Vec2, step: number): Vec2 {
  return { x: snapTo(p.x, step), y: snapTo(p.y, step) };
}

function localCourtyardBBox(def: FootprintDef): BBox {
  if (def.courtyardBBox) return def.courtyardBBox;
  const b = def.bodyBBox;
  return {
    minX: b.minX - COURTYARD_FALLBACK_NM,
    minY: b.minY - COURTYARD_FALLBACK_NM,
    maxX: b.maxX + COURTYARD_FALLBACK_NM,
    maxY: b.maxY + COURTYARD_FALLBACK_NM,
  };
}

function worldBBox(local: BBox, at: Vec2, rotationDeg: number, mirrorX: boolean): BBox {
  const corners: Vec2[] = [
    { x: local.minX, y: local.minY },
    { x: local.maxX, y: local.minY },
    { x: local.maxX, y: local.maxY },
    { x: local.minX, y: local.maxY },
  ];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of corners) {
    const p = transformPoint(c, at, rotationDeg, mirrorX);
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

/** Strict overlap — shared edges do not violate. */
function bboxesOverlap(a: BBox, b: BBox): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

function instanceCourtyardWorld(inst: FootprintInstance): BBox {
  return worldBBox(
    localCourtyardBBox(inst.def),
    inst.at,
    inst.rotationDeg,
    inst.side === "bottom",
  );
}

function buildObstacles(board: PcbBoard, exclude: ReadonlySet<string>): Obstacles {
  const boxes: BBox[] = [];
  for (const inst of board.footprints) {
    if (exclude.has(inst.id)) continue;
    boxes.push(instanceCourtyardWorld(inst));
  }
  if (boxes.length === 0) return { index: null, boxes };
  const index = new Flatbush(boxes.length);
  for (const b of boxes) index.add(b.minX, b.minY, b.maxX, b.maxY);
  index.finish();
  return { index, boxes };
}

function overlapsAny(box: BBox, obstacles: Obstacles): boolean {
  if (!obstacles.index) return false;
  const candidates = obstacles.index.search(box.minX, box.minY, box.maxX, box.maxY);
  for (const i of candidates) {
    if (bboxesOverlap(box, obstacles.boxes[i])) return true;
  }
  return false;
}

function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
}

export function createSelectMoveTool(deps: SelectMoveToolDeps): SelectMoveTool {
  const { scene, history, selection: store } = deps;

  // B08.1 — legacy gesture commits are allowed ONLY for explicitly
  // authorized bare histories (planner/test compositions). A retired
  // (formerly canonical) history refuses with zero mutation.
  const legacyMutationAllowed = (): boolean => {
    if (historyBindingState(history) === "unbound" && isBareHistoryAuthorized(history)) return true;
    deps.toast("This board's editing session was replaced — the action was refused. Nothing was changed.");
    return false;
  };

  let gesture: Gesture = { kind: "idle" };
  /** Double-click detection (selectNet on tracks). */
  let lastClick: { key: string; time: number } | null = null;

  /** Footprint ids in the current selection — the movable/rotatable subset. */
  function selectedFootprintIds(): string[] {
    return store.get().refs.flatMap((r) => (r.kind === "footprint" ? [r.id] : []));
  }

  function pickToRef(pick: PickResult): SelectionRef | null {
    switch (pick.kind) {
      case "outline-handle":
        return null;
      case "pad":
        return { kind: "pad", footprintId: pick.footprintId, padNumber: pick.padNumber };
      default:
        return { kind: pick.kind, id: pick.id };
    }
  }

  function isSelected(ref: SelectionRef): boolean {
    const key = refKey(ref);
    return store.get().refs.some((r) => refKey(r) === key);
  }
  /** Alt-forced (or key-created) courtyard overlaps — derived editor state. */
  const violations = new Set<string>();
  let destroyed = false;

  // ── Airwire recompute, throttled to one per animation frame ───────────────

  let rafId: number | null = null;
  let pendingFull = false;
  const pendingNets = new Set<number>();

  function runAirwires(): void {
    rafId = null;
    if (destroyed) return;
    const full = pendingFull;
    const nets = [...pendingNets];
    pendingFull = false;
    pendingNets.clear();
    // UI airwires are electrical facts, not the placement-only pad MST proxy.
    void full;
    void nets;
    scene.setAirwires(computeElectricalTruth(history.present).realized.airwires);
  }

  function scheduleAirwires(changedNets?: number[]): void {
    if (changedNets === undefined) pendingFull = true;
    else for (const n of changedNets) pendingNets.add(n);
    if (rafId !== null) return;
    rafId =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(runAirwires)
        : (setTimeout(runAirwires, 16) as unknown as number);
  }

  // Every committed change (drop, key gesture, undo, redo, external edit)
  // gets a full recompute — cheap, and undo/redo can touch any net.
  const unsubscribe = history.subscribe(() => scheduleAirwires());

  // ── Violations (courtyard overlap after committed gestures) ───────────────

  function reevaluateViolations(ids: string[]): boolean {
    const board = history.present;
    const idSet = new Set(ids);
    const obstacles = buildObstacles(board, idSet);
    let anyIllegal = false;
    for (const inst of board.footprints) {
      if (!idSet.has(inst.id)) continue;
      const illegal = overlapsAny(instanceCourtyardWorld(inst), obstacles);
      if (illegal) {
        anyIllegal = true;
        violations.add(inst.id);
      } else {
        violations.delete(inst.id);
      }
      scene.setGhost(inst.id, illegal ? "illegal" : "none");
    }
    return anyIllegal;
  }

  // ── Move gesture ───────────────────────────────────────────────────────────

  function selectedInstances(ids: string[]): FootprintInstance[] {
    const idSet = new Set(ids);
    return history.present.footprints.filter((f) => idSet.has(f.id));
  }

  const LOCKED_TOAST = "Locked parts don't move — unlock them in the inspector.";

  function beginMove(targetId: string, downWorld: Vec2): void {
    // Stage 17: locked parts refuse the drag gesture, matching the command
    // layer's validator. A locked drag target blocks the whole move.
    const target = history.present.footprints.find((f) => f.id === targetId);
    if (target?.locked) {
      deps.toast(LOCKED_TOAST);
      gesture = { kind: "idle" };
      return;
    }
    const selectedIds = selectedFootprintIds();
    const moveIds = selectedIds.includes(targetId) ? selectedIds : [targetId];
    const insts = selectedInstances(moveIds).filter((i) => !i.locked);
    if (insts.length === 0) {
      gesture = { kind: "idle" };
      return;
    }
    const origins = new Map<string, MoveOrigin>();
    const locals = new Map<string, BBox>();
    const nets = new Set<number>();
    for (const inst of insts) {
      origins.set(inst.id, {
        at: inst.at,
        rotationDeg: inst.rotationDeg,
        side: inst.side,
        ref: inst.ref,
      });
      locals.set(inst.id, localCourtyardBBox(inst.def));
      for (const netId of Object.values(inst.padNets)) {
        if (netId !== 0) nets.add(netId);
      }
    }
    gesture = {
      kind: "move",
      downWorld,
      moveIds: insts.map((i) => i.id),
      anchorId: origins.has(targetId) ? targetId : insts[0].id,
      origins,
      locals,
      changedNets: [...nets],
      obstacles: buildObstacles(history.present, new Set(origins.keys())),
      lastDelta: { x: NaN, y: NaN },
      illegal: false,
    };
  }

  function updateMove(g: Gesture & { kind: "move" }, e: ScenePointerEvent): void {
    const delta = { x: e.world.x - g.downWorld.x, y: e.world.y - g.downWorld.y };
    const anchor = g.origins.get(g.anchorId);
    if (!anchor) return;
    let eff = delta;
    if (!e.modifiers.ctrl) {
      const snapped = snapVec({ x: anchor.at.x + delta.x, y: anchor.at.y + delta.y }, GRID_NM);
      eff = { x: snapped.x - anchor.at.x, y: snapped.y - anchor.at.y };
    }
    if (eff.x === g.lastDelta.x && eff.y === g.lastDelta.y) return;
    g.lastDelta = eff;

    const positions = new Map<string, Vec2>();
    for (const [id, origin] of g.origins) {
      positions.set(id, { x: origin.at.x + eff.x, y: origin.at.y + eff.y });
    }

    history.transient((draft) => {
      for (const fp of draft.footprints) {
        const p = positions.get(fp.id);
        if (p) fp.at = p;
      }
    });

    let illegal = false;
    for (const [id, origin] of g.origins) {
      const at = positions.get(id);
      if (!at) continue;
      scene.setInstanceTransform(id, at, origin.rotationDeg, origin.side);
      const local = g.locals.get(id);
      if (
        local &&
        overlapsAny(worldBBox(local, at, origin.rotationDeg, origin.side === "bottom"), g.obstacles)
      ) {
        illegal = true;
      }
    }
    if (illegal !== g.illegal) {
      g.illegal = illegal;
      for (const id of g.moveIds) scene.setGhost(id, illegal ? "illegal" : "none");
    }
    scheduleAirwires(g.changedNets);
  }

  /** Snap back to the drag origin (illegal drop, Escape, pointer leave). */
  function cancelMove(g: Gesture & { kind: "move" }): void {
    gesture = { kind: "idle" };
    history.transient((draft) => {
      for (const fp of draft.footprints) {
        const origin = g.origins.get(fp.id);
        if (origin) fp.at = origin.at;
      }
    });
    for (const [id, origin] of g.origins) {
      scene.setInstanceTransform(id, origin.at, origin.rotationDeg, origin.side);
      scene.setGhost(id, violations.has(id) ? "illegal" : "none");
    }
    scheduleAirwires(g.changedNets);
  }

  function finishMove(g: Gesture & { kind: "move" }, alt: boolean): void {
    gesture = { kind: "idle" };
    const eff = g.lastDelta;
    if (Number.isNaN(eff.x) || (eff.x === 0 && eff.y === 0)) {
      // Pointer never effectively moved — no entry, just restore ghosts.
      cancelMove(g);
      return;
    }
    if (g.illegal && !alt) {
      cancelMove(g);
      deps.toast("Courtyards overlap — move reverted. Hold Alt to force placement.");
      return;
    }
    const label =
      g.moveIds.length === 1
        ? `Move ${g.origins.get(g.moveIds[0])?.ref ?? g.moveIds[0]}`
        : `Move ${g.moveIds.length} parts`;
    const session = canonicalSessionFor(history);
    if (session) {
      // B03: the canonical executor is the mutation authority — the gesture's
      // absolute drop positions become one move_footprint transaction; the
      // entry commits from the pre-transient board (one gesture = one step).
      const targets = [...g.origins].map(([footprintId, origin]) => ({
        footprintId,
        at: { x: Math.round(origin.at.x + eff.x), y: Math.round(origin.at.y + eff.y) },
      }));
      void session
        .commit({
          commandId: "pcb.move-footprint",
          label,
          buildOperations: (): EngineeringOperation[] =>
            targets.map((target, index) => ({
              operationId: `op:move:${index}`,
              schemaVersion: 1,
              units: "nm",
              kind: "move_footprint",
              footprintId: target.footprintId,
              at: target.at,
            })),
        })
        .then((result) => {
          if (destroyed) return;
          if (!result.ok) {
            // Rejected: nothing was applied — revert the drag preview exactly
            // like an illegal drop and surface the structured failure.
            history.cancelTransient();
            for (const [id, origin] of g.origins) {
              scene.setInstanceTransform(id, origin.at, origin.rotationDeg, origin.side);
              scene.setGhost(id, violations.has(id) ? "illegal" : "none");
            }
            scheduleAirwires(g.changedNets);
            deps.toast(result.message);
            return;
          }
          const anyIllegal = reevaluateViolations(g.moveIds);
          if (anyIllegal) {
            deps.toast("Placed with courtyard overlap — move it to a clear spot to resolve.");
          }
        });
      return;
    }
    if (!legacyMutationAllowed()) { history.cancelTransient(); return; }
    history.execute(label, (draft) => {
      for (const fp of draft.footprints) {
        const origin = g.origins.get(fp.id);
        if (origin) fp.at = { x: origin.at.x + eff.x, y: origin.at.y + eff.y };
      }
    });
    const anyIllegal = reevaluateViolations(g.moveIds);
    if (anyIllegal) {
      deps.toast("Placed with courtyard overlap — move it to a clear spot to resolve.");
    }
  }

  // ── Marquee ────────────────────────────────────────────────────────────────

  function marqueeRect(a: Vec2, b: Vec2): BBox {
    return {
      minX: Math.min(a.x, b.x),
      minY: Math.min(a.y, b.y),
      maxX: Math.max(a.x, b.x),
      maxY: Math.max(a.y, b.y),
    };
  }

  function marqueeSelection(g: Gesture & { kind: "marquee" }, world: Vec2): SelectionRef[] {
    const picked = scene
      .pickIn(marqueeRect(g.downWorld, world))
      .flatMap((p) => {
        const ref = pickToRef(p);
        return ref ? [ref] : [];
      });
    if (!g.additive) return picked;
    const seen = new Set(g.baseSelection.map(refKey));
    return [...g.baseSelection, ...picked.filter((r) => !seen.has(refKey(r)))];
  }

  // ── Keyboard gestures ──────────────────────────────────────────────────────

  function gestureLabel(verb: string, insts: FootprintInstance[]): string {
    return insts.length === 1 ? `${verb} ${insts[0].ref}` : `${verb} ${insts.length} parts`;
  }

  /** Unlocked instances of `ids`; toasts once when the lock blocks everything. */
  function movableInstances(ids: string[]): FootprintInstance[] {
    const all = selectedInstances(ids);
    const insts = all.filter((i) => !i.locked);
    if (insts.length === 0 && all.some((i) => i.locked)) deps.toast(LOCKED_TOAST);
    return insts;
  }

  /** Rotate 90° CW (screen-wise) about the snapped selection-bbox center. */
  function rotateSelection(ids: string[]): void {
    const insts = movableInstances(ids);
    if (insts.length === 0) return;
    let box: BBox | null = null;
    for (const inst of insts) {
      const b = worldBBox(inst.def.bodyBBox, inst.at, inst.rotationDeg, inst.side === "bottom");
      box = box
        ? {
            minX: Math.min(box.minX, b.minX),
            minY: Math.min(box.minY, b.minY),
            maxX: Math.max(box.maxX, b.maxX),
            maxY: Math.max(box.maxY, b.maxY),
          }
        : b;
    }
    if (!box) return;
    const center = snapVec(
      { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 },
      GRID_NM,
    );
    const idSet = new Set(insts.map((i) => i.id));
    const session = canonicalSessionFor(history);
    if (session) {
      void session
        .commit({
          commandId: "pcb.rotate-side-footprint",
          label: gestureLabel("Rotate", insts),
          buildOperations: (board): EngineeringOperation[] =>
            board.footprints
              .filter((fp) => idSet.has(fp.id))
              .map((fp, index) => {
                // 90° CW in a +y-down world: (x, y) → (−y, x) about the center.
                const rx = fp.at.x - center.x;
                const ry = fp.at.y - center.y;
                const at = snapVec({ x: center.x - ry, y: center.y + rx }, GRID_NM);
                return {
                  operationId: `op:rotate:${index}`,
                  schemaVersion: 1,
                  units: "nm",
                  kind: "move_footprint",
                  footprintId: fp.id,
                  at: { x: Math.round(at.x), y: Math.round(at.y) },
                  // KiCad rotations are CCW-positive, so CW is −90.
                  rotationDeg: (fp.rotationDeg - 90 + 360) % 360,
                };
              }),
        })
        .then((result) => {
          if (destroyed) return;
          if (!result.ok) deps.toast(result.message);
          else reevaluateViolations(ids);
        });
      return;
    }
    if (!legacyMutationAllowed()) { history.cancelTransient(); return; }
    history.execute(gestureLabel("Rotate", insts), (draft) => {
      for (const fp of draft.footprints) {
        if (!idSet.has(fp.id)) continue;
        // 90° CW in a +y-down world: (x, y) → (−y, x) about the center.
        const rx = fp.at.x - center.x;
        const ry = fp.at.y - center.y;
        fp.at = snapVec({ x: center.x - ry, y: center.y + rx }, GRID_NM);
        // KiCad rotations are CCW-positive, so CW is −90 — same on both sides
        // (the mirror is innermost; global rotations compose additively).
        fp.rotationDeg = (fp.rotationDeg - 90 + 360) % 360;
      }
    });
    reevaluateViolations(ids);
  }

  /** Flip side about the instance origin: keep `at`, negate rotation. */
  function flipSelection(ids: string[]): void {
    const insts = movableInstances(ids);
    if (insts.length === 0) return;
    const idSet = new Set(insts.map((i) => i.id));
    const session = canonicalSessionFor(history);
    if (session) {
      void session
        .commit({
          commandId: "pcb.rotate-side-footprint",
          label: gestureLabel("Flip", insts),
          buildOperations: (board): EngineeringOperation[] =>
            board.footprints
              .filter((fp) => idSet.has(fp.id))
              .map((fp, index) => {
                const at = snapVec(fp.at, GRID_NM);
                return {
                  operationId: `op:flip:${index}`,
                  schemaVersion: 1,
                  units: "nm",
                  kind: "move_footprint",
                  footprintId: fp.id,
                  at: { x: Math.round(at.x), y: Math.round(at.y) },
                  rotationDeg: (360 - fp.rotationDeg) % 360,
                  side: fp.side === "top" ? ("bottom" as const) : ("top" as const),
                };
              }),
        })
        .then((result) => {
          if (destroyed) return;
          if (!result.ok) deps.toast(result.message);
          else reevaluateViolations(ids);
        });
      return;
    }
    if (!legacyMutationAllowed()) { history.cancelTransient(); return; }
    history.execute(gestureLabel("Flip", insts), (draft) => {
      for (const fp of draft.footprints) {
        if (!idSet.has(fp.id)) continue;
        fp.side = fp.side === "top" ? "bottom" : "top";
        fp.rotationDeg = (360 - fp.rotationDeg) % 360;
        fp.at = snapVec(fp.at, GRID_NM);
      }
    });
    reevaluateViolations(ids);
  }

  function nudgeSelection(ids: string[], dx: number, dy: number, fine: boolean): void {
    const insts = movableInstances(ids);
    if (insts.length === 0) return;
    const step = fine ? FINE_NM : GRID_NM;
    const idSet = new Set(insts.map((i) => i.id));
    const session = canonicalSessionFor(history);
    if (session) {
      void session
        .commit({
          commandId: "pcb.move-footprint",
          label: gestureLabel("Nudge", insts),
          // Evaluated when the (serialized) commit runs, so a burst of nudges
          // composes correctly — each step moves from the then-current position.
          buildOperations: (board): EngineeringOperation[] =>
            board.footprints
              .filter((fp) => idSet.has(fp.id))
              .map((fp, index) => ({
                operationId: `op:nudge:${index}`,
                schemaVersion: 1,
                units: "nm",
                kind: "move_footprint",
                footprintId: fp.id,
                at: { x: Math.round(fp.at.x + dx * step), y: Math.round(fp.at.y + dy * step) },
              })),
        })
        .then((result) => {
          if (destroyed) return;
          if (!result.ok) deps.toast(result.message);
          else reevaluateViolations(ids);
        });
      return;
    }
    if (!legacyMutationAllowed()) { history.cancelTransient(); return; }
    history.execute(gestureLabel("Nudge", insts), (draft) => {
      for (const fp of draft.footprints) {
        if (!idSet.has(fp.id)) continue;
        fp.at = { x: fp.at.x + dx * step, y: fp.at.y + dy * step };
      }
    });
    reevaluateViolations(ids);
  }

  // ── Event entry points ─────────────────────────────────────────────────────

  function handlePointer(e: ScenePointerEvent): void {
    switch (e.type) {
      case "down": {
        if ((e.buttons & 2) !== 0) {
          // Right-click cancels an in-flight gesture (no menu mid-drag);
          // from idle it selects the item under the cursor (unless already
          // selected) and hands off to the host menu.
          const g = gesture;
          if (g.kind !== "idle") {
            if (g.kind === "move") {
              cancelMove(g);
            } else if (g.kind === "marquee") {
              scene.setMarquee(null);
            }
            gesture = { kind: "idle" };
            return;
          }
          const ref = e.pick ? pickToRef(e.pick) : null;
          if (ref && !isSelected(ref)) store.replace([ref]);
          deps.onContextMenu?.({ screen: e.screen, world: e.world, pick: e.pick });
          return;
        }
        if ((e.buttons & 1) === 0) return; // left button only
        if (e.pick?.kind === "outline-handle") return; // editor's job
        if (e.pick?.kind === "footprint") {
          const id = e.pick.id;
          const ref: SelectionRef = { kind: "footprint", id };
          if (e.modifiers.ctrl) {
            if (!isSelected(ref)) store.add(ref); // Ctrl-click adds
          } else if (!e.modifiers.shift && !isSelected(ref)) {
            store.replace([ref]);
          }
          gesture = {
            kind: "pending-move",
            downScreen: e.screen,
            downWorld: e.world,
            targetId: id,
            toggle: e.modifiers.shift,
          };
          return;
        }
        const ref = e.pick ? pickToRef(e.pick) : null;
        if (ref) {
          // Copper/pad/text: select immediately, no drag gesture (routing
          // owns copper edits). Double-click a track → select its net.
          const key = refKey(ref);
          const now = Date.now();
          const isDouble =
            lastClick !== null && lastClick.key === key && now - lastClick.time < 400;
          lastClick = { key, time: now };
          if (isDouble && ref.kind === "track") {
            const track = history.present.tracks.find((t) => t.id === ref.id);
            // Net 0 = unconnected — selecting "the net" would grab every
            // orphaned copper item board-wide; keep just the track.
            if (track && track.netId !== 0) {
              store.replace(selectNet(history.present, track.netId), ref);
              return;
            }
          }
          if (e.modifiers.shift) store.toggle(ref);
          else if (e.modifiers.ctrl) store.add(ref);
          else store.replace([ref]);
          return;
        }
        // Empty space: click clears (unless additive), drag = marquee.
        const additive = e.modifiers.shift || e.modifiers.ctrl;
        if (!additive) store.clear();
        gesture = {
          kind: "pending-marquee",
          downScreen: e.screen,
          downWorld: e.world,
          additive,
        };
        return;
      }

      case "move": {
        const g = gesture;
        if (g.kind === "idle") {
          scene.setHover(e.pick?.kind === "footprint" ? e.pick.id : null);
          return;
        }
        if (g.kind === "pending-move" || g.kind === "pending-marquee") {
          const dx = e.screen.x - g.downScreen.x;
          const dy = e.screen.y - g.downScreen.y;
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
          if (g.kind === "pending-move") {
            const targetRef: SelectionRef = { kind: "footprint", id: g.targetId };
            if (g.toggle && !isSelected(targetRef)) {
              store.add(targetRef);
            }
            scene.setHover(null);
            beginMove(g.targetId, g.downWorld);
            if (gesture.kind === "move") updateMove(gesture, e);
          } else {
            gesture = {
              kind: "marquee",
              downWorld: g.downWorld,
              additive: g.additive,
              baseSelection: g.additive ? store.get().refs : [],
            };
          }
          return;
        }
        if (g.kind === "marquee") {
          scene.setMarquee(marqueeRect(g.downWorld, e.world));
          store.replace(marqueeSelection(g, e.world));
          return;
        }
        updateMove(g, e);
        return;
      }

      case "up": {
        const g = gesture;
        if (g.kind === "pending-move") {
          gesture = { kind: "idle" };
          const ref: SelectionRef = { kind: "footprint", id: g.targetId };
          if (g.toggle) {
            store.toggle(ref);
          } else if (!e.modifiers.ctrl && store.get().refs.length > 1) {
            store.replace([ref]); // click collapses multi-select
          }
          return;
        }
        if (g.kind === "pending-marquee") {
          gesture = { kind: "idle" };
          return;
        }
        if (g.kind === "marquee") {
          gesture = { kind: "idle" };
          store.replace(marqueeSelection(g, e.world));
          scene.setMarquee(null);
          return;
        }
        if (g.kind === "move") finishMove(g, e.modifiers.alt);
        return;
      }

      case "leave": {
        const g = gesture;
        if (g.kind === "move") cancelMove(g);
        else if (g.kind === "marquee") scene.setMarquee(null);
        gesture = { kind: "idle" };
        scene.setHover(null);
        return;
      }
    }
  }

  function handleKey(e: KeyboardEvent): boolean {
    if (isEditableTarget(e.target)) return false;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    if (ctrl && (key === "z" || key === "y")) {
      if (gesture.kind === "move") cancelMove(gesture);
      gesture = { kind: "idle" };
      scene.setMarquee(null);
      if (key === "y" || e.shiftKey) deps.history.redo();
      else deps.history.undo();
      e.preventDefault();
      return true;
    }

    if (key === "escape") {
      const g = gesture;
      if (g.kind === "move") {
        cancelMove(g);
      } else if (g.kind === "marquee") {
        gesture = { kind: "idle" };
        scene.setMarquee(null);
      } else {
        gesture = { kind: "idle" };
        store.clear();
      }
      e.preventDefault();
      return true;
    }

    if (gesture.kind !== "idle") return false; // no key gestures mid-drag

    if (key === "delete" || key === "backspace") {
      const refs = store.get().refs;
      if (refs.length === 0) return false;
      // Stage 17: copper/zones/silk text delete through the command layer —
      // one undo step. Footprints stay (schematic is the source of truth).
      const deletable = refs.filter(
        (r) => r.kind === "track" || r.kind === "via" || r.kind === "zone" || r.kind === "text" || r.kind === "dimension",
      );
      if (deletable.length > 0) {
        if (canonicalSessionFor(history)) {
          // B03: canonical delete (track/via/zone); silk text falls back to
          // the legacy path inside applyEditsCanonical.
          void applyEditsCanonical(history, [{ op: "delete-items", refs: deletable }]).then((result) => {
            if (destroyed) return;
            if (result.ok) store.remove(deletable);
            else deps.toast(result.errors[0]);
          });
        } else if (legacyMutationAllowed()) {
          const result = applyEdits(history, [{ op: "delete-items", refs: deletable }]);
          if (result.ok) store.remove(deletable);
          else deps.toast(result.errors[0]);
        }
      }
      if (refs.some((r) => r.kind === "footprint")) {
        deps.toast(
          "Footprints can't be deleted on the board — remove the part from the schematic and re-sync.",
        );
      }
      e.preventDefault();
      return true;
    }

    const selection = selectedFootprintIds();
    if (selection.length === 0) return false;
    if (ctrl) return false; // don't shadow browser shortcuts like Ctrl+R

    switch (key) {
      case "r":
        rotateSelection(selection);
        break;
      case "f":
        flipSelection(selection);
        break;
      case "arrowleft":
        nudgeSelection(selection, -1, 0, e.shiftKey);
        break;
      case "arrowright":
        nudgeSelection(selection, 1, 0, e.shiftKey);
        break;
      case "arrowup":
        nudgeSelection(selection, 0, -1, e.shiftKey); // +y is DOWN
        break;
      case "arrowdown":
        nudgeSelection(selection, 0, 1, e.shiftKey);
        break;
      default:
        return false;
    }
    e.preventDefault();
    return true;
  }

  return {
    handlePointer,
    handleKey,
    refreshAirwires(): void {
      scheduleAirwires();
    },
    destroy(): void {
      destroyed = true;
      unsubscribe();
      if (rafId !== null) {
        if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(rafId);
        else clearTimeout(rafId);
        rafId = null;
      }
    },
  };
}
