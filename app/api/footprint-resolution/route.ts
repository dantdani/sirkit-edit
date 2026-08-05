import { PostgresPhysicalBindingRepository } from "@/app/lib/physical-binding/server-repository";
import { FootprintResolutionService } from "@/app/lib/footprint-resolver/service";
import { compareLegacyResolution, type LegacyResolutionObservation } from "@/app/lib/footprint-resolver/shadow";
import { DEFAULT_FOOTPRINT_RESOLUTION_POLICY } from "@/app/lib/footprint-resolver/policy";
import type { FootprintResolutionBatchRequest, FootprintResolutionRequest } from "@/app/lib/footprint-resolver/types";
import { FOOTPRINT_RESOLVER_NORMALIZATION_VERSION, FOOTPRINT_RESOLUTION_REQUEST_VERSION, FOOTPRINT_RESOLUTION_RESULT_VERSION, FOOTPRINT_RESOLVER_VERSION } from "@/app/lib/footprint-resolver/types";
import { object, resolutionScope, scopedResolutionJson, type ResolutionApiScope } from "./_scope";

export const runtime = "nodejs";
const service = new FootprintResolutionService(new PostgresPhysicalBindingRepository());

function errorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : "FR_INTERNAL_ERROR";
  const code = /^FR_[A-Z0-9_]+/.exec(message)?.[0] ?? "FR_INTERNAL_ERROR";
  const status = code.includes("AUTHORIZATION") || code.includes("UNAUTHORIZED") ? 403 : code.includes("NOT_FOUND") ? 404 : code.includes("REVISION") || code.includes("SNAPSHOT") ? 409 : code.includes("LIMIT") || code.includes("PAYLOAD") ? 413 : code === "FR_REQUEST_CANCELLED" ? 408 : 422;
  return Response.json({ ok: false, code, error: code }, { status, headers: { "Cache-Control": "no-store" } });
}

function scopedRequest(value: Record<string, unknown>, scope: ResolutionApiScope): FootprintResolutionRequest {
  return { ...(value as unknown as FootprintResolutionRequest), schemaVersion: FOOTPRINT_RESOLUTION_REQUEST_VERSION, tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId, actorContext: scope.actor };
}

export async function GET(request: Request): Promise<Response> {
  const authorized = resolutionScope(request);
  if (!authorized.ok) return authorized.response;
  return Response.json({ ok: true, readOnly: true, requestSchemaVersion: FOOTPRINT_RESOLUTION_REQUEST_VERSION, resultSchemaVersion: FOOTPRINT_RESOLUTION_RESULT_VERSION, resolverVersion: FOOTPRINT_RESOLVER_VERSION, normalizationVersion: FOOTPRINT_RESOLVER_NORMALIZATION_VERSION, policy: DEFAULT_FOOTPRINT_RESOLUTION_POLICY, productionPcbSyncAuthority: "legacy_until_stage3", cache: { mode: "disabled", reason: "Measured pure evaluation is fast; avoiding cache invalidation risk in Stage 2." } }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const parsed = await scopedResolutionJson(request);
  if (!parsed.ok) return parsed.response;
  const { body, scope } = parsed;
  const operation = typeof body.operation === "string" ? body.operation : "resolve";
  try {
    if (operation === "resolve" || operation === "explain") {
      if (!object(body.request)) return Response.json({ ok: false, code: "FR_API_REQUEST_REQUIRED", error: "request object is required." }, { status: 400 });
      const result = operation === "explain" ? await service.explain(scopedRequest(body.request, scope), request.signal) : await service.resolve(scopedRequest(body.request, scope), request.signal);
      return Response.json({ ok: true, readOnly: true, result }, { headers: { "Cache-Control": "no-store" } });
    }
    if (operation === "batch") {
      if (!object(body.batch) || !Array.isArray(body.batch.requests)) return Response.json({ ok: false, code: "FR_API_BATCH_REQUIRED", error: "batch with requests[] is required." }, { status: 400 });
      const batch: FootprintResolutionBatchRequest = { ...(body.batch as unknown as FootprintResolutionBatchRequest), schemaVersion: "sirkit.footprint-resolution-batch-request.v1", requests: body.batch.requests.map((item) => {
        if (!object(item)) throw new Error("FR_BATCH_REQUEST_INVALID");
        return scopedRequest(item, scope);
      }) };
      const result = await service.resolveBatch(batch, request.signal);
      return Response.json({ ok: true, readOnly: true, result }, { headers: { "Cache-Control": "no-store" } });
    }
    if (operation === "compare") {
      if (!object(body.request) || !object(body.legacy)) return Response.json({ ok: false, code: "FR_API_COMPARISON_REQUIRED", error: "request and legacy observation are required." }, { status: 400 });
      const legacy = body.legacy as unknown as LegacyResolutionObservation;
      if (!["resolved", "unresolved", "error"].includes(legacy.status) || !["atomic-approved", "hint", "heuristic", "default", "manual", "none", "error"].includes(legacy.source) || (legacy.footprint !== null && typeof legacy.footprint !== "string") || typeof legacy.guessedOrDefaulted !== "boolean") throw new Error("FR_LEGACY_OBSERVATION_INVALID");
      const result = await service.resolve(scopedRequest(body.request, scope), request.signal);
      return Response.json({ ok: true, readOnly: true, result, comparison: compareLegacyResolution(legacy, result) }, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ ok: false, code: "FR_API_OPERATION_UNSUPPORTED", error: "Unsupported resolution operation." }, { status: 400 });
  } catch (error) { return errorResponse(error); }
}
