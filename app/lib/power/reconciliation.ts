import { powerDigest, powerId } from "./stable";
import type { PinReconciliationResult, PowerArchitectureCandidate, PowerDiagnostic, PoweredPinExpansion } from "./types";

function diagnostic(code: string, message: string, refs: string[]): PowerDiagnostic { return { diagnosticId: powerId("power-diagnostic", { code, refs }), code, severity: "blocking", message, objectRefs: [...refs].sort(), requirementRefs: [], blocks: "architecture", derivation: "CD-3 powered-pin reconciliation", nextAction: "Revise the candidate against the exact enriched component revision before selection or downstream release.", staleDependencyKeys: [...refs].sort() }; }

export function reconcilePoweredPinExpansions(candidate: PowerArchitectureCandidate, expansions: readonly PoweredPinExpansion[]): PinReconciliationResult {
  const diagnostics: PowerDiagnostic[] = []; const discoveredDemandIds: string[] = []; const discoveredReturnObligationIds: string[] = [];
  for (const expansion of expansions) {
    if (expansion.deterministicDigest !== powerDigest({ ...expansion, deterministicDigest: undefined }) || !expansion.componentRevisionId || !expansion.pinGroups.length) { diagnostics.push(diagnostic("POWER_PIN_EXPANSION_INVALID", "A powered-pin expansion failed identity or digest validation.", [expansion.expansionId])); continue; }
    for (const group of expansion.pinGroups) {
      if (!group.terminalIds.length) { diagnostics.push(diagnostic("POWER_PIN_GROUP_TERMINALS_REQUIRED", "Every enriched power/return pin group needs explicit terminal identities.", [expansion.expansionId, group.pinGroupId])); continue; }
      if (["supply", "backup_supply", "internally_generated"].includes(group.role)) { const covered = group.requiredRailRole && candidate.rails.some((rail) => rail.semanticRole === group.requiredRailRole); if (!covered) discoveredDemandIds.push(powerId("reconciled-power-demand", { candidate: candidate.deterministicDigest, component: expansion.componentRevisionId, pinGroup: group.pinGroupId })); }
      if (["ground", "reference", "exposed_pad"].includes(group.role)) { const covered = group.requiredReturnRole && candidate.groundReturnDomains.some((domain) => domain.semanticRole === group.requiredReturnRole); if (!covered) discoveredReturnObligationIds.push(powerId("reconciled-return-obligation", { candidate: candidate.deterministicDigest, component: expansion.componentRevisionId, pinGroup: group.pinGroupId })); }
    }
  }
  const invalidatedArtifactIds = discoveredDemandIds.length || discoveredReturnObligationIds.length ? [candidate.candidateId, ...candidate.handoffs.map((item) => item.obligationId), ...candidate.constraintProposals.map((item) => item.proposalId)].sort() : [];
  if (invalidatedArtifactIds.length) diagnostics.push(diagnostic("POWER_PIN_RECONCILIATION_REVISION_REQUIRED", "Enriched component pins expose supply or return obligations absent from the selected architecture.", invalidatedArtifactIds));
  const state: PinReconciliationResult["state"] = diagnostics.some((item) => item.code !== "POWER_PIN_RECONCILIATION_REVISION_REQUIRED") ? "invalid" : invalidatedArtifactIds.length ? "candidate_revision_required" : "no_impact";
  const base = { state, discoveredDemandIds: [...new Set(discoveredDemandIds)].sort(), discoveredReturnObligationIds: [...new Set(discoveredReturnObligationIds)].sort(), invalidatedArtifactIds, diagnostics: diagnostics.sort((a, b) => a.code.localeCompare(b.code)) }; return { ...base, deterministicDigest: powerDigest(base) };
}
