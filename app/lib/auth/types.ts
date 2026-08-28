/**
 * B16.0 — the server-derived trusted request identity contract.
 *
 * Closes R02-B1-011: before B16.0, the `app/api` `_scope.ts` files read the actor id,
 * actor kind, and project role from caller-supplied `x-sirkit-*` headers, so
 * any caller could claim `project_admin` and become any apparent human. The
 * `TrustedRequestContext` below is derived ENTIRELY server-side — client
 * headers may only REQUEST a project/branch selector; they never establish
 * identity, actor kind, role, or membership.
 *
 * Nothing in this contract is ever returned to the browser verbatim: it
 * carries no access token, refresh token, cookie, secret, or raw provider
 * diagnostic — only server-derived, bounded identifiers.
 */

import type { EngineeringActor, ProjectRole } from "../engineering/types";

/** How the authenticated principal was established for this request. */
export type AuthMethod =
  /** Production: a Supabase Auth cookie session, JWT-verified server-side. */
  | "supabase_cookie"
  /** Explicit, non-production, loopback-only local development identity. */
  | "local_dev"
  /** A constant-time-verified worker/automation shared secret. */
  | "worker_secret";

/** The assurance level of the authentication method. */
export type AuthStrength =
  /** Supabase AAL1 (password / magic-link single factor). */
  | "aal1"
  /** Supabase AAL2 (a second factor was presented). */
  | "aal2"
  /** Local development identity — explicitly NOT production authentication. */
  | "local_dev"
  /** A machine/service principal (worker secret) — never a human. */
  | "service";

/**
 * The one server-derived request identity. Produced by
 * `resolveTrustedRequestContext`; consumed everywhere a route previously
 * trusted `x-sirkit-*` headers.
 */
export interface TrustedRequestContext {
  /** The authenticated principal id (Supabase user id, the fixed local-dev
   *  principal, or a worker principal id). NEVER caller-supplied. */
  principalId: string;
  tenantId: string;
  projectId: string;
  branchId: string;
  /** The effective engineering actor — role and kind are SERVER-DERIVED
   *  (membership role for humans; a machine role for workers), never from a
   *  header. */
  actor: EngineeringActor;
  /** Opaque session identity — never a token, never a cookie value. */
  sessionIdentity: string;
  authMethod: AuthMethod;
  authStrength: AuthStrength;
  /** A digest/version of the membership record the role was derived from —
   *  so a proposal/approval can bind to it and be retired when membership
   *  changes. For workers/local_dev it is a deterministic constant. */
  membershipRevision: string;
  /** A per-request correlation id (never a session token) for diagnostics. */
  correlationId: string;
}

/** Fail-closed refusal — an HTTP status + a bounded public code + response. */
export interface TrustedContextRefusal {
  /** 401 = authentication failure (who are you?); 403 = authorization
   *  failure (you are known, but not permitted here). */
  status: 401 | 403 | 400 | 415 | 413 | 500;
  code: string;
  /** A bounded, secret-free public message. */
  message: string;
  response: Response;
}

export type TrustedContextResult =
  | { ok: true; context: TrustedRequestContext }
  | { ok: false; refusal: TrustedContextRefusal };

/** The project/branch SELECTOR a client may request (never authority). */
export interface ProjectSelector {
  tenantId?: string;
  projectId?: string;
  branchId?: string;
}

/** Re-export for convenience — the role/kind vocabulary is unchanged. */
export type { EngineeringActor, ProjectRole };
