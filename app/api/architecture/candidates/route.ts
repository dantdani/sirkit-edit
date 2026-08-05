import { compileArchitectureCandidate } from "@/app/lib/architecture/compiler";
import type { ArchitectureCandidateProposal, ArchitectureProblem } from "@/app/lib/architecture/types";
import type { EngineeringActor } from "@/app/lib/engineering/types";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 4_000_000;
function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }

export async function POST(request: Request): Promise<Response> {
  const raw = await request.text(); if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return Response.json({ ok: false, error: "architecture candidate body is too large" }, { status: 413 });
  let parsed: unknown; try { parsed = JSON.parse(raw); } catch { return Response.json({ ok: false, error: "invalid JSON" }, { status: 400 }); }
  if (!object(parsed) || !object(parsed.problem) || !object(parsed.proposal)) return Response.json({ ok: false, error: "problem and proposal are required" }, { status: 400 });
  const projectId = request.headers.get("x-sirkit-project-id"); const branchId = request.headers.get("x-sirkit-branch-id"); const actorId = request.headers.get("x-sirkit-actor-id");
  if (!projectId || !branchId || !actorId) return Response.json({ ok: false, error: "project, branch, and actor scope headers are required" }, { status: 401 });
  const problem = parsed.problem as unknown as ArchitectureProblem; if (problem.projectId !== projectId || problem.branchId !== branchId) return Response.json({ ok: false, error: "architecture candidate scope mismatch" }, { status: 403 });
  const actor: EngineeringActor = { actorId, actorKind: request.headers.get("x-sirkit-actor-kind") === "ai" ? "ai" : "human", sessionId: request.headers.get("x-sirkit-session-id") ?? "api", role: request.headers.get("x-sirkit-role") === "project_admin" ? "project_admin" : "pcb_editor" };
  const result = compileArchitectureCandidate({ problem, proposal: parsed.proposal as unknown as ArchitectureCandidateProposal, actor, createdAt: new Date().toISOString(), ...(typeof parsed.provider === "string" ? { provider: parsed.provider } : {}), ...(typeof parsed.model === "string" ? { model: parsed.model } : {}) });
  return Response.json(result, { status: result.ok ? 200 : 422, headers: { "Cache-Control": "no-store" } });
}
