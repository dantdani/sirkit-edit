import { synthesizeArchitectureProposals } from "@/app/lib/architecture/alternatives";
import { compileArchitectureCandidate } from "@/app/lib/architecture/compiler";
import type { ArchitectureProblem } from "@/app/lib/architecture/types";

export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  let parsed: { problem?: ArchitectureProblem; count?: number }; try { parsed = await request.json(); } catch { return Response.json({ ok: false, error: "invalid JSON" }, { status: 400 }); }
  const projectId = request.headers.get("x-sirkit-project-id"); const branchId = request.headers.get("x-sirkit-branch-id"); const actorId = request.headers.get("x-sirkit-actor-id"); if (!projectId || !branchId || !actorId) return Response.json({ ok: false, error: "scope headers are required" }, { status: 401 });
  if (!parsed.problem || parsed.problem.projectId !== projectId || parsed.problem.branchId !== branchId) return Response.json({ ok: false, error: "architecture alternative scope mismatch" }, { status: 403 });
  const proposals = synthesizeArchitectureProposals(parsed.problem, { candidateCount: parsed.count ?? 3, maxBlocks: 64, maxSearchDepth: 3, timeBudgetMs: 2_000 });
  const candidates = proposals.map((proposal) => compileArchitectureCandidate({ problem: parsed.problem!, proposal, actor: { actorId, actorKind: "automated_engine", sessionId: "architecture-alternatives", role: "automation" }, createdAt: new Date().toISOString() }));
  const failed = candidates.filter((item) => !item.ok); if (failed.length) return Response.json({ ok: false, results: candidates }, { status: 422 });
  return Response.json({ ok: true, candidates: candidates.map((item) => item.ok ? item.candidate : null) }, { status: 200, headers: { "Cache-Control": "no-store" } });
}
