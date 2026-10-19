/**
 * [PR-L6, 2026-10-19] Runbook M.4 / M.5 item 7 (OD-253 item 8): what a reviewed component replacement does to the project's DURABLE
 * board, shown BEFORE approval.
 *
 * The resolution transaction itself never touches a board (the schematic session's canonical project is the schematic plus an empty
 * board), so a replacement on a project that already has a durable PCB changes the board only at the NEXT Prepare PCB - where the
 * server's preflight reconciles the board against the new schematic. This module predicts that reconciliation for the batch, from
 * the batch's sealed items and the durable board record (the same board the preflight, the qualification and the release read; never
 * the browser working copy), with the preflight's own rules and protection predicates:
 *
 *  - per item: compare the target's exact identity with the board footprint's `syncIdentity` (the shared comparator of
 *    app/lib/pcb-sync/schematic-drift.ts), in the board-revision vocabulary (not-on-board | unchanged | footprint_changed |
 *    pin_map_changed | symbol_changed); the per-pin rows (the net, the board pads, the target pin and pads, the copper on that net);
 *    the placement (position, rotation, side, locked, fixed); and the predicted Prepare PCB operation and blocker codes, mirroring
 *    app/lib/pcb-sync/reconciliation.ts (a footprint or mapping change on a protected, locked or fixed footprint is Stage 8; otherwise an
 *    unrouted replacement in place; an instance missing from a routed / zoned / constrained / locked board cannot be added) and the
 *    service's removed-net rule (a net whose endpoint set changes is re-identified - its stable id is derived from the endpoints - so
 *    the board's old net is "removed": protected when it owns copper, a reconciliation otherwise);
 *  - for the board: whether a derived board revision (Stage 8) is required, the copper the revision would strip (copper survives only
 *    on nets whose every member is kept: board-revision.ts), and what the change invalidates - placement legality and DRC (any
 *    change), routing (copper on an affected net), the qualification authority and the latest release (their identities named), and
 *    the local stage evidence.
 *
 * It carries a deterministic digest (no clock, no randomness): the approval controller re-reads the basis at Approve and refuses when
 * the digest moved. The receipt carries the bounded `resolutionBoardImpactSummary` - DISCLOSURE, never authority: the post-apply gate
 * is derived from the board and the schematic themselves (schematic-drift.ts), never from a receipt.
 *
 * Pure and browser-safe.
 */
import type { FootprintInstance, PcbBoard, PcbNet } from "../pcb/types";
import { canonicalEndpointSet, schematicEndpointKey, stableNetIdForEndpoints } from "../pcb/integrity";
import { inspectBoard } from "../pcb-sync/board";
import { pcbBoardLineageOf } from "../pcb/board-identity";
import { STAGE8_BLOCKER_CODES } from "../pcb-sync/board-revision";
import { netHasProtectedState, riskyBoard } from "../pcb-sync/reconciliation";
import { syncIdentityDifferences, type SchematicIdentityField } from "../pcb-sync/schematic-drift";
import type { PcbSyncBoardClass, PcbSyncBoardRecord } from "../pcb-sync/types";
import { engineeringDigest } from "../engineering/stable";
import { compareCodePoints } from "@/app/lib/stable-compare";
import type { SealedResolutionProposal } from "./resolution-proposal";

export const RESOLUTION_BOARD_IMPACT_SCHEMA = "sirkit.resolution-board-impact.v1" as const;
export const RESOLUTION_BOARD_IMPACT_SUMMARY_SCHEMA = "sirkit.resolution-board-impact-summary.v1" as const;

// ─── inputs ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** One reviewed item: the stable instance, its target identity and the proved mapping (current pin -> target pin and pads). */
export interface BoardImpactItemInput {
  componentInstanceId: string;
  refDes: string;
  target: { symbolAssetVersionId: string; footprintAssetVersionId: string; mappingCertificateId: string; footprintFullName?: string | null };
  mapping: ReadonlyArray<{ fromPin: string; toPin: string; pads: readonly string[] }>;
}

/** The durable facts the impact is assessed against (resolution-board-basis.ts loads them through the existing board read). */
export type ResolutionBoardBasis =
  | { state: "no-board"; boardId: string }
  | {
      state: "board";
      boardId: string;
      record: PcbSyncBoardRecord;
      authority: { revision: number; recordDigest: string; current: boolean } | null;
      latestRelease: { releaseId: string; current: boolean } | null;
    }
  | { state: "unavailable"; code: string; detail: string };

/** The sealed batch's items as the impact reads them. */
/** The binding-stage refusal a re-bind meets while the board's earlier binding of the part is in effect. */
export const REBIND_CONFLICT_CODE = "PB_ACTIVE_SELECTION_CONFLICT" as const;

export function resolutionBoardImpactItems(proposal: SealedResolutionProposal): BoardImpactItemInput[] {
  return proposal.impact.items.map((item) => ({
    componentInstanceId: item.componentInstanceId,
    refDes: item.refDes,
    target: { symbolAssetVersionId: item.target.symbolAssetVersionId, footprintAssetVersionId: item.target.footprintAssetVersionId, mappingCertificateId: item.target.mappingCertificateId, footprintFullName: item.target.footprintFullName },
    mapping: item.mapping.map((entry) => ({ fromPin: entry.fromPin, toPin: entry.toPin, pads: [...entry.pads] })),
  }));
}

// ─── the impact ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export type BoardImpactOutcome = "not-on-board" | "unchanged" | "footprint_changed" | "pin_map_changed" | "symbol_changed";
export type BoardImpactOperation = "add_component_instance" | "replace_unrouted_footprint" | "preserve_component_instance" | "update_reference_designator" | "blocked";
export interface CopperCount { tracks: number; vias: number; zones: number }

export interface BoardImpactPinRow {
  /** the current schematic pin and the target pin it becomes (the proved mapping) */
  pin: string;
  toPin: string;
  /** the board net the pin's pads sit on (display name and stable identity), null when unconnected or not on the board */
  net: string | null;
  stableNetId: string | null;
  boardPads: string[];
  targetPads: string[];
  copper: CopperCount;
}

export interface BoardImpactItem {
  componentInstanceId: string;
  schematicRefDes: string;
  boardRef: string | null;
  outcome: BoardImpactOutcome;
  /** the exact identities that differ (empty when unchanged or not on the board) */
  fields: SchematicIdentityField[];
  current: { footprintAssetVersionId: string; mappingCertificateId: string; symbolAssetVersionId: string } | null;
  target: { footprintAssetVersionId: string; mappingCertificateId: string; symbolAssetVersionId: string; footprint: string | null };
  pins: BoardImpactPinRow[];
  placement: { x: number; y: number; rotationDeg: number; side: "top" | "bottom"; locked: boolean; fixed: boolean } | null;
  predicted: { operation: BoardImpactOperation; codes: string[] };
  /** whether the nets this item touches were assessed (an item not on the board joins nets the impact cannot name by identity) */
  netEffects: "assessed" | "none" | "unassessed";
  /**
   * The board carries this part under ANOTHER published revision: Prepare PCB must bind the target revision first (a reviewer's act),
   * and a re-bind is refused while the board's earlier binding of the part is in effect (`PB_ACTIVE_SELECTION_CONFLICT`: bindings are
   * per board lineage and one selection is effective per instance) - the page has no control that supersedes it.
   */
  rebind: boolean;
}

export interface BoardImpactNet {
  stableNetId: string;
  name: string;
  copper: CopperCount;
  /** the endpoint set changes (the net is re-identified at Prepare PCB) */
  membershipChanges: boolean;
  /** the preflight code this net is predicted to raise, or null */
  predictedCode: string | null;
}

export interface ResolutionBoardImpact {
  schema: typeof RESOLUTION_BOARD_IMPACT_SCHEMA;
  /** the durable facts assessed - the board revision and digest, and the qualification authority and latest release heads at the read (all in the digest) */
  basis: { state: "no-board"; boardId: string } | { state: "board"; boardId: string; revision: string; digest: string; boardClass: PcbSyncBoardClass; generation: number; authority: { revision: number; recordDigest: string } | null; latestRelease: { releaseId: string } | null };
  items: BoardImpactItem[];
  /** the board nets the changed items sit on */
  nets: BoardImpactNet[];
  /** every predicted Prepare PCB blocker code, sorted and unique */
  predictedCodes: string[];
  /** a structural change on protected copper: Prepare PCB will offer a NEW derived board revision (Stage 8) */
  requiresBoardRevision: boolean;
  /** the copper that revision would strip (nets whose member changes), by stable net id */
  copperStripped: { nets: string[] } & CopperCount;
  invalidates: {
    placementLegality: boolean;
    drc: boolean;
    routing: boolean;
    authority: { revision: number; recordDigest: string } | null;
    release: { releaseId: string } | null;
    stageEvidence: boolean;
  };
  digest: string;
}

/** The page's view of the impact while the batch is open: loading and unavailable keep Approve disabled (fail closed). */
export type ResolutionBoardImpactState =
  | { state: "loading" }
  | { state: "unavailable"; detail: string }
  | { state: "assessed"; impact: ResolutionBoardImpact };

const ZERO: CopperCount = Object.freeze({ tracks: 0, vias: 0, zones: 0 });

function copperOn(board: PcbBoard, netId: number): CopperCount {
  if (netId === 0) return { ...ZERO };
  return { tracks: board.tracks.filter((item) => item.netId === netId).length, vias: board.vias.filter((item) => item.netId === netId).length, zones: board.zones.filter((item) => item.netId === netId).length };
}
const copperTotal = (copper: CopperCount): number => copper.tracks + copper.vias + copper.zones;

/** The board footprint the preflight would match for this instance (by id or by its synchronization identity). */
function footprintOf(board: PcbBoard, componentInstanceId: string): FootprintInstance | null {
  return board.footprints.find((footprint) => footprint.id === componentInstanceId || footprint.syncIdentity?.componentInstanceId === componentInstanceId) ?? null;
}

/** A board net's canonical endpoint keys: as stored, or derived from the synchronized footprints' pads (board-revision.ts's rule). */
function boardNetEndpoints(board: PcbBoard, net: PcbNet): string[] {
  if (net.endpointKeys) return canonicalEndpointSet(net.endpointKeys);
  const keys: string[] = [];
  for (const footprint of board.footprints) {
    const id = footprint.syncIdentity?.componentInstanceId ?? footprint.id;
    for (const [pad, netId] of Object.entries(footprint.padNets)) {
      if (netId !== net.id) continue;
      const mapping = footprint.pinPadMappings?.find((entry) => entry.padNumbers.includes(pad));
      if (mapping) keys.push(schematicEndpointKey(id, mapping.symbolPinNumber));
    }
  }
  return canonicalEndpointSet(keys);
}

const OUTCOME_ORDER: readonly BoardImpactOutcome[] = ["footprint_changed", "pin_map_changed", "symbol_changed"];
const CHANGED: ReadonlySet<BoardImpactOutcome> = new Set(OUTCOME_ORDER);

/** Assess one batch against one basis. Pure and deterministic; `basis.state === "unavailable"` is the caller's to refuse. */
export function assessResolutionBoardImpact(input: { items: readonly BoardImpactItemInput[]; basis: Exclude<ResolutionBoardBasis, { state: "unavailable" }> }): ResolutionBoardImpact {
  const { basis } = input;
  const items = [...input.items].sort((a, b) => compareCodePoints(a.componentInstanceId, b.componentInstanceId));
  const target = (item: BoardImpactItemInput): BoardImpactItem["target"] => ({ footprintAssetVersionId: item.target.footprintAssetVersionId, mappingCertificateId: item.target.mappingCertificateId, symbolAssetVersionId: item.target.symbolAssetVersionId, footprint: item.target.footprintFullName ?? null });
  const unplaced = (item: BoardImpactItemInput): BoardImpactPinRow[] => item.mapping.map((entry) => ({ pin: entry.fromPin, toPin: entry.toPin, net: null, stableNetId: null, boardPads: [], targetPads: [...entry.pads], copper: { ...ZERO } }));

  if (basis.state === "no-board") {
    // No durable board: Prepare PCB creates one; nothing on a board is invalidated.
    const assessed = items.map((item): BoardImpactItem => ({ componentInstanceId: item.componentInstanceId, schematicRefDes: item.refDes, boardRef: null, outcome: "not-on-board", fields: [], current: null, target: target(item), pins: unplaced(item), placement: null, predicted: { operation: "add_component_instance", codes: [] }, netEffects: "none", rebind: false }));
    return seal({ schema: RESOLUTION_BOARD_IMPACT_SCHEMA, basis: { state: "no-board", boardId: basis.boardId }, items: assessed, nets: [], predictedCodes: [], requiresBoardRevision: false, copperStripped: { nets: [], ...ZERO }, invalidates: { placementLegality: false, drc: false, routing: false, authority: null, release: null, stageEvidence: false } });
  }

  const board = basis.record.board;
  const boardClass = inspectBoard(basis.boardId, basis.record).boardClass;
  const risky = riskyBoard(boardClass);
  const netById = new Map(board.nets.map((net) => [net.id, net]));

  // pass 1: per item, the identity outcome and the component operation (reconciliation.ts assessComponents, existing board, no derivation)
  const keyRenames = new Map<string, string>();
  const assessed: BoardImpactItem[] = items.map((item) => {
    const footprint = footprintOf(board, item.componentInstanceId);
    if (!footprint) {
      const operation: BoardImpactOperation = risky ? "blocked" : "add_component_instance";
      return { componentInstanceId: item.componentInstanceId, schematicRefDes: item.refDes, boardRef: null, outcome: "not-on-board", fields: [], current: null, target: target(item), pins: unplaced(item), placement: null, predicted: { operation, codes: risky ? ["PS_STRUCTURAL_ADD_REQUIRES_UNROUTED_BOARD"] : [] }, netEffects: "unassessed", rebind: false };
    }
    const identity = footprint.syncIdentity;
    const fields: SchematicIdentityField[] = identity ? syncIdentityDifferences(item.target, identity) : ["footprintAssetVersionId", "mappingCertificateId", "symbolAssetVersionId"];
    const outcome: BoardImpactOutcome = OUTCOME_ORDER.find((candidate) => fields.includes(candidate === "footprint_changed" ? "footprintAssetVersionId" : candidate === "pin_map_changed" ? "mappingCertificateId" : "symbolAssetVersionId")) ?? "unchanged";
    const assetChanged = fields.includes("footprintAssetVersionId") || fields.includes("mappingCertificateId");
    const locked = footprint.locked === true, fixed = footprint.placementConstraints?.fixedPosition === true;
    let operation: BoardImpactOperation, codes: string[] = [];
    if (assetChanged) {
      if (risky || locked || fixed) { operation = "blocked"; codes = ["PS_FOOTPRINT_REPLACEMENT_REQUIRES_STAGE8"]; }
      else operation = "replace_unrouted_footprint";
    } else operation = footprint.ref !== item.refDes ? "update_reference_designator" : "preserve_component_instance";
    for (const entry of item.mapping) keyRenames.set(schematicEndpointKey(item.componentInstanceId, entry.fromPin), schematicEndpointKey(item.componentInstanceId, entry.toPin));
    const pins = item.mapping.map((entry): BoardImpactPinRow => {
      const boardPads = [...(footprint.pinPadMappings?.find((mapping) => mapping.symbolPinNumber === entry.fromPin)?.padNumbers ?? [])].sort(compareCodePoints);
      const netId = boardPads.map((pad) => footprint.padNets[pad] ?? 0).find((id) => id !== 0) ?? 0;
      const net = netId ? netById.get(netId) ?? null : null;
      return { pin: entry.fromPin, toPin: entry.toPin, net: net?.name ?? null, stableNetId: net?.stableId ?? null, boardPads, targetPads: [...entry.pads], copper: copperOn(board, netId) };
    });
    return {
      componentInstanceId: item.componentInstanceId, schematicRefDes: item.refDes, boardRef: footprint.ref, outcome, fields,
      current: identity ? { footprintAssetVersionId: identity.footprintAssetVersionId, mappingCertificateId: identity.mappingCertificateId, symbolAssetVersionId: identity.symbolAssetVersionId } : null,
      target: target(item), pins,
      placement: { x: footprint.at.x, y: footprint.at.y, rotationDeg: footprint.rotationDeg, side: footprint.side, locked, fixed },
      predicted: { operation, codes }, netEffects: "assessed", rebind: outcome !== "unchanged",
    };
  });

  // pass 2: the board nets the items sit on - endpoint sets after the batch (the proved mapping renames current pins to target pins)
  const touched = new Map<number, Set<string>>();
  for (const item of assessed) {
    if (item.outcome === "not-on-board") continue;
    const footprint = footprintOf(board, item.componentInstanceId)!;
    for (const netId of Object.values(footprint.padNets)) if (netId !== 0) touched.set(netId, (touched.get(netId) ?? new Set()).add(item.componentInstanceId));
  }
  const nets: BoardImpactNet[] = [];
  const netCodesByComponent = new Map<string, string[]>();
  for (const [netId, members] of touched) {
    const net = netById.get(netId);
    if (!net || !net.stableId) continue;
    const before = boardNetEndpoints(board, net);
    const after = canonicalEndpointSet(before.map((key) => keyRenames.get(key) ?? key));
    const membershipChanges = after.join("\0") !== before.join("\0");
    const copper = copperOn(board, netId);
    let predictedCode: string | null = null;
    if (membershipChanges) {
      // service.ts: a stable net id absent from the new snapshot is a removed net (protected when it owns copper); reconciliation.ts: the
      // same id with another endpoint set on protected state is a routed net change. Endpoint-derived ids make the first the real case.
      if (stableNetIdForEndpoints(after, net.name) !== net.stableId) predictedCode = copperTotal(copper) > 0 ? "PS_REMOVED_NET_PROTECTED" : "PS_REMOVED_NET_RECONCILIATION_REQUIRED";
      else if (netHasProtectedState(board, netId)) predictedCode = "PS_ROUTED_NET_CHANGE_REQUIRES_STAGE8";
    }
    const changedMember = [...members].some((id) => CHANGED.has(assessed.find((item) => item.componentInstanceId === id)!.outcome));
    if (changedMember || membershipChanges) nets.push({ stableNetId: net.stableId, name: net.name, copper, membershipChanges, predictedCode });
    if (predictedCode) for (const id of members) netCodesByComponent.set(id, [...(netCodesByComponent.get(id) ?? []), predictedCode]);
  }
  nets.sort((a, b) => compareCodePoints(a.stableNetId, b.stableNetId));
  for (const item of assessed) {
    const extra = netCodesByComponent.get(item.componentInstanceId);
    if (extra) item.predicted.codes = [...new Set([...item.predicted.codes, ...extra])].sort(compareCodePoints);
    if (item.predicted.codes.length > 0) item.predicted.operation = "blocked";
  }

  const predictedCodes = [...new Set(assessed.flatMap((item) => item.predicted.codes))].sort(compareCodePoints);
  const requiresBoardRevision = predictedCodes.some((code) => STAGE8_BLOCKER_CODES.has(code));
  const anyChange = assessed.some((item) => item.outcome !== "unchanged");
  // board-revision.ts: copper survives only on nets whose every member is kept - a changed member strips the net's copper.
  const stripped = requiresBoardRevision ? nets.filter((net) => copperTotal(net.copper) > 0) : [];
  // An item not yet on the board joins nets the impact cannot name by identity: on a board with copper its routing is never claimed valid.
  const unassessedOnCopper = assessed.some((item) => item.netEffects === "unassessed") && board.tracks.length + board.vias.length + board.zones.length > 0;
  const routing = nets.some((net) => copperTotal(net.copper) > 0) || unassessedOnCopper;
  return seal({
    schema: RESOLUTION_BOARD_IMPACT_SCHEMA,
    basis: { state: "board", boardId: basis.boardId, revision: basis.record.revision, digest: basis.record.digest, boardClass, generation: pcbBoardLineageOf(basis.boardId).generation, authority: basis.authority ? { revision: basis.authority.revision, recordDigest: basis.authority.recordDigest } : null, latestRelease: basis.latestRelease ? { releaseId: basis.latestRelease.releaseId } : null },
    items: assessed, nets, predictedCodes, requiresBoardRevision,
    copperStripped: { nets: stripped.map((net) => net.stableNetId), tracks: stripped.reduce((sum, net) => sum + net.copper.tracks, 0), vias: stripped.reduce((sum, net) => sum + net.copper.vias, 0), zones: stripped.reduce((sum, net) => sum + net.copper.zones, 0) },
    invalidates: {
      placementLegality: anyChange, drc: anyChange, routing: anyChange && routing,
      authority: anyChange && basis.authority ? { revision: basis.authority.revision, recordDigest: basis.authority.recordDigest } : null,
      release: anyChange && basis.latestRelease ? { releaseId: basis.latestRelease.releaseId } : null,
      stageEvidence: anyChange,
    },
  });
}

function seal(content: Omit<ResolutionBoardImpact, "digest">): ResolutionBoardImpact {
  return { ...content, digest: engineeringDigest({ schema: RESOLUTION_BOARD_IMPACT_SCHEMA, content }) };
}

// ─── the bounded summary the receipt carries ─────────────────────────────────────────────────────────────────────────────

export const BOARD_IMPACT_SUMMARY_MAX_ITEMS = 20;
export const BOARD_IMPACT_SUMMARY_MAX_CODES = 6;
export const BOARD_IMPACT_SUMMARY_MAX_TEXT = 128;

export interface ResolutionBoardImpactSummaryItem {
  componentInstanceId: string;
  schematicRefDes: string;
  boardRef: string | null;
  outcome: BoardImpactOutcome;
  operation: BoardImpactOperation;
  codes: string[];
  affectedNets: number;
  copper: CopperCount;
  rebind: boolean;
}

/** The receipt's disclosure: the assessed summary, `not-recorded` (a receipt reconstructed after a crash: the reviewed impact was not
 *  journaled) or `not-assessed` (no impact was supplied). */
export type ResolutionReceiptBoardImpact =
  | { state: "not-assessed" }
  | { state: "not-recorded" }
  | {
      state: "assessed";
      schema: typeof RESOLUTION_BOARD_IMPACT_SUMMARY_SCHEMA;
      digest: string;
      basis: { kind: "no-board"; boardId: string } | { kind: "board"; boardId: string; revision: string; boardClass: string };
      requiresBoardRevision: boolean;
      predictedCodes: string[];
      items: ResolutionBoardImpactSummaryItem[];
      truncatedItems: number;
      copperStripped: CopperCount;
      invalidates: { placementLegality: boolean; drc: boolean; routing: boolean; authorityRevision: number | null; releaseId: string | null; stageEvidence: boolean };
    };

const cap = (text: string): string => text.slice(0, BOARD_IMPACT_SUMMARY_MAX_TEXT);

/** The bounded summary (at most 20 items, 6 codes each, strings capped at 128 characters) - small enough for the journal's document bound. */
export function resolutionBoardImpactSummary(impact: ResolutionBoardImpact): ResolutionReceiptBoardImpact {
  const affected = (item: BoardImpactItem): BoardImpactPinRow[] => item.pins.filter((row) => row.stableNetId !== null);
  return {
    state: "assessed",
    schema: RESOLUTION_BOARD_IMPACT_SUMMARY_SCHEMA,
    digest: cap(impact.digest),
    basis: impact.basis.state === "no-board" ? { kind: "no-board", boardId: cap(impact.basis.boardId) } : { kind: "board", boardId: cap(impact.basis.boardId), revision: cap(impact.basis.revision), boardClass: cap(impact.basis.boardClass) },
    requiresBoardRevision: impact.requiresBoardRevision,
    predictedCodes: impact.predictedCodes.slice(0, BOARD_IMPACT_SUMMARY_MAX_CODES).map(cap),
    items: impact.items.slice(0, BOARD_IMPACT_SUMMARY_MAX_ITEMS).map((item) => ({
      componentInstanceId: cap(item.componentInstanceId), schematicRefDes: cap(item.schematicRefDes), boardRef: item.boardRef === null ? null : cap(item.boardRef),
      outcome: item.outcome, operation: item.predicted.operation, codes: item.predicted.codes.slice(0, BOARD_IMPACT_SUMMARY_MAX_CODES).map(cap),
      affectedNets: new Set(affected(item).map((row) => row.stableNetId)).size,
      copper: [...new Map(affected(item).map((row) => [row.stableNetId, row.copper])).values()].reduce((sum, copper) => ({ tracks: sum.tracks + copper.tracks, vias: sum.vias + copper.vias, zones: sum.zones + copper.zones }), { ...ZERO }),
      rebind: item.rebind,
    })),
    truncatedItems: Math.max(0, impact.items.length - BOARD_IMPACT_SUMMARY_MAX_ITEMS),
    copperStripped: { tracks: impact.copperStripped.tracks, vias: impact.copperStripped.vias, zones: impact.copperStripped.zones },
    invalidates: { placementLegality: impact.invalidates.placementLegality, drc: impact.invalidates.drc, routing: impact.invalidates.routing, authorityRevision: impact.invalidates.authority?.revision ?? null, releaseId: impact.invalidates.release ? cap(impact.invalidates.release.releaseId) : null, stageEvidence: impact.invalidates.stageEvidence },
  };
}

// ─── the sentences (dialog, run log, receipt) ────────────────────────────────────────────────────────────────────────────

const OUTCOME_WORDS: Readonly<Record<BoardImpactOutcome, string>> = Object.freeze({
  "not-on-board": "not on the board",
  unchanged: "on the board with this exact identity (unchanged)",
  footprint_changed: "footprint changes",
  pin_map_changed: "pin-pad mapping changes",
  symbol_changed: "symbol changes",
});
export function boardImpactOutcomeWords(outcome: BoardImpactOutcome): string { return OUTCOME_WORDS[outcome]; }

/** One or two plain sentences: what the next Prepare PCB will do to the board and what goes stale (never a claim of an applied change). */
export function boardImpactSentences(summary: ResolutionReceiptBoardImpact): string[] {
  if (summary.state === "not-assessed") return ["PCB impact: not assessed for this batch."];
  if (summary.state === "not-recorded") return ["PCB impact: not recorded (this receipt was reconstructed after an interrupted commit); the PCB tab derives the board's state from the board itself."];
  if (summary.basis.kind === "no-board") return ["PCB impact: no PCB exists for this project yet; Prepare PCB creates the board from the new revision."];
  const changed = summary.items.filter((item) => item.outcome !== "unchanged" && item.outcome !== "not-on-board");
  const absent = summary.items.filter((item) => item.outcome === "not-on-board");
  if (changed.length === 0 && absent.length === 0) return [`PCB impact: board ${summary.basis.boardId} (revision ${summary.basis.revision.slice(0, 16)}…) already carries these exact parts; nothing on it goes stale.`];
  const parts = [
    ...changed.map((item) => `${item.schematicRefDes}: ${OUTCOME_WORDS[item.outcome]} (${item.operation === "blocked" ? `Prepare PCB is blocked: ${item.codes.join(", ")}` : item.operation.replace(/_/g, " ")})`),
    ...absent.map((item) => `${item.schematicRefDes}: ${OUTCOME_WORDS[item.outcome]} (${item.operation === "blocked" ? `Prepare PCB is blocked: ${item.codes.join(", ")}` : "added at Prepare PCB"})`),
  ];
  const stale = [summary.invalidates.placementLegality ? "placement legality" : null, summary.invalidates.drc ? "DRC" : null, summary.invalidates.routing ? "routing" : null, summary.invalidates.authorityRevision !== null ? `qualification authority r${summary.invalidates.authorityRevision}` : null, summary.invalidates.releaseId ? `release ${summary.invalidates.releaseId.slice(0, 24)}` : null, summary.invalidates.stageEvidence ? "stage evidence" : null].filter((entry): entry is string => entry !== null);
  return [
    `PCB impact on board ${summary.basis.boardId} (revision ${summary.basis.revision.slice(0, 16)}…): ${parts.join("; ")}.${summary.requiresBoardRevision ? ` A new derived board revision is required (copper stripped: ${summary.copperStripped.tracks} track(s), ${summary.copperStripped.vias} via(s), ${summary.copperStripped.zones} zone(s)).` : ""}`,
    `Goes stale until Prepare PCB re-runs: ${stale.join(", ") || "nothing"}.`,
    ...(summary.items.some((item) => item.rebind) ? [`Re-binding needed for ${summary.items.filter((item) => item.rebind).map((item) => item.schematicRefDes).join(", ")}: the board carries them under another published revision; a reviewer must bind the new one, and that bind is refused while the earlier binding is in effect (${REBIND_CONFLICT_CODE}) - until then the board stays behind the schematic and qualification and release stay refused; Undo restores the bound part.`] : []),
  ];
}
