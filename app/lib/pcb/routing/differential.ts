import { segmentDistance } from "../geometry-copper";
import { getNetClass } from "../netclass";
import type { Track, Via } from "../types";
import { defaultViaTransition } from "./layers";
import { routingStableId } from "./stable";
import type { RouteAnchor, RoutingSnapshot } from "./types";

export interface DifferentialPairDefinition {
  pairId: string;
  positiveNetId: number;
  negativeNetId: number;
  positiveStableNetId: string;
  negativeStableNetId: string;
  constraintIds: string[];
  evidenceIds: string[];
  state: "resolved" | "conflicting" | "unresolved";
  explanation: string;
}

export function resolveDifferentialPair(snapshot: RoutingSnapshot, pairId: string): DifferentialPairDefinition {
  const relationship = snapshot.board.constraintState?.documents.flatMap((document) => document.relationships).find((item) => item.id === pairId && item.kind === "differential_pair" && item.lifecycle === "active");
  const active = snapshot.constraintProgram?.relationshipIds.includes(pairId) ?? false;
  if (!relationship || !active) return { pairId, positiveNetId: 0, negativeNetId: 0, positiveStableNetId: "", negativeStableNetId: "", constraintIds: [], evidenceIds: [], state: "unresolved", explanation: "No active typed Stage 6 differential-pair relationship exists; names are non-authoritative." };
  const ordered = [...relationship.members].sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || a.role.localeCompare(b.role));
  const positive = ordered.find((member) => ["positive", "p", "+"].includes(member.role.toLowerCase())) ?? ordered[0];
  const negative = ordered.find((member) => ["negative", "n", "-"].includes(member.role.toLowerCase())) ?? ordered[1];
  const p = snapshot.board.nets.find((net) => net.stableId === positive?.targetId || `net:${net.stableId}` === positive?.targetId);
  const n = snapshot.board.nets.find((net) => net.stableId === negative?.targetId || `net:${net.stableId}` === negative?.targetId);
  const conflicting = !p || !n || p.id === n.id || ordered.length !== 2;
  return { pairId, positiveNetId: p?.id ?? 0, negativeNetId: n?.id ?? 0, positiveStableNetId: p?.stableId ?? positive?.targetId ?? "", negativeStableNetId: n?.stableId ?? negative?.targetId ?? "", constraintIds: snapshot.constraintProgram?.lowerings.routingGraph.find((item) => item.relationshipId === pairId)?.constraintIds ?? [], evidenceIds: [...relationship.evidenceIds].sort(), state: conflicting ? "conflicting" : "resolved", explanation: conflicting ? "Differential-pair members are missing, duplicated, or not exactly two." : `Polarity is pinned by ${relationship.id}; naming heuristics were not used.` };
}

export interface CoupledPairResult {
  status: "legal" | "infeasible" | "unsupported";
  positiveTracks: Track[];
  negativeTracks: Track[];
  measuredGapNm: number | null;
  polarityPreserved: boolean;
  explanation: string;
}

/** Exact straight coupled pair. Cornered pair search remains explicitly unsupported. */
export function buildStraightDifferentialPair(input: { snapshot: RoutingSnapshot; definition: DifferentialPairDefinition; positiveStart: RouteAnchor; positiveEnd: RouteAnchor; negativeStart: RouteAnchor; negativeEnd: RouteAnchor; targetGapNm: number }): CoupledPairResult {
  if (input.definition.state !== "resolved") return { status: "unsupported", positiveTracks: [], negativeTracks: [], measuredGapNm: null, polarityPreserved: false, explanation: input.definition.explanation };
  if (input.positiveStart.netId !== input.definition.positiveNetId || input.positiveEnd.netId !== input.definition.positiveNetId || input.negativeStart.netId !== input.definition.negativeNetId || input.negativeEnd.netId !== input.definition.negativeNetId) return { status: "infeasible", positiveTracks: [], negativeTracks: [], measuredGapNm: null, polarityPreserved: false, explanation: "Pair endpoints do not preserve the typed positive/negative polarity." };
  const layer = input.positiveStart.layers.find((candidate) => input.positiveEnd.layers.includes(candidate) && input.negativeStart.layers.includes(candidate) && input.negativeEnd.layers.includes(candidate));
  if (!layer) return { status: "infeasible", positiveTracks: [], negativeTracks: [], measuredGapNm: null, polarityPreserved: true, explanation: "All four pair anchors require one compatible signal layer for straight coupled routing." };
  const pClass = getNetClass(input.snapshot.board, input.definition.positiveNetId); const nClass = getNetClass(input.snapshot.board, input.definition.negativeNetId);
  const p: Track = { id: routingStableId("diff-preview-p", { pair: input.definition.pairId, start: input.positiveStart.anchorId, end: input.positiveEnd.anchorId }), layer, width: pClass.trackWidth, start: { ...input.positiveStart.point }, end: { ...input.positiveEnd.point }, netId: input.definition.positiveNetId, source: "human" };
  const n: Track = { id: routingStableId("diff-preview-n", { pair: input.definition.pairId, start: input.negativeStart.anchorId, end: input.negativeEnd.anchorId }), layer, width: nClass.trackWidth, start: { ...input.negativeStart.point }, end: { ...input.negativeEnd.point }, netId: input.definition.negativeNetId, source: "human" };
  const pv = { x: p.end.x - p.start.x, y: p.end.y - p.start.y }; const nv = { x: n.end.x - n.start.x, y: n.end.y - n.start.y };
  const parallel = Math.abs(pv.x * nv.y - pv.y * nv.x) <= 1e-6 * Math.max(1, Math.hypot(pv.x, pv.y) * Math.hypot(nv.x, nv.y));
  if (!parallel) return { status: "unsupported", positiveTracks: [], negativeTracks: [], measuredGapNm: null, polarityPreserved: true, explanation: "Cornered or non-parallel coupled-pair construction is not yet supported; no independent-net fallback was used." };
  const centerDistance = segmentDistance(p.start, p.end, n.start, n.end);
  const measuredGapNm = centerDistance - p.width / 2 - n.width / 2;
  if (Math.abs(measuredGapNm - input.targetGapNm) > 1_000) return { status: "infeasible", positiveTracks: [], negativeTracks: [], measuredGapNm, polarityPreserved: true, explanation: `Exact endpoint geometry produces ${Math.round(measuredGapNm)} nm gap; required ${input.targetGapNm} nm.` };
  return { status: "legal", positiveTracks: [p], negativeTracks: [n], measuredGapNm, polarityPreserved: true, explanation: "Straight pair uses two physical traces with typed polarity and exact copper-edge gap. Geometry conformance is not impedance verification." };
}

export function buildPairedThroughVias(input: { snapshot: RoutingSnapshot; definition: DifferentialPairDefinition; positiveAt: { x: number; y: number }; negativeAt: { x: number; y: number }; fromLayer: Track["layer"]; sizeNm: number; drillNm: number }): { status: "legal" | "unsupported"; vias: Via[]; targetLayer?: Track["layer"]; explanation: string } {
  if (input.definition.state !== "resolved") return { status: "unsupported", vias: [], explanation: input.definition.explanation };
  const p = defaultViaTransition(input.snapshot.board, input.definition.positiveNetId, input.fromLayer);
  const n = defaultViaTransition(input.snapshot.board, input.definition.negativeNetId, input.fromLayer);
  if (!p?.legal || !n?.legal || p.targetLayer !== n.targetLayer || p.physicalSpan[0] !== n.physicalSpan[0] || p.physicalSpan[1] !== n.physicalSpan[1]) return { status: "unsupported", vias: [], explanation: "No symmetric supported through-via transition exists for both pair members." };
  const vias: Via[] = [{ id: routingStableId("diff-via-p", { pair: input.definition.pairId, at: input.positiveAt, from: input.fromLayer, to: p.targetLayer }), at: input.positiveAt, size: input.sizeNm, drill: input.drillNm, netId: input.definition.positiveNetId, layers: p.physicalSpan, source: "human" }, { id: routingStableId("diff-via-n", { pair: input.definition.pairId, at: input.negativeAt, from: input.fromLayer, to: n.targetLayer }), at: input.negativeAt, size: input.sizeNm, drill: input.drillNm, netId: input.definition.negativeNetId, layers: n.physicalSpan, source: "human" }];
  return { status: "legal", vias, targetLayer: p.targetLayer, explanation: "Paired transition uses identical through-via span/type and preserves member identity; electromagnetic equivalence is not claimed." };
}
