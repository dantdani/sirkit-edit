import { createHash } from "node:crypto";
import { stableStringify } from "../identity";
import { emittedModelText } from "../netlist";
import type { CanonicalSimulationIr, RunManifest, RunPlan, RunPoint, SimulationAnalysis, SimulationProject, SimulationTest } from "../types";

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createRunManifest(input: {
  project: SimulationProject;
  test: SimulationTest;
  runPlan: RunPlan;
  runPoint: RunPoint;
  analysis: SimulationAnalysis;
  ir: CanonicalSimulationIr;
  netlist: string;
  simulatorVersion: string;
  /** [B22-A3] The diagnostic runner's provenance: its profile, the observed install digest and the result labels. */
  runner?: RunManifest["simulator"]["runner"];
  /** [B22-A3 review] regressions-3: the raw file's SHA-256 and size as the runner read it (the file itself is not kept). */
  rawOutput?: RunManifest["rawOutput"];
}): RunManifest {
  const design = input.project.designRevisions.find((candidate) => candidate.id === input.test.baseDesignRevisionId)
    ?? input.project.designRevisions.find((candidate) => candidate.id === input.project.activeDesignRevisionId);
  if (!design) throw new Error("Run manifest cannot resolve its design revision");
  const body = {
    projectId: input.project.id,
    projectRevision: input.project.revision,
    designRevisionId: design.id,
    testId: input.test.id,
    testRevision: input.test.revision,
    runPlanId: input.runPlan.id,
    runPoint: input.runPoint,
    modelChecksums: Object.fromEntries(input.ir.models.map((model) => [model.id, sha256(emittedModelText(model))])), // [B22-C] the SHA-256 of the model text the deck carries (was `transformedContent ?? originalContent`, D22-4/D22-13)
    schematicHash: design.schematicHash,
    netlistChecksum: sha256(input.netlist),
    analysis: input.analysis,
    solverProfile: input.test.environment.solverProfile,
    randomSeed: input.runPoint.seed,
  };
  return {
    id: `manifest_${sha256(stableStringify(body)).slice(0, 24)}`,
    ...body,
    simulator: { name: "ngspice", version: input.simulatorVersion, mode: "subprocess", ...(input.runner ? { runner: input.runner } : {}) },
    ...(input.rawOutput ? { rawOutput: input.rawOutput } : {}),
    createdAt: new Date().toISOString(),
  };
}
