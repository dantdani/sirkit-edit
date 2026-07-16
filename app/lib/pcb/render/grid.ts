/**
 * Adaptive background grid (PCB Stage 3).
 *
 * The grid is regenerated only when the zoom bucket changes, the view drifts
 * outside the drawn coverage, or the zoom moves far enough that the
 * screen-constant line widths would look wrong — NOT on every pan/zoom frame
 * (regenerating per frame is the classic grid perf mistake).
 *
 * Minor step by zoom (px per mm): >20 → 0.1 mm, >4 → 0.5, >1.5 → 1, else 5.
 * Major line every 5 minors. All coordinates mm.
 */

import { Graphics } from "pixi.js";
import { GRID_MINOR_COLOR, GRID_MAJOR_COLOR, GRID_ORIGIN_COLOR } from "./colors";

export interface ViewRectMm {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface GridCoverage {
  stepMm: number;
  pxPerMm: number;
  rect: ViewRectMm;
}

export function minorStepMm(pxPerMm: number): number {
  if (pxPerMm > 20) return 0.1;
  if (pxPerMm > 4) return 0.5;
  if (pxPerMm > 1.5) return 1;
  return 5;
}

/** Does the grid need a redraw for the current view? */
export function gridNeedsRebuild(
  cov: GridCoverage | null,
  view: ViewRectMm,
  pxPerMm: number,
): boolean {
  if (!cov) return true;
  if (minorStepMm(pxPerMm) !== cov.stepMm) return true;
  // Zoomed >30% within the same bucket → line widths have drifted visibly.
  const ratio = pxPerMm / cov.pxPerMm;
  if (ratio > 1.3 || ratio < 0.77) return true;
  return (
    view.minX < cov.rect.minX ||
    view.minY < cov.rect.minY ||
    view.maxX > cov.rect.maxX ||
    view.maxY > cov.rect.maxY
  );
}

/**
 * Redraw the grid into `g`, covering the view expanded by half a screen on
 * every side (so small pans don't force a rebuild). Returns the new coverage.
 */
export function drawGrid(g: Graphics, view: ViewRectMm, pxPerMm: number): GridCoverage {
  const step = minorStepMm(pxPerMm);
  const padX = (view.maxX - view.minX) * 0.5;
  const padY = (view.maxY - view.minY) * 0.5;
  const rect: ViewRectMm = {
    minX: view.minX - padX,
    minY: view.minY - padY,
    maxX: view.maxX + padX,
    maxY: view.maxY + padY,
  };

  g.clear();
  const minorWidth = 1 / pxPerMm; // 1 screen px
  const majorWidth = 1.25 / pxPerMm;

  // Vertical then horizontal lines; grid line i sits at i*step, major when
  // i % 5 === 0 (anchored at the origin so majors are stable across rebuilds).
  const ix0 = Math.ceil(rect.minX / step);
  const ix1 = Math.floor(rect.maxX / step);
  for (let pass = 0; pass < 2; pass++) {
    const major = pass === 1;
    for (let i = ix0; i <= ix1; i++) {
      if ((i % 5 === 0) !== major) continue;
      const x = i * step;
      g.moveTo(x, rect.minY).lineTo(x, rect.maxY);
    }
    const iy0 = Math.ceil(rect.minY / step);
    const iy1 = Math.floor(rect.maxY / step);
    for (let i = iy0; i <= iy1; i++) {
      if ((i % 5 === 0) !== major) continue;
      const y = i * step;
      g.moveTo(rect.minX, y).lineTo(rect.maxX, y);
    }
    g.stroke({
      width: major ? majorWidth : minorWidth,
      color: major ? GRID_MAJOR_COLOR : GRID_MINOR_COLOR,
      alpha: major ? 0.58 : 0.24,
      pixelLine: true,
    });
  }

  // Origin crosshair (teal), drawn on top of the grid lines.
  g.moveTo(0, rect.minY).lineTo(0, rect.maxY);
  g.moveTo(rect.minX, 0).lineTo(rect.maxX, 0);
  g.stroke({ width: majorWidth, color: GRID_ORIGIN_COLOR, alpha: 0.45, pixelLine: true });

  return { stepMm: step, pxPerMm, rect };
}
