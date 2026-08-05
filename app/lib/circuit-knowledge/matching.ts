import { evaluateRecipeApplicability, type RecipeApplicabilityContext } from "./applicability";
import { circuitDigest, circuitId } from "./stable";
import type { CircuitKnowledgeCapabilityProfile, CircuitKnowledgeProblem, CircuitRecipeLibrary, RecipeBindingCandidate, RecipeCoverage, RecipeDecisionRecord } from "./types";

export interface RecipeMatchingResult { candidates: RecipeBindingCandidate[]; coverage: RecipeCoverage[]; diagnostics: string[]; deterministicDigest: string; }

export function matchRecipesToProblem(input: {
  problem: CircuitKnowledgeProblem;
  library: CircuitRecipeLibrary;
  capabilityProfile: CircuitKnowledgeCapabilityProfile;
  contextByRequestId: ReadonlyMap<string, RecipeApplicabilityContext>;
}): RecipeMatchingResult {
  const candidates: RecipeBindingCandidate[] = [];
  const diagnostics: string[] = [];
  const compiled = new Map(input.library.compiledRecipes.map((item) => [item.recipeRevisionId, item]));
  for (const request of [...input.problem.recipeRequests].sort((a, b) => a.requestId.localeCompare(b.requestId))) {
    const context = input.contextByRequestId.get(request.requestId);
    if (!context) { diagnostics.push(`RECIPE_MATCH_CONTEXT_MISSING:${request.requestId}`); continue; }
    for (const recipe of [...input.library.recipes].sort((a, b) => a.revisionId.localeCompare(b.revisionId))) {
      const artifact = compiled.get(recipe.revisionId);
      if (recipe.lifecycleState !== "published" || !artifact?.publicationEligible) continue;
      const applicability = evaluateRecipeApplicability({ recipe, request, context, capabilityProfile: input.capabilityProfile });
      if (applicability.state === "false" || applicability.state === "unsupported" || applicability.state === "conflict" || applicability.state === "stale") continue;
      const hardGateResults: RecipeBindingCandidate["hardGateResults"] = [
        { gateId: "published_compiled_recipe", state: "pass", explanation: "The exact recipe revision is published and compiler-eligible.", objectRefs: [recipe.revisionId, artifact.compiledRecipeId] },
        { gateId: "applicability", state: applicability.state === "true" ? "pass" : "unknown", explanation: applicability.explanation, objectRefs: applicability.blockerIds },
        { gateId: "exact_overlay", state: request.exactOverlayRequired && !["exact_atomic_part", "exact_package"].includes(recipe.abstractionLevel) ? "unknown" : "pass", explanation: request.exactOverlayRequired ? "An exact overlay is required before downstream binding." : "No exact overlay is required at this stage.", objectRefs: [] },
      ];
      const feasible = hardGateResults.every((item) => item.state === "pass");
      const base: Omit<RecipeBindingCandidate, "deterministicDigest"> = {
        bindingCandidateId: circuitId("recipe-binding", { problem: input.problem.problemId, request: request.requestId, recipe: recipe.revisionId }),
        problemId: input.problem.problemId,
        architectureRoleId: request.sourceObligationId,
        recipeRevisionIds: [recipe.revisionId],
        overlayRevisionIds: [],
        exactPartPackageBindingIds: [],
        portBindingRecords: recipe.ports.map((port) => ({ recipePortId: port.portId, architectureRoleId: request.sourceObligationId })),
        terminalRoleBindingRecords: recipe.terminalRoleContracts.map((terminal) => ({ terminalRoleId: terminal.terminalRoleId, atomicTerminalIds: [], state: terminal.exactPinMappingRequired ? "unknown" : "true" })),
        parameterBindingRecords: recipe.parameters.map((parameter) => ({ parameterId: parameter.parameterId, state: parameter.valueState === "calculated_by_cd7" ? "downstream" : "unknown" })),
        decisionSelections: [], applicabilityResults: [applicability], compositionPlanId: "pending",
        feasibilityState: feasible ? "feasible_at_recipe_resolution" : "incomplete_blocking_unknown",
        hardGateResults,
        objectiveVector: request.softCriteria.map((objectiveId) => ({ objectiveId, direction: "minimize" as const, rawValue: null, evidenceState: "not_evaluated" as const })),
        riskIds: [], decisionState: "unselected",
      };
      candidates.push({ ...base, deterministicDigest: circuitDigest(base) });
    }
  }
  const coverage: RecipeCoverage[] = input.problem.recipeRequests.map((request) => {
    const matches = candidates.filter((item) => item.architectureRoleId === request.sourceObligationId);
    const complete = matches.filter((item) => item.feasibilityState === "feasible_at_recipe_resolution");
    return { coverageId: circuitId("recipe-coverage", [input.problem.problemId, request.requestId]), architectureObligationId: request.sourceObligationId, recipeOrNovelProposalIds: matches.flatMap((item) => item.recipeRevisionIds), coverageState: complete.length ? "covered_by_approved_recipe" : matches.length ? "partially_covered" : "uncovered", applicabilityResolution: complete.length ? "At least one hard-filtered published recipe applies." : matches.length ? "Only incomplete candidates remain." : "No published compiler-eligible recipe survived hard filtering.", remainingEvidenceObligationIds: matches.flatMap((item) => item.hardGateResults.filter((gate) => gate.state !== "pass").map((gate) => gate.gateId)), blockerIds: matches.flatMap((item) => item.hardGateResults.filter((gate) => gate.state !== "pass").flatMap((gate) => gate.objectRefs)) };
  });
  const base = { candidates: candidates.sort((a, b) => a.bindingCandidateId.localeCompare(b.bindingCandidateId)), coverage, diagnostics: diagnostics.sort() };
  return { ...base, deterministicDigest: circuitDigest(base) };
}

function dominates(left: RecipeBindingCandidate, right: RecipeBindingCandidate): boolean {
  if (!left.objectiveVector.length || left.objectiveVector.some((item) => item.rawValue === null) || right.objectiveVector.some((item) => item.rawValue === null)) return false;
  let strict = false;
  for (const objective of left.objectiveVector) {
    const other = right.objectiveVector.find((item) => item.objectiveId === objective.objectiveId && item.direction === objective.direction);
    if (!other || objective.rawValue === null || other.rawValue === null) return false;
    const better = objective.direction === "minimize" ? objective.rawValue <= other.rawValue : objective.rawValue >= other.rawValue;
    if (!better) return false;
    if (objective.rawValue !== other.rawValue) strict = true;
  }
  return strict;
}

export function createRecipeDecisionRecord(input: { problemDigest: string; candidates: RecipeBindingCandidate[]; createdAt: string }): RecipeDecisionRecord {
  const eligible = input.candidates.filter((item) => item.feasibilityState === "feasible_at_recipe_resolution" && item.hardGateResults.every((gate) => gate.state === "pass"));
  const paretoBindingIds = eligible.filter((candidate) => !eligible.some((other) => other.bindingCandidateId !== candidate.bindingCandidateId && dominates(other, candidate))).map((item) => item.bindingCandidateId).sort();
  const base: Omit<RecipeDecisionRecord, "deterministicDigest"> = { decisionId: circuitId("recipe-decision", { problem: input.problemDigest, candidates: input.candidates.map((item) => item.deterministicDigest).sort() }), problemDigest: input.problemDigest, candidateBindingIds: input.candidates.map((item) => item.bindingCandidateId).sort(), hardGateSummary: input.candidates.map((item) => ({ bindingId: item.bindingCandidateId, passed: item.hardGateResults.every((gate) => gate.state === "pass") })), objectiveVectors: input.candidates.map((item) => ({ bindingId: item.bindingCandidateId, values: structuredClone(item.objectiveVector) })), paretoBindingIds, rejectedReasons: input.candidates.filter((item) => !eligible.includes(item)).map((item) => ({ id: item.bindingCandidateId, reason: item.hardGateResults.filter((gate) => gate.state !== "pass").map((gate) => gate.gateId).join(",") || item.feasibilityState })), unresolvedRiskIds: [...new Set(input.candidates.flatMap((item) => item.riskIds))].sort(), approvalState: "proposed", invalidationDependencies: [input.problemDigest, ...input.candidates.map((item) => item.deterministicDigest)].sort(), createdAt: input.createdAt };
  return { ...base, deterministicDigest: circuitDigest(base) };
}
