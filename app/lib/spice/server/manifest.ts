import { createHash } from "node:crypto";
import { stableStringify } from "../identity";
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
    modelChecksums: Object.fromEntries(input.ir.models.map((model) => [model.id, sha256(model.transformedContent ?? model.originalContent)])),
    schematicHash: design.schematicHash,
    netlistChecksum: sha256(input.netlist),
    analysis: input.analysis,
    solverProfile: input.test.environment.solverProfile,
    randomSeed: input.runPoint.seed,
  };
  return {
    id: `manifest_${sha256(stableStringify(body)).slice(0, 24)}`,
    ...body,
    simulator: { name: "ngspice", version: input.simulatorVersion, mode: "subprocess" },
    createdAt: new Date().toISOString(),
  };
}
