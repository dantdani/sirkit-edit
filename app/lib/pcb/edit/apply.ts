/**
 * Edit-command application (PCB Stage 17) — compiles validated `EditCommand`s
 * into `(draft: PcbBoard) => void` mutators and commits a whole batch through
 * ONE `history.execute()` — one undo step, immer patches are the inverse.
 *
 * SINGLE MUTATION PATH: no code outside this file calls `history.execute` for
 * property edits (gesture tools keep their transient/execute paths). If a
 * feature can't be a command, it doesn't ship in Stage 17.
 */

import { produce } from "immer";
import type { Vec2, BBox } from "../geometry";
import { transformPoint, bboxUnion } from "../geometry";
import type { PcbBoard, FootprintInstance } from "../types";
import type { PcbHistory } from "../history";
import type { EditCommand, EditResult, SelectionRef } from "./commands";
import { refKey } from "./commands";
import {
  validateCommand,
  findTrack,
  findVia,
  findZone,
  findFootprint,
} from "./validate";
import { describeEdits } from "./describe";
import { addPadstack, syncViasToPadstack } from "../padstack/registry";
import { applyPadstackToVia } from "../padstack/defaults";

// ── Geometry helpers ─────────────────────────────────────────────────────────

function roundVec(v: Vec2): Vec2 {
  return { x: Math.round(v.x), y: Math.round(v.y) };
}

/** 90° rotation about a pivot, screen-wise: +1 = CW, −1 = CCW (+y is down). */
function rotateQuarter(p: Vec2, pivot: Vec2, quarterTurns: 1 | -1): Vec2 {
  const rx = p.x - pivot.x;
  const ry = p.y - pivot.y;
  return quarterTurns === 1
    ? { x: pivot.x - ry, y: pivot.y + rx }
    : { x: pivot.x + ry, y: pivot.y - rx };
}

/** KiCad rotations are CCW-positive, so a screen-wise CW quarter turn is −90. */
function turnedDeg(deg: number, quarterTurns: 1 | -1): number {
  return (((deg - 90 * quarterTurns) % 360) + 360) % 360;
}

function footprintWorldBBox(fp: FootprintInstance): BBox {
  const b = fp.def.bodyBBox;
  const corners: Vec2[] = [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ];
  let out: BBox | null = null;
  for (const c of corners) {
    const p = transformPoint(c, fp.at, fp.rotationDeg, fp.side === "bottom");
    const box = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
    out = out ? bboxUnion(out, box) : box;
  }
  return out ?? { minX: fp.at.x, minY: fp.at.y, maxX: fp.at.x, maxY: fp.at.y };
}

/** World bbox of one referenced item (validated to exist). */
function refBBox(board: PcbBoard, ref: SelectionRef): BBox | null {
  switch (ref.kind) {
    case "footprint": {
      const fp = findFootprint(board, ref.id);
      return fp ? footprintWorldBBox(fp) : null;
    }
    case "via": {
      const v = findVia(board, ref.id);
      if (!v) return null;
      const r = v.size / 2;
      return { minX: v.at.x - r, minY: v.at.y - r, maxX: v.at.x + r, maxY: v.at.y + r };
    }
    case "track": {
      const t = findTrack(board, ref.id);
      if (!t) return null;
      const r = t.width / 2;
      return {
        minX: Math.min(t.start.x, t.end.x) - r,
        minY: Math.min(t.start.y, t.end.y) - r,
        maxX: Math.max(t.start.x, t.end.x) + r,
        maxY: Math.max(t.start.y, t.end.y) + r,
      };
    }
    case "zone": {
      const z = findZone(board, ref.id);
      if (!z || z.polygon.length === 0) return null;
      let box: BBox | null = null;
      for (const p of z.polygon) {
        const b = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
        box = box ? bboxUnion(box, b) : b;
      }
      return box;
    }
    case "text": {
      const item = (board.silkItems ?? []).find((s) => s.id === ref.id);
      if (!item || item.kind !== "text") return null;
      return {
        minX: item.position.x,
        minY: item.position.y,
        maxX: item.position.x,
        maxY: item.position.y,
      };
    }
    case "pad":
      return null; // pads are never rotate/move targets (validator rejects)
  }
}

/** Selection-bbox center — the default rotate pivot (existing 90° machinery). */
export function selectionBBoxCenter(board: PcbBoard, refs: SelectionRef[]): Vec2 {
  let box: BBox | null = null;
  for (const ref of refs) {
    const b = refBBox(board, ref);
    if (b) box = box ? bboxUnion(box, b) : b;
  }
  if (!box) return { x: 0, y: 0 };
  return { x: Math.round((box.minX + box.maxX) / 2), y: Math.round((box.minY + box.maxY) / 2) };
}

// ── Command → mutator compilation ────────────────────────────────────────────

type Mutator = (draft: PcbBoard) => void;

function idSet(refs: SelectionRef[], kind: "via" | "track" | "zone" | "text" | "footprint"): Set<string> {
  const out = new Set<string>();
  for (const ref of refs) {
    if (ref.kind === kind) out.add(ref.id);
  }
  return out;
}

/** Compile one VALIDATED command against the pre-execute board. Constants
 *  (pivots, rounded deltas) are computed here so the mutator is cheap and
 *  deterministic inside the immer draft. */
function compileCommand(board: PcbBoard, cmd: EditCommand): Mutator {
  switch (cmd.op) {
    case "set-track-width": {
      const ids = new Set(cmd.ids);
      const width = Math.round(cmd.widthNm);
      return (draft) => {
        for (const t of draft.tracks) {
          if (ids.has(t.id)) t.width = width;
        }
      };
    }

    case "set-item-layer": {
      const tracks = idSet(cmd.refs, "track");
      const zones = idSet(cmd.refs, "zone");
      const texts = idSet(cmd.refs, "text");
      const layer = cmd.layer;
      return (draft) => {
        for (const t of draft.tracks) {
          if (tracks.has(t.id)) t.layer = layer;
        }
        for (const z of draft.zones) {
          if (zones.has(z.id)) {
            z.layer = layer;
            z.dirty = true;
          }
        }
        for (const s of draft.silkItems ?? []) {
          if (s.kind === "text" && texts.has(s.id)) {
            s.layer = layer as "silkTop" | "silkBottom"; // validator guarantees silk
            // Bottom silk reads through the board — mirror follows the layer.
            s.mirror = s.layer === "silkBottom";
          }
        }
      };
    }

    case "move-items": {
      const d = roundVec(cmd.deltaNm);
      return makeTransformMutator(cmd.refs, (p) => ({ x: p.x + d.x, y: p.y + d.y }));
    }

    case "set-position": {
      const at = roundVec(cmd.atNm);
      const ref = cmd.ref;
      return (draft) => {
        if (ref.kind === "via") {
          const v = draft.vias.find((x) => x.id === ref.id);
          if (v) v.at = at;
        } else if (ref.kind === "footprint") {
          const fp = draft.footprints.find((x) => x.id === ref.id);
          if (fp) fp.at = at;
        } else if (ref.kind === "text") {
          const s = (draft.silkItems ?? []).find((x) => x.id === ref.id);
          if (s && s.kind === "text") s.position = at;
        }
      };
    }

    case "rotate-items": {
      const pivot = roundVec(cmd.pivotNm ?? selectionBBoxCenter(board, cmd.refs));
      const qt = cmd.quarterTurns;
      const move = makeTransformMutator(cmd.refs, (p) => rotateQuarter(p, pivot, qt));
      const fps = idSet(cmd.refs, "footprint");
      const texts = idSet(cmd.refs, "text");
      return (draft) => {
        move(draft);
        for (const fp of draft.footprints) {
          if (fps.has(fp.id)) fp.rotationDeg = turnedDeg(fp.rotationDeg, qt);
        }
        for (const s of draft.silkItems ?? []) {
          if (s.kind === "text" && texts.has(s.id)) s.rotationDeg = turnedDeg(s.rotationDeg, qt);
        }
      };
    }

    case "set-footprint-props": {
      const { id, patch } = cmd;
      return (draft) => {
        const fp = draft.footprints.find((f) => f.id === id);
        if (!fp) return;
        if (patch.rotationDeg !== undefined) {
          fp.rotationDeg = ((patch.rotationDeg % 360) + 360) % 360;
        }
        if (patch.side !== undefined) fp.side = patch.side;
        if (patch.locked !== undefined) fp.locked = patch.locked;
      };
    }

    case "set-zone-props": {
      const { id, patch } = cmd;
      return (draft) => {
        const z = draft.zones.find((x) => x.id === id);
        if (!z) return;
        if (patch.netId !== undefined) z.netId = patch.netId;
        if (patch.connect !== undefined) z.connection = patch.connect;
        if (patch.clearanceNm !== undefined) z.clearanceOverrideNm = Math.round(patch.clearanceNm);
        z.dirty = true;
      };
    }

    case "set-text-props": {
      const { id, patch } = cmd;
      return (draft) => {
        const s = (draft.silkItems ?? []).find((x) => x.id === id);
        if (!s || s.kind !== "text") return;
        if (patch.text !== undefined) s.text = patch.text;
        if (patch.sizeNm !== undefined) s.heightNm = Math.round(patch.sizeNm);
        if (patch.thicknessNm !== undefined) s.strokeWidthNm = Math.round(patch.thicknessNm);
        if (patch.layer !== undefined) {
          s.layer = patch.layer as "silkTop" | "silkBottom";
          // Bottom silk reads through the board — mirror follows the layer.
          s.mirror = s.layer === "silkBottom";
        }
      };
    }

    case "delete-items": {
      const tracks = idSet(cmd.refs, "track");
      const vias = idSet(cmd.refs, "via");
      const zones = idSet(cmd.refs, "zone");
      const texts = idSet(cmd.refs, "text");
      return (draft) => {
        if (tracks.size > 0) draft.tracks = draft.tracks.filter((t) => !tracks.has(t.id));
        if (vias.size > 0) draft.vias = draft.vias.filter((v) => !vias.has(v.id));
        if (zones.size > 0) draft.zones = draft.zones.filter((z) => !zones.has(z.id));
        if (texts.size > 0 && draft.silkItems) {
          draft.silkItems = draft.silkItems.filter((s) => !(s.kind === "text" && texts.has(s.id)));
        }
      };
    }

    case "create-padstack": {
      const input = cmd.padstack;
      return (draft) => {
        addPadstack(draft, input);
      };
    }

    case "edit-padstack": {
      const { id, patch } = cmd;
      return (draft) => {
        const ps = (draft.padstacks ?? []).find((p) => p.id === id);
        if (!ps) return;
        if (patch.name !== undefined) ps.name = patch.name;
        if (patch.outerNm !== undefined) ps.outerNm = Math.round(patch.outerNm);
        if (patch.drillNm !== undefined) ps.drillNm = Math.round(patch.drillNm);
        if (patch.tented !== undefined) ps.tented = patch.tented;
        if (patch.zoneConnect !== undefined) ps.zoneConnect = patch.zoneConnect;
        // Denormalization invariant: member vias mirror the padstack dims.
        syncViasToPadstack(draft, id);
      };
    }

    case "set-via-padstack": {
      const ids = new Set(cmd.viaIds);
      const padstackId = cmd.padstackId;
      return (draft) => {
        const ps = (draft.padstacks ?? []).find((p) => p.id === padstackId);
        if (!ps) return;
        for (const via of draft.vias) {
          if (ids.has(via.id)) applyPadstackToVia(via, ps);
        }
      };
    }

    case "delete-padstack": {
      const { id } = cmd;
      return (draft) => {
        // Validator guarantees usageCount === 0.
        draft.padstacks = (draft.padstacks ?? []).filter((p) => p.id !== id);
      };
    }

    // Validated commands never reach here for not-yet-implemented ops —
    // validateCommand rejects them until their phase lands.
    default:
      return () => {};
  }
}

/** Position-transform mutator over every movable point of the referenced
 *  items: footprint/via anchors, both track endpoints, zone polygons, text
 *  anchors. Zones touched this way go dirty (fills are derived state). */
function makeTransformMutator(refs: SelectionRef[], f: (p: Vec2) => Vec2): Mutator {
  const fps = idSet(refs, "footprint");
  const vias = idSet(refs, "via");
  const tracks = idSet(refs, "track");
  const zones = idSet(refs, "zone");
  const texts = idSet(refs, "text");
  const t = (p: Vec2): Vec2 => roundVec(f(p));
  return (draft) => {
    for (const fp of draft.footprints) {
      if (fps.has(fp.id)) fp.at = t(fp.at);
    }
    for (const v of draft.vias) {
      if (vias.has(v.id)) v.at = t(v.at);
    }
    for (const tr of draft.tracks) {
      if (tracks.has(tr.id)) {
        tr.start = t(tr.start);
        tr.end = t(tr.end);
      }
    }
    for (const z of draft.zones) {
      if (zones.has(z.id)) {
        z.polygon = z.polygon.map(t);
        z.dirty = true;
      }
    }
    for (const s of draft.silkItems ?? []) {
      if (s.kind === "text" && texts.has(s.id)) s.position = t(s.position);
    }
  };
}

// ── The single mutation path ─────────────────────────────────────────────────

/**
 * Validate + compile a batch SEQUENTIALLY: each command validates against the
 * board as the previous commands left it, so batch-internal dependencies work
 * (e.g. `create-padstack` followed by `set-via-padstack` referencing the new
 * id — the Phase C fork rule). Mutators capture only constants and ids, so
 * replaying them in order on the history draft reproduces `result` exactly.
 */
export function compileEdits(
  board: PcbBoard,
  cmds: EditCommand[],
): { errors: string[]; mutators: ((draft: PcbBoard) => void)[]; result: PcbBoard } {
  const errors: string[] = [];
  const mutators: Mutator[] = [];
  let cur = board;
  for (const cmd of cmds) {
    const errs = validateCommand(cur, cmd);
    if (errs.length > 0) {
      errors.push(...errs);
      continue;
    }
    const m = compileCommand(cur, cmd);
    mutators.push(m);
    cur = produce(cur, m);
  }
  return { errors, mutators, result: cur };
}

/**
 * Dry-run a batch on throwaway immer drafts — the board is not touched and
 * no history entry exists. Phase B's `previewEdits` and the AI assist gate
 * build on this. Invalid commands are skipped (callers validate separately).
 */
export function dryRunEdits(board: PcbBoard, cmds: EditCommand[]): PcbBoard {
  return compileEdits(board, cmds).result;
}

/**
 * Validate ALL commands (sequentially — see compileEdits), then apply them in
 * ONE `history.execute()` — one undo step for the whole batch (inspector
 * commit, arrange action, AI edit). Any validation error aborts the batch
 * untouched.
 */
export function applyEdits(
  history: PcbHistory,
  cmds: EditCommand[],
  labelOverride?: string,
): EditResult {
  const board = history.present;
  if (cmds.length === 0) {
    return { ok: true, errors: [], violations: [], label: "" };
  }

  const { errors, mutators } = compileEdits(board, cmds);
  if (errors.length > 0) {
    return { ok: false, errors, violations: [], label: "" };
  }

  const label = labelOverride ?? describeEdits(board, cmds);
  history.execute(label, (draft) => {
    for (const m of mutators) m(draft);
  });
  return { ok: true, errors: [], violations: [], label };
}

/** Refs that still resolve on `board` — prunes a selection after commits. */
export function liveRefs(board: PcbBoard, refs: SelectionRef[]): SelectionRef[] {
  const seen = new Set<string>();
  const out: SelectionRef[] = [];
  for (const ref of refs) {
    const key = refKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    if (validateRefLive(board, ref)) out.push(ref);
  }
  return out;
}

function validateRefLive(board: PcbBoard, ref: SelectionRef): boolean {
  switch (ref.kind) {
    case "via":
      return board.vias.some((v) => v.id === ref.id);
    case "track":
      return board.tracks.some((t) => t.id === ref.id);
    case "zone":
      return board.zones.some((z) => z.id === ref.id);
    case "text":
      return (board.silkItems ?? []).some((s) => s.kind === "text" && s.id === ref.id);
    case "footprint":
      return board.footprints.some((f) => f.id === ref.id);
    case "pad": {
      const fp = board.footprints.find((f) => f.id === ref.footprintId);
      return fp !== undefined && fp.def.pads.some((p) => p.number === ref.padNumber);
    }
  }
}
