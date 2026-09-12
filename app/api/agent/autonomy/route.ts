/**
 * [B18-A] `/api/agent/autonomy` — the project's agent autonomy setting.
 *
 *  GET  every project member reads the current setting and its audit trail.
 *  POST a project administrator changes the mode with a compare-and-set on
 *       the setting revision (`{ mode, expectedRevision }`, closed body).
 *
 * Canonical wrappers: the exact policy rows (all-members read; admin-only,
 * same-origin-CSRF mutation), the trusted context (verified principal +
 * ACTIVE membership + membership revision) and the bounded body read all run
 * inside the wrapper BEFORE these callbacks. Nothing in the body can name an
 * actor, role, capability or revision authority — the actor is derived from
 * the trusted context only; an undeclared key is refused, never ignored.
 * The store is a durable-workflow aggregate (server-owned, revisioned,
 * audited); without a database it is unavailable and the project behaves as
 * `proposal_only` (never widens).
 */
import { authenticatedJsonRoute, authenticatedRoute } from "@/app/lib/auth/route-handlers";
import { resolveAgentAutonomyRepository } from "@/app/lib/agent/autonomy-store";
import { AUTONOMY_MODES, canChangeAutonomy, isAutonomyMode } from "@/app/lib/engineering/permission-tiers";

export const runtime = "nodejs";

/** [B18-A] the ONLY keys a change request may carry. */
export const AUTONOMY_BODY_KEYS: ReadonlySet<string> = new Set(["mode", "expectedRevision"]);
/** Authority-shaped keys are refused BY NAME (never silently ignored). */
const AUTHORITY_SHAPED_KEYS = new Set(["actor", "actorId", "actorKind", "role", "principalId", "membershipRevision", "capability", "capabilities", "authority", "approval", "approvals", "revision", "tenantId", "projectId", "branchId", "scope"]);
const NO_STORE = { "Cache-Control": "no-store" } as const;

function refusal(status: number, code: string, error: string, extra: Record<string, unknown> = {}): Response {
  return Response.json({ ok: false, code, error, ...extra }, { status, headers: NO_STORE });
}

export const GET = authenticatedRoute({}, async ({ context }): Promise<Response> => {
  const scope = { tenantId: context.tenantId, projectId: context.projectId };
  try {
    const repository = resolveAgentAutonomyRepository();
    const setting = await repository.get(scope);
    const changes = await repository.changes(scope, 20);
    return Response.json({ ok: true, setting, changes, modes: AUTONOMY_MODES, viewer: { role: context.actor.role, canChange: canChangeAutonomy(context.actor.role) } }, { headers: NO_STORE });
  } catch {
    return refusal(503, "AGENT_AUTONOMY_UNAVAILABLE", "The agent autonomy store is unavailable; the project behaves as proposal_only until it is reachable.");
  }
});

export const POST = authenticatedJsonRoute({ maxBytes: 4_096, deadlineMs: 5_000 }, async ({ context, body }): Promise<Response> => {
  const keys = Object.keys(body);
  const authorityShaped = keys.filter((key) => AUTHORITY_SHAPED_KEYS.has(key)).sort();
  if (authorityShaped.length > 0) return refusal(400, "AGENT_AUTONOMY_AUTHORITY_CLAIM", "The request carries an authority-shaped key; the actor, role, membership and scope come only from the trusted session.", { fields: authorityShaped });
  const unknown = keys.filter((key) => !AUTONOMY_BODY_KEYS.has(key)).sort();
  if (unknown.length > 0) return refusal(400, "AGENT_AUTONOMY_UNKNOWN_FIELD", "The request carries an undeclared key.", { fields: unknown });
  if (!isAutonomyMode(body.mode)) return refusal(400, "AGENT_AUTONOMY_MODE_INVALID", `mode must be one of ${AUTONOMY_MODES.join(", ")}.`);
  const expectedRevision = body.expectedRevision;
  if (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0) return refusal(400, "AGENT_AUTONOMY_REVISION_REQUIRED", "expectedRevision must be the setting revision you read (an integer ≥ 0).");
  // Human truth: only a session principal (never a worker or an agent) changes the policy that widens the agent.
  if (context.actor.actorKind !== "human") return refusal(403, "AGENT_AUTONOMY_HUMAN_REQUIRED", "Only a human project administrator may change the agent autonomy setting.");
  if (!canChangeAutonomy(context.actor.role)) return refusal(403, "AGENT_AUTONOMY_FORBIDDEN", `Role ${context.actor.role} may not change the agent autonomy setting; a project administrator must.`);
  const scope = { tenantId: context.tenantId, projectId: context.projectId };
  try {
    const result = await resolveAgentAutonomyRepository().set({
      scope,
      mode: body.mode,
      expectedRevision: expectedRevision as number,
      actor: { principalId: context.principalId, membershipRevision: context.membershipRevision, role: context.actor.role },
      at: new Date().toISOString(),
    });
    if (result.ok) return Response.json({ ok: true, setting: result.setting, change: result.change, unchanged: result.unchanged }, { headers: NO_STORE });
    if (result.code === "stale_revision") return refusal(409, "AGENT_AUTONOMY_STALE_REVISION", result.message, { current: result.current });
    if (result.code === "forbidden") return refusal(403, "AGENT_AUTONOMY_FORBIDDEN", result.message);
    if (result.code === "invalid_mode") return refusal(400, "AGENT_AUTONOMY_MODE_INVALID", result.message);
    return refusal(503, "AGENT_AUTONOMY_UNAVAILABLE", result.message);
  } catch {
    return refusal(503, "AGENT_AUTONOMY_UNAVAILABLE", "The agent autonomy store is unavailable; nothing was changed.");
  }
});
