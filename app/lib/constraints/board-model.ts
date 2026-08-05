import type { PcbBoard } from "@/app/lib/pcb/types";
import { getBoardStackup } from "@/app/lib/pcb/stackup";
import type { ConstraintTarget } from "./types";
import { constraintSemanticHash } from "./stable";

function classId(board: PcbBoard, netId: number): string {
  return board.netClassing?.base?.[netId]?.classId ?? board.netClassing?.assignments[netId]?.classId ?? "Default";
}

export function boardConstraintTargets(board: PcbBoard, projectId: string): ConstraintTarget[] {
  const projectTarget = `project:${projectId}`;
  const boardTarget = `board:${projectId}`;
  const targets: ConstraintTarget[] = [
    { id: projectTarget, type: "project", revision: "1", name: projectId, parentIds: [], tags: [], attributes: {} },
    { id: boardTarget, type: "board", revision: "1", name: "PCB", parentIds: [projectTarget], tags: [], attributes: { stackup: String(board.stackup) } },
  ];
  for (const id of ["Default", "Power", "HighCurrent"] as const) targets.push({ id: `net-class:${id}`, type: "net_class", revision: "1", name: id, parentIds: [projectTarget], tags: [], attributes: {} });
  for (const net of board.nets.filter((item) => item.id !== 0).sort((a, b) => (a.stableId ?? "").localeCompare(b.stableId ?? "") || a.id - b.id)) {
    const stableId = net.stableId ?? `legacy-net:${net.id}`;
    const assignedClass = classId(board, net.id);
    targets.push({
      id: stableId,
      type: "net",
      revision: constraintSemanticHash({ stableId, endpointKeys: [...(net.endpointKeys ?? [])].sort() }),
      name: net.name,
      parentIds: [projectTarget, boardTarget, `net-class:${assignedClass}`],
      tags: [],
      attributes: { numericNetId: String(net.id), classId: assignedClass },
    });
  }
  for (const layer of getBoardStackup(board).copperLayers.filter((item) => item.enabled).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))) {
    targets.push({
      id: `layer:${layer.id}`,
      type: "layer",
      revision: constraintSemanticHash(layer),
      name: layer.name,
      parentIds: [projectTarget, boardTarget],
      tags: [layer.role, layer.autorouteEnabled ? "autoroute-enabled" : "autoroute-disabled"],
      attributes: { role: layer.role, preferredDirection: layer.preferredDirection, autorouteEnabled: layer.autorouteEnabled },
    });
  }
  for (const footprint of [...board.footprints].sort((a, b) => a.id.localeCompare(b.id))) {
    const componentId = `component:${footprint.id}`;
    targets.push({
      id: componentId,
      type: "component",
      revision: constraintSemanticHash({ id: footprint.id, footprintId: footprint.footprintId, pinPadMappings: footprint.pinPadMappings }),
      name: footprint.ref,
      parentIds: [projectTarget, boardTarget],
      tags: footprint.placementConstraints?.criticalRole ? [footprint.placementConstraints.criticalRole] : [],
      attributes: { side: footprint.side, footprintId: footprint.footprintId, locked: footprint.locked === true },
    });
    targets.push({ ...targets[targets.length - 1], id: `footprint:${footprint.id}`, type: "footprint", parentIds: [projectTarget, boardTarget, componentId] });
    footprint.def.pads.forEach((pad, index) => targets.push({
      id: `pad:${footprint.id}:${pad.number || "mechanical"}:${index}`,
      type: "pad",
      revision: constraintSemanticHash(pad),
      name: pad.number,
      parentIds: [componentId, `footprint:${footprint.id}`],
      tags: pad.type === "np_thru_hole" ? ["mechanical"] : ["electrical"],
      attributes: { padNumber: pad.number, padType: pad.type },
    }));
    for (const mapping of footprint.pinPadMappings ?? []) targets.push({
      id: `terminal:${mapping.endpointKey}`,
      type: "terminal",
      revision: constraintSemanticHash(mapping),
      name: mapping.symbolPinNumber,
      parentIds: [componentId],
      tags: [mapping.mappingKind],
      attributes: { endpointKey: mapping.endpointKey, symbolPinNumber: mapping.symbolPinNumber },
    });
  }
  board.tracks.forEach((track) => targets.push({ id: `track:${track.id}`, type: "track", revision: constraintSemanticHash(track), parentIds: [boardTarget, board.nets.find((net) => net.id === track.netId)?.stableId ?? "net:unassigned"], tags: [], attributes: { layer: track.layer } }));
  board.vias.forEach((via) => targets.push({ id: `via:${via.id}`, type: "via", revision: constraintSemanticHash(via), parentIds: [boardTarget, board.nets.find((net) => net.id === via.netId)?.stableId ?? "net:unassigned"], tags: [], attributes: { layers: [...via.layers] } }));
  board.zones.forEach((zone) => targets.push({ id: `zone:${zone.id}`, type: "zone", revision: constraintSemanticHash({ ...zone, fill: undefined, fillState: undefined, dirty: undefined }), parentIds: [boardTarget, board.nets.find((net) => net.id === zone.netId)?.stableId ?? "net:unassigned", `layer:${zone.layer}`], tags: [zone.source ?? "user"], attributes: { layer: zone.layer, connection: zone.connection } }));
  for (const keepout of board.routingKeepouts ?? []) targets.push({ id: `keepout:${keepout.id}`, type: "keepout", revision: constraintSemanticHash(keepout), name: keepout.name, parentIds: [boardTarget], tags: [], attributes: { layers: keepout.layers } });
  return targets.sort((a, b) => a.id.localeCompare(b.id));
}

/** Revision of the hierarchy/identity facts used for selector resolution, not routed geometry. */
export function boardConstraintTargetRevision(board: PcbBoard, projectId: string): string {
  return constraintSemanticHash(boardConstraintTargets(board, projectId).map((target) => ({ id: target.id, type: target.type, revision: target.revision, parentIds: target.parentIds, tags: target.tags, attributes: target.attributes })));
}
