/**
 * Zone fill rendering (PCB Stage 11). One batched Graphics per copper layer,
 * inserted at index 0 of the layer container so pours paint UNDER pads and
 * tracks on the same layer; rebuilt whole on every call (the Stage 3/6
 * full-rebuild pattern; the PcbEditor effect drives it on board changes).
 *
 * - Filled zones: translucent copper polygons with their clearance holes
 *   punched (Graphics.cut()), plus a 1-px outer outline.
 * - `appearance: 'hatched'`: lighter fill + 45° hatch lines at 0.5 mm spacing
 *   overlaid across the region bbox (visual only — the lines are NOT clipped
 *   to the polygon; DRC/export always see the solid regions).
 * - Zones with no fill yet (dirty, or net removed): dashed-intent outline +
 *   15% raw-polygon fill, same as the Stage 6 unfilled rendering.
 */

import type { Container } from "pixi.js";
import { Graphics } from "pixi.js";
import type { PcbBoard, FilledRegion } from "../types";
import type { LayerId } from "../layers";
import { COPPER_LAYERS } from "../layers";
import { NM_PER_MM } from "../units";
import { layerColor } from "./colors";

const mm = (nm: number): number => nm / NM_PER_MM;
const label = (layer: LayerId): string => `zones:${layer}`;

const FILL_ALPHA = 0.35;
const HATCHED_FILL_ALPHA = 0.15;
const OUTLINE_ALPHA = 0.9;
const UNFILLED_ALPHA = 0.12;
const HATCH_SPACING_MM = 0.5;
const HATCH_ALPHA = 0.45;
const HATCH_WIDTH_MM = 0.08;

function toMmPts(ring: readonly { x: number; y: number }[]): number[] {
  const pts: number[] = [];
  for (const p of ring) pts.push(mm(p.x), mm(p.y));
  return pts;
}

function drawHatch(g: Graphics, region: FilledRegion, color: number): void {
  const b = region.boundingBox;
  const x0 = mm(b.minX);
  const y0 = mm(b.minY);
  const x1 = mm(b.maxX);
  const y1 = mm(b.maxY);
  // 45° lines: x + y = c, c stepping by spacing·√2.
  const step = HATCH_SPACING_MM * Math.SQRT2;
  for (let c = x0 + y0 + step; c < x1 + y1; c += step) {
    // Clip the line x+y=c to the bbox.
    const ax = Math.max(x0, c - y1);
    const ay = c - ax;
    const bx = Math.min(x1, c - y0);
    const by = c - bx;
    if (ax > bx) continue;
    g.moveTo(ax, ay).lineTo(bx, by);
  }
  g.stroke({ width: HATCH_WIDTH_MM, color, alpha: HATCH_ALPHA });
}

export function renderZones(
  board: PcbBoard,
  getLayer: (layer: LayerId) => Container,
): { primitives: number } {
  for (const layer of COPPER_LAYERS) {
    const c = getLayer(layer);
    for (const child of [...c.children]) {
      if (child.label === label(layer)) {
        c.removeChild(child);
        child.destroy();
      }
    }
  }

  let primitives = 0;
  const graphics = new Map<LayerId, Graphics>();
  const gfx = (layer: LayerId): Graphics => {
    let g = graphics.get(layer);
    if (!g) {
      g = new Graphics();
      g.label = label(layer);
      g.eventMode = "none";
      graphics.set(layer, g);
      getLayer(layer).addChildAt(g, 0); // under tracks/pads of the same layer
    }
    return g;
  };

  for (const zone of board.zones) {
    if (zone.polygon.length < 3) continue;
    const color = layerColor(zone.layer);
    const g = gfx(zone.layer);

    if (zone.fill.length === 0) {
      // Not poured (dirty / just drawn): outline hint, Stage 6 style.
      g.poly(toMmPts(zone.polygon), true)
        .fill({ color, alpha: UNFILLED_ALPHA })
        .stroke({ width: 1, pixelLine: true, color, alpha: OUTLINE_ALPHA });
      primitives += 1;
      continue;
    }

    for (const region of zone.fill) {
      const alpha = zone.appearance === "hatched" ? HATCHED_FILL_ALPHA : FILL_ALPHA;
      g.poly(toMmPts(region.outer), true).fill({ color, alpha });
      for (const hole of region.holes) {
        g.poly(toMmPts(hole), true).cut();
      }
      g.poly(toMmPts(region.outer), true).stroke({
        width: 1,
        pixelLine: true,
        color,
        alpha: OUTLINE_ALPHA,
      });
      if (zone.appearance === "hatched") drawHatch(g, region, color);
      primitives += 1 + region.holes.length;
    }
  }

  return { primitives };
}
