/** Independent acceptance gate. It imports no candidate-generation code. */
import type { Track } from "../types";
import { segmentDistance } from "../geometry-copper";
import { checkClearance } from "../route-tool";
import { isOctilinearSegment, normalizePath, samePoint } from "./geometry";
import type {
  EffectiveRoutingRules,
  RoutingWorld,
  SmartRouteIntent,
  SmartRouteValidation,
  SmartRouteViolation,
} from "./types";

function validationTracks(
  intent: SmartRouteIntent,
  rules: EffectiveRoutingRules,
  points: readonly { x: number; y: number }[],
): Track[] {
  const tracks: Track[] = [];
  for (let index = 0; index + 1 < points.length; index++) {
    tracks.push({
      id: `smart-validation-${index}`,
      layer: intent.layer,
      width: rules.trackWidthNm,
      start: { ...points[index] },
      end: { ...points[index + 1] },
      netId: intent.netId,
    });
  }
  return tracks;
}
export function validateSmartRoute(
  world: RoutingWorld,
  intent: SmartRouteIntent,
  rules: EffectiveRoutingRules,
  inputPoints: readonly { x: number; y: number }[],
): SmartRouteValidation {
  const points = normalizePath(inputPoints);
  const violations: SmartRouteViolation[] = [];
  if (points.length < 2) {
    return { legal: false, violations: [{ code: "EMPTY_PATH", message: "Route has no copper segments." }] };
  }
  if (!samePoint(points[0], intent.start) || !samePoint(points[points.length - 1], intent.end)) {
    violations.push({ code: "ENDPOINT_MISMATCH", message: "Route does not connect the requested endpoints." });
  }
  for (let index = 0; index + 1 < points.length; index++) {
    if (!isOctilinearSegment(points[index], points[index + 1])) {
      violations.push({
        code: "NON_OCTILINEAR",
        message: "Only horizontal, vertical, and 45-degree copper is accepted.",
        segmentIndex: index,
      });
    }
  }
  for (let a = 0; a + 1 < points.length; a++) {
    for (let b = a + 2; b + 1 < points.length; b++) {
      if (a === 0 && b === points.length - 2 && samePoint(points[0], points[points.length - 1])) continue;
      if (segmentDistance(points[a], points[a + 1], points[b], points[b + 1]) <= 0) {
        violations.push({
          code: "SELF_INTERSECTION",
          message: "Route crosses or doubles back over itself.",
          segmentIndex: b,
        });
      }
    }
  }
  if (violations.length) return { legal: false, violations };

  const clearance = checkClearance(world.board as import("../types").PcbBoard, {
    candidateSegments: validationTracks(intent, rules, points),
    netId: intent.netId,
    clearance: rules.clearanceNm,
    edgeClearance: rules.edgeClearanceNm,
  });
  if (!clearance.legal) {
    const code = clearance.blockedByEdge
      ? "BOARD_EDGE"
      : clearance.blockedByKeepoutId
        ? "KEEPOUT"
        : "CLEARANCE";
    return {
      legal: false,
      violations: [{
        code,
        message:
          code === "BOARD_EDGE"
            ? "Route is too close to the board edge."
            : code === "KEEPOUT"
              ? "Route enters a copper keepout."
              : "Route violates copper clearance.",
        blockedBy: clearance.blockedBy,
        blockedByKeepoutId: clearance.blockedByKeepoutId,
        measuredNm: clearance.distance,
        requiredNm: code === "BOARD_EDGE" ? rules.edgeClearanceNm : rules.clearanceNm,
      }],
    };
  }
  return { legal: true, violations: [] };
}
