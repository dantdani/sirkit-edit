import type { BBox, PlacedShape, Vec2 } from "../geometry";
import { shapeBBox } from "../geometry";
import type { FootprintDef, FootprintInstance, PcbBoard } from "../types";
import type { DrcRules } from "../drc/types";
import { getPreset } from "../drc/presets";
import { effectiveRules } from "../drc/rules";
import { getNetClass } from "../netclass";
import { mmToNm } from "../units";

export type PlacementEnvelopeSourceType = "courtyard" | "body" | "pads_and_graphics" | "fallback";

export interface PlacementEnvelopeSource {
  type: PlacementEnvelopeSourceType;
  bounds: BBox;
  confidence: "high" | "medium" | "low";
}

export interface PlacementEnvelope {
  source: PlacementEnvelopeSource;
  baseBounds: BBox;
  scaledBounds: BBox;
  effectiveBounds: BBox;
  scale: number;
  routingMarginNm: number;
}

export interface PlacementEnvelopeOptions {
  scale?: number;
  rules?: DrcRules;
  minimumViaLandingMarginNm?: number;
  manufacturerPlacementMarginNm?: number;
}

export const DEFAULT_PLACEMENT_ENVELOPE_SCALE = 1.15;
export const MINIMUM_VIA_LANDING_MARGIN_NM = mmToNm(0.5);
export const MANUFACTURER_PLACEMENT_MARGIN_NM = mmToNm(0.25);

const finite = (value: number): boolean => Number.isFinite(value);

export function validBBox(bounds: BBox | undefined): bounds is BBox {
  return Boolean(
    bounds &&
    finite(bounds.minX) &&
    finite(bounds.minY) &&
    finite(bounds.maxX) &&
    finite(bounds.maxY) &&
    bounds.maxX > bounds.minX &&
    bounds.maxY > bounds.minY,
  );
}

function unionBounds(a: BBox | undefined, b: BBox | undefined): BBox | undefined {
  if (!validBBox(a)) return validBBox(b) ? { ...b } : undefined;
  if (!validBBox(b)) return { ...a };
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

function pointsBounds(points: readonly Vec2[], inflation = 0): BBox | undefined {
  if (points.length === 0 || points.some((point) => !finite(point.x) || !finite(point.y))) return undefined;
  return {
    minX: Math.min(...points.map((point) => point.x)) - inflation,
    minY: Math.min(...points.map((point) => point.y)) - inflation,
    maxX: Math.max(...points.map((point) => point.x)) + inflation,
    maxY: Math.max(...points.map((point) => point.y)) + inflation,
  };
}

function localPadBounds(definition: FootprintDef): BBox | undefined {
  let result: BBox | undefined;
  for (const pad of definition.pads) {
    const placed: PlacedShape = { shape: pad.shape, at: pad.at, rotationDeg: pad.rotationDeg };
    result = unionBounds(result, shapeBBox(placed));
  }
  return result;
}

function localGraphicBounds(definition: FootprintDef): BBox | undefined {
  let result: BBox | undefined;
  for (const graphic of definition.graphics) {
    let bounds: BBox | undefined;
    switch (graphic.kind) {
      case "line":
        bounds = pointsBounds([graphic.start, graphic.end], graphic.width / 2);
        break;
      case "arc":
        bounds = pointsBounds([graphic.start, graphic.mid, graphic.end], graphic.width / 2);
        break;
      case "circle": {
        const radius = Math.hypot(graphic.end.x - graphic.center.x, graphic.end.y - graphic.center.y) + graphic.width / 2;
        bounds = { minX: graphic.center.x - radius, minY: graphic.center.y - radius, maxX: graphic.center.x + radius, maxY: graphic.center.y + radius };
        break;
      }
      case "rect":
        bounds = pointsBounds([graphic.start, graphic.end], graphic.width / 2);
        break;
      case "poly":
        bounds = pointsBounds(graphic.points, graphic.width / 2);
        break;
      case "text":
        bounds = {
          minX: graphic.at.x - graphic.sizeX / 2,
          minY: graphic.at.y - graphic.sizeY / 2,
          maxX: graphic.at.x + graphic.sizeX / 2,
          maxY: graphic.at.y + graphic.sizeY / 2,
        };
        break;
    }
    result = unionBounds(result, bounds);
  }
  return result;
}

function containsBounds(container: BBox, contained: BBox | undefined): boolean {
  return !contained || (
    container.minX <= contained.minX &&
    container.minY <= contained.minY &&
    container.maxX >= contained.maxX &&
    container.maxY >= contained.maxY
  );
}

export function selectPlacementEnvelopeSource(definition: FootprintDef): PlacementEnvelopeSource {
  const pads = localPadBounds(definition);
  if (validBBox(definition.courtyardBBox) && containsBounds(definition.courtyardBBox, pads)) {
    return { type: "courtyard", bounds: { ...definition.courtyardBBox }, confidence: "high" };
  }
  if (validBBox(definition.bodyBBox) && containsBounds(definition.bodyBBox, pads)) {
    return { type: "body", bounds: { ...definition.bodyBBox }, confidence: "medium" };
  }
  const padsAndGraphics = unionBounds(pads, localGraphicBounds(definition));
  if (validBBox(padsAndGraphics)) {
    return { type: "pads_and_graphics", bounds: padsAndGraphics, confidence: "medium" };
  }
  const half = mmToNm(1);
  return {
    type: "fallback",
    bounds: { minX: -half, minY: -half, maxX: half, maxY: half },
    confidence: "low",
  };
}

export function scaleEnvelopeBounds(bounds: BBox, scale: number): BBox {
  if (!(scale >= 1) || !Number.isFinite(scale)) throw new Error("Placement envelope scale must be at least 1");
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const halfWidth = ((bounds.maxX - bounds.minX) * scale) / 2;
  const halfHeight = ((bounds.maxY - bounds.minY) * scale) / 2;
  return {
    minX: Math.floor(centerX - halfWidth),
    minY: Math.floor(centerY - halfHeight),
    maxX: Math.ceil(centerX + halfWidth),
    maxY: Math.ceil(centerY + halfHeight),
  };
}

export function expandEnvelopeBounds(bounds: BBox, marginNm: number): BBox {
  const margin = Math.max(0, Math.round(marginNm));
  return {
    minX: bounds.minX - margin,
    minY: bounds.minY - margin,
    maxX: bounds.maxX + margin,
    maxY: bounds.maxY + margin,
  };
}

export function resolvedRoutingMarginNm(
  board: PcbBoard,
  footprint: FootprintInstance,
  options: PlacementEnvelopeOptions = {},
): number {
  const rules = options.rules ?? getPreset(board.stackup === 4 ? "jlcpcb-4l" : "jlcpcb-2l").rules;
  const netIds = [...new Set(Object.values(footprint.padNets).filter((netId) => netId !== 0))];
  if (netIds.length === 0) netIds.push(0);
  let margin = Math.max(
    options.minimumViaLandingMarginNm ?? MINIMUM_VIA_LANDING_MARGIN_NM,
    options.manufacturerPlacementMarginNm ?? MANUFACTURER_PLACEMENT_MARGIN_NM,
  );
  for (const netId of netIds) {
    const netClass = getNetClass(board, netId);
    const resolved = effectiveRules(rules, netId, netClass);
    margin = Math.max(
      margin,
      netClass.trackWidth / 2 + resolved.clearanceNm,
      netClass.viaSize / 2 + resolved.clearanceNm,
      resolved.minCourtyardClearanceNm,
    );
  }
  return Math.round(margin);
}

export function buildPlacementEnvelope(
  board: PcbBoard,
  footprint: FootprintInstance,
  options: PlacementEnvelopeOptions = {},
): PlacementEnvelope {
  const source = selectPlacementEnvelopeSource(footprint.def);
  const scale = options.scale ?? board.placementPreferences?.envelopeScale ?? DEFAULT_PLACEMENT_ENVELOPE_SCALE;
  const scaledBounds = scaleEnvelopeBounds(source.bounds, scale);
  const routingMarginNm = resolvedRoutingMarginNm(board, footprint, options);
  const marginBounds = expandEnvelopeBounds(source.bounds, routingMarginNm);
  return {
    source,
    baseBounds: { ...source.bounds },
    scaledBounds,
    effectiveBounds: unionBounds(scaledBounds, marginBounds)!,
    scale,
    routingMarginNm,
  };
}
