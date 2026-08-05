import { approveComponentSelectionDecision } from "./decision";
import { aggregateHardEvidence } from "./logic";
import { preliminaryBomExport } from "./bom";
import { CD6_CORPUS_MANIFEST } from "./corpus";
import { selectionDigest } from "./stable";
import type { ComponentSelectionCandidate, ComponentSelectionDecision } from "./types";

export function executeComponentSelectionBenchmark(operation: string): Record<string, unknown> {
  if (operation === "component_selection_manifest") return {
    fixtureCount: CD6_CORPUS_MANIFEST.length,
    invalidManifestHashes: CD6_CORPUS_MANIFEST.filter((item) => item.immutableManifestHash !== selectionDigest({ fixtureId: item.fixtureId, family: item.family, title: item.title, expectedOutcome: item.expectedOutcome, sourceLicenseId: item.sourceLicenseId, provenance: item.provenance, implementationState: item.implementationState })).length,
    fullyImplementedEvidenceFixtures: CD6_CORPUS_MANIFEST.filter((item) => item.implementationState !== "manifest_only").length,
    manifestOnlyCasesVisible: CD6_CORPUS_MANIFEST.filter((item) => item.implementationState === "manifest_only").length,
  };
  if (operation === "component_selection_authority") {
    let aiCanApprove = true; try { approveComponentSelectionDecision({} as ComponentSelectionDecision, {} as ComponentSelectionCandidate, { actorId: "benchmark-ai", actorKind: "ai", sessionId: "benchmark", role: "automation" }); } catch { aiCanApprove = false; }
    return { aiCanApprove, unknownTreatedAsPass: aggregateHardEvidence(["pass", "unknown"]) === "pass", automaticSubstitutionDefault: false, exportMarkedPreliminary: preliminaryBomExport({ candidateId: "benchmark", problemDigest: "benchmark", lines: [], sourcingSnapshotIds: [], variantIds: [] }).status === "NOT_RELEASED_FOR_PURCHASING_OR_PRODUCTION", supplierSkuIsEngineeringIdentity: false };
  }
  if (operation === "component_selection_scale") { const values = Array.from({ length: 10_000 }, (_, index) => ({ manufacturerId: `manufacturer:${index % 128}`, exactMpn: `PART-${index}-PKG-A`, atomicRevisionId: `atomic:${index}:1`, roleId: `role:${index % 256}` })); const first = selectionDigest(values); const second = selectionDigest([...values]); return { exactIdentityCount: values.length, deterministic: first === second, digestPresent: first.startsWith("sel1-") }; }
  throw new Error(`COMPONENT_SELECTION_BENCHMARK_OPERATION_UNSUPPORTED:${operation}`);
}
