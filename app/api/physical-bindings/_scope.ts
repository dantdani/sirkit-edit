/**
 * B16.0 — physical-binding request scope, now SERVER-DERIVED (R02-B1-011).
 * Identity, actor kind, and role come from `resolveTrustedRequestContext`,
 * never from `x-sirkit-*` headers; client headers only request a selector.
 */
import type { EngineeringActor } from "@/app/lib/engineering/types";
import type { TrustedRequestContext } from "@/app/lib/auth/types";
import { authorizeRequest, scopedTrustedJson } from "@/app/lib/auth/authorize";

export const PHYSICAL_BINDING_API_MAX_BYTES = 2_000_000;
/** [B16.0.22] the deadline `scopedTrustedJson` has always used for this family —
 *  it passes no `deadlineMs`, so the bounded reader's 30 s default applies.
 *  The canonical-wrapper adopter passes this explicitly to preserve it. */
export const PHYSICAL_BINDING_API_DEADLINE_MS = 30_000;

export interface PhysicalBindingApiScope {
  tenantId: string;
  projectId: string;
  branchId: string;
  actor: EngineeringActor;
}

export function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }

/** Request-free projection of the trusted context into the binding scope —
 *  the canonical-wrapper equivalent of what `bindingScope` /
 *  `scopedBindingJson` returned. */
export function bindingScopeFromContext(context: TrustedRequestContext): PhysicalBindingApiScope {
  return { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId, actor: context.actor };
}

export async function bindingScope(request: Request): Promise<{ ok: true; scope: PhysicalBindingApiScope } | { ok: false; response: Response }> {
  const authorized = await authorizeRequest(request);
  if (!authorized.ok) return { ok: false, response: authorized.response };
  if (authorized.kind !== "authenticated") return { ok: false, response: Response.json({ ok: false, code: "PB_API_UNAUTHENTICATED" }, { status: 401 }) };
  const { context } = authorized;
  return { ok: true, scope: { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId, actor: context.actor } };
}

export async function scopedBindingJson(request: Request): Promise<{ ok: true; body: Record<string, unknown>; scope: PhysicalBindingApiScope } | { ok: false; response: Response }> {
  const scoped = await scopedTrustedJson(request, { maxBytes: PHYSICAL_BINDING_API_MAX_BYTES });
  if (!scoped.ok) return scoped;
  const { context } = scoped;
  return { ok: true, body: scoped.body, scope: { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId, actor: context.actor } };
}
