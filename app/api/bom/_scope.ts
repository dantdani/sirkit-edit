/**
 * [B16.0.11 §E] Request-FREE ownership projection for the durable BOM routes
 * (snapshot / notifications / diff).
 *
 * Authorization now runs inside the canonical route wrappers
 * (`authenticatedJsonRoute` / `authenticatedRoute` from
 * `app/lib/auth/route-handlers.ts`) BEFORE any body consumption or repository
 * access. This module no longer touches a `Request` and carries NO
 * authorization capability — it only PROJECTS the already-trusted context into
 * the ownership scope the repository accepts. The former request-taking scope
 * helper (which held raw-request + boundary-call capability) is REMOVED so no
 * BOM route can bypass the canonical wrapper through a parallel path.
 */

import type { TrustedRequestContext } from "@/app/lib/auth/types";
import type { BomOwnershipScope } from "@/app/lib/bom/snapshot-repository";

/** The ONLY ownership key the repository accepts — server-derived, never from
 *  the body or query. */
export function bomOwnershipScope(context: TrustedRequestContext): BomOwnershipScope {
  return { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId };
}

/** Body fields that would claim ownership/authority — refused outright. */
export const BOM_FORBIDDEN_BODY_KEYS = ["projectKey", "tenantId", "projectId", "branchId", "actor", "actorId", "role"] as const;

export function bomNotFound(what: string): Response {
  return Response.json({ ok: false, code: "BOM_NOT_FOUND", error: `${what} not found.` }, { status: 404, headers: { "Cache-Control": "no-store" } });
}
