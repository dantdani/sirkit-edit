/**
 * B08 — dimension-annotation rendering. Same shape as Stage 16's silk
 * renderer: one labeled Graphics per documentation layer, appended to that
 * layer's container (layer visibility applies for free), rebuilt whole on
 * every setBoard. All strokes come from the shared pure geometry module —
 * what renders is exactly what picks and selects.
 */

import type { Container } from "pixi.js";
import { Graphics } from "pixi.js";
import type { PcbBoard } from "../types";
import { DIMENSION_LAYERS } from "../types";
import type { LayerId } from "../layers";
import { NM_PER_MM } from "../units";
import { layerColor } from "./colors";
import { dimensionGeometry } from "../dimensions/geometry";

const mm = (nm: number): number => nm / NM_PER_MM;
const label = (layer: LayerId): string => `dimensions:${layer}`;

export function renderDimensions(
  board: PcbBoard,
  getLayer: (layer: LayerId) => Container,
): { items: number } {
  let count = 0;
  for (const layer of DIMENSION_LAYERS) {
    const container = getLayer(layer);
    for (const child of [...container.children]) {
      if (child.label === label(layer)) {
        container.removeChild(child);
        child.destroy();
      }
    }
    const items = (board.dimensions ?? []).filter((dimension) => dimension.layer === layer);
    if (items.length === 0) continue;
    const g = new Graphics();
    g.label = label(layer);
    g.eventMode = "none";
    const color = layerColor(layer);
    for (const dimension of items) {
      const geometry = dimensionGeometry(dimension);
      for (const line of [...geometry.polylines, ...geometry.labelPolylines]) {
        if (line.length < 2) continue;
        g.moveTo(mm(line[0].x), mm(line[0].y));
        for (let i = 1; i < line.length; i++) g.lineTo(mm(line[i].x), mm(line[i].y));
      }
      g.stroke({ width: mm(dimension.strokeWidthNm), color, alpha: 0.95, cap: "round", join: "round" });
      count++;
    }
    container.addChild(g);
  }
  return { items: count };
}
