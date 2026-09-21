/**
 * B16.0.1 §A/B/C — the ONE reusable authorization adapter.
 *
 * `authorizeRequest(request)` looks up the EXACT method-aware policy for the
 * request's path+method and enforces, in order:
 *   1. same-origin CSRF (automatic, for cookie-authenticated writes) — a
 *      caller cannot forget it;
 *   2. authentication + active project membership (server-derived identity);
 *   3. the exact permitted roles / required engineering capability.
 *
 * It NEVER reads identity from `x-sirkit-*` headers (only the project/branch
 * selector). A route with no policy fails closed (500 — a coding error the CI
 * gate catches). Public routes are allowed without identity; worker routes go
 * through the constant-time secret boundary; a viewer is refused with 403
 * BEFORE any downstream authority load / provider call / mutation.
 */

import type { EngineeringActor, EngineeringCapability, ProjectRole } from "../engineering/types";
import { actorCapabilities } from "../engineering/authorization";
import { resolveTrustedRequestContext } from "./trusted-request-context";
import { policyFor, type RoutePolicy } from "./route-policy";
import { verifyWorkerSecret, type WorkerPrincipal } from "./worker-principal";
import { forbidden, jsonError, requireSameOrigin } from "./request-security";
import { readBoundedJsonObject, boundedJsonRefusalResponse } from "../http/bounded-json";
import type { ProjectSelector, TrustedRequestContext } from "./types";

export type AuthorizeOutcome =
  | { ok: true; kind: "public"; policy: RoutePolicy }
  | { ok: true; kind: "worker"; policy: RoutePolicy; principal: WorkerPrincipal }
  | { ok: true; kind: "authenticated"; policy: RoutePolicy; context: TrustedRequestContext }
  | { ok: false; response: Response };

/**
 * Authorize a request against its exact route policy. The pathname/method are
 * derived from the request itself, so the policy — and its CSRF/role rules —
 * are automatic and cannot be forgotten by a caller.
 */
export interface AuthorizeRequestOptions {
  /** Injected environment (defaults to process.env) for deterministic tests. */
  environment?: Record<string, string | undefined>;
  /** [B16.0.2 §B] an explicit project/branch SELECTOR (e.g. parsed from the
   *  query string of a route a browser cannot send headers to — EventSource /
   *  anchor downloads). A selector is never authority: membership is still
   *  loaded server-side for exactly this scope. */
  selector?: ProjectSelector;
}

export async function authorizeRequest(request: Request, options: AuthorizeRequestOptions = {}): Promise<AuthorizeOutcome> {
  const pathname = safePathname(request.url);
  const method = request.method.toUpperCase();
  const policy = policyFor(pathname, method);
  if (!policy) {
    // A route/method with no exact policy is a coding error — fail closed.
    return { ok: false, response: jsonError(500, "AUTH_POLICY_MISSING", "This route has no authorization policy.") };
  }
  // [B20 B2] an mcp-bearer row is served ONLY by mcpBearerJsonRoute: resolving it here would authenticate an ambient cookie on
  // the bearer-only endpoint (with CSRF off). Refused before any identity, CSRF or body work (D-5).
  if (policy.identitySource === "mcp-bearer") {
    return { ok: false, response: jsonError(500, "AUTH_POLICY_WRAPPER_MISMATCH", "This route's policy is served by another wrapper; the request is refused.") };
  }

  // Worker/service boundary — a distinct machine identity, never a human.
  if (policy.identitySource === "worker-secret") {
    if (policy.requiresCsrf) {
      const csrf = requireSameOrigin(request, options.environment);
      if (csrf) return { ok: false, response: csrf };
    }
    const principal = verifyWorkerSecret(request, options.environment);
    if (!principal) return { ok: false, response: jsonError(401, "AUTH_WORKER_UNAUTHENTICATED", "A valid worker credential is required.") };
    return { ok: true, kind: "worker", policy, principal };
  }

  // Public routes — no identity. (The policy asserts they touch no
  // project data / credit / write / approval / mutation / release; the CI
  // gate enforces that assertion.) A public policy may still demand
  // same-origin CSRF (e.g. the auth boundary) — enforced here too.
  if (!policy.requiresAuth) {
    if (policy.requiresCsrf) {
      const csrf = requireSameOrigin(request, options.environment);
      if (csrf) return { ok: false, response: csrf };
    }
    return { ok: true, kind: "public", policy };
  }

  // Authenticated routes — server-derived identity + membership, with
  // automatic same-origin CSRF for cookie-authenticated writes.
  const resolved = await resolveTrustedRequestContext(request, {
    enforceSameOrigin: policy.requiresCsrf,
    ...(options.environment ? { environment: options.environment } : {}),
    ...(options.selector ? { selector: options.selector } : {}),
  });
  if (!resolved.ok) return { ok: false, response: resolved.refusal.response };
  const { context } = resolved;

  const authz = authorizeContext(context, policy);
  if (authz) return { ok: false, response: authz };
  return { ok: true, kind: "authenticated", policy, context };
}

/** Enforce the policy's role / capability against a resolved context. Returns
 *  null (authorized) or a 403 response. Exported for direct use where a route
 *  already holds a context. */
export function authorizeContext(context: TrustedRequestContext, policy: RoutePolicy): Response | null {
  return authorizeActor(context.actor, policy);
}

/** Enforce role/capability against an actor + policy (worker or human). */
export function authorizeActor(actor: EngineeringActor, policy: RoutePolicy): Response | null {
  if (policy.permittedRoles.length > 0 && !policy.permittedRoles.includes(actor.role)) {
    return forbidden("AUTH_ROLE_DENIED", `Role ${actor.role} is not permitted for this operation.`);
  }
  if (policy.requiredCapability) {
    const capabilities = actorCapabilities(actor);
    if (!capabilities.has(policy.requiredCapability)) {
      return forbidden("AUTH_CAPABILITY_DENIED", `Capability ${policy.requiredCapability} is required for this operation.`);
    }
  }
  return null;
}

/** Convenience: the flat-scope shape the CD-stage `_scope.ts` families use. */
export interface FlatTrustedScope {
  tenantId: string;
  projectId: string;
  branchId: string;
  actorId: string;
  actorKind: EngineeringActor["actorKind"];
  role: ProjectRole;
  sessionId: string;
}

export function flatScopeOf(context: TrustedRequestContext): FlatTrustedScope {
  return {
    tenantId: context.tenantId,
    projectId: context.projectId,
    branchId: context.branchId,
    actorId: context.actor.actorId,
    actorKind: context.actor.actorKind,
    role: context.actor.role,
    sessionId: context.actor.sessionId,
  };
}

/**
 * Shared authenticated JSON-body helper for the `_scope.ts` families: enforces
 * the exact route policy (identity + CSRF + role) FIRST, then media-type,
 * then the [B16.0.2 §D] BOUNDED, total-settlement body read (real wire-byte
 * ceiling + hard deadline + abort propagation — through the ONE proven
 * streaming reader, never `request.text()`), then JSON-object validation.
 * Returns the trusted context so callers can project it (rich `{actor}` or
 * `flatScopeOf`).
 */
export async function scopedTrustedJson(
  request: Request,
  options: { maxBytes: number; deadlineMs?: number; forbiddenBodyKeys?: readonly string[]; environment?: Record<string, string | undefined>; selector?: ProjectSelector },
): Promise<{ ok: true; body: Record<string, unknown>; context: TrustedRequestContext } | { ok: false; response: Response }> {
  const authorized = await authorizeRequest(request, {
    ...(options.environment ? { environment: options.environment } : {}),
    ...(options.selector ? { selector: options.selector } : {}),
  });
  if (!authorized.ok) return { ok: false, response: authorized.response };
  if (authorized.kind !== "authenticated") {
    // A JSON body helper is only for authenticated human/session routes.
    return { ok: false, response: jsonError(403, "AUTH_UNSUPPORTED_PRINCIPAL", "This route requires an authenticated project member.") };
  }
  const context = authorized.context;
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return { ok: false, response: jsonError(415, "AUTH_MEDIA_TYPE_UNSUPPORTED", "Content-Type must be application/json.") };
  }
  const read = await readBoundedJsonObject(request, { maxBytes: options.maxBytes, ...(options.deadlineMs !== undefined ? { deadlineMs: options.deadlineMs } : {}) });
  if (!read.ok) return { ok: false, response: boundedJsonRefusalResponse(read) };
  const body = read.body;
  for (const key of options.forbiddenBodyKeys ?? []) {
    if (key in body) return { ok: false, response: jsonError(400, "AUTH_AUTHORITATIVE_INPUT_FORBIDDEN", "The request body carries a forbidden authoritative field.") };
  }
  return { ok: true, body, context };
}

function safePathname(url: string): string {
  try { return new URL(url).pathname; } catch { return ""; }
}

export type { RoutePolicy, EngineeringCapability };
