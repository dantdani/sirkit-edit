// Text → world-space stroke polylines (PCB Stage 16).
//
// Pipeline (pinned): glyph lookup → scale to heightNm → advance cursor →
// anchor shift → mirror → rotate (KiCad CCW convention, +y down — the same
// formula as geometry.ts) → translate. The item's `position` anchors the
// VERTICAL CENTER of the cap-height band (matches KiCad's default vertical
// justification, so canvas and exported gr_text agree), with `anchor`
// picking the horizontal reference.

import type { Vec2 } from "../geometry";
import type { SilkTextItem } from "./types";
import { CAP_HEIGHT_UNITS, glyphFor, textAdvanceUnits } from "./stroke-font";

const DEG_TO_RAD = Math.PI / 180;

export function textToPolylines(item: SilkTextItem): Vec2[][] {
  const scale = item.heightNm / CAP_HEIGHT_UNITS;
  const totalWidth = textAdvanceUnits(item.text) * scale;
  const anchorShift =
    item.anchor === "center" ? -totalWidth / 2 : item.anchor === "right" ? -totalWidth : 0;

  const cos = Math.cos(item.rotationDeg * DEG_TO_RAD);
  const sin = Math.sin(item.rotationDeg * DEG_TO_RAD);

  /** Glyph-space point (x along the run from the anchor, y baseline-relative)
   *  → world nm. Baseline sits h/2 below the anchor (cap band centered). */
  const place = (x: number, y: number): Vec2 => {
    let px = x + anchorShift;
    const py = y + item.heightNm / 2;
    if (item.mirror) px = -px;
    return {
      x: Math.round(px * cos + py * sin + item.position.x),
      y: Math.round(-px * sin + py * cos + item.position.y),
    };
  };

  const out: Vec2[][] = [];
  let cursor = 0;
  for (const ch of item.text) {
    const glyph = glyphFor(ch);
    for (const stroke of glyph.s) {
      out.push(stroke.map(([gx, gy]) => place(cursor + gx * scale, gy * scale)));
    }
    cursor += glyph.a * scale;
  }
  return out;
}

/** Rendered width of the text in nm (anchor-independent). */
export function textWidthNm(item: Pick<SilkTextItem, "text" | "heightNm">): number {
  return Math.round(textAdvanceUnits(item.text) * (item.heightNm / CAP_HEIGHT_UNITS));
}
