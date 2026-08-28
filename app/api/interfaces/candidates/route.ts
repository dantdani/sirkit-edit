import { EMBEDDED_MIXED_SIGNAL_INTERFACE_PROFILE_V1 } from "@/app/lib/interfaces/capability";
import { compileInterfacePlanningCandidate } from "@/app/lib/interfaces/compiler";
import type { InterfacePlanningProposal } from "@/app/lib/interfaces/proposal-schema";
import type { InterfacePlanningProblem } from "@/app/lib/interfaces/types";
import type { SystemArchitectureCandidate } from "@/app/lib/architecture/types";
import type { PowerArchitectureCandidate } from "@/app/lib/power/types";
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";
// [B16.0.9] canonical wrapper — authorization -> media -> bounded body run inside
// the wrapper; the callback receives the trusted context and parsed body only.
export const POST = authenticatedJsonRoute({ maxBytes: 8_000_000, deadlineMs: 30_000 }, async ({ context, body: rawBody }): Promise<Response> => {
  const body = rawBody as unknown as { problem?: InterfacePlanningProblem; architecture?: SystemArchitectureCandidate; power?: PowerArchitectureCandidate; proposal?: InterfacePlanningProposal }; const projectId = context.projectId, branchId = context.branchId, actorId = context.actor.actorId; if (!body.problem || !body.architecture || !body.power || !body.proposal || body.problem.projectId !== projectId || body.problem.branchId !== branchId) return Response.json({ ok: false, error: "interface candidate scope mismatch" }, { status: 403 }); const result = compileInterfacePlanningCandidate({ problem: body.problem, architecture: body.architecture, power: body.power, proposal: body.proposal, profile: EMBEDDED_MIXED_SIGNAL_INTERFACE_PROFILE_V1, actor: { actorId, actorKind: context.actor.actorKind, sessionId: context.actor.sessionId, role: context.actor.role }, createdAt: new Date().toISOString() }); return Response.json(result, { status: result.ok ? 200 : 422, headers: { "Cache-Control": "no-store" } }); });
