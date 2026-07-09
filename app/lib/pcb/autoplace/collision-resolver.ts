/**
 * Collision resolution (PCB Stage 8) — runs AFTER grid snap, never during the
 * force loop. Greedy and sequential in ascending footprint-id order
 * (deterministic tiebreaking): each footprint is snapped to the grid, hard-
 * clipped inside the board outline, then settled against everything already
 * settled — nudge along the centroid-to-centroid vector (grid steps, ≤ 8
 * attempts), falling back to a BFS spiral over grid cells (≤ 50 rings). A
 * footprint the spiral can't seat is left in place with a console warning —
 * the board may genuinely be too small; Stage 12's DRC surfaces the residual
 * overlap. Never throws for crowding (only for the impossible-board case where
 * a single footprint exceeds the outline).
 *
 * Locked footprints pass through untouched (not snapped, not clipped) but act
 * as immovable obstacles for everything else.
 */

import type { PcbBoard, BoardOutline } from "../types";
import type { Vec2, BBox } from "../geometry";
import type { FootprintPlacement } from "./types";
import { bboxesOverlap, courtyardFitsOutline, outlineBBox, outlineCenter, worldCourtyardBBox } from "./geometry";

const MAX_NUDGE_ATTEMPTS = 8;
const MAX_SPIRAL_RINGS = 50;
/**
 * Ring-step multipliers for the escalating spiral passes. One 50-ring pass at
 * the base grid only reaches 5 mm (at the 100 μm default) — not enough to
 * escape a crowded cluster around a 10 mm part. Coarser follow-up passes stay
 * grid-aligned and bounded (≤ 2500 cells each) while reaching the whole board.
 */
const SPIRAL_STEP_MULTIPLIERS = [1, 8, 32] as const;
/** Safety bound on the step-inward clip walk (non-rect outlines). */
const MAX_CLIP_STEPS = 4000;

const snap = (v: number, step: number): number => Math.round(v / step) * step;

/** World courtyard extents relative to the centroid, at final rotation/side. */
function centroidOffsets(p: FootprintPlacement): BBox {
  return worldCourtyardBBox(p.courtyardLocal, { x: 0, y: 0 }, p.rotationDeg, p.side === "bottom");
}

function boxAt(pos: Vec2, off: BBox): BBox {
  return { minX: pos.x + off.minX, minY: pos.y + off.minY, maxX: pos.x + off.maxX, maxY: pos.y + off.maxY };
}

/**
 * Move `pos` inward (grid-step multiples) until the courtyard fits the
 * outline. Rect-like outlines clamp per axis in one jump; the remainder
 * (roundrect corners, polygons) walks toward the outline center. Returns null
 * only when the walk budget runs out (crowded corner of a weird outline).
 */
function clipIntoOutline(pos: Vec2, off: BBox, outline: BoardOutline, gridNm: number): Vec2 | null {
  if (courtyardFitsOutline(boxAt(pos, off), outline)) return pos;
  const oBox = outlineBBox(outline);
  let x = pos.x;
  let y = pos.y;
  // Per-axis clamp against the outline bbox, rounded to whole grid steps inward.
  const over = (v: number): number => Math.ceil(v / gridNm) * gridNm;
  if (x + off.minX < oBox.minX) x += over(oBox.minX - (x + off.minX));
  else if (x + off.maxX > oBox.maxX) x -= over(x + off.maxX - oBox.maxX);
  if (y + off.minY < oBox.minY) y += over(oBox.minY - (y + off.minY));
  else if (y + off.maxY > oBox.maxY) y -= over(y + off.maxY - oBox.maxY);
  const center = outlineCenter(outline);
  for (let step = 0; step < MAX_CLIP_STEPS; step++) {
    if (courtyardFitsOutline(boxAt({ x, y }, off), outline)) return { x, y };
    const dx = center.x - x;
    const dy = center.y - y;
    if (dx === 0 && dy === 0) return null;
    // Grid-sized step along the dominant remaining direction(s).
    if (Math.abs(dx) >= gridNm / 2) x += Math.sign(dx) * gridNm;
    if (Math.abs(dy) >= gridNm / 2) y += Math.sign(dy) * gridNm;
  }
  return null;
}

export function resolveCollisions(
  board: PcbBoard,
  footprintPlacements: FootprintPlacement[],
  gridNm: number,
): {
  placements: FootprintPlacement[];
  collisionsResolved: number;
  footprintsClippedToBoundary: number;
} {
  const outline = board.outline;
  const oBox = outlineBBox(outline);
  const sorted = [...footprintPlacements].sort((a, b) => a.id.localeCompare(b.id));

  // Impossible-board guard: a single footprint larger than the outline can
  // never be clipped inside — fail loudly instead of walking forever.
  for (const p of sorted) {
    const off = centroidOffsets(p);
    if (p.locked) continue;
    if (off.maxX - off.minX > oBox.maxX - oBox.minX || off.maxY - off.minY > oBox.maxY - oBox.minY) {
      throw new Error(
        `auto-place: footprint ${p.id} courtyard is larger than the board outline — enlarge the board`,
      );
    }
  }

  const settled: BBox[] = [];
  const out: FootprintPlacement[] = [];
  let collisionsResolved = 0;
  let footprintsClippedToBoundary = 0;

  // Locked footprints settle first, exactly where they are.
  for (const p of sorted) {
    if (!p.locked) continue;
    settled.push(boxAt(p.position, centroidOffsets(p)));
    out.push({ ...p, position: { ...p.position } });
  }

  const fitsAndFree = (pos: Vec2, off: BBox): boolean => {
    const box = boxAt(pos, off);
    if (!courtyardFitsOutline(box, outline)) return false;
    return !settled.some((s) => bboxesOverlap(box, s));
  };

  for (const p of sorted) {
    if (p.locked) continue;
    const off = centroidOffsets(p);

    // 1. Grid snap.
    let pos: Vec2 = { x: snap(p.position.x, gridNm), y: snap(p.position.y, gridNm) };

    // 2. Hard clip inside the outline.
    const clipped = clipIntoOutline(pos, off, outline, gridNm);
    if (clipped === null) {
      console.warn(`auto-place: could not clip ${p.id} inside the board outline — leaving at last position`);
    } else {
      if (clipped.x !== pos.x || clipped.y !== pos.y) footprintsClippedToBoundary++;
      pos = clipped;
    }

    // 3. Greedy nudge along the centroid-to-centroid vector, grid steps.
    let attempts = 0;
    let colliding = settled.find((s) => bboxesOverlap(boxAt(pos, off), s));
    while (colliding && attempts < MAX_NUDGE_ATTEMPTS) {
      const otherCx = (colliding.minX + colliding.maxX) / 2;
      const otherCy = (colliding.minY + colliding.maxY) / 2;
      const dx = pos.x - otherCx;
      const dy = pos.y - otherCy;
      const next: Vec2 = {
        x: pos.x + (dx === 0 && dy === 0 ? gridNm : Math.sign(dx) * gridNm),
        y: pos.y + Math.sign(dy) * gridNm,
      };
      if (!courtyardFitsOutline(boxAt(next, off), outline)) break; // nudging off-board — spiral instead
      pos = next;
      attempts++;
      collisionsResolved++;
      colliding = settled.find((s) => bboxesOverlap(boxAt(pos, off), s));
    }

    // 4. BFS spiral over expanding grid rings around the snapped position,
    //    escalating to coarser (still grid-aligned) rings when the fine pass
    //    can't escape the crowd.
    if (colliding) {
      let found: Vec2 | null = null;
      for (const mult of SPIRAL_STEP_MULTIPLIERS) {
        const step = gridNm * mult;
        for (let r = 1; r <= MAX_SPIRAL_RINGS && !found; r++) {
          for (let dy = -r; dy <= r && !found; dy++) {
            for (let dx = -r; dx <= r; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
              const cand: Vec2 = { x: pos.x + dx * step, y: pos.y + dy * step };
              if (fitsAndFree(cand, off)) {
                found = cand;
                break;
              }
            }
          }
        }
        if (found) break;
      }
      if (found) {
        pos = found;
        collisionsResolved++;
      } else {
        // Genuinely too crowded — leave it; DRC surfaces the overlap.
        console.warn(
          `auto-place: no collision-free cell within ${MAX_SPIRAL_RINGS} rings for ${p.id} — leaving overlap for DRC`,
        );
      }
    }

    settled.push(boxAt(pos, off));
    out.push({ ...p, position: pos });
  }

  return { placements: out, collisionsResolved, footprintsClippedToBoundary };
}
