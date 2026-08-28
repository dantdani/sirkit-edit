/**
 * B16.0 — PCB-sync request scope, now SERVER-DERIVED.
 *
 * R02-B1-011 fix: this file no longer reads the actor id, actor kind, or
 * project role from `x-sirkit-*` headers. Identity, actor kind, and role are
 * derived by `resolveTrustedRequestContext` (Supabase in production; the
 * fixed local principal in local_dev; a test-injected fake). Client headers
 * may only REQUEST a tenant/project/branch selector. This is the chokepoint
 * for `/api/pcb-sync`, `/api/pcb/qualify`, and `/api/pcb/release`.
 */

import type { EngineeringActor } from "@/app/lib/engineering/types";
import type { TrustedRequestContext } from "@/app/lib/auth/types";
import { authorizeRequest, scopedTrustedJson } from "@/app/lib/auth/authorize";
import { jsonError } from "@/app/lib/auth/request-security";

export const PCB_SYNC_API_MAX_BYTES = 8_000_000;
/** [B16.0.15] the deadline `scopedTrustedJson` has always used for this family —
 *  it passes no `deadlineMs`, so the bounded reader's 30 s default applies.
 *  Canonical-wrapper adopters pass this explicitly to preserve the contract. */
export const PCB_SYNC_API_DEADLINE_MS = 30_000;
/** Server-authoritative fields a client may never supply in a scope body. */
export const PCB_SYNC_FORBIDDEN_BODY_KEYS = ["snapshot", "board", "path"] as const;

export interface PcbSyncApiScope {
  tenantId: string;
  projectId: string;
  branchId: string;
  actor: EngineeringActor;
}

export function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Request-free projection of the trusted context into the PCB-sync scope —
 *  the canonical-wrapper equivalent of what `scopedPcbSyncJson` returned. */
export function pcbSyncScopeFromContext(context: TrustedRequestContext): PcbSyncApiScope {
  return { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId, actor: context.actor };
}

/** The EXACT historical forbidden-authority-field refusal (byte-identical to
 *  `scopedTrustedJson`'s: generic message, no key suffix, no-store). Returned
 *  before any durable work. Request-free — takes the parsed body only. */
export function pcbSyncForbiddenAuthorityRefusal(body: Record<string, unknown>): Response | null {
  for (const key of PCB_SYNC_FORBIDDEN_BODY_KEYS) {
    if (key in body) return jsonError(400, "AUTH_AUTHORITATIVE_INPUT_FORBIDDEN", "The request body carries a forbidden authoritative field.");
  }
  return null;
}

/**
 * B16.0.1: derive the trusted scope for a PCB-sync-family request through the
 * ONE authorization adapter, which enforces the EXACT method-aware route
 * policy (identity + membership + role + same-origin CSRF) for the actual
 * request path — so `/api/pcb/release` requires `project_admin`,
 * `/api/pcb/qualify` requires pcb_editor/admin, and a cross-origin POST is
 * refused — automatically, before this returns.
 */
export async function pcbSyncScope(request: Request): Promise<{ ok: true; scope: PcbSyncApiScope } | { ok: false; response: Response }> {
  const authorized = await authorizeRequest(request);
  if (!authorized.ok) return { ok: false, response: authorized.response };
  if (authorized.kind !== "authenticated") return { ok: false, response: Response.json({ ok: false, code: "PS_API_UNAUTHENTICATED" }, { status: 401, headers: { "Cache-Control": "no-store" } }) };
  const { context } = authorized;
  return { ok: true, scope: { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId, actor: context.actor } };
}

export async function scopedPcbSyncJson(request: Request): Promise<{ ok: true; body: Record<string, unknown>; scope: PcbSyncApiScope } | { ok: false; response: Response }> {
  const scoped = await scopedTrustedJson(request, { maxBytes: PCB_SYNC_API_MAX_BYTES, forbiddenBodyKeys: ["snapshot", "board", "path"] });
  if (!scoped.ok) return scoped;
  const { context } = scoped;
  return { ok: true, body: scoped.body, scope: { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId, actor: context.actor } };
}
