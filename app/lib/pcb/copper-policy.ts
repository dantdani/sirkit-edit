import type { LayerId } from "./layers";
import type { PcbBoard } from "./types";

export type NetRelation =
  | "same-proven-net"
  | "different-proven-nets"
  | "proven-net-to-unassigned"
  | "unassigned-to-unassigned"
  | "unknown";

export type CopperPairOperation =
  | "connectivity"
  | "drc"
  | "route-preview"
  | "zone-fill"
  | "export-preflight";

export interface ResolvedNetIdentity {
  numericNetId: number;
  state: "proven" | "unassigned" | "unknown";
  stableNetId?: string;
  reason?: string;
}

export interface CopperPairDecision {
  relation: NetRelation;
  layer?: LayerId;
  operation: CopperPairOperation;
  mayTouchElectrically: boolean;
  shouldUnionWhenTouching: boolean;
  createsShortWhenTouching: boolean;
  requiredElectricalClearanceNm: number | null;
  applicableManufacturingChecks: string[];
  status: "proven" | "unknown" | "unsupported";
}

export interface CopperPolicy {
  resolve(numericNetId: number): ResolvedNetIdentity;
  classify(leftNetId: number, rightNetId: number): NetRelation;
  decide(input: Omit<Parameters<typeof decideCopperPair>[0], "board">): CopperPairDecision;
}

export function createCopperPolicy(board: Pick<PcbBoard, "nets">): CopperPolicy {
  const byNumeric = new Map<number, typeof board.nets>();
  const byStable = new Map<string, typeof board.nets>();
  for (const net of board.nets) {
    byNumeric.set(net.id, [...(byNumeric.get(net.id) ?? []), net]);
    if (net.stableId) byStable.set(net.stableId, [...(byStable.get(net.stableId) ?? []), net]);
  }
  const resolve = (numericNetId: number): ResolvedNetIdentity => {
    const matches = byNumeric.get(numericNetId) ?? [];
    if (numericNetId === 0) return matches.length === 1
      ? { numericNetId, state: "unassigned" }
      : { numericNetId, state: "unknown", reason: "Reserved unassigned net identity is missing or duplicated." };
    if (matches.length !== 1) return { numericNetId, state: "unknown", reason: `Numeric net ${numericNetId} is missing or ambiguous.` };
    const stableNetId = matches[0].stableId;
    if (!stableNetId) return { numericNetId, state: "unknown", reason: `Numeric net ${numericNetId} has no stable identity.` };
    if ((byStable.get(stableNetId) ?? []).length !== 1) return { numericNetId, state: "unknown", reason: `Stable net ${stableNetId} is ambiguous.` };
    return { numericNetId, stableNetId, state: "proven" };
  };
  const classify = (leftNetId: number, rightNetId: number): NetRelation => {
    const left = resolve(leftNetId);
    const right = resolve(rightNetId);
    if (left.state === "unknown" || right.state === "unknown") return "unknown";
    if (left.state === "unassigned" && right.state === "unassigned") return "unassigned-to-unassigned";
    if (left.state === "unassigned" || right.state === "unassigned") return "proven-net-to-unassigned";
    return left.stableNetId === right.stableNetId ? "same-proven-net" : "different-proven-nets";
  };
  return {
    resolve,
    classify,
    decide: (input) => decisionForRelation(classify(input.leftNetId, input.rightNetId), input),
  };
}

function decisionForRelation(
  relation: NetRelation,
  input: Omit<Parameters<typeof decideCopperPair>[0], "board">,
): CopperPairDecision {
  const same = relation === "same-proven-net";
  const different = relation === "different-proven-nets";
  const known = same || different;
  return {
    relation,
    operation: input.operation,
    ...(input.layer ? { layer: input.layer } : {}),
    mayTouchElectrically: same,
    shouldUnionWhenTouching: same,
    createsShortWhenTouching: different,
    requiredElectricalClearanceNm: same ? null : input.interNetClearanceNm,
    applicableManufacturingChecks: [...new Set(input.manufacturingChecks ?? [])].sort(),
    status: known ? "proven" : "unknown",
  };
}

/** Resolve compact numeric ownership through the current persistent stable-net table. */
export function resolveNetIdentity(board: Pick<PcbBoard, "nets">, numericNetId: number): ResolvedNetIdentity {
  const matches = board.nets.filter((net) => net.id === numericNetId);
  if (numericNetId === 0) {
    return matches.length === 1
      ? { numericNetId, state: "unassigned" }
      : { numericNetId, state: "unknown", reason: "Reserved unassigned net identity is missing or duplicated." };
  }
  if (matches.length !== 1) {
    return { numericNetId, state: "unknown", reason: `Numeric net ${numericNetId} is missing or ambiguous.` };
  }
  const stableNetId = matches[0].stableId;
  if (!stableNetId) return { numericNetId, state: "unknown", reason: `Numeric net ${numericNetId} has no stable identity.` };
  if (board.nets.filter((net) => net.stableId === stableNetId).length !== 1) {
    return { numericNetId, state: "unknown", reason: `Stable net ${stableNetId} is ambiguous.` };
  }
  return { numericNetId, stableNetId, state: "proven" };
}

export function classifyNetRelation(
  board: Pick<PcbBoard, "nets">,
  leftNetId: number,
  rightNetId: number,
): NetRelation {
  const left = resolveNetIdentity(board, leftNetId);
  const right = resolveNetIdentity(board, rightNetId);
  if (left.state === "unknown" || right.state === "unknown") return "unknown";
  if (left.state === "unassigned" && right.state === "unassigned") return "unassigned-to-unassigned";
  if (left.state === "unassigned" || right.state === "unassigned") return "proven-net-to-unassigned";
  return left.stableNetId === right.stableNetId ? "same-proven-net" : "different-proven-nets";
}

/**
 * One policy for electrical contact and ordinary inter-net clearance.
 * Independent width, drill, annular-ring, edge, hole, keepout, and explicit
 * same-net feature rules remain applicable regardless of this decision.
 */
export function decideCopperPair(input: {
  board: Pick<PcbBoard, "nets">;
  leftNetId: number;
  rightNetId: number;
  operation: CopperPairOperation;
  layer?: LayerId;
  interNetClearanceNm: number;
  manufacturingChecks?: string[];
}): CopperPairDecision {
  const relation = classifyNetRelation(input.board, input.leftNetId, input.rightNetId);
  return decisionForRelation(relation, {
    leftNetId: input.leftNetId,
    rightNetId: input.rightNetId,
    operation: input.operation,
    layer: input.layer,
    interNetClearanceNm: input.interNetClearanceNm,
    manufacturingChecks: input.manufacturingChecks,
  });
}

export function violatesOrdinaryCopperClearance(distanceNm: number, decision: CopperPairDecision): boolean {
  if (!Number.isFinite(distanceNm)) return false;
  const threshold = decision.requiredElectricalClearanceNm;
  return threshold !== null && distanceNm < threshold;
}
