// Fab preset loader (PCB Stage 14) — JSON-in-repo, versioned, validated at
// import time so a malformed preset fails the test suite, not an export.
// Mirrors Stage 12's drc/presets loader.

import type { LayerId } from "../../layers";
import { LAYERS } from "../../layers";
import type { BomColumn, FabPreset, FabPresetId, LayerBundleEntry, PosFormat } from "../types";
import jlcpcb2l from "./jlcpcb-2l.fab.json";
import jlcpcb4l from "./jlcpcb-4l.fab.json";
import pcbwayStandard from "./pcbway-standard.fab.json";
import oshpark4l from "./oshpark-4l.fab.json";

const VALID_LAYER_IDS: ReadonlySet<string> = new Set(LAYERS.map((l) => l.id));
const VALID_KICAD_NAMES: ReadonlySet<string> = new Set(LAYERS.map((l) => l.kicadName));
const VALID_BOM_COLUMNS: ReadonlySet<string> = new Set([
  "refs", "quantity", "value", "footprint", "mpn", "supplier", "supplierPart", "description",
]);
const VALID_POS_FORMATS: ReadonlySet<string> = new Set(["jlcpcb-cpl", "kicad-default", "pcbway-standard"]);

function buildPreset(raw: unknown): FabPreset {
  const p = raw as FabPreset;
  const fail = (msg: string): never => {
    throw new Error(`Fab preset ${JSON.stringify((raw as { id?: unknown }).id)}: ${msg}`);
  };
  if (typeof p.id !== "string" || typeof p.name !== "string" || typeof p.fab !== "string") {
    fail("id/name/fab missing");
  }
  if (typeof p.drcPresetId !== "string") fail("drcPresetId missing");
  if (p.zipRootFolder !== null && typeof p.zipRootFolder !== "string") fail("zipRootFolder must be string|null");
  if (!Array.isArray(p.layerBundle) || p.layerBundle.length === 0) fail("layerBundle empty");
  for (const entry of p.layerBundle as LayerBundleEntry[]) {
    if (!VALID_LAYER_IDS.has(entry.layerId)) fail(`unknown layerId "${entry.layerId}"`);
    if (!VALID_KICAD_NAMES.has(entry.kicadName)) fail(`unknown kicadName "${entry.kicadName}"`);
    if (typeof entry.fileSuffix !== "string" || entry.fileSuffix.length === 0) fail("fileSuffix empty");
    if (typeof entry.enabled !== "boolean") fail("enabled must be boolean");
  }
  if (!VALID_POS_FORMATS.has(p.pos.format)) fail(`unknown pos format "${p.pos.format}"`);
  if (!p.pos.filename.includes("{boardName}")) fail("pos.filename must contain {boardName}");
  if (!p.bom.filename.includes("{boardName}")) fail("bom.filename must contain {boardName}");
  for (const col of p.bom.columns) {
    if (!VALID_BOM_COLUMNS.has(col)) fail(`unknown BOM column "${col}"`);
  }
  return {
    ...p,
    layerBundle: p.layerBundle.map((e) => ({ ...e, layerId: e.layerId as LayerId })),
    pos: { ...p.pos, format: p.pos.format as PosFormat },
    bom: { ...p.bom, columns: p.bom.columns.map((c) => c as BomColumn) },
  };
}

export const FAB_PRESETS: FabPreset[] = [
  buildPreset(jlcpcb2l),
  buildPreset(jlcpcb4l),
  buildPreset(pcbwayStandard),
  buildPreset(oshpark4l),
];

export const DEFAULT_FAB_PRESET_ID: FabPresetId = "jlcpcb-2l";

export function getFabPreset(id: FabPresetId | string): FabPreset {
  const preset = FAB_PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`Unknown fab preset: ${id}`);
  return preset;
}

/** The fab preset soft-linked to a DRC preset (drcPresetId match), if any. */
export function getFabPresetForDrc(drcId: string): FabPreset | undefined {
  return FAB_PRESETS.find((p) => p.drcPresetId === drcId);
}
