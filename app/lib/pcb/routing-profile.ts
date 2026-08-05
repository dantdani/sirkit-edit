import type { PcbBoard, RoutingPreferences } from "./types";
import { getNetClass } from "./netclass";
import { classDefaultPadstack } from "./padstack/defaults";
import { getPadstack } from "./padstack/registry";

export const DEFAULT_ROUTING_PREFERENCES: Readonly<RoutingPreferences> = {
  version: 1,
  trackWidthMode: "net-class",
  viaMode: "net-class",
  routeMode: "walk_around",
  posture: "octilinear_a",
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
  routeMode: NonNullable<RoutingPreferences["routeMode"]>;
  posture: NonNullable<RoutingPreferences["posture"]>;
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
  const compiledViaMinimum = netClass.constraintProgramHash !== undefined;

  return {
    // A custom interactive choice may tighten the compiled minimum, never weaken it.
    trackWidth: Math.max(customWidth ?? netClass.trackWidth, netClass.trackWidth),
    clearance: netClass.clearance,
    // Legacy class values and class padstacks intentionally differ (the seeded
    // default is 0.6/0.3 mm). Only an activated compiled program turns the
    // resolved values into hard minima that may clamp a chosen padstack.
    viaSize: padstack ? (compiledViaMinimum ? Math.max(padstack.outerNm, netClass.viaSize) : padstack.outerNm) : netClass.viaSize,
    viaDrill: padstack ? (compiledViaMinimum ? Math.max(padstack.drillNm, netClass.viaDrill) : padstack.drillNm) : netClass.viaDrill,
    ...(padstack ? { viaPadstackId: padstack.id } : {}),
    widthSource: customWidth === undefined || customWidth < netClass.trackWidth ? "net-class" : "custom",
    viaSource: selectedPadstack ? "padstack" : classPadstack ? "net-class" : "rule-override",
    routeMode: preferences.routeMode ?? "walk_around",
    posture: preferences.posture ?? "octilinear_a",
    explanation:
      customWidth !== undefined && customWidth < netClass.trackWidth
        ? `Requested custom width was below the compiled ${(netClass.trackWidth / 1e6).toFixed(2)} mm minimum and was tightened. ${netClass.explanation}`
        : netClass.explanation || `${netClass.name} defaults: ${(netClass.trackWidth / 1e6).toFixed(2)} mm track`,
  };
}
