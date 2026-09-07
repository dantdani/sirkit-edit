/**
 * B16.0.1 §H — the minimal production sign-in boundary (existing accounts ONLY).
 *
 * POST { email, password } verifies the credential against Supabase Auth via
 * the official SSR server client (`signInWithPassword`); on success the SSR
 * client writes the session COOKIES and the response body carries NO token,
 * session, or user object — identity is subsequently derived server-side by
 * `resolveTrustedRequestContext` from the cookie session. On failure the
 * response is a uniform 401 with no indication of whether the account exists
 * (no user enumeration).
 *
 * [B16.1B §D] Cookie flags are SERVER-OWNED (`sessionCookieOptions`): the SSR
 * library's own default is `httpOnly: false` with no `secure` attribute, so
 * the historical "httpOnly, managed by @supabase/ssr" claim was false; the
 * session cookie family is now written HttpOnly, SameSite=Lax, Path=/, and
 * Secure whenever the server-owned expected origin is https. The credential
 * call is deadline-bounded (an unreachable provider cannot hold the request).
 *
 * Deliberate boundaries:
 *  - There is NO sign-UP endpoint anywhere under /api/auth (unrestricted
 *    self-signup is not enabled; accounts are provisioned out of band), and
 *    the §I CI gate pins that.
 *  - Same-origin CSRF is enforced before the body is read; the body read
 *    itself is bounded (wire bytes + deadline + abort) [B16.0.2 §D].
 *  - When Supabase is not configured (the local_dev build) sign-in is
 *    UNAVAILABLE (503) — the local principal never comes from this route, and
 *    production without configured auth already fails closed at the trusted
 *    context resolver.
 *  - Credentials are never logged, echoed, or placed in a URL.
 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { jsonError } from "@/app/lib/auth/request-security";
import { publicJsonRoute } from "@/app/lib/auth/route-handlers";
import { createBoundedFetch, SESSION_VERIFICATION_DEADLINE_MS } from "@/app/lib/auth/bounded-fetch";
import { sessionCookieOptions } from "@/app/lib/auth/session-cookies";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 16_000;
/** [B16.0.2 §D] hard total deadline on receiving the (tiny) credential body. */
const BODY_DEADLINE_MS = 10_000;
const MAX_EMAIL_CHARS = 320;
const MAX_PASSWORD_CHARS = 1024;

// [B16.0.24 §C] canonical PUBLIC wrapper — same-origin CSRF (the public row's
// requiresCsrf) and the media-type 415 run in the wrapper BEFORE the bounded
// 16,000-byte / 10-second object read; the exact historical AUTH_SIGNIN_*
// body-refusal envelopes are preserved byte-exact through the closed-enum
// `legacyReaderRefusals: "auth-signin-v1"` profile (routes cannot inject
// envelope logic). The callback receives only the parsed object body — never
// the raw Request. Credentials are never logged, echoed, or placed in a URL,
// and the success body carries NO token, session, or user object.
export const POST = publicJsonRoute<Record<string, unknown>>(
  { maxBytes: MAX_BODY_BYTES, deadlineMs: BODY_DEADLINE_MS, legacyReaderRefusals: "auth-signin-v1" },
  async ({ body }) => {
  const { email, password } = body;
  if (typeof email !== "string" || email.trim().length === 0 || email.length > MAX_EMAIL_CHARS
    || typeof password !== "string" || password.length === 0 || password.length > MAX_PASSWORD_CHARS) {
    return jsonError(400, "AUTH_SIGNIN_CREDENTIALS_REQUIRED", "Email and password are required.");
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) {
    return jsonError(503, "AUTH_SIGNIN_UNAVAILABLE", "Production sign-in is not configured in this deployment.");
  }

  const bounded = createBoundedFetch({ deadlineMs: SESSION_VERIFICATION_DEADLINE_MS });
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(url, key, {
      cookieOptions: sessionCookieOptions(),
      global: { fetch: bounded.fetch },
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        },
      },
    });
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      // Uniform refusal — no user enumeration, no provider diagnostic.
      return jsonError(401, "AUTH_SIGNIN_FAILED", "Sign-in failed. Check your email and password.");
    }
    return Response.json({ ok: true }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return jsonError(500, "AUTH_SIGNIN_ERROR", "Sign-in could not be completed.");
  } finally {
    bounded.dispose();
  }
  });
