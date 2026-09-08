import type { PcbNetlist } from "../netlist-bridge";
import type { PcbBoard, ResolvedPinPadMapping } from "../types";
import {
  canonicalEndpointSet,
  compareDiagnostics,
  engineeringDiagnostic,
  schematicEndpointKey,
  stableNetIdForEndpoints,
  type EngineeringDiagnostic,
} from "../integrity";
import { canonicalJson } from "../revision";
import { stableHash } from "../smart-routing/hash";
import type { SchematicParityCertificate } from "./types";
import { compareCodePoints } from "@/app/lib/stable-compare";

export function schematicRevisionId(netlist: PcbNetlist): string {
  const canonical = {
    components: [...netlist.components].map((component) => ({
      id: component.id,
      pins: [...component.pins].map((pin) => pin.number.trim()).sort(),
      pinPadMapping: component.pinPadMapping,
    })).sort((a, b) => compareCodePoints(a.id, b.id)),
    nets: [...netlist.nets].map((net) => ({
      name: net.name,
      endpointKeys: canonicalEndpointSet(net.endpointKeys),
      nodeKeys: canonicalEndpointSet(net.nodes.map((node) => schematicEndpointKey(node.componentId, node.pinNumber))),
    })).sort((a, b) => compareCodePoints(a.endpointKeys.join("\0"), b.endpointKeys.join("\0")) || compareCodePoints(a.name, b.name)),
  };
  const text = canonicalJson(canonical);
  return `sch1-${stableHash(`a\0${text}`)}${stableHash(`b\0${text}`)}`;
}

function mappingAssignedStableNet(
  board: PcbBoard,
  footprintId: string,
  mapping: ResolvedPinPadMapping,
): { stableNetId?: string; ambiguous: boolean } {
  const footprint = board.footprints.find((item) => item.id === footprintId);
  if (!footprint) return { ambiguous: true };
  const netIds = new Set(mapping.padNumbers.map((pad) => footprint.padNets[pad] ?? 0).filter((netId) => netId !== 0));
  if (netIds.size > 1) return { ambiguous: true };
  const netId = [...netIds][0];
  return { stableNetId: netId === undefined ? undefined : board.nets.find((net) => net.id === netId)?.stableId, ambiguous: false };
}

export function buildSchematicParityCertificate(
  board: PcbBoard,
  designRevision: string,
  netlist?: PcbNetlist,
  expectedDesignRevision = designRevision,
): SchematicParityCertificate {
  if (!netlist) {
    const diagnostic = engineeringDiagnostic(
      "SCHEMATIC_PARITY_NOT_EVALUATED",
      "The authoritative schematic/netlist is unavailable, so schematic-to-PCB parity cannot be proven.",
      { severity: "warning", suggestedActions: ["Open or synchronize the authoritative schematic, then rerun fabrication checks."] },
    );
    return {
      schemaVersion: "sirkit.schematic-pcb-parity.v1",
      designRevision,
      source: "unavailable",
      state: expectedDesignRevision === designRevision ? "unknown" : "stale",
      intendedComponents: [],
      assignedComponents: board.footprints.map((item) => item.id).sort(),
      physicalOnlyComponents: board.footprints.filter((item) => item.placementConstraints?.mechanical === true).map((item) => item.id).sort(),
      missingComponents: [],
      extraComponents: [],
      intendedEndpoints: [],
      mappedEndpoints: board.footprints.flatMap((item) => item.pinPadMappings?.map((mapping) => mapping.endpointKey) ?? []).sort(),
      missingEndpoints: [],
      extraEndpoints: [],
      ambiguousMappings: [],
      intendedNets: [],
      assignedNets: board.nets.filter((net) => net.id !== 0).map((net) => net.stableId ?? `unresolved-net:${net.id}`).sort(),
      missingNets: [],
      extraNets: [],
      netMembershipMismatches: [],
      intentionalNoConnects: [],
      diagnostics: [diagnostic],
    };
  }

  const diagnostics: EngineeringDiagnostic[] = [];
  const componentCounts = new Map<string, number>();
  for (const component of netlist.components) componentCounts.set(component.id, (componentCounts.get(component.id) ?? 0) + 1);
  const duplicateComponents = [...componentCounts].filter(([, count]) => count > 1).map(([id]) => id).sort();
  if (duplicateComponents.length > 0) diagnostics.push(engineeringDiagnostic(
    "SCHEMATIC_COMPONENT_ID_DUPLICATE",
    `The authoritative schematic contains ${duplicateComponents.length} duplicate stable component identity value(s).`,
    { componentIds: duplicateComponents },
  ));
  const intendedComponents = [...new Set(netlist.components.map((item) => item.id))].sort();
  const assignedComponents = [...new Set(board.footprints.map((item) => item.id))].sort();
  const physicalOnlyComponents = board.footprints
    .filter((item) => item.placementConstraints?.mechanical === true)
    .map((item) => item.id)
    .sort();
  const physicalOnlySet = new Set(physicalOnlyComponents);
  const intendedComponentSet = new Set(intendedComponents);
  const assignedComponentSet = new Set(assignedComponents);
  const missingComponents = intendedComponents.filter((id) => !assignedComponentSet.has(id));
  const extraComponents = assignedComponents.filter((id) => !intendedComponentSet.has(id) && !physicalOnlySet.has(id));

  const intendedEndpoints = canonicalEndpointSet(netlist.components.flatMap((component) =>
    component.pins.map((pin) => schematicEndpointKey(component.id, pin.number)),
  ));
  const endpointOccurrences = netlist.components.flatMap((component) =>
    component.pins.map((pin) => schematicEndpointKey(component.id, pin.number)),
  );
  const endpointCounts = new Map<string, number>();
  for (const endpointKey of endpointOccurrences) endpointCounts.set(endpointKey, (endpointCounts.get(endpointKey) ?? 0) + 1);
  const duplicateEndpoints = intendedEndpoints.filter((endpointKey) =>
    (endpointCounts.get(endpointKey) ?? 0) > 1,
  );
  if (duplicateEndpoints.length > 0) diagnostics.push(engineeringDiagnostic(
    "SCHEMATIC_ENDPOINT_ID_DUPLICATE",
    `The authoritative schematic contains ${duplicateEndpoints.length} duplicate logical endpoint identity value(s).`,
    { objectIds: duplicateEndpoints },
  ));
  const mappings = board.footprints.flatMap((footprint) => (footprint.pinPadMappings ?? []).map((mapping) => ({ footprint, mapping })));
  const mappedEndpoints = canonicalEndpointSet(mappings.map(({ mapping }) => mapping.endpointKey));
  const intendedEndpointSet = new Set(intendedEndpoints);
  const mappedEndpointSet = new Set(mappedEndpoints);
  const missingEndpoints = intendedEndpoints.filter((key) => !mappedEndpointSet.has(key));
  const extraEndpoints = mappedEndpoints.filter((key) => !intendedEndpointSet.has(key));

  const expectedNetByEndpoint = new Map<string, string>();
  const intendedNets: string[] = [];
  const intendedNetCounts = new Map<string, number>();
  for (const net of netlist.nets) {
    const nodeKeys = canonicalEndpointSet(net.nodes.map((node) => schematicEndpointKey(node.componentId, node.pinNumber)));
    const endpointKeys = canonicalEndpointSet(net.endpointKeys);
    if (nodeKeys.join("\0") !== endpointKeys.join("\0")) diagnostics.push(engineeringDiagnostic(
      "SCHEMATIC_CONNECTIVITY_INVALID",
      `Schematic net '${net.name}' has inconsistent node and endpoint identity sets.`,
      { componentIds: [...new Set(net.nodes.map((node) => node.componentId))].sort(), context: { nodeKeys, endpointKeys } },
    ));
    const stableNetId = stableNetIdForEndpoints(endpointKeys, net.name);
    intendedNets.push(stableNetId);
    intendedNetCounts.set(stableNetId, (intendedNetCounts.get(stableNetId) ?? 0) + 1);
    for (const endpointKey of endpointKeys) {
      const prior = expectedNetByEndpoint.get(endpointKey);
      if (prior && prior !== stableNetId) diagnostics.push(engineeringDiagnostic(
        "SCHEMATIC_CONNECTIVITY_INVALID",
        `Schematic endpoint ${endpointKey} belongs to more than one stable net.`,
        { context: { endpointKey, stableNetIds: [prior, stableNetId].sort() } },
      ));
      expectedNetByEndpoint.set(endpointKey, stableNetId);
    }
  }
  const duplicateNets = [...intendedNetCounts].filter(([, count]) => count > 1).map(([id]) => id).sort();
  if (duplicateNets.length > 0) diagnostics.push(engineeringDiagnostic(
    "SCHEMATIC_NET_ID_DUPLICATE",
    `The authoritative schematic contains ${duplicateNets.length} duplicate stable net identity value(s).`,
    { netStableIds: duplicateNets },
  ));

  const mappingCount = new Map<string, number>();
  const ambiguousMappings = new Set<string>();
  const intentionalNoConnects: string[] = [];
  const assignedNetByEndpoint = new Map<string, string | undefined>();
  for (const { footprint, mapping } of mappings) {
    mappingCount.set(mapping.endpointKey, (mappingCount.get(mapping.endpointKey) ?? 0) + 1);
    if (mapping.componentInstanceId !== footprint.id) ambiguousMappings.add(mapping.endpointKey);
    const missingPads = mapping.padNumbers.filter((pad) => !footprint.def.pads.some((candidate) => candidate.number === pad));
    if (missingPads.length > 0) ambiguousMappings.add(mapping.endpointKey);
    if (mapping.mappingKind === "intentional-no-connect" || mapping.mappingKind === "schematic-only") {
      intentionalNoConnects.push(mapping.endpointKey);
      if (expectedNetByEndpoint.has(mapping.endpointKey)) ambiguousMappings.add(mapping.endpointKey);
      assignedNetByEndpoint.set(mapping.endpointKey, undefined);
      continue;
    }
    const assigned = mappingAssignedStableNet(board, footprint.id, mapping);
    if (assigned.ambiguous || !assigned.stableNetId) ambiguousMappings.add(mapping.endpointKey);
    assignedNetByEndpoint.set(mapping.endpointKey, assigned.stableNetId);
  }
  for (const [endpointKey, count] of mappingCount) if (count !== 1) ambiguousMappings.add(endpointKey);

  const netMembershipMismatches = intendedEndpoints.flatMap((endpointKey) => {
    const expected = expectedNetByEndpoint.get(endpointKey);
    const assigned = assignedNetByEndpoint.get(endpointKey);
    const intentional = intentionalNoConnects.includes(endpointKey);
    if ((!expected && intentional) || expected === assigned) return [];
    return [{ endpointKey, ...(expected ? { intendedStableNetId: expected } : {}), ...(assigned ? { assignedStableNetId: assigned } : {}) }];
  }).sort((a, b) => compareCodePoints(a.endpointKey, b.endpointKey));

  const assignedNets = board.nets.filter((net) => net.id !== 0).map((net) => net.stableId ?? `unresolved-net:${net.id}`).sort();
  const intendedNetSet = new Set(intendedNets);
  const assignedNetSet = new Set(assignedNets);
  const missingNets = [...new Set(intendedNets)].sort().filter((id) => !assignedNetSet.has(id));
  const extraNets = [...new Set(assignedNets)].sort().filter((id) => !intendedNetSet.has(id));

  const addSetDiagnostic = (code: string, summary: string, ids: string[], field: "componentIds" | "objectIds"): void => {
    if (ids.length === 0) return;
    diagnostics.push(engineeringDiagnostic(code, summary, { [field]: ids }));
  };
  addSetDiagnostic("SCHEMATIC_COMPONENT_MISSING", `${missingComponents.length} schematic component(s) are missing from the PCB.`, missingComponents, "componentIds");
  addSetDiagnostic("PCB_COMPONENT_EXTRA", `${extraComponents.length} PCB footprint(s) are absent from the authoritative schematic.`, extraComponents, "componentIds");
  addSetDiagnostic("SCHEMATIC_ENDPOINT_MISSING", `${missingEndpoints.length} logical endpoint(s) have no physical mapping.`, missingEndpoints, "objectIds");
  addSetDiagnostic("PCB_ENDPOINT_EXTRA", `${extraEndpoints.length} mapped endpoint(s) are absent from the authoritative schematic.`, extraEndpoints, "objectIds");
  addSetDiagnostic("PIN_PAD_MAPPING_AMBIGUOUS", `${ambiguousMappings.size} pin-to-pad mapping(s) are ambiguous.`, [...ambiguousMappings].sort(), "objectIds");
  if (netMembershipMismatches.length > 0) diagnostics.push(engineeringDiagnostic(
    "NET_MEMBERSHIP_MISMATCH",
    `${netMembershipMismatches.length} endpoint(s) belong to a different stable net on the PCB.`,
    { objectIds: netMembershipMismatches.map((item) => item.endpointKey), context: { mismatches: netMembershipMismatches } },
  ));
  if (missingNets.length > 0 || extraNets.length > 0) diagnostics.push(engineeringDiagnostic(
    "STABLE_NET_SET_MISMATCH",
    "The schematic and PCB stable-net identity sets differ.",
    { netStableIds: [...new Set([...missingNets, ...extraNets])].sort(), context: { missingNets, extraNets } },
  ));

  const stale = expectedDesignRevision !== designRevision;
  return {
    schemaVersion: "sirkit.schematic-pcb-parity.v1",
    designRevision,
    schematicRevision: schematicRevisionId(netlist),
    source: "authoritative-netlist",
    state: stale ? "stale" : diagnostics.some((diagnostic) => diagnostic.severity === "error") ? "fail" : "pass",
    intendedComponents,
    assignedComponents,
    physicalOnlyComponents,
    missingComponents,
    extraComponents,
    intendedEndpoints,
    mappedEndpoints,
    missingEndpoints,
    extraEndpoints,
    ambiguousMappings: [...ambiguousMappings].sort(),
    intendedNets: [...new Set(intendedNets)].sort(),
    assignedNets: [...new Set(assignedNets)].sort(),
    missingNets,
    extraNets,
    netMembershipMismatches,
    intentionalNoConnects: [...new Set(intentionalNoConnects)].sort(),
    diagnostics: diagnostics.sort(compareDiagnostics),
  };
}
