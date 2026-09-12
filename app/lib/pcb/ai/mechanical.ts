/**
 * [B18-E E11] The BOUNDED mechanical read.
 *
 * Scenario 3 ("Add horizontal and vertical dimensions for the board and mounting holes.") needs two facts and nothing else:
 * where the board's edges are, and which footprints are mounting holes. The full AI snapshot states both, but it is the whole
 * board: measured at 40,410 characters placed and 70,173 / 72,453 routed against the loop's 60,000-character result budget,
 * and on the browser journey's synchronized board it EXCEEDS that budget, so the model receives `output_too_large_for_model`
 * and cannot plan a dimension at all.
 *
 * This read answers exactly those two facts, in millimetres, with a size that depends only on the outline's vertex count and
 * the number of mounting holes — never on nets, tracks, pads, zones or validations. It exposes no geometry the full snapshot
 * did not already state; it is the same information, bounded so it fits.
 */
import type { PcbBoard, FootprintInstance } from "../types";
import { physicalPadInstances } from "../pad-identity";
import { footprintWorldBBox } from "../edit/arrange";

const NM_PER_MM = 1_000_000;
const mm = (nm: number): number => nm / NM_PER_MM;
/** The outline polygon is bounded so one oversized board can never blow the budget; the count is always reported. */
export const MAX_OUTLINE_POINTS = 64;

export interface MechanicalSnapshot {
  units: "mm";
  boardRevisionId: string | null;
  outline: { kind: string; originMm: { x: number; y: number }; widthMm: number; heightMm: number; pointsMm: Array<{ x: number; y: number }>; pointCount: number };
  mountingHoles: Array<{ id: string; reference: string; positionMm: { x: number; y: number }; boundsMm: { minX: number; minY: number; maxX: number; maxY: number } }>;
  mountingHoleCount: number;
}

/** [B18-E E10/OD-21] a mounting hole is a footprint with pads, all of them non-plated holes. */
export function isMountingHoleFootprint(footprint: FootprintInstance): boolean {
  const pads = physicalPadInstances(footprint);
  return pads.length > 0 && pads.every((instance) => instance.pad.type === "np_thru_hole");
}

/** Every outline kind reduced to the two things a dimension needs: its extents and (bounded) its vertices. */
function outlineFacts(board: PcbBoard): MechanicalSnapshot["outline"] {
  const outline = board.outline;
  if (outline.kind === "polygon") {
    const points = outline.points.map((point) => ({ x: mm(point.x), y: mm(point.y) }));
    const xs = points.map((point) => point.x), ys = points.map((point) => point.y);
    const minX = xs.length > 0 ? Math.min(...xs) : 0, minY = ys.length > 0 ? Math.min(...ys) : 0;
    return {
      kind: outline.kind,
      originMm: { x: minX, y: minY },
      widthMm: (xs.length > 0 ? Math.max(...xs) : 0) - minX,
      heightMm: (ys.length > 0 ? Math.max(...ys) : 0) - minY,
      pointsMm: points.slice(0, MAX_OUTLINE_POINTS),
      pointCount: points.length,
    };
  }
  return {
    kind: outline.kind,
    originMm: { x: mm(outline.origin.x), y: mm(outline.origin.y) },
    widthMm: mm(outline.width),
    heightMm: mm(outline.height),
    pointsMm: [],
    pointCount: 0,
  };
}

/** Build the bounded mechanical view of a board: its extents and its mounting holes, in millimetres. */
export function buildMechanicalSnapshot(board: PcbBoard, options: { boardRevisionId?: string | null } = {}): MechanicalSnapshot {
  const holes = board.footprints.filter(isMountingHoleFootprint);
  return {
    units: "mm",
    boardRevisionId: options.boardRevisionId ?? null,
    outline: outlineFacts(board),
    mountingHoles: holes.map((footprint) => {
      const bounds = footprintWorldBBox(footprint);
      return {
        id: footprint.id,
        reference: footprint.ref,
        positionMm: { x: mm(footprint.at.x), y: mm(footprint.at.y) },
        boundsMm: { minX: mm(bounds.minX), minY: mm(bounds.minY), maxX: mm(bounds.maxX), maxY: mm(bounds.maxY) },
      };
    }),
    mountingHoleCount: holes.length,
  };
}
