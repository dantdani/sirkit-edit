import { synthesizePowerArchitectureProposals } from "@/app/lib/power/alternatives";
import { EMBEDDED_LOW_VOLTAGE_POWER_PROFILE_V1 } from "@/app/lib/power/capability";
import { compilePowerArchitectureCandidate } from "@/app/lib/power/compiler";
import type { PowerArchitectureProblem } from "@/app/lib/power/types";
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";
// [B16.0.9] canonical wrapper — authorization -> media -> bounded body run inside
// the wrapper; the callback receives the trusted context and parsed body only.
export const POST = authenticatedJsonRoute({ maxBytes: 8_000_000, deadlineMs: 30_000 }, async ({ context, body: rawBody }): Promise<Response> => {
  const body = rawBody as unknown as { problem?: PowerArchitectureProblem; count?: number }; const projectId = context.projectId, branchId = context.branchId, actorId = context.actor.actorId; if (!body.problem || body.problem.projectId !== projectId || body.problem.branchId !== branchId) return Response.json({ ok: false, error: "power alternative scope mismatch" }, { status: 403 }); const proposals = synthesizePowerArchitectureProposals(body.problem, { candidateCount: body.count ?? 3, maximumRailPartitions: 32, maximumTopologyDepth: 4, maximumPatternCombinations: 16, timeBudgetMs: 2_000 }); const results = proposals.map((proposal) => compilePowerArchitectureCandidate({ problem: body.problem!, proposal, profile: EMBEDDED_LOW_VOLTAGE_POWER_PROFILE_V1, actor: { actorId, actorKind: "automated_engine", sessionId: "power-alternatives", role: "automation" }, createdAt: new Date().toISOString() })); if (results.some((item) => !item.ok)) return Response.json({ ok: false, results }, { status: 422 }); return Response.json({ ok: true, candidates: results.map((item) => item.ok ? item.candidate : null) }, { headers: { "Cache-Control": "no-store" } }); });
