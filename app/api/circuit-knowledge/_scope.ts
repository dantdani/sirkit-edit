/**
 * B16.0.1 §A — circuit-knowledge request scope, SERVER-DERIVED through the shared
 * authorization adapter. Identity/actor/role come from `TrustedRequestContext`
 * (never `x-sirkit-*` headers); the exact route policy enforces membership,
 * role, and same-origin CSRF automatically per method.
 */
import type { ActorKind, ProjectRole } from "@/app/lib/engineering/types";
import type { TrustedRequestContext } from "@/app/lib/auth/types";
import { scopedTrustedJson, flatScopeOf } from "@/app/lib/auth/authorize";

export const CIRCUIT_API_MAX_BYTES = 8_000_000;
/** [B16.0.19] the deadline `scopedTrustedJson` has always used for this family —
 *  it passes no `deadlineMs`, so the bounded reader's 30 s default applies. */
export const CIRCUIT_API_DEADLINE_MS = 30_000;
export interface CircuitApiScope { tenantId: string; projectId: string; branchId: string; actorId: string; actorKind: ActorKind; role: ProjectRole; sessionId: string; }
/** Request-free projection of the trusted context into the exact
 *  `CircuitApiScope` shape — delegates to the shared `flatScopeOf`. */
export function circuitKnowledgeScopeFromContext(context: TrustedRequestContext): CircuitApiScope {
  return flatScopeOf(context);
}

export function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }

export async function scopedJson(request: Request): Promise<{ ok: true; body: Record<string, unknown>; scope: CircuitApiScope } | { ok: false; response: Response }> {
  const scoped = await scopedTrustedJson(request, { maxBytes: CIRCUIT_API_MAX_BYTES });
  if (!scoped.ok) return scoped;
  return { ok: true, body: scoped.body, scope: flatScopeOf(scoped.context) };
}
