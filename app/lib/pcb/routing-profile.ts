import type { PcbBoard, RoutingPreferences } from "./types";
import { getNetClass } from "./netclass";
import { classDefaultPadstack } from "./padstack/defaults";
import { getPadstack } from "./padstack/registry";

export const DEFAULT_ROUTING_PREFERENCES: Readonly<RoutingPreferences> = {
  version: 1,
  trackWidthMode: "net-class",
  viaMode: "net-class",
};

export interface ResolvedRoutingProfile {
  trackWidth: number;
  clearance: number;
  viaSize: number;
  viaDrill: number;
  viaPadstackId?: string;
  widthSource: "net-class" | "custom";
  viaSource: "net-class" | "rule-override" | "padstack";
  explanation: string;
}

export function routingPreferences(board: PcbBoard): RoutingPreferences {
  return board.routingPreferences ?? DEFAULT_ROUTING_PREFERENCES;
}

/** Resolve exactly what a newly-started route will use. */
export function resolveRoutingProfile(board: PcbBoard, netId: number): ResolvedRoutingProfile {
  const preferences = routingPreferences(board);
  const netClass = getNetClass(board, netId);
  const customWidth =
    preferences.trackWidthMode === "custom" &&
    Number.isFinite(preferences.customTrackWidthNm) &&
    (preferences.customTrackWidthNm ?? 0) > 0
      ? Math.round(preferences.customTrackWidthNm as number)
      : undefined;

  const selectedPadstack =
    preferences.viaMode === "padstack" && preferences.viaPadstackId
      ? getPadstack(board, preferences.viaPadstackId)
      : undefined;
  const classPadstack = preferences.viaMode === "net-class" ? classDefaultPadstack(board, netId) : undefined;
  const padstack = selectedPadstack ?? classPadstack;

  return {
    trackWidth: customWidth ?? netClass.trackWidth,
    clearance: netClass.clearance,
    viaSize: padstack?.outerNm ?? netClass.viaSize,
    viaDrill: padstack?.drillNm ?? netClass.viaDrill,
    ...(padstack ? { viaPadstackId: padstack.id } : {}),
    widthSource: customWidth === undefined ? "net-class" : "custom",
    viaSource: selectedPadstack ? "padstack" : classPadstack ? "net-class" : "rule-override",
    explanation:
      netClass.explanation ||
      `${netClass.name} defaults: ${(netClass.trackWidth / 1e6).toFixed(2)} mm track`,
  };
}
