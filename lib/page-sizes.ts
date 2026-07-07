/**
 * Page-size geometry: millimetre sheet sizes → canvas pixels, plus the auto-fit
 * logic that picks the smallest sheet a generated layout fits on and the offset
 * that drops it inside the printable margin.
 *
 * Kept separate from schematic-types.ts so the type layer stays import-free.
 * This module is the one place that turns the abstract PageSize into pixels, and
 * it does so through KICAD_SCALE_PX_PER_MM — the single source of truth for the
 * mm↔px scale (see app/lib/geometry.ts).
 */
import {
  PAGE_SIZES_MM,
  TITLE_BLOCK_MM,
  DEFAULT_PAGE_SIZE,
  type PageSize,
} from "./schematic-types";
import { KICAD_SCALE_PX_PER_MM, snap } from "@/app/lib/geometry";

/** Sheet dimensions in canvas pixels (landscape). */
export function pageSizePx(size: PageSize): { widthPx: number; heightPx: number } {
  const mm = PAGE_SIZES_MM[size];
  return {
    widthPx: Math.round(mm.widthMm * KICAD_SCALE_PX_PER_MM),
    heightPx: Math.round(mm.heightMm * KICAD_SCALE_PX_PER_MM),
  };
}

/** Title-block box dimensions in canvas pixels. */
export function titleBlockPx(): { widthPx: number; heightPx: number } {
  return {
    widthPx: TITLE_BLOCK_MM.widthMm * KICAD_SCALE_PX_PER_MM,
    heightPx: TITLE_BLOCK_MM.heightMm * KICAD_SCALE_PX_PER_MM,
  };
}

// Clearance (px) between the sheet edge and any placed geometry. ~7.6mm.
export const PAGE_MARGIN_PX = 60;

// Auto-upgrade ladder, smallest → largest. A4 is the floor: small circuits stay
// A4 (the default) rather than shrinking to A5 — A5 is offered for manual
// selection only.
export const PAGE_SIZE_LADDER: readonly PageSize[] = ["A4", "A3", "A2", "A1"];

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

// Printable area of a sheet: the page minus the margin on every side, minus the
// title-block height reserved along the bottom (we keep the whole bottom band
// clear so nothing collides with the block in the corner).
function printableArea(size: PageSize): { width: number; height: number } {
  const { widthPx, heightPx } = pageSizePx(size);
  const tb = titleBlockPx();
  return {
    width: widthPx - 2 * PAGE_MARGIN_PX,
    height: heightPx - 2 * PAGE_MARGIN_PX - tb.heightPx,
  };
}

/**
 * Smallest sheet on the ladder (no smaller than `base`) whose printable area
 * holds `contentWidthPx × contentHeightPx`. Falls back to the largest sheet (A1)
 * when nothing fits — the caller lets the layout overflow rather than scaling it
 * (scaling would break the grid snap and pin alignment).
 */
export function fitPageSize(
  contentWidthPx: number,
  contentHeightPx: number,
  base: PageSize = DEFAULT_PAGE_SIZE,
): PageSize {
  // A base outside the ladder (USLetter/USLegal/A5) starts the search at A4.
  const startIndex = Math.max(0, PAGE_SIZE_LADDER.indexOf(base));
  for (let i = startIndex; i < PAGE_SIZE_LADDER.length; i++) {
    const size = PAGE_SIZE_LADDER[i];
    const area = printableArea(size);
    if (contentWidthPx <= area.width && contentHeightPx <= area.height) return size;
  }
  return PAGE_SIZE_LADDER[PAGE_SIZE_LADDER.length - 1];
}

/**
 * Plan how to drop a laid-out circuit onto a sheet: choose the sheet size and
 * the grid-snapped (dx, dy) translation that CENTRES the content within the
 * printable area (the band above the title block). The translation is a rigid
 * shift by a grid multiple, so it preserves every component's grid alignment AND
 * every wire route / label anchor (which were computed from the pre-shift pin
 * positions). When the content is larger than the printable area (overflow), the
 * slack is clamped to 0 so it aligns to the margin corner instead of shifting off.
 */
export function planPageFit(
  bounds: Bounds,
  base: PageSize = DEFAULT_PAGE_SIZE,
): { pageSize: PageSize; dx: number; dy: number } {
  const contentWidth = bounds.maxX - bounds.minX;
  const contentHeight = bounds.maxY - bounds.minY;
  const pageSize = fitPageSize(contentWidth, contentHeight, base);
  const area = printableArea(pageSize);
  const slackX = Math.max(0, area.width - contentWidth) / 2;
  const slackY = Math.max(0, area.height - contentHeight) / 2;
  return {
    pageSize,
    dx: snap(PAGE_MARGIN_PX + slackX - bounds.minX),
    dy: snap(PAGE_MARGIN_PX + slackY - bounds.minY),
  };
}
