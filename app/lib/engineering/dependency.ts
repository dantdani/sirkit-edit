import { engineeringDigest, engineeringId } from "./stable";
import type { DerivedArtifactState, EngineeringChangeSet, ProjectRevision, SemanticImpactFlag } from "./types";

export type DerivedKind = "zone_fill" | "electrical_truth" | "drc" | "constraints" | "route_measurements" | "placement_analysis" | "manufacturing_preflight" | "readiness" | "ai_snapshot";

export interface DerivedEvaluatorDescriptor {
  evaluatorId: string;
  evaluatorVersion: string;
  artifactKind: DerivedKind;
  sourceDomainKeys: string[];
  impactFlags: SemanticImpactFlag[];
  dependsOnKinds: DerivedKind[];
  incremental: "supported" | "full_only" | "shadow_full_fallback";
  fallbackEvaluatorId: string;
  equivalenceComparator: string;
  priority: number;
}

export const DERIVED_EVALUATORS: readonly DerivedEvaluatorDescriptor[] = [
  { evaluatorId: "stage10.zone-fill", evaluatorVersion: "1.0.0", artifactKind: "zone_fill", sourceDomainKeys: ["source:zonesAndFill", "source:boardGeometry", "source:copperTopology", "source:stackup", "source:constraints"], impactFlags: ["zone_fill_dirty", "physical_contact_geometry_changed", "effective_rule_changed"], dependsOnKinds: [], incremental: "full_only", fallbackEvaluatorId: "stage4.compute-fill", equivalenceComparator: "canonical-zone-fill-v1", priority: 20 },
  { evaluatorId: "stage10.electrical-truth", evaluatorVersion: "1.0.0", artifactKind: "electrical_truth", sourceDomainKeys: ["source:schematic", "source:electricalIntent", "source:componentBindings", "source:boardGeometry", "source:copperTopology", "source:zonesAndFill", "source:stackup"], impactFlags: ["logical_connectivity_changed", "physical_contact_geometry_changed", "net_ownership_changed", "route_topology_changed"], dependsOnKinds: ["zone_fill"], incremental: "shadow_full_fallback", fallbackEvaluatorId: "stage2.compute-electrical-truth", equivalenceComparator: "canonical-electrical-truth-v1", priority: 10 },
  { evaluatorId: "stage10.constraints", evaluatorVersion: "1.0.0", artifactKind: "constraints", sourceDomainKeys: ["source:constraints", "source:electricalIntent", "source:componentBindings", "source:boardGeometry", "source:stackup"], impactFlags: ["constraint_program_changed", "effective_rule_changed", "net_ownership_changed"], dependsOnKinds: [], incremental: "full_only", fallbackEvaluatorId: "stage6.compile-constraints", equivalenceComparator: "canonical-constraint-program-v1", priority: 15 },
  { evaluatorId: "stage10.drc", evaluatorVersion: "1.0.0", artifactKind: "drc", sourceDomainKeys: ["source:boardGeometry", "source:copperTopology", "source:zonesAndFill", "source:stackup", "source:constraints", "source:protectedState"], impactFlags: ["physical_contact_geometry_changed", "net_ownership_changed", "effective_rule_changed", "zone_fill_dirty", "route_topology_changed", "manufacturing_capability_changed"], dependsOnKinds: ["electrical_truth", "zone_fill", "constraints"], incremental: "shadow_full_fallback", fallbackEvaluatorId: "stage12.run-drc", equivalenceComparator: "canonical-drc-issues-v1", priority: 30 },
  { evaluatorId: "stage10.route-measurements", evaluatorVersion: "1.0.0", artifactKind: "route_measurements", sourceDomainKeys: ["source:copperTopology", "source:stackup", "source:constraints"], impactFlags: ["route_topology_changed", "path_measurement_changed", "effective_rule_changed"], dependsOnKinds: ["electrical_truth", "constraints"], incremental: "full_only", fallbackEvaluatorId: "stage8.route-measurement", equivalenceComparator: "canonical-route-measurement-v1", priority: 50 },
  { evaluatorId: "stage10.placement-analysis", evaluatorVersion: "1.0.0", artifactKind: "placement_analysis", sourceDomainKeys: ["source:componentBindings", "source:boardGeometry", "source:constraints", "source:stackup"], impactFlags: ["placement_analysis_changed", "effective_rule_changed", "asset_revision_changed"], dependsOnKinds: ["constraints"], incremental: "full_only", fallbackEvaluatorId: "stage7.placement-analysis", equivalenceComparator: "canonical-placement-analysis-v1", priority: 60 },
  { evaluatorId: "stage10.manufacturing-preflight", evaluatorVersion: "1.0.0", artifactKind: "manufacturing_preflight", sourceDomainKeys: ["source:boardGeometry", "source:copperTopology", "source:zonesAndFill", "source:stackup", "source:constraints", "source:assets"], impactFlags: ["manufacturing_capability_changed", "asset_revision_changed", "effective_rule_changed", "readiness_dependency_changed"], dependsOnKinds: ["drc", "constraints", "zone_fill"], incremental: "full_only", fallbackEvaluatorId: "stage3.export-preflight", equivalenceComparator: "canonical-preflight-v1", priority: 70 },
  { evaluatorId: "stage10.readiness", evaluatorVersion: "1.0.0", artifactKind: "readiness", sourceDomainKeys: ["source:waivers", "source:assets"], impactFlags: ["readiness_dependency_changed", "protected_state_changed", "asset_revision_changed"], dependsOnKinds: ["electrical_truth", "drc", "constraints", "manufacturing_preflight"], incremental: "full_only", fallbackEvaluatorId: "stage3.fabrication-readiness", equivalenceComparator: "canonical-readiness-v1", priority: 40 },
  { evaluatorId: "stage10.ai-snapshot", evaluatorVersion: "1.0.0", artifactKind: "ai_snapshot", sourceDomainKeys: [], impactFlags: ["readiness_dependency_changed", "route_topology_changed", "placement_analysis_changed"], dependsOnKinds: ["electrical_truth", "drc", "readiness", "route_measurements", "placement_analysis"], incremental: "full_only", fallbackEvaluatorId: "pcb-ai-snapshot-v3", equivalenceComparator: "canonical-ai-snapshot-v1", priority: 80 },
];

export function validateEvaluatorRegistry(descriptors: readonly DerivedEvaluatorDescriptor[] = DERIVED_EVALUATORS): string[] {
  const errors: string[] = []; const ids = new Set<string>(); const kinds = new Set(descriptors.map((item) => item.artifactKind));
  for (const item of descriptors) {
    if (ids.has(item.evaluatorId)) errors.push(`DUPLICATE_EVALUATOR:${item.evaluatorId}`); ids.add(item.evaluatorId);
    if (!item.evaluatorVersion || !item.fallbackEvaluatorId || !item.equivalenceComparator) errors.push(`INCOMPLETE_DESCRIPTOR:${item.evaluatorId}`);
    for (const dependency of item.dependsOnKinds) if (!kinds.has(dependency)) errors.push(`UNKNOWN_DERIVED_DEPENDENCY:${item.evaluatorId}:${dependency}`);
  }
  const visiting = new Set<DerivedKind>(); const visited = new Set<DerivedKind>(); const byKind = new Map(descriptors.map((item) => [item.artifactKind, item]));
  function visit(kind: DerivedKind): void { if (visiting.has(kind)) { errors.push(`DEPENDENCY_CYCLE:${kind}`); return; } if (visited.has(kind)) return; visiting.add(kind); for (const dependency of byKind.get(kind)?.dependsOnKinds ?? []) visit(dependency); visiting.delete(kind); visited.add(kind); }
  for (const kind of kinds) visit(kind);
  return [...new Set(errors)].sort();
}

export function affectedDerivedKinds(changeSet: EngineeringChangeSet, descriptors: readonly DerivedEvaluatorDescriptor[] = DERIVED_EVALUATORS): DerivedKind[] {
  const direct = new Set<DerivedKind>(); const sources = new Set(changeSet.dependencyKeys); const flags = new Set(changeSet.semanticImpactFlags);
  for (const descriptor of descriptors) if (descriptor.sourceDomainKeys.some((key) => sources.has(key)) || descriptor.impactFlags.some((flag) => flags.has(flag))) direct.add(descriptor.artifactKind);
  let changed = true; while (changed) { changed = false; for (const descriptor of descriptors) if (!direct.has(descriptor.artifactKind) && descriptor.dependsOnKinds.some((kind) => direct.has(kind))) { direct.add(descriptor.artifactKind); changed = true; } }
  return descriptors.filter((item) => direct.has(item.artifactKind)).sort((a, b) => a.priority - b.priority || a.artifactKind.localeCompare(b.artifactKind)).map((item) => item.artifactKind);
}

export class DerivedDependencyGraph {
  private artifacts = new Map<DerivedKind, DerivedArtifactState>();
  constructor(private readonly descriptors: readonly DerivedEvaluatorDescriptor[] = DERIVED_EVALUATORS) { const errors = validateEvaluatorRegistry(descriptors); if (errors.length) throw new Error(errors.join(",")); }

  seed<T>(kind: DerivedKind, revision: ProjectRevision, value: T, status: DerivedArtifactState["status"] = "current"): DerivedArtifactState<T> {
    const descriptor = this.descriptors.find((item) => item.artifactKind === kind)!; const artifact: DerivedArtifactState<T> = { artifactId: engineeringId("artifact", { kind, revision: revision.canonicalStateDigest, evaluator: descriptor.evaluatorVersion }), artifactKind: kind, scope: "project", inputRevisionVector: structuredClone(revision), evaluatorVersion: descriptor.evaluatorVersion, status, value: structuredClone(value), invalidatedByTransactionIds: [], computedAt: new Date().toISOString(), digest: engineeringDigest(value), equivalenceStatus: "not_compared" };
    this.artifacts.set(kind, artifact as DerivedArtifactState); return artifact;
  }

  invalidate(changeSet: EngineeringChangeSet): DerivedArtifactState[] {
    const affected = affectedDerivedKinds(changeSet, this.descriptors); const output: DerivedArtifactState[] = [];
    for (const kind of affected) {
      const descriptor = this.descriptors.find((item) => item.artifactKind === kind)!; const prior = this.artifacts.get(kind);
      const artifact: DerivedArtifactState = { artifactId: prior?.artifactId ?? engineeringId("artifact", { kind, firstInvalidation: changeSet.transactionId }), artifactKind: kind, scope: prior?.scope ?? "project", inputRevisionVector: structuredClone(changeSet.resultRevision), evaluatorVersion: descriptor.evaluatorVersion, status: "pending", ...(prior?.value === undefined ? {} : { value: structuredClone(prior.value) }), invalidatedByTransactionIds: [...new Set([...(prior?.invalidatedByTransactionIds ?? []), changeSet.transactionId])], ...(prior?.computedAt ? { computedAt: prior.computedAt } : {}), ...(prior?.durationMs === undefined ? {} : { durationMs: prior.durationMs }), digest: prior?.digest ?? engineeringDigest({ kind, status: "not_evaluated" }), ...(prior?.fullOracleDigest ? { fullOracleDigest: prior.fullOracleDigest } : {}), equivalenceStatus: prior?.equivalenceStatus ?? "not_compared" };
      this.artifacts.set(kind, artifact); output.push(structuredClone(artifact));
    }
    return output;
  }

  accept<T>(kind: DerivedKind, revision: ProjectRevision, value: T, input: { durationMs: number; fullOracleDigest?: string; equivalenceStatus?: DerivedArtifactState["equivalenceStatus"] }): DerivedArtifactState<T> {
    const existing = this.artifacts.get(kind); const descriptor = this.descriptors.find((item) => item.artifactKind === kind); if (!descriptor) throw new Error(`UNKNOWN_DERIVED_KIND:${kind}`);
    if (existing && existing.inputRevisionVector.canonicalStateDigest !== revision.canonicalStateDigest) throw new Error(`STALE_DERIVED_RESULT:${kind}`);
    const artifact: DerivedArtifactState<T> = { artifactId: existing?.artifactId ?? engineeringId("artifact", { kind, revision: revision.canonicalStateDigest }), artifactKind: kind, scope: "project", inputRevisionVector: structuredClone(revision), evaluatorVersion: descriptor.evaluatorVersion, status: input.equivalenceStatus === "diverged" ? "divergence_detected" : "current", value: structuredClone(value), invalidatedByTransactionIds: existing?.invalidatedByTransactionIds ?? [], computedAt: new Date().toISOString(), durationMs: input.durationMs, digest: engineeringDigest(value), ...(input.fullOracleDigest ? { fullOracleDigest: input.fullOracleDigest } : {}), equivalenceStatus: input.equivalenceStatus ?? "not_compared" };
    this.artifacts.set(kind, artifact as DerivedArtifactState); return artifact;
  }

  list(): DerivedArtifactState[] { return [...this.artifacts.values()].map((item) => structuredClone(item)).sort((a, b) => a.artifactKind.localeCompare(b.artifactKind)); }
  get(kind: DerivedKind): DerivedArtifactState | undefined { const value = this.artifacts.get(kind); return value ? structuredClone(value) : undefined; }
}
