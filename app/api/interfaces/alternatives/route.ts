import { synthesizeInterfacePlanningProposals } from "@/app/lib/interfaces/alternatives";
import { EMBEDDED_MIXED_SIGNAL_INTERFACE_PROFILE_V1 } from "@/app/lib/interfaces/capability";
import { compileInterfacePlanningCandidate } from "@/app/lib/interfaces/compiler";
import type { InterfacePlanningProblem } from "@/app/lib/interfaces/types";
import type { SystemArchitectureCandidate } from "@/app/lib/architecture/types";
import type { PowerArchitectureCandidate } from "@/app/lib/power/types";
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";
// [B16.0.9] canonical wrapper — authorization -> media -> bounded body run inside
// the wrapper; the callback receives the trusted context and parsed body only.
export const POST = authenticatedJsonRoute({ maxBytes: 8_000_000, deadlineMs: 30_000 }, async ({ context, body: rawBody }): Promise<Response> => {
  const body = rawBody as unknown as { problem?: InterfacePlanningProblem; architecture?: SystemArchitectureCandidate; power?: PowerArchitectureCandidate; count?: number }; const projectId = context.projectId, branchId = context.branchId, actorId = context.actor.actorId; if (!body.problem || !body.architecture || !body.power || body.problem.projectId !== projectId || body.problem.branchId !== branchId) return Response.json({ ok: false, error: "interface alternative scope mismatch" }, { status: 403 }); try { const proposals = synthesizeInterfacePlanningProposals(body.problem, body.architecture, body.count ?? 3); const results = proposals.map((proposal) => compileInterfacePlanningCandidate({ problem: body.problem!, architecture: body.architecture!, power: body.power!, proposal, profile: EMBEDDED_MIXED_SIGNAL_INTERFACE_PROFILE_V1, actor: { actorId, actorKind: "automated_engine", sessionId: "interface-alternatives", role: "automation" }, createdAt: new Date().toISOString() })); if (results.some((item) => !item.ok)) return Response.json({ ok: false, results }, { status: 422 }); return Response.json({ ok: true, candidates: results.map((item) => item.ok ? item.candidate : null) }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return Response.json({ ok: false, error: error instanceof Error ? error.message : "alternative generation failed" }, { status: 422 }); } });
