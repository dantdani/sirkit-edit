/** Board containment and layer-legality checks. Pure model checks; no canvas. */
import type { BBox, Vec2 } from "../../geometry";
import { shapeBBox, transformPoint } from "../../geometry";
import { footprintWorldBBox } from "../../edit/arrange";
import { courtyardFitsOutline, pointInOutline } from "../../autoplace/geometry";
import { padWorldPosition, padWorldShape, trackShape, viaShape } from "../../geometry-copper";
import { polygonBBox } from "../../zones/geometry";
import type { PcbBoard, Track, Via } from "../../types";
import type { CopperItemRef } from "../../connectivity-board";
import type { LayerId } from "../../layers";
import type { DrcCheckContext, DrcViolation } from "../types";
import { layerName, violationId } from "../format";

const TOP = "copperTop" as const;
const BOTTOM = "copperBottom" as const;

function boxCenter(box: BBox): Vec2 {
  return { x: Math.round((box.minX + box.maxX) / 2), y: Math.round((box.minY + box.maxY) / 2) };
}

function boxInside(board: PcbBoard, box: BBox): boolean {
  return courtyardFitsOutline(box, board.outline);
}

function footprintReferenceBox(footprint: PcbBoard["footprints"][number], text: Extract<PcbBoard["footprints"][number]["def"]["graphics"][number], { kind: "text" }>): BBox {
  const angle = text.rotationDeg * Math.PI / 180;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const points = [
    { x: -text.sizeX / 2, y: -text.sizeY / 2 },
    { x: text.sizeX / 2, y: -text.sizeY / 2 },
    { x: text.sizeX / 2, y: text.sizeY / 2 },
    { x: -text.sizeX / 2, y: text.sizeY / 2 },
  ].map((corner) => transformPoint({
    x: text.at.x + corner.x * c + corner.y * s,
    y: text.at.y - corner.x * s + corner.y * c,
  }, footprint.at, footprint.rotationDeg, footprint.side === "bottom"));
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

export function trackInsideBoard(board: PcbBoard, track: Track): boolean {
  return boxInside(board, shapeBBox(trackShape(track)));
}

export function viaInsideBoard(board: PcbBoard, via: Via): boolean {
  return boxInside(board, shapeBBox(viaShape(via)));
}

function violation(
  kind: DrcViolation["kind"],
  severity: DrcViolation["severity"],
  items: CopperItemRef[],
  location: Vec2,
  summary: string,
  detail: string,
  extra: string,
  layer?: LayerId,
): DrcViolation {
  return {
    id: violationId(kind, items, 0, 1, extra),
    kind,
    severity,
    items,
    ...(items.length === 0 ? { objectIds: [extra] } : {}),
    ...(layer ? { layer } : {}),
    location,
    measuredNm: 0,
    thresholdNm: 1,
    summary,
    detail,
  };
}

function enabledCopper(board: PcbBoard): ReadonlySet<LayerId> {
  return new Set<LayerId>(board.stackup === 2 ? [TOP, BOTTOM] : [TOP, "in1", "in2", BOTTOM]);
}

export function checkBoardContainmentAndLayers(ctx: DrcCheckContext): DrcViolation[] {
  const { board } = ctx;
  const out: DrcViolation[] = [];
  const copper = enabledCopper(board);

  for (const footprint of board.footprints) {
    const bodyBox = footprintWorldBBox(footprint);
    if (!boxInside(board, bodyBox) && footprint.bodyMayOverhang !== true) {
      const forbidden = footprint.bodyMayOverhang === false;
      out.push(violation(
        "footprintOutsideBoard",
        forbidden ? "error" : "warning",
        [],
        footprint.at,
        `${footprint.ref} body extends outside the board.`,
        forbidden
          ? `${footprint.ref} is configured not to overhang, but its body crosses the board outline. Move it fully inside.`
          : `${footprint.ref}'s body crosses the outline. Connector bodies may intentionally overhang, but review this placement; set body overhang allowed only when intentional.`,
        footprint.id,
      ));
    }
    for (const pad of footprint.def.pads) {
      const ref: CopperItemRef = { kind: "pad", instanceId: footprint.id, padNumber: pad.number };
      const padBox = shapeBBox(padWorldShape(footprint, pad));
      if (!boxInside(board, padBox)) {
        out.push(violation(
          "padOutsideBoard",
          "error",
          [ref],
          padWorldPosition(footprint, pad),
          `${footprint.ref}.${pad.number || "hole"} is outside the board.`,
          `Solder pads must be fully supported by the PCB material. Move ${footprint.ref} so this pad is inside the outline.`,
          `${footprint.id}.${pad.number}`,
        ));
      }
      if (pad.drill) {
        const center = padWorldPosition(footprint, pad);
        const diameter = Math.max(pad.drill.diameter, pad.drill.width ?? 0, pad.drill.height ?? 0);
        const radius = diameter / 2;
        const holeBox = { minX: center.x - radius, minY: center.y - radius, maxX: center.x + radius, maxY: center.y + radius };
        if (!boxInside(board, holeBox)) {
          out.push(violation(
            "holeOutsideBoard",
            "error",
            [ref],
            center,
            `Hole at ${footprint.ref}.${pad.number || "NPTH"} crosses the board edge.`,
            `Drilled holes must sit fully inside the board outline. Move the footprint or resize the board.`,
            `${footprint.id}.${pad.number}.hole`,
          ));
        }
      }
    }
    for (const graphic of footprint.def.graphics) {
      if (graphic.kind !== "text" || graphic.textKind !== "reference") continue;
      const refBox = footprintReferenceBox(footprint, graphic);
      if (!boxInside(board, refBox)) {
        out.push(violation(
          "referenceTextOutsideBoard", "warning", [], boxCenter(refBox),
          `${footprint.ref} reference designator extends outside the outline.`,
          `The footprint reference text may be clipped from the manufactured silkscreen. Move the reference inside the board if assembly needs it.`,
          `${footprint.id}.reference`, graphic.layer,
        ));
      }
    }
  }

  for (const track of board.tracks) {
    const ref: CopperItemRef = { kind: "track", id: track.id };
    if (!copper.has(track.layer)) {
      out.push(violation(
        "disabledLayer", "error", [ref], boxCenter(shapeBBox(trackShape(track))),
        `Track is on unavailable layer ${layerName(track.layer)}.`,
        `This board's ${board.stackup}-layer stackup does not enable ${layerName(track.layer)}. Move or remove the track.`,
        track.id, track.layer,
      ));
    }
    if (!trackInsideBoard(board, track)) {
      out.push(violation(
        "trackOutsideBoard", "error", [ref], boxCenter(shapeBBox(trackShape(track))),
        `Track crosses the board outline.`,
        `Copper tracks must remain fully inside the manufactured board. Pull this trace inward.`,
        track.id, track.layer,
      ));
    }
  }

  for (const via of board.vias) {
    const ref: CopperItemRef = { kind: "via", id: via.id };
    if (!viaInsideBoard(board, via)) {
      out.push(violation(
        "viaOutsideBoard", "error", [ref], via.at,
        `Via crosses the board outline.`,
        `The entire via pad and drill must be inside the PCB material. Move or remove this via.`,
        via.id, via.layers[0],
      ));
    }
    if (!copper.has(via.layers[0]) || !copper.has(via.layers[1])) {
      out.push(violation(
        "disabledLayer", "error", [ref], via.at,
        `Via uses a layer unavailable in this stackup.`,
        `This via spans ${layerName(via.layers[0])} to ${layerName(via.layers[1])}, which is not legal on a ${board.stackup}-layer board.`,
        `${via.id}.layer`, via.layers[0],
      ));
    } else if (!(via.layers.includes(TOP) && via.layers.includes(BOTTOM))) {
      out.push(violation(
        "unsupportedViaSpan", "error", [ref], via.at,
        `Blind or buried via span is not enabled.`,
        `Only through vias from Top Copper to Bottom Copper are currently supported by Sirkit's manufacturing profiles.`,
        `${via.id}.span`, via.layers[0],
      ));
    }
  }

  for (const zone of board.zones) {
    const location = zone.polygon[0] ?? { x: 0, y: 0 };
    if (!copper.has(zone.layer)) {
      out.push(violation(
        "disabledLayer", "error", [], location,
        `Copper zone is on unavailable layer ${layerName(zone.layer)}.`,
        `Move the zone to an enabled copper layer for this ${board.stackup}-layer board.`,
        `${zone.id}.layer`, zone.layer,
      ));
    }
    if (zone.polygon.length > 0 && (!zone.polygon.every((point) => pointInOutline(point, board.outline)) || !boxInside(board, polygonBBox(zone.polygon)))) {
      out.push(violation(
        "zoneOutsideBoard", "error", [], location,
        `Copper zone ${zone.id} crosses the board outline.`,
        `Zone intent polygons must remain inside the board before a pour can be considered manufacturable.`,
        zone.id, zone.layer,
      ));
    }
  }

  for (const text of board.texts) {
    const halfW = text.sizeX / 2;
    const halfH = text.sizeY / 2;
    const box = { minX: text.at.x - halfW, minY: text.at.y - halfH, maxX: text.at.x + halfW, maxY: text.at.y + halfH };
    if (!boxInside(board, box)) {
      out.push(violation(
        "referenceTextOutsideBoard", "warning", [], text.at,
        `Board text "${text.text}" extends outside the outline.`,
        `Text outside the board will be clipped or omitted by fabrication. Move it inside if it is required.`,
        text.id, text.layer,
      ));
    }
  }

  return out;
}
