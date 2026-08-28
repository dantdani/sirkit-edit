/**
 * [B16.0.2 §B] the ONE authorization + scope helper for every SPICE run
 * route (list/start/get/cancel/bundle/events/waveforms).
 *
 * Authorization runs through the shared `authorizeRequest` boundary (exact
 * policy: identity + membership + role + automatic CSRF) BEFORE any job-store
 * access, stream creation, listener registration, artifact read, or
 * cancellation. The resulting TRUSTED scope `{ tenantId, projectId,
 * branchId }` is what the job store requires on every operation — a foreign
 * scope learns nothing (uniform bounded 404 via `runNotFound`).
 *
 * Browser surfaces that cannot set headers (EventSource, anchor downloads)
 * may carry the project SELECTOR in the query string (`tenantId`, `projectId`,
 * `branchId`). A selector is never authority: membership is still loaded
 * server-side for exactly that scope. Design data never enters a URL — only
 * opaque ids.
 */

import { authorizeRequest } from "@/app/lib/auth/authorize";
import type { TrustedRequestContext, ProjectSelector } from "@/app/lib/auth/types";
import type { RunScope } from "@/app/lib/spice/server/job-store";

export type SpiceRunScopeOutcome =
  | { ok: true; scope: RunScope; context: TrustedRequestContext }
  | { ok: false; response: Response };

function querySelector(request: Request): ProjectSelector | undefined {
  let url: URL;
  try { url = new URL(request.url); } catch { return undefined; }
  const projectId = url.searchParams.get("projectId")?.trim();
  if (!projectId) return undefined;
  return {
    projectId,
    tenantId: url.searchParams.get("tenantId")?.trim() || undefined,
    branchId: url.searchParams.get("branchId")?.trim() || undefined,
  };
}

/** [B16.0.23] Request-free projection of the trusted context into the run
 *  scope — the canonical-wrapper equivalent of what `spiceRunScope` returned
 *  (the wrapper's `querySelector: true` option now carries the header-less
 *  selector parsing that lived here). */
export function spiceRunScopeFromContext(context: TrustedRequestContext): RunScope {
  return { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId };
}

/** Authorize the request and derive the trusted run scope. */
export async function spiceRunScope(request: Request, options: { allowQuerySelector?: boolean } = {}): Promise<SpiceRunScopeOutcome> {
  const selector = options.allowQuerySelector ? querySelector(request) : undefined;
  const authorized = await authorizeRequest(request, selector ? { selector } : {});
  if (!authorized.ok) return { ok: false, response: authorized.response };
  if (authorized.kind !== "authenticated") {
    return { ok: false, response: Response.json({ ok: false, code: "SPICE_API_UNAUTHENTICATED", error: "An authenticated project member is required." }, { status: 401, headers: { "Cache-Control": "no-store" } }) };
  }
  const { context } = authorized;
  return { ok: true, scope: { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId }, context };
}

/** Uniform bounded 404 — identical for "missing" and "foreign scope" so the
 *  response is never an existence oracle. */
export function runNotFound(): Response {
  return Response.json({ ok: false, code: "SPICE_RUN_NOT_FOUND", error: "Run not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
}
