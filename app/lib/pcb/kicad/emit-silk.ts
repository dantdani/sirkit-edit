// SilkItem → board-level KiCad graphics (PCB Stage 16), following Stage 13's
// per-item emit-* pattern. Text emits as (gr_text ...) — KiCad re-renders it
// with its own stroke font, which tracks our Hershey Simplex closely enough
// for silkscreen (both anchor the vertical center of the cap band).

import type { SilkItem, SilkTextItem } from "../silk/types";
import { KicadEmitError, q, sexpr } from "./sexpr-emit";
import { toKicadLayer } from "./layer-map";
import { nmToMm, formatDeg } from "./units";
import { newUuid } from "./types";

function at(x: number, y: number, deg = 0): string {
  return deg % 360 !== 0
    ? sexpr("at", nmToMm(x), nmToMm(y), formatDeg(deg))
    : sexpr("at", nmToMm(x), nmToMm(y));
}

function stroke(widthNm: number): string {
  return `(stroke (width ${nmToMm(widthNm)}) (type solid))`;
}

function fill(filled: boolean): string {
  return `(fill ${filled ? "solid" : "none"})`;
}

const SILK_ANCHORS: ReadonlySet<string> = new Set(["left", "center", "right"]);

function justify(item: SilkTextItem): string {
  // [B19-D I5c review, row 04] the anchor arrives in a posted board and was written into the file by hand: a value outside the
  // closed set could close the list and add nodes. Only the three anchors are written, through the validated token layer.
  if (typeof item.anchor !== "string" || !SILK_ANCHORS.has(item.anchor)) throw new KicadEmitError("silk text has an unknown anchor");
  const parts: string[] = [];
  if (item.anchor !== "center") parts.push(item.anchor);
  if (item.mirror === true) parts.push("mirror");
  return parts.length > 0 ? ` ${sexpr("justify", ...parts)}` : "";
}

export function emitSilkItem(item: SilkItem): string {
  const layer = `(layer ${q(toKicadLayer(item.layer))})`;
  const uuid = sexpr("uuid", q(newUuid()));
  switch (item.kind) {
    case "text": {
      const size = nmToMm(item.heightNm);
      const effects = `(effects (font (size ${size} ${size}) (thickness ${nmToMm(item.strokeWidthNm)}))${justify(item)})`;
      return `(gr_text ${q(item.text)} ${at(item.position.x, item.position.y, item.rotationDeg)} ${layer} ${uuid} ${effects})`;
    }
    case "line":
      return `(gr_line (start ${nmToMm(item.from.x)} ${nmToMm(item.from.y)}) (end ${nmToMm(item.to.x)} ${nmToMm(item.to.y)}) ${stroke(item.strokeWidthNm)} ${layer} ${uuid})`;
    case "rect":
      return `(gr_rect (start ${nmToMm(item.corner1.x)} ${nmToMm(item.corner1.y)}) (end ${nmToMm(item.corner2.x)} ${nmToMm(item.corner2.y)}) ${stroke(item.strokeWidthNm)} ${fill(item.filled)} ${layer} ${uuid})`;
    case "circle": {
      // KiCad specifies the radius via a point on the circumference.
      const ex = item.center.x + item.radiusNm;
      return `(gr_circle (center ${nmToMm(item.center.x)} ${nmToMm(item.center.y)}) (end ${nmToMm(ex)} ${nmToMm(item.center.y)}) ${stroke(item.strokeWidthNm)} ${fill(item.filled)} ${layer} ${uuid})`;
    }
  }
}
