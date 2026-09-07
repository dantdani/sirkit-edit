/**
 * B16.0 — the provider-neutral authenticated-identity interface, with a
 * Supabase Auth production adapter and an explicit local-development adapter.
 *
 * An `IdentityProvider` answers exactly one question: "who is the verified
 * principal behind this request?" It returns a `VerifiedPrincipal` only when
 * identity is server-verified; missing, expired, malformed, or unverifiable
 * identity yields `null` (the resolver fails closed with 401). It NEVER
 * returns tokens, cookies, or secrets.
 *
 * [B16.1B §E] Identity now has TWO server-side facts behind it, in order:
 *   1. signed-claim validation — `getClaims()` (signature + expiry against
 *      the project's published keys; never `getSession()` user data), and
 *   2. session LIVENESS — one server-confirmed `getUser()` whose returned id
 *      must EXACTLY equal the verified `claims.sub`.
 * A valid, unexpired token whose remote session was revoked passed step 1
 * alone (reproduced with the real SDK and an ES256 key pair); step 2 closes
 * it. Both steps run through ONE per-request, deadline-bounded SDK client
 * (`createSupabaseSessionVerifiers`) — exactly one verification sequence per
 * request, never a route-level lookup.
 *
 * The Supabase SDK is imported ONLY inside the production factory via a lazy
 * dynamic import, so the type checker and the test suite never require the
 * package to be installed. A missing package fails CLOSED (production refuses).
 */

import type { AuthMethod, AuthStrength } from "./types";
import { LOCAL_DEV_PRINCIPAL_ID, LOCAL_DEV_SESSION_ID } from "./project-membership";
import { confirmSessionLiveness, type SessionLivenessOutcome, type SessionLivenessVerifier } from "./session-liveness";
import { createBoundedFetch, SESSION_VERIFICATION_DEADLINE_MS, type BoundedFetch } from "./bounded-fetch";

export interface VerifiedPrincipal {
  /** The authenticated user id (Supabase `sub` in production). */
  userId: string;
  /** An opaque session identity — never a token. */
  sessionId: string;
  authMethod: AuthMethod;
  authStrength: AuthStrength;
  /** Optional email, for audit/display only (never authorization). */
  email?: string;
}

export interface IdentityProvider {
  /** Verify the request's identity. Returns the principal, or null when the
   *  request is unauthenticated / expired / invalid (fail closed upstream). */
  verify(request: Request): Promise<VerifiedPrincipal | null>;
}

/** The local-development identity — a single fixed principal. Explicitly NOT
 *  production authentication; only ever selected in local_dev mode. */
export class LocalDevIdentityProvider implements IdentityProvider {
  async verify(): Promise<VerifiedPrincipal | null> {
    return {
      userId: LOCAL_DEV_PRINCIPAL_ID,
      sessionId: LOCAL_DEV_SESSION_ID,
      authMethod: "local_dev",
      authStrength: "local_dev",
    };
  }
}

/** The minimal, verified JWT claim shape the Supabase adapter consumes. It is
 *  produced by `supabase.auth.getClaims()`, which verifies the JWT signature
 *  against the project's published keys — never `getSession()`. */
export interface SupabaseVerifiedClaims {
  /** The user id — the authorization subject. */
  sub: string;
  /** Issuer / audience / expiry — validated by the SDK before return. */
  iss?: string;
  aud?: string | string[];
  exp?: number;
  /** Authenticator assurance level: aal1 / aal2. */
  aal?: string;
  session_id?: string;
  email?: string;
}

/** A verifier resolves cookies → verified claims (or null). The production
 *  implementation calls `getClaims()`; tests inject a fake. */
export type SupabaseClaimsVerifier = (request: Request) => Promise<SupabaseVerifiedClaims | null>;

/** [B16.1B §E] the liveness policy an adapter enforces AFTER signed-claim
 *  validation: the provider-neutral verifier plus its settlement deadline. */
export interface SessionLivenessPolicy {
  verifier: SessionLivenessVerifier;
  /** Defaults to the shared verification budget. */
  deadlineMs?: number;
}

/**
 * The Supabase Auth production adapter. Identity comes ONLY from
 * server-verified claims (`getClaims()`), NEVER from `getSession()` user data
 * or from `user_metadata`. The role is derived elsewhere from the membership
 * repository — never from a JWT metadata claim.
 *
 * When a liveness policy is configured (always, in production), the adapter
 * additionally requires ONE server-confirmed liveness outcome whose user id
 * equals `claims.sub`; revoked / mismatch / timeout / abort / error all yield
 * null (uniform 401 upstream).
 */
export class SupabaseIdentityProvider implements IdentityProvider {
  constructor(
    private readonly verifyClaims: SupabaseClaimsVerifier,
    private readonly liveness?: SessionLivenessPolicy,
  ) {}

  async verify(request: Request): Promise<VerifiedPrincipal | null> {
    let claims: SupabaseVerifiedClaims | null;
    try {
      claims = await this.verifyClaims(request);
    } catch {
      // A verification error (network, malformed, expired) fails closed.
      return null;
    }
    if (!claims || typeof claims.sub !== "string" || claims.sub.length === 0) return null;
    // Defence in depth: reject an already-expired token even if the verifier
    // did not (the SDK normally refreshes/rejects, but we never trust a stale
    // exp).
    if (typeof claims.exp === "number" && Number.isFinite(claims.exp)) {
      const nowSeconds = Math.floor(nowMs() / 1000);
      if (claims.exp <= nowSeconds) return null;
    }
    if (this.liveness) {
      // [B16.1B §E] EXACTLY one bounded, settle-once liveness confirmation;
      // the server-confirmed id must equal the verified subject.
      const outcome = await confirmSessionLiveness(this.liveness.verifier, request, claims.sub, {
        ...(this.liveness.deadlineMs !== undefined ? { deadlineMs: this.liveness.deadlineMs } : {}),
        parent: request.signal,
      });
      if (!outcome.live || outcome.userId !== claims.sub) return null;
    }
    const authStrength: AuthStrength = claims.aal === "aal2" ? "aal2" : "aal1";
    return {
      userId: claims.sub,
      sessionId: typeof claims.session_id === "string" && claims.session_id.length > 0 ? claims.session_id : `supabase:${claims.sub}`,
      authMethod: "supabase_cookie",
      authStrength,
      ...(typeof claims.email === "string" ? { email: claims.email } : {}),
    };
  }
}

/** Injectable clock (kept simple — Date.now, but isolated for testability). */
let nowMs: () => number = () => Date.now();
export function __setIdentityClockForTests(clock: () => number): void { nowMs = clock; }
export function __resetIdentityClockForTests(): void { nowMs = () => Date.now(); }

// ── Production verifiers (ONE bounded SDK client per request) ────────────────

interface PerRequestAuthClient {
  auth: {
    getClaims: () => Promise<{ data?: { claims?: SupabaseVerifiedClaims } | null; error?: unknown } | null>;
    getUser: () => Promise<{ data?: { user?: { id?: unknown } | null } | null; error?: unknown } | null>;
  };
}

interface PerRequestSession {
  client: PerRequestAuthClient;
  bounded: BoundedFetch;
}

export interface SupabaseSessionVerifiers {
  /** Signed-claim validation (`getClaims()`), or null (fail closed). */
  verifyClaims: SupabaseClaimsVerifier;
  /** Server-confirmed liveness (`getUser()`) on the SAME per-request client. */
  liveness: SessionLivenessVerifier;
}

/**
 * Build the production Supabase verifiers. The `@supabase/ssr` SDK is
 * dynamically imported HERE ONLY — a missing package (or a failed
 * verification) resolves to null / "unavailable" (fail closed), and the rest
 * of the app / test suite never depends on the package being installed.
 *
 * Both verifiers share ONE server client per `Request` (a WeakMap keyed on
 * the request object), built with:
 *  - cookies read from the request's `Cookie` header (a route handler is a
 *    READ path; refresh-token rotation happens in `proxy.ts`, so `setAll` is
 *    a no-op here — the read-only server-client pattern), and
 *  - a per-request deadline-bounded, abort-safe `fetch` for every SDK call
 *    (JWKS, refresh, user), so an unreachable provider can never hold a
 *    request beyond the verification budget.
 */
export function createSupabaseSessionVerifiers(
  environment: Record<string, string | undefined> = process.env,
  options: { deadlineMs?: number } = {},
): SupabaseSessionVerifiers {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? environment.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const deadlineMs = options.deadlineMs ?? SESSION_VERIFICATION_DEADLINE_MS;
  const sessions = new WeakMap<Request, Promise<PerRequestSession | null>>();

  async function build(request: Request): Promise<PerRequestSession | null> {
    if (!url || !key) return null; // production auth not configured → fail closed
    let createServerClient: unknown;
    try {
      // Lazy, isolated STATIC import — the ONLY place the SDK is referenced.
      // Kept out of the module's top-level graph so the request pipeline pays
      // no cost when Supabase is not configured; a load failure fails closed.
      const mod = await import("@supabase/ssr");
      createServerClient = (mod as { createServerClient?: unknown }).createServerClient;
    } catch {
      return null; // load failure → production refuses (never a fake human)
    }
    if (typeof createServerClient !== "function") return null;
    const bounded = createBoundedFetch({ deadlineMs, parent: request.signal });
    const cookiePairs = parseCookieHeader(request.headers.get("cookie") ?? "");
    try {
      const client = (createServerClient as (u: string, k: string, opts: unknown) => PerRequestAuthClient)(url, key, {
        cookies: {
          getAll() { return cookiePairs.map(([name, value]) => ({ name, value })); },
          setAll() { /* read-only server client: rotation happens in proxy.ts */ },
        },
        global: { fetch: bounded.fetch },
      });
      return { client, bounded };
    } catch {
      bounded.dispose();
      return null;
    }
  }

  function sessionFor(request: Request): Promise<PerRequestSession | null> {
    let pending = sessions.get(request);
    if (!pending) {
      pending = build(request);
      sessions.set(request, pending);
    }
    return pending;
  }

  return {
    verifyClaims: async (request: Request): Promise<SupabaseVerifiedClaims | null> => {
      const session = await sessionFor(request);
      if (!session) return null;
      const result = await session.client.auth.getClaims();
      return result?.data?.claims ?? null;
    },
    liveness: {
      async confirm(request: Request, expectedUserId: string, signal: AbortSignal): Promise<SessionLivenessOutcome> {
        const session = await sessionFor(request);
        if (!session) return { live: false, reason: "unavailable" };
        const onAbort = (): void => { session.bounded.abort(); };
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
        try {
          const result = await session.client.auth.getUser();
          if (session.bounded.signal.aborted) return { live: false, reason: "timeout" };
          const user = result?.data?.user;
          if (!result || result.error || !user) return { live: false, reason: "revoked" };
          if (typeof user.id !== "string" || user.id !== expectedUserId) return { live: false, reason: "mismatch" };
          return { live: true, userId: user.id };
        } catch {
          return { live: false, reason: session.bounded.signal.aborted ? "timeout" : "error" };
        } finally {
          signal.removeEventListener("abort", onAbort);
          session.bounded.dispose();
        }
      },
    },
  };
}

/** The claims-only verifier (signed-claim validation without liveness). Kept
 *  for callers that compose liveness separately; production composition uses
 *  `createSupabaseSessionVerifiers` so both steps share one bounded client. */
export function createSupabaseClaimsVerifier(environment: Record<string, string | undefined> = process.env): SupabaseClaimsVerifier {
  return createSupabaseSessionVerifiers(environment).verifyClaims;
}

function parseCookieHeader(header: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) pairs.push([name, decodeURIComponentSafe(value)]);
  }
  return pairs;
}

function decodeURIComponentSafe(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}
