/**
 * User silk-item rendering (PCB Stage 16). Same shape as Stage 11's
 * renderZones: one labeled Graphics per silk layer, appended to that layer's
 * container (so layer visibility toggles apply for free), rebuilt whole on
 * every call — the PcbEditor effect drives it on board changes.
 *
 * Text draws its actual stroke-font polylines (what the fab prints), not a
 * browser font. Bottom-side items draw as-is in board coordinates — the
 * canvas always looks from the top, so bottom text with `mirror: true` reads
 * reversed here and correctly on the physical bottom side.
 */

import type { Container } from "pixi.js";
import { Graphics } from "pixi.js";
import type { PcbBoard } from "../types";
import type { LayerId } from "../layers";
import { NM_PER_MM } from "../units";
import { layerColor } from "./colors";
import type { SilkItem } from "../silk/types";
import { silkItemPolylines } from "../silk/geometry";

const SILK_LAYERS: readonly ["silkTop", "silkBottom"] = ["silkTop", "silkBottom"];
const mm = (nm: number): number => nm / NM_PER_MM;
const label = (layer: LayerId): string => `silkItems:${layer}`;

function drawItem(g: Graphics, item: SilkItem, color: number): void {
  if (item.kind === "rect" && item.filled) {
    const x = mm(Math.min(item.corner1.x, item.corner2.x));
    const y = mm(Math.min(item.corner1.y, item.corner2.y));
    g.rect(x, y, mm(Math.abs(item.corner2.x - item.corner1.x)), mm(Math.abs(item.corner2.y - item.corner1.y)));
    g.fill({ color, alpha: 0.9 });
    return;
  }
  if (item.kind === "circle" && item.filled) {
    g.circle(mm(item.center.x), mm(item.center.y), mm(item.radiusNm));
    g.fill({ color, alpha: 0.9 });
    return;
  }
  for (const line of silkItemPolylines(item)) {
    if (line.length < 2) continue;
    g.moveTo(mm(line[0].x), mm(line[0].y));
    for (let i = 1; i < line.length; i++) g.lineTo(mm(line[i].x), mm(line[i].y));
  }
  g.stroke({ width: mm(item.strokeWidthNm), color, alpha: 0.9, cap: "round", join: "round" });
}

export function renderSilkItems(
  board: PcbBoard,
  getLayer: (layer: LayerId) => Container,
): { items: number } {
  let count = 0;
  for (const layer of SILK_LAYERS) {
    const container = getLayer(layer);
    for (const child of [...container.children]) {
      if (child.label === label(layer)) {
        container.removeChild(child);
        child.destroy();
      }
    }
    const items = (board.silkItems ?? []).filter((s) => s.layer === layer);
    if (items.length === 0) continue;
    const g = new Graphics();
    g.label = label(layer);
    g.eventMode = "none";
    const color = layerColor(layer);
    for (const item of items) {
      drawItem(g, item, color);
      count++;
    }
    container.addChild(g);
  }
  return { items: count };
}
