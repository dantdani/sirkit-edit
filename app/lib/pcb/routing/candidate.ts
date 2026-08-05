import { computeElectricalTruth } from "../electrical-truth";
import { checkClearance } from "../route-tool";
import { resolveSmartRoutingRules } from "../smart-routing/rules";
import { markZoneFillDirty } from "../zones/fill-lifecycle";
import type { PcbBoard, Track, Via, Zone } from "../types";
import { viaSpannedLayers } from "../geometry-copper";
import { runDrc } from "../drc/run-drc";
import { DEFAULT_PRESET_ID, getPreset } from "../drc/presets";
import { buildRoutingSnapshot, routingInputRevisions } from "./snapshot";
import { splitTracksAtAnchors } from "./split";
import { deepFreezeRouting, routingSemanticHash, routingStableId } from "./stable";
import { ROUTE_CANDIDATE_SCHEMA, ROUTING_MIN_SEGMENT_NM, type RouteAnchor, type RouteCandidate, type RouteObjectDelta, type RouteRequest, type RouteValidationReport, type RoutingSnapshot } from "./types";

function candidateSemantic(candidate: RouteCandidate): unknown {
  return { ...candidate, candidateId: undefined, candidateDigest: undefined };
}

function createdBy(request: RouteRequest): "interactive" | "ai-requested" | "deterministic-router" {
  return request.requestedBy.kind === "ai" ? "ai-requested" : request.operationKind === "interactive_route" ? "interactive" : "deterministic-router";
}

function normalizeTrack(track: Track, request: RouteRequest, candidateKey: string, index: number): Track {
  const id = routingStableId("route-track", { candidateKey, index, layer: track.layer, width: track.width, start: track.start, end: track.end, netId: track.netId });
  return { ...structuredClone(track), id, source: request.requestedBy.kind === "ai" ? "ai" : "human", locked: false, routingProvenance: { operationId: request.requestId, candidateId: `route-candidate:${candidateKey.slice(3)}`, eventId: routingStableId("route-event", { candidateKey, kind: "track", index }), actorId: request.requestedBy.actorId, createdBy: createdBy(request), lineageObjectIds: [...new Set(track.routingProvenance?.lineageObjectIds ?? [])].sort() } };
}

function normalizeVia(via: Via, request: RouteRequest, candidateKey: string, index: number): Via {
  const id = routingStableId("route-via", { candidateKey, index, at: via.at, size: via.size, drill: via.drill, layers: via.layers, netId: via.netId, padstackId: via.padstackId });
  return { ...structuredClone(via), id, source: request.requestedBy.kind === "ai" ? "ai" : "human", locked: false, routingProvenance: { operationId: request.requestId, candidateId: `route-candidate:${candidateKey.slice(3)}`, eventId: routingStableId("route-event", { candidateKey, kind: "via", index }), actorId: request.requestedBy.actorId, createdBy: createdBy(request), lineageObjectIds: [...new Set(via.routingProvenance?.lineageObjectIds ?? [])].sort() } };
}

export function applyRouteDelta(board: PcbBoard, delta: RouteObjectDelta, reason: string): void {
  const removedTracks = new Set(delta.removedTracks.map((track) => track.id));
  const removedVias = new Set(delta.removedVias.map((via) => via.id));
  const modifiedTracks = new Map(delta.modifiedTracks.map((item) => [item.before.id, item.after]));
  const modifiedVias = new Map(delta.modifiedVias.map((item) => [item.before.id, item.after]));
  board.tracks = board.tracks.filter((track) => !removedTracks.has(track.id)).map((track) => structuredClone(modifiedTracks.get(track.id) ?? track));
  board.vias = board.vias.filter((via) => !removedVias.has(via.id)).map((via) => structuredClone(modifiedVias.get(via.id) ?? via));
  board.tracks.push(...delta.createdTracks.map((track) => structuredClone(track)));
  board.vias.push(...delta.createdVias.map((via) => structuredClone(via)));
  const affectedLayers = new Set([
    ...delta.createdTracks.map((track) => track.layer),
    ...delta.removedTracks.map((track) => track.layer),
    ...delta.modifiedTracks.flatMap((item) => [item.before.layer, item.after.layer]),
    ...delta.createdVias.flatMap(viaSpannedLayers),
    ...delta.removedVias.flatMap(viaSpannedLayers),
    ...delta.modifiedVias.flatMap((item) => [...viaSpannedLayers(item.before), ...viaSpannedLayers(item.after)]),
  ]);
  for (const zone of board.zones) if (affectedLayers.has(zone.layer)) markZoneFillDirty(zone, reason);
  if (board.constraintState) board.constraintState.activeEvaluation = undefined;
}

function validateLocal(snapshot: RoutingSnapshot, delta: RouteObjectDelta, request: RouteRequest): RouteValidationReport {
  const violations: RouteValidationReport["violations"] = [];
  const ids = [...delta.createdTracks.map((track) => track.id), ...delta.createdVias.map((via) => via.id)];
  if (new Set(ids).size !== ids.length) violations.push({ code: "DUPLICATE_ROUTE_OBJECT_ID", state: "failed", objectIds: ids, message: "Candidate contains duplicate route object IDs." });
  for (const track of delta.createdTracks) {
    if (track.netId === 0) violations.push({ code: "NET_ZERO_ROUTE", state: "failed", objectIds: [`track:${track.id}`], message: "Ordinary routing cannot create net-0 copper." });
    if (Math.hypot(track.end.x - track.start.x, track.end.y - track.start.y) < ROUTING_MIN_SEGMENT_NM) violations.push({ code: "ROUTE_SEGMENT_TOO_SHORT", state: "failed", objectIds: [`track:${track.id}`], message: "Candidate contains a zero/too-short segment." });
  }
  const ignored = new Set([...delta.removedTracks.map((track) => track.id), ...delta.removedVias.map((via) => via.id), ...delta.modifiedTracks.map((item) => item.before.id), ...delta.modifiedVias.map((item) => item.before.id)]);
  const byNet = new Map<number, { tracks: Track[]; vias: Via[] }>();
  for (const track of [...delta.createdTracks, ...delta.modifiedTracks.map((item) => item.after)]) {
    const value = byNet.get(track.netId) ?? { tracks: [], vias: [] }; value.tracks.push(track); byNet.set(track.netId, value);
  }
  for (const via of [...delta.createdVias, ...delta.modifiedVias.map((item) => item.after)]) {
    const value = byNet.get(via.netId) ?? { tracks: [], vias: [] }; value.vias.push(via); byNet.set(via.netId, value);
  }
  for (const [netId, objects] of [...byNet].sort(([a], [b]) => a - b)) {
    const layer = objects.tracks[0]?.layer ?? request.preferredLayer ?? "copperTop";
    const rules = resolveSmartRoutingRules(snapshot.board as PcbBoard, netId, layer);
    const result = checkClearance(snapshot.board as PcbBoard, { candidateSegments: objects.tracks, candidateVias: objects.vias, ignoreItemIds: ignored, netId, clearance: rules.clearanceNm, edgeClearance: rules.edgeClearanceNm });
    if (!result.legal) violations.push({ code: result.blockedByEdge ? "BOARD_EDGE" : result.blockedByKeepoutId ? "KEEPOUT" : "CLEARANCE", state: "failed", objectIds: [result.blockedBy ? JSON.stringify(result.blockedBy) : result.blockedByKeepoutId ?? "board-edge"], message: result.blockedByEdge ? "Candidate violates board-edge clearance." : result.blockedByKeepoutId ? "Candidate enters a routing keepout." : "Candidate violates copper clearance." });
  }
  const constraintEvaluations = request.hardConstraintIds.map((constraintId) => ({ constraintId, state: "not_evaluated" as const, evaluatorId: "professional-routing-local/1.0.0", objectIds: ids, explanation: "Explicit hard constraint requires authoritative commit evaluation." }));
  if (constraintEvaluations.length > 0) violations.push(...constraintEvaluations.map((item) => ({ code: "HARD_CONSTRAINT_NOT_EVALUATED", state: "not_evaluated" as const, objectIds: item.objectIds, message: `${item.constraintId} was not evaluated locally.` })));
  return { horizon: "interactive_local", legal: violations.length === 0, violations: violations.sort((a, b) => a.code.localeCompare(b.code) || a.objectIds.join().localeCompare(b.objectIds.join())), constraintEvaluations, globalState: "not_yet_evaluated" };
}

function connectivityDelta(before: PcbBoard, after: PcbBoard) {
  const left = computeElectricalTruth(before); const right = computeElectricalTruth(after);
  const beforeShorts = new Set(left.shorts.map((item) => item.id));
  const newShortIds = right.shorts.map((item) => item.id).filter((id) => !beforeShorts.has(id)).sort();
  return { intendedRemainingBefore: left.realized.remainingConnections, intendedRemainingAfter: right.realized.remainingConnections, opensClosed: Math.max(0, left.realized.remainingConnections - right.realized.remainingConnections), remainingOpens: right.realized.remainingConnections, newShortIds, ambiguousContactIds: right.unresolved.filter((item) => item.code === "COPPER_NET_RELATION_UNRESOLVED").flatMap((item) => item.objectIds).sort(), zoneEvidence: after.zones.some((zone) => zone.dirty || zone.fillState?.status !== "current") ? "dirty" as const : "current" as const };
}

export function buildRouteCandidate(input: { snapshot: RoutingSnapshot; request: RouteRequest; tracks: Track[]; vias?: Via[]; anchors?: RouteAnchor[] }): RouteCandidate {
  const candidateKey = routingSemanticHash({ revisions: input.snapshot.revisions, request: input.request, tracks: input.tracks.map((track) => ({ layer: track.layer, width: track.width, start: track.start, end: track.end, netId: track.netId })), vias: (input.vias ?? []).map((via) => ({ at: via.at, size: via.size, drill: via.drill, netId: via.netId, layers: via.layers, padstackId: via.padstackId })), anchors: input.anchors?.map((anchor) => anchor.anchorId) });
  const split = splitTracksAtAnchors({ tracks: input.snapshot.board.tracks, anchors: input.anchors ?? [], request: input.request, candidateKey });
  const routes = input.tracks.map((track, index) => normalizeTrack(track, input.request, candidateKey, index));
  const vias = (input.vias ?? []).map((via, index) => normalizeVia(via, input.request, candidateKey, index));
  const delta: RouteObjectDelta = { createdTracks: [...split.createdTracks, ...routes].sort((a, b) => a.id.localeCompare(b.id)), createdVias: vias.sort((a, b) => a.id.localeCompare(b.id)), modifiedTracks: [], modifiedVias: [], removedTracks: split.removedTracks, removedVias: [] };
  const localValidation = validateLocal(input.snapshot, delta, input.request);
  if (!split.ok) localValidation.violations.push(...split.failures.map((failure) => ({ code: failure.code, state: "failed" as const, objectIds: failure.objectIds, message: failure.message })));
  localValidation.legal = localValidation.violations.length === 0;
  const candidateBoard = structuredClone(input.snapshot.board) as PcbBoard;
  applyRouteDelta(candidateBoard, delta, `route-candidate:${candidateKey}`);
  const electricalDelta = connectivityDelta(input.snapshot.board as PcbBoard, candidateBoard);
  if (electricalDelta.newShortIds.length > 0) {
    localValidation.legal = false;
    localValidation.violations.push({ code: "NEW_SHORT", state: "failed", objectIds: electricalDelta.newShortIds, message: "Candidate introduces a new authoritative short." });
  }
  const status = localValidation.legal ? "preview_legal" as const : "preview_with_collisions" as const;
  const base: Omit<RouteCandidate, "candidateId" | "candidateDigest"> = { schemaVersion: ROUTE_CANDIDATE_SCHEMA, request: structuredClone(input.request), inputRevisionSet: structuredClone(input.snapshot.revisions), settingsDigest: routingSemanticHash({ mode: input.request.routeMode, posture: input.request.posture, budget: input.request.searchBudget }), seed: input.request.deterministicSeed, delta, topologyDelta: { splitSourceIds: split.splitSourceIds, createdNodeIds: split.junctionIds, createdEdgeIds: delta.createdTracks.map((track) => track.id) }, shoveDisplacements: [], springbackState: [], measurements: [], localValidation, electricalDelta, constraintEvaluation: localValidation.constraintEvaluations, unresolvedEvidence: [...new Set([...split.failures.map((failure) => failure.code), ...input.request.hardConstraintIds.filter((id) => localValidation.constraintEvaluations.some((item) => item.constraintId === id && item.state !== "passed"))])].sort(), warnings: ["Local legality is not full-board DRC, readiness, impedance, SI, PI, or thermal proof."], status };
  const candidateDigest = routingSemanticHash(base);
  const candidate = { ...base, candidateId: `route-candidate:${candidateKey.slice(3)}`, candidateDigest };
  return deepFreezeRouting(candidate) as RouteCandidate;
}

export interface RouteCommitTransaction {
  schemaVersion: 1;
  transactionId: string;
  candidateId: string;
  candidateDigest: string;
  beforeRevision: string;
  afterRevision: string;
  delta: RouteObjectDelta;
  zoneSnapshotsBefore: Zone[];
  actorId: string;
  authoritativeValidation: RouteValidationReport;
}

export type RouteCommitResult = { ok: true; board: PcbBoard; transaction: RouteCommitTransaction } | { ok: false; code: "INVALID_CANDIDATE" | "STALE" | "LOCAL_INVALID" | "AUTHORITATIVE_SHORT" | "AUTHORITATIVE_DRC"; message: string; changedRevisions?: string[] };

export function commitRouteCandidate(input: { board: PcbBoard; candidate: RouteCandidate; actorId: string }): RouteCommitResult {
  if (routingSemanticHash(candidateSemantic(input.candidate)) !== input.candidate.candidateDigest || !input.candidate.candidateId.startsWith("route-candidate:")) return { ok: false, code: "INVALID_CANDIDATE", message: "Route candidate digest/identity does not match its immutable payload." };
  const current = routingInputRevisions(input.board);
  const changed = (Object.keys(current) as Array<keyof typeof current>).filter((key) => routingSemanticHash(current[key]) !== routingSemanticHash(input.candidate.inputRevisionSet[key])).map(String);
  if (changed.length > 0) return { ok: false, code: "STALE", message: `Routing inputs changed: ${changed.join(", ")}.`, changedRevisions: changed };
  if (!input.candidate.localValidation.legal || input.candidate.status !== "preview_legal") return { ok: false, code: "LOCAL_INVALID", message: "Only a locally legal immutable preview can enter authoritative commit validation." };
  const board = structuredClone(input.board);
  const beforeRevision = current.designRevision;
  const zones = input.board.zones.map((zone) => structuredClone(zone));
  applyRouteDelta(board, input.candidate.delta, `route-commit:${input.candidate.candidateId}`);
  const electrical = connectivityDelta(input.board, board);
  if (electrical.newShortIds.length > 0) return { ok: false, code: "AUTHORITATIVE_SHORT", message: `Authoritative connectivity found new shorts: ${electrical.newShortIds.join(", ")}.` };
  const rules = getPreset(DEFAULT_PRESET_ID).rules;
  const beforeDrc = runDrc(input.board, rules);
  const afterDrc = runDrc(board, rules);
  const beforeErrors = new Set(beforeDrc.violations.filter((violation) => violation.severity === "error").map((violation) => violation.id));
  const newErrors = afterDrc.violations.filter((violation) => violation.severity === "error" && !beforeErrors.has(violation.id));
  const authoritativeValidation: RouteValidationReport = {
    horizon: "authoritative_commit",
    legal: newErrors.length === 0,
    violations: newErrors.map((violation) => ({ code: `DRC_${violation.kind.toUpperCase()}`, state: "failed", objectIds: violation.items.map((item) => JSON.stringify(item)), message: violation.summary })),
    constraintEvaluations: input.candidate.constraintEvaluation.map((evaluation) => structuredClone(evaluation)),
    globalState: "evaluated",
  };
  if (!authoritativeValidation.legal) return { ok: false, code: "AUTHORITATIVE_DRC", message: `Authoritative full-board DRC found ${newErrors.length} new blocking violation${newErrors.length === 1 ? "" : "s"}.` };
  const afterRevision = buildRoutingSnapshot(board).revisions.designRevision;
  const transaction: RouteCommitTransaction = { schemaVersion: 1, transactionId: routingStableId("route-transaction", { candidate: input.candidate.candidateDigest, beforeRevision, afterRevision, actorId: input.actorId }), candidateId: input.candidate.candidateId, candidateDigest: input.candidate.candidateDigest, beforeRevision, afterRevision, delta: structuredClone(input.candidate.delta), zoneSnapshotsBefore: zones, actorId: input.actorId, authoritativeValidation };
  return { ok: true, board, transaction };
}

export function revertRouteCommit(input: { board: PcbBoard; transaction: RouteCommitTransaction }): RouteCommitResult {
  if (buildRoutingSnapshot(input.board).revisions.designRevision !== input.transaction.afterRevision) return { ok: false, code: "STALE", message: "Board changed after route commit; exact revert is stale." };
  const board = structuredClone(input.board);
  const inverse: RouteObjectDelta = { createdTracks: input.transaction.delta.removedTracks, createdVias: input.transaction.delta.removedVias, modifiedTracks: input.transaction.delta.modifiedTracks.map((item) => ({ before: item.after, after: item.before })), modifiedVias: input.transaction.delta.modifiedVias.map((item) => ({ before: item.after, after: item.before })), removedTracks: input.transaction.delta.createdTracks, removedVias: input.transaction.delta.createdVias };
  applyRouteDelta(board, inverse, `route-revert:${input.transaction.transactionId}`);
  board.zones = input.transaction.zoneSnapshotsBefore.map((zone) => structuredClone(zone));
  if (buildRoutingSnapshot(board).revisions.designRevision !== input.transaction.beforeRevision) return { ok: false, code: "INVALID_CANDIDATE", message: "Exact route revert did not restore the original semantic revision." };
  return { ok: true, board, transaction: input.transaction };
}
