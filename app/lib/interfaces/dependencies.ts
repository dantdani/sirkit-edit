import { interfaceDigest, interfaceId } from "./stable";
import type { BootConfigurationPlan, ClockPlan, InterfaceDiagnostic, ResetPlan } from "./types";

export interface DependencyCycle { cycleId: string; nodeIds: string[]; edgeIds: string[]; explanation: string; deterministicDigest: string; }

export function findDependencyCycles(edges: readonly { edgeId: string; fromId: string; toId: string }[]): DependencyCycle[] {
  const ordered = [...edges].sort((a, b) => a.fromId.localeCompare(b.fromId) || a.toId.localeCompare(b.toId) || a.edgeId.localeCompare(b.edgeId));
  const adjacency = new Map<string, Array<{ edgeId: string; toId: string }>>();
  for (const edge of ordered) adjacency.set(edge.fromId, [...(adjacency.get(edge.fromId) ?? []), { edgeId: edge.edgeId, toId: edge.toId }]);
  const cycles = new Map<string, DependencyCycle>();
  const nodes = [...new Set(ordered.flatMap((edge) => [edge.fromId, edge.toId]))].sort();
  function visit(start: string, current: string, pathNodes: string[], pathEdges: string[], seen: Set<string>): void {
    for (const edge of adjacency.get(current) ?? []) {
      if (edge.toId === start) {
        const rawNodes = [...pathNodes, current]; const rotations = rawNodes.map((_, index) => [...rawNodes.slice(index), ...rawNodes.slice(0, index)]); const canonicalNodes = rotations.map((item) => item.join("|")).sort()[0].split("|");
        const digestBase = { nodes: canonicalNodes, edgeCount: pathEdges.length + 1 }; const cycleId = interfaceId("dependency-cycle", digestBase);
        const base = { cycleId, nodeIds: canonicalNodes, edgeIds: [...pathEdges, edge.edgeId].sort(), explanation: `Dependency cycle: ${[...rawNodes, start].join(" -> ")}.` };
        cycles.set(cycleId, { ...base, deterministicDigest: interfaceDigest(base) }); continue;
      }
      if (seen.has(edge.toId) || pathNodes.length >= nodes.length) continue;
      visit(start, edge.toId, [...pathNodes, current], [...pathEdges, edge.edgeId], new Set([...seen, edge.toId]));
    }
  }
  for (const node of nodes) visit(node, node, [], [], new Set([node]));
  return [...cycles.values()].sort((a, b) => a.cycleId.localeCompare(b.cycleId));
}

function diag(code: string, message: string, refs: string[]): InterfaceDiagnostic { return { diagnosticId: interfaceId("interface-diagnostic", { code, message, refs }), code, severity: "blocking", message, objectRefs: [...refs].sort(), requirementRefs: [], blocks: "logical_planning", derivation: "Deterministic clock/reset/boot dependency model checker", nextAction: "Revise dependency ownership, add an independently available source, or define a bounded timeout/fallback path.", staleDependencyKeys: [...refs].sort() }; }

export function validateClockPlan(plan: ClockPlan): InterfaceDiagnostic[] {
  const diagnostics: InterfaceDiagnostic[] = []; const nodeIds = new Set(plan.clockNodes.map((node) => node.clockNodeId));
  if (nodeIds.size !== plan.clockNodes.length) diagnostics.push(diag("CLOCK_NODE_ID_REUSE", "Clock node identities are not unique.", [plan.clockPlanId]));
  for (const edge of plan.clockEdges) if (!nodeIds.has(edge.fromClockNodeId) || !nodeIds.has(edge.toClockNodeId)) diagnostics.push(diag("CLOCK_EDGE_REFERENCE_INVALID", "Clock edge references a missing node.", [plan.clockPlanId, edge.edgeId]));
  const cycles = findDependencyCycles(plan.clockEdges.map((edge) => ({ edgeId: edge.edgeId, fromId: edge.fromClockNodeId, toId: edge.toClockNodeId })));
  for (const cycle of cycles) diagnostics.push(diag("CLOCK_GRAPH_CYCLE", cycle.explanation, [plan.clockPlanId, cycle.cycleId, ...cycle.nodeIds]));
  for (const consumer of plan.consumerIds) if (!nodeIds.has(consumer) && !plan.clockNodes.some((node) => node.semanticRole === consumer)) diagnostics.push(diag("CLOCK_CONSUMER_UNREACHABLE", `Clock consumer '${consumer}' is not represented by a clock node.`, [plan.clockPlanId, consumer]));
  if (!plan.clockSourceIds.length && plan.consumerIds.length) diagnostics.push(diag("CLOCK_SOURCE_REQUIRED", "Clock consumers exist without a clock source role.", [plan.clockPlanId]));
  for (const node of plan.clockNodes.filter((item) => item.nodeKind === "source" || item.nodeKind === "oscillator_role")) if (!node.modeAvailability.length || !node.powerRailDependencies.length) diagnostics.push(diag("CLOCK_STARTUP_AVAILABILITY_INCOMPLETE", `Clock source '${node.clockNodeId}' lacks explicit mode or power availability.`, [plan.clockPlanId, node.clockNodeId]));
  return diagnostics.sort((a, b) => a.code.localeCompare(b.code) || a.diagnosticId.localeCompare(b.diagnosticId));
}

export function validateResetPlan(plan: ResetPlan): InterfaceDiagnostic[] {
  const diagnostics: InterfaceDiagnostic[] = [];
  const cycles = findDependencyCycles(plan.dependencyEdges.map((edge) => ({ edgeId: edge.edgeId, fromId: edge.fromId, toId: edge.toId })));
  for (const cycle of cycles) diagnostics.push(diag("RESET_POWER_CLOCK_DEPENDENCY_CYCLE", cycle.explanation, [plan.resetPlanId, cycle.cycleId, ...cycle.nodeIds]));
  if (plan.resetConsumerIds.length && !plan.resetSourceIds.length) diagnostics.push(diag("RESET_SOURCE_REQUIRED", "Reset consumers exist without an explicit reset source.", [plan.resetPlanId]));
  if (!plan.assertionPolicies.length || !plan.deassertionPolicies.length) diagnostics.push(diag("RESET_ASSERT_DEASSERT_POLICY_REQUIRED", "Reset assertion and deassertion policies must both be explicit.", [plan.resetPlanId]));
  if (plan.powerClockDependencies.length && !plan.timeoutRecoveryPolicies.length) diagnostics.push(diag("RESET_TIMEOUT_RECOVERY_REQUIRED", "Power/clock-dependent reset release needs a bounded timeout or recovery policy.", [plan.resetPlanId]));
  return diagnostics.sort((a, b) => a.code.localeCompare(b.code) || a.diagnosticId.localeCompare(b.diagnosticId));
}

export function validateBootPlan(plan: BootConfigurationPlan): InterfaceDiagnostic[] {
  const diagnostics: InterfaceDiagnostic[] = [];
  if (!plan.bootModeIds.includes(plan.defaultBootModeId)) diagnostics.push(diag("BOOT_DEFAULT_MODE_INVALID", "Default boot mode is not in the boot-mode set.", [plan.bootPlanId, plan.defaultBootModeId]));
  if (plan.strapSignalIds.length && (!plan.strapSamplingConditions.length || !plan.passiveBiasObligationIds.length)) diagnostics.push(diag("BOOT_STRAP_CONTRACT_INCOMPLETE", "Every strap needs a sampling condition and passive default-bias obligation.", [plan.bootPlanId, ...plan.strapSignalIds]));
  for (const reuse of plan.runtimeReusePolicies) if (reuse.allowed && (!reuse.requiredOrder.length || !reuse.exactAllocationConstraintId)) diagnostics.push(diag("BOOT_STRAP_RUNTIME_REUSE_UNSAFE", `Runtime reuse of '${reuse.signalId}' lacks ordered transition and exact-allocation constraints.`, [plan.bootPlanId, reuse.signalId]));
  if (!plan.fallbackRecoveryTransitions.length) diagnostics.push(diag("BOOT_RECOVERY_PATH_REQUIRED", "Boot planning requires a non-silent fallback or recovery transition.", [plan.bootPlanId]));
  return diagnostics.sort((a, b) => a.code.localeCompare(b.code) || a.diagnosticId.localeCompare(b.diagnosticId));
}

