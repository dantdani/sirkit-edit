import { compilePowerArchitectureProblem } from "@/app/lib/power/problem";
import { EMBEDDED_LOW_VOLTAGE_POWER_PROFILE_V1 } from "@/app/lib/power/capability";
import type { PowerProblemCompileInput } from "@/app/lib/power/types";

import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";
function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
// [B16.0.9] canonical wrapper — authorization -> media -> bounded body run inside
// the wrapper; the callback receives the trusted context and parsed body only.
export const POST = authenticatedJsonRoute({ maxBytes: 8_000_000, deadlineMs: 30_000 }, async ({ context, body: rawBody }): Promise<Response> => {
  const body: unknown = rawBody;
  const tenantId = context.tenantId, projectId = context.projectId, branchId = context.branchId, actorId = context.actor.actorId;
  if (!object(body) || !object(body.requirementsPackage) || !object(body.architectureState) || !object(body.upstreamSignoff) || !object(body.capabilityProfile)) return Response.json({ ok: false, error: "pinned CD-1, CD-2, signoff, and power capability inputs are required" }, { status: 400 });
  const input = body as unknown as PowerProblemCompileInput; if (input.requirementsPackage.projectId !== projectId || input.architectureState.projectId !== projectId || input.branchId !== branchId || input.tenantId !== tenantId) return Response.json({ ok: false, error: "power problem scope mismatch" }, { status: 403 });
  const result = compilePowerArchitectureProblem({ ...input, tenantId, branchId, capabilityProfile: EMBEDDED_LOW_VOLTAGE_POWER_PROFILE_V1, policyProfileRevision: "sirkit-power-policy/1", ruleModelRegistryRevision: "sirkit-power-rules/1", actor: { actorId, actorKind: context.actor.actorKind, sessionId: context.actor.sessionId, role: context.actor.role }, createdAt: new Date().toISOString() }); return Response.json(result, { status: result.ok ? 200 : 422, headers: { "Cache-Control": "no-store" } });
});
