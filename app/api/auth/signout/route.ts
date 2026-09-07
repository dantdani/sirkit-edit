/**
 * B16.0 — the minimal sign-out boundary.
 *
 * POST retires the caller's Supabase Auth session cookies (logout) via the
 * SSR server client. Same-origin only (CSRF), no open redirect, no token in
 * the URL or response. Logout retires the authenticated principal — pending
 * proposals/approvals bound to that principal are invalidated because a
 * subsequent request has no verified session (401) or a changed principal.
 *
 * [B16.1B §E] TWO facts are reported, never conflated:
 *  - `signedOut: true` — the LOCAL cookie family was retired (the SDK always
 *    removes the local session on sign-out), and
 *  - `remoteRevocation: "confirmed" | "unconfirmed"` — whether the Auth
 *    server ACKNOWLEDGED the global sign-out (refresh-token family revoked).
 *    Reproduced defect: with the provider unreachable the route reported
 *    `signedOut: true` although the remote session stayed live. The remote
 *    call is deadline-bounded; a failure is reported as `unconfirmed` (the
 *    session may still be live remotely until the token expires), never as a
 *    confirmed revocation.
 *
 * There is NO sign-UP endpoint here (unrestricted self-signup is not enabled)
 * and no token is ever returned.
 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { jsonError } from "@/app/lib/auth/request-security";
import { publicRoute } from "@/app/lib/auth/route-handlers";
import { createBoundedFetch, SESSION_VERIFICATION_DEADLINE_MS } from "@/app/lib/auth/bounded-fetch";
import { sessionCookieOptions } from "@/app/lib/auth/session-cookies";

export const runtime = "nodejs";

// [B16.0.24 §D] canonical PUBLIC no-body wrapper — exact-origin CSRF (the
// public row's requiresCsrf) runs in the wrapper BEFORE any cookie or Supabase
// work; the callback receives NO raw Request and NO raw second Next argument.
// [B16.0.24.1 §2] LEAST PRIVILEGE: the callback receives only the frozen
// three-field auth-runtime projection (resolved mode + Supabase URL + selected
// key) via `exposeAuthRuntime` — never the raw environment object, so an
// unrelated environment value is structurally unreachable here. The route
// retires ONLY the caller's own session cookies: it accepts no
// token/session/destination and issues no redirect. Response is no-store.
export const POST = publicRoute({ exposeAuthRuntime: true }, async ({ authRuntime }) => {
  // [B16.0.2 §H] the reported mode is the SERVER resolver's mode — never an
  // inference from missing configuration. A production runtime without
  // configured Supabase auth is "production, unconfigured" (503), NOT
  // local_dev.
  const { mode, supabaseUrl: url, supabaseKey: key } = authRuntime!;
  if (mode === "local_dev") {
    // Local development: there is no cookie session to clear. Report truthfully.
    return Response.json({ ok: true, signedOut: false, mode: "local_dev" }, { status: 200, headers: { "Cache-Control": "no-store" } });
  }
  if (!url || !key) {
    return Response.json({ ok: false, code: "AUTH_SIGNOUT_UNAVAILABLE", mode: "production", error: "Production authentication is not configured in this deployment; there is no session to sign out of." }, { status: 503, headers: { "Cache-Control": "no-store" } });
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
    // Global scope: every session of the user is asked to be revoked. The SDK
    // retires the LOCAL session regardless of the server's answer; the answer
    // decides `remoteRevocation`.
    const result = await supabase.auth.signOut({ scope: "global" });
    const remoteRevocation = result && result.error ? "unconfirmed" : "confirmed";
    return Response.json({ ok: true, signedOut: true, remoteRevocation }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return jsonError(500, "AUTH_SIGNOUT_FAILED", "Sign-out could not be completed.");
  } finally {
    bounded.dispose();
  }
});
