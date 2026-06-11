"use client";

/**
 * Renders a KiCad symbol from its raw S-expression source as a themed SVG.
 *
 * Read-only by design (Phase 2A). It parses `symbolRaw`, collects every drawing
 * primitive and pin across the symbol's sub-units, flips KiCad's y-up
 * coordinate system into SVG's y-down space, and re-themes everything to
 * sirkit's zinc/teal palette — KiCad's own colors are never honored.
 */

import { useMemo, type ReactElement } from "react";
import {
  parseSExp,
  isList,
  head,
  findChild,
  findChildren,
  getString,
  getNumber,
  type SExpr,
} from "@/app/lib/kicad/sexp";

// ─── Theme (exact values, no improvisation) ─────────────────────────────────

const COLOR = {
  body: "#d4d4d8", // zinc-300 — outlines (rect/polyline/circle/arc)
  pin: "#a1a1aa", // zinc-400 — pin lines
  pinDot: "#71717a", // zinc-500 — pin endpoint dots
  pinName: "#d4d4d8", // zinc-300 — pin names
  pinNumber: "#71717a", // zinc-500 — pin numbers (italic)
  text: "#a1a1aa", // zinc-400 — KiCad text annotations
  power: "#f87171", // red-400 — power pins
} as const;

const STROKE_BODY = 0.15;
const STROKE_PIN = 0.15;
const PIN_DOT_R = 0.3;
const NAME_SIZE = 1.0;
const NUMBER_SIZE = 0.8;
const PADDING_MM = 3;

type KicadSymbolProps = {
  symbolRaw: string;
  width?: number;
  height?: number;
  showPinLabels?: boolean;
  interactive?: boolean; // reserved for Phase 2B
};

// ─── Internal primitive model (already in SVG coordinates) ──────────────────

type Pt = { x: number; y: number };

type Primitive =
  | { kind: "rect"; a: Pt; b: Pt }
  | { kind: "polyline"; pts: Pt[] }
  | { kind: "circle"; c: Pt; r: number }
  | { kind: "arc"; start: Pt; mid: Pt; end: Pt }
  | { kind: "text"; value: string; at: Pt; angle: number; size: number }
  | {
      kind: "pin";
      tip: Pt;
      bodyEnd: Pt;
      name: string;
      number: string;
      isPower: boolean;
    };

/** KiCad symbols use y-up; SVG uses y-down. Flip on the way in. */
function toSvg(x: number, y: number): Pt {
  return { x, y: -y };
}

// ─── Parsing primitives out of the tree ─────────────────────────────────────

/** Parse a symbol's raw S-expression into themed primitives (SVG/mm coords). */
function parsePrimitives(symbolRaw: string): Primitive[] {
  try {
    const prims: Primitive[] = [];
    collectPrimitives(parseSExp(symbolRaw), prims);
    return prims;
  } catch {
    return [];
  }
}

function collectPrimitives(node: SExpr, out: Primitive[]): void {
  if (!isList(node)) return;
  switch (head(node)) {
    case "rectangle": {
      const p = parseRect(node);
      if (p) out.push(p);
      return;
    }
    case "polyline": {
      const p = parsePolyline(node);
      if (p) out.push(p);
      return;
    }
    case "circle": {
      const p = parseCircle(node);
      if (p) out.push(p);
      return;
    }
    case "arc": {
      const p = parseArc(node);
      if (p) out.push(p);
      return;
    }
    case "text": {
      const p = parseText(node);
      if (p) out.push(p);
      return;
    }
    case "pin": {
      const p = parsePin(node);
      if (p) out.push(p);
      return;
    }
    default:
      // Recurse into structural nodes (symbol units, etc.).
      for (const child of node) collectPrimitives(child, out);
  }
}

function readXY(node: SExpr[] | null): Pt | null {
  const x = getNumber(node?.[1]);
  const y = getNumber(node?.[2]);
  return x === null || y === null ? null : toSvg(x, y);
}

function parseRect(node: SExpr[]): Primitive | null {
  const a = readXY(findChild(node, "start"));
  const b = readXY(findChild(node, "end"));
  return a && b ? { kind: "rect", a, b } : null;
}

function parsePolyline(node: SExpr[]): Primitive | null {
  const ptsNode = findChild(node, "pts");
  if (!ptsNode) return null;
  const pts = findChildren(ptsNode, "xy")
    .map((xy) => readXY(xy))
    .filter((p): p is Pt => p !== null);
  return pts.length >= 2 ? { kind: "polyline", pts } : null;
}

function parseCircle(node: SExpr[]): Primitive | null {
  const c = readXY(findChild(node, "center"));
  const r = getNumber(findChild(node, "radius")?.[1]);
  return c && r !== null ? { kind: "circle", c, r } : null;
}

function parseArc(node: SExpr[]): Primitive | null {
  const start = readXY(findChild(node, "start"));
  const mid = readXY(findChild(node, "mid"));
  const end = readXY(findChild(node, "end"));
  return start && mid && end ? { kind: "arc", start, mid, end } : null;
}

function parseText(node: SExpr[]): Primitive | null {
  const value = getString(node[1]);
  if (!value) return null;
  const atNode = findChild(node, "at");
  const at = readXY(atNode);
  if (!at) return null;
  const angle = getNumber(atNode?.[3]) ?? 0;
  const font = findChild(findChild(node, "effects") ?? [], "font");
  const size = getNumber(findChild(font ?? [], "size")?.[1]) ?? NAME_SIZE;
  return { kind: "text", value, at, angle, size };
}

function parsePin(node: SExpr[]): Primitive | null {
  const typeStr = getString(node[1]) ?? "unspecified";
  const atNode = findChild(node, "at");
  const kx = getNumber(atNode?.[1]);
  const ky = getNumber(atNode?.[2]);
  if (kx === null || ky === null) return null;
  const angle = getNumber(atNode?.[3]) ?? 0;
  const length = getNumber(findChild(node, "length")?.[1]) ?? 0;

  const name = getString(findChild(node, "name")?.[1]) ?? "~";
  const number = getString(findChild(node, "number")?.[1]) ?? "";

  // In KiCad, (x,y) is the connection tip; the pin line runs from the tip into
  // the body along `angle` (y-up). Compute both ends, then flip to SVG.
  const rad = (angle * Math.PI) / 180;
  const bodyKx = kx + length * Math.cos(rad);
  const bodyKy = ky + length * Math.sin(rad);

  return {
    kind: "pin",
    tip: toSvg(kx, ky),
    bodyEnd: toSvg(bodyKx, bodyKy),
    name,
    number,
    isPower: typeStr === "power_in" || typeStr === "power_out",
  };
}

// ─── Bounding box ───────────────────────────────────────────────────────────

type Box = { minX: number; minY: number; maxX: number; maxY: number };

function growBox(box: Box, p: Pt): void {
  box.minX = Math.min(box.minX, p.x);
  box.minY = Math.min(box.minY, p.y);
  box.maxX = Math.max(box.maxX, p.x);
  box.maxY = Math.max(box.maxY, p.y);
}

function computeBox(primitives: Primitive[]): Box {
  const box: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const prim of primitives) {
    switch (prim.kind) {
      case "rect":
        growBox(box, prim.a);
        growBox(box, prim.b);
        break;
      case "polyline":
        for (const p of prim.pts) growBox(box, p);
        break;
      case "circle":
        growBox(box, { x: prim.c.x - prim.r, y: prim.c.y - prim.r });
        growBox(box, { x: prim.c.x + prim.r, y: prim.c.y + prim.r });
        break;
      case "arc":
        growBox(box, prim.start);
        growBox(box, prim.mid);
        growBox(box, prim.end);
        break;
      case "text":
        growBox(box, prim.at);
        break;
      case "pin":
        growBox(box, prim.tip);
        growBox(box, prim.bodyEnd);
        break;
    }
  }
  if (!Number.isFinite(box.minX)) return { minX: 0, minY: 0, maxX: 10, maxY: 10 };
  return box;
}

// ─── Arc → SVG path ─────────────────────────────────────────────────────────

function circumcenter(a: Pt, b: Pt, c: Pt): Pt | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  return {
    x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d,
    y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d,
  };
}

function arcPath(start: Pt, mid: Pt, end: Pt): string {
  const center = circumcenter(start, mid, end);
  if (!center) {
    // Collinear → degenerate arc; draw straight through the mid point.
    return `M ${fmt(start.x)} ${fmt(start.y)} L ${fmt(mid.x)} ${fmt(mid.y)} L ${fmt(end.x)} ${fmt(end.y)}`;
  }
  const r = Math.hypot(start.x - center.x, start.y - center.y);
  // sweep: sign of the cross product of (mid-start) x (end-start).
  const cross =
    (mid.x - start.x) * (end.y - start.y) - (mid.y - start.y) * (end.x - start.x);
  const sweep = cross < 0 ? 1 : 0;
  // large-arc: does the direct start→end chord exclude the mid point's side?
  const a0 = Math.atan2(start.y - center.y, start.x - center.x);
  const a1 = Math.atan2(end.y - center.y, end.x - center.x);
  let delta = a1 - a0;
  while (delta <= -Math.PI) delta += 2 * Math.PI;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  const large = Math.abs(delta) > Math.PI ? 1 : 0;
  return `M ${fmt(start.x)} ${fmt(start.y)} A ${fmt(r)} ${fmt(r)} 0 ${large} ${sweep} ${fmt(end.x)} ${fmt(end.y)}`;
}

function fmt(n: number): string {
  return (Math.round(n * 1000) / 1000).toString();
}

// ─── Component ──────────────────────────────────────────────────────────────

export function KicadSymbol({
  symbolRaw,
  width = 240,
  height = 180,
  showPinLabels = true,
}: KicadSymbolProps): ReactElement {
  const { primitives, box } = useMemo(() => {
    const prims = parsePrimitives(symbolRaw);
    return { primitives: prims, box: computeBox(prims) };
  }, [symbolRaw]);

  const vbX = box.minX - PADDING_MM;
  const vbY = box.minY - PADDING_MM;
  const vbW = box.maxX - box.minX + PADDING_MM * 2;
  const vbH = box.maxY - box.minY + PADDING_MM * 2;

  if (primitives.length === 0) {
    return (
      <div className="flex items-center justify-center text-xs text-zinc-600" style={{ width, height }}>
        No symbol geometry
      </div>
    );
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`${fmt(vbX)} ${fmt(vbY)} ${fmt(vbW)} ${fmt(vbH)}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ width: "100%", height: "100%", display: "block" }}
    >
      {primitives.map((prim, i) => renderPrimitive(prim, i, showPinLabels))}
    </svg>
  );
}

function renderPrimitive(prim: Primitive, key: number, showPinLabels: boolean): ReactElement | null {
  switch (prim.kind) {
    case "rect": {
      const x = Math.min(prim.a.x, prim.b.x);
      const y = Math.min(prim.a.y, prim.b.y);
      return (
        <rect
          key={key}
          x={x}
          y={y}
          width={Math.abs(prim.b.x - prim.a.x)}
          height={Math.abs(prim.b.y - prim.a.y)}
          fill="none"
          stroke={COLOR.body}
          strokeWidth={STROKE_BODY}
          strokeLinejoin="round"
        />
      );
    }
    case "polyline":
      return (
        <polyline
          key={key}
          points={prim.pts.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(" ")}
          fill="none"
          stroke={COLOR.body}
          strokeWidth={STROKE_BODY}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case "circle":
      return (
        <circle
          key={key}
          cx={prim.c.x}
          cy={prim.c.y}
          r={prim.r}
          fill="none"
          stroke={COLOR.body}
          strokeWidth={STROKE_BODY}
        />
      );
    case "arc":
      return (
        <path
          key={key}
          d={arcPath(prim.start, prim.mid, prim.end)}
          fill="none"
          stroke={COLOR.body}
          strokeWidth={STROKE_BODY}
          strokeLinecap="round"
        />
      );
    case "text":
      return (
        <text
          key={key}
          x={prim.at.x}
          y={prim.at.y}
          fontSize={prim.size}
          fill={COLOR.text}
          fontFamily="monospace"
          textAnchor="middle"
          dominantBaseline="central"
          transform={prim.angle ? `rotate(${-prim.angle} ${fmt(prim.at.x)} ${fmt(prim.at.y)})` : undefined}
        >
          {prim.value}
        </text>
      );
    case "pin":
      return renderPin(prim, key, showPinLabels);
  }
}

/**
 * Canvas variant of the symbol: renders the primitives at the part's natural
 * mm scale with NO outer <svg>/viewBox. The placing <g> on the schematic canvas
 * supplies the translate/rotate/scale transform. Used for placed instances.
 */
export function KicadSymbolInline({
  symbolRaw,
  showPinLabels = true,
}: {
  symbolRaw: string;
  showPinLabels?: boolean;
}): ReactElement {
  const primitives = useMemo(() => parsePrimitives(symbolRaw), [symbolRaw]);
  return <g>{primitives.map((p, i) => renderPrimitive(p, i, showPinLabels))}</g>;
}

function renderPin(prim: Extract<Primitive, { kind: "pin" }>, key: number, showPinLabels: boolean): ReactElement {
  const pinColor = prim.isPower ? COLOR.power : COLOR.pin;

  // Unit vector pointing from the body out toward the tip.
  const dx = prim.tip.x - prim.bodyEnd.x;
  const dy = prim.tip.y - prim.bodyEnd.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;

  // Pin name: just inside the body, anchored away from the body edge.
  const nameX = prim.bodyEnd.x - ux * 0.8;
  const nameY = prim.bodyEnd.y - uy * 0.8;
  const nameAnchor = Math.abs(ux) > 0.5 ? (ux > 0 ? "end" : "start") : "middle";

  // Pin number: above the midpoint of the pin line, offset perpendicular.
  const midX = (prim.tip.x + prim.bodyEnd.x) / 2;
  const midY = (prim.tip.y + prim.bodyEnd.y) / 2;
  const numX = midX - uy * 0.6;
  const numY = midY + ux * 0.6;

  return (
    <g key={key}>
      <line
        x1={prim.bodyEnd.x}
        y1={prim.bodyEnd.y}
        x2={prim.tip.x}
        y2={prim.tip.y}
        stroke={pinColor}
        strokeWidth={STROKE_PIN}
        strokeLinecap="round"
      />
      <circle cx={prim.tip.x} cy={prim.tip.y} r={PIN_DOT_R} fill={COLOR.pinDot} />
      {showPinLabels && prim.name !== "~" && prim.name !== "" && (
        <text
          x={nameX}
          y={nameY}
          fontSize={NAME_SIZE}
          fill={prim.isPower ? COLOR.power : COLOR.pinName}
          fontFamily="monospace"
          textAnchor={nameAnchor}
          dominantBaseline="central"
        >
          {prim.name}
        </text>
      )}
      {showPinLabels && prim.number !== "" && (
        <text
          x={numX}
          y={numY}
          fontSize={NUMBER_SIZE}
          fill={COLOR.pinNumber}
          fontFamily="monospace"
          fontStyle="italic"
          textAnchor="middle"
          dominantBaseline="central"
        >
          {prim.number}
        </text>
      )}
    </g>
  );
}
