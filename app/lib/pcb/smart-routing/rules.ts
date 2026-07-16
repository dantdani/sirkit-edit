import type { LayerId } from "../layers";
import type { PcbBoard } from "../types";
import type { DrcRules } from "../drc/types";
import { effectiveRules } from "../drc/rules";
import { getNetClass } from "../netclass";
import { resolveRoutingProfile } from "../routing-profile";
import {
  SMART_ROUTING_SCHEMA_VERSION,
  type EffectiveRoutingRules,
  type RoutingRuleField,
  type RoutingRuleSource,
} from "./types";

const FLOOR = {
  trackWidthNm: 150_000,
  clearanceNm: 150_000,
  viaSizeNm: 500_000,
  viaDrillNm: 250_000,
  edgeClearanceNm: 250_000,
  gridNm: 25_000,
} as const;

export interface SmartRoutingRuleOptions {
  drcRules?: DrcRules;
  session?: Partial<Record<RoutingRuleField, number>>;
}

function source(
  field: RoutingRuleField,
  kind: RoutingRuleSource["source"],
  valueNm: number,
  explanation: string,
): RoutingRuleSource {
  return { field, source: kind, valueNm, explanation };
}

/** Deterministic precedence: manufacturing floor -> net class -> DRC -> board preference -> session. */
export function resolveSmartRoutingRules(
  board: PcbBoard,
  netId: number,
  _layer: LayerId,
  options: SmartRoutingRuleOptions = {},
): EffectiveRoutingRules {
  const netClass = getNetClass(board, netId);
  const profile = resolveRoutingProfile(board, netId);
  const sources: RoutingRuleSource[] = [];
  for (const [field, value] of Object.entries(FLOOR) as [RoutingRuleField, number][]) {
    sources.push(source(field, "manufacturing-floor", value, `${field} manufacturing floor`));
  }

  let trackWidthNm: number = Math.max(FLOOR.trackWidthNm, netClass.trackWidth);
  let clearanceNm: number = Math.max(FLOOR.clearanceNm, netClass.clearance);
  let viaSizeNm: number = Math.max(FLOOR.viaSizeNm, netClass.viaSize);
  let viaDrillNm: number = Math.max(FLOOR.viaDrillNm, netClass.viaDrill);
  let edgeClearanceNm: number = FLOOR.edgeClearanceNm;
  const gridNm: number = FLOOR.gridNm;
  const hardMinimum: Record<RoutingRuleField, number> = { ...FLOOR };
  sources.push(source("trackWidthNm", "net-class", trackWidthNm, `${netClass.name} net class`));
  sources.push(source("clearanceNm", "net-class", clearanceNm, `${netClass.name} net class`));
  sources.push(source("viaSizeNm", "net-class", viaSizeNm, `${netClass.name} net class`));
  sources.push(source("viaDrillNm", "net-class", viaDrillNm, `${netClass.name} net class`));

  if (options.drcRules) {
    const drc = effectiveRules(options.drcRules, netId, netClass);
    trackWidthNm = Math.max(trackWidthNm, drc.minTrackWidthNm);
    clearanceNm = Math.max(clearanceNm, drc.clearanceNm);
    viaSizeNm = Math.max(viaSizeNm, drc.minViaOuterNm);
    viaDrillNm = Math.max(viaDrillNm, drc.minViaDrillNm);
    edgeClearanceNm = Math.max(edgeClearanceNm, drc.minEdgeClearanceNm);
    hardMinimum.trackWidthNm = Math.max(hardMinimum.trackWidthNm, drc.minTrackWidthNm);
    hardMinimum.clearanceNm = Math.max(hardMinimum.clearanceNm, drc.clearanceNm);
    hardMinimum.viaSizeNm = Math.max(hardMinimum.viaSizeNm, drc.minViaOuterNm);
    hardMinimum.viaDrillNm = Math.max(hardMinimum.viaDrillNm, drc.minViaDrillNm);
    hardMinimum.edgeClearanceNm = Math.max(hardMinimum.edgeClearanceNm, drc.minEdgeClearanceNm);
    sources.push(source("trackWidthNm", "drc", trackWidthNm, "effective DRC minimum"));
    sources.push(source("clearanceNm", "drc", clearanceNm, "effective DRC clearance"));
    sources.push(source("viaSizeNm", "drc", viaSizeNm, "effective DRC via minimum"));
    sources.push(source("viaDrillNm", "drc", viaDrillNm, "effective DRC drill minimum"));
    sources.push(source("edgeClearanceNm", "drc", edgeClearanceNm, "effective DRC edge clearance"));
  }

  trackWidthNm = profile.widthSource === "custom"
    ? Math.max(hardMinimum.trackWidthNm, profile.trackWidth)
    : Math.max(trackWidthNm, profile.trackWidth);
  viaSizeNm = Math.max(hardMinimum.viaSizeNm, profile.viaSize);
  viaDrillNm = Math.max(hardMinimum.viaDrillNm, profile.viaDrill);
  sources.push(source("trackWidthNm", "board-preference", trackWidthNm, profile.explanation));
  sources.push(source("viaSizeNm", "board-preference", viaSizeNm, `${profile.viaSource} via outer diameter`));
  sources.push(source("viaDrillNm", "board-preference", viaDrillNm, `${profile.viaSource} via drill`));

  const values: Record<RoutingRuleField, number> = {
    trackWidthNm,
    clearanceNm,
    viaSizeNm,
    viaDrillNm,
    edgeClearanceNm,
    gridNm,
  };
  for (const field of Object.keys(values) as RoutingRuleField[]) {
    const session = options.session?.[field];
    if (session === undefined || !Number.isFinite(session) || session <= 0) continue;
    const requested = Math.round(session);
    values[field] = field === "clearanceNm" || field === "edgeClearanceNm"
      ? Math.max(values[field], requested)
      : Math.max(hardMinimum[field], requested);
    sources.push(source(field, "session", values[field], "explicit route-session preference"));
  }

  return {
    schemaVersion: SMART_ROUTING_SCHEMA_VERSION,
    ...values,
    sources: Object.freeze(sources),
    explanation: `${profile.explanation || netClass.name}; ${(values.trackWidthNm / 1e6).toFixed(2)} mm track, ${(values.clearanceNm / 1e6).toFixed(2)} mm clearance`,
  };
}
