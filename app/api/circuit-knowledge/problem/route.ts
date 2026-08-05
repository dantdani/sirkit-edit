import { EMBEDDED_CIRCUIT_KNOWLEDGE_PROFILE_V1 } from "@/app/lib/circuit-knowledge/capability";
import { compileCircuitKnowledgeProblem } from "@/app/lib/circuit-knowledge/problem";
import type { CircuitKnowledgeProblemInput } from "@/app/lib/circuit-knowledge/types";
import { object, scopedJson } from "../_scope";
export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  const parsed = await scopedJson(request); if (!parsed.ok) return parsed.response; const { body, scope } = parsed;
  if (!object(body.requirementsPackage) || !object(body.architectureState) || !object(body.powerState) || !object(body.interfaceState) || !object(body.upstreamSignoff) || !object(body.pcbFoundationSignoff)) return Response.json({ ok: false, error: "pinned CD-1 through CD-4 states plus PCB foundation and exact completion signoffs are required" }, { status: 400 });
  const input = body as unknown as CircuitKnowledgeProblemInput;
  if (input.tenantId !== scope.tenantId || input.branchId !== scope.branchId || input.requirementsPackage.projectId !== scope.projectId || input.architectureState.projectId !== scope.projectId || input.powerState.projectId !== scope.projectId || input.interfaceState.projectId !== scope.projectId) return Response.json({ ok: false, error: "circuit knowledge problem scope mismatch" }, { status: 403 });
  const result = compileCircuitKnowledgeProblem({ ...input, capabilityProfile: EMBEDDED_CIRCUIT_KNOWLEDGE_PROFILE_V1, actor: { actorId: scope.actorId, actorKind: scope.actorKind, sessionId: scope.sessionId, role: scope.role }, createdAt: new Date().toISOString() });
  return Response.json(result, { status: result.ok ? 200 : 422, headers: { "Cache-Control": "no-store" } });
}
