/**
 * [B16-C.1] Routed-board REVISION lifecycle — the safe product path around the
 * Stage 8 guard (structural schematic → PCB synchronization is refused once
 * protected copper exists; that guard is untouched).
 *
 * Instead of weakening the guard, a NEW board revision is derived from the
 * last authoritative board:
 *
 *  - the old routed board, its qualification authority and its release ledger
 *    stay immutable under the old board id; the derived board gets a new id
 *    (`<root>@r<generation>`) and starts with NO authority — placement,
 *    routing, DRC and qualification must run again before any release;
 *  - the operator chooses explicitly what may be carried forward: copper,
 *    placement, constraints (each a separate, visible decision);
 *  - copper is retained ONLY for nets whose semantic identity is provably
 *    unchanged: same stable net id, byte-identical canonical endpoint set
 *    (`component::pin`), every member component kept with the same footprint
 *    asset, mapping certificate and symbol, and placement carried (copper
 *    geometry depends on pad positions). Everything else is stripped, and the
 *    reason is written down per net;
 *  - the result is a REWORK PLAN a human reviews (`humanReviewRequired`),
 *    sealed by a digest the derivation must re-compute and match.
 *
 * The plan is pure: same parent board + snapshot + assessments + carry → same
 * plan digest. No clock, no randomness.
 */

import { pcbBoardLineageOf, pcbDerivedBoardInstanceId } from "../pcb/board-identity";
import { canonicalEndpointSet, schematicEndpointKey } from "../pcb/integrity";
import { pcbRevisionId } from "../pcb/revision";
import type { BoardOutline, FootprintInstance, PcbBoard } from "../pcb/types";
import { compareCodePoints } from "@/app/lib/stable-compare";
import { boardDigest, classifyBoard } from "./board";
import { pcbSyncDigest, pcbSyncId } from "./stable";
import type { ComponentTransferAssessment, PcbSyncAuthoritativeSnapshot, PcbSyncBoardClass, PcbSyncBoardRecord } from "./types";

export const BOARD_REVISION_PLAN_VERSION = "sirkit.pcb-board-revision-plan.v1" as const;
export const BOARD_REVISION_CONFIRMATION = "derive_board_revision" as const;

export interface BoardRevisionCarry { copper: boolean; placement: boolean; constraints: boolean }

export type BoardRevisionComponentOutcome = "kept" | "added" | "removed" | "footprint_changed" | "pin_map_changed" | "symbol_changed" | "placement_reset";
export type BoardRevisionNetOutcome = "copper_retained" | "copper_stripped" | "unrouted" | "added" | "removed";

export interface BoardRevisionComponentPlan {
  componentInstanceId: string;
  referenceDesignator: string;
  outcome: BoardRevisionComponentOutcome;
  /** Present on the derived board (with its parent placement) or left for the sync plan to add. */
  carried: boolean;
  reasons: string[];
  parent: { footprintAssetVersionId: string; mappingCertificateId: string; symbolAssetVersionId: string } | null;
  next: { footprintAssetVersionId: string | null; mappingCertificateId: string | null; symbolAssetVersionId: string | null } | null;
}

export interface BoardRevisionNetPlan {
  stableNetId: string;
  displayName: string;
  outcome: BoardRevisionNetOutcome;
  proof: { parentEndpoints: string[]; nextEndpoints: string[]; equivalent: boolean; reason: string };
  copper: { tracks: number; vias: number; zones: number };
}

export interface BoardRevisionPlan {
  planSchemaVersion: typeof BOARD_REVISION_PLAN_VERSION;
  planId: string;
  planDigest: string;
  scope: { tenantId: string; projectId: string; branchId: string; designId: string };
  parent: { boardId: string; revision: string; digest: string; boardClass: PcbSyncBoardClass; generation: number; rootBoardId: string };
  derivedBoardId: string;
  generation: number;
  snapshot: { snapshotDigest: string; schematicRevision: string; schematicDigest: string; netGraphDigest: string };
  carry: BoardRevisionCarry;
  components: BoardRevisionComponentPlan[];
  nets: BoardRevisionNetPlan[];
  outline: { changed: boolean; kind: BoardOutline["kind"] };
  constraints: { carried: boolean; parentProgramHash: string | null; parentNetClassing: boolean };
  derived: { revision: string; digest: string; footprints: number; tracks: number; vias: number; zones: number; boardClass: PcbSyncBoardClass };
  summary: {
    componentsKept: number; componentsAdded: number; componentsRemoved: number; componentsChanged: number;
    netsRetained: number; netsStripped: number; netsUnrouted: number; netsAdded: number; netsRemoved: number;
    tracksRetained: number; tracksStripped: number; viasRetained: number; viasStripped: number; zonesRetained: number; zonesStripped: number;
  };
  humanReviewRequired: true;
  requalificationRequired: true;
  confirmation: typeof BOARD_REVISION_CONFIRMATION;
}

export interface BoardRevisionPreviewInput {
  parent: PcbSyncBoardRecord;
  snapshot: PcbSyncAuthoritativeSnapshot;
  /** The preflight's component assessments against the PARENT board: the resolved exact authority per component. */
  assessments: ReadonlyArray<Pick<ComponentTransferAssessment, "componentInstanceId" | "footprintAssetVersionId" | "footprintContentDigest" | "mappingCertificateId">>;
  carry: BoardRevisionCarry;
  /** An explicit new outline (an editor act); absent = the parent outline is carried. */
  outline?: BoardOutline;
}

export interface BoardRevisionPreview { plan: BoardRevisionPlan; derivedBoard: PcbBoard }

function assessmentById(input: BoardRevisionPreviewInput): Map<string, BoardRevisionPreviewInput["assessments"][number]> {
  return new Map(input.assessments.map((item) => [item.componentInstanceId, item]));
}

/** Parent-board endpoints of one net: `component::pin` through the footprint's verified pin-pad mappings (never display names). */
function parentNetEndpoints(board: PcbBoard, netId: number, kept: ReadonlySet<string>): { keys: string[]; complete: boolean } {
  const net = board.nets.find((item) => item.id === netId);
  const keys: string[] = [];
  let complete = true;
  for (const footprint of board.footprints) {
    const componentInstanceId = footprint.syncIdentity?.componentInstanceId;
    if (!componentInstanceId) { if (Object.values(footprint.padNets).includes(netId)) complete = false; continue; }
    const pads = Object.entries(footprint.padNets).filter(([, id]) => id === netId).map(([pad]) => pad);
    if (pads.length === 0) continue;
    if (!kept.has(componentInstanceId)) { complete = false; continue; }
    for (const pad of pads) {
      const mapping = footprint.pinPadMappings?.find((item) => item.padNumbers.includes(pad));
      if (!mapping) { complete = false; continue; }
      keys.push(schematicEndpointKey(componentInstanceId, mapping.symbolPinNumber));
    }
  }
  const canonical = canonicalEndpointSet(keys);
  // A board net that already carries canonical endpoint keys must agree with the pad-derived set.
  if (net?.endpointKeys && canonicalEndpointSet(net.endpointKeys).join("\0") !== canonical.join("\0")) complete = false;
  return { keys: canonical, complete };
}

function outlineEqual(a: BoardOutline, b: BoardOutline): boolean { return pcbSyncDigest(a) === pcbSyncDigest(b); }

/** Build the rework plan and the derived board. Pure and deterministic. */
export function previewBoardRevision(input: BoardRevisionPreviewInput): BoardRevisionPreview {
  const parentBoard = input.parent.board;
  const lineage = pcbBoardLineageOf(input.parent.boardId);
  const generation = lineage.generation + 1;
  const derivedBoardId = pcbDerivedBoardInstanceId(lineage.rootBoardId, generation);
  const resolved = assessmentById(input);
  const applicable = new Map(input.snapshot.components.filter((item) => item.applicability === "applicable").map((item) => [item.componentInstanceId, item]));
  const parentByComponent = new Map<string, FootprintInstance>();
  for (const footprint of parentBoard.footprints) if (footprint.syncIdentity) parentByComponent.set(footprint.syncIdentity.componentInstanceId, footprint);

  // ── components ─────────────────────────────────────────────────────────
  const components: BoardRevisionComponentPlan[] = [];
  const kept = new Set<string>();
  for (const [componentInstanceId, schematic] of applicable) {
    const parent = parentByComponent.get(componentInstanceId);
    const next = resolved.get(componentInstanceId);
    const nextIdentity = { footprintAssetVersionId: next?.footprintAssetVersionId ?? null, mappingCertificateId: next?.mappingCertificateId ?? null, symbolAssetVersionId: schematic.symbolAssetVersionId };
    if (!parent) { components.push({ componentInstanceId, referenceDesignator: schematic.referenceDesignator, outcome: "added", carried: false, reasons: ["not on the parent board; the sync plan adds it"], parent: null, next: nextIdentity }); continue; }
    const parentIdentity = { footprintAssetVersionId: parent.syncIdentity!.footprintAssetVersionId, mappingCertificateId: parent.syncIdentity!.mappingCertificateId, symbolAssetVersionId: parent.syncIdentity!.symbolAssetVersionId };
    const reasons: string[] = [];
    let outcome: BoardRevisionComponentOutcome = "kept";
    if (next && (next.footprintAssetVersionId !== parentIdentity.footprintAssetVersionId || next.footprintContentDigest !== parent.syncIdentity!.footprintContentDigest)) { outcome = "footprint_changed"; reasons.push(`footprint ${parentIdentity.footprintAssetVersionId} → ${next.footprintAssetVersionId}`); }
    else if (next && next.mappingCertificateId !== parentIdentity.mappingCertificateId) { outcome = "pin_map_changed"; reasons.push(`pin-pad mapping ${parentIdentity.mappingCertificateId} → ${next.mappingCertificateId}`); }
    else if (schematic.symbolAssetVersionId !== parentIdentity.symbolAssetVersionId) { outcome = "symbol_changed"; reasons.push(`symbol ${parentIdentity.symbolAssetVersionId} → ${schematic.symbolAssetVersionId}`); }
    else if (!next) { outcome = "footprint_changed"; reasons.push("exact footprint authority not resolved for the new schematic; the sync plan must re-resolve it"); }
    else if (!input.carry.placement) { outcome = "placement_reset"; reasons.push("placement not carried forward; the sync plan re-places it"); }
    const carried = outcome === "kept";
    if (carried) kept.add(componentInstanceId);
    components.push({ componentInstanceId, referenceDesignator: schematic.referenceDesignator, outcome, carried, reasons, parent: parentIdentity, next: nextIdentity });
  }
  for (const [componentInstanceId, parent] of parentByComponent) {
    if (applicable.has(componentInstanceId)) continue;
    components.push({ componentInstanceId, referenceDesignator: parent.ref, outcome: "removed", carried: false, reasons: [input.snapshot.components.some((item) => item.componentInstanceId === componentInstanceId) ? "no longer applicable in the schematic" : "removed from the schematic"], parent: { footprintAssetVersionId: parent.syncIdentity!.footprintAssetVersionId, mappingCertificateId: parent.syncIdentity!.mappingCertificateId, symbolAssetVersionId: parent.syncIdentity!.symbolAssetVersionId }, next: null });
  }
  // Board-only footprints (no sync identity) are never carried: they cannot be proven against the schematic.
  for (const footprint of parentBoard.footprints) if (!footprint.syncIdentity) components.push({ componentInstanceId: footprint.id, referenceDesignator: footprint.ref, outcome: "removed", carried: false, reasons: ["board-only footprint without schematic identity cannot be proven; re-add it on the derived board deliberately"], parent: null, next: null });
  components.sort((a, b) => compareCodePoints(a.componentInstanceId, b.componentInstanceId));

  // ── nets ──────────────────────────────────────────────────────────────
  const nets: BoardRevisionNetPlan[] = [];
  const parentByStable = new Map(parentBoard.nets.filter((net) => net.id !== 0 && net.stableId).map((net) => [net.stableId!, net]));
  const retainedNetIds = new Set<number>();
  const keptNetIds = new Set<number>();
  const counts = (netId: number) => ({ tracks: parentBoard.tracks.filter((item) => item.netId === netId).length, vias: parentBoard.vias.filter((item) => item.netId === netId).length, zones: parentBoard.zones.filter((item) => item.netId === netId).length });
  for (const net of input.snapshot.nets) {
    const parent = parentByStable.get(net.stableNetId);
    const nextEndpoints = canonicalEndpointSet(net.members.map((member) => schematicEndpointKey(member.componentInstanceId, member.pinNumber)));
    if (!parent) { nets.push({ stableNetId: net.stableNetId, displayName: net.displayName, outcome: "added", proof: { parentEndpoints: [], nextEndpoints, equivalent: false, reason: "net does not exist on the parent board" }, copper: { tracks: 0, vias: 0, zones: 0 } }); continue; }
    const parentEndpoints = parentNetEndpoints(parentBoard, parent.id, kept);
    const equivalent = parentEndpoints.complete && parentEndpoints.keys.join("\0") === nextEndpoints.join("\0") && net.members.every((member) => kept.has(member.componentInstanceId));
    const copper = counts(parent.id);
    const hasCopper = copper.tracks + copper.vias + copper.zones > 0;
    keptNetIds.add(parent.id);
    let outcome: BoardRevisionNetOutcome;
    let reason: string;
    if (!hasCopper) { outcome = "unrouted"; reason = equivalent ? "endpoints unchanged; no copper on the parent net" : "no copper on the parent net"; }
    else if (!input.carry.copper) { outcome = "copper_stripped"; reason = "copper not carried forward by the operator's choice"; }
    else if (!input.carry.placement) { outcome = "copper_stripped"; reason = "copper geometry depends on pad positions and placement is not carried"; }
    else if (!parentEndpoints.complete) { outcome = "copper_stripped"; reason = "parent endpoints could not be proven (a member component changed, or a pad lacks a verified pin mapping)"; }
    else if (!equivalent) { outcome = "copper_stripped"; reason = "endpoint set changed"; }
    else { outcome = "copper_retained"; reason = "same stable net, byte-identical canonical endpoint set, every member kept with the same footprint, mapping and symbol, placement carried"; retainedNetIds.add(parent.id); }
    nets.push({ stableNetId: net.stableNetId, displayName: net.displayName, outcome, proof: { parentEndpoints: parentEndpoints.keys, nextEndpoints, equivalent, reason }, copper });
  }
  // A stable net id is derived from the endpoint set, so a membership change usually appears as one REMOVED identity plus
  // one ADDED identity with the same label; the removed entry says so and its copper is stripped either way.
  const addedByLabel = new Map(input.snapshot.nets.filter((net) => !parentByStable.has(net.stableNetId)).map((net) => [net.displayName.replace(/^.*\//, ""), net]));
  for (const [stableNetId, parent] of parentByStable) {
    if (input.snapshot.nets.some((net) => net.stableNetId === stableNetId)) continue;
    const parentEndpoints = parentNetEndpoints(parentBoard, parent.id, kept);
    const successor = addedByLabel.get(parent.name.replace(/^.*\//, ""));
    const reason = successor
      ? `net identity changed with its membership (${parentEndpoints.keys.length} → ${successor.members.length} endpoints); copper stripped and the net re-added under ${successor.stableNetId}`
      : "net no longer exists in the schematic; its copper is stripped";
    nets.push({ stableNetId, displayName: parent.name, outcome: "removed", proof: { parentEndpoints: parentEndpoints.keys, nextEndpoints: successor ? canonicalEndpointSet(successor.members.map((member) => schematicEndpointKey(member.componentInstanceId, member.pinNumber))) : [], equivalent: false, reason }, copper: counts(parent.id) });
  }
  // Parent nets without a stable id can never be proven: stripped and dropped.
  for (const net of parentBoard.nets) if (net.id !== 0 && !net.stableId) nets.push({ stableNetId: `unstable:${net.id}`, displayName: net.name, outcome: "removed", proof: { parentEndpoints: [], nextEndpoints: [], equivalent: false, reason: "parent net has no stable identity; cannot be proven" }, copper: counts(net.id) });
  nets.sort((a, b) => compareCodePoints(a.stableNetId, b.stableNetId));

  // ── derived board ─────────────────────────────────────────────────────
  const outline = input.outline ?? structuredClone(parentBoard.outline);
  const outlineChanged = !outlineEqual(outline, parentBoard.outline);
  const derivedFootprints = parentBoard.footprints.filter((footprint) => footprint.syncIdentity && kept.has(footprint.syncIdentity.componentInstanceId)).map((footprint) => {
    const clone = structuredClone(footprint);
    clone.padNets = Object.fromEntries(Object.entries(clone.padNets).map(([pad, netId]) => [pad, keptNetIds.has(netId) ? netId : 0]));
    return clone;
  });
  const derivedNets = parentBoard.nets.filter((net) => net.id === 0 || keptNetIds.has(net.id)).map((net) => structuredClone(net));
  const derivedTracks = input.carry.copper ? parentBoard.tracks.filter((item) => retainedNetIds.has(item.netId)).map((item) => structuredClone(item)) : [];
  const derivedVias = input.carry.copper ? parentBoard.vias.filter((item) => retainedNetIds.has(item.netId)).map((item) => structuredClone(item)) : [];
  // Zones on retained nets are carried but their fills are stale by construction (they must be re-poured before any release).
  const derivedZones = input.carry.copper ? parentBoard.zones.filter((item) => retainedNetIds.has(item.netId)).map((item) => ({ ...structuredClone(item), fill: [], dirty: true })) : [];
  const derivedBoard: PcbBoard = {
    formatVersion: 1,
    ...(parentBoard.identityVersion !== undefined ? { identityVersion: parentBoard.identityVersion } : {}),
    stackup: parentBoard.stackup,
    ...(parentBoard.stackupConfig ? { stackupConfig: structuredClone(parentBoard.stackupConfig) } : {}),
    outline,
    nets: derivedNets,
    footprints: derivedFootprints,
    tracks: derivedTracks,
    vias: derivedVias,
    zones: derivedZones,
    texts: structuredClone(parentBoard.texts),
    ...(input.carry.constraints && parentBoard.netClassing ? { netClassing: structuredClone(parentBoard.netClassing) } : {}),
    ...(parentBoard.silkItems ? { silkItems: structuredClone(parentBoard.silkItems) } : {}),
    ...(parentBoard.padstacks ? { padstacks: structuredClone(parentBoard.padstacks) } : {}),
    ...(parentBoard.routingPreferences ? { routingPreferences: structuredClone(parentBoard.routingPreferences) } : {}),
    ...(input.carry.constraints && parentBoard.routingKeepouts ? { routingKeepouts: structuredClone(parentBoard.routingKeepouts) } : {}),
    ...(parentBoard.placementPolicy ? { placementPolicy: structuredClone(parentBoard.placementPolicy) } : {}),
    ...(parentBoard.placementPreferences ? { placementPreferences: structuredClone(parentBoard.placementPreferences) } : {}),
    ...(parentBoard.dimensions ? { dimensions: structuredClone(parentBoard.dimensions) } : {}),
    ...(input.carry.constraints && parentBoard.constraintState ? { constraintState: structuredClone(parentBoard.constraintState) } : {}),
    // routingHistory belongs to the parent's undo/redo lifetime and is never carried.
  };
  const derivedRevision = pcbRevisionId(derivedBoard);
  const derivedDigest = boardDigest(derivedBoard);

  const tracksRetained = derivedTracks.length, viasRetained = derivedVias.length, zonesRetained = derivedZones.length;
  const summary: BoardRevisionPlan["summary"] = {
    componentsKept: components.filter((item) => item.outcome === "kept").length,
    componentsAdded: components.filter((item) => item.outcome === "added").length,
    componentsRemoved: components.filter((item) => item.outcome === "removed").length,
    componentsChanged: components.filter((item) => ["footprint_changed", "pin_map_changed", "symbol_changed", "placement_reset"].includes(item.outcome)).length,
    netsRetained: nets.filter((item) => item.outcome === "copper_retained").length,
    netsStripped: nets.filter((item) => item.outcome === "copper_stripped").length,
    netsUnrouted: nets.filter((item) => item.outcome === "unrouted").length,
    netsAdded: nets.filter((item) => item.outcome === "added").length,
    netsRemoved: nets.filter((item) => item.outcome === "removed").length,
    tracksRetained, tracksStripped: parentBoard.tracks.length - tracksRetained,
    viasRetained, viasStripped: parentBoard.vias.length - viasRetained,
    zonesRetained, zonesStripped: parentBoard.zones.length - zonesRetained,
  };
  const content: Omit<BoardRevisionPlan, "planId" | "planDigest"> = {
    planSchemaVersion: BOARD_REVISION_PLAN_VERSION,
    scope: { tenantId: input.parent.tenantId, projectId: input.parent.projectId, branchId: input.parent.branchId, designId: input.snapshot.designId },
    parent: { boardId: input.parent.boardId, revision: input.parent.revision, digest: input.parent.digest, boardClass: classifyBoard(parentBoard).boardClass, generation: lineage.generation, rootBoardId: lineage.rootBoardId },
    derivedBoardId, generation,
    snapshot: { snapshotDigest: input.snapshot.snapshotDigest, schematicRevision: input.snapshot.schematicRevision, schematicDigest: input.snapshot.schematicDigest, netGraphDigest: input.snapshot.netGraphDigest },
    carry: { ...input.carry },
    components, nets,
    outline: { changed: outlineChanged, kind: outline.kind },
    constraints: { carried: input.carry.constraints, parentProgramHash: parentBoard.constraintState?.activeProgram?.programHash ?? null, parentNetClassing: Boolean(parentBoard.netClassing) },
    derived: { revision: derivedRevision, digest: derivedDigest, footprints: derivedFootprints.length, tracks: tracksRetained, vias: viasRetained, zones: zonesRetained, boardClass: classifyBoard(derivedBoard).boardClass },
    summary,
    humanReviewRequired: true,
    requalificationRequired: true,
    confirmation: BOARD_REVISION_CONFIRMATION,
  };
  const planDigest = pcbSyncDigest(content);
  const planId = pcbSyncId("pcb-board-revision-plan", { planDigest });
  return { plan: { ...content, planId, planDigest }, derivedBoard };
}

/** Blocked-operation reason codes that mean "structural change on protected copper" — the situations a derived revision exists for. */
export const STAGE8_BLOCKER_CODES: ReadonlySet<string> = new Set([
  "PS_ROUTED_NET_CHANGE_REQUIRES_STAGE8",
  "PS_FOOTPRINT_REPLACEMENT_REQUIRES_STAGE8",
  "PS_EXTRA_BOARD_COMPONENT_PROTECTED",
  "PS_STRUCTURAL_ADD_REQUIRES_UNROUTED_BOARD",
  "PS_ROUTED_COMPONENT_REMOVAL_REQUIRES_STAGE8",
  "PS_REMOVED_NET_PROTECTED",
]);

/** True when a preflight was refused for structural change on protected copper — the situation a derived revision resolves. */
export function preflightBlockedByProtectedCopper(blockers: ReadonlyArray<{ code: string }>): boolean {
  return blockers.some((blocker) => STAGE8_BLOCKER_CODES.has(blocker.code));
}
