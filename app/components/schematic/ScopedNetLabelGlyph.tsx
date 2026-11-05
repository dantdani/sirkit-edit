"use client";

/**
 * [PR-J3, 2026-10-22] Runbook J.3 items 1-3, J.4 (OD-255 item 2): the glyph of a label that carries a CONNECTION SCOPE - a hierarchical
 * label (the child-side anchor of a sheet port), a sheet pin (the parent-side pin on a child sheet's block) or a global label (a
 * project-wide name) - drawn by app/page.tsx's label map in place of `NetLabelGlyph` when `label.scope` is set. The shapes follow
 * KiCad's: a hierarchical label is a pentagon whose point faces the anchor, a sheet pin a tab on the block edge, a global label a
 * double-pointed box; each shows the port / label name (the port's name is the label's name, validated equal by the sheet contract).
 * The electrical connection point is the local origin; `orientation` rotates the flag clockwise from east; the text never rotates.
 *
 * Props are exactly `NetLabelGlyph`'s (the page's one-line conditional passes the same ones); the pointer handler is the page's own
 * label drag (B07.1 identity-geometry gesture: schematic.move-rotate); a sheet pin dragged off its block edge is snapped back by the
 * sheet lens before the commit (app/lib/schematic/sheet-lens.ts snapSheetPinToBlock). Presentation only: nothing here decides
 * connectivity (app/lib/schematic/project-connectivity.ts does).
 */

import type { MouseEvent as ReactMouseEvent } from "react";
import type { NetRole } from "@/app/lib/nets";
import type { NetLabel, Rotation } from "@/lib/schematic-types";

export interface ScopedNetLabelGlyphProps {
  label: NetLabel;
  role: NetRole;
  zoom: number;
  ghost?: boolean;
  deleteHovered?: boolean;
  pointerEvents?: "auto" | "none";
  onMouseDown?: (e: ReactMouseEvent) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

const FONT_SIZE = 16;
const FONT_WEIGHT = 600;
const CHAR_W = 9.6;
const LEAD = 12;
const HALF_H = 11;

export const SCOPE_COLORS = Object.freeze({ hierarchical: "#f59e0b", "sheet-pin": "#fbbf24", global: "#a78bfa" } as const);
export const SCOPE_WORDS = Object.freeze({ hierarchical: "Hierarchical label", "sheet-pin": "Sheet pin", global: "Global label" } as const);

/** The direction the flag extends after rotation (a scoped label's natural direction is east, like a generic label). */
type Dir = "north" | "east" | "south" | "west";
const DIRS: Dir[] = ["east", "south", "west", "north"];
const dirOf = (orientation: Rotation): Dir => DIRS[(orientation / 90) % 4]!;

export function ScopedNetLabelGlyph({ label, role, zoom, ghost, deleteHovered, pointerEvents, onMouseDown, onMouseEnter, onMouseLeave }: ScopedNetLabelGlyphProps) {
  void role; void zoom;
  const scope = label.scope ?? "global";
  const name = label.name.trim().toUpperCase();
  const color = deleteHovered ? "#f87171" : SCOPE_COLORS[scope];
  const dir = dirOf(label.orientation);
  const horizontal = dir === "east" || dir === "west";
  const textW = Math.max(20, name.length * CHAR_W);
  const bodyEnd = LEAD + 6 + textW + 6;
  const tip = bodyEnd + HALF_H;
  let shape: string;
  if (scope === "hierarchical") {
    // the pentagon's point faces the anchor (KiCad hierarchical label); the body carries the name
    shape = `${LEAD + HALF_H},${-HALF_H} ${tip},${-HALF_H} ${tip},${HALF_H} ${LEAD + HALF_H},${HALF_H} ${LEAD},0`;
  } else if (scope === "sheet-pin") {
    // a tab on the block edge: a box with its outer end pointed
    shape = `${LEAD},${-HALF_H} ${bodyEnd},${-HALF_H} ${tip},0 ${bodyEnd},${HALF_H} ${LEAD},${HALF_H}`;
  } else {
    // a global label: pointed at both ends
    shape = `${LEAD},0 ${LEAD + HALF_H},${-HALF_H} ${bodyEnd},${-HALF_H} ${tip},0 ${bodyEnd},${HALF_H} ${LEAD + HALF_H},${HALF_H}`;
  }
  const flagRotation = DIRS.indexOf(dir) * 90;
  const textAt = horizontal
    ? { x: (dir === "east" ? 1 : -1) * (LEAD + HALF_H + 4), y: 0, textAnchor: (dir === "east" ? "start" : "end") as "start" | "end", dominantBaseline: "middle" as const }
    : { x: 0, y: dir === "south" ? tip + 6 : -(tip + 6), textAnchor: "middle" as const, dominantBaseline: (dir === "south" ? "hanging" : "auto") as "hanging" | "auto" };
  return (
    <g
      transform={`translate(${label.position.x},${label.position.y})`}
      opacity={ghost ? 0.5 : 1}
      style={{ pointerEvents: pointerEvents ?? "auto", cursor: pointerEvents === "none" ? undefined : "grab" }}
      data-testid={`scoped-label-${label.id}`}
      data-scope={scope}
      data-port={label.portId}
      data-child-sheet={label.childSheetId}
      aria-label={`${SCOPE_WORDS[scope]} ${name}`}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <g transform={`rotate(${flagRotation})`}>
        <rect x={-2} y={-HALF_H - 3} width={tip + 6} height={HALF_H * 2 + 6} fill="transparent" />
        <line x1={0} y1={0} x2={LEAD} y2={0} stroke={color} strokeWidth={1.5} strokeLinecap="round" />
        <polygon points={shape} fill={color} fillOpacity={0.14} stroke={color} strokeWidth={1.25} strokeLinejoin="round" />
        {scope === "sheet-pin" && <circle cx={0} cy={0} r={3} fill={color} />}
      </g>
      <text {...textAt} fontSize={FONT_SIZE} fontWeight={FONT_WEIGHT} fontFamily="monospace" fill={color} style={{ userSelect: "none" }}>
        {name}
      </text>
    </g>
  );
}
