import type { FullOracleRun } from "./types";

export interface CorroboratingNativeErcReport {
  source: "kicad-native-erc";
  toolVersion: string;
  graphDigest: string;
  state: "corroborates" | "disagrees" | "not_run" | "stale";
  nativeFindingRefs: string[];
  unmatchedNativeFindingRefs: string[];
  unmatchedAuthoritativeFindingIds: string[];
  authority: "corroborating_only";
}

export function classifyNativeErcCorroboration(input: { run: FullOracleRun; nativeGraphDigest?: string; toolVersion?: string; nativeFindingRefs?: string[]; matchedAuthoritativeFindingIds?: string[] }): CorroboratingNativeErcReport {
  const native = [...new Set(input.nativeFindingRefs ?? [])].sort();
  const matched = new Set(input.matchedAuthoritativeFindingIds ?? []);
  const unmatchedAuthoritativeFindingIds = input.run.findings.filter((item) => !matched.has(item.findingId)).map((item) => item.findingId).sort();
  const state = !input.nativeGraphDigest ? "not_run" as const : input.nativeGraphDigest !== input.run.graphDigest ? "stale" as const : native.length || unmatchedAuthoritativeFindingIds.length ? "disagrees" as const : "corroborates" as const;
  return { source: "kicad-native-erc", toolVersion: input.toolVersion ?? "not-run", graphDigest: input.nativeGraphDigest ?? "not-run", state, nativeFindingRefs: native, unmatchedNativeFindingRefs: native, unmatchedAuthoritativeFindingIds, authority: "corroborating_only" };
}
