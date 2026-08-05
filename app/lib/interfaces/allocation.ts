import type { EngineeringActor } from "../engineering/types";
import { validatePinFunctionFactSnapshot } from "./pin-facts";
import { interfaceDigest, interfaceId } from "./stable";
import type { AllocationUnsatCore, PinFunctionAllocationCandidate, PinFunctionAllocationProblem, PinFunctionAssignment, PinFunctionFactSnapshot, PinResourceRequirement, VerifiedPinFunctionFact } from "./types";
import { PIN_SOLVER_POLICY_VERSION } from "./types";

function containsAll(have: readonly string[], required: readonly string[]): boolean { const set = new Set(have); return required.every((item) => set.has(item)); }

function baseFactEligible(requirement: PinResourceRequirement, fact: VerifiedPinFunctionFact): boolean {
  if (!fact.packageBonded || fact.reserved || fact.errataBlockIds.length || !["source_backed", "verified"].includes(fact.evidenceState)) return false;
  if (!containsAll(fact.electricalCapabilities, requirement.requiredElectricalCapabilities)) return false;
  if (requirement.requiredPeripheralClass && fact.peripheralClass !== requirement.requiredPeripheralClass) return false;
  if (!containsAll(fact.channelCapabilities, requirement.requiredChannelCapabilities)) return false;
  if (!containsAll(fact.channelCapabilities, requirement.interruptWakeDMACapabilities)) return false;
  if (!containsAll(fact.channelCapabilities, requirement.analogCapabilities)) return false;
  if (!containsAll(fact.channelCapabilities, requirement.differentialLaneCapabilities)) return false;
  if (requirement.requiredBankOrVoltageDomain && fact.bankId !== requirement.requiredBankOrVoltageDomain && fact.voltageDomainId !== requirement.requiredBankOrVoltageDomain) return false;
  return true;
}

export function createPinFunctionAllocationProblem(input: { interfacePlanningCandidateId: string; snapshot: PinFunctionFactSnapshot; requirements: PinResourceRequirement[]; reservedTerminalIds?: string[]; fixedAssignments?: PinFunctionAllocationProblem["fixedAssignments"]; peripheralResourceConstraints?: PinFunctionAllocationProblem["peripheralResourceConstraints"]; bankDomainConstraints?: PinFunctionAllocationProblem["bankDomainConstraints"]; simultaneousUseConstraints?: PinFunctionAllocationProblem["simultaneousUseConstraints"]; debugBootClockResetConstraints?: PinFunctionAllocationProblem["debugBootClockResetConstraints"]; PCBFeedbackConstraints?: PinFunctionAllocationProblem["PCBFeedbackConstraints"] }): PinFunctionAllocationProblem {
  const factErrors = validatePinFunctionFactSnapshot(input.snapshot); if (factErrors.length) throw new Error(factErrors.join(","));
  if (!input.requirements.length || new Set(input.requirements.map((item) => item.resourceRequirementId)).size !== input.requirements.length) throw new Error("PIN_ALLOCATION_RESOURCE_REQUIREMENTS_INVALID");
  const reserved = [...new Set(input.reservedTerminalIds ?? [])].sort(); const pcb = input.PCBFeedbackConstraints ?? [];
  const allowedAssignmentEdges = input.requirements.flatMap((requirement) => input.snapshot.facts.filter((fact) => baseFactEligible(requirement, fact) && !reserved.includes(fact.atomicTerminalId) && !pcb.some((constraint) => constraint.prohibitedTerminalIds.includes(fact.atomicTerminalId) && constraint.evidenceState === "pass")).map((fact) => ({ resourceRequirementId: requirement.resourceRequirementId, factId: fact.factId }))).sort((a, b) => a.resourceRequirementId.localeCompare(b.resourceRequirementId) || a.factId.localeCompare(b.factId));
  const base = { allocationProblemId: interfaceId("pin-allocation-problem", { candidate: input.interfacePlanningCandidateId, snapshot: input.snapshot.deterministicDigest, requirements: input.requirements.map((item) => item.resourceRequirementId).sort(), fixed: input.fixedAssignments ?? [], pcb }), interfacePlanningCandidateId: input.interfacePlanningCandidateId, atomicPartRevisionId: input.snapshot.atomicPartRevisionId, packageRevisionId: input.snapshot.packageRevisionId, pinFunctionFactSnapshotId: input.snapshot.snapshotId, errataRevisionIds: input.snapshot.errataRevisionIds, resourceRequirementIds: input.requirements.map((item) => item.resourceRequirementId).sort(), requirements: structuredClone([...input.requirements].sort((a, b) => a.resourceRequirementId.localeCompare(b.resourceRequirementId))), facts: structuredClone(input.snapshot.facts), reservedTerminalIds: reserved, fixedAssignments: structuredClone((input.fixedAssignments ?? []).sort((a, b) => a.assignmentId.localeCompare(b.assignmentId))), allowedAssignmentEdges, peripheralResourceConstraints: structuredClone((input.peripheralResourceConstraints ?? []).sort((a, b) => a.couplingGroupId.localeCompare(b.couplingGroupId))), bankDomainConstraints: structuredClone((input.bankDomainConstraints ?? []).sort((a, b) => a.resourceRequirementId.localeCompare(b.resourceRequirementId))), packageBondoutConstraints: ["fact.packageBonded=true", "verified exact part/package mapping"], simultaneousUseConstraints: structuredClone((input.simultaneousUseConstraints ?? []).sort((a, b) => a.constraintId.localeCompare(b.constraintId))), debugBootClockResetConstraints: structuredClone((input.debugBootClockResetConstraints ?? []).sort((a, b) => a.constraintId.localeCompare(b.constraintId))), PCBFeedbackConstraints: structuredClone(pcb.sort((a, b) => a.constraintId.localeCompare(b.constraintId))), solverPolicyRevision: PIN_SOLVER_POLICY_VERSION };
  return { ...base, deterministicDigest: interfaceDigest(base) };
}

export function validatePinFunctionAllocationProblem(problem: PinFunctionAllocationProblem): string[] {
  const errors: string[] = [];
  if (!problem.allocationProblemId || !problem.interfacePlanningCandidateId || !problem.atomicPartRevisionId || !problem.packageRevisionId || problem.solverPolicyRevision !== PIN_SOLVER_POLICY_VERSION) errors.push("PIN_ALLOCATION_PROBLEM_IDENTITY_INVALID");
  if (problem.deterministicDigest !== interfaceDigest({ ...problem, deterministicDigest: undefined })) errors.push("PIN_ALLOCATION_PROBLEM_DIGEST_MISMATCH");
  if (new Set(problem.resourceRequirementIds).size !== problem.resourceRequirementIds.length || problem.resourceRequirementIds.length !== problem.requirements.length) errors.push("PIN_ALLOCATION_REQUIREMENT_MEMBERSHIP_INVALID");
  const reqIds = new Set(problem.resourceRequirementIds); const factIds = new Set(problem.facts.map((fact) => fact.factId));
  if (problem.allowedAssignmentEdges.some((edge) => !reqIds.has(edge.resourceRequirementId) || !factIds.has(edge.factId))) errors.push("PIN_ALLOCATION_EDGE_REFERENCE_INVALID");
  if (problem.fixedAssignments.some((fixed) => !reqIds.has(fixed.resourceRequirementId) || !factIds.has(fixed.factId) || !problem.allowedAssignmentEdges.some((edge) => edge.resourceRequirementId === fixed.resourceRequirementId && edge.factId === fixed.factId))) errors.push("PIN_ALLOCATION_FIXED_ASSIGNMENT_INVALID");
  if (problem.facts.some((fact) => fact.atomicPartRevisionId !== problem.atomicPartRevisionId || fact.packageRevisionId !== problem.packageRevisionId || !fact.packageBonded || !fact.evidenceRefs.length || !["source_backed", "verified"].includes(fact.evidenceState))) errors.push("PIN_ALLOCATION_UNVERIFIED_FACT");
  return errors.sort();
}

type AssignmentMap = Map<string, VerifiedPinFunctionFact>;
function constraintsSatisfied(problem: PinFunctionAllocationProblem, assigned: AssignmentMap, complete: boolean): boolean {
  const usedTerminals = new Set<string>(); const usedClaims = new Set<string>();
  for (const fact of assigned.values()) {
    if (usedTerminals.has(fact.atomicTerminalId)) return false; usedTerminals.add(fact.atomicTerminalId);
    for (const claim of fact.resourceClaims) { if (usedClaims.has(claim)) return false; usedClaims.add(claim); }
  }
  for (const group of problem.peripheralResourceConstraints) {
    const facts = group.resourceRequirementIds.map((id) => assigned.get(id)).filter((item): item is VerifiedPinFunctionFact => Boolean(item));
    if (facts.length > 1) { const instances = facts.map((fact) => fact.peripheralInstanceId ?? ""); if (group.relation === "same_instance" && new Set(instances).size > 1) return false; if (group.relation === "distinct_instance" && new Set(instances).size !== instances.length) return false; }
    if (complete && facts.length !== group.resourceRequirementIds.length) return false;
  }
  for (const bank of problem.bankDomainConstraints) { const fact = assigned.get(bank.resourceRequirementId); if (fact && (!fact.bankId || !bank.allowedBankIds.includes(fact.bankId) || (bank.requiredVoltageDomainId && fact.voltageDomainId !== bank.requiredVoltageDomainId))) return false; }
  for (const constraint of problem.simultaneousUseConstraints) if (constraint.resourceRequirementIds.filter((id) => assigned.has(id)).length > constraint.maximumActive) return false;
  for (const fixed of problem.fixedAssignments) { const fact = assigned.get(fixed.resourceRequirementId); if (fact && fact.factId !== fixed.factId) return false; if (complete && !fact) return false; }
  for (const preservation of problem.debugBootClockResetConstraints.filter((item) => item.preserveRecovery)) if (complete && preservation.resourceRequirementIds.every((id) => !assigned.has(id))) return false;
  return true;
}

function compatibleFacts(problem: PinFunctionAllocationProblem, requirementId: string): VerifiedPinFunctionFact[] { const ids = new Set(problem.allowedAssignmentEdges.filter((edge) => edge.resourceRequirementId === requirementId).map((edge) => edge.factId)); return problem.facts.filter((fact) => ids.has(fact.factId)).sort((a, b) => a.atomicTerminalId.localeCompare(b.atomicTerminalId) || a.logicalPinFunctionId.localeCompare(b.logicalPinFunctionId) || a.factId.localeCompare(b.factId)); }

function solveInternal(problem: PinFunctionAllocationProblem, maximumNodes: number, maximumSolutions: number): { solutions: AssignmentMap[]; exploredNodes: number; complete: boolean; order: string[] } {
  const order = [...problem.resourceRequirementIds].sort((a, b) => compatibleFacts(problem, a).length - compatibleFacts(problem, b).length || a.localeCompare(b)); const solutions: AssignmentMap[] = []; let exploredNodes = 0; let complete = true;
  const recurse = (index: number, assigned: AssignmentMap) => {
    if (solutions.length >= maximumSolutions) { complete = false; return; } if (++exploredNodes > maximumNodes) { complete = false; return; }
    if (index === order.length) { if (constraintsSatisfied(problem, assigned, true)) solutions.push(new Map(assigned)); return; }
    const requirementId = order[index]; const fixed = problem.fixedAssignments.find((item) => item.resourceRequirementId === requirementId); const facts = fixed ? problem.facts.filter((fact) => fact.factId === fixed.factId) : compatibleFacts(problem, requirementId);
    for (const fact of facts) { assigned.set(requirementId, fact); if (constraintsSatisfied(problem, assigned, false)) recurse(index + 1, assigned); assigned.delete(requirementId); if (!complete && (exploredNodes > maximumNodes || solutions.length >= maximumSolutions)) break; }
  };
  recurse(0, new Map()); return { solutions, exploredNodes, complete, order };
}

function unsatCore(problem: PinFunctionAllocationProblem, maximumNodes: number): AllocationUnsatCore {
  let ids = [...problem.resourceRequirementIds];
  for (const id of [...ids]) {
    const trialIds = ids.filter((item) => item !== id); if (!trialIds.length) continue;
    const trial = { ...problem, resourceRequirementIds: trialIds, requirements: problem.requirements.filter((item) => trialIds.includes(item.resourceRequirementId)), allowedAssignmentEdges: problem.allowedAssignmentEdges.filter((edge) => trialIds.includes(edge.resourceRequirementId)), fixedAssignments: problem.fixedAssignments.filter((item) => trialIds.includes(item.resourceRequirementId)), peripheralResourceConstraints: problem.peripheralResourceConstraints.map((item) => ({ ...item, resourceRequirementIds: item.resourceRequirementIds.filter((ref) => trialIds.includes(ref)) })).filter((item) => item.resourceRequirementIds.length > 1), simultaneousUseConstraints: problem.simultaneousUseConstraints.map((item) => ({ ...item, resourceRequirementIds: item.resourceRequirementIds.filter((ref) => trialIds.includes(ref)) })).filter((item) => item.resourceRequirementIds.length), debugBootClockResetConstraints: problem.debugBootClockResetConstraints.map((item) => ({ ...item, resourceRequirementIds: item.resourceRequirementIds.filter((ref) => trialIds.includes(ref)) })).filter((item) => item.resourceRequirementIds.length) };
    if (!solveInternal(trial, maximumNodes, 1).solutions.length) ids = trialIds;
  }
  const facts = problem.allowedAssignmentEdges.filter((edge) => ids.includes(edge.resourceRequirementId)).map((edge) => edge.factId); const constraints = [...problem.peripheralResourceConstraints.filter((item) => item.resourceRequirementIds.some((id) => ids.includes(id))).map((item) => `peripheral:${item.couplingGroupId}`), ...problem.bankDomainConstraints.filter((item) => ids.includes(item.resourceRequirementId)).map((item) => `bank:${item.resourceRequirementId}`), ...problem.simultaneousUseConstraints.filter((item) => item.resourceRequirementIds.some((id) => ids.includes(id))).map((item) => item.constraintId), ...problem.fixedAssignments.filter((item) => ids.includes(item.resourceRequirementId)).map((item) => `fixed:${item.assignmentId}`)].sort();
  const base = { coreId: interfaceId("pin-unsat-core", { problem: problem.deterministicDigest, ids, constraints }), resourceRequirementIds: ids.sort(), constraintIds: constraints, factIds: [...new Set(facts)].sort(), explanation: ids.some((id) => compatibleFacts(problem, id).length === 0) ? "At least one requirement has no evidence-backed allowed assignment edge." : "These jointly required resources cannot be assigned without violating terminal, peripheral-instance, bank, shared-resource, fixed, or simultaneous-use constraints.", minimal: true };
  return { ...base, deterministicDigest: interfaceDigest(base) };
}

function assignments(problem: PinFunctionAllocationProblem, solution: AssignmentMap): PinFunctionAssignment[] { return [...solution.entries()].map(([requirementId, fact]) => ({ assignmentId: interfaceId("pin-function-assignment", { allocationProblemId: problem.allocationProblemId, requirementId, fact: fact.factId }), resourceRequirementId: requirementId, signalEndpointId: problem.requirements.find((item) => item.resourceRequirementId === requirementId)?.endpointOrSignalIds[0] ?? "", atomicTerminalId: fact.atomicTerminalId, logicalPinFunctionId: fact.logicalPinFunctionId, alternateFunctionRouteId: fact.alternateFunctionRouteId, peripheralInstanceId: fact.peripheralInstanceId, channelOrLaneId: fact.channelOrLaneId, bankId: fact.bankId, packagePadId: fact.packagePadId, modeVariantConditions: problem.requirements.find((item) => item.resourceRequirementId === requirementId)?.modeVariantConditions ?? [], evidenceRefs: fact.evidenceRefs })).sort((a, b) => a.resourceRequirementId.localeCompare(b.resourceRequirementId)); }

export function solvePinFunctionAllocation(problem: PinFunctionAllocationProblem, input: { actor: EngineeringActor; createdAt: string; maximumNodes?: number; maximumSolutions?: number }): PinFunctionAllocationCandidate[] {
  const errors = validatePinFunctionAllocationProblem(problem); if (errors.length) throw new Error(errors.join(",")); const maximumNodes = input.maximumNodes ?? 250_000; const maximumSolutions = input.maximumSolutions ?? 8; const solved = solveInternal(problem, maximumNodes, maximumSolutions);
  if (!solved.solutions.length) {
    const core = unsatCore(problem, Math.min(maximumNodes, 50_000)); const base = { allocationCandidateId: interfaceId("pin-allocation-candidate", { problem: problem.deterministicDigest, state: solved.complete ? "infeasible" : "resource_limit" }), allocationProblemId: problem.allocationProblemId, assignmentRecords: [], peripheralInstanceSelections: [], bankDomainAssignments: [], sharedResourceAssignments: [], debugBootRecoveryReservations: [], hardConstraintResults: [{ constraintId: "joint-allocation", state: solved.complete ? "fail" as const : "unknown" as const, explanation: solved.complete ? core.explanation : "Solver resource limit reached before feasibility was proved.", objectRefs: core.resourceRequirementIds }], softObjectiveVector: [], feasibilityState: solved.complete ? "infeasible" as const : "resource_limit" as const, unsatCores: solved.complete ? [core] : [], alternativeCandidateIds: [], downstreamPinClosureObligations: [], searchCertificate: { exploredNodes: solved.exploredNodes, complete: solved.complete, canonicalVariableOrder: solved.order, canonicalFactOrder: problem.facts.map((fact) => fact.factId).sort(), solverPolicyRevision: problem.solverPolicyRevision }, createdBy: structuredClone(input.actor), createdAt: input.createdAt };
    return [{ ...base, deterministicDigest: interfaceDigest(base) }];
  }
  const ids = solved.solutions.map((solution) => interfaceId("pin-allocation-candidate", { problem: problem.deterministicDigest, assignments: [...solution].map(([req, fact]) => [req, fact.factId]).sort() }));
  return solved.solutions.map((solution, index) => { const records = assignments(problem, solution); const instances = [...new Set(records.map((item) => item.peripheralInstanceId).filter((item): item is string => Boolean(item)))].sort(); const base = { allocationCandidateId: ids[index], allocationProblemId: problem.allocationProblemId, assignmentRecords: records, peripheralInstanceSelections: problem.peripheralResourceConstraints.filter((item) => item.relation === "same_instance").map((item) => ({ couplingGroupId: item.couplingGroupId, peripheralInstanceId: solution.get(item.resourceRequirementIds[0])?.peripheralInstanceId ?? "" })), bankDomainAssignments: records.filter((item) => item.bankId).map((item) => ({ resourceRequirementId: item.resourceRequirementId, bankId: item.bankId!, voltageDomainId: solution.get(item.resourceRequirementId)?.voltageDomainId })), sharedResourceAssignments: [], debugBootRecoveryReservations: problem.debugBootClockResetConstraints.filter((item) => item.preserveRecovery).flatMap((item) => item.resourceRequirementIds), hardConstraintResults: [{ constraintId: "joint-allocation", state: "pass" as const, explanation: "All exact terminal, function, instance, bank, bondout, errata, fixed, shared-resource, simultaneous-use, recovery, and PCB feedback constraints pass.", objectRefs: records.map((item) => item.assignmentId) }], softObjectiveVector: [{ objectiveId: "distinct-peripheral-instances", direction: "minimize" as const, rawValue: instances.length, evidenceState: "pass" as const, method: "Exact assignment count" }, { objectiveId: "distinct-banks", direction: "minimize" as const, rawValue: new Set(records.map((item) => item.bankId).filter(Boolean)).size, evidenceState: "pass" as const, method: "Exact assignment count" }], feasibilityState: "feasible_for_exact_part_package" as const, unsatCores: [], alternativeCandidateIds: ids.filter((id) => id !== ids[index]), downstreamPinClosureObligations: records.map((item) => interfaceId("cd8-pin-closure-obligation", item.assignmentId)), searchCertificate: { exploredNodes: solved.exploredNodes, complete: solved.complete, canonicalVariableOrder: solved.order, canonicalFactOrder: problem.facts.map((fact) => fact.factId).sort(), solverPolicyRevision: problem.solverPolicyRevision }, createdBy: structuredClone(input.actor), createdAt: input.createdAt }; return { ...base, deterministicDigest: interfaceDigest(base) }; });
}

/** Independent bounded exhaustive oracle for differential tests. */
export function exhaustiveAllocationOracle(problem: PinFunctionAllocationProblem, maximumRequirements = 9): { feasible: boolean; solutionCount: number; canonicalSolutions: string[] } {
  if (problem.resourceRequirementIds.length > maximumRequirements) throw new Error("PIN_ALLOCATION_ORACLE_LIMIT_EXCEEDED");
  const requirements = [...problem.resourceRequirementIds].sort(); const factById = new Map(problem.facts.map((fact) => [fact.factId, fact])); const edges = new Map(requirements.map((id) => [id, problem.allowedAssignmentEdges.filter((edge) => edge.resourceRequirementId === id).map((edge) => edge.factId).sort()])); const results: string[] = [];
  const walk = (index: number, chosen: Array<[string, string]>) => {
    if (index === requirements.length) {
      const terminals = chosen.map(([, factId]) => factById.get(factId)!.atomicTerminalId); if (new Set(terminals).size !== terminals.length) return;
      const claims = chosen.flatMap(([, factId]) => factById.get(factId)!.resourceClaims); if (new Set(claims).size !== claims.length) return;
      for (const fixed of problem.fixedAssignments) if (chosen.find(([id]) => id === fixed.resourceRequirementId)?.[1] !== fixed.factId) return;
      for (const group of problem.peripheralResourceConstraints) { const selected = group.resourceRequirementIds.map((id) => factById.get(chosen.find(([req]) => req === id)?.[1] ?? "")?.peripheralInstanceId ?? ""); if (group.relation === "same_instance" && new Set(selected).size > 1) return; if (group.relation === "distinct_instance" && new Set(selected).size !== selected.length) return; }
      for (const bank of problem.bankDomainConstraints) { const fact = factById.get(chosen.find(([id]) => id === bank.resourceRequirementId)?.[1] ?? ""); if (!fact?.bankId || !bank.allowedBankIds.includes(fact.bankId) || (bank.requiredVoltageDomainId && fact.voltageDomainId !== bank.requiredVoltageDomainId)) return; }
      for (const simultaneous of problem.simultaneousUseConstraints) if (simultaneous.resourceRequirementIds.filter((id) => chosen.some(([req]) => req === id)).length > simultaneous.maximumActive) return;
      results.push(chosen.map(([req, fact]) => `${req}=${fact}`).join("|")); return;
    }
    const id = requirements[index]; for (const factId of edges.get(id) ?? []) walk(index + 1, [...chosen, [id, factId]]);
  };
  walk(0, []); return { feasible: results.length > 0, solutionCount: results.length, canonicalSolutions: results.sort() };
}

export function assertAllocationOracleEquivalent(problem: PinFunctionAllocationProblem, production: PinFunctionAllocationCandidate[], maximumRequirements = 9): void {
  const oracle = exhaustiveAllocationOracle(problem, maximumRequirements); const productionFeasible = production.some((item) => item.feasibilityState === "feasible_for_exact_part_package"); if (oracle.feasible !== productionFeasible) throw new Error("PIN_ALLOCATION_ORACLE_MISMATCH");
}
