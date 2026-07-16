import type { PcbNetlist } from "../../netlist-bridge";
import type { DrcPreset } from "../../drc/types";
import type { PadShape, Vec2 } from "../../geometry";
import type { LayerId } from "../../layers";
import type { PcbBoard } from "../../types";
import type { FabPreset } from "../types";

export type FabDiagnosticSeverity = "info" | "warning" | "error";
export type FabDiagnosticCategory =
  | "snapshot"
  | "drc"
  | "geometry"
  | "format"
  | "equivalence"
  | "package";

export interface FabDiagnostic {
  code: string;
  severity: FabDiagnosticSeverity;
  category: FabDiagnosticCategory;
  message: string;
  sourceIds?: string[];
  file?: string;
}

export type NativeFabMode = "strict-modern" | "broad-compatibility";

export interface NativeFabRecipe {
  schemaVersion: "sirkit.native-fab-recipe.v1";
  id: string;
  version: number;
  mode: NativeFabMode;
  reproducible: boolean;
  gerberRevision: "2026.05";
  xncRevision: "2021.11";
  coordinateDecimals: 6;
  includeGerberDrill: boolean;
  includeXnc: boolean;
  includeComponentLayers: boolean;
  includePlacement: boolean;
  includeBom: boolean;
}

export interface ManufacturingSnapshot {
  schemaVersion: "sirkit.manufacturing-snapshot.v1";
  boardName: string;
  sourceHash: string;
  revisionId: string;
  sameCoordinatesId: string;
  board: Readonly<PcbBoard>;
  netlist: Readonly<PcbNetlist>;
  fabPreset: Readonly<FabPreset>;
  drcPreset: Readonly<DrcPreset>;
  recipe: Readonly<NativeFabRecipe>;
  transform: {
    /** Sirkit +Y is down. Manufacturing +Y is up, with origin at board lower-left. */
    originXNm: number;
    originYNm: number;
    boardWidthNm: number;
    boardHeightNm: number;
  };
}

export type MirApertureFunction =
  | "Conductor"
  | "SMDPad"
  | "ComponentPad"
  | "ViaPad"
  | "Profile"
  | "Material"
  | "ComponentMain"
  | "ComponentPin"
  | "ComponentOutline"
  | "ComponentDrill"
  | "ViaDrill"
  | "NonConductor"
  | "MechanicalDrill";

export interface MirObjectAttributes {
  net?: string;
  ref?: string;
  pin?: string;
  pinFunction?: string;
  footprint?: string;
  rotationDeg?: number;
}

export interface MirStroke {
  kind: "stroke";
  id: string;
  start: Vec2;
  end: Vec2;
  widthNm: number;
  apertureFunction: MirApertureFunction;
  attributes: MirObjectAttributes;
  sourceIds: string[];
}

export interface MirFlash {
  kind: "flash";
  id: string;
  at: Vec2;
  shape: PadShape;
  rotationDeg: number;
  apertureFunction: MirApertureFunction;
  attributes: MirObjectAttributes;
  sourceIds: string[];
}

export interface MirRegion {
  kind: "region";
  id: string;
  outer: Vec2[];
  holes: Vec2[][];
  apertureFunction: MirApertureFunction;
  attributes: MirObjectAttributes;
  sourceIds: string[];
}

export type MirPrimitive = MirStroke | MirFlash | MirRegion;

export interface MirLayer {
  id: string;
  sourceLayer?: LayerId;
  filenameRole: string;
  fileFunction: string;
  polarity: "Positive" | "Negative";
  primitives: MirPrimitive[];
}

export interface MirDrillHit {
  kind: "hit";
  id: string;
  at: Vec2;
  diameterNm: number;
  plated: boolean;
  span: [number, number];
  sourceIds: string[];
}

export interface MirDrillSlot {
  kind: "slot";
  id: string;
  start: Vec2;
  end: Vec2;
  diameterNm: number;
  plated: boolean;
  span: [number, number];
  sourceIds: string[];
}

export type MirDrill = MirDrillHit | MirDrillSlot;

export interface ManufacturingIr {
  schemaVersion: "sirkit.manufacturing-ir.v1";
  snapshotHash: string;
  revisionId: string;
  boardName: string;
  sameCoordinatesId: string;
  layerCount: 2 | 4;
  boardSizeMm: { x: number; y: number };
  layers: MirLayer[];
  drills: MirDrill[];
  diagnostics: FabDiagnostic[];
}

export interface NativeFabFile {
  path: string;
  kind: "gerber" | "xnc" | "job" | "placement" | "bom" | "manifest" | "readme";
  mediaType: string;
  bytes: Uint8Array;
  sha256: string;
}

export interface NativeFabStageReport {
  stage: string;
  status: "passed" | "failed";
  elapsedMs: number;
  diagnostics: FabDiagnostic[];
}

export interface NativeFabManifest {
  schemaVersion: "sirkit.native-fab-manifest.v1";
  packageId: string;
  snapshotHash: string;
  recipe: { id: string; version: number; mode: NativeFabMode };
  generator: { vendor: "Sirkit"; application: "Sirkit Fab Compiler"; version: string };
  standards: { gerber: "2026.05"; xnc: "2021.11"; gerberJob: "2020.08" };
  signoff: "native-beta-verified";
  files: Array<{ path: string; kind: NativeFabFile["kind"]; bytes: number; sha256: string }>;
  diagnostics: { errors: number; warnings: number; infos: number };
}

export interface NativeFabCompileInput {
  board: PcbBoard;
  netlist: PcbNetlist;
  fabPreset: FabPreset;
  drcPreset: DrcPreset;
  boardName: string;
  recipe?: NativeFabRecipe;
}

export interface NativeFabCompileResult {
  zipBytes: Uint8Array;
  filename: string;
  packageSha256: string;
  manifest: NativeFabManifest;
  files: NativeFabFile[];
  stages: NativeFabStageReport[];
  diagnostics: FabDiagnostic[];
}

export class NativeFabBlockedError extends Error {
  readonly diagnostics: FabDiagnostic[];

  constructor(message: string, diagnostics: FabDiagnostic[]) {
    super(message);
    this.name = "NativeFabBlockedError";
    this.diagnostics = diagnostics;
  }
}
