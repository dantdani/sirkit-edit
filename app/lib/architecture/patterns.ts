import { architectureDigest } from "./stable";
import type { ArchitecturePatternDefinition } from "./types";
import { ARCHITECTURE_PATTERN_REGISTRY_VERSION } from "./types";

function pattern(value: Omit<ArchitecturePatternDefinition, "version" | "deterministicDigest">): ArchitecturePatternDefinition {
  const base = { ...value, version: ARCHITECTURE_PATTERN_REGISTRY_VERSION };
  return { ...base, deterministicDigest: architectureDigest(base) };
}

export const ARCHITECTURE_PATTERNS: readonly ArchitecturePatternDefinition[] = Object.freeze([
  pattern({ patternId: "centralized-control", title: "Centralized control", intent: "Coordinate product behavior through one abstract control responsibility.", applicability: ["Coherent state and policy ownership"], requiredRoles: ["system", "control"], optionalRoles: ["supervision", "diagnostics"], requiredFlowKinds: ["control", "data"], consequences: ["Simple responsibility boundary", "Potential concentration of integration risk"], riskPrompts: ["What remains safe if control is unavailable?"], sourceRefs: ["Sirkit CD-02 architecture pattern registry"] }),
  pattern({ patternId: "modular-partition", title: "Modular functional partition", intent: "Partition independent capabilities behind explicit contracts.", applicability: ["Multiple separable functional capabilities"], requiredRoles: ["system"], optionalRoles: ["module", "gateway"], requiredFlowKinds: ["data", "control"], consequences: ["Clear subsystem contracts", "More boundary crossings"], riskPrompts: ["Are cross-module contracts measurable?"], sourceRefs: ["Sirkit CD-02 architecture pattern registry"] }),
  pattern({ patternId: "independent-safety-supervision", title: "Independent safety supervision", intent: "Separate safety response from the primary behavior owner.", applicability: ["Safety-critical or high-criticality behavior"], requiredRoles: ["system", "safety_supervision"], optionalRoles: ["fault_containment"], requiredFlowKinds: ["control", "reset"], consequences: ["Improved fault containment", "Additional verification burden"], riskPrompts: ["Can a common dependency defeat both paths?"], sourceRefs: ["Sirkit CD-02 architecture pattern registry"] }),
  pattern({ patternId: "offline-edge", title: "Offline-capable edge", intent: "Keep required product behavior independent of external services.", applicability: ["Offline operation or unreliable connectivity"], requiredRoles: ["system", "local_behavior"], optionalRoles: ["external_service"], requiredFlowKinds: ["data"], consequences: ["External service becomes optional", "Local resource demand may increase"], riskPrompts: ["Which data and decisions must remain local?"], sourceRefs: ["Sirkit CD-02 architecture pattern registry"] }),
  pattern({ patternId: "protected-domain-boundary", title: "Protected domain boundary", intent: "Make protection, isolation, or trust crossings explicit.", applicability: ["Multiple power, trust, isolation, or thermal domains"], requiredRoles: ["system", "boundary"], optionalRoles: ["monitoring"], requiredFlowKinds: ["power", "data", "control"], consequences: ["Auditable crossings", "Boundary cost and uncertainty must be budgeted"], riskPrompts: ["Are all crossings enumerated and owned?"], sourceRefs: ["Sirkit CD-02 architecture pattern registry"] }),
]);

export function getArchitecturePattern(ref: string): ArchitecturePatternDefinition | undefined {
  return ARCHITECTURE_PATTERNS.find((item) => item.patternId === ref || `${item.patternId}@${item.version}` === ref);
}

export function validateArchitecturePatternRegistry(patterns: readonly ArchitecturePatternDefinition[] = ARCHITECTURE_PATTERNS): string[] {
  const errors: string[] = [];
  if (new Set(patterns.map((item) => item.patternId)).size !== patterns.length) errors.push("DUPLICATE_PATTERN_ID");
  for (const item of patterns) {
    if (!item.patternId || !item.title || !item.intent || !item.sourceRefs.length) errors.push(`PATTERN_IDENTITY_INCOMPLETE:${item.patternId}`);
    if (item.version !== ARCHITECTURE_PATTERN_REGISTRY_VERSION) errors.push(`PATTERN_VERSION_MISMATCH:${item.patternId}`);
    if (architectureDigest({ ...item, deterministicDigest: undefined }) !== item.deterministicDigest) errors.push(`PATTERN_DIGEST_MISMATCH:${item.patternId}`);
  }
  return errors.sort();
}
