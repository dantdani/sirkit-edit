// Pick-and-place CSV emission (PCB Stage 14).
//
// Coordinates are board coordinates in mm to 4 decimals (integer-nm model
// converted at emit time, Y as stored — JLC's assembly upload aligns the CPL
// to the gerbers interactively, and their own KiCad guide uses board coords).
// Rotation follows the Stage 13 rule: sirkit already stores KiCad-convention
// CCW-positive degrees, so values pass through normalized to (-180, 180] —
// the UI's one-click 90° CW turn (stored 270) emits as -90.0000.

import type { PcbBoard, FootprintInstance, FpGraphic } from "../types";
import type { PosFormat } from "./types";
import { csvField } from "./emit-bom";
import { assertValidBoardReferences } from "../integrity";
import { compareNatural } from "@/app/lib/stable-compare";
import { spreadsheetText } from "../../spreadsheet-cell";

const NM_PER_MM = 1_000_000;

function mm4(nm: number): string {
  const s = (nm / NM_PER_MM).toFixed(4);
  return s === "-0.0000" ? "0.0000" : s;
}

function deg4(deg: number): string {
  let d = ((deg % 360) + 360) % 360;
  if (d > 180) d -= 360;
  const s = d.toFixed(4);
  return s === "-0.0000" ? "0.0000" : s;
}

/** Library value text, for formats that carry a Val column. */
function valueOf(inst: FootprintInstance): string {
  const text = inst.def.graphics.find(
    (g): g is Extract<FpGraphic, { kind: "text" }> => g.kind === "text" && g.textKind === "value",
  );
  return text?.text ?? inst.def.name;
}

interface PosSpec {
  header: string[];
  row(inst: FootprintInstance): (string | number)[];
}

const FORMATS: Record<PosFormat, PosSpec> = {
  "jlcpcb-cpl": {
    header: ["Designator", "Mid X", "Mid Y", "Layer", "Rotation"],
    row: (i) => [spreadsheetText(i.ref), mm4(i.at.x), mm4(i.at.y), i.side === "bottom" ? "B" : "T", deg4(i.rotationDeg)],
  },
  "kicad-default": {
    header: ["Ref", "Val", "Package", "PosX", "PosY", "Rot", "Side"],
    // [B19-D I5c row 33] text columns never start a formula; coordinates and rotation stay numbers
    row: (i) => [spreadsheetText(i.ref), spreadsheetText(valueOf(i)), spreadsheetText(i.def.name), mm4(i.at.x), mm4(i.at.y), deg4(i.rotationDeg), i.side],
  },
  "pcbway-standard": {
    header: ["Designator", "Center-X(mm)", "Center-Y(mm)", "Rotation", "Layer"],
    row: (i) => [
      spreadsheetText(i.ref),
      mm4(i.at.x),
      mm4(i.at.y),
      deg4(i.rotationDeg),
      i.side === "bottom" ? "BottomLayer" : "TopLayer",
    ],
  },
};

export function emitPositionCsv(
  board: PcbBoard,
  format: PosFormat,
  side: "top" | "bottom" | "both",
): string {
  assertValidBoardReferences(board);
  const spec = FORMATS[format];
  const instances = board.footprints
    .filter((i) => !i.def.attributes.excludeFromPos && i.def.pads.length > 0)
    .filter((i) => side === "both" || i.side === side)
    .sort((a, b) => compareNatural(a.ref, b.ref, { caseInsensitive: true }));

  const lines = [spec.header.map(csvField).join(",")];
  for (const inst of instances) {
    lines.push(spec.row(inst).map(csvField).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
