/**
 * B16.0.1 §A — passive-policy request scope, SERVER-DERIVED through the shared
 * authorization adapter. Identity/actor/role come from `TrustedRequestContext`
 * (never `x-sirkit-*` headers); the exact route policy enforces membership,
 * role, and same-origin CSRF automatically per method.
 */
import type { EngineeringActor } from "@/app/lib/engineering/types";
import type { TrustedRequestContext } from "@/app/lib/auth/types";
import { authorizeRequest, scopedTrustedJson } from "@/app/lib/auth/authorize";

export const PASSIVE_POLICY_API_MAX_BYTES = 64_000;
export interface PassivePolicyApiScope { tenantId: string; projectId: string; branchId: string; actor: EngineeringActor }

/** Request-free projection of the trusted context into the passive-policy
 *  scope — the canonical-wrapper equivalent of `passivePolicyApiScope`. */
export function passivePolicyScopeFromContext(context: TrustedRequestContext): PassivePolicyApiScope {
  return { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId, actor: context.actor };
}
export function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }

export async function passivePolicyApiScope(request: Request): Promise<{ ok: true; scope: PassivePolicyApiScope } | { ok: false; response: Response }> {
  const authorized = await authorizeRequest(request);
  if (!authorized.ok) return { ok: false, response: authorized.response };
  if (authorized.kind !== "authenticated") return { ok: false, response: Response.json({ ok: false, code: "API_UNAUTHENTICATED" }, { status: 401 }) };
  const { context } = authorized;
  return { ok: true, scope: { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId, actor: context.actor } };
}

/**
 * Route-specific forbidden-authoritative-input screen. Unlike the sibling
 * routes' exact-key `forbiddenBodyKeys` lists, this route has always refused
 * ANY top-level body key whose NAME matches this pattern (authoritative facts,
 * profiles, assets, mappings, evidence, paths, URLs, files, and snapshots are
 * server-owned). `scopedTrustedJson`'s `forbiddenBodyKeys` is an exact-key
 * check and cannot express a key-name pattern, so the screen stays here —
 * B16.0.1 must not weaken it.
 */
const FORBIDDEN_AUTHORITATIVE_KEY = /(?:context|profile|asset|mapping|evidence|path|url|file|snapshot)/i;

export async function scopedPassivePolicyJson(request: Request): Promise<{ ok: true; body: Record<string, unknown>; scope: PassivePolicyApiScope } | { ok: false; response: Response }> {
  const scoped = await scopedTrustedJson(request, { maxBytes: PASSIVE_POLICY_API_MAX_BYTES });
  if (!scoped.ok) return scoped;
  if (Object.keys(scoped.body).some((key) => FORBIDDEN_AUTHORITATIVE_KEY.test(key))) {
    return { ok: false, response: Response.json({ ok: false, code: "PP_API_AUTHORITATIVE_INPUT_FORBIDDEN", error: "Clients may send only scoped IDs and operations; authoritative facts, profiles, assets, mappings, evidence, paths, URLs, and snapshots are server-owned." }, { status: 400, headers: { "Cache-Control": "no-store" } }) };
  }
  const { context } = scoped;
  return { ok: true, body: scoped.body, scope: { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId, actor: context.actor } };
}
