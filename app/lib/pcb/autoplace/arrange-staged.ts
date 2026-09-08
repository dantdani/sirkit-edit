/**
 * Deterministic arrangement of staged (off-board) footprints (R06 Section 10).
 *
 * The durable sync plan materializes NEW components in a staging strip left
 * of the board outline (negative-x). The sync dialog's "Place new parts near
 * board center" option moves exactly those staged instances onto the board
 * as a centered grid — deterministic (sorted by reference designator, fixed
 * spacing), so re-running on identical input yields identical output.
 *
 * Instances already inside or overlapping the outline are never touched.
 */

import type { PcbBoard, FootprintInstance } from "../types";
import { footprintWorldBBox } from "../edit/arrange";
import { outlineBBoxNm } from "../render/outline";
import { mmToNm } from "../units";
import { compareNatural } from "@/app/lib/stable-compare";

const MARGIN_NM = mmToNm(2);

function isStaged(fp: FootprintInstance, outlineMinX: number): boolean {
  return footprintWorldBBox(fp).maxX < outlineMinX;
}

/** Returns the arranged board, or null when nothing was staged. */
export function arrangeStagedFootprints(board: PcbBoard): PcbBoard | null {
  const outline = outlineBBoxNm(board.outline);
  const staged = board.footprints.filter((fp) => isStaged(fp, outline.minX));
  if (!staged.length) return null;

  // Cell size: the largest staged body bbox plus margin, uniform grid.
  let cellW = 0, cellH = 0;
  for (const fp of staged) {
    const bb = footprintWorldBBox(fp);
    cellW = Math.max(cellW, bb.maxX - bb.minX);
    cellH = Math.max(cellH, bb.maxY - bb.minY);
  }
  cellW += MARGIN_NM;
  cellH += MARGIN_NM;

  const ordered = [...staged].sort((a, b) => compareNatural(a.ref, b.ref));
  const columns = Math.max(1, Math.ceil(Math.sqrt(ordered.length)));
  const rows = Math.ceil(ordered.length / columns);
  const gridW = columns * cellW;
  const gridH = rows * cellH;
  const centerX = (outline.minX + outline.maxX) / 2;
  const centerY = (outline.minY + outline.maxY) / 2;
  const originX = centerX - gridW / 2 + cellW / 2;
  const originY = centerY - gridH / 2 + cellH / 2;

  const targets = new Map<string, { x: number; y: number }>();
  ordered.forEach((fp, index) => {
    const column = index % columns, row = Math.floor(index / columns);
    targets.set(fp.id, { x: Math.round(originX + column * cellW), y: Math.round(originY + row * cellH) });
  });

  const next = structuredClone(board);
  for (const fp of next.footprints) {
    const target = targets.get(fp.id);
    if (target) fp.at = target;
  }
  return next;
}
