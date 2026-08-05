import type { ConstraintProgram } from "@/app/lib/constraints/types";
import { getNetClass } from "../netclass";
import { routableCopperLayers } from "../stackup";
import type { FootprintInstance, Pad, PcbBoard } from "../types";
import type { LayerId } from "../layers";
import { computeElectricalTruth } from "../electrical-truth";
import type { PlacementHyperedge, PlacementTerminalAnchor } from "./types";

const copperLayer = (layer: LayerId): boolean => ["copperTop", "in1", "in2", "copperBottom"].includes(layer);

function averagePadPosition(pads: Pad[]): { x: number; y: number } {
  return {
    x: Math.round(pads.reduce((sum, pad) => sum + pad.at.x, 0) / pads.length),
    y: Math.round(pads.reduce((sum, pad) => sum + pad.at.y, 0) / pads.length),
  };
}

function anchor(input: {
  footprint: FootprintInstance;
  id: string;
  pads: Pad[];
  netId: number;
  netStableId: string;
  source: PlacementTerminalAnchor["source"];
}): PlacementTerminalAnchor {
  return {
    id: input.id,
    componentId: input.footprint.id,
    netId: input.netId,
    netStableId: input.netStableId,
    padNumbers: [...new Set(input.pads.map((pad) => pad.number))].sort(),
    localPosition: averagePadPosition(input.pads),
    accessLayers: [...new Set(input.pads.flatMap((pad) => pad.layers).filter(copperLayer))].sort() as LayerId[],
    source: input.source,
  };
}

/** One logical mapped terminal is one anchor even when it owns several same-number pads. */
export function buildPlacementTerminals(board: PcbBoard): PlacementTerminalAnchor[] {
  const netStableId = new Map(board.nets.map((net) => [net.id, net.stableId ?? `legacy-net:${net.id}`]));
  const terminals: PlacementTerminalAnchor[] = [];
  for (const footprint of [...board.footprints].sort((left, right) => left.id.localeCompare(right.id))) {
    const mappedPadNumbers = new Set<string>();
    for (const mapping of [...(footprint.pinPadMappings ?? [])].sort((left, right) => left.endpointKey.localeCompare(right.endpointKey))) {
      const pads = footprint.def.pads.filter((pad) => mapping.padNumbers.includes(pad.number) && (footprint.padNets[pad.number] ?? 0) !== 0);
      mapping.padNumbers.forEach((number) => mappedPadNumbers.add(number));
      const byNet = new Map<number, Pad[]>();
      for (const pad of pads) {
        const numericNetId = footprint.padNets[pad.number];
        byNet.set(numericNetId, [...(byNet.get(numericNetId) ?? []), pad]);
      }
      for (const [numericNetId, netPads] of [...byNet.entries()].sort(([left], [right]) => left - right)) terminals.push(anchor({
        footprint,
        id: `terminal:${mapping.endpointKey}${byNet.size > 1 ? `:net:${numericNetId}` : ""}`,
        pads: netPads,
        netId: numericNetId,
        netStableId: netStableId.get(numericNetId) ?? `legacy-net:${numericNetId}`,
        source: "pin-pad-mapping",
      }));
    }
    const byPadNumber = new Map<string, Pad[]>();
    for (const pad of footprint.def.pads) {
      const numericNetId = footprint.padNets[pad.number] ?? 0;
      if (numericNetId === 0 || mappedPadNumbers.has(pad.number)) continue;
      byPadNumber.set(pad.number, [...(byPadNumber.get(pad.number) ?? []), pad]);
    }
    for (const [padNumber, pads] of [...byPadNumber.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const numericNetId = footprint.padNets[padNumber];
      terminals.push(anchor({
        footprint,
        id: `pad-group:${footprint.id}:${padNumber || "unnumbered"}`,
        pads,
        netId: numericNetId,
        netStableId: netStableId.get(numericNetId) ?? `legacy-net:${numericNetId}`,
        source: "pad-number-group",
      }));
    }
  }
  return terminals.sort((left, right) => left.id.localeCompare(right.id));
}

function normalizedLayer(value: string): LayerId | undefined {
  const id = value.replace(/^layer:/, "") as LayerId;
  return copperLayer(id) ? id : undefined;
}

function hasCurrentPlane(board: PcbBoard, netId: number): boolean {
  return board.zones.some((zone) => zone.netId === netId && zone.fillState?.status === "current" && zone.fill.length > 0);
}

/**
 * Builds O(terminals + nets) hyperedges. High-fanout nets remain one edge and
 * are decomposed to a star by consumers; no k(k-1)/2 pair graph is created.
 */
export function buildPlacementHypergraph(input: {
  board: PcbBoard;
  program: ConstraintProgram;
  terminals?: PlacementTerminalAnchor[];
}): { terminals: PlacementTerminalAnchor[]; hyperedges: PlacementHyperedge[] } {
  const terminals = input.terminals ?? buildPlacementTerminals(input.board);
  const byNet = new Map<number, PlacementTerminalAnchor[]>();
  for (const terminal of terminals) byNet.set(terminal.netId, [...(byNet.get(terminal.netId) ?? []), terminal]);
  const signalLayers = routableCopperLayers(input.board).map((layer) => layer.id);
  const electrical = computeElectricalTruth(input.board);
  const hyperedges: PlacementHyperedge[] = [];
  for (const [numericNetId, members] of [...byNet.entries()].sort(([left], [right]) => left - right)) {
    const net = input.board.nets.find((candidate) => candidate.id === numericNetId);
    if (!net) continue;
    const stableId = net.stableId ?? `legacy-net:${numericNetId}`;
    const physical = input.program.lowerings.physicalByTarget[stableId];
    const allowed = physical?.allowedLayerIds?.map(normalizedLayer).filter((layer): layer is LayerId => Boolean(layer));
    const forbidden = new Set(physical?.forbiddenLayerIds?.map(normalizedLayer).filter((layer): layer is LayerId => Boolean(layer)) ?? []);
    const allowedLayers = (allowed && allowed.length > 0 ? allowed : signalLayers).filter((layer) => !forbidden.has(layer)).sort();
    const preferredLayers = (physical?.preferredLayerIds ?? []).map(normalizedLayer).filter((layer): layer is LayerId => layer !== undefined).filter((layer) => allowedLayers.includes(layer)).sort();
    const netClass = getNetClass(input.board, numericNetId);
    const plane = hasCurrentPlane(input.board, numericNetId);
    const electricalNet = electrical.nets.find((candidate) => candidate.stableNetId === stableId);
    const componentIds = [...new Set(members.map((member) => member.componentId))].sort();
    if (!plane && componentIds.length < 2) continue;
    hyperedges.push({
      id: `hyperedge:${stableId}`,
      kind: plane ? "plane_access" : "signal",
      netId: numericNetId,
      netStableId: stableId,
      memberTerminalIds: members.map((member) => member.id).sort(),
      memberComponentIds: componentIds,
      weight: 1,
      minTrackWidthNm: physical?.minTrackWidthNm ?? netClass.trackWidth,
      clearanceNm: physical?.clearanceNm ?? netClass.clearance,
      allowedLayerIds: allowedLayers,
      preferredLayerIds: preferredLayers,
      constraintIds: [...new Set(physical?.constraintIds ?? [])].sort(),
      decomposition: plane ? "plane_access" : componentIds.length === 2 ? "two_pin" : "star",
      electricalState: electricalNet?.realizationState ?? "unknown",
      remainingConnections: electricalNet?.remainingConnections ?? Math.max(0, componentIds.length - 1),
    });
  }
  return { terminals, hyperedges: hyperedges.sort((left, right) => left.id.localeCompare(right.id)) };
}
