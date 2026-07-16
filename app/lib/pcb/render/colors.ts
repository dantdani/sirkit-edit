// Render palette for the PCB canvas (PCB Stage 3). Layer colors come from
// Stage 1's canonical LAYERS table (layers.ts wins over any other list);
// everything else here is the dark zinc + teal app theme.

import { LAYERS, type LayerId, type LayerDef } from "../layers";

/** Canvas background — matches the app's dark zinc (#09090b). */
export const BACKGROUND_COLOR = 0x07090d;

export const GRID_MINOR_COLOR = 0x20242c;
export const GRID_MAJOR_COLOR = 0x343a46;
export const GRID_ORIGIN_COLOR = 0x64748b;

/** Teal accent: origin crosshair, hover, selection. */
export const ACCENT_COLOR = 0x14b8a6;
export const HOVER_ALPHA = 0.4;

/** Non-active copper layers dim to this alpha when an active layer is set. */
export const DIMMED_COPPER_ALPHA = 0.18;

export const LAYER_DEFS: ReadonlyMap<LayerId, LayerDef> = new Map(
  LAYERS.map((l) => [l.id, l]),
);

/** Layer color as a Pixi-friendly 0xRRGGBB number (from LAYERS defaultColor). */
export function layerColor(id: LayerId): number {
  const def = LAYER_DEFS.get(id);
  return def ? parseInt(def.defaultColor.slice(1), 16) : 0xffffff;
}

export function layerVisibleByDefault(id: LayerId): boolean {
  return LAYER_DEFS.get(id)?.defaultVisible ?? false;
}
