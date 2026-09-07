import type { PcbBoard, PcbNet } from "./types";
import {
  canonicalEndpointSet,
  compareDiagnostics,
  engineeringDiagnostic,
  stableNetIdForEndpoints,
  type EngineeringDiagnostic,
} from "./integrity";
import { compareCodePoints } from "@/app/lib/stable-compare";

export interface LogicalNetCandidate {
  id: number;
  name: string;
  endpointKeys: string[];
}

export interface NetReconciliationResult {
  ok: boolean;
  nets: PcbNet[];
  /** Previous numeric ID → candidate numeric ID; net 0 always maps to 0. */
  oldToNewId: Map<number, number>;
  diagnostics: EngineeringDiagnostic[];
  changes: Array<{
    kind: "preserved" | "renamed" | "grown" | "shrunk" | "new" | "retired" | "split" | "merge";
    stableId?: string;
    oldNetIds: number[];
    newNetIds: number[];
  }>;
}

interface PhysicalOwnership {
  objectIds: string[];
  tracks: string[];
  vias: string[];
  zones: string[];
  planes: string[];
  routingEvents: string[];
}

function physicalOwnershipIndex(board: PcbBoard): Map<number, PhysicalOwnership> {
  const index = new Map<number, PhysicalOwnership>();
  const ensure = (netId: number): PhysicalOwnership => {
    const existing = index.get(netId);
    if (existing) return existing;
    const created: PhysicalOwnership = {
      objectIds: [], tracks: [], vias: [], zones: [], planes: [], routingEvents: [],
    };
    index.set(netId, created);
    return created;
  };
  for (const track of board.tracks) ensure(track.netId).tracks.push(track.id);
  for (const via of board.vias) ensure(via.netId).vias.push(via.id);
  for (const zone of board.zones) ensure(zone.netId).zones.push(zone.id);
  for (const layer of board.stackupConfig?.copperLayers ?? []) {
    if (layer.planeNetId !== undefined) ensure(layer.planeNetId).planes.push(layer.id);
  }
  for (const event of board.routingHistory ?? []) ensure(event.netId).routingEvents.push(event.id);
  for (const ownership of index.values()) {
    ownership.tracks.sort();
    ownership.vias.sort();
    ownership.zones.sort();
    ownership.planes.sort();
    ownership.routingEvents.sort();
    ownership.objectIds = [
      ...ownership.tracks.map((id) => `track:${id}`),
      ...ownership.vias.map((id) => `via:${id}`),
      ...ownership.zones.map((id) => `zone:${id}`),
      ...ownership.planes.map((id) => `plane:${id}`),
      ...ownership.routingEvents.map((id) => `routing-event:${id}`),
    ];
  }
  return index;
}

const EMPTY_OWNERSHIP: PhysicalOwnership = {
  objectIds: [], tracks: [], vias: [], zones: [], planes: [], routingEvents: [],
};

function sameEndpoints(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}

function netContext(net: PcbNet): Record<string, unknown> {
  return {
    numericId: net.id,
    stableId: net.stableId,
    name: net.name,
    endpointKeys: net.endpointKeys ?? [],
  };
}

/**
 * Endpoint-set reconciliation. Names and numeric IDs never prove identity.
 * Ambiguous routed split/merge/delete operations are rejected before a board
 * candidate is assembled.
 */
export function reconcileBoardNets(
  board: PcbBoard,
  logicalNets: readonly LogicalNetCandidate[],
): NetReconciliationResult {
  const diagnostics: EngineeringDiagnostic[] = [];
  const changes: NetReconciliationResult["changes"] = [];
  const oldNets = board.nets
    .filter((net) => net.id !== 0)
    .map((net) => ({ ...net, endpointKeys: canonicalEndpointSet(net.endpointKeys ?? []) }))
    .sort((a, b) => a.id - b.id);
  const newNets = logicalNets
    .map((net) => ({ ...net, endpointKeys: canonicalEndpointSet(net.endpointKeys) }))
    .sort((a, b) => a.id - b.id);

  const oldNumericIds = new Map<number, number>();
  const oldStableIds = new Map<string, number[]>();
  const oldEndpointOwners = new Map<string, number[]>();
  for (const net of oldNets) {
    oldNumericIds.set(net.id, (oldNumericIds.get(net.id) ?? 0) + 1);
    if (net.stableId) {
      const owners = oldStableIds.get(net.stableId) ?? [];
      owners.push(net.id);
      oldStableIds.set(net.stableId, owners);
    }
    for (const endpointKey of net.endpointKeys) {
      const owners = oldEndpointOwners.get(endpointKey) ?? [];
      owners.push(net.id);
      oldEndpointOwners.set(endpointKey, owners);
    }
  }
  for (const [netId, count] of oldNumericIds) {
    if (count > 1) diagnostics.push(engineeringDiagnostic(
      "DUPLICATE_NUMERIC_NET_ID",
      `Current board contains ${count} nets with numeric ID ${netId}.`,
      { context: { netId, count } },
    ));
  }
  for (const [stableId, owners] of oldStableIds) {
    if (owners.length < 2) continue;
    diagnostics.push(engineeringDiagnostic(
      "DUPLICATE_STABLE_NET_ID",
      `Current board stable net identity '${stableId}' is not unique.`,
      { netStableIds: [stableId], context: { netIds: [...owners].sort((a, b) => a - b) } },
    ));
  }
  for (const [endpointKey, owners] of oldEndpointOwners) {
    if (new Set(owners).size < 2) continue;
    diagnostics.push(engineeringDiagnostic(
      "PCB_ENDPOINT_IDENTITY_COLLISION",
      `Current board endpoint ${endpointKey} is assigned to more than one stable net.`,
      { context: { endpointKey, netIds: [...new Set(owners)].sort((a, b) => a - b) } },
    ));
  }

  const logicalIds = new Map<number, number>();
  const endpointOwners = new Map<string, number[]>();
  for (const net of newNets) {
    if (net.id <= 0 || !Number.isSafeInteger(net.id)) {
      diagnostics.push(engineeringDiagnostic(
        "INVALID_DERIVED_NET_ID",
        `Candidate schematic net '${net.name}' has invalid derived numeric ID ${net.id}.`,
        { context: { netId: net.id, name: net.name } },
      ));
    }
    logicalIds.set(net.id, (logicalIds.get(net.id) ?? 0) + 1);
    for (const endpointKey of net.endpointKeys) {
      const owners = endpointOwners.get(endpointKey) ?? [];
      owners.push(net.id);
      endpointOwners.set(endpointKey, owners);
    }
  }
  for (const [netId, count] of logicalIds) {
    if (count > 1) diagnostics.push(engineeringDiagnostic(
      "DUPLICATE_NUMERIC_NET_ID",
      `Candidate schematic netlist contains ${count} nets with numeric ID ${netId}.`,
      { context: { netId, count } },
    ));
  }
  for (const [endpointKey, owners] of endpointOwners) {
    if (new Set(owners).size < 2) continue;
    diagnostics.push(engineeringDiagnostic(
      "SCHEMATIC_ENDPOINT_IDENTITY_COLLISION",
      `Schematic endpoint ${endpointKey} appears in more than one logical net.`,
      { context: { endpointKey, netIds: [...new Set(owners)].sort((a, b) => a - b) } },
    ));
  }
  if (diagnostics.length > 0) {
    diagnostics.sort(compareDiagnostics);
    return { ok: false, nets: board.nets, oldToNewId: new Map([[0, 0]]), diagnostics, changes };
  }

  const oldById = new Map(oldNets.map((net) => [net.id, net]));
  const newById = new Map(newNets.map((net) => [net.id, net]));
  const oldNeighbors = new Map<number, Array<{ netId: number; overlap: number }>>();
  const newNeighbors = new Map<number, Array<{ netId: number; overlap: number }>>();
  const overlaps = new Map<number, Map<number, number>>();
  for (const newNet of newNets) {
    for (const endpointKey of newNet.endpointKeys) {
      for (const oldNetId of oldEndpointOwners.get(endpointKey) ?? []) {
        const byNew = overlaps.get(oldNetId) ?? new Map<number, number>();
        byNew.set(newNet.id, (byNew.get(newNet.id) ?? 0) + 1);
        overlaps.set(oldNetId, byNew);
      }
    }
  }
  for (const [oldNetId, byNew] of overlaps) {
    for (const [newNetId, overlap] of byNew) {
      const oldBucket = oldNeighbors.get(oldNetId) ?? [];
      oldBucket.push({ netId: newNetId, overlap });
      oldNeighbors.set(oldNetId, oldBucket);
      const newBucket = newNeighbors.get(newNetId) ?? [];
      newBucket.push({ netId: oldNetId, overlap });
      newNeighbors.set(newNetId, newBucket);
    }
  }

  const ownershipByNet = physicalOwnershipIndex(board);

  for (const oldNet of oldNets) {
    const ownership = ownershipByNet.get(oldNet.id) ?? EMPTY_OWNERSHIP;
    if ((oldNet.endpointKeys?.length ?? 0) === 0 && ownership.objectIds.length > 0) {
      diagnostics.push(engineeringDiagnostic(
        "UNRESOLVED_LEGACY_NET_IDENTITY",
        `Routed legacy net '${oldNet.name || oldNet.id}' has no endpoint identity and cannot be reconciled safely.`,
        {
          objectIds: ownership.objectIds,
          netStableIds: oldNet.stableId ? [oldNet.stableId] : [],
          context: { oldNet: netContext(oldNet), ownership },
          suggestedActions: ["Restore schematic endpoint metadata or explicitly resolve this legacy net before synchronization."],
        },
      ));
      continue;
    }
    const neighbors = oldNeighbors.get(oldNet.id) ?? [];
    if (neighbors.length === 0 && ownership.objectIds.length > 0) {
      diagnostics.push(engineeringDiagnostic(
        "ROUTED_NET_DELETION_CONFLICT",
        `Schematic sync would delete routed net '${oldNet.name || oldNet.id}'.`,
        {
          objectIds: ownership.objectIds,
          netStableIds: oldNet.stableId ? [oldNet.stableId] : [],
          context: { conflictType: "deletion", oldNet: netContext(oldNet), ownership },
          suggestedActions: ["Rip up or explicitly retire the protected physical data before deleting this net."],
        },
      ));
    }
    if (neighbors.length > 1 && ownership.objectIds.length > 0) {
      diagnostics.push(engineeringDiagnostic(
        "ROUTED_NET_SPLIT_CONFLICT",
        `Schematic sync would split routed net '${oldNet.name || oldNet.id}' across multiple new nets.`,
        {
          objectIds: ownership.objectIds,
          netStableIds: oldNet.stableId ? [oldNet.stableId] : [],
          context: {
            conflictType: "split",
            oldNet: netContext(oldNet),
            newNets: neighbors.map((neighbor) => newById.get(neighbor.netId)),
            ownership,
          },
          suggestedActions: ["Resolve or remove the old copper before separating these schematic endpoints."],
        },
      ));
    }
  }

  for (const newNet of newNets) {
    const neighbors = newNeighbors.get(newNet.id) ?? [];
    if (neighbors.length < 2) continue;
    const routedOwners = neighbors
      .map((neighbor) => oldById.get(neighbor.netId)!)
      .map((oldNet) => ({ oldNet, ownership: ownershipByNet.get(oldNet.id) ?? EMPTY_OWNERSHIP }))
      .filter(({ ownership }) => ownership.objectIds.length > 0);
    if (routedOwners.length === 0) continue;
    diagnostics.push(engineeringDiagnostic(
      "ROUTED_NET_MERGE_CONFLICT",
      `Schematic sync would merge multiple existing nets into '${newNet.name || newNet.id}' while physical data exists.`,
      {
        objectIds: routedOwners.flatMap(({ ownership }) => ownership.objectIds).sort(),
        netStableIds: routedOwners.map(({ oldNet }) => oldNet.stableId).filter((id): id is string => Boolean(id)).sort(),
        context: {
          conflictType: "merge",
          oldNets: routedOwners.map(({ oldNet }) => netContext(oldNet)),
          newNet,
          ownership: routedOwners.map(({ oldNet, ownership }) => ({ oldNetId: oldNet.id, ownership })),
        },
        suggestedActions: ["Explicitly review the old copper and remove or approve its electrical merge before synchronization."],
      },
    ));
  }

  diagnostics.sort(compareDiagnostics);
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { ok: false, nets: board.nets, oldToNewId: new Map([[0, 0]]), diagnostics, changes };
  }

  // Each old net selects at most one descendant. Physical nets are guaranteed
  // above to have exactly one, while unrouted ambiguous topology is resolved
  // deterministically without risking user geometry.
  const chosenNewByOld = new Map<number, number>();
  for (const oldNet of oldNets) {
    const neighbors = [...(oldNeighbors.get(oldNet.id) ?? [])].sort((a, b) => {
      if (a.overlap !== b.overlap) return b.overlap - a.overlap;
      const an = newById.get(a.netId)!;
      const bn = newById.get(b.netId)!;
      return compareCodePoints(an.endpointKeys.join("\0"), bn.endpointKeys.join("\0"))
        || compareCodePoints(an.name, bn.name)
        || an.id - bn.id;
    });
    if (neighbors[0]) chosenNewByOld.set(oldNet.id, neighbors[0].netId);
  }

  const oldToNewId = new Map<number, number>([[0, 0]]);
  for (const [oldId, newId] of chosenNewByOld) oldToNewId.set(oldId, newId);
  const oldChosenByNew = new Map<number, PcbNet[]>();
  for (const [oldId, newId] of chosenNewByOld) {
    const bucket = oldChosenByNew.get(newId) ?? [];
    bucket.push(oldById.get(oldId)!);
    oldChosenByNew.set(newId, bucket);
  }

  const usedStableIds = new Set<string>(["net:unconnected"]);
  const reconciledNets: PcbNet[] = [{ id: 0, name: "", stableId: "net:unconnected", endpointKeys: [] }];
  for (const newNet of newNets) {
    const chosenOld = [...(oldChosenByNew.get(newNet.id) ?? [])]
      .sort((a, b) => compareCodePoints(a.stableId ?? "", b.stableId ?? "") || a.id - b.id);
    let stableId = chosenOld[0]?.stableId ?? stableNetIdForEndpoints(newNet.endpointKeys, newNet.name);
    if (usedStableIds.has(stableId)) {
      let suffix = 2;
      const base = stableId;
      while (usedStableIds.has(`${base}:${suffix}`)) suffix++;
      stableId = `${base}:${suffix}`;
    }
    usedStableIds.add(stableId);
    reconciledNets.push({ id: newNet.id, name: newNet.name, stableId, endpointKeys: newNet.endpointKeys });

    const allOverlappingOld = (newNeighbors.get(newNet.id) ?? []).map((neighbor) => oldById.get(neighbor.netId)!);
    if (allOverlappingOld.length === 0) {
      changes.push({ kind: "new", stableId, oldNetIds: [], newNetIds: [newNet.id] });
    } else if (allOverlappingOld.length > 1) {
      changes.push({ kind: "merge", stableId, oldNetIds: allOverlappingOld.map((net) => net.id).sort((a, b) => a - b), newNetIds: [newNet.id] });
    } else {
      const oldNet = allOverlappingOld[0];
      const oldEndpoints = oldNet.endpointKeys ?? [];
      const kind = sameEndpoints(oldEndpoints, newNet.endpointKeys)
        ? (oldNet.name === newNet.name ? "preserved" : "renamed")
        : oldEndpoints.every((endpoint) => newNet.endpointKeys.includes(endpoint))
          ? "grown"
          : "shrunk";
      changes.push({ kind, stableId, oldNetIds: [oldNet.id], newNetIds: [newNet.id] });
    }
  }
  for (const oldNet of oldNets) {
    const neighbors = oldNeighbors.get(oldNet.id) ?? [];
    if (neighbors.length === 0) {
      changes.push({ kind: "retired", stableId: oldNet.stableId, oldNetIds: [oldNet.id], newNetIds: [] });
    } else if (neighbors.length > 1) {
      changes.push({ kind: "split", stableId: oldNet.stableId, oldNetIds: [oldNet.id], newNetIds: neighbors.map((neighbor) => neighbor.netId).sort((a, b) => a - b) });
    }
  }

  return {
    ok: true,
    nets: reconciledNets.sort((a, b) => a.id - b.id),
    oldToNewId,
    diagnostics: [],
    changes,
  };
}

export function remapNumericNetId(mapping: ReadonlyMap<number, number>, netId: number): number {
  if (netId === 0) return 0;
  return mapping.get(netId) ?? 0;
}
