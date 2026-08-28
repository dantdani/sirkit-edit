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
 * The Supabase SDK is imported ONLY inside the production factory
 * (`createSupabaseClaimsVerifier`) via a lazy dynamic import, so the type
 * checker and the test suite never require the package to be installed. A
 * missing package fails CLOSED (production refuses).
 */

import type { AuthMethod, AuthStrength } from "./types";
import { LOCAL_DEV_PRINCIPAL_ID, LOCAL_DEV_SESSION_ID } from "./project-membership";

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

/**
 * The Supabase Auth production adapter. Identity comes ONLY from
 * server-verified claims (`getClaims()`), NEVER from `getSession()` user data
 * or from `user_metadata`. The role is derived elsewhere from the membership
 * repository — never from a JWT metadata claim.
 */
export class SupabaseIdentityProvider implements IdentityProvider {
  constructor(private readonly verifyClaims: SupabaseClaimsVerifier) {}

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

/**
 * Build the production Supabase claims verifier. The `@supabase/ssr` SDK is
 * dynamically imported HERE ONLY — a missing package (or a failed
 * verification) resolves to null (fail closed), and the rest of the app /
 * test suite never depends on the package being installed.
 *
 * Cookies are read from the request's `Cookie` header (a route handler is a
 * READ path; refresh-token rotation happens in `proxy.ts`, so `setAll` is a
 * no-op here — the read-only server-client pattern).
 */
export function createSupabaseClaimsVerifier(environment: Record<string, string | undefined> = process.env): SupabaseClaimsVerifier {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? environment.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return async (request: Request): Promise<SupabaseVerifiedClaims | null> => {
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
    const cookiePairs = parseCookieHeader(request.headers.get("cookie") ?? "");
    const client = (createServerClient as (u: string, k: string, opts: unknown) => { auth: { getClaims: () => Promise<{ data?: { claims?: SupabaseVerifiedClaims } | null; error?: unknown }> } })(url, key, {
      cookies: {
        getAll() { return cookiePairs.map(([name, value]) => ({ name, value })); },
        setAll() { /* read-only server client: rotation happens in proxy.ts */ },
      },
    });
    const result = await client.auth.getClaims();
    return result?.data?.claims ?? null;
  };
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
