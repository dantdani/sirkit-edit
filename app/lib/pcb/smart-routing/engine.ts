import { generateDirectCandidates, generateWalkAroundCandidates } from "./candidates";
import { SMART_ROUTING_SCHEMA_VERSION, type EffectiveRoutingRules, type RoutingWorld, type SmartRouteIntent, type SmartRouteResult } from "./types";

export function routeSmart(
  world: RoutingWorld,
  intent: SmartRouteIntent,
  rules: EffectiveRoutingRules,
): SmartRouteResult {
  const started = performance.now();
  const direct = generateDirectCandidates(world, intent, rules);
  const legalDirect = direct.filter((candidate) => candidate.validation.legal);
  let candidates = legalDirect;
  let consideredObstacleIds: string[] = [];
  let rejectedReasons = direct
    .filter((candidate) => !candidate.validation.legal)
    .map((candidate) => candidate.validation.violations[0]?.message ?? "Direct candidate rejected.");
  let status: SmartRouteResult["status"] = "ready";
  let walkCandidates = 0;

  if (!legalDirect.length) {
    const walk = generateWalkAroundCandidates(world, intent, rules, direct);
    candidates = walk.candidates;
    consideredObstacleIds = walk.consideredObstacleIds;
    rejectedReasons = [...rejectedReasons, ...walk.rejectedReasons];
    walkCandidates = walk.candidates.length;
    status = candidates.length ? "walking-around" : "blocked";
  }
  candidates = [...candidates]
    .sort((a, b) => a.score.total - b.score.total || a.id.localeCompare(b.id))
    .slice(0, Math.max(1, intent.maxCandidates));
  const selected = candidates[0];
  const elapsedMs = performance.now() - started;
  return {
    schemaVersion: SMART_ROUTING_SCHEMA_VERSION,
    intent,
    rules,
    status,
    candidates,
    ...(selected ? { selectedCandidateId: selected.id } : {}),
    diagnostics: {
      worldRevision: world.revision,
      elapsedMs,
      directCandidates: direct.length,
      walkCandidates,
      consideredObstacleIds,
      rejectedReasons,
    },
    explanation: selected
      ? selected.mode === "direct"
        ? `Direct route is legal. ${rules.explanation}`
        : `Direct copper was blocked, so Smart Route walked around it without moving existing copper.`
      : `No legal one-layer walk-around was found. Existing copper was not changed.`,
  };
}
