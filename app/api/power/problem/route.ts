import { compilePowerArchitectureProblem } from "@/app/lib/power/problem";
import { EMBEDDED_LOW_VOLTAGE_POWER_PROFILE_V1 } from "@/app/lib/power/capability";
import type { PowerProblemCompileInput } from "@/app/lib/power/types";

export const runtime = "nodejs"; const MAX = 6_000_000;
function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
export async function POST(request: Request): Promise<Response> {
  const raw = await request.text(); if (new TextEncoder().encode(raw).byteLength > MAX) return Response.json({ ok: false, error: "power problem body is too large" }, { status: 413 }); let body: unknown; try { body = JSON.parse(raw); } catch { return Response.json({ ok: false, error: "invalid JSON" }, { status: 400 }); }
  const tenantId = request.headers.get("x-sirkit-tenant-id"), projectId = request.headers.get("x-sirkit-project-id"), branchId = request.headers.get("x-sirkit-branch-id"), actorId = request.headers.get("x-sirkit-actor-id"); if (!tenantId || !projectId || !branchId || !actorId) return Response.json({ ok: false, error: "tenant, project, branch, and actor scope headers are required" }, { status: 401 });
  if (!object(body) || !object(body.requirementsPackage) || !object(body.architectureState) || !object(body.upstreamSignoff) || !object(body.capabilityProfile)) return Response.json({ ok: false, error: "pinned CD-1, CD-2, signoff, and power capability inputs are required" }, { status: 400 });
  const input = body as unknown as PowerProblemCompileInput; if (input.requirementsPackage.projectId !== projectId || input.architectureState.projectId !== projectId || input.branchId !== branchId || input.tenantId !== tenantId) return Response.json({ ok: false, error: "power problem scope mismatch" }, { status: 403 });
  const result = compilePowerArchitectureProblem({ ...input, tenantId, branchId, capabilityProfile: EMBEDDED_LOW_VOLTAGE_POWER_PROFILE_V1, policyProfileRevision: "sirkit-power-policy/1", ruleModelRegistryRevision: "sirkit-power-rules/1", actor: { actorId, actorKind: request.headers.get("x-sirkit-actor-kind") === "ai" ? "ai" : "human", sessionId: request.headers.get("x-sirkit-session-id") ?? "power-problem", role: request.headers.get("x-sirkit-role") === "project_admin" ? "project_admin" : "pcb_editor" }, createdAt: new Date().toISOString() }); return Response.json(result, { status: result.ok ? 200 : 422, headers: { "Cache-Control": "no-store" } });
}
