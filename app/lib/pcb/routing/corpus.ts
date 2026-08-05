import { routingStableId } from "./stable";

export interface RoutingCorpusDeclaration {
  fixtureId: string;
  name: string;
  purpose: string;
  authoritativeNetsAndEndpoints: string[];
  expectedConstraints: string[];
  expectedLegalOperations: string[];
  expectedFailures: string[];
  expectedConnectivityDelta: string;
  expectedMeasurementRanges: string[];
  expectedProtectedObjects: string[];
  deterministicDigestPolicy: string;
}

const names = [
  ["simple-two-pin", "Simple two-pin connection"],
  ["track-interior-branch", "Track-interior branch"],
  ["wrong-net-crossing", "Wrong-net crossing"],
  ["forced-walk-around", "Forced walk-around"],
  ["shove-chain", "Shove chain"],
  ["infeasible-shove", "Infeasible shove"],
  ["four-layer-transition", "Four-layer transition"],
  ["plane-completion", "Plane completion"],
  ["arbitrary-angle", "Arbitrary-angle board"],
  ["dense-mcu-fanout", "Dense MCU fanout"],
  ["usb-differential", "USB-like differential pair"],
  ["long-differential", "Long differential pair"],
  ["ddr-bus", "DDR-like bus/group"],
  ["tuning-corridor", "Tuning corridor"],
  ["existing-routed", "Existing routed board"],
  ["autorouter-round-trip", "Autorouter round-trip"],
  ["branch-loop-measurement", "Branch/loop measurement"],
  ["large-dense-stress", "Large/dense stress board"],
] as const;

/** Stable declarations shared by test generators and the Stage 8 evidence report. */
export const REQUIRED_ROUTING_CORPUS: readonly RoutingCorpusDeclaration[] = names.map(([slug, name]) => {
  const semantic = {
    slug,
    name,
    policy: "canonical-board-state + engine-version + constraint-program + protected-state; render/UI state excluded",
  };
  return {
    fixtureId: routingStableId("routing-fixture", semantic),
    name,
    purpose: `Exercise ${name.toLowerCase()} under the authoritative Stage 8 snapshot and candidate contracts.`,
    authoritativeNetsAndEndpoints: ["fixture-owned stable net IDs", "fixture-owned exact endpoint IDs"],
    expectedConstraints: ["compiled hard rules are passed, failed, or explicitly unsupported"],
    expectedLegalOperations: ["preview without board mutation", "stale-checked atomic commit when applicable"],
    expectedFailures: ["wrong-net/net-0/protected/stale/unsupported inputs fail explicitly"],
    expectedConnectivityDelta: "Declared by the concrete generator; no inferred completion is permitted.",
    expectedMeasurementRanges: ["Declared analytically in integer nanometers by the concrete test."],
    expectedProtectedObjects: ["locked, imported, manual-out-of-scope, and unknown-provenance copper"],
    deterministicDigestPolicy: semantic.policy,
  };
});
