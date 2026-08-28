/**
 * B16.0 — the production Supabase SSR server client + token-refresh helper.
 *
 * Follows the official `@supabase/ssr` App Router pattern. These functions are
 * the PRODUCTION deployment wiring; the IDENTITY logic that authorizes
 * requests is fully covered by injected fakes, so the ordinary test suite
 * never imports or exercises this file against a live Supabase project.
 *
 * `getClaims()` (JWT-signature verified) is the ONLY identity check — never
 * `getSession()` user data. The publishable key is browser-safe and respects
 * RLS; the secret/service key is never referenced here or exposed to the
 * browser.
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

function config(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return null;
  return { url, key };
}

/**
 * The SSR token-refresh helper, called from the repo-root `proxy.ts`. Keeps
 * the access token fresh and writes rotated cookies onto both the request
 * (for downstream Server Components) and the response (Set-Cookie for the
 * browser). Never trusts `getSession()`; `getClaims()` validates the JWT.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const conf = config();
  if (!conf) return response; // auth not configured → pass through (routes fail closed)

  const supabase = createServerClient(conf.url, conf.key, {
    cookies: {
      getAll() { return request.cookies.getAll(); },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Do not run code between createServerClient and getClaims (per the SDK
  // guidance) — a mistake causes intermittent random logouts.
  await supabase.auth.getClaims();
  return response;
}
