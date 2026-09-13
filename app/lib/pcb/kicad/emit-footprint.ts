// Footprint emission (PCB Stage 13). Self-contained by design: every pad and
// graphic is emitted inline — no external .kicad_mod references.
//
// KiCad board-file coordinate quirks this encodes (matching pcbnew's writer):
//  * Child positions ((at ...) of pads/texts, fp_line points) are footprint-
//    LOCAL — KiCad rotates them by the footprint angle at load time.
//  * Child ANGLES are ABSOLUTE — the footprint angle is already added in.
//  * A back-side footprint stores the mirror baked into its local coords
//    (x → −x), flips every layer to the opposite side, and subtracts (rather
//    than adds) local rotations — exactly Stage 6's padWorldShape math.
// sirkit's rotationDeg is already KiCad-convention (CCW-positive, +y down);
// angles pass through unmodified, normalized to (-180, 180].

import type { FootprintInstance, Pad, FpGraphic, PcbBoard } from "../types";
import type { PcbNetlist } from "../netlist-bridge";
import type { Vec2 } from "../geometry";
import type { LayerId } from "../layers";
import { COPPER_LAYERS } from "../layers";
import { oppositeLayer, effectivePadLayers } from "../side";
import { block, q, sexpr, KicadEmitError } from "./sexpr-emit";
import { toKicadLayer } from "./layer-map";
import { nmToMm, formatDeg, mmToNm } from "./units";
import { newUuid } from "./types";
import { netTable, netNameOf } from "./emit-board";
import type { KicadNetRef } from "./types";

/** Anchor size for custom (polygon) pads — tiny, at the pad origin. */
const CUSTOM_ANCHOR = nmToMm(mmToNm(0.1));

interface EmitCtx {
  mirror: boolean; // bottom-side instance
  fpRot: number; // instance rotation (KiCad degrees)
  nets: readonly KicadNetRef[];
}

const mx = (ctx: EmitCtx, p: Vec2): Vec2 => (ctx.mirror ? { x: -p.x, y: p.y } : p);
const sideLayer = (ctx: EmitCtx, l: LayerId): string =>
  toKicadLayer(ctx.mirror ? oppositeLayer(l) : l);
/** Absolute child angle: footprint angle ± local angle (− when mirrored). */
const childDeg = (ctx: EmitCtx, localDeg: number): number =>
  ctx.mirror ? ctx.fpRot - localDeg : ctx.fpRot + localDeg;

function at(p: Vec2, deg: number): string {
  return deg % 360 !== 0
    ? sexpr("at", nmToMm(p.x), nmToMm(p.y), formatDeg(deg))
    : sexpr("at", nmToMm(p.x), nmToMm(p.y));
}

// ── Pads ─────────────────────────────────────────────────────────────────────

function padShapeToken(pad: Pad): string {
  switch (pad.shape.kind) {
    case "circle": return "circle";
    case "rect": return "rect";
    case "roundrect": return "roundrect";
    case "oval": return "oval";
    case "polygon": return "custom";
  }
  // [B19-D I5c row 04] an unknown shape is refused, never written
  throw new KicadEmitError(`pad "${String(pad.number)}": unknown pad shape`);
}

const PAD_TYPES = new Set(["smd", "thru_hole", "np_thru_hole", "connect"]);

/** [B19-D I5c row 04] A pad type from the parser's own vocabulary only. */
function padTypeToken(pad: Pad): string {
  if (typeof pad.type !== "string" || !PAD_TYPES.has(pad.type)) throw new KicadEmitError(`pad "${String(pad.number)}": unknown pad type`);
  return pad.type;
}

/** [B19-D I5c row 04] A net id is a non-negative safe integer. */
function netIdToken(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new KicadEmitError("a net id is not a non-negative integer");
  return value;
}

function padSize(pad: Pad): string {
  const s = pad.shape;
  switch (s.kind) {
    case "circle": {
      const d = nmToMm(s.radius * 2);
      return sexpr("size", d, d);
    }
    case "rect":
    case "roundrect":
    case "oval":
      return sexpr("size", nmToMm(s.width), nmToMm(s.height));
    case "polygon":
      // Custom pads still need a nonzero anchor size; the copper is the
      // gr_poly primitive below.
      return sexpr("size", CUSTOM_ANCHOR, CUSTOM_ANCHOR);
  }
}

function padDrill(pad: Pad): string | null {
  const d = pad.drill;
  if (!d) return null;
  const oval = d.width !== undefined && d.height !== undefined && d.width !== d.height;
  const dims = oval
    ? `oval ${nmToMm(d.width ?? d.diameter)} ${nmToMm(d.height ?? d.diameter)}`
    : nmToMm(d.diameter);
  const offset = d.offset ? ` (offset ${nmToMm(d.offset.x)} ${nmToMm(d.offset.y)})` : "";
  return `(drill ${dims}${offset})`;
}

function padExtras(ctx: EmitCtx, pad: Pad): string[] {
  const s = pad.shape;
  if (s.kind === "roundrect") {
    const ratio = Math.min(0.5, s.cornerRadius / Math.min(s.width, s.height));
    return [sexpr("roundrect_rratio", ratio.toFixed(6))];
  }
  if (s.kind === "polygon") {
    const pts = s.points
      .map(({ x, y }) => (ctx.mirror ? { x: -x, y } : { x, y }))
      .map((p) => `(xy ${nmToMm(p.x)} ${nmToMm(p.y)})`)
      .join(" ");
    return [
      `(options (clearance outline) (anchor circle))`,
      block("primitives", [`(gr_poly (pts ${pts}) (width 0) (fill yes))`]),
    ];
  }
  return [];
}

/** Pad layer list, collapsing a full copper span to KiCad's `*.Cu` wildcard —
 * matches pcbnew's own THT output and never names inner layers a 2-layer
 * board doesn't enable. */
function padLayerList(pad: Pad, side: "top" | "bottom"): string {
  const layers = effectivePadLayers(pad, side);
  const allCopper = COPPER_LAYERS.every((c) => layers.includes(c));
  const rest = allCopper ? layers.filter((l) => !COPPER_LAYERS.includes(l)) : layers;
  return [...(allCopper ? [q("*.Cu")] : []), ...rest.map((l) => q(toKicadLayer(l)))].join(" ");
}

function emitPad(ctx: EmitCtx, inst: FootprintInstance, pad: Pad): string {
  const layers = padLayerList(pad, inst.side);
  const netId = netIdToken(inst.padNets[pad.number] ?? 0);
  const net = netId !== 0 ? sexpr("net", netId, q(netNameOf(ctx.nets, netId))) : null;
  return block(`pad ${q(String(pad.number))} ${padTypeToken(pad)} ${padShapeToken(pad)}`, [
    at(mx(ctx, pad.at), childDeg(ctx, pad.rotationDeg)),
    padSize(pad),
    padDrill(pad),
    `(layers ${layers})`,
    ...padExtras(ctx, pad),
    net,
    sexpr("uuid", q(newUuid())),
  ]);
}

// ── Graphics ─────────────────────────────────────────────────────────────────

function stroke(widthNm: number): string {
  return `(stroke (width ${nmToMm(widthNm)}) (type solid))`;
}

function xy(ctx: EmitCtx, p: Vec2): string {
  const m = mx(ctx, p);
  return `${nmToMm(m.x)} ${nmToMm(m.y)}`;
}

function fontEffects(g: Extract<FpGraphic, { kind: "text" }>, layerName: string): string {
  const justify = layerName.startsWith("B.") ? " (justify mirror)" : "";
  return `(effects (font (size ${nmToMm(g.sizeX)} ${nmToMm(g.sizeY)}) (thickness ${nmToMm(g.thickness)}))${justify})`;
}

function emitGraphic(ctx: EmitCtx, g: FpGraphic): string | null {
  const uuid = sexpr("uuid", q(newUuid()));
  switch (g.kind) {
    case "line": {
      const layer = `(layer ${q(sideLayer(ctx, g.layer))})`;
      return `(fp_line (start ${xy(ctx, g.start)}) (end ${xy(ctx, g.end)}) ${stroke(g.width)} ${layer} ${uuid})`;
    }
    case "arc": {
      const layer = `(layer ${q(sideLayer(ctx, g.layer))})`;
      return `(fp_arc (start ${xy(ctx, g.start)}) (mid ${xy(ctx, g.mid)}) (end ${xy(ctx, g.end)}) ${stroke(g.width)} ${layer} ${uuid})`;
    }
    case "circle": {
      const layer = `(layer ${q(sideLayer(ctx, g.layer))})`;
      return `(fp_circle (center ${xy(ctx, g.center)}) (end ${xy(ctx, g.end)}) ${stroke(g.width)} (fill ${g.fill ? "solid" : "none"}) ${layer} ${uuid})`;
    }
    case "rect": {
      const layer = `(layer ${q(sideLayer(ctx, g.layer))})`;
      return `(fp_rect (start ${xy(ctx, g.start)}) (end ${xy(ctx, g.end)}) ${stroke(g.width)} (fill ${g.fill ? "solid" : "none"}) ${layer} ${uuid})`;
    }
    case "poly": {
      if (g.points.length < 3) return null;
      const layer = `(layer ${q(sideLayer(ctx, g.layer))})`;
      const pts = g.points.map((p) => `(xy ${xy(ctx, p)})`).join(" ");
      return `(fp_poly (pts ${pts}) ${stroke(g.width)} (fill ${g.fill ? "solid" : "none"}) ${layer} ${uuid})`;
    }
    case "text": {
      // Reference/Value are emitted as (property ...) blocks, not fp_text.
      if (g.textKind !== "user") return null;
      const layerName = sideLayer(ctx, g.layer);
      return `(fp_text user ${q(g.text)} ${at(mx(ctx, g.at), childDeg(ctx, g.rotationDeg))} (layer ${q(layerName)}) ${uuid} ${fontEffects(g, layerName)})`;
    }
  }
}

// ── Reference / Value properties ─────────────────────────────────────────────

type TextGraphic = Extract<FpGraphic, { kind: "text" }>;

const FALLBACK_TEXT: Omit<TextGraphic, "text" | "textKind" | "layer"> = {
  kind: "text",
  at: { x: 0, y: 0 },
  rotationDeg: 0,
  sizeX: mmToNm(1),
  sizeY: mmToNm(1),
  thickness: mmToNm(0.15),
};

function emitProperty(ctx: EmitCtx, key: "Reference" | "Value", value: string, src: TextGraphic | undefined, fallbackLayer: LayerId): string {
  const g: TextGraphic = src ?? { ...FALLBACK_TEXT, text: value, textKind: "user", layer: fallbackLayer };
  const layerName = sideLayer(ctx, g.layer);
  return block(`property ${q(key)} ${q(value)}`, [
    at(mx(ctx, g.at), childDeg(ctx, g.rotationDeg)),
    `(layer ${q(layerName)})`,
    sexpr("uuid", q(newUuid())),
    fontEffects(g, layerName),
  ]);
}

// ── Entry point ──────────────────────────────────────────────────────────────

export function emitFootprint(
  inst: FootprintInstance,
  board: PcbBoard,
  netlist: PcbNetlist,
): string {
  const ctx: EmitCtx = {
    mirror: inst.side === "bottom",
    fpRot: inst.rotationDeg,
    nets: netTable(board, netlist),
  };
  const def = inst.def;

  const attrs: string[] = [];
  if (def.attributes.smd) attrs.push("smd");
  if (def.attributes.throughHole) attrs.push("through_hole");
  if (def.attributes.excludeFromPos) attrs.push("exclude_from_pos_files");
  if (def.attributes.excludeFromBom) attrs.push("exclude_from_bom");

  const refText = def.graphics.find(
    (g): g is TextGraphic => g.kind === "text" && g.textKind === "reference",
  );
  const valueText = def.graphics.find(
    (g): g is TextGraphic => g.kind === "text" && g.textKind === "value",
  );

  return block(`footprint ${q(`${def.libName}:${def.name}`)}`, [
    `(layer ${q(inst.side === "bottom" ? "B.Cu" : "F.Cu")})`,
    sexpr("uuid", q(newUuid())),
    at(inst.at, inst.rotationDeg),
    def.description !== undefined ? sexpr("descr", q(def.description)) : null,
    def.tags !== undefined ? sexpr("tags", q(def.tags)) : null,
    attrs.length > 0 ? `(attr ${attrs.join(" ")})` : null,
    emitProperty(ctx, "Reference", inst.ref, refText, "silkTop"),
    emitProperty(ctx, "Value", valueText?.text ?? def.name, valueText, "fabTop"),
    ...def.graphics.map((g) => emitGraphic(ctx, g)),
    ...def.pads.map((p) => emitPad(ctx, inst, p)),
  ]);
}
