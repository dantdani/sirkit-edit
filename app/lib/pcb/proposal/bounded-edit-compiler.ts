/**
 * B15 §B — the ONE shared compiler for bounded PCB edit proposals.
 *
 * Both the proposal path (server/tool invocation) and the apply path
 * (post-approval revalidation) call THIS function. There is no second
 * mutation implementation: the compiler produces an ISOLATED CANDIDATE
 * board and hands it to the existing canonical B08 layer —
 * `compilePcbBoardDelta` decides what is canonically expressible (it throws
 * `PcbDeltaUnsupportedError` otherwise) and, at apply time,
 * `commitPcbCandidate` compiles the very same candidate into the canonical
 * operations of ONE transaction.
 *
 * Order (fail-closed at every step, nothing mutates the input board):
 *   1. validate the semantic operations (bounded-edit-operations.ts);
 *   2. resolve every referenced existing object / net / layer / padstack;
 *   3. mint deterministic ids for additions from the sealed base identity
 *      plus the operation index — the provider never names a new object;
 *   4. apply to an isolated structuredClone candidate;
 *   5. compile the candidate through the canonical delta layer;
 *   6. validate the resulting board (structural + DRC + connectivity);
 *   7. compute the deterministic before/after impact report.
 *
 * Refusals: stale/missing objects, invalid layer/net/padstack, locked or
 * protected objects, escaping the board outline, new DRC errors, new
 * shorts, worsened connectivity, weakened enforced minima, unsupported
 * canonical expression, and no-effective-change.
 */

import { computeConnectivity } from "../connectivity-board";
import { courtyardFitsOutline, localCourtyardBBox, worldCourtyardBBox } from "../autoplace/geometry";
import { pointInExactOutline, segmentInExactOutline, validateSimplePolygon, type ExactOutline, type IntPoint } from "../geometry-exact";
import { dimensionGeometry } from "../dimensions/geometry";
import { copperItemId } from "../connectivity-board";
import { applyRuleDeltas, getNetClass } from "../netclass";
import { getPadstack } from "../padstack/registry";
import { applyPadstackToVia } from "../padstack/defaults";
import { validatePcbBoardStructure } from "../../engineering/pcb-board-structure";
import { compilePcbBoardDelta, PcbDeltaUnsupportedError } from "../../engineering/pcb-delta";
import { engineeringDigest } from "../../engineering/stable";
import { runDrc } from "../drc/run-drc";
import type { DrcResult, DrcRules, DrcViolation } from "../drc/types";
import { pcbRevisionId } from "../revision";
import { DIMENSION_LAYERS, type BoardDimension, type PcbBoard, type RoutingKeepout, type Track, type Via } from "../types";

import {
  BOUNDED_EDIT_LIMITS,
  parseBoundedEditRequest,
  type BoundedEditRefusal,
  type BoundedEditRequest,
  type BoundedPcbEditOperation,
} from "./bounded-edit-operations";

export const BOUNDED_EDIT_COMPILE_SCHEMA = "sirkit.pcb-bounded-edit-compile.v1" as const;

/**
 * [B15.2.3] PRODUCER-derived ceilings for the impact certificate, exported
 * from the module that PRODUCES the impact so the verifier can never invent
 * its own contract. Derivations (from this file's actual code paths):
 *
 * - `maxArrayEntries`: the largest impact array a genuine compile can emit is
 *   `ruleChanges` — one line per (net, requested field) for a
 *   `set_net_class_rule` operation: `maxOperations` ops × `maxArrayLength`
 *   net ids × 4 rule fields (trackWidth/clearance/viaSize/viaDrill) = 4096.
 *   Every other impact array is far below this (changedObjectIds and
 *   operationSummaries add exactly one entry per operation, ≤ 16).
 * - `maxTextLength`: the longest genuine impact string is a
 *   `set_net_class_rule` operation summary, which joins up to
 *   `maxArrayLength` net ids (≈ 620 chars worst case); DRC violation ids are
 *   `drc_` + 8 hex; the readiness reason is a fixed sentence. 1024 bounds
 *   them all with headroom and still refuses unbounded hostile strings.
 */
export const BOUNDED_EDIT_IMPACT_LIMITS = {
  maxArrayEntries: BOUNDED_EDIT_LIMITS.maxOperations * BOUNDED_EDIT_LIMITS.maxArrayLength * 4,
  maxTextLength: 1_024,
} as const;

export interface BoundedEditImpactReport {
  schema: typeof BOUNDED_EDIT_COMPILE_SCHEMA;
  /** Every board object id the candidate adds or changes. */
  changedObjectIds: readonly string[];
  /** One human-readable line per operation, in submitted order. */
  operationSummaries: readonly string[];
  drc: {
    beforeErrors: number; afterErrors: number;
    beforeWarnings: number; afterWarnings: number;
    newViolationIds: readonly string[];
    resolvedViolationIds: readonly string[];
  };
  connectivity: {
    beforeRoutedNets: number; afterRoutedNets: number;
    beforeTotalNets: number; afterTotalNets: number;
    beforeUnrouted: number; afterUnrouted: number;
    beforeShorts: number; afterShorts: number;
  };
  /** [B15.1 §F] ROUTING COMPLETION — explicitly NOT fabrication readiness. */
  routingCompletion: { beforePercent: number; afterPercent: number; delta: number };
  /** Authoritative fabrication readiness is only computed at proposal
   *  assembly with pinned fab/DRC presets and proven netlist resources; the
   *  compiler alone cannot prove it, so it reports `unavailable`. */
  readiness: { state: "unavailable"; reason: string };
  ruleChanges: readonly string[];
  affectedNetIds: readonly number[];
  affectedLayers: readonly string[];
  candidateBoardDigest: string;
  warnings: readonly string[];
}

export type BoundedEditCompileRefusalCode =
  | BoundedEditRefusal["code"]
  | "unknown-object"
  | "locked-object"
  | "invalid-layer"
  | "invalid-net"
  | "invalid-padstack"
  | "escapes-board"
  | "drc-regression"
  | "connectivity-regression"
  | "new-short"
  | "weakened-minimum"
  | "not-canonical"
  | "invalid-geometry"
  | "structural-invalid"
  | "padstack-conflict"
  | "padstack-bound"
  | "no-effective-change";

export type BoundedEditCompileResult =
  | {
      ok: true;
      request: BoundedEditRequest;
      /** The isolated candidate — never the caller's board. */
      candidate: PcbBoard;
      impact: BoundedEditImpactReport;
      normalizedOperationsDigest: string;
      impactDigest: string;
      candidateDigest: string;
      mintedObjectIds: readonly string[];
    }
  | { ok: false; code: BoundedEditCompileRefusalCode; detail: string };

export interface BoundedEditCompileInput {
  board: PcbBoard;
  rules: DrcRules;
  /**
   * [B15.2 §G/R16] OPTIONAL and non-authoritative. The base identity is
   * DERIVED internally as `pcbRevisionId(board)`; if a caller supplies one it
   * must match exactly, or the compile refuses. Minted ids therefore can
   * never be steered by a caller-chosen value.
   */
  baseIdentity?: string;
  payload: unknown;
}

const NORMALIZED_OPS_DIGEST_SCHEMA = "sirkit.pcb-bounded-edit-operations.v1";
const IMPACT_DIGEST_SCHEMA = "sirkit.pcb-bounded-edit-impact.v1";

function refuse(code: BoundedEditCompileRefusalCode, detail: string): BoundedEditCompileResult {
  return { ok: false, code, detail };
}

/** Deterministic id for a NEW object: base identity + kind + operation index. */
export function mintObjectId(baseIdentity: string, kind: string, index: number): string {
  const digest = engineeringDigest({ schema: "sirkit.pcb-bounded-edit-id.v1", baseIdentity, kind, index });
  return `b15-${kind}-${digest.slice(5, 21)}`;
}

function boardLayers(board: PcbBoard): Set<string> {
  const layers = new Set<string>(["copperTop", "copperBottom"]);
  for (const track of board.tracks) layers.add(track.layer);
  for (const via of board.vias) for (const layer of via.layers) layers.add(layer);
  for (const zone of board.zones) layers.add(zone.layer);
  if (board.stackup === 4) { layers.add("copperInner1"); layers.add("copperInner2"); }
  return layers;
}

/**
 * [B15.2.1 §A] EXACT containment. The board outline is converted to an
 * integer polygon by the SHARED `outlinePolygon` authority (chords inscribed
 * in roundrect arcs, so containment is conservative), and point/segment
 * containment is decided by the EXACT BigInt predicates in `geometry-exact`.
 * No finite sampling is used anywhere, so an arbitrarily narrow concavity
 * cannot be stepped over.
 */
/**
 * [B15.2.2 §A/R22] The board outline goes to the EXACT authority as-is —
 * rect/roundrect/polygon. B15.2.1 polygonised the outline with ROUNDED chord
 * vertices, which can bulge outside a true arc and accepted a genuinely
 * off-board point. No chords, no trigonometry, no rounding of the outline.
 */
function exactOutline(board: PcbBoard): ExactOutline {
  return board.outline as ExactOutline;
}

function withinBoard(board: PcbBoard, point: { x: number; y: number }): boolean {
  return pointInExactOutline({ x: Math.round(point.x), y: Math.round(point.y) }, exactOutline(board));
}

function segmentInsideOutline(board: PcbBoard, a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return segmentInExactOutline(
    { x: Math.round(a.x), y: Math.round(a.y) },
    { x: Math.round(b.x), y: Math.round(b.y) },
    exactOutline(board),
  );
}

/**
 * [B15.1 §B] Keepout polygon geometry the structural validator does not
 * cover: at least three DISTINCT vertices, nonzero area, no self-
 * intersections, and every vertex inside the ACTUAL outline.
 */
function keepoutGeometryRefusal(
  board: PcbBoard, polygon: ReadonlyArray<{ x: number; y: number }>, label: string,
): BoundedEditCompileResult | null {
  // [B15.2.1 §A] exact simple-polygon validity: ≥3 distinct vertices, no
  // repeated vertex or zero edge, nonzero area, and NO proper
  // self-intersection, non-adjacent touch, endpoint-on-interior contact, or
  // collinear overlap/retrace.
  const validity = validateSimplePolygon(polygon.map((vertex) => ({ x: Math.round(vertex.x), y: Math.round(vertex.y) })));
  if (!validity.ok) return refuse("invalid-geometry", `${label} is not a simple polygon (${validity.reason}).`);
  // Every edge must stay strictly inside the exact outline — narrow notches
  // included.
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index]!;
    const b = polygon[(index + 1) % polygon.length]!;
    if (!segmentInsideOutline(board, a, b)) {
      return refuse("escapes-board", `${label} has an edge that leaves the board outline.`);
    }
  }
  return null;
}

/**
 * [B15.2 §B/R11] The RENDERED dimension geometry — extension lines, the
 * dimension line, arrowheads, and the label polyline — must stay on the
 * board, not merely its measurement endpoints. Uses the shared
 * `dimensionGeometry` authority.
 */
function dimensionRenderRefusal(board: PcbBoard, dimension: BoardDimension, label: string): BoundedEditCompileResult | null {
  let geometry;
  try {
    geometry = dimensionGeometry(dimension);
  } catch {
    return refuse("invalid-geometry", `${label} could not be rendered as documentation geometry.`);
  }
  const polylines: Array<Array<{ x: number; y: number }>> = [];
  const collect = (value: unknown): void => {
    if (!value) return;
    if (Array.isArray(value)) {
      if (value.length > 0 && typeof (value[0] as { x?: unknown })?.x === "number") {
        polylines.push(value as Array<{ x: number; y: number }>);
      } else {
        for (const entry of value) collect(entry);
      }
      return;
    }
    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (typeof record.x === "number" && typeof record.y === "number") {
        polylines.push([record as { x: number; y: number }]);
        return;
      }
      for (const child of Object.values(record)) collect(child);
    }
  };
  collect(geometry);
  for (const polyline of polylines) {
    for (const point of polyline) {
      if (!withinBoard(board, point)) {
        return refuse("escapes-board", `${label} renders documentation geometry outside the board outline.`);
      }
    }
    for (let index = 0; index + 1 < polyline.length; index += 1) {
      if (!segmentInsideOutline(board, polyline[index]!, polyline[index + 1]!)) {
        return refuse("escapes-board", `${label} renders documentation geometry outside the board outline.`);
      }
    }
  }
  return null;
}

/** Build the effective candidate dimension for a partial update, so the
 *  rendered geometry validated is EXACTLY what the update produces. */
function mergeDimensionUpdate(existing: BoardDimension, operation: { a?: IntPoint; b?: IntPoint; offsetNm?: number; precision?: 0 | 1 | 2 | 3 | 4 }): BoardDimension {
  return {
    ...existing,
    ...(operation.a ? { a: { ...operation.a } } : {}),
    ...(operation.b ? { b: { ...operation.b } } : {}),
    ...(operation.offsetNm !== undefined ? { offsetNm: operation.offsetNm } : {}),
    ...(operation.precision !== undefined ? { precision: operation.precision } : {}),
  } as BoardDimension;
}

/** [B15.1 §B] the SHARED documentation-layer authority — imported, never
 *  duplicated (`app/lib/pcb/types.ts`). The whole-board structural
 *  validator enforces the same set. */
const DIMENSION_LAYER_SET = new Set<string>(DIMENSION_LAYERS);

function errorCount(result: DrcResult): number {
  return result.violations.filter((violation) => violation.severity === "error").length;
}
function warningCount(result: DrcResult): number {
  return result.violations.filter((violation) => violation.severity === "warning").length;
}
function violationIds(result: DrcResult): Set<string> {
  return new Set(result.violations.filter((v: DrcViolation) => v.severity === "error").map((v) => v.id));
}

/**
 * [B15.1 §E] STABLE identity for a copper-pair contact — order-independent
 * so the same physical pair always yields the same key. Count-only
 * comparison let one short be swapped for a different one at equal totals.
 */
function pairKey(pair: readonly [unknown, unknown]): string {
  // [B15.2 §F/R15] the SHARED canonical identity. The previous local
  // expression read `footprintId`/`id` only, so every pad numbered "1"
  // collapsed to one key and ALL zone regions collapsed to another.
  const identify = (item: unknown): string => {
    try {
      return copperItemId(item as Parameters<typeof copperItemId>[0]);
    } catch {
      return "unidentifiable";
    }
  };
  return [identify(pair[0]), identify(pair[1])].sort().join("~");
}

function pairKeys(pairs: ReadonlyArray<readonly [unknown, unknown]>): Set<string> {
  return new Set(pairs.map(pairKey));
}

/** Per-net completion state, keyed by net id — a different net's improvement
 *  can never hide a regression. */
function completionByNet(connectivity: { nets: Map<number, { complete?: boolean; routed?: boolean }> }): Map<number, boolean> {
  const states = new Map<number, boolean>();
  for (const [netId, net] of connectivity.nets) {
    const record = net as unknown as Record<string, unknown>;
    const complete = typeof record.complete === "boolean" ? record.complete
      : typeof record.routed === "boolean" ? record.routed
      : Boolean(record.isComplete);
    states.set(netId, complete);
  }
  return states;
}

/**
 * THE shared compile path. Pure with respect to `input.board` — the caller's
 * board is never mutated (the candidate is a structuredClone).
 */
export function compileBoundedPcbEdit(input: BoundedEditCompileInput): BoundedEditCompileResult {
  const derivedBaseIdentity = pcbRevisionId(input.board);
  if (input.baseIdentity !== undefined && input.baseIdentity !== derivedBaseIdentity) {
    return refuse("invalid-value", "The supplied base identity does not match this board's revision.");
  }
  const parsed = parseBoundedEditRequest(input.payload);
  if (!parsed.ok) return refuse(parsed.refusal.code, parsed.refusal.detail);
  const request = parsed.request;

  const board = input.board;
  const layers = boardLayers(board);
  const netIds = new Set(board.nets.map((net) => net.id));
  const padstackIds = new Set((board.padstacks ?? []).map((padstack) => padstack.id));
  const footprintsById = new Map(board.footprints.map((item) => [item.id, item]));
  const tracksById = new Map(board.tracks.map((item) => [item.id, item]));
  const viasById = new Map(board.vias.map((item) => [item.id, item]));
  const dimensionsById = new Map((board.dimensions ?? []).map((item) => [item.id, item]));
  const keepoutsById = new Map((board.routingKeepouts ?? []).map((item) => [item.id, item]));

  // ── 2/3. Resolve + mint, then 4. apply to an ISOLATED candidate. ──────────
  const candidate = structuredClone(board) as PcbBoard;
  const changedObjectIds = new Set<string>();
  const mintedObjectIds: string[] = [];
  const affectedNetIds = new Set<number>();
  const affectedLayers = new Set<string>();
  const operationSummaries: string[] = [];
  const ruleChanges: string[] = [];
  const warnings: string[] = [];

  for (const [index, operation] of request.operations.entries()) {
    const bad = applyOperation(operation, index, {
      candidate, board, layers, netIds, padstackIds,
      footprintsById, tracksById, viasById, dimensionsById, keepoutsById,
      baseIdentity: derivedBaseIdentity,
      rules: input.rules,
      changedObjectIds, mintedObjectIds, affectedNetIds, affectedLayers,
      operationSummaries, ruleChanges,
    });
    if (bad) return bad;
  }

  // ── 5. Canonical expressibility: the B08 delta layer is the authority. ────
  let canonicalOperationCount = 0;
  try {
    canonicalOperationCount = compilePcbBoardDelta(board, candidate, "b15").operations.length;
  } catch (error) {
    if (error instanceof PcbDeltaUnsupportedError) {
      return refuse("not-canonical", `These operations cannot be expressed as canonical PCB operations: ${error.reasons.join("; ")}`);
    }
    return refuse("not-canonical", error instanceof Error ? error.message : String(error));
  }
  if (canonicalOperationCount === 0) {
    return refuse("no-effective-change", "The proposal would not change the board.");
  }

  // ── 6a. [B15.1 §B] the SHARED whole-board structural authority. No
  //        dimension-layer or board-structure definition is duplicated here.
  const structural = validatePcbBoardStructure(candidate);
  if (structural.length > 0) {
    return refuse("structural-invalid", `The resulting board fails structural validation: ${structural.slice(0, 3).join("; ")}`);
  }

  // ── 6b. Validate the resulting board: DRC + connectivity. ─────────────────
  const drcBefore = runDrc(board, input.rules);
  const drcAfter = runDrc(candidate, input.rules);
  const beforeErrorIds = violationIds(drcBefore);
  const afterErrorIds = violationIds(drcAfter);
  const newViolationIds = [...afterErrorIds].filter((id) => !beforeErrorIds.has(id)).sort();
  const resolvedViolationIds = [...beforeErrorIds].filter((id) => !afterErrorIds.has(id)).sort();
  if (newViolationIds.length > 0) {
    return refuse("drc-regression", `The proposal would introduce ${newViolationIds.length} new DRC error(s).`);
  }

  const connectivityBefore = computeConnectivity(board);
  const connectivityAfter = computeConnectivity(candidate);

  // [B15.1 §E] IDENTITY comparison, not counts. Equal totals previously hid
  // one short being swapped for a different one, one unknown contact for
  // another, and one net losing completion while another gained it.
  const shortsBefore = pairKeys(connectivityBefore.shorts);
  const shortsAfter = pairKeys(connectivityAfter.shorts);
  const newShorts = [...shortsAfter].filter((key) => !shortsBefore.has(key));
  if (newShorts.length > 0) {
    return refuse("new-short", `The proposal would introduce ${newShorts.length} short circuit(s) that do not exist today.`);
  }
  // An UNPROVEN contact (the connectivity engine cannot establish same/
  // different ownership from stable identities) is treated exactly like a
  // short: a bounded proposal must never introduce copper whose electrical
  // separation Sirkit cannot demonstrate.
  const unknownBefore = pairKeys(connectivityBefore.unknownContacts);
  const unknownAfter = pairKeys(connectivityAfter.unknownContacts);
  const newUnknown = [...unknownAfter].filter((key) => !unknownBefore.has(key));
  if (newUnknown.length > 0) {
    return refuse("new-short", `The proposal would introduce ${newUnknown.length} copper contact(s) whose net separation cannot be proven.`);
  }
  // EVERY net complete before must remain complete after — a different net's
  // improvement can never mask a regression.
  const completionBefore = completionByNet(connectivityBefore);
  const completionAfter = completionByNet(connectivityAfter);
  for (const [netId, wasComplete] of completionBefore) {
    if (wasComplete && completionAfter.get(netId) === false) {
      return refuse("connectivity-regression", `The proposal would leave net ${netId} incomplete, which is complete today.`);
    }
  }
  if (connectivityAfter.completion.routedNets < connectivityBefore.completion.routedNets) {
    return refuse("connectivity-regression", "The proposal would leave previously routed nets unrouted.");
  }

  const beforeUnrouted = connectivityBefore.completion.totalNets - connectivityBefore.completion.routedNets;
  const afterUnrouted = connectivityAfter.completion.totalNets - connectivityAfter.completion.routedNets;
  const candidateDigest = pcbRevisionId(candidate);

  const impact: BoundedEditImpactReport = {
    schema: BOUNDED_EDIT_COMPILE_SCHEMA,
    changedObjectIds: [...changedObjectIds].sort(),
    operationSummaries,
    drc: {
      beforeErrors: errorCount(drcBefore), afterErrors: errorCount(drcAfter),
      beforeWarnings: warningCount(drcBefore), afterWarnings: warningCount(drcAfter),
      newViolationIds, resolvedViolationIds,
    },
    connectivity: {
      beforeRoutedNets: connectivityBefore.completion.routedNets,
      afterRoutedNets: connectivityAfter.completion.routedNets,
      beforeTotalNets: connectivityBefore.completion.totalNets,
      afterTotalNets: connectivityAfter.completion.totalNets,
      beforeUnrouted, afterUnrouted,
      beforeShorts: connectivityBefore.shorts.length,
      afterShorts: connectivityAfter.shorts.length,
    },
    routingCompletion: {
      beforePercent: connectivityBefore.completion.percent,
      afterPercent: connectivityAfter.completion.percent,
      delta: connectivityAfter.completion.percent - connectivityBefore.completion.percent,
    },
    readiness: {
      state: "unavailable",
      reason: "Fabrication readiness requires the pinned fab preset, DRC preset, and proven netlist resources, which the compiler does not consume.",
    },
    ruleChanges,
    affectedNetIds: [...affectedNetIds].sort((a, b) => a - b),
    affectedLayers: [...affectedLayers].sort(),
    candidateBoardDigest: candidateDigest,
    warnings,
  };

  return {
    ok: true,
    request,
    candidate,
    impact,
    normalizedOperationsDigest: engineeringDigest({ schema: NORMALIZED_OPS_DIGEST_SCHEMA, base: derivedBaseIdentity, operations: request.operations }),
    impactDigest: engineeringDigest({ schema: IMPACT_DIGEST_SCHEMA, impact }),
    candidateDigest,
    mintedObjectIds,
  };
}

interface ApplyContext {
  candidate: PcbBoard;
  board: PcbBoard;
  layers: Set<string>;
  netIds: Set<number>;
  padstackIds: Set<string>;
  footprintsById: Map<string, PcbBoard["footprints"][number]>;
  tracksById: Map<string, Track>;
  viasById: Map<string, Via>;
  dimensionsById: Map<string, BoardDimension>;
  keepoutsById: Map<string, RoutingKeepout>;
  baseIdentity: string;
  rules: DrcRules;
  changedObjectIds: Set<string>;
  mintedObjectIds: string[];
  affectedNetIds: Set<number>;
  affectedLayers: Set<string>;
  operationSummaries: string[];
  ruleChanges: string[];
}

/** [B18-E E12] nanometres as the millimetres the review shows the human — the same three decimals the move/track summaries use. */
const mmText = (nm: number): string => (nm / 1e6).toFixed(3);

function applyOperation(
  operation: BoundedPcbEditOperation,
  index: number,
  context: ApplyContext,
): BoundedEditCompileResult | null {
  const label = `Operation ${index + 1}`;
  switch (operation.kind) {
    case "move_footprint":
    case "rotate_footprint": {
      const existing = context.footprintsById.get(operation.footprintId);
      if (!existing) return refuse("unknown-object", `${label} references a footprint that is not on this board (${operation.footprintId}).`);
      if ((existing as { locked?: boolean }).locked) return refuse("locked-object", `${label} targets a locked footprint (${operation.footprintId}).`);
      // [B15.2.1 §B/R17] the REAL production property is `placementConstraints`.
      const constraints = (existing as { placementConstraints?: { fixedPosition?: boolean; mechanical?: boolean; edgeConnector?: string; allowedRotations?: readonly number[] } }).placementConstraints;
      const mirrorX = existing.side === "bottom";
      const localBox = existing.def ? localCourtyardBBox(existing.def) : null;
      const envelopeRefusal = (at: { x: number; y: number }, rotationDeg: number): BoundedEditCompileResult | null => {
        if (!localBox) return null;
        const world = worldCourtyardBBox(localBox, at, rotationDeg, mirrorX);
        return courtyardFitsOutline(world, context.board.outline)
          ? null
          : refuse("escapes-board", `${label} would place part of the footprint outside the board outline.`);
      };
      const target = context.candidate.footprints.find((item) => item.id === operation.footprintId)!;
      if (operation.kind === "move_footprint") {
        if (constraints?.fixedPosition) return refuse("locked-object", `${label} targets a fixed-position footprint (${operation.footprintId}).`);
        if (constraints?.mechanical) return refuse("locked-object", `${label} targets a mechanical footprint (${operation.footprintId}).`);
        if (constraints?.edgeConnector) return refuse("locked-object", `${label} targets an edge-connector footprint bound to the ${constraints.edgeConnector} edge (${operation.footprintId}).`);
        if (!withinBoard(context.board, operation.to)) return refuse("escapes-board", `${label} would move the footprint outside the board outline.`);
        // The COMPLETE transformed courtyard envelope must fit the exact
        // outline at the NEW position and the footprint's current rotation.
        const bad = envelopeRefusal(operation.to, existing.rotationDeg);
        if (bad) return bad;
        target.at = { x: operation.to.x, y: operation.to.y };
        context.operationSummaries.push(`Move ${existing.ref} to (${(operation.to.x / 1e6).toFixed(3)}, ${(operation.to.y / 1e6).toFixed(3)}) mm`);
      } else {
        if (constraints?.fixedPosition) return refuse("locked-object", `${label} targets a fixed-position footprint (${operation.footprintId}).`);
        if (constraints?.mechanical) return refuse("locked-object", `${label} targets a mechanical footprint (${operation.footprintId}).`);
        if (constraints?.allowedRotations && !constraints.allowedRotations.includes(operation.rotationDeg as 0 | 90 | 180 | 270)) {
          return refuse("locked-object", `${label} requests ${operation.rotationDeg}°, which is not among this footprint's allowed rotations (${constraints.allowedRotations.join(", ")}).`);
        }
        // The rotated courtyard envelope must fit the exact outline too.
        const bad = envelopeRefusal(existing.at, operation.rotationDeg);
        if (bad) return bad;
        target.rotationDeg = operation.rotationDeg;
        context.operationSummaries.push(`Rotate ${existing.ref} to ${operation.rotationDeg}°`);
      }
      context.changedObjectIds.add(operation.footprintId);
      for (const netId of Object.values(existing.padNets)) if (netId > 0) context.affectedNetIds.add(netId);
      return null;
    }
    case "add_track": {
      if (!context.layers.has(operation.layer)) return refuse("invalid-layer", `${label} names a layer this board does not have (${operation.layer}).`);
      if (!context.netIds.has(operation.netId)) return refuse("invalid-net", `${label} names a net this board does not have (${operation.netId}).`);
      if (operation.start.x === operation.end.x && operation.start.y === operation.end.y) {
        return refuse("invalid-geometry", `${label} is a zero-length track.`);
      }
      if (!withinBoard(context.board, operation.start) || !withinBoard(context.board, operation.end)) {
        return refuse("escapes-board", `${label} would place copper outside the board outline.`);
      }
      const trackMinima = fabricationMinimaRefusal(context.rules, { trackWidthNm: operation.widthNm, netIds: [operation.netId], board: context.board }, label);
      if (trackMinima) return trackMinima;
      const id = mintObjectId(context.baseIdentity, "track", index);
      context.candidate.tracks.push({
        id, layer: operation.layer as Track["layer"], width: operation.widthNm,
        start: { ...operation.start }, end: { ...operation.end }, netId: operation.netId, source: "ai",
      });
      context.mintedObjectIds.push(id);
      context.changedObjectIds.add(id);
      context.affectedNetIds.add(operation.netId);
      context.affectedLayers.add(operation.layer);
      context.operationSummaries.push(`Add ${(operation.widthNm / 1e6).toFixed(3)} mm track on ${operation.layer} (net ${operation.netId})`);
      return null;
    }
    case "update_track": {
      const existing = context.tracksById.get(operation.trackId);
      if (!existing) return refuse("unknown-object", `${label} references a track that is not on this board (${operation.trackId}).`);
      if (existing.locked) return refuse("locked-object", `${label} targets a locked track (${operation.trackId}).`);
      const target = context.candidate.tracks.find((item) => item.id === operation.trackId)!;
      if (operation.start) {
        if (!withinBoard(context.board, operation.start)) return refuse("escapes-board", `${label} would move copper outside the board outline.`);
        target.start = { ...operation.start };
      }
      if (operation.end) {
        if (!withinBoard(context.board, operation.end)) return refuse("escapes-board", `${label} would move copper outside the board outline.`);
        target.end = { ...operation.end };
      }
      if (operation.widthNm !== undefined) {
        const widthMinima = fabricationMinimaRefusal(context.rules, { trackWidthNm: operation.widthNm, netIds: [existing.netId], board: context.board }, label);
        if (widthMinima) return widthMinima;
        target.width = operation.widthNm;
      }
      context.changedObjectIds.add(operation.trackId);
      context.affectedNetIds.add(existing.netId);
      context.affectedLayers.add(existing.layer);
      context.operationSummaries.push(`Update track ${operation.trackId} geometry`);
      return null;
    }
    case "add_via": {
      for (const layer of operation.layers) {
        if (!context.layers.has(layer)) return refuse("invalid-layer", `${label} names a layer this board does not have (${layer}).`);
      }
      if (!context.netIds.has(operation.netId)) return refuse("invalid-net", `${label} names a net this board does not have (${operation.netId}).`);
      if (!withinBoard(context.board, operation.at)) return refuse("escapes-board", `${label} would place a via outside the board outline.`);
      // [B15.1 §D] the padstack is the AUTHORITY on size/drill. Provider
      // dimensions that disagree with it are refused, never silently kept.
      let padstack = undefined;
      if (operation.padstackId !== undefined) {
        padstack = getPadstack(context.board, operation.padstackId);
        if (!padstack) return refuse("invalid-padstack", `${label} names a padstack this board does not have (${operation.padstackId}).`);
        if (operation.sizeNm !== padstack.outerNm || operation.drillNm !== padstack.drillNm) {
          return refuse("padstack-conflict", `${label} supplies size/drill (${operation.sizeNm}/${operation.drillNm} nm) that conflict with padstack ${operation.padstackId} (${padstack.outerNm}/${padstack.drillNm} nm). The padstack is authoritative.`);
        }
      }
      const minima = fabricationMinimaRefusal(context.rules, { viaSizeNm: operation.sizeNm, viaDrillNm: operation.drillNm, netIds: [operation.netId], board: context.board }, label);
      if (minima) return minima;
      const id = mintObjectId(context.baseIdentity, "via", index);
      const newVia: Via = {
        id, at: { ...operation.at }, size: operation.sizeNm, drill: operation.drillNm,
        netId: operation.netId, layers: [operation.layers[0], operation.layers[1]] as Via["layers"],
        ...(operation.padstackId ? { padstackId: operation.padstackId } : {}), source: "ai",
      };
      if (padstack) applyPadstackToVia(newVia, padstack);
      context.candidate.vias.push(newVia);
      context.mintedObjectIds.push(id);
      context.changedObjectIds.add(id);
      context.affectedNetIds.add(operation.netId);
      for (const layer of operation.layers) context.affectedLayers.add(layer);
      context.operationSummaries.push(`Add via on net ${operation.netId} (${operation.layers.join(" ↔ ")})`);
      return null;
    }
    case "update_via": {
      const existing = context.viasById.get(operation.viaId);
      if (!existing) return refuse("unknown-object", `${label} references a via that is not on this board (${operation.viaId}).`);
      if (existing.locked) return refuse("locked-object", `${label} targets a locked via (${operation.viaId}).`);
      // [B18-C I9] a via bound to a padstack takes its size and drill FROM the padstack: explicit geometry without a padstack
      // would leave the via claiming a padstack it no longer matches. Retarget it onto an existing padstack (padstackId), or
      // fork a padstack in the editor — a human step (the via inspector's create-padstack, then set-via-padstack).
      if (existing.padstackId && operation.padstackId === undefined && (operation.sizeNm !== undefined || operation.drillNm !== undefined)) {
        const bound = getPadstack(context.board, existing.padstackId);
        return refuse("padstack-bound", `${label} changes the size/drill of via ${operation.viaId}, which is bound to padstack ${bound?.name ?? existing.padstackId} (${existing.padstackId}). Retarget it onto an existing padstack with padstackId, or fork a padstack in the editor (the via inspector's create-padstack, then set-via-padstack).`);
      }
      // [B15.1 §D] padstack and explicit geometry are MUTUALLY EXCLUSIVE;
      // assigning a padstack updates padstackId, size, and drill ATOMICALLY
      // through the shared `applyPadstackToVia` authority.
      let padstack = undefined;
      if (operation.padstackId !== undefined) {
        padstack = getPadstack(context.board, operation.padstackId);
        if (!padstack) return refuse("invalid-padstack", `${label} names a padstack this board does not have (${operation.padstackId}).`);
        if (operation.sizeNm !== undefined || operation.drillNm !== undefined) {
          return refuse("padstack-conflict", `${label} supplies explicit size/drill alongside padstack ${operation.padstackId}. The padstack is authoritative — send one or the other.`);
        }
      }
      const target = context.candidate.vias.find((item) => item.id === operation.viaId)!;
      if (operation.at) {
        if (!withinBoard(context.board, operation.at)) return refuse("escapes-board", `${label} would move a via outside the board outline.`);
        target.at = { ...operation.at };
      }
      if (operation.sizeNm !== undefined) target.size = operation.sizeNm;
      if (operation.drillNm !== undefined) target.drill = operation.drillNm;
      if (padstack) applyPadstackToVia(target, padstack);
      if (target.drill >= target.size) return refuse("invalid-value", `${label} would leave the via drill at or above its pad size.`);
      const viaMinima = fabricationMinimaRefusal(context.rules, { viaSizeNm: target.size, viaDrillNm: target.drill, netIds: [existing.netId], board: context.board }, label);
      if (viaMinima) return viaMinima;
      context.changedObjectIds.add(operation.viaId);
      context.affectedNetIds.add(existing.netId);
      // [B18-E E12] the Tier 2 review must state what the human is approving. The RESULTANT pad/drill pair is reported
      // (not the field that was sent), so a partial change still reads as the via they will get; a padstack is named with
      // the geometry it imposes; a move states its position. A no-op `update_via` is refused at parse, so the tail here
      // is never empty.
      const viaParts: string[] = [];
      if (operation.at) viaParts.push(`position (${mmText(target.at.x)}, ${mmText(target.at.y)}) mm`);
      if (padstack) viaParts.push(`padstack ${padstack.name} (${mmText(target.size)} mm pad / ${mmText(target.drill)} mm drill)`);
      else if (operation.sizeNm !== undefined || operation.drillNm !== undefined) viaParts.push(`${mmText(target.size)} mm pad / ${mmText(target.drill)} mm drill`);
      context.operationSummaries.push(`Update via ${operation.viaId} — ${viaParts.join(", ")}`);
      return null;
    }
    case "set_routing_preference": {
      const preferences = context.candidate.routingPreferences ?? { version: 1 as const, trackWidthMode: "net-class" as const, viaMode: "net-class" as const };
      const next = { ...preferences };
      if (operation.customTrackWidthNm !== undefined) {
        const preferenceMinima = fabricationMinimaRefusal(context.rules, { trackWidthNm: operation.customTrackWidthNm, board: context.board }, label);
        if (preferenceMinima) return preferenceMinima;
        next.trackWidthMode = "custom";
        next.customTrackWidthNm = operation.customTrackWidthNm;
        context.ruleChanges.push(`Interactive track width → ${(operation.customTrackWidthNm / 1e6).toFixed(3)} mm`);
      }
      if (operation.viaPadstackId !== undefined) {
        const selected = getPadstack(context.board, operation.viaPadstackId);
        if (!selected) {
          return refuse("invalid-padstack", `${label} names a padstack this board does not have (${operation.viaPadstackId}).`);
        }
        // [B15.2 §D/R13] the SELECTED padstack must satisfy the active
        // outer/drill/annular minima for every applicable net.
        const padstackMinima = fabricationMinimaRefusal(context.rules, {
          viaSizeNm: selected.outerNm, viaDrillNm: selected.drillNm, board: context.board,
        }, `${label} padstack ${operation.viaPadstackId}`);
        if (padstackMinima) return padstackMinima;
        next.viaMode = "padstack";
        next.viaPadstackId = operation.viaPadstackId;
        context.ruleChanges.push(`Interactive via padstack → ${operation.viaPadstackId}`);
      }
      if (operation.routeMode !== undefined) { next.routeMode = operation.routeMode; context.ruleChanges.push(`Route mode → ${operation.routeMode}`); }
      if (operation.posture !== undefined) { next.posture = operation.posture; context.ruleChanges.push(`Posture → ${operation.posture}`); }
      context.candidate.routingPreferences = next;
      context.operationSummaries.push("Update routing preferences");
      return null;
    }
    case "set_net_class_rule": {
      for (const netId of operation.netIds) {
        if (!context.netIds.has(netId)) return refuse("invalid-net", `${label} names a net this board does not have (${netId}).`);
        context.affectedNetIds.add(netId);
      }
      // [B15.1 §C] the ACTIVE fabrication rules are the floor — enforced even
      // when the net carries no copper today (R5).
      const ruleMinima = fabricationMinimaRefusal(context.rules, {
        trackWidthNm: operation.trackWidthNm, clearanceNm: operation.clearanceNm,
        viaSizeNm: operation.viaSizeNm, viaDrillNm: operation.viaDrillNm,
        netIds: operation.netIds, board: context.board,
      }, label);
      if (ruleMinima) return ruleMinima;
      // [B15.2 §E/R14] duplicate net ids are contradictory input.
      if (new Set(operation.netIds).size !== operation.netIds.length) {
        return refuse("invalid-value", `${label} repeats a net id.`);
      }
      const changes: Record<string, unknown> = { appliesTo: { kind: "nets", netIds: [...operation.netIds] } };
      const requestedFieldByRuleKey: Record<string, keyof typeof requested> = {
        trackWidthNm: "trackWidth", clearanceNm: "clearance", viaSizeNm: "viaSize", viaDrillNm: "viaDrill",
      };
      const requested = {
        trackWidth: operation.trackWidthNm, clearance: operation.clearanceNm,
        viaSize: operation.viaSizeNm, viaDrill: operation.viaDrillNm,
      } as const;
      const requestedKeys = new Set<keyof typeof requested>();
      for (const key of ["trackWidthNm", "clearanceNm", "viaSizeNm", "viaDrillNm"] as const) {
        if (operation[key] !== undefined) { changes[key] = operation[key]; requestedKeys.add(requestedFieldByRuleKey[key]); }
      }
      // [B15.2.1 §D/R20] partial via changes must respect the RESULTANT
      // pair's minima and annular ring, not only the supplied field. Resolve
      // the resulting via geometry against the current effective values.
      const currentByNet = new Map(operation.netIds.map((netId) => [netId, getNetClass(context.candidate, netId)]));
      for (const netId of operation.netIds) {
        const current = currentByNet.get(netId)!;
        const resultantVia = fabricationMinimaRefusal(context.rules, {
          viaSizeNm: operation.viaSizeNm ?? current.viaSize,
          viaDrillNm: operation.viaDrillNm ?? current.viaDrill,
          netIds: [netId], board: context.board,
        }, `${label} net ${netId}`);
        if (resultantVia) return resultantVia;
      }
      const ruleId = mintObjectId(context.baseIdentity, "rule", index);
      // [B15.2.1 §D/R20] snapshot the effective class of EVERY net so a rule
      // can be proven to change ONLY the named fields on the named nets, and
      // NOTHING else — no class flip, no unrequested field, no other net.
      const beforeAll = new Map(context.board.nets.map((net) => [net.id, getNetClass(context.candidate, net.id)]));
      try {
        applyRuleDeltas(context.candidate, [{
          id: ruleId,
          createdAt: "1970-01-01T00:00:00.000Z", // deterministic: the seal carries real time
          source: "ai-brief", // truthful AI provenance — never "manual"
          brief: `Bounded PCB proposal operation ${index + 1}`,
          changes: [changes as never],
          explanation: `Bounded PCB proposal rule change (operation ${index + 1})`,
        }]);
      } catch (error) {
        return refuse("invalid-value", `${label} could not be applied as a net-class rule: ${error instanceof Error ? error.message : String(error)}`);
      }
      const targetNets = new Set(operation.netIds);
      const fields = ["trackWidth", "clearance", "viaSize", "viaDrill"] as const;
      for (const net of context.board.nets) {
        const before = beforeAll.get(net.id)!;
        const after = getNetClass(context.candidate, net.id);
        if (before.id !== after.id) {
          return refuse("invalid-value", `${label} would change net ${net.id}'s class (${before.id} → ${after.id}); a bounded rule may not reassign the class. This can occur on a legacy netClassing record without a base — refusing rather than silently resetting.`);
        }
        for (const field of fields) {
          const isRequested = targetNets.has(net.id) && requestedKeys.has(field);
          if (isRequested) {
            if (after[field] !== requested[field]) {
              return refuse("invalid-value", `${label} did not take effect on net ${net.id} (${field} is ${after[field]} nm, requested ${requested[field]} nm).`);
            }
          } else if (after[field] !== before[field]) {
            return refuse("invalid-value", `${label} would change the unrequested ${field} on net ${net.id} (${before[field]} → ${after[field]} nm). A bounded rule changes only the fields it names.`);
          }
        }
      }
      for (const netId of operation.netIds) {
        const before = beforeAll.get(netId)!;
        const after = getNetClass(context.candidate, netId);
        for (const field of fields) {
          if (requestedKeys.has(field)) context.ruleChanges.push(`net ${netId}: ${field} ${before[field]} → ${after[field]} nm`);
        }
      }
      context.mintedObjectIds.push(ruleId);
      context.changedObjectIds.add(ruleId);
      context.operationSummaries.push(`Set net-class rule ${ruleId} on nets ${operation.netIds.join(", ")}`);
      return null;
    }
    case "add_dimension": {
      if (!DIMENSION_LAYER_SET.has(operation.layer)) {
        return refuse("invalid-layer", `${label} names an unsupported dimension layer (${operation.layer}).`);
      }
      if (operation.a.x === operation.b.x && operation.a.y === operation.b.y) {
        return refuse("invalid-geometry", `${label} is a zero-length dimension.`);
      }
      if (!withinBoard(context.board, operation.a) || !withinBoard(context.board, operation.b)) {
        return refuse("escapes-board", `${label} would place a dimension outside the board outline.`);
      }
      const id = mintObjectId(context.baseIdentity, "dim", index);
      const dimension = {
        id, kind: operation.dimensionKind, a: { ...operation.a }, b: { ...operation.b },
        offsetNm: operation.offsetNm, layer: operation.layer, unit: operation.unit,
        precision: operation.precision, textHeightNm: operation.textHeightNm, strokeWidthNm: operation.strokeWidthNm,
      } as unknown as BoardDimension;
      const rendered = dimensionRenderRefusal(context.board, dimension, label);
      if (rendered) return rendered;
      context.candidate.dimensions = [...(context.candidate.dimensions ?? []), dimension];
      context.mintedObjectIds.push(id);
      context.changedObjectIds.add(id);
      context.affectedLayers.add(operation.layer);
      context.operationSummaries.push(`Add ${operation.dimensionKind} dimension on ${operation.layer}`);
      return null;
    }
    case "update_dimension": {
      const existing = context.dimensionsById.get(operation.dimensionId);
      if (!existing) return refuse("unknown-object", `${label} references a dimension that is not on this board (${operation.dimensionId}).`);
      const list = context.candidate.dimensions ?? [];
      const target = list.find((item) => item.id === operation.dimensionId)!;
      // [B15.2.1 §C/R19] apply the update to a candidate dimension FIRST, then
      // validate its rendered geometry — identical to the add_dimension path.
      const merged = mergeDimensionUpdate(existing, { a: operation.a, b: operation.b, offsetNm: operation.offsetNm, precision: operation.precision });
      if (merged.a.x === merged.b.x && merged.a.y === merged.b.y) return refuse("invalid-geometry", `${label} would make a zero-length dimension.`);
      const rendered = dimensionRenderRefusal(context.board, merged, label);
      if (rendered) return rendered;
      target.a = { ...merged.a };
      target.b = { ...merged.b };
      target.offsetNm = merged.offsetNm;
      target.precision = merged.precision;
      context.changedObjectIds.add(operation.dimensionId);
      context.operationSummaries.push(`Update dimension ${operation.dimensionId}`);
      return null;
    }
    case "remove_dimension": {
      const existing = context.dimensionsById.get(operation.dimensionId);
      if (!existing) return refuse("unknown-object", `${label} references a dimension that is not on this board (${operation.dimensionId}).`);
      context.candidate.dimensions = (context.candidate.dimensions ?? []).filter((item) => item.id !== operation.dimensionId);
      context.changedObjectIds.add(operation.dimensionId);
      context.operationSummaries.push(`Remove dimension ${operation.dimensionId}`);
      return null;
    }
    case "add_keepout": {
      for (const layer of operation.layers) {
        if (!context.layers.has(layer)) return refuse("invalid-layer", `${label} names a layer this board does not have (${layer}).`);
        context.affectedLayers.add(layer);
      }
      const geometry = keepoutGeometryRefusal(context.board, operation.polygon, `${label} keepout`);
      if (geometry) return geometry;
      const id = mintObjectId(context.baseIdentity, "keepout", index);
      const keepout = {
        id, ...(operation.name ? { name: operation.name } : {}),
        polygon: operation.polygon.map((vertex) => ({ ...vertex })),
        layers: [...operation.layers], forbidTracks: operation.forbidTracks, forbidVias: operation.forbidVias,
      } as unknown as RoutingKeepout;
      context.candidate.routingKeepouts = [...(context.candidate.routingKeepouts ?? []), keepout];
      context.mintedObjectIds.push(id);
      context.changedObjectIds.add(id);
      context.operationSummaries.push(`Add routing keepout on ${operation.layers.join(", ")}`);
      return null;
    }
    case "update_keepout": {
      const existing = context.keepoutsById.get(operation.keepoutId);
      if (!existing) return refuse("unknown-object", `${label} references a keepout that is not on this board (${operation.keepoutId}).`);
      const list = context.candidate.routingKeepouts ?? [];
      const target = list.find((item) => item.id === operation.keepoutId)!;
      if (operation.polygon) {
        const geometry = keepoutGeometryRefusal(context.board, operation.polygon, `${label} keepout`);
        if (geometry) return geometry;
        target.polygon = operation.polygon.map((vertex) => ({ ...vertex }));
      }
      if (operation.layers) {
        for (const layer of operation.layers) {
          if (!context.layers.has(layer)) return refuse("invalid-layer", `${label} names a layer this board does not have (${layer}).`);
          context.affectedLayers.add(layer);
        }
        target.layers = [...operation.layers] as RoutingKeepout["layers"];
      }
      if (operation.name !== undefined) target.name = operation.name;
      if (operation.forbidTracks !== undefined) target.forbidTracks = operation.forbidTracks;
      if (operation.forbidVias !== undefined) target.forbidVias = operation.forbidVias;
      context.changedObjectIds.add(operation.keepoutId);
      context.operationSummaries.push(`Update keepout ${operation.keepoutId}`);
      return null;
    }
  }
}

/**
 * [B15.1 §C] The AUTHORITATIVE fabrication floor is the ACTIVE DRC rule set
 * (the manufacturing preset resolved by existing shared infrastructure) —
 * NOT the empirical "narrowest existing copper", which was null on a bare
 * net and therefore no floor at all (R5). Nothing here is a second rules
 * engine: the values come straight from `DrcRules`.
 */
export interface EffectiveMinima {
  clearanceNm: number;
  minTrackWidthNm: number;
  minViaOuterNm: number;
  minViaDrillNm: number;
  minAnnularRingNm: number;
}

/**
 * [B15.1 §C] Resolve the STRICTEST effective minima that apply to the given
 * nets from the ACTIVE `DrcRules` — the preset default plus any per-class
 * and per-net overrides. This is a resolution over the existing rule
 * structure, NOT a second rules engine: every number comes from `DrcRules`.
 * With no nets named (a global routing preference), the strictest set across
 * ALL applicable nets is used, because the preference could select geometry
 * for any of them.
 */
export function resolveEffectiveMinima(
  rules: DrcRules,
  netIds?: readonly number[],
  board?: PcbBoard,
): EffectiveMinima {
  const strictest: EffectiveMinima = {
    clearanceNm: rules.default.clearanceNm,
    minTrackWidthNm: rules.default.minTrackWidthNm,
    minViaOuterNm: rules.default.minViaOuterNm,
    minViaDrillNm: rules.default.minViaDrillNm,
    minAnnularRingNm: rules.default.minAnnularRingNm,
  };
  const fold = (partial: Partial<typeof rules.default> | undefined): void => {
    if (!partial) return;
    for (const key of Object.keys(strictest) as Array<keyof EffectiveMinima>) {
      const value = partial[key];
      if (typeof value === "number" && value > strictest[key]) strictest[key] = value;
    }
  };
  // Per-class overrides apply to the net's OWN class only — folding every
  // class would impose (say) a power-class floor on a signal net.
  const perNet = rules.perNet ?? {};
  if ((!netIds || netIds.length === 0) && board) {
    // [B15.2 §D/R13] a GLOBAL preference could select geometry for ANY
    // active net, so the strictest effective requirement across every net on
    // the board applies — not merely the preset default.
    for (const net of board.nets) {
      if (net.id === 0) continue;
      const netClass = getNetClass(board, net.id);
      const classId = (netClass as unknown as { id?: string; classId?: string }).id
        ?? (netClass as unknown as { classId?: string }).classId;
      if (classId) fold(rules.perClass[classId as keyof typeof rules.perClass]);
      fold(perNet[net.id]);
    }
  }
  for (const netId of netIds ?? []) {
    if (board) {
      const netClass = getNetClass(board, netId);
      const classId = (netClass as unknown as { id?: string; classId?: string }).id
        ?? (netClass as unknown as { classId?: string }).classId;
      if (classId) fold(rules.perClass[classId as keyof typeof rules.perClass]);
    }
    fold(perNet[netId]);
  }
  return strictest;
}

export function fabricationMinimaRefusal(
  rules: DrcRules,
  proposed: { trackWidthNm?: number; clearanceNm?: number; viaSizeNm?: number; viaDrillNm?: number; netIds?: readonly number[]; board?: PcbBoard },
  label: string,
): BoundedEditCompileResult | null {
  const minima = resolveEffectiveMinima(rules, proposed.netIds, proposed.board);
  if (proposed.trackWidthNm !== undefined && proposed.trackWidthNm < minima.minTrackWidthNm) {
    return refuse("weakened-minimum", `${label} track width ${proposed.trackWidthNm} nm is below the active minimum of ${minima.minTrackWidthNm} nm.`);
  }
  if (proposed.clearanceNm !== undefined && proposed.clearanceNm < minima.clearanceNm) {
    return refuse("weakened-minimum", `${label} clearance ${proposed.clearanceNm} nm is below the active minimum of ${minima.clearanceNm} nm.`);
  }
  if (proposed.viaSizeNm !== undefined && proposed.viaSizeNm < minima.minViaOuterNm) {
    return refuse("weakened-minimum", `${label} via outer diameter ${proposed.viaSizeNm} nm is below the active minimum of ${minima.minViaOuterNm} nm.`);
  }
  if (proposed.viaDrillNm !== undefined && proposed.viaDrillNm < minima.minViaDrillNm) {
    return refuse("weakened-minimum", `${label} via drill ${proposed.viaDrillNm} nm is below the active minimum of ${minima.minViaDrillNm} nm.`);
  }
  if (proposed.viaSizeNm !== undefined && proposed.viaDrillNm !== undefined) {
    const annular = (proposed.viaSizeNm - proposed.viaDrillNm) / 2;
    if (annular < minima.minAnnularRingNm) {
      return refuse("weakened-minimum", `${label} annular ring ${annular} nm is below the active minimum of ${minima.minAnnularRingNm} nm.`);
    }
  }
  return null;
}

export const BOUNDED_EDIT_MAX_OPERATIONS = BOUNDED_EDIT_LIMITS.maxOperations;
