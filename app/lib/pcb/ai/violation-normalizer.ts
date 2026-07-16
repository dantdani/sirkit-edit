import type { CopperItemRef } from "../connectivity-board";
import type { DrcResult, DrcViolation } from "../drc/types";
import type { PcbBoard } from "../types";

export type RepairFixability =
  | "safe_auto"
  | "auto_with_reroute"
  | "requires_approval"
  | "requires_schematic_change"
  | "manual_only";

export interface CandidateFix {
  id: string;
  operation:
    | "resize_track_width"
    | "remove_dangling_copper"
    | "replace_via"
    | "reroute_net"
    | "refill_zones"
    | "move_footprint"
    | "manual_review";
  label: string;
  objectIds: string[];
  netIds: string[];
  parameters?: Record<string, unknown>;
  requiresApproval: boolean;
}

export interface NormalizedDrcViolation {
  id: string;
  type: DrcViolation["kind"];
  severity: "error" | "warning";
  message: string;
  detail: string;
  ruleId: string;
  objectIds: string[];
  netIds: string[];
  layerIds: string[];
  location: { x: number; y: number };
  actual?: { value: number; unit: "mm" | "count" };
  required?: { value: number; unit: "mm" | "count" };
  fixability: RepairFixability;
  candidateFixes: CandidateFix[];
}

function objectId(ref: CopperItemRef): string {
  if (ref.kind === "pad") return `pad:${ref.instanceId}:${ref.padNumber}`;
  if (ref.kind === "zone-region") return `zone:${ref.zoneId}:region:${ref.regionIndex}`;
  return `${ref.kind}:${ref.id}`;
}

function netIdFor(board: PcbBoard, ref: CopperItemRef): number {
  if (ref.kind === "track") return board.tracks.find((track) => track.id === ref.id)?.netId ?? 0;
  if (ref.kind === "via") return board.vias.find((via) => via.id === ref.id)?.netId ?? 0;
  if (ref.kind === "zone-region") return board.zones.find((zone) => zone.id === ref.zoneId)?.netId ?? 0;
  return board.footprints.find((footprint) => footprint.id === ref.instanceId)?.padNets[ref.padNumber] ?? 0;
}

function generated(board: PcbBoard, ref: CopperItemRef | undefined): boolean {
  if (!ref) return false;
  if (ref.kind === "track") {
    const source = board.tracks.find((track) => track.id === ref.id)?.source;
    return source === "ai" || source === "autorouter";
  }
  if (ref.kind === "via") {
    const source = board.vias.find((via) => via.id === ref.id)?.source;
    return source === "ai" || source === "autorouter";
  }
  return false;
}

function classification(board: PcbBoard, violation: DrcViolation): { fixability: RepairFixability; operation: CandidateFix["operation"]; label: string } {
  const first = violation.items[0];
  switch (violation.kind) {
    case "minTrackWidth":
      return generated(board, first)
        ? { fixability: "safe_auto", operation: "resize_track_width", label: "Widen generated track to the resolved legal minimum" }
        : { fixability: "requires_approval", operation: "resize_track_width", label: "Preview widening this user-authored track" };
    case "viaOuterDiameter":
    case "viaDrill":
    case "annularRing":
    case "unsupportedViaSpan":
      return generated(board, first)
        ? { fixability: "safe_auto", operation: "replace_via", label: "Replace generated via with a configured legal via" }
        : { fixability: "requires_approval", operation: "replace_via", label: "Preview replacing this via" };
    case "unconnected":
      return generated(board, first)
        ? { fixability: "safe_auto", operation: "remove_dangling_copper", label: "Remove unused generated dangling copper" }
        : { fixability: "manual_only", operation: "manual_review", label: "Review whether this unconnected object is intentional" };
    case "incompleteNet":
      return { fixability: "auto_with_reroute", operation: "reroute_net", label: "Reroute the incomplete net using resolved rules" };
    case "clearance":
    case "short":
    case "edgeClearance":
    case "trackOutsideBoard":
    case "viaOutsideBoard":
    case "disabledLayer":
      return { fixability: "auto_with_reroute", operation: "reroute_net", label: "Rip up only affected generated copper and reroute the net" };
    case "zoneOutsideBoard":
      return { fixability: "requires_approval", operation: "manual_review", label: "Preview repairing the zone outline" };
    case "padOutsideBoard":
    case "holeOutsideBoard":
    case "footprintOutsideBoard":
    case "courtyardOverlap":
      return { fixability: "requires_approval", operation: "move_footprint", label: "Preview local footprint placement repair" };
    case "silkOverPad":
    case "referenceTextOutsideBoard":
      return { fixability: "safe_auto", operation: "manual_review", label: "Move generated silkscreen clear of fabrication features" };
    default:
      return { fixability: "manual_only", operation: "manual_review", label: "Inspect this violation manually" };
  }
}

export function normalizeDrcViolation(board: PcbBoard, violation: DrcViolation): NormalizedDrcViolation {
  const objects = [...new Set([
    ...(violation.objectIds ?? []),
    ...violation.items.map(objectId),
  ])];
  const numericNetIds = [...new Set(violation.items.map((item) => netIdFor(board, item)).filter((id) => id !== 0))];
  const netIds = numericNetIds.map((id) => board.nets.find((net) => net.id === id)?.name || `net${id}`);
  const { fixability, operation, label } = classification(board, violation);
  const isCount = violation.kind === "incompleteNet" || violation.kind === "unconnected";
  const parameters = operation === "resize_track_width"
    ? { widthMm: violation.thresholdNm / 1_000_000 }
    : numericNetIds.length > 0
      ? { netNumericIds: numericNetIds }
      : undefined;
  return {
    id: violation.id,
    type: violation.kind,
    severity: violation.severity === "info" ? "warning" : violation.severity,
    message: violation.summary,
    detail: violation.detail,
    ruleId: `resolved:${violation.kind}`,
    objectIds: objects,
    netIds,
    layerIds: violation.layer ? [violation.layer] : [],
    location: { x: violation.location.x / 1_000_000, y: violation.location.y / 1_000_000 },
    actual: { value: isCount ? violation.measuredNm : violation.measuredNm / 1_000_000, unit: isCount ? "count" : "mm" },
    required: { value: isCount ? violation.thresholdNm : violation.thresholdNm / 1_000_000, unit: isCount ? "count" : "mm" },
    fixability,
    candidateFixes: [{
      id: `fix:${violation.id}:1`,
      operation,
      label,
      objectIds: objects,
      netIds,
      ...(parameters ? { parameters } : {}),
      requiresApproval: fixability === "requires_approval" || fixability === "requires_schematic_change" || fixability === "manual_only",
    }],
  };
}

export function normalizeDrcReport(board: PcbBoard, report: DrcResult): NormalizedDrcViolation[] {
  return report.violations.map((violation) => normalizeDrcViolation(board, violation));
}
