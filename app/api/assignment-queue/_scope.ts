/**
 * B16.0 — assignment-queue request scope, now SERVER-DERIVED (R02-B1-011).
 * Identity, actor kind, and role come from `resolveTrustedRequestContext`,
 * never from `x-sirkit-*` headers. Same-origin CSRF, media-type, and size
 * guards are preserved.
 */
import type { EngineeringActor } from "@/app/lib/engineering/types";
import type { TrustedRequestContext } from "@/app/lib/auth/types";
import { authorizeRequest, scopedTrustedJson } from "@/app/lib/auth/authorize";
import { jsonError } from "@/app/lib/auth/request-security";

export const ASSIGNMENT_API_MAX_BYTES = 1_000_000;
/** [B16.0.22] the deadline `scopedTrustedJson` has always used for this family —
 *  it passes no `deadlineMs`, so the bounded reader's 30 s default applies.
 *  The canonical-wrapper adopter passes this explicitly to preserve it. */
export const ASSIGNMENT_API_DEADLINE_MS = 30_000;
/** Server-authoritative fields a client may never supply (historical list). */
export const ASSIGNMENT_FORBIDDEN_BODY_KEYS = ["sourceBundle", "binding", "mappingRecord", "policyRecord", "board", "path", "url"] as const;
export interface AssignmentApiScope { tenantId: string; projectId: string; branchId: string; actor: EngineeringActor }

/** Request-free projection of the trusted context into the assignment scope —
 *  the canonical-wrapper equivalent of what `assignmentApiScope` /
 *  `scopedAssignmentJson` returned. */
export function assignmentScopeFromContext(context: TrustedRequestContext): AssignmentApiScope {
  return { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId, actor: context.actor };
}

/** The EXACT historical forbidden-authority-field refusal (byte-identical to
 *  `scopedTrustedJson`'s: generic message, no key suffix, no-store). Returned
 *  before any feature-state or durable work. Request-free. */
export function assignmentForbiddenAuthorityRefusal(body: Record<string, unknown>): Response | null {
  for (const key of ASSIGNMENT_FORBIDDEN_BODY_KEYS) {
    if (key in body) return jsonError(400, "AUTH_AUTHORITATIVE_INPUT_FORBIDDEN", "The request body carries a forbidden authoritative field.");
  }
  return null;
}
export function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }

export async function assignmentApiScope(request: Request): Promise<{ ok: true; scope: AssignmentApiScope } | { ok: false; response: Response }> {
  // Same-origin CSRF is now enforced automatically by the route policy inside
  // authorizeRequest (POST is a mutation) — a caller cannot forget it.
  const authorized = await authorizeRequest(request);
  if (!authorized.ok) return { ok: false, response: authorized.response };
  if (authorized.kind !== "authenticated") return { ok: false, response: Response.json({ ok: false, code: "AQ_API_UNAUTHENTICATED" }, { status: 401 }) };
  const { context } = authorized;
  return { ok: true, scope: { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId, actor: context.actor } };
}

export async function scopedAssignmentJson(request: Request): Promise<{ ok: true; body: Record<string, unknown>; scope: AssignmentApiScope } | { ok: false; response: Response }> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > ASSIGNMENT_API_MAX_BYTES) return { ok: false, response: Response.json({ ok: false, code: "AQ_API_PAYLOAD_TOO_LARGE" }, { status: 413 }) };
  const scoped = await scopedTrustedJson(request, { maxBytes: ASSIGNMENT_API_MAX_BYTES, forbiddenBodyKeys: ASSIGNMENT_FORBIDDEN_BODY_KEYS });
  if (!scoped.ok) return scoped;
  const { context } = scoped;
  return { ok: true, body: scoped.body, scope: { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId, actor: context.actor } };
}
