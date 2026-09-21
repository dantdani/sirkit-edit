/**
 * B16.0 — the ONE server-derived request-identity resolver.
 *
 * `resolveTrustedRequestContext` is the single authority every sensitive
 * route uses instead of trusting `x-sirkit-*` identity headers. It:
 *   1. verifies the authenticated principal (Supabase in production; the
 *      fixed local principal in local_dev; a test-injected fake),
 *   2. reads the project/branch SELECTOR (headers or an explicit selector —
 *      selectors are never authority),
 *   3. loads the principal's ACTIVE project membership from server-owned
 *      storage and derives the engineering ROLE from it,
 *   4. builds the effective `EngineeringActor` — role and kind server-derived.
 *
 * Fail-closed everywhere: unauthenticated ⇒ 401; no/revoked/insufficient
 * membership, or foreign tenant/project ⇒ 403; production without configured
 * authentication ⇒ 403 (sensitive operations blocked). It never returns a
 * token, cookie, or secret. This resolver only ever produces a HUMAN or
 * local_dev principal — worker identity uses `verifyWorkerSecret` on a
 * separate boundary and can never mint a human actor.
 */

import { engineeringDigest } from "../engineering/stable";
import type { EngineeringActor } from "../engineering/types";
import { resolveAuthMode, sensitiveOperationsBlocker } from "./mode";
import { resolveIdentityProvider, resolveMembershipRepository } from "./identity-runtime";
import { membershipRevisionOf, projectRoleFromMembership } from "./project-membership";
import { unauthenticated, forbidden, jsonError, requireSameOrigin } from "./request-security";
import type { ProjectSelector, TrustedContextResult, TrustedRequestContext } from "./types";

export const DEFAULT_TENANT_ID = "local";
export const DEFAULT_BRANCH_ID = "main";

/** Selector headers are the ONLY `x-sirkit-*` headers this resolver reads.
 *  They request a project/branch; they never establish identity or role. */
function selectorFromHeaders(request: Request): ProjectSelector {
  return {
    tenantId: request.headers.get("x-sirkit-tenant-id")?.trim() || undefined,
    projectId: request.headers.get("x-sirkit-project-id")?.trim() || undefined,
    branchId: request.headers.get("x-sirkit-branch-id")?.trim() || undefined,
  };
}

export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export interface ResolveTrustedContextOptions {
  /** An explicit project/branch selector (e.g. from a request body). When
   *  omitted, the selector is read from the selector headers. */
  selector?: ProjectSelector;
  /** Enforce same-origin for cookie-authenticated state-changing requests. */
  enforceSameOrigin?: boolean;
  /** Injected environment (defaults to process.env) for deterministic tests. */
  environment?: Record<string, string | undefined>;
  /** Correlation id override (defaults to a per-request derived id). */
  correlationId?: string;
}

export async function resolveTrustedRequestContext(request: Request, options: ResolveTrustedContextOptions = {}): Promise<TrustedContextResult> {
  const environment = options.environment ?? process.env;
  const correlationId = options.correlationId ?? deriveCorrelationId(request);

  // 0. Production must have authentication configured; otherwise sensitive
  //    operations fail closed.
  const blocker = sensitiveOperationsBlocker(environment);
  if (blocker) {
    return refuse(forbidden("AUTH_PRODUCTION_NOT_CONFIGURED", blocker));
  }

  // 0b. Same-origin CSRF check for cookie-authenticated mutations (production
  //     only — local_dev/tests need no browser origin).
  if (options.enforceSameOrigin && resolveAuthMode(environment) === "production") {
    const originRefusal = requireSameOrigin(request, environment);
    if (originRefusal) return refuse(originRefusal);
  }

  // 1. Verify the authenticated principal.
  const identity = resolveIdentityProvider();
  if (!identity) {
    return refuse(unauthenticated("AUTH_IDENTITY_UNAVAILABLE", "No identity provider is available; the request is refused."));
  }
  const principal = await identity.verify(request);
  if (!principal) {
    return refuse(unauthenticated("AUTH_UNAUTHENTICATED", "Missing, expired, or invalid authentication."));
  }

  // 2. Resolve the project/branch SELECTOR (never authority).
  const selector = options.selector ?? selectorFromHeaders(request);
  const tenantId = (selector.tenantId ?? DEFAULT_TENANT_ID).trim();
  const projectId = (selector.projectId ?? "").trim();
  const branchId = (selector.branchId ?? DEFAULT_BRANCH_ID).trim();
  if (!projectId) {
    return refuse(jsonError(400, "AUTH_PROJECT_SELECTOR_REQUIRED", "A project selector is required."));
  }
  for (const [name, value] of [["tenantId", tenantId], ["projectId", projectId], ["branchId", branchId]] as const) {
    if (!ID_PATTERN.test(value)) {
      return refuse(jsonError(400, "AUTH_SELECTOR_MALFORMED", `The ${name} selector is malformed.`));
    }
  }

  // 3. Load the principal's ACTIVE membership → derive the role.
  const memberships = resolveMembershipRepository();
  if (!memberships) {
    return refuse(forbidden("AUTH_MEMBERSHIP_UNAVAILABLE", "Project membership authority is unavailable; the request is refused."));
  }
  const membership = await memberships.loadActiveMembership({ tenantId, projectId, userId: principal.userId });
  if (!membership) {
    // Missing, revoked, cross-tenant, or cross-project all land here.
    return refuse(forbidden("AUTH_NO_ACTIVE_MEMBERSHIP", "You have no active membership for this project."));
  }
  const role = projectRoleFromMembership(membership.role);
  if (!role) {
    return refuse(forbidden("AUTH_ROLE_UNMAPPED", "The stored membership role is not a recognized project role."));
  }

  // 4. Build the effective actor. Browser/session principals are ALWAYS human
  //    here (AI actors are minted internally, only after a verified human
  //    request enters the agent boundary; workers use a separate boundary).
  const actor: EngineeringActor = {
    actorId: principal.userId,
    actorKind: "human",
    sessionId: principal.sessionId,
    role,
  };

  const context: TrustedRequestContext = {
    principalId: principal.userId,
    tenantId,
    projectId,
    branchId,
    actor,
    sessionIdentity: principal.sessionId,
    authMethod: principal.authMethod,
    authStrength: principal.authStrength,
    membershipRevision: membershipRevisionOf(membership),
    correlationId,
  };
  return { ok: true, context };
}

function refuse(response: Response): TrustedContextResult {
  return {
    ok: false,
    refusal: {
      status: response.status as 401 | 403 | 400 | 415 | 413 | 500,
      code: "AUTH_REFUSED",
      message: "The request was refused.",
      response,
    },
  };
}

function deriveCorrelationId(request: Request): string {
  // A bounded, non-secret correlation id (never a token, never derived from a
  // credential). Two facets: a route facet (digest of method + path, so an
  // operator can group traces by route) and a PER-REQUEST facet of fresh
  // entropy, so two requests to the same route never share an id.
  // [B16-A F1] the previous derivation hashed only method + path and was
  // therefore a per-route constant — every `/api/pcb/qualify` failure carried
  // the same id and the redacted server trace could not be found by it.
  let path = "";
  try { path = new URL(request.url).pathname; } catch { path = ""; }
  const route = engineeringDigest({ schema: "sirkit.request-correlation.v1", method: request.method, path }).slice(5, 13);
  const entropy = new Uint8Array(8);
  globalThis.crypto.getRandomValues(entropy);
  return `corr-${route}-${Array.from(entropy, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
