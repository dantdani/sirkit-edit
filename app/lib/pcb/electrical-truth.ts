import type { PcbBoard } from "./types";
import type { LayerId } from "./layers";
import type { Vec2 } from "./geometry";
import {
  computeConnectivity,
  copperItemId,
  type Airwire,
  type BoardConnectivity,
  type CopperItemRef,
} from "./connectivity-board";
import { padCopperLayers, padWorldPosition } from "./geometry-copper";
import { physicalPadInstances, physicalPadByIdentity } from "./pad-identity";
import { getBoardStackup } from "./stackup";
import { pcbRevisionId } from "./revision";
import { engineeringDiagnostic, compareDiagnostics, type EngineeringDiagnostic } from "./integrity";
import { stableHash } from "./smart-routing/hash";
import { zoneFillIsCurrent } from "./zones/fill-lifecycle";
import { stackupPlaneZoneId } from "./zones/plane";
import { compareCodePoints } from "@/app/lib/stable-compare";

export const ELECTRICAL_TRUTH_SCHEMA = "sirkit.electrical-truth.v1" as const;
export type ElectricalProofState = "proven" | "failed" | "unknown";

export interface ElectricalUnknown {
  code: "SCHEMATIC_PARITY_UNPROVEN" | "NATIVE_PLANE_UNRESOLVED" | "ZONE_FILL_UNRESOLVED" | "NET_IDENTITY_UNRESOLVED" | "COPPER_NET_RELATION_UNRESOLVED";
  summary: string;
  stableNetId?: string;
  objectIds: string[];
}

export interface ElectricalPhysicalPad {
  id: string;
  componentId: string;
  footprintId: string;
  reference: string;
  padNumber: string;
  padIndex: number;
  netId: number;
  stableNetId?: string;
  position: Vec2;
  layers: LayerId[];
}

export interface ElectricalTerminalGroup {
  id: string;
  stableNetId: string;
  netId: number;
  endpointKeys: string[];
  physicalPadInstanceIds: string[];
  provenance: "stage1-mapping" | "legacy-pad-assignment";
}

export interface NetElectricalStatus {
  stableNetId: string;
  netId: number;
  name: string;
  state: ElectricalProofState;
  intentState: ElectricalProofState;
  assignmentState: ElectricalProofState;
  realizationState: ElectricalProofState;
  endpointKeys: string[];
  terminalGroupIds: string[];
  physicalPadInstanceIds: string[];
  conductiveClusters: string[][];
  padContainingClusterCount: number;
  requiredConnections: number;
  completedConnections: number;
  remainingConnections: number;
  shortIds: string[];
  unresolvedCodes: ElectricalUnknown["code"][];
}

export interface ElectricalShortStatus {
  id: string;
  objectIds: [string, string];
  stableNetIds: string[];
}

export interface ElectricalOrphanStatus {
  objectId: string;
  stableNetId?: string;
  netId: number;
  reason: "unassigned" | "touches-nothing" | "no-terminal-path";
}

export interface ElectricalTruthReport {
  schemaVersion: typeof ELECTRICAL_TRUTH_SCHEMA;
  designRevision: string;
  units: "nm";
  intended: {
    state: ElectricalProofState;
    endpointCount: number;
    netStableIds: string[];
  };
  assigned: {
    state: ElectricalProofState;
    physicalPads: ElectricalPhysicalPad[];
    terminalGroups: ElectricalTerminalGroup[];
    missingEndpointKeys: string[];
    unaccountedPadInstanceIds: string[];
  };
  realized: {
    state: ElectricalProofState;
    connectivity: BoardConnectivity;
    requiredConnections: number;
    completedConnections: number;
    remainingConnections: number;
    routedNets: number;
    totalNets: number;
    percent: number;
    airwires: Airwire[];
  };
  nets: NetElectricalStatus[];
  shorts: ElectricalShortStatus[];
  orphanCopper: ElectricalOrphanStatus[];
  unresolved: ElectricalUnknown[];
  diagnostics: EngineeringDiagnostic[];
}

class UnionFind {
  private parent: number[];
  constructor(size: number) { this.parent = Array.from({ length: size }, (_, index) => index); }
  find(index: number): number {
    let root = index;
    while (this.parent[root] !== root) root = this.parent[root];
    while (this.parent[index] !== index) {
      const next = this.parent[index];
      this.parent[index] = root;
      index = next;
    }
    return root;
  }
  union(a: number, b: number): void {
    const left = this.find(a);
    const right = this.find(b);
    if (left !== right) this.parent[right] = left;
  }
}

function refNetId(board: PcbBoard, ref: CopperItemRef): number {
  if (ref.kind === "track") return board.tracks.find((track) => track.id === ref.id)?.netId ?? 0;
  if (ref.kind === "via") return board.vias.find((via) => via.id === ref.id)?.netId ?? 0;
  if (ref.kind === "zone-region") return board.zones.find((zone) => zone.id === ref.zoneId)?.netId ?? 0;
  return board.footprints.find((footprint) => footprint.id === ref.instanceId)?.padNets[ref.padNumber] ?? 0;
}

function refPositions(board: PcbBoard, ref: CopperItemRef): Vec2[] {
  if (ref.kind === "track") {
    const track = board.tracks.find((item) => item.id === ref.id);
    return track ? [track.start, track.end] : [];
  }
  if (ref.kind === "via") {
    const via = board.vias.find((item) => item.id === ref.id);
    return via ? [via.at] : [];
  }
  if (ref.kind === "zone-region") {
    const region = board.zones.find((zone) => zone.id === ref.zoneId)?.fill[ref.regionIndex];
    return region?.outer[0] ? [region.outer[0]] : [];
  }
  const footprint = board.footprints.find((item) => item.id === ref.instanceId);
  if (!footprint) return [];
  const physical = physicalPadByIdentity(footprint, ref.padInstanceId, ref.padIndex, ref.padNumber);
  return physical ? [padWorldPosition(footprint, physical.pad)] : [];
}

function clusterAirwires(netId: number, groups: Array<{ refs: CopperItemRef[]; positions: Vec2[] }>): Airwire[] {
  if (groups.length < 2) return [];
  const inTree = new Set<number>([0]);
  const output: Airwire[] = [];
  while (inTree.size < groups.length) {
    let best: { fromGroup: number; toGroup: number; from: Vec2; to: Vec2; d2: number } | undefined;
    for (const fromGroup of inTree) {
      for (let toGroup = 0; toGroup < groups.length; toGroup++) {
        if (inTree.has(toGroup)) continue;
        for (const from of groups[fromGroup].positions) {
          for (const to of groups[toGroup].positions) {
            const d2 = (from.x - to.x) ** 2 + (from.y - to.y) ** 2;
            const key = `${from.x},${from.y}|${to.x},${to.y}`;
            const priorKey = best ? `${best.from.x},${best.from.y}|${best.to.x},${best.to.y}` : "";
            if (!best || d2 < best.d2 || (d2 === best.d2 && key < priorKey)) {
              best = { fromGroup, toGroup, from, to, d2 };
            }
          }
        }
      }
    }
    if (!best) break;
    inTree.add(best.toGroup);
    output.push({ netId, from: best.from, to: best.to });
  }
  return output;
}

function terminalGroupsForNet(
  board: PcbBoard,
  stableNetId: string,
  netId: number,
  endpointKeys: string[],
  pads: ElectricalPhysicalPad[],
): { groups: ElectricalTerminalGroup[]; missing: string[]; coveredPads: Set<string>; legacy: boolean } {
  const byComponent = new Map(board.footprints.map((footprint) => [footprint.id, footprint]));
  const physicalByComponentAndNumber = new Map<string, ElectricalPhysicalPad[]>();
  for (const pad of pads.filter((item) => item.netId === netId)) {
    const key = `${pad.componentId}\0${pad.padNumber}`;
    const bucket = physicalByComponentAndNumber.get(key) ?? [];
    bucket.push(pad);
    physicalByComponentAndNumber.set(key, bucket);
  }
  const candidates: Array<{ endpointKeys: string[]; padIds: string[] }> = [];
  const missing: string[] = [];
  for (const endpointKey of endpointKeys) {
    const mappings = board.footprints.flatMap((footprint) => (footprint.pinPadMappings ?? [])
      .filter((mapping) => mapping.endpointKey === endpointKey)
      .map((mapping) => ({ footprint, mapping })));
    if (mappings.length !== 1) {
      missing.push(endpointKey);
      continue;
    }
    const { footprint, mapping } = mappings[0];
    const physicalIds = mapping.padNumbers.flatMap((padNumber) =>
      physicalByComponentAndNumber.get(`${footprint.id}\0${padNumber}`) ?? [],
    ).map((pad) => pad.id).sort();
    if (physicalIds.length === 0) {
      missing.push(endpointKey);
      continue;
    }
    candidates.push({ endpointKeys: [endpointKey], padIds: [...new Set(physicalIds)] });
  }
  let legacy = false;
  if (endpointKeys.length === 0) {
    legacy = true;
    for (const footprint of board.footprints) {
      if (!byComponent.has(footprint.id)) continue;
      const numbers = [...new Set(Object.entries(footprint.padNets)
        .filter(([, assigned]) => assigned === netId)
        .map(([padNumber]) => padNumber))].sort();
      for (const padNumber of numbers) {
        const physicalIds = (physicalByComponentAndNumber.get(`${footprint.id}\0${padNumber}`) ?? []).map((pad) => pad.id).sort();
        if (physicalIds.length > 0) candidates.push({ endpointKeys: [], padIds: physicalIds });
      }
    }
  }
  const uf = new UnionFind(candidates.length);
  const ownerByPad = new Map<string, number>();
  candidates.forEach((candidate, index) => {
    for (const padId of candidate.padIds) {
      const owner = ownerByPad.get(padId);
      if (owner !== undefined) uf.union(owner, index);
      else ownerByPad.set(padId, index);
    }
  });
  const grouped = new Map<number, { endpointKeys: Set<string>; padIds: Set<string> }>();
  candidates.forEach((candidate, index) => {
    const root = uf.find(index);
    const group = grouped.get(root) ?? { endpointKeys: new Set<string>(), padIds: new Set<string>() };
    candidate.endpointKeys.forEach((key) => group.endpointKeys.add(key));
    candidate.padIds.forEach((id) => group.padIds.add(id));
    grouped.set(root, group);
  });
  const groups = [...grouped.values()].map((group): ElectricalTerminalGroup => {
    const endpoints = [...group.endpointKeys].sort();
    const padIds = [...group.padIds].sort();
    return {
      id: `terminal:${stableNetId}:${stableHash((endpoints.length > 0 ? endpoints : padIds).join("\0"))}`,
      stableNetId,
      netId,
      endpointKeys: endpoints,
      physicalPadInstanceIds: padIds,
      provenance: legacy ? "legacy-pad-assignment" : "stage1-mapping",
    };
  }).sort((a, b) => compareCodePoints(a.id, b.id));
  return { groups, missing: [...new Set(missing)].sort(), coveredPads: new Set(groups.flatMap((group) => group.physicalPadInstanceIds)), legacy };
}

/** One deterministic answer for logical intent, assignment, and native realization. */
export function computeElectricalTruth(board: PcbBoard): ElectricalTruthReport {
  const designRevision = pcbRevisionId(board);
  const diagnostics: EngineeringDiagnostic[] = [];
  const unresolved: ElectricalUnknown[] = [];
  const connectivity = computeConnectivity(board);
  const netById = new Map(board.nets.map((net) => [net.id, net]));
  const stableIdByNumeric = new Map(board.nets.map((net) => [net.id, net.stableId ?? `unresolved-net:${net.id}`]));
  const physicalPads: ElectricalPhysicalPad[] = board.footprints.flatMap((footprint) =>
    physicalPadInstances(footprint).flatMap((physical) => {
      if (physical.pad.type === "np_thru_hole") return [];
      const layers = padCopperLayers(footprint, physical.pad);
      if (layers.length === 0) return [];
      const netId = footprint.padNets[physical.padNumber] ?? 0;
      return [{
        id: physical.id,
        componentId: footprint.id,
        footprintId: footprint.footprintId,
        reference: footprint.ref,
        padNumber: physical.padNumber,
        padIndex: physical.padIndex,
        netId,
        ...(netById.get(netId)?.stableId ? { stableNetId: netById.get(netId)!.stableId } : {}),
        position: padWorldPosition(footprint, physical.pad),
        layers,
      }];
    }),
  ).sort((a, b) => compareCodePoints(a.id, b.id));

  const terminalGroups: ElectricalTerminalGroup[] = [];
  const missingEndpointKeys: string[] = [];
  const unaccountedPadInstanceIds: string[] = [];
  const netBuild = new Map<number, ReturnType<typeof terminalGroupsForNet>>();
  for (const net of [...board.nets].filter((item) => item.id !== 0).sort((a, b) => a.id - b.id)) {
    const stableNetId = net.stableId ?? `unresolved-net:${net.id}`;
    if (!net.stableId) {
      const unknown: ElectricalUnknown = {
        code: "NET_IDENTITY_UNRESOLVED",
        summary: `${net.name || `net${net.id}`} has no persistent stable net identity.`,
        stableNetId,
        objectIds: [],
      };
      unresolved.push(unknown);
      diagnostics.push(engineeringDiagnostic("ELECTRICAL_STATE_UNKNOWN", unknown.summary, {
        severity: "warning", netStableIds: [stableNetId], suggestedActions: ["Load or synchronize the board through the Stage 1 identity migration."],
      }));
    }
    const built = terminalGroupsForNet(board, stableNetId, net.id, [...(net.endpointKeys ?? [])].sort(), physicalPads);
    netBuild.set(net.id, built);
    terminalGroups.push(...built.groups);
    missingEndpointKeys.push(...built.missing);
    if (built.legacy && physicalPads.some((pad) => pad.netId === net.id)) {
      const unknown: ElectricalUnknown = {
        code: "SCHEMATIC_PARITY_UNPROVEN",
        summary: `${net.name || `net${net.id}`} has physical pad assignments but no persisted logical endpoint set.`,
        stableNetId,
        objectIds: built.groups.flatMap((group) => group.physicalPadInstanceIds),
      };
      unresolved.push(unknown);
      diagnostics.push(engineeringDiagnostic("ELECTRICAL_STATE_UNKNOWN", unknown.summary, {
        severity: "info", objectIds: unknown.objectIds, netStableIds: [stableNetId],
      }));
    }
    const assignedPads = physicalPads.filter((pad) => pad.netId === net.id).map((pad) => pad.id);
    if ((net.endpointKeys?.length ?? 0) > 0) {
      unaccountedPadInstanceIds.push(...assignedPads.filter((id) => !built.coveredPads.has(id)));
    }
  }

  if (missingEndpointKeys.length > 0 || unaccountedPadInstanceIds.length > 0) {
    diagnostics.push(engineeringDiagnostic(
      "ELECTRICAL_ASSIGNMENT_INCOMPLETE",
      `Physical assignment is missing ${new Set(missingEndpointKeys).size} logical endpoint(s) and has ${new Set(unaccountedPadInstanceIds).size} unaccounted electrical pad instance(s).`,
      {
        componentIds: [...new Set(missingEndpointKeys.map((key) => decodeURIComponent(key.split("::")[0])))].sort(),
        objectIds: [...new Set(unaccountedPadInstanceIds)].sort(),
        context: { missingEndpointKeys: [...new Set(missingEndpointKeys)].sort() },
        suggestedActions: ["Repair the Stage 1 pin-to-pad mapping and synchronize again."],
      },
    ));
  }

  const unresolvedByNet = new Map<number, ElectricalUnknown[]>();
  const addUnknown = (netId: number, unknown: ElectricalUnknown): void => {
    unresolved.push(unknown);
    const bucket = unresolvedByNet.get(netId) ?? [];
    bucket.push(unknown);
    unresolvedByNet.set(netId, bucket);
    diagnostics.push(engineeringDiagnostic("ELECTRICAL_STATE_UNKNOWN", unknown.summary, {
      severity: "warning", objectIds: unknown.objectIds, netStableIds: unknown.stableNetId ? [unknown.stableNetId] : [],
    }));
  };
  for (const zone of board.zones) {
    if (zoneFillIsCurrent(board, zone) && zone.fill.length > 0) continue;
    addUnknown(zone.netId, {
      code: "ZONE_FILL_UNRESOLVED",
      summary: `Zone ${zone.id} has no current native conductive fill.`,
      stableNetId: stableIdByNumeric.get(zone.netId),
      objectIds: [`zone:${zone.id}`],
    });
  }
  for (const layer of getBoardStackup(board).copperLayers) {
    if (layer.role !== "plane" || layer.planeNetId === undefined) continue;
    const native = board.zones.some((zone) =>
      zone.id === stackupPlaneZoneId(layer.id)
      && zone.source === "stackup-plane"
      && zone.sourceLayerId === layer.id
      && zone.netId === layer.planeNetId
      && zoneFillIsCurrent(board, zone)
      && zone.fill.length > 0,
    );
    if (native) continue;
    addUnknown(layer.planeNetId, {
      code: "NATIVE_PLANE_UNRESOLVED",
      summary: `${layer.name} declares plane intent but has no current native filled zone proving conductivity.`,
      stableNetId: stableIdByNumeric.get(layer.planeNetId),
      objectIds: [`plane:${layer.id}`],
    });
  }
  for (const [left, right] of connectivity.unknownContacts) {
    const objectIds = [copperItemId(left), copperItemId(right)].sort();
    const netIds = [...new Set([refNetId(board, left), refNetId(board, right)])];
    for (const netId of netIds) {
      addUnknown(netId, {
        code: "COPPER_NET_RELATION_UNRESOLVED",
        summary: `Copper contact ${objectIds.join(" / ")} cannot be classified as same-net or different-net from stable identities.`,
        stableNetId: stableIdByNumeric.get(netId),
        objectIds,
      });
    }
  }

  const shorts: ElectricalShortStatus[] = connectivity.shorts.map(([left, right]) => {
    const objectIds = [copperItemId(left), copperItemId(right)].sort() as [string, string];
    const stableNetIds = [...new Set([refNetId(board, left), refNetId(board, right)]
      .map((id) => stableIdByNumeric.get(id))
      .filter((id): id is string => Boolean(id)))].sort();
    return { id: `short:${stableHash(objectIds.join("\0"))}`, objectIds, stableNetIds };
  }).sort((a, b) => compareCodePoints(a.id, b.id));
  for (const short of shorts) diagnostics.push(engineeringDiagnostic(
    "ELECTRICAL_SHORT",
    `Different stable nets physically touch at ${short.objectIds.join(" and ")}.`,
    { objectIds: short.objectIds, netStableIds: short.stableNetIds },
  ));

  const orphanReasons = new Map<string, ElectricalOrphanStatus["reason"]>();
  for (const ref of connectivity.orphans) orphanReasons.set(copperItemId(ref), refNetId(board, ref) === 0 ? "unassigned" : "touches-nothing");
  for (const net of connectivity.nets.values()) {
    const built = netBuild.get(net.netId);
    const terminalPads = built?.coveredPads ?? new Set<string>();
    for (const cluster of net.clusters) {
      if (cluster.some((ref) => ref.kind === "pad" && terminalPads.has(copperItemId(ref)))) continue;
      for (const ref of cluster) if (ref.kind !== "pad") orphanReasons.set(copperItemId(ref), "no-terminal-path");
    }
  }
  const refById = new Map<string, CopperItemRef>();
  for (const net of connectivity.nets.values()) for (const cluster of net.clusters) for (const ref of cluster) refById.set(copperItemId(ref), ref);
  for (const ref of connectivity.orphans) refById.set(copperItemId(ref), ref);
  const orphanCopper: ElectricalOrphanStatus[] = [...orphanReasons].map(([objectId, reason]) => {
    const netId = refById.has(objectId) ? refNetId(board, refById.get(objectId)!) : 0;
    return { objectId, netId, ...(stableIdByNumeric.get(netId) ? { stableNetId: stableIdByNumeric.get(netId) } : {}), reason };
  }).sort((a, b) => compareCodePoints(a.objectId, b.objectId));
  for (const orphan of orphanCopper) diagnostics.push(engineeringDiagnostic(
    "ORPHAN_COPPER",
    `${orphan.objectId} is not part of a proven terminal-to-terminal path.`,
    { severity: "warning", objectIds: [orphan.objectId], netStableIds: orphan.stableNetId ? [orphan.stableNetId] : [], context: { reason: orphan.reason } },
  ));

  const nets: NetElectricalStatus[] = [];
  const authoritativeAirwires: Airwire[] = [];
  let requiredConnections = 0;
  let completedConnections = 0;
  let remainingConnections = 0;
  let routedNets = 0;
  let totalNets = 0;
  for (const net of [...board.nets].filter((item) => item.id !== 0).sort((a, b) => a.id - b.id)) {
    const stableNetId = net.stableId ?? `unresolved-net:${net.id}`;
    const built = netBuild.get(net.id)!;
    const rawClusters = connectivity.nets.get(net.id)?.clusters ?? [];
    const clusterIndexByObject = new Map<string, number>();
    rawClusters.forEach((cluster, index) => cluster.forEach((ref) => clusterIndexByObject.set(copperItemId(ref), index)));
    const clusterUf = new UnionFind(rawClusters.length);
    for (const terminal of built.groups) {
      const indices = [...new Set(terminal.physicalPadInstanceIds
        .map((padId) => clusterIndexByObject.get(padId))
        .filter((index): index is number => index !== undefined))];
      for (let index = 1; index < indices.length; index++) clusterUf.union(indices[0], indices[index]);
    }
    const terminalClusterRoots = new Set<number>();
    for (const terminal of built.groups) {
      const index = terminal.physicalPadInstanceIds
        .map((padId) => clusterIndexByObject.get(padId))
        .find((candidate): candidate is number => candidate !== undefined);
      if (index !== undefined) terminalClusterRoots.add(clusterUf.find(index));
    }
    const effectiveClusters = new Map<number, CopperItemRef[]>();
    rawClusters.forEach((cluster, index) => {
      const root = clusterUf.find(index);
      const bucket = effectiveClusters.get(root) ?? [];
      bucket.push(...cluster);
      effectiveClusters.set(root, bucket);
    });
    const terminalClusters = [...terminalClusterRoots].sort((a, b) => a - b).map((root) => {
      const refs = (effectiveClusters.get(root) ?? []).sort((a, b) => compareCodePoints(copperItemId(a), copperItemId(b)));
      return { refs, positions: refs.flatMap((ref) => refPositions(board, ref)) };
    });
    const required = Math.max(0, built.groups.length - 1);
    const remaining = Math.max(0, terminalClusters.length - 1);
    const completed = Math.max(0, required - remaining);
    const netShorts = shorts.filter((short) => short.stableNetIds.includes(stableNetId));
    const netUnknown = unresolvedByNet.get(net.id) ?? [];
    const assignmentState: ElectricalProofState = built.missing.length > 0 ||
      unaccountedPadInstanceIds.some((id) => physicalPads.find((pad) => pad.id === id)?.netId === net.id)
      ? "failed"
      : built.legacy ? "unknown" : "proven";
    const intentState: ElectricalProofState = (net.endpointKeys?.length ?? 0) > 0 ? "proven" : "unknown";
    const realizationState: ElectricalProofState = netShorts.length > 0
      ? "failed"
      : netUnknown.length > 0
        ? "unknown"
        : remaining > 0
          ? "failed"
          : "proven";
    const state: ElectricalProofState = assignmentState === "failed" || realizationState === "failed"
      ? "failed"
      : assignmentState === "unknown" || intentState === "unknown" || realizationState === "unknown"
        ? "unknown"
        : "proven";
    const wires = clusterAirwires(net.id, terminalClusters);
    authoritativeAirwires.push(...wires);
    if (built.groups.length >= 2) {
      totalNets += 1;
      if (remaining === 0 && netShorts.length === 0 && netUnknown.length === 0) routedNets += 1;
    }
    requiredConnections += required;
    completedConnections += completed;
    remainingConnections += remaining;
    if (remaining > 0 && netUnknown.length === 0) diagnostics.push(engineeringDiagnostic(
      "ELECTRICAL_REALIZATION_INCOMPLETE",
      `${net.name || `net${net.id}`} has ${remaining} remaining terminal-cluster connection${remaining === 1 ? "" : "s"}.`,
      { netStableIds: [stableNetId], context: { requiredConnections: required, completedConnections: completed, remainingConnections: remaining } },
    ));
    nets.push({
      stableNetId,
      netId: net.id,
      name: net.name || `net${net.id}`,
      state,
      intentState,
      assignmentState,
      realizationState,
      endpointKeys: [...(net.endpointKeys ?? [])].sort(),
      terminalGroupIds: built.groups.map((group) => group.id),
      physicalPadInstanceIds: built.groups.flatMap((group) => group.physicalPadInstanceIds).sort(),
      conductiveClusters: terminalClusters.map((cluster) => cluster.refs.map(copperItemId)),
      padContainingClusterCount: terminalClusters.length,
      requiredConnections: required,
      completedConnections: completed,
      remainingConnections: remaining,
      shortIds: netShorts.map((short) => short.id),
      unresolvedCodes: [...new Set(netUnknown.map((item) => item.code))].sort(),
    });
  }

  const uniqueUnresolved = [...new Map(unresolved
    .sort((a, b) => compareCodePoints(a.code, b.code) || compareCodePoints(a.summary, b.summary))
    .map((item) => [`${item.code}\0${item.summary}`, item])).values()];
  const uniqueDiagnostics = [...new Map(diagnostics
    .sort(compareDiagnostics)
    .map((diagnostic) => [`${diagnostic.code}\0${diagnostic.summary}`, diagnostic])).values()];
  const intendedState: ElectricalProofState = nets.some((net) => net.intentState === "unknown") ? "unknown" : "proven";
  const assignedState: ElectricalProofState = nets.some((net) => net.assignmentState === "failed")
    ? "failed"
    : nets.some((net) => net.assignmentState === "unknown") ? "unknown" : "proven";
  const realizedState: ElectricalProofState = shorts.length > 0 || nets.some((net) => net.realizationState === "failed")
    ? "failed"
    : nets.some((net) => net.realizationState === "unknown") ? "unknown" : "proven";
  return {
    schemaVersion: ELECTRICAL_TRUTH_SCHEMA,
    designRevision,
    units: "nm",
    intended: {
      state: intendedState,
      endpointCount: board.nets.reduce((sum, net) => sum + (net.endpointKeys?.length ?? 0), 0),
      netStableIds: nets.map((net) => net.stableNetId).sort(),
    },
    assigned: {
      state: assignedState,
      physicalPads,
      terminalGroups: terminalGroups.sort((a, b) => compareCodePoints(a.id, b.id)),
      missingEndpointKeys: [...new Set(missingEndpointKeys)].sort(),
      unaccountedPadInstanceIds: [...new Set(unaccountedPadInstanceIds)].sort(),
    },
    realized: {
      state: realizedState,
      connectivity,
      requiredConnections,
      completedConnections,
      remainingConnections,
      routedNets,
      totalNets,
      percent: requiredConnections === 0 ? 100 : Math.round((completedConnections / requiredConnections) * 1000) / 10,
      airwires: authoritativeAirwires,
    },
    nets,
    shorts,
    orphanCopper,
    unresolved: uniqueUnresolved,
    diagnostics: uniqueDiagnostics,
  };
}
