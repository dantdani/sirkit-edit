/**
 * B16.0.1 §H — the PKCE auth callback (official @supabase/ssr pattern).
 *
 * GET ?code=...&next=/path completes a PKCE flow (magic link / OAuth for an
 * EXISTING account) by exchanging the one-time code for a cookie session via
 * `exchangeCodeForSession`, then redirects to a SAME-ORIGIN relative path
 * validated by `safeRedirectPath` (open-redirect prevention). No token ever
 * appears in the response body or the redirect URL.
 *
 * When Supabase is not configured, or the exchange fails, the browser is sent
 * to the sign-in page with a bounded error flag — never a provider diagnostic.
 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { safeRedirectPath } from "@/app/lib/auth/request-security";
import { publicRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";

// [B16.0.24 §B] canonical PUBLIC wrapper — the callback receives NO raw
// Request: `code` and `next` arrive through the bounded query projection, and
// the redirect origin is `meta.origin`, the SERVER-OWNED verified origin
// (`resolveExpectedOrigin`: `SIRKIT_EXPECTED_ORIGIN` in production, the
// router's own request-URL origin in local_dev) — NEVER a `Host` /
// `X-Forwarded-Host` / `Forwarded` header. `next` is validated to a
// same-origin relative path by `safeRedirectPath` (open-redirect prevention).
// Cookies are written only by the server-side @supabase/ssr client; no token,
// code, session, or provider diagnostic ever enters the body or redirect URL.
export const GET = publicRoute({ query: true, requestOrigin: true }, async ({ meta }) => {
  const origin = meta.origin!;
  const code = meta.query?.code ?? null;
  const next = safeRedirectPath(meta.query?.next, "/");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key || !code) {
    return Response.redirect(new URL("/signin?error=auth", origin), 303);
  }

  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        },
      },
    });
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return Response.redirect(new URL("/signin?error=auth", origin), 303);
    }
    return Response.redirect(new URL(next, origin), 303);
  } catch {
    return Response.redirect(new URL("/signin?error=auth", origin), 303);
  }
});
