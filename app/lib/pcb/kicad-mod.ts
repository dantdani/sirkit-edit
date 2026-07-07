// .kicad_mod footprint parser (KiCad 10 format; tolerates KiCad 6–9 files).
//
// Philosophy: parse failures on real library files are exceptional; per-item
// fallbacks are the norm. Items on unknown layers are dropped (and counted),
// custom/trapezoid pads fall back to their bounding rect (and are counted),
// unknown node types are ignored — the verbatim source is kept in
// `FootprintDef.rawSexpr`, so nothing is ever lost for re-emission.

import { mmToNm } from "./units";
import type { Nm } from "./units";
import type { Vec2, BBox, PadShape, PlacedShape } from "./geometry";
import { shapeBBox, bboxUnion } from "./geometry";
import type { LayerId } from "./layers";
import { layerFromKicadName, COPPER_LAYERS } from "./layers";
import { parseSexpr, child, children, str, SexprError } from "./sexpr";
import type { SList } from "./sexpr";
import type { Pad, PadType, FpGraphic, FootprintDef, FootprintModelRef } from "./types";

// ── Small node readers ──────────────────────────────────────────────────────

function numAt(list: SList, index: number, fallback: number): number {
  const item = list.items[index];
  return item && item.kind === "number" ? item.value : fallback;
}

function vec2Of(list: SList): Vec2 {
  return { x: mmToNm(numAt(list, 1, 0)), y: mmToNm(numAt(list, 2, 0)) };
}

function pointChild(node: SList, name: string): Vec2 | undefined {
  const c = child(node, name);
  return c ? vec2Of(c) : undefined;
}

/** `(at x y [rot])` → position + rotation. */
function atOf(node: SList): { at: Vec2; rotationDeg: number } {
  const c = child(node, "at");
  if (!c) return { at: { x: 0, y: 0 }, rotationDeg: 0 };
  return { at: vec2Of(c), rotationDeg: numAt(c, 3, 0) };
}

/** Stroke width: KiCad ≥6 `(stroke (width w))`, legacy `(width w)`. */
function strokeWidthOf(node: SList): Nm {
  const stroke = child(node, "stroke");
  if (stroke) {
    const w = child(stroke, "width");
    if (w) return mmToNm(numAt(w, 1, 0));
  }
  const legacy = child(node, "width");
  if (legacy) return mmToNm(numAt(legacy, 1, 0));
  return 0;
}

/** `(fill yes|no|solid|none)` → boolean. */
function fillOf(node: SList): boolean {
  const f = child(node, "fill");
  if (!f) return false;
  const v = f.items[1];
  if (!v || (v.kind !== "symbol" && v.kind !== "string")) return false;
  return v.value === "yes" || v.value === "solid";
}

function layerNameOf(node: SList): string | undefined {
  const l = child(node, "layer");
  if (!l) return undefined;
  const v = l.items[1];
  if (!v || (v.kind !== "symbol" && v.kind !== "string")) return undefined;
  return v.value;
}

/** `(pts (xy x y) ...)` → points. */
function ptsOf(node: SList): Vec2[] {
  const pts = child(node, "pts");
  if (!pts) return [];
  return children(pts, "xy").map(vec2Of);
}

/** `(effects (font (size sx sy) (thickness t)))` with KiCad defaults. */
function fontOf(node: SList): { sizeX: Nm; sizeY: Nm; thickness: Nm } {
  const effects = child(node, "effects");
  const font = effects ? child(effects, "font") : undefined;
  const size = font ? child(font, "size") : undefined;
  const thickness = font ? child(font, "thickness") : undefined;
  return {
    sizeX: size ? mmToNm(numAt(size, 1, 1)) : mmToNm(1),
    sizeY: size ? mmToNm(numAt(size, 2, 1)) : mmToNm(1),
    thickness: thickness ? mmToNm(numAt(thickness, 1, 0.15)) : mmToNm(0.15),
  };
}

// ── Pad layer wildcard expansion ─────────────────────────────────────────────

const LAYER_WILDCARDS: Record<string, readonly LayerId[]> = {
  "*.Cu": COPPER_LAYERS,
  "F&B.Cu": ["copperTop", "copperBottom"],
  "*.Mask": ["maskTop", "maskBottom"],
  "*.Paste": ["pasteTop", "pasteBottom"],
  "*.SilkS": ["silkTop", "silkBottom"],
};

function expandPadLayers(padNode: SList, warnings: string[]): LayerId[] {
  const layersNode = child(padNode, "layers");
  if (!layersNode) return [];
  const out: LayerId[] = [];
  for (let i = 1; i < layersNode.items.length; i++) {
    const item = layersNode.items[i];
    if (item.kind !== "string" && item.kind !== "symbol") continue;
    const name = item.value;
    const wild = LAYER_WILDCARDS[name];
    if (wild) {
      for (const id of wild) if (!out.includes(id)) out.push(id);
      continue;
    }
    const id = layerFromKicadName(name);
    if (id) {
      if (!out.includes(id)) out.push(id);
    } else {
      warnings.push(`pad layer dropped: unknown layer "${name}"`);
    }
  }
  return out;
}

// ── Pads ─────────────────────────────────────────────────────────────────────

function parsePad(padNode: SList, warnings: string[]): Pad {
  const number = padNode.items[1] && (padNode.items[1].kind === "string" || padNode.items[1].kind === "symbol" || padNode.items[1].kind === "number")
    ? String(padNode.items[1].kind === "number" ? padNode.items[1].raw : padNode.items[1].value)
    : "";
  const rawType = str(padNode, 2);
  let type: PadType;
  if (rawType === "smd" || rawType === "thru_hole" || rawType === "np_thru_hole") {
    type = rawType;
  } else {
    // e.g. 'connect' (edge-connector pads): treat as smd.
    type = "smd";
    warnings.push(`pad "${number}": unknown pad type "${rawType}", treated as smd`);
  }

  const shapeToken = str(padNode, 3);
  const sizeNode = child(padNode, "size");
  const width = sizeNode ? mmToNm(numAt(sizeNode, 1, 0)) : 0;
  const height = sizeNode ? mmToNm(numAt(sizeNode, 2, 0)) : 0;

  let shape: PadShape;
  switch (shapeToken) {
    case "circle":
      shape = { kind: "circle", radius: Math.round(width / 2) };
      break;
    case "rect":
      shape = { kind: "rect", width, height };
      break;
    case "oval":
      shape = { kind: "oval", width, height };
      break;
    case "roundrect": {
      const rratioNode = child(padNode, "roundrect_rratio");
      const rratio = rratioNode ? numAt(rratioNode, 1, 0.25) : 0.25; // KiCad default
      shape = {
        kind: "roundrect",
        width,
        height,
        cornerRadius: Math.round(rratio * Math.min(width, height)),
      };
      break;
    }
    case "trapezoid":
    case "custom":
      // Post-MVP carve-out: fall back to the bounding rect of the anchor size.
      shape = { kind: "rect", width, height };
      warnings.push(`pad "${number}": ${shapeToken} shape approximated by bounding rect`);
      break;
    default:
      shape = { kind: "rect", width, height };
      warnings.push(`pad "${number}": unknown pad shape "${shapeToken}", using bounding rect`);
      break;
  }

  const { at, rotationDeg } = atOf(padNode);

  let drill: Pad["drill"];
  const drillNode = child(padNode, "drill");
  if (drillNode) {
    let oval = false;
    const dims: number[] = [];
    let offset: Vec2 | undefined;
    for (let i = 1; i < drillNode.items.length; i++) {
      const item = drillNode.items[i];
      if (item.kind === "symbol" && item.value === "oval") oval = true;
      else if (item.kind === "number") dims.push(item.value);
      else if (item.kind === "list") {
        const head = item.items[0];
        if (head && head.kind === "symbol" && head.value === "offset") {
          offset = vec2Of(item);
        }
      }
    }
    if (oval) {
      const w = mmToNm(dims[0] ?? 0);
      const h = mmToNm(dims[1] ?? dims[0] ?? 0);
      drill = { diameter: Math.min(w, h), width: w, height: h };
    } else {
      drill = { diameter: mmToNm(dims[0] ?? 0) };
    }
    if (offset) drill.offset = offset;
  }

  const pad: Pad = {
    number,
    type,
    shape,
    at,
    rotationDeg,
    layers: expandPadLayers(padNode, warnings),
  };
  if (drill) pad.drill = drill;
  return pad;
}

// ── Graphics ─────────────────────────────────────────────────────────────────

function resolveLayer(node: SList, what: string, warnings: string[]): LayerId | undefined {
  const name = layerNameOf(node);
  const id = name !== undefined ? layerFromKicadName(name) : undefined;
  if (id === undefined) {
    warnings.push(`${what} dropped: unmapped layer "${name ?? "(missing)"}"`);
  }
  return id;
}

function parseGraphic(node: SList, head: string, warnings: string[]): FpGraphic | undefined {
  switch (head) {
    case "fp_line": {
      const layer = resolveLayer(node, "fp_line", warnings);
      if (!layer) return undefined;
      return {
        kind: "line",
        start: pointChild(node, "start") ?? { x: 0, y: 0 },
        end: pointChild(node, "end") ?? { x: 0, y: 0 },
        width: strokeWidthOf(node),
        layer,
      };
    }
    case "fp_arc": {
      const layer = resolveLayer(node, "fp_arc", warnings);
      if (!layer) return undefined;
      return {
        kind: "arc",
        start: pointChild(node, "start") ?? { x: 0, y: 0 },
        mid: pointChild(node, "mid") ?? { x: 0, y: 0 },
        end: pointChild(node, "end") ?? { x: 0, y: 0 },
        width: strokeWidthOf(node),
        layer,
      };
    }
    case "fp_circle": {
      const layer = resolveLayer(node, "fp_circle", warnings);
      if (!layer) return undefined;
      return {
        kind: "circle",
        center: pointChild(node, "center") ?? { x: 0, y: 0 },
        end: pointChild(node, "end") ?? { x: 0, y: 0 },
        width: strokeWidthOf(node),
        fill: fillOf(node),
        layer,
      };
    }
    case "fp_rect": {
      const layer = resolveLayer(node, "fp_rect", warnings);
      if (!layer) return undefined;
      return {
        kind: "rect",
        start: pointChild(node, "start") ?? { x: 0, y: 0 },
        end: pointChild(node, "end") ?? { x: 0, y: 0 },
        width: strokeWidthOf(node),
        fill: fillOf(node),
        layer,
      };
    }
    case "fp_poly": {
      const layer = resolveLayer(node, "fp_poly", warnings);
      if (!layer) return undefined;
      return {
        kind: "poly",
        points: ptsOf(node),
        width: strokeWidthOf(node),
        fill: fillOf(node),
        layer,
      };
    }
    default:
      return undefined;
  }
}

/** Legacy `(fp_text reference|value|user "text" ...)` (KiCad ≤7). */
function parseFpText(node: SList, warnings: string[]): FpGraphic | undefined {
  const kindToken = str(node, 1);
  const textKind =
    kindToken === "reference" ? "reference" :
    kindToken === "value" ? "value" : "user";
  const layer = resolveLayer(node, "fp_text", warnings);
  if (!layer) return undefined;
  const { at, rotationDeg } = atOf(node);
  const font = fontOf(node);
  return {
    kind: "text",
    text: str(node, 2),
    at,
    rotationDeg,
    ...font,
    layer,
    textKind,
  };
}

/** KiCad ≥8 `(property "Reference"|"Value" "text" ...)` nodes. Other
 * properties (Footprint, Datasheet, generator metadata, …) are footprint
 * metadata, not drawn text — skipped silently. */
function parseProperty(node: SList, warnings: string[]): FpGraphic | undefined {
  const key = str(node, 1);
  const textKind =
    key === "Reference" ? ("reference" as const) :
    key === "Value" ? ("value" as const) : undefined;
  if (!textKind) return undefined;
  const layer = resolveLayer(node, `property "${key}"`, warnings);
  if (!layer) return undefined;
  const { at, rotationDeg } = atOf(node);
  const font = fontOf(node);
  return {
    kind: "text",
    text: str(node, 2),
    at,
    rotationDeg,
    ...font,
    layer,
    textKind,
  };
}

// ── Models ───────────────────────────────────────────────────────────────────

function xyzOf(node: SList, name: string): [number, number, number] | undefined {
  const outer = child(node, name);
  const xyz = outer ? child(outer, "xyz") : undefined;
  if (!xyz) return undefined;
  return [numAt(xyz, 1, 0), numAt(xyz, 2, 0), numAt(xyz, 3, 0)];
}

function parseModel(node: SList): FootprintModelRef {
  const ref: FootprintModelRef = { path: str(node, 1) };
  const offset = xyzOf(node, "offset");
  const scale = xyzOf(node, "scale");
  const rotate = xyzOf(node, "rotate");
  if (offset) ref.offset = offset;
  if (scale) ref.scale = scale;
  if (rotate) ref.rotate = rotate;
  return ref;
}

// ── Bounding boxes ───────────────────────────────────────────────────────────

/** Geometric bbox of a non-text graphic, inflated by half its stroke width.
 * Arc bbox uses the three defining points (slight undershoot possible on
 * bulgy arcs — acceptable for courtyard/body estimates, documented). Text is
 * excluded everywhere: stroke-font metrics are a post-MVP carve-out. */
function graphicBBox(g: FpGraphic): BBox | undefined {
  const half = Math.ceil(g.kind === "text" ? 0 : g.width / 2);
  const fromPoints = (pts: Vec2[]): BBox | undefined => {
    if (pts.length === 0) return undefined;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { minX: minX - half, minY: minY - half, maxX: maxX + half, maxY: maxY + half };
  };
  switch (g.kind) {
    case "line": return fromPoints([g.start, g.end]);
    case "arc": return fromPoints([g.start, g.mid, g.end]);
    case "rect": return fromPoints([g.start, g.end]);
    case "poly": return fromPoints(g.points);
    case "circle": {
      const r = Math.ceil(Math.hypot(g.end.x - g.center.x, g.end.y - g.center.y));
      return {
        minX: g.center.x - r - half,
        minY: g.center.y - r - half,
        maxX: g.center.x + r + half,
        maxY: g.center.y + r + half,
      };
    }
    case "text": return undefined;
  }
}

function padPlacedShape(pad: Pad): PlacedShape {
  return { shape: pad.shape, at: pad.at, rotationDeg: pad.rotationDeg };
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Parse a `.kicad_mod` file. Throws SexprError only on malformed
 * S-expressions or a non-footprint root; item-level oddities degrade to
 * fallbacks and are appended to the optional `warnings` out-param (Stage 2's
 * ingester reports them).
 */
export function parseKicadMod(
  source: string,
  libName: string,
  warnings: string[] = [],
): FootprintDef {
  const root = parseSexpr(source);
  const head = root.items[0];
  if (!head || head.kind !== "symbol" || (head.value !== "footprint" && head.value !== "module")) {
    throw new SexprError("Not a footprint file (expected (footprint ...))", 1, 1);
  }

  const name = str(root, 1);
  const descrNode = child(root, "descr");
  const tagsNode = child(root, "tags");

  const attributes = {
    smd: false,
    throughHole: false,
    excludeFromPos: false,
    excludeFromBom: false,
  };
  for (const attrNode of children(root, "attr")) {
    for (let i = 1; i < attrNode.items.length; i++) {
      const item = attrNode.items[i];
      if (item.kind !== "symbol") continue;
      switch (item.value) {
        case "smd": attributes.smd = true; break;
        case "through_hole": attributes.throughHole = true; break;
        case "exclude_from_pos_files": attributes.excludeFromPos = true; break;
        case "exclude_from_bom": attributes.excludeFromBom = true; break;
        default: break; // board_only, allow_missing_courtyard, … — irrelevant here
      }
    }
  }

  const pads: Pad[] = [];
  const graphics: FpGraphic[] = [];
  const models: FootprintModelRef[] = [];

  for (const item of root.items) {
    if (item.kind !== "list") continue;
    const h = item.items[0];
    if (!h || h.kind !== "symbol") continue;
    switch (h.value) {
      case "pad":
        pads.push(parsePad(item, warnings));
        break;
      case "fp_text": {
        const g = parseFpText(item, warnings);
        if (g) graphics.push(g);
        break;
      }
      case "property": {
        const g = parseProperty(item, warnings);
        if (g) graphics.push(g);
        break;
      }
      case "model":
        models.push(parseModel(item));
        break;
      case "fp_line":
      case "fp_arc":
      case "fp_circle":
      case "fp_rect":
      case "fp_poly": {
        const g = parseGraphic(item, h.value, warnings);
        if (g) graphics.push(g);
        break;
      }
      default:
        break; // unknown node types are ignored; rawSexpr keeps them
    }
  }

  // Courtyard bbox from courtyard-layer graphics.
  let courtyardBBox: BBox | undefined;
  for (const g of graphics) {
    if (g.layer !== "courtyardTop" && g.layer !== "courtyardBottom") continue;
    const bb = graphicBBox(g);
    if (bb) courtyardBBox = courtyardBBox ? bboxUnion(courtyardBBox, bb) : bb;
  }

  // Body bbox: pads + silk + fab graphics (text excluded — no font metrics).
  let bodyBBox: BBox | undefined;
  for (const pad of pads) {
    const bb = shapeBBox(padPlacedShape(pad));
    bodyBBox = bodyBBox ? bboxUnion(bodyBBox, bb) : bb;
  }
  for (const g of graphics) {
    if (g.layer !== "silkTop" && g.layer !== "silkBottom" && g.layer !== "fabTop" && g.layer !== "fabBottom") continue;
    const bb = graphicBBox(g);
    if (bb) bodyBBox = bodyBBox ? bboxUnion(bodyBBox, bb) : bb;
  }

  const def: FootprintDef = {
    libName,
    name,
    attributes,
    pads,
    graphics,
    bodyBBox: bodyBBox ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    models,
    rawSexpr: source,
  };
  if (descrNode) def.description = str(descrNode, 1);
  if (tagsNode) def.tags = str(tagsNode, 1);
  if (courtyardBBox) def.courtyardBBox = courtyardBBox;
  return def;
}
