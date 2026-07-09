// Fab presets (PCB Stage 12) — JSON-in-repo, versioned. JSON stores millimeters
// (`*Mm` fields); this loader converts to integer nanometers (`*Nm`) at import
// time so swapping a preset never requires a code change. Re-verify each JSON
// against the fab's `specUrl` and bump `verifiedAt` when specs move.

import type { DrcPreset, DrcPresetId, DrcRuleSet, DrcRules } from "../types";
import type { NetClassId } from "../../netclass";
import jlcpcb2l from "./jlcpcb-2l.json";
import jlcpcb4l from "./jlcpcb-4l.json";
import pcbwayStandard from "./pcbway-standard.json";
import oshpark4l from "./oshpark-4l.json";

const MM_TO_NM = 1_000_000;

interface RawPreset {
  id: DrcPresetId;
  name: string;
  fab: string;
  version: number;
  verifiedAt: string;
  specUrl: string;
  rules: {
    default: Record<string, number>;
    perClass?: Record<string, Record<string, number>>;
    perNet?: Record<string, Record<string, number>>;
  };
}

const REQUIRED_KEYS: (keyof DrcRuleSet)[] = [
  "clearanceNm",
  "minTrackWidthNm",
  "minViaOuterNm",
  "minViaDrillNm",
  "minAnnularRingNm",
  "minHoleToHoleNm",
  "minEdgeClearanceNm",
  "minSilkPadClearanceNm",
  "minCourtyardClearanceNm",
];

/**
 * Convert every `*Mm` field to its integer-nanometer `*Nm` counterpart. Only
 * present keys are emitted (partial in → partial out), so it serves both the
 * full `default` block and sparse per-class/per-net overrides.
 */
export function convertMmToNm(rulesMm: Record<string, unknown>): Partial<DrcRuleSet> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(rulesMm)) {
    if (k.endsWith("Mm") && typeof v === "number") {
      out[`${k.slice(0, -2)}Nm`] = Math.round(v * MM_TO_NM);
    }
  }
  return out as Partial<DrcRuleSet>;
}

function buildRuleSet(mm: Record<string, number>, presetId: string): DrcRuleSet {
  const converted = convertMmToNm(mm);
  for (const key of REQUIRED_KEYS) {
    const value = converted[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`Preset ${presetId}: default rule "${key}" is missing or invalid`);
    }
  }
  return converted as DrcRuleSet;
}

function buildRules(raw: RawPreset): DrcRules {
  const perClass: Partial<Record<NetClassId, Partial<DrcRuleSet>>> = {};
  for (const [cls, override] of Object.entries(raw.rules.perClass ?? {})) {
    perClass[cls as NetClassId] = convertMmToNm(override);
  }
  const perNet: Record<number, Partial<DrcRuleSet>> = {};
  for (const [netId, override] of Object.entries(raw.rules.perNet ?? {})) {
    perNet[Number(netId)] = convertMmToNm(override);
  }
  return {
    default: buildRuleSet(raw.rules.default, raw.id),
    perClass,
    ...(Object.keys(perNet).length > 0 ? { perNet } : {}),
  };
}

function buildPreset(raw: RawPreset): DrcPreset {
  return {
    id: raw.id,
    name: raw.name,
    fab: raw.fab,
    version: raw.version,
    verifiedAt: raw.verifiedAt,
    specUrl: raw.specUrl,
    rules: buildRules(raw),
  };
}

export const PRESETS: DrcPreset[] = [
  buildPreset(jlcpcb2l as RawPreset),
  buildPreset(jlcpcb4l as RawPreset),
  buildPreset(pcbwayStandard as RawPreset),
  buildPreset(oshpark4l as RawPreset),
];

export const DEFAULT_PRESET_ID: DrcPresetId = "jlcpcb-2l";

export function getPreset(id: DrcPresetId): DrcPreset {
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`Unknown DRC preset: ${id}`);
  return preset;
}
