import type { PadShape } from "../../geometry";
import { stableJson } from "./stable";
import type { ParsedGerber, ParsedGerberAperture, ParsedGerberObject } from "./gerber-parser";
import type { FabDiagnostic, MirFlash, MirLayer, MirObjectAttributes } from "./types";

interface ShapeDescription {
  shape: PadShape;
  rotationDeg: number;
}

const mmToNm = (value: string): number => Math.round(Number(value) * 1_000_000);

function normalizeRotation(value: number): number {
  const result = ((value % 360) + 360) % 360;
  return Math.abs(result - 360) < 1e-6 ? 0 : result;
}

function macroShape(aperture: ParsedGerberAperture): ShapeDescription | null {
  const body = aperture.macroBody;
  if (!body) return null;
  const primitives = body.split("*").map((item) => item.split(","));
  if (primitives.length === 1 && primitives[0][0] === "21") {
    return {
      shape: { kind: "rect", width: mmToNm(primitives[0][2]), height: mmToNm(primitives[0][3]) },
      rotationDeg: Number(primitives[0][6]),
    };
  }
  if (primitives.length === 1 && primitives[0][0] === "20") {
    const item = primitives[0];
    const diameter = mmToNm(item[2]);
    const dx = Math.abs(mmToNm(item[5]) - mmToNm(item[3]));
    const dy = Math.abs(mmToNm(item[6]) - mmToNm(item[4]));
    return {
      shape: dx >= dy
        ? { kind: "oval", width: dx + diameter, height: diameter }
        : { kind: "oval", width: diameter, height: dy + diameter },
      rotationDeg: Number(item[7]),
    };
  }
  if (primitives.length === 6 && primitives[0][0] === "21" && primitives[2][0] === "1") {
    const radius = mmToNm(primitives[2][2]) / 2;
    return {
      shape: {
        kind: "roundrect",
        width: mmToNm(primitives[0][2]),
        height: mmToNm(primitives[0][3]) + radius * 2,
        cornerRadius: radius,
      },
      rotationDeg: Number(primitives[0][6]),
    };
  }
  if (primitives.length === 1 && primitives[0][0] === "4") {
    const item = primitives[0];
    const count = Number(item[2]);
    const values = item.slice(3, 3 + (count + 1) * 2);
    if (values.length !== (count + 1) * 2) return null;
    const points = Array.from({ length: count }, (_, index) => ({
      x: mmToNm(values[index * 2]),
      y: mmToNm(values[index * 2 + 1]),
    }));
    return { shape: { kind: "polygon", points }, rotationDeg: Number(item.at(-1)) };
  }
  return null;
}

function parsedShape(aperture: ParsedGerberAperture): ShapeDescription | null {
  const dimensions = aperture.modifiers.split("X").filter(Boolean).map(mmToNm);
  if (aperture.template === "C" && dimensions[0] !== undefined) {
    return { shape: { kind: "circle", radius: dimensions[0] / 2 }, rotationDeg: 0 };
  }
  if (aperture.template === "R" && dimensions.length >= 2) {
    return { shape: { kind: "rect", width: dimensions[0], height: dimensions[1] }, rotationDeg: 0 };
  }
  if (aperture.template === "O" && dimensions.length >= 2) {
    return { shape: { kind: "oval", width: dimensions[0], height: dimensions[1] }, rotationDeg: 0 };
  }
  return macroShape(aperture);
}

function normalizedExpectedFlash(flash: MirFlash): ShapeDescription {
  const rotation = normalizeRotation(flash.rotationDeg);
  const quarter = Math.round(rotation / 90);
  const axisAligned = Math.abs(rotation - quarter * 90) < 1e-6;
  if (axisAligned && (flash.shape.kind === "rect" || flash.shape.kind === "oval")) {
    const swap = Math.abs(quarter) % 2 === 1;
    return {
      shape: swap
        ? { ...flash.shape, width: flash.shape.height, height: flash.shape.width }
        : flash.shape,
      rotationDeg: 0,
    };
  }
  return { shape: flash.shape, rotationDeg: flash.shape.kind === "circle" ? 0 : rotation };
}

function attrs(attributes: MirObjectAttributes): string {
  return stableJson(attributes);
}

function expectedSignatures(layer: MirLayer): string[] {
  const values: string[] = [];
  for (const primitive of layer.primitives) {
    if (primitive.kind === "stroke") {
      values.push(`stroke|${stableJson(primitive.start)}|${stableJson(primitive.end)}|${primitive.widthNm}|${primitive.apertureFunction}|dark|${attrs(primitive.attributes)}`);
    } else if (primitive.kind === "flash") {
      values.push(`flash|${stableJson(primitive.at)}|${stableJson(normalizedExpectedFlash(primitive))}|${primitive.apertureFunction}|dark|${attrs(primitive.attributes)}`);
    } else {
      values.push(`region|${stableJson(primitive.outer)}|${primitive.apertureFunction}|dark|${attrs(primitive.attributes)}`);
      for (const hole of primitive.holes) {
        values.push(`region|${stableJson(hole)}|${primitive.apertureFunction}|clear|${attrs(primitive.attributes)}`);
      }
    }
  }
  return values.sort();
}

function parsedSignature(object: ParsedGerberObject): string | null {
  if (object.kind === "stroke") {
    const shape = parsedShape(object.aperture);
    if (!shape || shape.shape.kind !== "circle") return null;
    return `stroke|${stableJson(object.start)}|${stableJson(object.end)}|${shape.shape.radius * 2}|${object.aperture.apertureFunction}|${object.polarity}|${attrs(object.attributes)}`;
  }
  if (object.kind === "flash") {
    const shape = parsedShape(object.aperture);
    if (!shape) return null;
    return `flash|${stableJson(object.at)}|${stableJson({ shape: shape.shape, rotationDeg: normalizeRotation(shape.rotationDeg) })}|${object.aperture.apertureFunction}|${object.polarity}|${attrs(object.attributes)}`;
  }
  return `region|${stableJson(object.points)}|${object.apertureFunction}|${object.polarity}|${attrs(object.attributes)}`;
}

export function verifyGerberLayer(layer: MirLayer, parsed: ParsedGerber, file: string): FabDiagnostic[] {
  const diagnostics: FabDiagnostic[] = parsed.errors.map((message) => ({
    code: "GERBER_PARSE_ERROR",
    severity: "error",
    category: "format",
    message,
    file,
  }));
  const expected = expectedSignatures(layer);
  const actual: string[] = [];
  for (const object of parsed.objects) {
    const signature = parsedSignature(object);
    if (signature) actual.push(signature);
    else {
      diagnostics.push({
        code: "GERBER_UNSUPPORTED_PARSED_APERTURE",
        severity: "error",
        category: "equivalence",
        message: `Could not independently reconstruct aperture for ${object.kind} object.`,
        file,
      });
    }
  }
  actual.sort();
  if (stableJson(actual) !== stableJson(expected)) {
    const expectedCounts = new Map<string, number>();
    const actualCounts = new Map<string, number>();
    for (const value of expected) expectedCounts.set(value, (expectedCounts.get(value) ?? 0) + 1);
    for (const value of actual) actualCounts.set(value, (actualCounts.get(value) ?? 0) + 1);
    const missing = [...expectedCounts].reduce((sum, [key, count]) => sum + Math.max(0, count - (actualCounts.get(key) ?? 0)), 0);
    const extra = [...actualCounts].reduce((sum, [key, count]) => sum + Math.max(0, count - (expectedCounts.get(key) ?? 0)), 0);
    diagnostics.push({
      code: "GERBER_GEOMETRY_MISMATCH",
      severity: "error",
      category: "equivalence",
      message: `${file} parse-back differs from MIR: ${missing} missing and ${extra} extra object signature(s).`,
      file,
    });
  }
  return diagnostics;
}
