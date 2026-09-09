import type { DrcCheckKind, DrcViolation } from "../pcb/drc/types";
import { engineeringId } from "./stable";
import type { EngineeringChangeSet } from "./types";

export interface DrcCheckerDescriptor {
  checkerId: string;
  version: string;
  kinds: DrcCheckKind[];
  category: "per_object" | "spatial_pair" | "topology" | "zone_fill" | "global";
  dependencyKinds: string[];
  incrementalEvaluator: "not_trusted" | "affected_scope";
  fullEvaluator: string;
  issueIdentityPolicy: "stable_checker_rule_objects_location";
  equivalenceComparator: "semantic_issue_set_v1";
  fallbackThreshold: { maximumAffectedObjects?: number; maximumBoardFraction?: number; fallback: "full" };
  priority: number;
}

export const ALL_DRC_CHECK_KINDS: readonly DrcCheckKind[] = ["clearance", "minTrackWidth", "viaOuterDiameter", "viaDrill", "annularRing", "pthAnnularRing", "holeToHole", "edgeClearance", "courtyardOverlap", "silkOverPad", "unconnected", "incompleteNet", "footprintOutsideBoard", "padOutsideBoard", "holeOutsideBoard", "trackOutsideBoard", "viaOutsideBoard", "zoneOutsideBoard", "referenceTextOutsideBoard", "disabledLayer", "unsupportedViaSpan", "short"];

export const DRC_CHECKER_DESCRIPTORS: readonly DrcCheckerDescriptor[] = [
  { checkerId: "drc.containment-layers", version: "1.0.0", kinds: ["footprintOutsideBoard", "padOutsideBoard", "holeOutsideBoard", "trackOutsideBoard", "viaOutsideBoard", "zoneOutsideBoard", "referenceTextOutsideBoard", "disabledLayer", "unsupportedViaSpan"], category: "per_object", dependencyKinds: ["boardGeometry", "copperTopology", "zonesAndFill", "stackup"], incrementalEvaluator: "not_trusted", fullEvaluator: "checkBoardContainmentAndLayers", issueIdentityPolicy: "stable_checker_rule_objects_location", equivalenceComparator: "semantic_issue_set_v1", fallbackThreshold: { maximumAffectedObjects: 0, fallback: "full" }, priority: 10 },
  { checkerId: "drc.copper-clearance", version: "1.0.0", kinds: ["clearance", "edgeClearance"], category: "spatial_pair", dependencyKinds: ["boardGeometry", "copperTopology", "zonesAndFill", "constraints"], incrementalEvaluator: "not_trusted", fullEvaluator: "checkCopperClearance", issueIdentityPolicy: "stable_checker_rule_objects_location", equivalenceComparator: "semantic_issue_set_v1", fallbackThreshold: { maximumAffectedObjects: 0, fallback: "full" }, priority: 20 },
  { checkerId: "drc.track-width", version: "1.0.0", kinds: ["minTrackWidth"], category: "per_object", dependencyKinds: ["copperTopology", "constraints"], incrementalEvaluator: "not_trusted", fullEvaluator: "checkMinTrackWidth", issueIdentityPolicy: "stable_checker_rule_objects_location", equivalenceComparator: "semantic_issue_set_v1", fallbackThreshold: { maximumAffectedObjects: 0, fallback: "full" }, priority: 30 },
  { checkerId: "drc.via-geometry", version: "1.0.0", kinds: ["viaOuterDiameter", "viaDrill", "annularRing"], category: "per_object", dependencyKinds: ["copperTopology", "stackup", "constraints"], incrementalEvaluator: "not_trusted", fullEvaluator: "checkVia", issueIdentityPolicy: "stable_checker_rule_objects_location", equivalenceComparator: "semantic_issue_set_v1", fallbackThreshold: { maximumAffectedObjects: 0, fallback: "full" }, priority: 31 },
  { checkerId: "drc.pth-annular-ring", version: "1.0.0", kinds: ["pthAnnularRing"], category: "per_object", dependencyKinds: ["componentBindings", "boardGeometry", "constraints"], incrementalEvaluator: "not_trusted", fullEvaluator: "checkPthAnnularRing", issueIdentityPolicy: "stable_checker_rule_objects_location", equivalenceComparator: "semantic_issue_set_v1", fallbackThreshold: { maximumAffectedObjects: 0, fallback: "full" }, priority: 31.5 },
  { checkerId: "drc.hole-spacing", version: "1.0.0", kinds: ["holeToHole"], category: "spatial_pair", dependencyKinds: ["componentBindings", "boardGeometry", "copperTopology", "constraints"], incrementalEvaluator: "not_trusted", fullEvaluator: "checkHoleToHole", issueIdentityPolicy: "stable_checker_rule_objects_location", equivalenceComparator: "semantic_issue_set_v1", fallbackThreshold: { maximumAffectedObjects: 0, fallback: "full" }, priority: 32 },
  { checkerId: "drc.courtyard", version: "1.0.0", kinds: ["courtyardOverlap"], category: "spatial_pair", dependencyKinds: ["componentBindings", "boardGeometry", "constraints"], incrementalEvaluator: "not_trusted", fullEvaluator: "checkCourtyardOverlap", issueIdentityPolicy: "stable_checker_rule_objects_location", equivalenceComparator: "semantic_issue_set_v1", fallbackThreshold: { maximumAffectedObjects: 0, fallback: "full" }, priority: 40 },
  { checkerId: "drc.silkscreen", version: "1.0.0", kinds: ["silkOverPad"], category: "spatial_pair", dependencyKinds: ["componentBindings", "boardGeometry", "constraints"], incrementalEvaluator: "not_trusted", fullEvaluator: "checkSilkOverPad", issueIdentityPolicy: "stable_checker_rule_objects_location", equivalenceComparator: "semantic_issue_set_v1", fallbackThreshold: { maximumAffectedObjects: 0, fallback: "full" }, priority: 41 },
  { checkerId: "drc.connectivity", version: "1.0.0", kinds: ["unconnected", "incompleteNet", "short"], category: "topology", dependencyKinds: ["electricalIntent", "componentBindings", "boardGeometry", "copperTopology", "zonesAndFill", "stackup"], incrementalEvaluator: "not_trusted", fullEvaluator: "checkUnconnectedAndShorts", issueIdentityPolicy: "stable_checker_rule_objects_location", equivalenceComparator: "semantic_issue_set_v1", fallbackThreshold: { maximumAffectedObjects: 0, fallback: "full" }, priority: 50 },
];

export function validateDrcDescriptors(descriptors: readonly DrcCheckerDescriptor[] = DRC_CHECKER_DESCRIPTORS): string[] {
  const errors: string[] = []; const seen = new Map<DrcCheckKind, string>(); for (const descriptor of descriptors) { if (!descriptor.version || !descriptor.fullEvaluator || !descriptor.equivalenceComparator) errors.push(`INCOMPLETE_DRC_DESCRIPTOR:${descriptor.checkerId}`); for (const kind of descriptor.kinds) { if (seen.has(kind)) errors.push(`DUPLICATE_DRC_KIND:${kind}`); seen.set(kind, descriptor.checkerId); } }
  for (const kind of ALL_DRC_CHECK_KINDS) if (!seen.has(kind)) errors.push(`MISSING_DRC_KIND:${kind}`); return errors.sort();
}

export function affectedDrcCheckers(changeSet: EngineeringChangeSet): DrcCheckerDescriptor[] {
  const domains = new Set(changeSet.dependencyKeys.filter((key) => key.startsWith("source:")).map((key) => key.slice(7))); return DRC_CHECKER_DESCRIPTORS.filter((descriptor) => descriptor.dependencyKinds.some((dependency) => domains.has(dependency))).sort((a, b) => a.priority - b.priority);
}

export function stableDrcIssueIdentity(violation: DrcViolation): string {
  const participants = [...violation.items.map((item) => JSON.stringify(item)), ...(violation.objectIds ?? [])].sort(); return engineeringId("drc-issue", { checkerKind: violation.kind, constraintIds: [...(violation.constraintIds ?? [])].sort(), participants, layer: violation.layer, location: violation.location });
}
