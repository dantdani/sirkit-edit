/**
 * B16.1B §D — the ONE server-owned session-cookie option set.
 *
 * Verified against the installed `@supabase/ssr` 0.12.4: its defaults are
 * `path: "/"`, `sameSite: "lax"`, `httpOnly: false`, `maxAge: 400 days`, and
 * it sets NO `secure` attribute. The sign-in route's historical comment
 * claimed the SSR cookies were HttpOnly — that claim was false. Sirkit has no
 * browser-side Supabase client (nothing in the browser reads the session
 * cookie), so the session cookie family is written HttpOnly here, and Secure
 * whenever the server-owned expected origin (`SIRKIT_EXPECTED_ORIGIN`, the
 * same authority CSRF uses) is https. A loopback http origin — the only
 * non-https origin production accepts — yields a non-Secure cookie so a
 * loopback qualification run can complete. `maxAge` stays the SDK's (it
 * re-applies its own value for set and 0 for retirement).
 *
 * Every server client that can WRITE session cookies (sign-in, PKCE callback,
 * sign-out, the proxy refresh) passes this object; read-only verifier
 * clients never write and need no options.
 */

import { normalizeOrigin, SIRKIT_EXPECTED_ORIGIN_ENV } from "./expected-origin";

export interface SessionCookieOptions {
  readonly path: "/";
  readonly sameSite: "lax";
  readonly httpOnly: true;
  readonly secure: boolean;
}

export function sessionCookieOptions(environment: Record<string, string | undefined> = process.env): SessionCookieOptions {
  const configured = environment[SIRKIT_EXPECTED_ORIGIN_ENV]?.trim();
  const normalized = configured ? normalizeOrigin(configured) : null;
  return Object.freeze({
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: normalized !== null && normalized.startsWith("https:"),
  });
}
