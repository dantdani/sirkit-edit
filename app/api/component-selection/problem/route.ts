import { EMBEDDED_COMPONENT_SELECTION_PROFILE_V1 } from "@/app/lib/component-selection/capability";
import { compileComponentSelectionProblem } from "@/app/lib/component-selection/problem";
import type { ComponentSelectionProblemInput } from "@/app/lib/component-selection/types";
import { object, scopedJson } from "../_scope";
export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  const parsed = await scopedJson(request); if (!parsed.ok) return parsed.response; const { body, scope } = parsed;
  if (![body.requirementsPackage, body.architectureState, body.powerState, body.interfaceState, body.circuitKnowledgeState, body.upstreamSignoff].every(object)) return Response.json({ ok: false, error: "pinned CD-1 through CD-5 states and exact completion signoff are required" }, { status: 400 });
  const input = body as unknown as ComponentSelectionProblemInput;
  if (input.tenantId !== scope.tenantId || input.branchId !== scope.branchId || input.requirementsPackage.projectId !== scope.projectId || input.architectureState.projectId !== scope.projectId || input.powerState.projectId !== scope.projectId || input.interfaceState.projectId !== scope.projectId || input.circuitKnowledgeState.projectId !== scope.projectId) return Response.json({ ok: false, error: "component selection problem scope mismatch" }, { status: 403 });
  const result = compileComponentSelectionProblem({ ...input, capabilityProfile: EMBEDDED_COMPONENT_SELECTION_PROFILE_V1, actor: { actorId: scope.actorId, actorKind: scope.actorKind, sessionId: scope.sessionId, role: scope.role }, createdAt: new Date().toISOString() });
  return Response.json(result, { status: result.ok ? 200 : 422, headers: { "Cache-Control": "no-store" } });
}
