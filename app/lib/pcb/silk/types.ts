// Silkscreen items (PCB Stage 16) — PINNED model. First-class board data on
// `PcbBoard.silkItems` (optional/additive like netClassing — boards saved
// before Stage 16 load fine). Four primitives only: text, line, rect, circle.
// All coordinates integer nm.

import type { Vec2 } from "../geometry";

export type SilkLayer = "silkTop" | "silkBottom";

/** JLCPCB minimum silk stroke — the default for every new item. */
export const DEFAULT_SILK_STROKE_NM = 150_000; // 0.15 mm
/** Default text cap height. */
export const DEFAULT_SILK_TEXT_HEIGHT_NM = 1_000_000; // 1 mm

export interface SilkTextItem {
  kind: "text";
  id: string;
  layer: SilkLayer;
  position: Vec2; // anchor: vertical center of the cap-height band
  text: string; // ASCII for MVP; unknown chars render as '?'
  heightNm: number; // cap height, e.g. 1_000_000 = 1 mm
  strokeWidthNm: number;
  rotationDeg: number; // KiCad convention (CCW-positive, +y down), 0 default
  mirror: boolean; // reads correctly from the bottom side (silkBottom default)
  anchor: "left" | "center" | "right";
}

export interface SilkLineItem {
  kind: "line";
  id: string;
  layer: SilkLayer;
  from: Vec2;
  to: Vec2;
  strokeWidthNm: number;
}

export interface SilkRectItem {
  kind: "rect";
  id: string;
  layer: SilkLayer;
  corner1: Vec2;
  corner2: Vec2;
  strokeWidthNm: number;
  filled: boolean; // default false — outline only
}

export interface SilkCircleItem {
  kind: "circle";
  id: string;
  layer: SilkLayer;
  center: Vec2;
  radiusNm: number;
  strokeWidthNm: number;
  filled: boolean;
}

export type SilkItem = SilkTextItem | SilkLineItem | SilkRectItem | SilkCircleItem;
