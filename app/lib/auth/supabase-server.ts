/**
 * B16.0 — the production Supabase SSR server client + token-refresh helper.
 *
 * Follows the official `@supabase/ssr` App Router pattern. These functions are
 * the PRODUCTION deployment wiring; the IDENTITY logic that authorizes
 * requests is fully covered by injected fakes, so the ordinary test suite
 * never imports or exercises this file against a live Supabase project.
 *
 * `getClaims()` (JWT-signature verified) is the ONLY identity check here —
 * never `getSession()` user data. The publishable key is browser-safe and
 * respects RLS; the secret/service key is never referenced here or exposed
 * to the browser. Authorization does NOT happen in the proxy: the route
 * boundary re-verifies claims AND session liveness [B16.1B §E].
 *
 * [B16.1B] Every SDK call runs through ONE per-request deadline-bounded,
 * abort-safe `fetch` (an unreachable provider could previously hold a
 * request ~25 s in the SDK's refresh-retry window), rotated cookies carry the
 * server-owned HttpOnly/Secure option set, and the SDK's anti-caching headers
 * are applied to the response (official contract: a response that sets auth
 * cookies must never be cached by a CDN).
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { createBoundedFetch, SESSION_VERIFICATION_DEADLINE_MS } from "./bounded-fetch";
import { sessionCookieOptions } from "./session-cookies";

function config(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return null;
  return { url, key };
}

/**
 * The SSR token-refresh helper, called from the repo-root `proxy.ts`. Keeps
 * the access token fresh and writes rotated cookies onto both the request
 * (for downstream Server Components / Route Handlers) and the response
 * (Set-Cookie for the browser). Never trusts `getSession()`; `getClaims()`
 * validates the JWT. A provider failure never breaks the request: the
 * response passes through and the route boundary fails closed (401).
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const conf = config();
  if (!conf) return response; // auth not configured → pass through (routes fail closed)

  const bounded = createBoundedFetch({ deadlineMs: SESSION_VERIFICATION_DEADLINE_MS, parent: request.signal });
  try {
    const supabase = createServerClient(conf.url, conf.key, {
      cookieOptions: sessionCookieOptions(),
      global: { fetch: bounded.fetch },
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          // A response that sets auth cookies must never be cached (SDK contract).
          if (headers) for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
        },
      },
    });

    // Do not run code between createServerClient and getClaims (per the SDK
    // guidance) — a mistake causes intermittent random logouts.
    await supabase.auth.getClaims();
  } catch {
    // Bounded, secret-free: nothing about the failure reaches the browser;
    // the protected route refuses without a verified live session.
  } finally {
    bounded.dispose();
  }
  return response;
}
