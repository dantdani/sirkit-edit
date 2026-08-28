import { compileArchitectureCandidate } from "@/app/lib/architecture/compiler";
import type { ArchitectureCandidateProposal, ArchitectureProblem } from "@/app/lib/architecture/types";
import type { EngineeringActor } from "@/app/lib/engineering/types";

import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";
function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }

// [B16.0.9] canonical wrapper — authorization -> media -> bounded body run inside
// the wrapper; the callback receives the trusted context and parsed body only.
export const POST = authenticatedJsonRoute({ maxBytes: 8_000_000, deadlineMs: 30_000 }, async ({ context, body: rawBody }): Promise<Response> => {
  const parsed: unknown = rawBody;
  if (!object(parsed) || !object(parsed.problem) || !object(parsed.proposal)) return Response.json({ ok: false, error: "problem and proposal are required" }, { status: 400 });
  const projectId = context.projectId; const branchId = context.branchId;
  const problem = parsed.problem as unknown as ArchitectureProblem; if (problem.projectId !== projectId || problem.branchId !== branchId) return Response.json({ ok: false, error: "architecture candidate scope mismatch" }, { status: 403 });
  const actor: EngineeringActor = { actorId: context.actor.actorId, actorKind: context.actor.actorKind, sessionId: context.actor.sessionId, role: context.actor.role };
  const result = compileArchitectureCandidate({ problem, proposal: parsed.proposal as unknown as ArchitectureCandidateProposal, actor, createdAt: new Date().toISOString(), ...(typeof parsed.provider === "string" ? { provider: parsed.provider } : {}), ...(typeof parsed.model === "string" ? { model: parsed.model } : {}) });
  return Response.json(result, { status: result.ok ? 200 : 422, headers: { "Cache-Control": "no-store" } });
});
