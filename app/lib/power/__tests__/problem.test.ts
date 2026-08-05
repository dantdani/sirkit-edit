import { describe, expect, it } from "vitest";
import { architectureDigest } from "../../architecture/stable";
import { compilePowerArchitectureProblem, validatePowerArchitectureProblem } from "../problem";
import { powerProblem, powerProblemInput } from "./fixtures";

describe("CD-3 pinned problem and prerequisite gates", () => {
  it("compiles a fully pinned accepted/selected fixture", () => { const problem = powerProblem(); expect(validatePowerArchitectureProblem(problem)).toEqual([]); expect(problem.sources).toHaveLength(1); expect(problem.demands).toHaveLength(1); expect(problem.scenarios.length).toBeGreaterThanOrEqual(3); });
  it("rejects missing CD-1 COMPLETE evidence", () => { const input = powerProblemInput(); input.upstreamSignoff.cd1Verdict = "wrong" as never; const result = compilePowerArchitectureProblem(input); expect(result).toMatchObject({ ok: false, verdict: "BLOCKED BY CD-1" }); });
  it("rejects a missing CD-2 selection", () => { const input = powerProblemInput(); input.architectureState.selection = null; input.architectureState.deterministicDigest = architectureDigest({ ...input.architectureState, deterministicDigest: undefined }); const result = compilePowerArchitectureProblem(input); expect(result).toMatchObject({ ok: false, verdict: "BLOCKED BY CD-2" }); });
  it("pins exact upstream digests and profile revision", () => { const input = powerProblemInput(); const problem = powerProblem(); expect(problem.requirementsPackageRef.digest).toBe(input.requirementsPackage.deterministicDigest); expect(problem.architectureRef.candidateDigest).toBe(input.architectureState.selection?.candidateDigest); expect(problem.capabilityProfileRef).toContain(input.capabilityProfile.deterministicDigest); });
  it("creates explicit downstream powered-pin closure", () => { const problem = powerProblem(); expect(problem.downstreamPoweredPinClosureObligationId).toContain("powered-pin-closure"); expect(problem.demands[0].downstreamExpansionObligationIds).toHaveLength(1); });
  it("is deterministic", () => { expect(powerProblem().deterministicDigest).toBe(powerProblem().deterministicDigest); });
});
