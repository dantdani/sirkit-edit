/**
 * B16.0.1 §A — mapping-verification request scope, SERVER-DERIVED through the shared
 * authorization adapter. Identity/actor/role come from `TrustedRequestContext`
 * (never `x-sirkit-*` headers); the exact route policy enforces membership,
 * role, and same-origin CSRF automatically per method.
 */
import type { EngineeringActor } from "@/app/lib/engineering/types";
import { authorizeRequest, scopedTrustedJson } from "@/app/lib/auth/authorize";

export const MAPPING_API_MAX_BYTES = 4_000_000;
export interface MappingApiScope { tenantId: string; projectId: string; branchId: string; actor: EngineeringActor }
export function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }

export async function mappingApiScope(request: Request): Promise<{ ok: true; scope: MappingApiScope } | { ok: false; response: Response }> {
  const authorized = await authorizeRequest(request);
  if (!authorized.ok) return { ok: false, response: authorized.response };
  if (authorized.kind !== "authenticated") return { ok: false, response: Response.json({ ok: false, code: "API_UNAUTHENTICATED" }, { status: 401 }) };
  const { context } = authorized;
  return { ok: true, scope: { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId, actor: context.actor } };
}

export async function scopedMappingJson(request: Request): Promise<{ ok: true; body: Record<string, unknown>; scope: MappingApiScope } | { ok: false; response: Response }> {
  // B16.0.1: clients must never upload authoritative assets, evidence,
  // mappings, paths, or URLs through this API. The exact pre-B16.0.1 forbidden
  // key list is preserved through the shared adapter's `forbiddenBodyKeys`
  // (refused 400 AUTH_AUTHORITATIVE_INPUT_FORBIDDEN), matching pcb-sync and
  // assignment-queue.
  const scoped = await scopedTrustedJson(request, { maxBytes: MAPPING_API_MAX_BYTES, forbiddenBodyKeys: ["context", "candidate", "snapshot", "path", "url", "evidence"] });
  if (!scoped.ok) return scoped;
  const { context } = scoped;
  return { ok: true, body: scoped.body, scope: { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId, actor: context.actor } };
}
