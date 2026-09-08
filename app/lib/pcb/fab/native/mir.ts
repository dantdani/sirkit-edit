import type { PadShape, Vec2 } from "../../geometry";
import { padWorldPosition, padWorldShape } from "../../geometry-copper";
import type { LayerId } from "../../layers";
import { effectivePadLayers, oppositeLayer } from "../../side";
import { silkItemPolylines } from "../../silk/geometry";
import type { SilkTextItem } from "../../silk/types";
import { transformPoint } from "../../geometry";
import type { FootprintInstance, FpGraphic, Pad } from "../../types";
import { outlinePolygon } from "../../zones/geometry";
import { zoneFillIsCurrent } from "../../zones/fill-lifecycle";
import { stableJson } from "./stable";
import { toManufacturingPoint } from "./snapshot";
import type {
  FabDiagnostic,
  ManufacturingIr,
  ManufacturingSnapshot,
  MirDrill,
  MirFlash,
  MirLayer,
  MirObjectAttributes,
  MirPrimitive,
  MirRegion,
  MirStroke,
} from "./types";
import { compareCodePoints } from "@/app/lib/stable-compare";

const ACTIVE_COPPER: Record<2 | 4, LayerId[]> = {
  2: ["copperTop", "copperBottom"],
  4: ["copperTop", "in1", "in2", "copperBottom"],
};

const COPPER_FUNCTION: Record<LayerId, (count: number) => string> = {
  copperTop: () => "Copper,L1,Top",
  in1: () => "Copper,L2,Inr",
  in2: () => "Copper,L3,Inr",
  copperBottom: (count) => `Copper,L${count},Bot`,
  silkTop: () => "Legend,Top",
  silkBottom: () => "Legend,Bot",
  maskTop: () => "Soldermask,Top",
  maskBottom: () => "Soldermask,Bot",
  pasteTop: () => "Paste,Top",
  pasteBottom: () => "Paste,Bot",
  edge: () => "Profile,NP",
  courtyardTop: () => "OtherDrawing,Courtyard Top",
  courtyardBottom: () => "OtherDrawing,Courtyard Bottom",
  fabTop: () => "OtherDrawing,Fabrication Top",
  fabBottom: () => "OtherDrawing,Fabrication Bottom",
};

function layer(id: LayerId, count: 2 | 4): MirLayer {
  return {
    id,
    sourceLayer: id,
    filenameRole: id,
    fileFunction: COPPER_FUNCTION[id](count),
    polarity: id === "maskTop" || id === "maskBottom" ? "Negative" : "Positive",
    primitives: [],
  };
}

function normalizeDeg(deg: number): number {
  const value = ((deg % 360) + 360) % 360;
  return value === 360 || Object.is(value, -0) ? 0 : value;
}

function mirShape(shape: PadShape): PadShape {
  if (shape.kind !== "polygon") return structuredClone(shape);
  return { kind: "polygon", points: shape.points.map((p) => ({ x: p.x, y: -p.y })) };
}

function expandedMaskShape(shape: PadShape, marginNm: number): PadShape | null {
  if (shape.kind === "circle") return shape.radius + marginNm > 0 ? { kind: "circle", radius: shape.radius + marginNm } : null;
  if (shape.kind === "rect") return shape.width + marginNm * 2 > 0 && shape.height + marginNm * 2 > 0 ? { kind: "rect", width: shape.width + marginNm * 2, height: shape.height + marginNm * 2 } : null;
  if (shape.kind === "oval") return shape.width + marginNm * 2 > 0 && shape.height + marginNm * 2 > 0 ? { kind: "oval", width: shape.width + marginNm * 2, height: shape.height + marginNm * 2 } : null;
  if (shape.kind === "roundrect") return shape.width + marginNm * 2 > 0 && shape.height + marginNm * 2 > 0 && shape.cornerRadius + marginNm >= 0 ? { kind: "roundrect", width: shape.width + marginNm * 2, height: shape.height + marginNm * 2, cornerRadius: shape.cornerRadius + marginNm } : null;
  return marginNm === 0 ? mirShape(shape) : null;
}

function objectAttributes(
  netName: string | undefined,
  ref?: string,
  pin?: string,
  footprint?: string,
): MirObjectAttributes {
  return {
    ...(netName ? { net: netName } : {}),
    ...(ref ? { ref } : {}),
    ...(pin ? { pin } : {}),
    ...(footprint ? { footprint } : {}),
  };
}

function fpTextValue(graphic: Extract<FpGraphic, { kind: "text" }>, fp: FootprintInstance): string {
  if (graphic.textKind === "reference" || /\$\{?REFERENCE\}?|REF\*\*/i.test(graphic.text)) return fp.ref;
  if (graphic.textKind === "value" || /\$\{?VALUE\}?/i.test(graphic.text)) return fp.def.name;
  return graphic.text;
}

function worldPoint(snapshot: ManufacturingSnapshot, fp: FootprintInstance, p: Vec2): Vec2 {
  return toManufacturingPoint(
    snapshot,
    transformPoint(p, fp.at, fp.rotationDeg, fp.side === "bottom"),
  );
}

function arcPolyline(graphic: Extract<FpGraphic, { kind: "arc" }>, segments = 24): Vec2[] {
  const a = graphic.start;
  const b = graphic.mid;
  const c = graphic.end;
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1) return [a, c];
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const center = {
    x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d,
    y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d,
  };
  const r = Math.hypot(a.x - center.x, a.y - center.y);
  const start = Math.atan2(a.y - center.y, a.x - center.x);
  const mid = Math.atan2(b.y - center.y, b.x - center.x);
  const end = Math.atan2(c.y - center.y, c.x - center.x);
  const tau = Math.PI * 2;
  const forwardEnd = (end - start + tau) % tau;
  const forwardMid = (mid - start + tau) % tau;
  const sweep = forwardMid <= forwardEnd ? forwardEnd : forwardEnd - tau;
  const count = Math.max(4, Math.ceil((Math.abs(sweep) / tau) * segments));
  return Array.from({ length: count + 1 }, (_, i) => {
    const angle = start + (sweep * i) / count;
    return { x: Math.round(center.x + r * Math.cos(angle)), y: Math.round(center.y + r * Math.sin(angle)) };
  });
}

function graphicPolylines(graphic: Exclude<FpGraphic, { kind: "text" }>): Vec2[][] {
  switch (graphic.kind) {
    case "line":
      return [[graphic.start, graphic.end]];
    case "arc":
      return [arcPolyline(graphic)];
    case "circle": {
      const radius = Math.hypot(graphic.end.x - graphic.center.x, graphic.end.y - graphic.center.y);
      const ring = Array.from({ length: 32 }, (_, i) => {
        const a = (Math.PI * 2 * i) / 32;
        return { x: Math.round(graphic.center.x + radius * Math.cos(a)), y: Math.round(graphic.center.y + radius * Math.sin(a)) };
      });
      return [[...ring, ring[0]]];
    }
    case "rect": {
      const p = [
        graphic.start,
        { x: graphic.end.x, y: graphic.start.y },
        graphic.end,
        { x: graphic.start.x, y: graphic.end.y },
      ];
      return [[...p, p[0]]];
    }
    case "poly":
      return graphic.points.length ? [[...graphic.points, graphic.points[0]]] : [];
  }
}

function pushStroke(
  target: MirPrimitive[],
  id: string,
  points: Vec2[],
  widthNm: number,
  sourceIds: string[],
): void {
  for (let i = 0; i + 1 < points.length; i++) {
    target.push({
      kind: "stroke",
      id: `${id}-${i}`,
      start: points[i],
      end: points[i + 1],
      widthNm,
      apertureFunction: "NonConductor",
      attributes: {},
      sourceIds,
    });
  }
}

function compileSilk(snapshot: ManufacturingSnapshot, layers: Map<string, MirLayer>): void {
  const board = snapshot.board;
  for (const fp of board.footprints) {
    for (let index = 0; index < fp.def.graphics.length; index++) {
      const graphic = fp.def.graphics[index];
      const physicalLayer = fp.side === "bottom" ? oppositeLayer(graphic.layer) : graphic.layer;
      if (physicalLayer !== "silkTop" && physicalLayer !== "silkBottom") continue;
      const target = layers.get(physicalLayer)?.primitives;
      if (!target) continue;
      if (graphic.kind === "text") {
        const localText: SilkTextItem = {
          kind: "text",
          id: `${fp.id}-graphic-${index}`,
          layer: "silkTop",
          position: graphic.at,
          text: fpTextValue(graphic, fp),
          heightNm: graphic.sizeY,
          strokeWidthNm: graphic.thickness,
          rotationDeg: graphic.rotationDeg,
          mirror: false,
          anchor: "center",
        };
        for (const [polyIndex, polyline] of silkItemPolylines(localText).entries()) {
          pushStroke(
            target,
            `${fp.id}-text-${index}-${polyIndex}`,
            polyline.map((p) => worldPoint(snapshot, fp, p)),
            Math.max(1, graphic.thickness),
            [fp.id],
          );
        }
        continue;
      }
      for (const [polyIndex, polyline] of graphicPolylines(graphic).entries()) {
        const points = polyline.map((p) => worldPoint(snapshot, fp, p));
        if ("fill" in graphic && graphic.fill && points.length >= 4) {
          target.push({
            kind: "region",
            id: `${fp.id}-graphic-${index}-${polyIndex}`,
            outer: points.at(-1)?.x === points[0].x && points.at(-1)?.y === points[0].y ? points.slice(0, -1) : points,
            holes: [],
            apertureFunction: "NonConductor",
            attributes: {},
            sourceIds: [fp.id],
          });
        } else {
          pushStroke(
            target,
            `${fp.id}-graphic-${index}-${polyIndex}`,
            points,
            Math.max(1, graphic.width),
            [fp.id],
          );
        }
      }
    }
  }

  for (const item of board.silkItems ?? []) {
    const target = layers.get(item.layer)?.primitives;
    if (!target) continue;
    for (const [index, polyline] of silkItemPolylines(item).entries()) {
      const width = item.strokeWidthNm;
      pushStroke(
        target,
        `${item.id}-${index}`,
        polyline.map((p) => toManufacturingPoint(snapshot, p)),
        Math.max(1, width),
        [item.id],
      );
    }
  }

  for (const text of board.texts) {
    if (text.layer !== "silkTop" && text.layer !== "silkBottom") continue;
    const target = layers.get(text.layer)?.primitives;
    if (!target) continue;
    const item: SilkTextItem = {
      kind: "text",
      id: text.id,
      layer: text.layer,
      position: text.at,
      text: text.text,
      heightNm: text.sizeY,
      strokeWidthNm: text.thickness,
      rotationDeg: text.rotationDeg,
      mirror: text.layer === "silkBottom",
      anchor: "center",
    };
    for (const [index, polyline] of silkItemPolylines(item).entries()) {
      pushStroke(
        target,
        `${text.id}-${index}`,
        polyline.map((p) => toManufacturingPoint(snapshot, p)),
        Math.max(1, text.thickness),
        [text.id],
      );
    }
  }
}

function drillForPad(
  snapshot: ManufacturingSnapshot,
  fp: FootprintInstance,
  pad: Pad,
): MirDrill | null {
  if (!pad.drill) return null;
  const placed = padWorldShape(fp, pad);
  const centerScreen = padWorldPosition(fp, pad);
  const offset = pad.drill.offset ?? { x: 0, y: 0 };
  const drillCenter = transformPoint(offset, centerScreen, placed.rotationDeg, fp.side === "bottom");
  const plated = pad.type !== "np_thru_hole";
  const sourceIds = [fp.id, `${fp.id}:pad:${pad.number}`];
  const span: [number, number] = [1, snapshot.board.stackup];
  const width = pad.drill.width ?? pad.drill.diameter;
  const height = pad.drill.height ?? pad.drill.diameter;
  if (width === height) {
    return {
      kind: "hit",
      id: `${fp.id}-pad-${pad.number}`,
      at: toManufacturingPoint(snapshot, drillCenter),
      diameterNm: pad.drill.diameter,
      plated,
      span,
      sourceIds,
    };
  }
  const diameterNm = Math.min(width, height);
  const run = Math.max(width, height) - diameterNm;
  const localA = width > height ? { x: -run / 2, y: 0 } : { x: 0, y: -run / 2 };
  const localB = width > height ? { x: run / 2, y: 0 } : { x: 0, y: run / 2 };
  return {
    kind: "slot",
    id: `${fp.id}-pad-${pad.number}`,
    start: toManufacturingPoint(
      snapshot,
      transformPoint(localA, drillCenter, placed.rotationDeg, fp.side === "bottom"),
    ),
    end: toManufacturingPoint(
      snapshot,
      transformPoint(localB, drillCenter, placed.rotationDeg, fp.side === "bottom"),
    ),
    diameterNm,
    plated,
    span,
    sourceIds,
  };
}

function sortMir(mir: ManufacturingIr): ManufacturingIr {
  mir.layers.sort((a, b) => compareCodePoints(a.id, b.id));
  for (const item of mir.layers) {
    item.primitives.sort((a, b) => compareCodePoints(a.id, b.id) || compareCodePoints(stableJson(a), stableJson(b)));
  }
  mir.drills.sort((a, b) => Number(a.plated) - Number(b.plated) || compareCodePoints(a.id, b.id));
  return mir;
}

export function compileManufacturingIr(
  snapshot: ManufacturingSnapshot,
  inheritedDiagnostics: FabDiagnostic[] = [],
): ManufacturingIr {
  const board = snapshot.board;
  const diagnostics = [...inheritedDiagnostics];
  const layers = new Map<string, MirLayer>();
  const addLayer = (value: MirLayer): MirLayer => {
    layers.set(value.id, value);
    return value;
  };

  for (const id of ACTIVE_COPPER[board.stackup]) addLayer(layer(id, board.stackup));
  for (const id of ["maskTop", "maskBottom", "pasteTop", "pasteBottom", "silkTop", "silkBottom"] as const) {
    addLayer(layer(id, board.stackup));
  }
  const profile = addLayer(layer("edge", board.stackup));
  const netNames = new Map(board.nets.map((net) => [net.id, net.name]));

  for (const track of board.tracks) {
    const target = layers.get(track.layer);
    if (!target || !ACTIVE_COPPER[board.stackup].includes(track.layer)) {
      diagnostics.push({
        code: "MIR_TRACK_ON_INACTIVE_LAYER",
        severity: "error",
        category: "geometry",
        message: `Track ${track.id} is on inactive layer ${track.layer}.`,
        sourceIds: [track.id],
      });
      continue;
    }
    target.primitives.push({
      kind: "stroke",
      id: track.id,
      start: toManufacturingPoint(snapshot, track.start),
      end: toManufacturingPoint(snapshot, track.end),
      widthNm: track.width,
      apertureFunction: "Conductor",
      attributes: objectAttributes(netNames.get(track.netId)),
      sourceIds: [track.id],
    });
  }

  for (const via of board.vias) {
    const active = ACTIVE_COPPER[board.stackup];
    const first = active.indexOf(via.layers[0]);
    const last = active.indexOf(via.layers[1]);
    if (first < 0 || last < 0) {
      diagnostics.push({
        code: "MIR_INVALID_VIA_SPAN",
        severity: "error",
        category: "geometry",
        message: `Via ${via.id} has a span outside the ${board.stackup}-layer stack.`,
        sourceIds: [via.id],
      });
      continue;
    }
    for (let index = Math.min(first, last); index <= Math.max(first, last); index++) {
      layers.get(active[index])!.primitives.push({
        kind: "flash",
        id: `${via.id}-${active[index]}`,
        at: toManufacturingPoint(snapshot, via.at),
        shape: { kind: "circle", radius: via.size / 2 },
        rotationDeg: 0,
        apertureFunction: "ViaPad",
        attributes: objectAttributes(netNames.get(via.netId)),
        sourceIds: [via.id],
      });
    }
  }

  const drills: MirDrill[] = board.vias.map((via) => {
    const active = ACTIVE_COPPER[board.stackup];
    const a = active.indexOf(via.layers[0]);
    const b = active.indexOf(via.layers[1]);
    return {
      kind: "hit",
      id: via.id,
      at: toManufacturingPoint(snapshot, via.at),
      diameterNm: via.drill,
      plated: true,
      span: [Math.min(a, b) + 1, Math.max(a, b) + 1] as [number, number],
      sourceIds: [via.id],
    };
  });

  for (const fp of board.footprints) {
    for (const pad of fp.def.pads) {
      const placed = padWorldShape(fp, pad);
      const attributes = objectAttributes(
        netNames.get(fp.padNets[pad.number] ?? 0),
        fp.ref,
        pad.number || undefined,
      );
      const authoredLayers = effectivePadLayers(pad, fp.side);
      const effectiveLayers = new Set(authoredLayers);
      if (snapshot.maskPolicy.defaultComponentPadsOpen && pad.type !== "np_thru_hole") {
        if (pad.type === "thru_hole") {
          effectiveLayers.add("maskTop");
          effectiveLayers.add("maskBottom");
        } else effectiveLayers.add(fp.side === "top" ? "maskTop" : "maskBottom");
      }
      for (const padLayer of effectiveLayers) {
        const target = layers.get(padLayer);
        if (!target) continue;
        if (padLayer === "in1" || padLayer === "in2") {
          if (board.stackup === 2) continue;
        }
        if (![...ACTIVE_COPPER[board.stackup], "maskTop", "maskBottom", "pasteTop", "pasteBottom"].includes(padLayer)) {
          continue;
        }
        const isCopper = ACTIVE_COPPER[board.stackup].includes(padLayer);
        const maskMarginNm = pad.solderMaskMarginNm ?? snapshot.maskPolicy.defaultExpansionNm;
        const shape = padLayer === "maskTop" || padLayer === "maskBottom"
          ? expandedMaskShape(placed.shape, maskMarginNm)
          : mirShape(placed.shape);
        if (!shape) {
          diagnostics.push({
            code: "MIR_MASK_EXPANSION_UNSUPPORTED",
            severity: "error",
            category: "geometry",
            message: `Pad ${fp.ref}.${pad.number} requires polygon mask expansion unsupported by the exact MIR.`,
            sourceIds: [fp.id, `${fp.id}:pad:${pad.number}`],
          });
          continue;
        }
        const flash: MirFlash = {
          kind: "flash",
          id: `${fp.id}-pad-${pad.number}-${padLayer}`,
          at: toManufacturingPoint(snapshot, placed.at),
          shape,
          rotationDeg: normalizeDeg(placed.rotationDeg),
          apertureFunction: isCopper
            ? pad.type === "smd"
              ? "SMDPad"
              : "ComponentPad"
            : "Material",
          attributes: isCopper ? attributes : {},
          sourceIds: [fp.id, `${fp.id}:pad:${pad.number}`],
        };
        target.primitives.push(flash);
      }
      const drill = drillForPad(snapshot, fp, pad);
      if (drill) drills.push(drill);
    }
  }

  for (const zone of board.zones) {
    if (!zoneFillIsCurrent(board, zone)) continue;
    const target = layers.get(zone.layer);
    if (!target) continue;
    for (let index = 0; index < zone.fill.length; index++) {
      const fill = zone.fill[index];
      const region: MirRegion = {
        kind: "region",
        id: `${zone.id}-${index}`,
        outer: fill.outer.map((p) => toManufacturingPoint(snapshot, p)),
        holes: fill.holes.map((ring) => ring.map((p) => toManufacturingPoint(snapshot, p))),
        apertureFunction: "Conductor",
        attributes: objectAttributes(netNames.get(zone.netId)),
        sourceIds: [zone.id],
      };
      target.primitives.push(region);
    }
  }

  const outline = outlinePolygon(board.outline, 16).map((p) => toManufacturingPoint(snapshot, p));
  for (let index = 0; index < outline.length; index++) {
    const stroke: MirStroke = {
      kind: "stroke",
      id: `profile-${index}`,
      start: outline[index],
      end: outline[(index + 1) % outline.length],
      widthNm: 100_000,
      apertureFunction: "Profile",
      attributes: {},
      sourceIds: ["board-outline"],
    };
    profile.primitives.push(stroke);
  }

  compileSilk(snapshot, layers);

  if (snapshot.recipe.includeComponentLayers) {
    for (const side of ["top", "bottom"] as const) {
      const number = side === "top" ? 1 : board.stackup;
      const componentLayer: MirLayer = {
        id: `component-${side}`,
        filenameRole: `component-${side}`,
        fileFunction: `Component,L${number},${side === "top" ? "Top" : "Bot"}`,
        polarity: "Positive",
        primitives: [],
      };
      for (const fp of board.footprints.filter((item) => item.side === side && !item.def.attributes.excludeFromPos)) {
        componentLayer.primitives.push({
          kind: "flash",
          id: `${fp.id}-main`,
          at: toManufacturingPoint(snapshot, fp.at),
          shape: { kind: "circle", radius: 150_000 },
          rotationDeg: 0,
          apertureFunction: "ComponentMain",
          attributes: { ref: fp.ref, footprint: fp.def.name, rotationDeg: normalizeDeg(fp.rotationDeg) },
          sourceIds: [fp.id],
        });
        for (const pad of fp.def.pads) {
          componentLayer.primitives.push({
            kind: "flash",
            id: `${fp.id}-pin-${pad.number}`,
            at: toManufacturingPoint(snapshot, padWorldPosition(fp, pad)),
            shape: { kind: "circle", radius: 100_000 },
            rotationDeg: 0,
            apertureFunction: "ComponentPin",
            attributes: objectAttributes(netNames.get(fp.padNets[pad.number] ?? 0), fp.ref, pad.number || undefined),
            sourceIds: [fp.id, `${fp.id}:pad:${pad.number}`],
          });
        }
      }
      if (componentLayer.primitives.length > 0) addLayer(componentLayer);
    }
  }

  return sortMir({
    schemaVersion: "sirkit.manufacturing-ir.v1",
    snapshotHash: snapshot.sourceHash,
    revisionId: snapshot.revisionId,
    boardName: snapshot.boardName,
    sameCoordinatesId: snapshot.sameCoordinatesId,
    layerCount: board.stackup,
    boardSizeMm: {
      x: snapshot.transform.boardWidthNm / 1_000_000,
      y: snapshot.transform.boardHeightNm / 1_000_000,
    },
    layers: [...layers.values()].filter((item) =>
      ACTIVE_COPPER[board.stackup].includes(item.id as LayerId) || item.id === "edge" || item.primitives.length > 0,
    ),
    drills,
    diagnostics,
  });
}
