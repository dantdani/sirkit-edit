import type { ManufacturingIr, ManufacturingSnapshot } from "./types";
import { csvField, computeBomRows, emitBomCsv } from "../emit-bom";
import { compareCodePoints, compareNatural } from "@/app/lib/stable-compare";
import { spreadsheetText } from "../../../spreadsheet-cell";

const mm6 = (nm: number): string => {
  const text = (nm / 1_000_000).toFixed(6);
  return text === "-0.000000" ? "0.000000" : text;
};

const rotation = (degrees: number): string => {
  let value = ((degrees % 360) + 360) % 360;
  if (value > 180) value -= 360;
  const text = value.toFixed(6).replace(/\.?0+$/, "");
  return text === "-0" || text === "" ? "0" : text;
};

export function emitNativePlacement(snapshot: ManufacturingSnapshot): string {
  const rows = snapshot.board.footprints
    .filter((fp) => !fp.def.attributes.excludeFromPos && fp.def.pads.length > 0)
    .sort((a, b) => compareNatural(a.ref, b.ref));
  const lines = [["Designator", "Mid X (mm)", "Mid Y (mm)", "Layer", "Rotation (deg CCW)", "Footprint"]
    .map(csvField)
    .join(",")];
  for (const fp of rows) {
    const point = {
      x: fp.at.x - snapshot.transform.originXNm,
      y: snapshot.transform.originYNm - fp.at.y,
    };
    // [B19-D I5c row 33] text columns never start a formula; coordinates and rotation stay numbers
    lines.push([
      spreadsheetText(fp.ref),
      mm6(point.x),
      mm6(point.y),
      fp.side === "top" ? "Top" : "Bottom",
      rotation(fp.rotationDeg),
      spreadsheetText(fp.def.name),
    ].map(csvField).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

export function emitNativeBom(snapshot: ManufacturingSnapshot): string {
  return emitBomCsv(
    computeBomRows(snapshot.board as never, snapshot.netlist as never),
    snapshot.fabPreset.bom.columns,
  );
}

export interface JobFileEntry {
  path: string;
  fileFunction: string;
  filePolarity?: "Positive" | "Negative";
  fileFormat: "Gerber" | "XNC";
}

export function emitGerberJob(
  snapshot: ManufacturingSnapshot,
  mir: ManufacturingIr,
  entries: JobFileEntry[],
): string {
  const job = {
    Header: {
      GenerationSoftware: {
        Vendor: "Sirkit",
        Application: "Sirkit Fab Compiler",
        Version: "0.1.0",
      },
      Comment: "Native beta package verified by independent Sirkit parse-back; no unspecified material properties are inferred.",
    },
    GeneralSpecs: {
      ProjectId: {
        Name: snapshot.boardName,
        GUID: snapshot.sameCoordinatesId,
        Revision: snapshot.revisionId,
      },
      Size: { X: mir.boardSizeMm.x, Y: mir.boardSizeMm.y },
      LayerNumber: mir.layerCount,
    },
    FilesAttributes: [...entries]
      .sort((a, b) => compareCodePoints(a.path, b.path))
      .map((entry) => ({
        Path: entry.path,
        FileFunction: entry.fileFunction,
        ...(entry.filePolarity ? { FilePolarity: entry.filePolarity } : {}),
        FileFormat: entry.fileFormat,
      })),
  };
  return `${JSON.stringify(job, null, 2)}\n`;
}
