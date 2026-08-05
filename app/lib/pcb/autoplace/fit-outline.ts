/**
 * Deterministic board-outline sizing.
 *
 * A default board is created at the capability profile's maximum size (100 x 80
 * mm). Releasing a nine-component design on a 100 x 80 mm panel is wasteful —
 * fabrication is priced by area — and contradicts a request for a compact
 * board. This derives a candidate outline from the actual component courtyards
 * plus routing and edge-clearance headroom.
 *
 * It only ever proposes a size; placement legality still decides. The caller is
 * expected to fall back to the original outline if a candidate cannot host a
 * legal placement, so shrinking can never smuggle an illegal board through.
 */

import type { PcbBoard } from "../types";
import { mmToNm } from "../units";
import { localCourtyardBBox } from "./geometry";

export interface OutlineCandidate {
  widthNm: number;
  heightNm: number;
  /** Total component courtyard area used to derive this candidate. */
  courtyardAreaNm2: number;
  areaUtilization: number;
}

const MIN_EDGE_MM = 12;

/**
 * Candidate outlines ordered smallest-first. `spreadFactors` are multiples of
 * the summed courtyard area, giving the router progressively more room; the
 * caller tries them in order and keeps the first that qualifies.
 */
export function fitOutlineCandidates(
  board: PcbBoard,
  options: { spreadFactors?: number[]; edgeMarginNm?: number; maxWidthNm: number; maxHeightNm: number } = { maxWidthNm: mmToNm(100), maxHeightNm: mmToNm(80) },
): OutlineCandidate[] {
  const edgeMargin = options.edgeMarginNm ?? mmToNm(1.5);
  const factors = options.spreadFactors ?? [4, 7, 12];

  let courtyardArea = 0;
  let widestNm = 0;
  let tallestNm = 0;
  for (const footprint of board.footprints) {
    const box = localCourtyardBBox(footprint.def);
    const rotated = footprint.rotationDeg === 90 || footprint.rotationDeg === 270;
    const w = rotated ? box.maxY - box.minY : box.maxX - box.minX;
    const h = rotated ? box.maxX - box.minX : box.maxY - box.minY;
    courtyardArea += Math.max(0, w) * Math.max(0, h);
    widestNm = Math.max(widestNm, w);
    tallestNm = Math.max(tallestNm, h);
  }
  if (courtyardArea <= 0) return [];

  const candidates: OutlineCandidate[] = [];
  const seen = new Set<string>();
  for (const factor of factors) {
    const target = courtyardArea * factor;
    // Square-ish: the router does best with a roughly balanced aspect ratio.
    const side = Math.sqrt(target);
    let width = Math.max(side, widestNm + 2 * edgeMargin, mmToNm(MIN_EDGE_MM));
    let height = Math.max(target / width, tallestNm + 2 * edgeMargin, mmToNm(MIN_EDGE_MM));
    // Round up to whole millimetres for a fabrication-friendly outline.
    width = Math.min(options.maxWidthNm, Math.ceil(width / mmToNm(1)) * mmToNm(1));
    height = Math.min(options.maxHeightNm, Math.ceil(height / mmToNm(1)) * mmToNm(1));
    const key = `${width}x${height}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ widthNm: width, heightNm: height, courtyardAreaNm2: courtyardArea, areaUtilization: courtyardArea / (width * height) });
  }
  return candidates;
}

/** Board clone whose rectangular outline is resized at the same origin. */
export function withResizedOutline(board: PcbBoard, widthNm: number, heightNm: number): PcbBoard {
  const next = structuredClone(board);
  const origin = next.outline.kind === "rect" ? next.outline.origin : { x: 0, y: 0 };
  next.outline = { kind: "rect", origin, width: widthNm, height: heightNm };
  return next;
}
