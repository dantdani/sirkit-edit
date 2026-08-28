import { EMBEDDED_LOW_VOLTAGE_POWER_PROFILE_V1 } from "@/app/lib/power/capability";
import { compilePowerArchitectureCandidate } from "@/app/lib/power/compiler";
import type { PowerArchitectureProblem, PowerArchitectureProposal } from "@/app/lib/power/types";
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";
// [B16.0.9] canonical wrapper — authorization -> media -> bounded body run inside
// the wrapper; the callback receives the trusted context and parsed body only.
export const POST = authenticatedJsonRoute({ maxBytes: 8_000_000, deadlineMs: 30_000 }, async ({ context, body: rawBody }): Promise<Response> => {
  const body = rawBody as unknown as { problem?: PowerArchitectureProblem; proposal?: PowerArchitectureProposal; provider?: string; model?: string }; const projectId = context.projectId, branchId = context.branchId, actorId = context.actor.actorId; if (!body.problem || !body.proposal || body.problem.projectId !== projectId || body.problem.branchId !== branchId) return Response.json({ ok: false, error: "power candidate scope mismatch" }, { status: 403 }); const result = compilePowerArchitectureCandidate({ problem: body.problem, proposal: body.proposal, profile: EMBEDDED_LOW_VOLTAGE_POWER_PROFILE_V1, actor: { actorId, actorKind: context.actor.actorKind, sessionId: context.actor.sessionId, role: context.actor.role }, createdAt: new Date().toISOString(), ...(body.provider ? { provider: body.provider } : {}), ...(body.model ? { model: body.model } : {}) }); return Response.json(result, { status: result.ok ? 200 : 422, headers: { "Cache-Control": "no-store" } }); });
