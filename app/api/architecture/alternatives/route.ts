import { synthesizeArchitectureProposals } from "@/app/lib/architecture/alternatives";
import { compileArchitectureCandidate } from "@/app/lib/architecture/compiler";
import type { ArchitectureProblem } from "@/app/lib/architecture/types";

import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";
// [B16.0.9] canonical wrapper — authorization -> media -> bounded body run inside
// the wrapper; the callback receives the trusted context and parsed body only.
export const POST = authenticatedJsonRoute({ maxBytes: 8_000_000, deadlineMs: 30_000 }, async ({ context, body: rawBody }): Promise<Response> => {
  const parsed = rawBody as unknown as { problem?: ArchitectureProblem; count?: number };
  const projectId = context.projectId; const branchId = context.branchId; const actorId = context.actor.actorId;
  if (!parsed.problem || parsed.problem.projectId !== projectId || parsed.problem.branchId !== branchId) return Response.json({ ok: false, error: "architecture alternative scope mismatch" }, { status: 403 });
  const proposals = synthesizeArchitectureProposals(parsed.problem, { candidateCount: parsed.count ?? 3, maxBlocks: 64, maxSearchDepth: 3, timeBudgetMs: 2_000 });
  const candidates = proposals.map((proposal) => compileArchitectureCandidate({ problem: parsed.problem!, proposal, actor: { actorId, actorKind: "automated_engine", sessionId: "architecture-alternatives", role: "automation" }, createdAt: new Date().toISOString() }));
  const failed = candidates.filter((item) => !item.ok); if (failed.length) return Response.json({ ok: false, results: candidates }, { status: 422 });
  return Response.json({ ok: true, candidates: candidates.map((item) => item.ok ? item.candidate : null) }, { status: 200, headers: { "Cache-Control": "no-store" } });
});
