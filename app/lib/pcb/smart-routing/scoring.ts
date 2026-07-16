import { pathLength } from "./geometry";
import type { CandidateScoreBreakdown, EffectiveRoutingRules } from "./types";

export function scoreRoute(
  points: readonly { x: number; y: number }[],
  rules: EffectiveRoutingRules,
  congestion = 0,
): CandidateScoreBreakdown {
  const length = pathLength(points);
  const bendCount = Math.max(0, points.length - 2);
  const bends = bendCount * rules.gridNm * 8;
  const vias = 0;
  const movement = 0;
  const stability = 0;
  const congestionCost = congestion * rules.gridNm * 2;
  return {
    length,
    bends,
    vias,
    movement,
    congestion: congestionCost,
    stability,
    total: length + bends + vias + movement + congestionCost + stability,
  };
}
