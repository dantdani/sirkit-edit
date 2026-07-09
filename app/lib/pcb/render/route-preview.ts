/**
 * Interactive-routing preview overlay (PCB Stage 7) — the only Pixi surface of
 * the routing tool. Draws the in-progress trace as a dashed stroke on the
 * overlay container: the layer's normal copper color at 60% for a legal
 * preview, red with a wide translucent halo for an illegal one. Committed
 * copper is NOT drawn here — it goes through Stage 6's `renderCopper` on the
 * next `setBoard`; this overlay is cleared whenever the tool is idle.
 *
 * The tooltip text is computed by the tool (it owns the board + net names) and
 * emitted on the overlay container as `routeTooltip` → `{ text: string | null }`;
 * the toolbar/HUD listens and renders the chip. The renderer owns no DOM.
 */

import { Container, Graphics } from "pixi.js";
import type { Vec2 } from "../geometry";
import type { LayerId } from "../layers";
import { NM_PER_MM } from "../units";
import { layerColor } from "./colors";
import { DEFAULT_CLEARANCE, type RouteToolState } from "../route-tool";

const ILLEGAL_COLOR = 0xef4444;
const LEGAL_ALPHA = 0.6;
const ILLEGAL_ALPHA = 0.8;
const HALO_ALPHA = 0.15;
const DASH_ON_MM = 0.4;
const DASH_OFF_MM = 0.3;
const PREVIEW_LABEL = "route-preview";

const mm = (nm: number): number => nm / NM_PER_MM;

function previewGraphics(overlay: Container): Graphics {
  for (const child of overlay.children) {
    if (child.label === PREVIEW_LABEL) return child as Graphics;
  }
  const g = new Graphics();
  g.label = PREVIEW_LABEL;
  g.eventMode = "none";
  overlay.addChild(g);
  return g;
}

function emitTooltip(overlay: Container, text: string | null): void {
  overlay.emit("routeTooltip", { text });
}

/** Dashed polyline through `pts` (world nm), one stroke pass. Skips zero-length. */
function dashedPath(g: Graphics, pts: Vec2[], widthMm: number, color: number, alpha: number): void {
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const x0 = mm(a.x);
    const y0 = mm(a.y);
    const x1 = mm(b.x);
    const y1 = mm(b.y);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    const ux = dx / len;
    const uy = dy / len;
    for (let d = 0; d < len; d += DASH_ON_MM + DASH_OFF_MM) {
      const s = d;
      const e = Math.min(d + DASH_ON_MM, len);
      g.moveTo(x0 + ux * s, y0 + uy * s).lineTo(x0 + ux * e, y0 + uy * e);
    }
  }
  g.stroke({ width: widthMm, color, alpha, cap: "round", join: "round" });
}

/** Solid wide translucent halo along `pts` — makes an illegal collision obvious. */
function halo(g: Graphics, pts: Vec2[], widthMm: number): void {
  for (let i = 0; i + 1 < pts.length; i++) {
    if (pts[i].x === pts[i + 1].x && pts[i].y === pts[i + 1].y) continue;
    g.moveTo(mm(pts[i].x), mm(pts[i].y)).lineTo(mm(pts[i + 1].x), mm(pts[i + 1].y));
  }
  g.stroke({ width: widthMm, color: ILLEGAL_COLOR, alpha: HALO_ALPHA, cap: "round", join: "round" });
}

export function renderRoutePreview(
  toolState: RouteToolState,
  _getLayer: (layer: LayerId) => Container,
  overlayContainer: Container,
): void {
  const g = previewGraphics(overlayContainer);
  g.clear();

  if (toolState.kind === "idle") {
    emitTooltip(overlayContainer, null);
    return;
  }

  if (toolState.kind === "routing") {
    const { activeLayer, trackWidth, clearance, anchor, preview } = toolState;
    const pts = [anchor, preview.corner, preview.end];
    if (!preview.legal) halo(g, pts, mm(trackWidth + 2 * clearance));
    const color = preview.legal ? layerColor(activeLayer) : ILLEGAL_COLOR;
    const alpha = preview.legal ? LEGAL_ALPHA : ILLEGAL_ALPHA;
    dashedPath(g, pts, mm(trackWidth), color, alpha);
    emitTooltip(overlayContainer, preview.legal ? null : preview.blockedText ?? "Clearance violation");
    return;
  }

  // stretching
  const { segments, preview } = toolState;
  const layer = segments[0]?.layer ?? "copperTop";
  const color = preview.legal ? layerColor(layer) : ILLEGAL_COLOR;
  const alpha = preview.legal ? LEGAL_ALPHA : ILLEGAL_ALPHA;
  for (const s of segments) {
    if (!preview.legal) halo(g, [s.start, s.end], mm(s.width + 2 * DEFAULT_CLEARANCE));
    dashedPath(g, [s.start, s.end], mm(s.width), color, alpha);
  }
  emitTooltip(overlayContainer, preview.legal ? null : preview.blockedText ?? "Clearance violation");
}
