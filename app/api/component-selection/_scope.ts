/**
 * B16.0.1 §A — component-selection request scope, SERVER-DERIVED through the shared
 * authorization adapter. Identity/actor/role come from `TrustedRequestContext`
 * (never `x-sirkit-*` headers); the exact route policy enforces membership,
 * role, and same-origin CSRF automatically per method.
 */
import type { ActorKind, ProjectRole } from "@/app/lib/engineering/types";
import type { TrustedRequestContext } from "@/app/lib/auth/types";
import { scopedTrustedJson, flatScopeOf } from "@/app/lib/auth/authorize";

export const COMPONENT_SELECTION_API_MAX_BYTES = 12_000_000;
/** [B16.0.18] the deadline `scopedTrustedJson` has always used for this family —
 *  it passes no `deadlineMs`, so the bounded reader's 30 s default applies.
 *  Canonical-wrapper adopters pass this explicitly to preserve the contract. */
export const COMPONENT_SELECTION_API_DEADLINE_MS = 30_000;
export interface ComponentSelectionApiScope { tenantId: string; projectId: string; branchId: string; actorId: string; actorKind: ActorKind; role: ProjectRole; sessionId: string; }

/** Request-free projection of the trusted context into the exact
 *  `ComponentSelectionApiScope` shape — delegates to the shared `flatScopeOf`,
 *  the same projection `scopedJson` used. */
export function componentSelectionScopeFromContext(context: TrustedRequestContext): ComponentSelectionApiScope {
  return flatScopeOf(context);
}
export function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }

export async function scopedJson(request: Request): Promise<{ ok: true; body: Record<string, unknown>; scope: ComponentSelectionApiScope } | { ok: false; response: Response }> {
  const scoped = await scopedTrustedJson(request, { maxBytes: COMPONENT_SELECTION_API_MAX_BYTES });
  if (!scoped.ok) return scoped;
  return { ok: true, body: scoped.body, scope: flatScopeOf(scoped.context) };
}
