// Fab-bundle model (PCB Stage 14) — PINNED schema. Deliberately separate from
// Stage 12's DrcPreset: DRC presets describe rule thresholds; fab presets
// describe deliverable packaging (filenames, layer bundles, zip layout).
// The two are soft-linked by `drcPresetId` so switching one switches the other.
// Filename conventions are DATA (per-fab JSON), never code.

import type { LayerId } from "../layers";
import type { PcbBoard } from "../types";
import type { PcbNetlist } from "../netlist-bridge";
import type { DrcPreset, DrcPresetId, DrcViolation } from "../drc/types";

export type FabPresetId = "jlcpcb-2l" | "jlcpcb-4l" | "pcbway-standard" | "oshpark-4l";

export interface LayerBundleEntry {
  layerId: LayerId;
  kicadName: string; // 'F.Cu', 'B.SilkS', …
  fileSuffix: string; // '.GTL' for JLC top copper, '-F_Cu.gbr' for KiCad-default fabs
  enabled: boolean; // 4-layer fabs enable in1/in2; 2-layer fabs omit or disable
}

export type BomColumn =
  | "refs"
  | "quantity"
  | "value"
  | "footprint"
  | "mpn"
  | "supplier"
  | "supplierPart"
  | "description";

export type PosFormat = "jlcpcb-cpl" | "kicad-default" | "pcbway-standard";

export interface FabPreset {
  id: FabPresetId;
  name: string; // "JLCPCB economy 2-layer"
  fab: string; // "JLCPCB"
  version: number;
  verifiedAt: string; // ISO date the spec was last cross-checked
  specUrl: string;
  drcPresetId: DrcPresetId; // soft link — switching DRC preset switches this too
  zipRootFolder: string | null; // "gerber/" or null for a flat zip
  layerBundle: LayerBundleEntry[];
  drill: { format: "excellon-2:4-metric" | "excellon-2:4-inch"; separateNPTH: boolean };
  pos: { splitBySide: boolean; format: PosFormat; filename: string }; // filename supports {boardName}
  bom: { columns: BomColumn[]; filename: string }; // filename supports {boardName}
  notes: string; // human string, surfaced in the dialog + zip README
}

export interface BundleInput {
  board: PcbBoard;
  netlist: PcbNetlist;
  fabPreset: FabPreset;
  drcPreset: DrcPreset;
  overrideDrcFail?: boolean; // required to proceed when drc.ok === false
  boardName: string;
}

export interface BundleResult {
  zipBytes: Uint8Array; // final .zip contents
  filename: string; // "<boardName>-<fabId>-<yyyy-mm-dd>.zip"
  stats: {
    drcErrors: number;
    drcWarnings: number;
    gerberFiles: string[];
    drillFiles: string[];
    posFiles: string[];
    bomFile: string;
    totalBytes: number;
    elapsedMs: number;
  };
}

// ── Typed failures (API route maps these to HTTP statuses) ──────────────────

/** DRC gate tripped and `overrideDrcFail` was not set → HTTP 400. */
export class FabExportGatedByDrc extends Error {
  readonly violations: DrcViolation[];

  constructor(violations: DrcViolation[]) {
    const errors = violations.filter((v) => v.severity === "error").length;
    super(`DRC gate: ${errors} error${errors === 1 ? "" : "s"} — export blocked (override not set)`);
    this.name = "FabExportGatedByDrc";
    this.violations = violations;
  }
}

/** kicad-cli missing/failed/timed out → HTTP 500. */
export class KicadCliError extends Error {
  readonly kind: "cli-missing" | "cli-failed" | "timeout";
  readonly stderr: string;

  constructor(kind: KicadCliError["kind"], message: string, stderr = "") {
    super(message);
    this.name = "KicadCliError";
    this.kind = kind;
    this.stderr = stderr;
  }
}
