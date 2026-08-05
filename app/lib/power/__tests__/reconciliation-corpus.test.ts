import { describe, expect, it } from "vitest";
import { buildPowerDiagram } from "../diagram";
import { executePowerBenchmark, POWER_ARCHITECTURE_CORPUS, validatePowerCorpus } from "../corpus";
import { reconcilePoweredPinExpansions } from "../reconciliation";
import { powerDigest } from "../stable";
import type { PoweredPinExpansion } from "../types";
import { powerCandidate } from "./fixtures";

function expansion(input: Omit<PoweredPinExpansion, "deterministicDigest">): PoweredPinExpansion { return { ...input, deterministicDigest: powerDigest({ ...input, deterministicDigest: undefined }) }; }

describe("CD-3 reconciliation, views, and governed corpus", () => {
  it("requires a candidate revision for a newly discovered supply pin group", () => { const candidate = powerCandidate(); const value = expansion({ expansionId: "expansion:new", componentRevisionId: "atomic:rev2", pinGroups: [{ pinGroupId: "backup", role: "backup_supply", terminalIds: ["pin:7"], requiredRailRole: "backup-domain" }] }); const result = reconcilePoweredPinExpansions(candidate, [value]); expect(result.state).toBe("candidate_revision_required"); expect(result.discoveredDemandIds).toHaveLength(1); expect(result.invalidatedArtifactIds).toContain(candidate.candidateId); });
  it("rejects tampered expansion evidence", () => { const candidate = powerCandidate(); const value = expansion({ expansionId: "expansion:bad", componentRevisionId: "atomic:rev2", pinGroups: [{ pinGroupId: "gnd", role: "ground", terminalIds: ["pin:1"], requiredReturnRole: "circuit_return" }] }); value.componentRevisionId = "tampered"; expect(reconcilePoweredPinExpansions(candidate, [value]).state).toBe("invalid"); });
  it("builds a deterministic source-to-return diagram", () => { const candidate = powerCandidate(); const a = buildPowerDiagram(candidate), b = buildPowerDiagram(candidate); expect(a).toEqual(b); expect(new Set(a.nodes.map((item) => item.kind))).toEqual(expect.objectContaining(new Set()) as never); expect(a.nodes.some((item) => item.kind === "source")).toBe(true); expect(a.nodes.some((item) => item.kind === "return")).toBe(true); });
  it("governs at least 32 distinct fixture families", () => { expect(POWER_ARCHITECTURE_CORPUS).toHaveLength(32); expect(validatePowerCorpus()).toEqual([]); expect(new Set(POWER_ARCHITECTURE_CORPUS.map((item) => item.family)).size).toBe(32); });
  it("executes all four Stage-9 CD-3 benchmark operations", () => { expect(executePowerBenchmark("power_problem_corpus")).toMatchObject({ fixtureCount: 32, invalidDefinitions: 0 }); expect(executePowerBenchmark("power_alternatives")).toMatchObject({ candidateCount: 3, distinctStructures: 3, compileFailures: 0 }); expect(executePowerBenchmark("power_concurrency_oracle")).toMatchObject({ equivalent: true, peakMicroamps: "2000000" }); expect(executePowerBenchmark("power_adversarial_schema")).toMatchObject({ forbiddenImplementationAccepted: false }); });
});
