// Fab-bundle model (PCB Stage 14) — PINNED schema. Deliberately separate from
// Stage 12's DrcPreset: DRC presets describe rule thresholds; fab presets
// describe deliverable packaging (filenames, layer bundles, zip layout).
// The two are soft-linked by `drcPresetId` so switching one switches the other.
// Filename conventions are DATA (per-fab JSON), never code.

import type { LayerId } from "../layers";
import type { PcbBoard } from "../types";
import type { PcbNetlist } from "../netlist-bridge";
import type { DrcPreset, DrcPresetId } from "../drc/types";
import type { ManufacturingReleaseManifest, ReadinessReport, ReleaseDisposition, ReleaseWaiver } from "../readiness/types";

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
  /** Whether `netlist` is the current authoritative schematic rather than a board-derived writer adapter. */
  schematicIntentAvailable?: boolean;
  releaseDisposition?: ReleaseDisposition;
  waivers?: ReleaseWaiver[];
  priorReadinessReport?: ReadinessReport;
  projectIdentity?: string;
  actor?: string;
  boardName: string;
}

export interface BundleResult {
  sourceRevision: string;
  readiness: ReadinessReport;
  releaseManifest: ManufacturingReleaseManifest;
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

/** kicad-cli missing/failed/timed out → HTTP 500. */
export class KicadCliError extends Error {
  readonly kind: "cli-missing" | "cli-failed" | "timeout";
  readonly stderr: string; readonly killConfirmed?: boolean; // [B24-D2 review, 2026-10-09] D24-31: a timeout only - false when the killed run's exit was not observed within the confirm wait (a possible orphan)

  constructor(kind: KicadCliError["kind"], message: string, stderr = "", killConfirmed?: boolean) {
    super(message);
    this.name = "KicadCliError";
    this.kind = kind;
    this.stderr = stderr; if (killConfirmed !== undefined) this.killConfirmed = killConfirmed;
  }
}
