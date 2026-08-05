import type { MappingVerificationService } from "@/app/lib/mapping-verification/service";
import type { MappingStage4FeatureState } from "@/app/lib/mapping-verification/rollout";
import type { MappingMutationRequest, MappingRepositoryScope, MappingVerificationRequest } from "@/app/lib/mapping-verification/types";
import { object, scopedMappingJson } from "./_scope";

function errorResponse(error: unknown): Response { const message = error instanceof Error ? error.message : "MV_INTERNAL_ERROR", code = /^MV_[A-Z0-9_]+/.exec(message)?.[0] ?? "MV_INTERNAL_ERROR", status = code.includes("AUTHORIZATION") || code.includes("UNAUTHORIZED") || code.includes("SCOPE") ? 403 : code.includes("NOT_FOUND") ? 404 : code.includes("CONFLICT") || code.includes("STALE") || code.includes("DIGEST") || code.includes("REVISION") ? 409 : code.includes("LIMIT") || code.includes("PAYLOAD") ? 413 : code.includes("CANCELLED") || code.includes("TIMEOUT") ? 408 : 422; return Response.json({ ok: false, code, error: code }, { status, headers: { "Cache-Control": "no-store" } }); }

export function createMappingPostHandler(service: MappingVerificationService, featureState: () => MappingStage4FeatureState) {
  return async function post(request: Request): Promise<Response> {
    const parsed = await scopedMappingJson(request); if (!parsed.ok) return parsed.response;
    const { body, scope } = parsed, operation = typeof body.operation === "string" ? body.operation : "verify", state = featureState();
    if (state === "off") return Response.json({ ok: false, code: "MV_STAGE4_DISABLED", error: "Stage 4 mapping verification is disabled." }, { status: 503, headers: { "Cache-Control": "no-store" } });
    try {
      if (operation === "inspect" || operation === "verify") {
        if (!object(body.request)) return Response.json({ ok: false, code: "MV_API_REQUEST_REQUIRED" }, { status: 400 });
        const input = body.request as unknown as MappingVerificationRequest, scoped = { ...input, tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId, actorContext: scope.actor };
        const result = operation === "inspect" ? await service.inspect(scoped, request.signal) : await service.verify(scoped, request.signal);
        return Response.json({ ok: true, operation, readOnly: true, boardChanged: false, result }, { headers: { "Cache-Control": "no-store", "X-Sirkit-Mapping-Stage4": state } });
      }
      if (operation === "history") {
        if (!object(body.scope) || typeof body.requestedAt !== "string") return Response.json({ ok: false, code: "MV_API_SCOPE_REQUIRED" }, { status: 400 });
        const input = body.scope as unknown as MappingRepositoryScope, history = await service.history({ ...input, tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId }, scope.actor, body.requestedAt);
        return Response.json({ ok: true, operation, readOnly: true, boardChanged: false, history }, { headers: { "Cache-Control": "no-store" } });
      }
      if (["persist", "approve", "reject", "revoke", "mark_stale"].includes(operation)) {
        if (state !== "opt_in" && state !== "authoritative_supported_profile") return Response.json({ ok: false, code: "MV_MUTATION_ROLLOUT_BLOCKED" }, { status: 403, headers: { "Cache-Control": "no-store" } });
        if (request.headers.get("x-sirkit-mapping-mutation-opt-in")?.toLowerCase() !== "true") return Response.json({ ok: false, code: "MV_MUTATION_OPT_IN_REQUIRED" }, { status: 403, headers: { "Cache-Control": "no-store" } });
        if (!object(body.request)) return Response.json({ ok: false, code: "MV_API_REQUEST_REQUIRED" }, { status: 400 });
        const input = body.request as unknown as MappingMutationRequest, scoped = { ...input, tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId, actorContext: scope.actor };
        const result = operation === "persist" ? await service.persistVerification(scoped) : operation === "approve" ? await service.approve(scoped) : operation === "reject" ? await service.reject(scoped) : operation === "revoke" ? await service.revoke(scoped) : await service.markStale(scoped);
        return Response.json({ ok: true, operation, boardChanged: false, result }, { headers: { "Cache-Control": "no-store", "X-Sirkit-Mapping-Stage4": state } });
      }
      return Response.json({ ok: false, code: "MV_API_OPERATION_UNSUPPORTED" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    } catch (error) { return errorResponse(error); }
  };
}
