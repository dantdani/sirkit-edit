import { defaultCircuitVerificationCapabilityProfile } from "@/app/lib/circuit-verification/capability";
import { compileCircuitVerificationProblem } from "@/app/lib/circuit-verification/problem";
import type { Cd9UpstreamCompletionSignoff, RuleRegistrySnapshot } from "@/app/lib/circuit-verification/types";
import type { SchematicProjectState } from "@/app/lib/schematic-compiler/types";
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";
import { object, circuitVerificationScopeFromContext, CIRCUIT_VERIFICATION_API_MAX_BYTES, CIRCUIT_VERIFICATION_API_DEADLINE_MS } from "../_scope";
export const runtime = "nodejs";

export const POST = authenticatedJsonRoute({ maxBytes: CIRCUIT_VERIFICATION_API_MAX_BYTES, deadlineMs: CIRCUIT_VERIFICATION_API_DEADLINE_MS }, async ({ context, body }): Promise<Response> => { const scope = circuitVerificationScopeFromContext(context);
  if (!object(body.schematicProject) || !object(body.upstreamSignoff) || !object(body.registry) || !Array.isArray(body.requirementRevisionRefs) || !Array.isArray(body.requiredContextKinds)) return Response.json({ ok: false, error: "approved CD-8 project, CD-1 through CD-8 signoff, approved registry, requirements, and contexts are required" }, { status: 400 });
  const schematicProject = body.schematicProject as unknown as SchematicProjectState;
  if (schematicProject.projectId !== scope.projectId || schematicProject.branchId !== scope.branchId) return Response.json({ ok: false, error: "circuit verification problem scope mismatch" }, { status: 403 });
  const result = compileCircuitVerificationProblem({ tenantId: scope.tenantId, branchId: scope.branchId, schematicProject, upstreamSignoff: body.upstreamSignoff as unknown as Cd9UpstreamCompletionSignoff, capabilityProfile: defaultCircuitVerificationCapabilityProfile(), registry: body.registry as unknown as RuleRegistrySnapshot, requirementRevisionRefs: body.requirementRevisionRefs as never, requiredContextKinds: body.requiredContextKinds as string[], actor: { actorId: scope.actorId, actorKind: scope.actorKind, sessionId: scope.sessionId, role: scope.role }, createdAt: new Date().toISOString() });
  return Response.json(result, { status: result.ok ? 200 : 422, headers: { "Cache-Control": "no-store" } });
});
