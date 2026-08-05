import type { SystemArchitectureCandidate } from "./types";

export interface ArchitectureDiagramNode { id: string; label: string; role: string; x: number; y: number; width: number; height: number; parentId: string | null; }
export interface ArchitectureDiagramEdge { id: string; label: string; kind: string; fromNodeId: string; toNodeIds: string[]; }
export interface ArchitectureDiagram { candidateId: string; nodes: ArchitectureDiagramNode[]; edges: ArchitectureDiagramEdge[]; }

/** Diagram coordinates are a deterministic view and are never persisted as engineering meaning. */
export function buildArchitectureDiagram(candidate: SystemArchitectureCandidate): ArchitectureDiagram {
  const children = new Map<string | null, SystemArchitectureCandidate["blocks"]>();
  for (const block of candidate.blocks) children.set(block.parentBlockId, [...(children.get(block.parentBlockId) ?? []), block].sort((a, b) => a.blockId.localeCompare(b.blockId)));
  const depth = new Map<string, number>(); const root = candidate.blocks.find((item) => item.parentBlockId === null);
  if (root) { depth.set(root.blockId, 0); const queue = [root.blockId]; while (queue.length) { const parent = queue.shift()!; for (const child of children.get(parent) ?? []) { depth.set(child.blockId, (depth.get(parent) ?? 0) + 1); queue.push(child.blockId); } } }
  const rows = new Map<number, string[]>(); for (const block of candidate.blocks) { const level = depth.get(block.blockId) ?? 0; rows.set(level, [...(rows.get(level) ?? []), block.blockId].sort()); }
  const nodes = candidate.blocks.map((block) => { const level = depth.get(block.blockId) ?? 0; const row = rows.get(level) ?? []; const index = row.indexOf(block.blockId); return { id: block.blockId, label: block.label, role: block.role, x: 80 + index * 280, y: 60 + level * 180, width: 220, height: 96, parentId: block.parentBlockId }; }).sort((a, b) => a.id.localeCompare(b.id));
  const portBlock = new Map(candidate.ports.map((item) => [item.portId, item.blockId]));
  const edges = candidate.flows.map((flow) => ({ id: flow.flowId, label: flow.label, kind: flow.flowKind, fromNodeId: portBlock.get(flow.producerPortId)!, toNodeIds: [...new Set(flow.consumerPortIds.map((id) => portBlock.get(id)!).filter(Boolean))].sort() })).sort((a, b) => a.id.localeCompare(b.id));
  return { candidateId: candidate.candidateId, nodes, edges };
}
