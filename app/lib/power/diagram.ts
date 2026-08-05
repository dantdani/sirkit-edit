import { powerDigest } from "./stable";
import type { PowerArchitectureCandidate } from "./types";

export interface PowerDiagram { nodes: Array<{ id: string; kind: "source" | "transfer" | "rail" | "demand" | "return" | "protection"; label: string }>; edges: Array<{ from: string; to: string; kind: string }>; deterministicDigest: string; }

export function buildPowerDiagram(candidate: PowerArchitectureCandidate): PowerDiagram {
  const nodes: PowerDiagram["nodes"] = [
    ...candidate.sources.map((item) => ({ id: item.sourceId, kind: "source" as const, label: item.externalOwnerRole ?? item.sourceKind })),
    ...candidate.transferEdges.map((item) => ({ id: item.edgeId, kind: "transfer" as const, label: item.topologyClass })),
    ...candidate.rails.map((item) => ({ id: item.railId, kind: "rail" as const, label: item.semanticRole })),
    ...candidate.demands.map((item) => ({ id: item.demandId, kind: "demand" as const, label: item.abstractPinGroupRole })),
    ...candidate.groundReturnDomains.map((item) => ({ id: item.domainId, kind: "return" as const, label: item.semanticRole })),
    ...candidate.protectionPolicies.map((item) => ({ id: item.policyId, kind: "protection" as const, label: item.abstractActionRoles.join(" + ") })),
  ].sort((a, b) => a.id.localeCompare(b.id));
  const rawEdges: PowerDiagram["edges"] = [
    ...candidate.transferEdges.flatMap((item) => [{ from: item.sourceRailOrEnvelopeId, to: item.edgeId, kind: "feeds" }, { from: item.edgeId, to: item.destinationRailId, kind: "creates" }]),
    ...candidate.returnPathIntents.flatMap((item) => [{ from: item.railOrFlowId, to: item.producerOrLoadId, kind: "powers" }, { from: item.producerOrLoadId, to: item.destinationReferenceId, kind: `returns:${item.currentClass}` }]),
    ...candidate.protectionPolicies.flatMap((policy) => policy.protectedAssetIds.map((asset) => ({ from: policy.policyId, to: asset, kind: "protects" }))),
  ];
  const edges = [...new Map(rawEdges.map((edge) => [`${edge.from}|${edge.to}|${edge.kind}`, edge])).values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind));
  const base = { nodes, edges }; return { ...base, deterministicDigest: powerDigest(base) };
}
