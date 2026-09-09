import type { PadShape, Vec2 } from "../../geometry";
import { sha256, stableJson } from "./stable";
import type {
  ManufacturingIr,
  ManufacturingSnapshot,
  MirApertureFunction,
  MirFlash,
  MirLayer,
  MirObjectAttributes,
  MirPrimitive,
} from "./types";

interface ApertureSpec {
  key: string;
  code: number;
  template: string;
  modifiers: string;
  function: MirApertureFunction;
  macro?: { name: string; body: string };
}

export interface GerberWriteResult {
  text: string;
  apertureCount: number;
  objectCount: number;
}

const nmMm = (nm: number): string => {
  const value = nm / 1_000_000;
  const text = value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return text === "-0" || text === "" ? "0" : text;
};

const coord = (nm: number): string => String(Math.round(nm) + 0);
const xy = (point: Vec2): string => `X${coord(point.x)}Y${coord(point.y)}`;
const cleanField = (value: string): string => value.replace(/[%*,\r\n]/g, "_").slice(0, 120);

function normalizedRotation(deg: number): number {
  const value = ((deg % 360) + 360) % 360;
  return Math.abs(value - 360) < 1e-9 ? 0 : value;
}

function primitiveApertureKey(primitive: MirPrimitive): string {
  if (primitive.kind === "stroke") {
    return `${primitive.apertureFunction}|C|${Math.round(primitive.widthNm)}`;
  }
  if (primitive.kind === "region") {
    return `${primitive.apertureFunction}|C|1000|REGION`;
  }
  return `${primitive.apertureFunction}|${shapeKey(primitive.shape, primitive.rotationDeg)}`;
}

// [B16-C.4 finding] the key MUST be canonical: a raw JSON.stringify depends on the
// pad shape's property order, which differs between an in-process board and one
// that round-tripped through sorted-key JSON (the recorded route fixture) or
// PostgreSQL jsonb. Every content digest (stableJson) treated those boards as
// identical while the aperture codes and macro names — and so the released
// copper bytes — diverged. Reproduced by b16-c-gerber-aperture-key.test.ts.
function shapeKey(shape: PadShape, rotationDeg: number): string {
  return `${shape.kind}|${normalizedRotation(rotationDeg)}|${stableJson(shape)}`;
}

function rectMacro(shape: Extract<PadShape, { kind: "rect" }>, rotation: number): string {
  return `21,1,${nmMm(shape.width)},${nmMm(shape.height)},0,0,${rotation}`;
}

function ovalMacro(shape: Extract<PadShape, { kind: "oval" }>, rotation: number): string {
  const diameter = Math.min(shape.width, shape.height);
  const run = Math.max(shape.width, shape.height) - diameter;
  const a = -run / 2;
  const b = run / 2;
  return shape.width >= shape.height
    ? `20,1,${nmMm(diameter)},${nmMm(a)},0,${nmMm(b)},0,${rotation}`
    : `20,1,${nmMm(diameter)},0,${nmMm(a)},0,${nmMm(b)},${rotation}`;
}

function roundRectMacro(shape: Extract<PadShape, { kind: "roundrect" }>, rotation: number): string {
  const radius = Math.min(shape.cornerRadius, shape.width / 2, shape.height / 2);
  if (radius <= 0) return rectMacro({ kind: "rect", width: shape.width, height: shape.height }, rotation);
  const x = shape.width / 2 - radius;
  const y = shape.height / 2 - radius;
  return [
    `21,1,${nmMm(shape.width)},${nmMm(shape.height - 2 * radius)},0,0,${rotation}`,
    `21,1,${nmMm(shape.width - 2 * radius)},${nmMm(shape.height)},0,0,${rotation}`,
    `1,1,${nmMm(2 * radius)},${nmMm(x)},${nmMm(y)},${rotation}`,
    `1,1,${nmMm(2 * radius)},${nmMm(-x)},${nmMm(y)},${rotation}`,
    `1,1,${nmMm(2 * radius)},${nmMm(x)},${nmMm(-y)},${rotation}`,
    `1,1,${nmMm(2 * radius)},${nmMm(-x)},${nmMm(-y)},${rotation}`,
  ].join("*");
}

function polygonMacro(shape: Extract<PadShape, { kind: "polygon" }>, rotation: number): string {
  if (shape.points.length < 3) throw new Error("Gerber aperture polygon requires at least three points");
  const points = [...shape.points, shape.points[0]];
  return `4,1,${shape.points.length},${points.map((p) => `${nmMm(p.x)},${nmMm(p.y)}`).join(",")},${rotation}`;
}

function apertureForFlash(flash: MirFlash, key: string, code: number): ApertureSpec {
  const rotation = normalizedRotation(flash.rotationDeg);
  const shape = flash.shape;
  if (shape.kind === "circle") {
    return { key, code, template: "C", modifiers: nmMm(shape.radius * 2), function: flash.apertureFunction };
  }
  const quarter = Math.round(rotation / 90);
  const axisAligned = Math.abs(rotation - quarter * 90) < 1e-9;
  if (axisAligned && (shape.kind === "rect" || shape.kind === "oval")) {
    const swap = Math.abs(quarter) % 2 === 1;
    const width = swap ? shape.height : shape.width;
    const height = swap ? shape.width : shape.height;
    return {
      key,
      code,
      template: shape.kind === "rect" ? "R" : "O",
      modifiers: `${nmMm(width)}X${nmMm(height)}`,
      function: flash.apertureFunction,
    };
  }
  const macroBody =
    shape.kind === "rect"
      ? rectMacro(shape, rotation)
      : shape.kind === "oval"
        ? ovalMacro(shape, rotation)
        : shape.kind === "roundrect"
          ? roundRectMacro(shape, rotation)
          : polygonMacro(shape, rotation);
  const name = `SRK${sha256(`${key}|${macroBody}`).slice(0, 16).toUpperCase()}`;
  return {
    key,
    code,
    template: name,
    modifiers: "",
    function: flash.apertureFunction,
    macro: { name, body: macroBody },
  };
}

function collectApertures(layer: MirLayer): Map<string, ApertureSpec> {
  const keys = [...new Set(layer.primitives.map(primitiveApertureKey))].sort();
  const result = new Map<string, ApertureSpec>();
  keys.forEach((key, index) => {
    const primitive = layer.primitives.find((item) => primitiveApertureKey(item) === key)!;
    const code = 10 + index;
    if (primitive.kind === "flash") {
      result.set(key, apertureForFlash(primitive, key, code));
    } else {
      result.set(key, {
        key,
        code,
        template: "C",
        modifiers: nmMm(primitive.kind === "stroke" ? primitive.widthNm : 1_000),
        function: primitive.apertureFunction,
      });
    }
  });
  return result;
}

function emitObjectAttributes(lines: string[], attributes: MirObjectAttributes): void {
  if (attributes.net) lines.push(`%TO.N,${cleanField(attributes.net)}*%`);
  if (attributes.ref && attributes.pin) {
    const pinFunction = attributes.pinFunction ? `,${cleanField(attributes.pinFunction)}` : "";
    lines.push(`%TO.P,${cleanField(attributes.ref)},${cleanField(attributes.pin)}${pinFunction}*%`);
  } else if (attributes.ref) {
    lines.push(`%TO.C,${cleanField(attributes.ref)}*%`);
  }
  if (attributes.footprint) lines.push(`%TO.CFtp,${cleanField(attributes.footprint)}*%`);
  if (attributes.rotationDeg !== undefined) lines.push(`%TO.CRot,${attributes.rotationDeg.toFixed(6).replace(/\.?0+$/, "")}*%`);
}

function emitRing(lines: string[], ring: Vec2[]): void {
  if (ring.length < 3) throw new Error("Gerber region ring requires at least three vertices");
  lines.push("G36*");
  lines.push(`${xy(ring[0])}D02*`);
  for (let i = 1; i < ring.length; i++) lines.push(`${xy(ring[i])}D01*`);
  lines.push(`${xy(ring[0])}D01*`);
  lines.push("G37*");
}

function emitPrimitive(lines: string[], primitive: MirPrimitive, aperture: ApertureSpec): void {
  emitObjectAttributes(lines, primitive.attributes);
  lines.push(`D${aperture.code}*`);
  if (primitive.kind === "stroke") {
    lines.push(`${xy(primitive.start)}D02*`);
    lines.push(`${xy(primitive.end)}D01*`);
  } else if (primitive.kind === "flash") {
    lines.push(`${xy(primitive.at)}D03*`);
  } else {
    lines.push(`%TA.AperFunction,${primitive.apertureFunction}*%`);
    lines.push("%LPD*%");
    emitRing(lines, primitive.outer);
    if (primitive.holes.length > 0) {
      lines.push("%LPC*%");
      for (const hole of primitive.holes) emitRing(lines, hole);
      lines.push("%LPD*%");
    }
    lines.push("%TD.AperFunction*%");
  }
  lines.push("%TD*%");
}

export function writeGerberLayer(
  snapshot: ManufacturingSnapshot,
  mir: ManufacturingIr,
  layer: MirLayer,
): GerberWriteResult {
  const apertures = collectApertures(layer);
  const lines: string[] = [
    "G04 Sirkit native Gerber X2/X3 - generated from immutable manufacturing snapshot*",
    "%TF.GenerationSoftware,Sirkit,Sirkit Fab Compiler,0.1.0*%",
    `%TF.ProjectId,${cleanField(mir.boardName)},${snapshot.sameCoordinatesId},${cleanField(mir.revisionId)}*%`,
    `%TF.SameCoordinates,${snapshot.sameCoordinatesId}*%`,
    `%TF.FileFunction,${layer.fileFunction}*%`,
    `%TF.FilePolarity,${layer.polarity}*%`,
    "%TF.Part,Single*%",
    "%FSLAX46Y46*%",
    "%MOMM*%",
    "%LPD*%",
    "G01*",
    "G04 Aperture definitions*",
  ];

  for (const aperture of apertures.values()) {
    if (aperture.macro) lines.push(`%AM${aperture.macro.name}*${aperture.macro.body}*%`);
  }
  for (const aperture of apertures.values()) {
    lines.push(`%TA.AperFunction,${aperture.function}*%`);
    lines.push(`%ADD${aperture.code}${aperture.template}${aperture.modifiers ? `,${aperture.modifiers}` : ""}*%`);
  }
  lines.push("%TD*%", "G04 Image data*", "%LPD*%");

  for (const primitive of layer.primitives) {
    emitPrimitive(lines, primitive, apertures.get(primitiveApertureKey(primitive))!);
  }
  lines.push("M02*");
  return {
    text: `${lines.join("\r\n")}\r\n`,
    apertureCount: apertures.size,
    objectCount: layer.primitives.reduce(
      (sum, primitive) => sum + 1 + (primitive.kind === "region" ? primitive.holes.length : 0),
      0,
    ),
  };
}
