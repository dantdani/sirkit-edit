/**
 * B16.0.1 §A — footprint-resolution request scope, SERVER-DERIVED through the shared
 * authorization adapter. Identity/actor/role come from `TrustedRequestContext`
 * (never `x-sirkit-*` headers); the exact route policy enforces membership,
 * role, and same-origin CSRF automatically per method.
 */
import type { EngineeringActor } from "@/app/lib/engineering/types";
import type { TrustedRequestContext } from "@/app/lib/auth/types";
import { authorizeRequest, scopedTrustedJson } from "@/app/lib/auth/authorize";

export const FOOTPRINT_RESOLUTION_API_MAX_BYTES = 4_000_000;
/** [B16.0.22] the deadline `scopedTrustedJson` has always used for this family —
 *  it passes no `deadlineMs`, so the bounded reader's 30 s default applies.
 *  The canonical-wrapper adopter passes this explicitly to preserve it. */
export const FOOTPRINT_RESOLUTION_API_DEADLINE_MS = 30_000;
export interface ResolutionApiScope { tenantId: string; projectId: string; branchId: string; actor: EngineeringActor }

/** Request-free projection of the trusted context into the resolution scope —
 *  the canonical-wrapper equivalent of what `scopedResolutionJson` returned. */
export function resolutionScopeFromContext(context: TrustedRequestContext): ResolutionApiScope {
  return { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId, actor: context.actor };
}
export function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }

export async function resolutionScope(request: Request): Promise<{ ok: true; scope: ResolutionApiScope } | { ok: false; response: Response }> {
  const authorized = await authorizeRequest(request);
  if (!authorized.ok) return { ok: false, response: authorized.response };
  if (authorized.kind !== "authenticated") return { ok: false, response: Response.json({ ok: false, code: "API_UNAUTHENTICATED" }, { status: 401 }) };
  const { context } = authorized;
  return { ok: true, scope: { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId, actor: context.actor } };
}

export async function scopedResolutionJson(request: Request): Promise<{ ok: true; body: Record<string, unknown>; scope: ResolutionApiScope } | { ok: false; response: Response }> {
  const scoped = await scopedTrustedJson(request, { maxBytes: FOOTPRINT_RESOLUTION_API_MAX_BYTES });
  if (!scoped.ok) return scoped;
  const { context } = scoped;
  return { ok: true, body: scoped.body, scope: { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId, actor: context.actor } };
}
