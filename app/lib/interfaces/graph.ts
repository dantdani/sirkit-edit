import { interfaceId } from "./stable";
import type { InterfaceContractSet, InterfaceDiagnostic, SignalEndpoint } from "./types";

function diagnostic(code: string, message: string, refs: string[], requirements: string[] = []): InterfaceDiagnostic {
  return { diagnosticId: interfaceId("interface-diagnostic", { code, message, refs, requirements }), code, severity: "blocking", message, objectRefs: [...new Set(refs)].sort(), requirementRefs: [...new Set(requirements)].sort(), blocks: "logical_planning", derivation: "Deterministic typed interface graph closure", nextAction: "Revise the interface candidate with explicit typed endpoints, roles, groups, conditions, and ownership.", staleDependencyKeys: [...new Set([...refs, ...requirements])].sort() };
}

function canDrive(endpoint: SignalEndpoint): boolean { return ["output", "bidirectional", "open_drain", "open_collector", "tri_state", "analog_output", "analog_bidirectional", "differential_output", "differential_bidirectional", "clock_source", "reset_source"].includes(endpoint.electricalDirection); }
function canReceive(endpoint: SignalEndpoint): boolean { return ["input", "bidirectional", "open_drain", "open_collector", "tri_state", "analog_input", "analog_bidirectional", "differential_input", "differential_bidirectional", "clock_sink", "reset_sink"].includes(endpoint.electricalDirection); }

export function validateInterfaceGraph(contractSet: InterfaceContractSet): InterfaceDiagnostic[] {
  const diagnostics: InterfaceDiagnostic[] = [];
  const interfaces = new Map(contractSet.interfaces.map((item) => [item.interfaceId, item]));
  const endpoints = new Map(contractSet.endpoints.map((item) => [item.endpointId, item]));
  const signals = new Map(contractSet.signals.map((item) => [item.signalId, item]));
  const groups = new Map(contractSet.signalGroups.map((item) => [item.groupId, item]));
  const domains = new Set(contractSet.voltageDomains.map((item) => item.domainId));
  const safeStates = new Set(contractSet.safeStates.map((item) => item.safeStateId));
  if (interfaces.size !== contractSet.interfaces.length || endpoints.size !== contractSet.endpoints.length || signals.size !== contractSet.signals.length || groups.size !== contractSet.signalGroups.length) diagnostics.push(diagnostic("INTERFACE_GRAPH_ID_REUSE", "Interface graph identities are not unique.", []));
  for (const item of contractSet.interfaces) {
    if (item.endpointIds.length < 2) diagnostics.push(diagnostic("INTERFACE_ENDPOINT_CARDINALITY_INVALID", `Interface '${item.interfaceId}' has fewer than two endpoints.`, [item.interfaceId], item.requirementIds));
    for (const id of item.endpointIds) if (!endpoints.has(id) || endpoints.get(id)?.interfaceId !== item.interfaceId) diagnostics.push(diagnostic("INTERFACE_ENDPOINT_REFERENCE_INVALID", `Interface '${item.interfaceId}' references a missing or foreign endpoint.`, [item.interfaceId, id], item.requirementIds));
    for (const id of item.signalGroupIds) if (!groups.has(id)) diagnostics.push(diagnostic("INTERFACE_GROUP_REFERENCE_INVALID", `Interface '${item.interfaceId}' references a missing signal group.`, [item.interfaceId, id], item.requirementIds));
    if (!item.ownership.hardwareOwner.trim()) diagnostics.push(diagnostic("INTERFACE_HARDWARE_OWNER_REQUIRED", `Interface '${item.interfaceId}' has no hardware owner.`, [item.interfaceId], item.requirementIds));
  }
  for (const endpoint of contractSet.endpoints) {
    if (!interfaces.has(endpoint.interfaceId)) diagnostics.push(diagnostic("ENDPOINT_INTERFACE_REFERENCE_INVALID", `Endpoint '${endpoint.endpointId}' references a missing interface.`, [endpoint.endpointId, endpoint.interfaceId], endpoint.requirementIds));
    if (!domains.has(endpoint.voltageDomainContractId)) diagnostics.push(diagnostic("ENDPOINT_VOLTAGE_DOMAIN_MISSING", `Endpoint '${endpoint.endpointId}' has no authoritative voltage-domain contract.`, [endpoint.endpointId, endpoint.voltageDomainContractId], endpoint.requirementIds));
    if (!endpoint.referenceReturnDomainId) diagnostics.push(diagnostic("ENDPOINT_RETURN_REFERENCE_MISSING", `Endpoint '${endpoint.endpointId}' has no semantic return reference.`, [endpoint.endpointId], endpoint.requirementIds));
    if (!endpoint.ownership.hardwareOwner.trim()) diagnostics.push(diagnostic("ENDPOINT_OWNER_REQUIRED", `Endpoint '${endpoint.endpointId}' has no hardware owner.`, [endpoint.endpointId], endpoint.requirementIds));
    for (const id of endpoint.safeStateContractIds) if (!safeStates.has(id)) diagnostics.push(diagnostic("ENDPOINT_SAFE_STATE_REFERENCE_INVALID", `Endpoint '${endpoint.endpointId}' references a missing safe-state contract.`, [endpoint.endpointId, id], endpoint.requirementIds));
    if (!contractSet.signals.some((signal) => signal.endpointIds.includes(endpoint.endpointId))) diagnostics.push(diagnostic("ORPHAN_INTERFACE_ENDPOINT", `Endpoint '${endpoint.endpointId}' does not participate in a logical signal.`, [endpoint.endpointId], endpoint.requirementIds));
  }
  for (const signal of contractSet.signals) {
    const members = signal.endpointIds.map((id) => endpoints.get(id)).filter((item): item is SignalEndpoint => Boolean(item));
    if (members.length !== signal.endpointIds.length || members.length < 2) diagnostics.push(diagnostic("SIGNAL_ENDPOINT_CLOSURE_INVALID", `Signal '${signal.signalId}' has a missing or insufficient endpoint set.`, [signal.signalId, ...signal.endpointIds], signal.requirementIds));
    if (!members.some(canDrive)) diagnostics.push(diagnostic("SIGNAL_DRIVER_REQUIRED", `Signal '${signal.signalId}' has no explicit driving endpoint.`, [signal.signalId, ...signal.endpointIds], signal.requirementIds));
    if (!members.some(canReceive)) diagnostics.push(diagnostic("SIGNAL_RECEIVER_REQUIRED", `Signal '${signal.signalId}' has no explicit receiving endpoint.`, [signal.signalId, ...signal.endpointIds], signal.requirementIds));
    const activeDrivers = members.filter((endpoint) => canDrive(endpoint) && !["open_drain", "open_collector", "tri_state", "bidirectional", "differential_bidirectional", "analog_bidirectional"].includes(endpoint.electricalDirection));
    if (activeDrivers.length > 1) diagnostics.push(diagnostic("SIGNAL_ACTIVE_DRIVER_CONTENTION", `Signal '${signal.signalId}' has multiple always-active driver roles.`, [signal.signalId, ...activeDrivers.map((item) => item.endpointId)], signal.requirementIds));
    for (const groupId of signal.groupIds) if (!groups.has(groupId) || !groups.get(groupId)?.memberSignalIds.includes(signal.signalId)) diagnostics.push(diagnostic("SIGNAL_GROUP_MEMBERSHIP_ASYMMETRIC", `Signal '${signal.signalId}' has an inconsistent group membership.`, [signal.signalId, groupId], signal.requirementIds));
  }
  for (const group of contractSet.signalGroups) {
    if (new Set(group.memberSignalIds).size !== group.memberSignalIds.length || group.memberSignalIds.some((id) => !signals.has(id))) diagnostics.push(diagnostic("SIGNAL_GROUP_MEMBER_INVALID", `Group '${group.groupId}' has duplicate or missing members.`, [group.groupId, ...group.memberSignalIds]));
    if (group.orderedMembership && (group.orderedMembership.length !== group.memberSignalIds.length || new Set(group.orderedMembership).size !== group.orderedMembership.length || group.orderedMembership.some((id) => !group.memberSignalIds.includes(id)))) diagnostics.push(diagnostic("SIGNAL_GROUP_ORDER_INVALID", `Group '${group.groupId}' ordered membership is not a permutation of its members.`, [group.groupId]));
    if (group.groupKind === "differential_pair") {
      const pair = group.memberSignalIds.map((id) => signals.get(id));
      if (pair.length !== 2 || pair.some((item) => !item) || new Set(pair.map((item) => item?.polarityOrLaneRole)).size !== 2 || !pair.some((item) => item?.polarityOrLaneRole === "positive") || !pair.some((item) => item?.polarityOrLaneRole === "negative")) diagnostics.push(diagnostic("DIFFERENTIAL_PAIR_MEMBERSHIP_INVALID", `Differential pair '${group.groupId}' requires exactly one positive and one negative signal.`, [group.groupId, ...group.memberSignalIds]));
    }
  }
  return diagnostics.sort((a, b) => a.code.localeCompare(b.code) || a.diagnosticId.localeCompare(b.diagnosticId));
}

export function interfaceGraphClosureDigest(contractSet: InterfaceContractSet): string { return interfaceId("interface-graph-closure", validateInterfaceGraph(contractSet).map((item) => ({ code: item.code, refs: item.objectRefs }))); }

