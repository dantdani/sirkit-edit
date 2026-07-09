// Board-level blocks of a .kicad_pcb: general/paper/layers header, the net
// table, the Edge.Cuts outline, and free board text (PCB Stage 13).

import type { PcbBoard, BoardOutline, BoardText } from "../types";
import type { PcbNetlist } from "../netlist-bridge";
import type { Vec2 } from "../geometry";
import type { KicadNetRef } from "./types";
import { newUuid } from "./types";
import { block, q, sexpr } from "./sexpr-emit";
import { layerHeaderEntries, toKicadLayer } from "./layer-map";
import { nmToMm, formatDeg } from "./units";

// ── Net table ────────────────────────────────────────────────────────────────

/**
 * Merged net table: board.nets is authoritative (it names every net copper
 * can reference); netlist nets fill in ids the board hasn't materialized yet.
 * Net 0 (unconnected, unnamed) is always present. Sorted by id (pinned).
 */
export function netTable(board: PcbBoard, netlist: PcbNetlist): KicadNetRef[] {
  const byId = new Map<number, string>([[0, ""]]);
  for (const n of netlist.nets) byId.set(n.id, n.name);
  for (const n of board.nets) byId.set(n.id, n.name);
  return [...byId.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.id - b.id);
}

export function netNameOf(nets: readonly KicadNetRef[], id: number): string {
  return nets.find((n) => n.id === id)?.name ?? "";
}

export function emitNet(net: KicadNetRef): string {
  return sexpr("net", net.id, q(net.name));
}

// ── Header blocks ────────────────────────────────────────────────────────────

export function emitGeneral(): string {
  return block("general", [sexpr("thickness", "1.6")]);
}

export function emitPaper(): string {
  return sexpr("paper", q("A4"));
}

export function emitLayersHeader(stackup: 2 | 4): string {
  const rows = layerHeaderEntries(stackup).map((e) =>
    sexpr(String(e.ordinal), q(e.name), e.type, ...(e.userName ? [q(e.userName)] : [])),
  );
  return block("layers", rows);
}

// ── Board outline → Edge.Cuts graphics ───────────────────────────────────────

const EDGE_STROKE = `(stroke (width 0.100000) (type solid))`;
const EDGE_LAYER = `(layer ${q("Edge.Cuts")})`;

function grLine(a: Vec2, b: Vec2): string {
  return `(gr_line (start ${nmToMm(a.x)} ${nmToMm(a.y)}) (end ${nmToMm(b.x)} ${nmToMm(b.y)}) ${EDGE_STROKE} ${EDGE_LAYER} (uuid ${q(newUuid())}))`;
}

function grArc(start: Vec2, mid: Vec2, end: Vec2): string {
  return `(gr_arc (start ${nmToMm(start.x)} ${nmToMm(start.y)}) (mid ${nmToMm(mid.x)} ${nmToMm(mid.y)}) (end ${nmToMm(end.x)} ${nmToMm(end.y)}) ${EDGE_STROKE} ${EDGE_LAYER} (uuid ${q(newUuid())}))`;
}

/** Board outline as Edge.Cuts segments (+ corner arcs for roundrect). */
export function emitOutline(outline: BoardOutline): string[] {
  if (outline.kind === "polygon") {
    const pts = outline.points;
    if (pts.length < 2) return [];
    return pts.map((p, i) => grLine(p, pts[(i + 1) % pts.length]));
  }

  const { x: x0, y: y0 } = outline.origin;
  const w = outline.width;
  const h = outline.height;

  if (outline.kind === "rect") {
    const tl = { x: x0, y: y0 };
    const tr = { x: x0 + w, y: y0 };
    const br = { x: x0 + w, y: y0 + h };
    const bl = { x: x0, y: y0 + h };
    return [grLine(tl, tr), grLine(tr, br), grLine(br, bl), grLine(bl, tl)];
  }

  // roundrect: 4 straight edges + 4 quarter arcs (mid = center + r/√2 toward
  // the corner). Radius clamped so degenerate inputs stay a valid outline.
  const r = Math.min(outline.cornerRadius, Math.floor(w / 2), Math.floor(h / 2));
  const d = Math.round(r / Math.SQRT2);
  const lines = [
    grLine({ x: x0 + r, y: y0 }, { x: x0 + w - r, y: y0 }),
    grLine({ x: x0 + w, y: y0 + r }, { x: x0 + w, y: y0 + h - r }),
    grLine({ x: x0 + w - r, y: y0 + h }, { x: x0 + r, y: y0 + h }),
    grLine({ x: x0, y: y0 + h - r }, { x: x0, y: y0 + r }),
  ];
  const arcs = [
    // top-right, bottom-right, bottom-left, top-left — CW around the board.
    grArc(
      { x: x0 + w - r, y: y0 },
      { x: x0 + w - r + d, y: y0 + r - d },
      { x: x0 + w, y: y0 + r },
    ),
    grArc(
      { x: x0 + w, y: y0 + h - r },
      { x: x0 + w - r + d, y: y0 + h - r + d },
      { x: x0 + w - r, y: y0 + h },
    ),
    grArc(
      { x: x0 + r, y: y0 + h },
      { x: x0 + r - d, y: y0 + h - r + d },
      { x: x0, y: y0 + h - r },
    ),
    grArc(
      { x: x0, y: y0 + r },
      { x: x0 + r - d, y: y0 + r - d },
      { x: x0 + r, y: y0 },
    ),
  ];
  return [...lines, ...arcs];
}

// ── Free board text ──────────────────────────────────────────────────────────

export function emitBoardText(t: BoardText): string {
  const at =
    t.rotationDeg !== 0
      ? sexpr("at", nmToMm(t.at.x), nmToMm(t.at.y), formatDeg(t.rotationDeg))
      : sexpr("at", nmToMm(t.at.x), nmToMm(t.at.y));
  const font = `(effects (font (size ${nmToMm(t.sizeX)} ${nmToMm(t.sizeY)}) (thickness ${nmToMm(t.thickness)})))`;
  return `(gr_text ${q(t.text)} ${at} (layer ${q(toKicadLayer(t.layer))}) (uuid ${q(newUuid())}) ${font})`;
}
