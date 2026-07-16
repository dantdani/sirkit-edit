import type { CopperItemRef } from "../connectivity-board";
import { normalizeDrcReport } from "../ai/violation-normalizer";
import type { DrcResult, DrcRules, DrcViolation } from "../drc/types";
import type { EditCommand, SelectionRef } from "../edit/commands";
import { DEFAULT_PADSTACKS } from "../padstack/defaults";
import { stableHash } from "../smart-routing/hash";
import { pcbRevisionId } from "../ai/snapshot";
import type { PcbBoard } from "../types";
import type { PCBRepairPlan, RepairExecutionMode, RepairFix, RepairGroup } from "./types";
import { buildPlacementEnvelope } from "../autoplace/envelope";
import { isLocked } from "../autoplace/auto-place";
import { outlineBBox, worldCourtyardBBox } from "../autoplace/geometry";

function footprintIdForViolation(violation: DrcViolation): string | undefined {
  const pad = violation.items.find((item) => item.kind === "pad");
  if (pad?.kind === "pad") return pad.instanceId;
  return violation.objectIds?.find((id) => !id.includes(".") && !id.startsWith("zone:"));
}

function placementBox(board: PcbBoard, footprint: PcbBoard["footprints"][number]) {
  const local = buildPlacementEnvelope(board, footprint, {
    scale: board.placementPreferences?.envelopeScale ?? 1.15,
  }).effectiveBounds;
  return worldCourtyardBBox(local, footprint.at, footprint.rotationDeg, footprint.side === "bottom");
}

function moveInsideBoardCommand(board: PcbBoard, violation: DrcViolation): EditCommand | null {
  const footprintId = footprintIdForViolation(violation);
  const footprint = board.footprints.find((candidate) => candidate.id === footprintId);
  if (!footprint || isLocked(footprint)) return null;
  const box = placementBox(board, footprint);
  const outline = outlineBBox(board.outline);
  let dx = 0;
  let dy = 0;
  if (box.minX < outline.minX) dx += outline.minX - box.minX;
  if (box.maxX + dx > outline.maxX) dx += outline.maxX - (box.maxX + dx);
  if (box.minY < outline.minY) dy += outline.minY - box.minY;
  if (box.maxY + dy > outline.maxY) dy += outline.maxY - (box.maxY + dy);
  if (dx === 0 && dy === 0) return null;
  return {
    op: "set-position",
    ref: { kind: "footprint", id: footprint.id },
    atNm: { x: Math.round(footprint.at.x + dx), y: Math.round(footprint.at.y + dy) },
  };
}

function separateCourtyardCommand(board: PcbBoard, violation: DrcViolation): EditCommand | null {
  const ids = violation.objectIds ?? [];
  const footprints = ids.map((id) => board.footprints.find((candidate) => candidate.id === id)).filter(Boolean) as PcbBoard["footprints"];
  if (footprints.length !== 2) return null;
  const mover = !isLocked(footprints[1]) ? footprints[1] : !isLocked(footprints[0]) ? footprints[0] : undefined;
  if (!mover) return null;
  const other = mover.id === footprints[0].id ? footprints[1] : footprints[0];
  const movingBox = placementBox(board, mover);
  const fixedBox = placementBox(board, other);
  const gap = Math.max(0, violation.thresholdNm);
  const overlapX = Math.min(movingBox.maxX, fixedBox.maxX) - Math.max(movingBox.minX, fixedBox.minX);
  const overlapY = Math.min(movingBox.maxY, fixedBox.maxY) - Math.max(movingBox.minY, fixedBox.minY);
  if (overlapX < 0 || overlapY < 0) return null;
  let dx = 0;
  let dy = 0;
  if (overlapX <= overlapY) {
    dx = mover.at.x >= other.at.x
      ? fixedBox.maxX + gap - movingBox.minX
      : fixedBox.minX - gap - movingBox.maxX;
  } else {
    dy = mover.at.y >= other.at.y
      ? fixedBox.maxY + gap - movingBox.minY
      : fixedBox.minY - gap - movingBox.maxY;
  }
  return {
    op: "set-position",
    ref: { kind: "footprint", id: mover.id },
    atNm: { x: Math.round(mover.at.x + dx), y: Math.round(mover.at.y + dy) },
  };
}

function selectionRef(ref: CopperItemRef): SelectionRef | null {
  if (ref.kind === "track" || ref.kind === "via") return { kind: ref.kind, id: ref.id };
  if (ref.kind === "zone-region") return { kind: "zone", id: ref.zoneId };
  if (ref.kind === "pad") return { kind: "pad", footprintId: ref.instanceId, padNumber: ref.padNumber };
  return null;
}

function numericNetIds(board: PcbBoard, violation: DrcViolation): number[] {
  const result = new Set<number>();
  for (const item of violation.items) {
    let netId = 0;
    if (item.kind === "track") netId = board.tracks.find((track) => track.id === item.id)?.netId ?? 0;
    else if (item.kind === "via") netId = board.vias.find((via) => via.id === item.id)?.netId ?? 0;
    else if (item.kind === "zone-region") netId = board.zones.find((zone) => zone.id === item.zoneId)?.netId ?? 0;
    else netId = board.footprints.find((footprint) => footprint.id === item.instanceId)?.padNets[item.padNumber] ?? 0;
    if (netId !== 0) result.add(netId);
  }
  return [...result].sort((a, b) => a - b);
}

function touchesProtectedCopper(board: PcbBoard, violation: DrcViolation): boolean {
  return violation.items.some((item) => {
    if (item.kind === "track") {
      const track = board.tracks.find((candidate) => candidate.id === item.id);
      return track?.locked === true || (track?.source !== "ai" && track?.source !== "autorouter");
    }
    if (item.kind === "via") {
      const via = board.vias.find((candidate) => candidate.id === item.id);
      return via?.locked === true || (via?.source !== "ai" && via?.source !== "autorouter");
    }
    return false;
  });
}

function groupFor(kind: DrcViolation["kind"], netIds: number[]): { key: string; title: string; rootCause: string } {
  if (kind === "minTrackWidth") return { key: `width:${netIds.join(",")}`, title: "Tracks below resolved minimum", rootCause: "generated_width_mismatch" };
  if (kind === "incompleteNet" || kind === "unconnected") return { key: `connectivity:${netIds.join(",")}`, title: "Incomplete or dangling connectivity", rootCause: "incomplete_connectivity" };
  if (["clearance", "short", "edgeClearance", "trackOutsideBoard", "viaOutsideBoard"].includes(kind)) {
    return { key: `routing:${netIds.join(",")}`, title: "Crowded or illegal routing geometry", rootCause: "routing_congestion" };
  }
  if (["viaOuterDiameter", "viaDrill", "annularRing", "unsupportedViaSpan"].includes(kind)) {
    return { key: `via:${netIds.join(",")}`, title: "Illegal via geometry", rootCause: "via_rule_mismatch" };
  }
  if (["padOutsideBoard", "holeOutsideBoard", "footprintOutsideBoard", "courtyardOverlap"].includes(kind)) {
    return { key: "placement", title: "Placement constraint violations", rootCause: "placement_congestion" };
  }
  return { key: `manual:${kind}`, title: `Review ${kind}`, rootCause: kind };
}

function commandForViolation(board: PcbBoard, violation: DrcViolation): EditCommand | null {
  const first = violation.items[0];
  if (violation.kind === "minTrackWidth" && first?.kind === "track") {
    return { op: "set-track-width", ids: [first.id], widthNm: Math.max(1, Math.round(violation.thresholdNm)) };
  }
  if (violation.kind === "unconnected" && first && (first.kind === "track" || first.kind === "via")) {
    const source = first.kind === "track"
      ? board.tracks.find((track) => track.id === first.id)?.source
      : board.vias.find((via) => via.id === first.id)?.source;
    if (source === "ai" || source === "autorouter") {
      const ref = selectionRef(first);
      return ref ? { op: "delete-items", refs: [ref] } : null;
    }
  }
  if (["viaOuterDiameter", "viaDrill", "annularRing", "unsupportedViaSpan"].includes(violation.kind) && first?.kind === "via") {
    const candidates = [...(board.padstacks ?? []), ...DEFAULT_PADSTACKS.filter((padstack) => !(board.padstacks ?? []).some((existing) => existing.id === padstack.id))]
      .filter((padstack) => padstack.outerNm >= violation.thresholdNm || violation.kind === "viaDrill")
      .sort((a, b) => a.outerNm - b.outerNm || a.drillNm - b.drillNm);
    const selected = candidates.find((padstack) => (board.padstacks ?? []).some((existing) => existing.id === padstack.id));
    if (selected) return { op: "set-via-padstack", viaIds: [first.id], padstackId: selected.id };
  }
  if (["padOutsideBoard", "holeOutsideBoard", "footprintOutsideBoard"].includes(violation.kind)) {
    return moveInsideBoardCommand(board, violation);
  }
  if (violation.kind === "courtyardOverlap") return separateCourtyardCommand(board, violation);
  return null;
}

export function planDrcRepairs(
  board: PcbBoard,
  drc: DrcResult,
  rules: DrcRules,
  mode: RepairExecutionMode = "safe_fixes_automatically",
): PCBRepairPlan {
  const normalized = normalizeDrcReport(board, drc);
  const fixes: RepairFix[] = [];
  const groupMap = new Map<string, RepairGroup>();
  for (let index = 0; index < drc.violations.length; index++) {
    const violation = drc.violations[index];
    const normalizedViolation = normalized[index];
    const nets = numericNetIds(board, violation);
    const command = commandForViolation(board, violation);
    const suggested = normalizedViolation.candidateFixes[0];
    let action: RepairFix["action"] = { kind: "manual_review" };
    if (command) action = { kind: "edit", command };
    else if (normalizedViolation.fixability === "auto_with_reroute" && nets.length > 0) action = { kind: "reroute_nets", netIds: nets };
    const protectedCopper = touchesProtectedCopper(board, violation);
    const requiresApproval =
      mode === "review_every_change" ||
      suggested?.requiresApproval === true ||
      protectedCopper ||
      normalizedViolation.fixability === "manual_only" ||
      normalizedViolation.fixability === "requires_schematic_change";
    const fix: RepairFix = {
      id: `repair-fix-${stableHash(`${violation.id}|${JSON.stringify(action)}`)}`,
      title: suggested?.label ?? `Review ${violation.kind}`,
      reason: violation.detail,
      fixability: normalizedViolation.fixability,
      requiresApproval,
      sourceViolationIds: [violation.id],
      affectedObjectIds: normalizedViolation.objectIds,
      affectedNetIds: nets,
      action,
    };
    fixes.push(fix);
    const groupInfo = groupFor(violation.kind, nets);
    const group = groupMap.get(groupInfo.key) ?? {
      id: `repair-group-${stableHash(groupInfo.key)}`,
      title: groupInfo.title,
      rootCause: groupInfo.rootCause,
      violationIds: [],
      fixIds: [],
      requiresApproval: false,
    };
    group.violationIds.push(violation.id);
    group.fixIds.push(fix.id);
    group.requiresApproval ||= requiresApproval;
    groupMap.set(groupInfo.key, group);
  }

  const dirtyZoneIds = board.zones.filter((zone) => zone.dirty).map((zone) => zone.id);
  if (dirtyZoneIds.length > 0) {
    const fix: RepairFix = {
      id: `repair-fix-${stableHash(`refill|${dirtyZoneIds.join(",")}`)}`,
      title: "Refill stale copper zones",
      reason: "Connectivity must be judged using current zone geometry.",
      fixability: "safe_auto",
      requiresApproval: mode === "review_every_change",
      sourceViolationIds: [],
      affectedObjectIds: dirtyZoneIds.map((id) => `zone:${id}`),
      affectedNetIds: [],
      action: { kind: "refill_zones", zoneIds: dirtyZoneIds },
    };
    fixes.unshift(fix);
    groupMap.set("zones", {
      id: `repair-group-${stableHash("zones")}`,
      title: "Stale copper zones",
      rootCause: "stale_zone_fill",
      violationIds: [],
      fixIds: [fix.id],
      requiresApproval: fix.requiresApproval,
    });
  }

  const baseRevisionId = pcbRevisionId(board);
  return {
    id: `repair-plan-${stableHash(`${baseRevisionId}|${drc.violations.map((violation) => violation.id).join("|")}`)}`,
    baseRevisionId,
    mode,
    createdAt: new Date().toISOString(),
    violations: normalized,
    groups: [...groupMap.values()],
    fixes,
    rules,
    drcBefore: drc,
  };
}
