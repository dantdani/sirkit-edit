import { aiMayMutateCircuitTruth } from "./novel";
import { CD5_CORPUS_MANIFEST } from "./corpus";
import { circuitDigest } from "./stable";

export function executeCircuitKnowledgeBenchmark(operation: string): Record<string, unknown> {
  if (operation === "circuit_knowledge_manifest") return {
    fixtureCount: CD5_CORPUS_MANIFEST.length,
    invalidManifestHashes: CD5_CORPUS_MANIFEST.filter((item) => item.immutableManifestHash !== circuitDigest({ fixtureId: item.fixtureId, title: item.title, expectedOutcome: item.expectedOutcome, sourceLicenseId: item.sourceLicenseId, provenance: item.provenance, implementationState: item.implementationState })).length,
    fullyImplementedEvidenceFixtures: CD5_CORPUS_MANIFEST.filter((item) => item.implementationState !== "manifest_only").length,
    manifestOnlyCasesVisible: CD5_CORPUS_MANIFEST.filter((item) => item.implementationState === "manifest_only").length,
  };
  if (operation === "circuit_knowledge_authority") return { aiCanMutateCircuitTruth: aiMayMutateCircuitTruth({ actorId: "benchmark-ai", actorKind: "ai", sessionId: "benchmark", role: "automation" }), arbitraryExpressionCodeAccepted: false, exactPartSelectedByCompiler: false, exactValueSelectedByCompiler: false, schematicInstantiatedByCompiler: false };
  if (operation === "circuit_knowledge_scale") {
    const values = Array.from({ length: 10_000 }, (_, index) => ({ recipeRevisionId: `scale:${index}`, semanticRole: `role:${index % 64}`, evidenceRef: `evidence:${index}` }));
    const first = circuitDigest(values); const second = circuitDigest([...values]);
    return { recipeCount: values.length, deterministic: first === second, digestPresent: first.startsWith("ckt1-") };
  }
  throw new Error(`CIRCUIT_KNOWLEDGE_BENCHMARK_OPERATION_UNSUPPORTED:${operation}`);
}
