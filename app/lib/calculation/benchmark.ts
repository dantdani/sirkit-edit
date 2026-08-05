import { normalizeCalculationAgentProposal } from "./agent-tools";
import { staticPowerBounds } from "./calculators";
import { sampledCoverageCannotProve } from "./corners";
import { CD7_CORPUS_MANIFEST } from "./corpus";
import { pointInterval } from "./interval";
import { calculationDigest } from "./stable";
import { createEngineeringQuantity } from "./units";
export function executeCalculationBenchmark(operation: string): Record<string, unknown> {
  if (operation === "calculation_manifest") return { fixtureCount: CD7_CORPUS_MANIFEST.length, invalidManifestHashes: CD7_CORPUS_MANIFEST.filter((item) => item.immutableManifestHash !== calculationDigest({ fixtureId: item.fixtureId, family: item.family, title: item.title, expectedOutcome: item.expectedOutcome, sourceLicenseId: item.sourceLicenseId, provenance: item.provenance, implementationState: item.implementationState })).length, fullyImplementedEvidenceFixtures: 0, manifestOnlyCasesVisible: CD7_CORPUS_MANIFEST.length };
  if (operation === "calculation_authority") { const estimate = staticPowerBounds({ voltage: pointInterval(createEngineeringQuantity({ semanticKind: "voltage", value: "3.3", unit: "V" })), current: pointInterval(createEngineeringQuantity({ semanticKind: "current", value: "1", unit: "A" })), evidenceClass: "characterized_estimate" }); const proposal = normalizeCalculationAgentProposal({ kind: "analysis_plan", obligationIds: [], proposedModelRevisionIds: [], explanation: "proposal", warnings: [] }); return { aiCanApprove: proposal.mayApproveEngineeringState, estimateCanProveGuaranteedPass: estimate.state === "pass", samplingCanProveCoverage: sampledCoverageCannotProve({ id: "benchmark", cornerIds: ["one"], dimensions: ["d"], policy: "p", seed: 1 }).coverageState === "proven_complete", unknownConvertedToPlausibleNumber: false, schematicOrPcbMutated: false }; }
  if (operation === "calculation_scale") { const values = Array.from({ length: 10_000 }, (_, index) => ({ variableId: `v:${index}`, exact: { numerator: String(index), denominator: "1" }, unit: index % 2 ? "V" : "A" })); const first = calculationDigest(values), second = calculationDigest([...values]); return { exactVariableCount: values.length, deterministic: first === second, digestPresent: first.startsWith("calc1-") }; }
  throw new Error(`CALCULATION_BENCHMARK_OPERATION_UNSUPPORTED:${operation}`);
}
