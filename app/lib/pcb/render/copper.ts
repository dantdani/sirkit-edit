/**
 * Copper rendering (PCB Stage 6) — PINNED entry point, called from
 * `scene.setBoard` in the wave-end integration window.
 *
 * One batched Graphics per copper layer (plus one in `holes`), rebuilt whole
 * on every call — same full-rebuild pattern as Stage 3's footprint layers.
 * Tracks: stroked segments with round caps; vias: annulus on every spanned
 * copper layer + a hole punched in the `holes` container in the background
 * color; zones: 1-px outline + 15% alpha raw-polygon fill (UNFILLED until
 * Stage 11 — no thermals, no pours; the hatch was skipped, outline+fill is
 * the invariant). Selection/net-highlight states are Stage 7's problem.
 *
 * `getLayer` accepts the synthetic "holes" key in addition to real layers —
 * the scene's container table has always had it (drills already use it).
 */

import type { Container } from "pixi.js";
import { Graphics } from "pixi.js";
import type { PcbBoard } from "../types";
import type { LayerId } from "../layers";
import { COPPER_LAYERS } from "../layers";
import { NM_PER_MM } from "../units";
import { BACKGROUND_COLOR, layerColor } from "./colors";
import { viaSpannedLayers } from "../geometry-copper";

type CopperTarget = LayerId | "holes";

const mm = (nm: number): number => nm / NM_PER_MM;

const label = (target: CopperTarget): string => `copper:${target}`;

const ZONE_FILL_ALPHA = 0.15;
const ZONE_OUTLINE_ALPHA = 0.9;

export function renderCopper(
  board: PcbBoard,
  getLayer: (layer: CopperTarget) => Container,
): { primitives: number } {
  const targets: CopperTarget[] = [...COPPER_LAYERS, "holes"];

  // Rebuild whole: drop any Graphics from a previous renderCopper call.
  for (const target of targets) {
    const c = getLayer(target);
    for (const child of [...c.children]) {
      if (child.label === label(target)) {
        c.removeChild(child);
        child.destroy();
      }
    }
  }

  const graphics = new Map<CopperTarget, Graphics>();
  const gfx = (target: CopperTarget): Graphics => {
    let g = graphics.get(target);
    if (!g) {
      g = new Graphics();
      g.label = label(target);
      g.eventMode = "none";
      graphics.set(target, g);
      getLayer(target).addChild(g);
    }
    return g;
  };

  // Zones first so tracks/vias paint above the translucent fill.
  for (const zone of board.zones) {
    if (zone.polygon.length < 3) continue;
    const pts: number[] = [];
    for (const p of zone.polygon) pts.push(mm(p.x), mm(p.y));
    const color = layerColor(zone.layer);
    gfx(zone.layer)
      .poly(pts, true)
      .fill({ color, alpha: ZONE_FILL_ALPHA })
      .stroke({ width: 1, pixelLine: true, color, alpha: ZONE_OUTLINE_ALPHA });
  }

  for (const track of board.tracks) {
    gfx(track.layer)
      .moveTo(mm(track.start.x), mm(track.start.y))
      .lineTo(mm(track.end.x), mm(track.end.y))
      .stroke({
        width: mm(track.width),
        color: layerColor(track.layer),
        cap: "round",
        join: "round",
      });
  }

  for (const via of board.vias) {
    const xMm = mm(via.at.x);
    const yMm = mm(via.at.y);
    for (const layer of viaSpannedLayers(via)) {
      gfx(layer).circle(xMm, yMm, mm(via.size) / 2).fill(layerColor(layer));
    }
    gfx("holes").circle(xMm, yMm, mm(via.drill) / 2).fill(BACKGROUND_COLOR);
  }

  // Each track/via/zone counts once, however many layers show it — matches
  // the Stage 3 footprint-primitive convention so the HUD stays honest.
  return { primitives: board.tracks.length + board.vias.length + board.zones.length };
}
