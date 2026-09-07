# B16.1B §D — cookie and refresh proof

## Cookie flags: the installed default vs Sirkit

| attribute | `@supabase/ssr` 0.12.4 default (`utils/constants.js`) | Sirkit after B16.1B (`app/lib/auth/session-cookies.ts`) | label |
|---|---|---|---|
| name | `sb-<project-ref>-auth-token` (+ `.0`, `.1`, … chunks above 3 180 encoded chars) | unchanged | CONFIRMED (SDK source) |
| `Path` | `/` | `/` | CONFIRMED |
| `SameSite` | `Lax` | `Lax` | CONFIRMED |
| `HttpOnly` | **false** | **true** — Sirkit has no browser Supabase client; nothing in the browser needs to read the session cookie, so the pre-edit comment "httpOnly, managed by @supabase/ssr" was false and is now true | CONFIRMED (real SSR write observed) |
| `Secure` | not set | **true when the server-owned `SIRKIT_EXPECTED_ORIGIN` is https; false for the only non-https origin production accepts (loopback http)** | CONFIRMED (real SSR write observed) |
| `Max-Age` | 400 days on set; `0` on removal | SDK-controlled (unchanged): 400 days on set, `0` on retirement | CONFIRMED |
| value encoding | `base64-` + base64url(JSON session) | unchanged | CONFIRMED |

The official advanced guide says HttpOnly is "unnecessary" because both tokens are meant to be passed to browser components — that reasoning does not apply to Sirkit (server-only clients), so HttpOnly is defence in depth consistent with the docs' `SameSite=Lax` + `Secure` guidance.

Every WRITING client passes the option set: sign-in, PKCE callback, sign-out, and the proxy refresh (`updateSession`). The identity verifier's client is read-only and passes none.

## Proof with the REAL `@supabase/ssr` client (offline, fetch spy) — `b16-1b-cookie-semantics.test.ts`

| step | observed | label |
|---|---|---|
| session write (`setSession`) with an https expected origin | the `sb-<ref>-auth-token` family written with `httpOnly:true, sameSite:"lax", path:"/", secure:true, maxAge: 34 560 000`; the SDK hands the app `Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0`, `Expires: 0`, `Pragma: no-cache` | CONFIRMED |
| session write with a loopback http expected origin | same flags with `secure:false` | CONFIRMED |
| sign-out (server 204) | EVERY chunk of the family rewritten with value `""`, `maxAge:0`, same flags — local retirement | CONFIRMED |
| sign-out with the Auth server UNREACHABLE | local retirement still happens; the SDK RETURNS the error (the route maps it to `remoteRevocation: "unconfirmed"`) | CONFIRMED |
| no token / key / refresh sentinel in any cookie NAME or in the SDK-supplied headers | asserted | CONFIRMED |

## Proof on real Next.js HTTP (production build, loopback; Supabase unreachable)

| row | observed `Set-Cookie` | meaning |
|---|---|---|
| H7 expired cookie, refresh unreachable | `sb-<ref>-auth-token=; Path=/; Max-Age=0; HttpOnly; SameSite=lax` + `Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0`, `Pragma: no-cache`, `Expires: 0` | the proxy retired a dead session with the server-owned flags and the SDK's anti-caching headers; `Secure` correctly absent on loopback http |
| H22 sign-out with a session cookie, server unreachable | same retirement cookie; body `{ok:true, signedOut:true, remoteRevocation:"unconfirmed"}` | local retirement ≠ remote revocation, reported truthfully |
| all other rows | none | no refusal ever writes a cookie |

A successful sign-in's `Set-Cookie` on real HTTP: **BLOCKED** (no reachable project / account).

## Refresh and rotation semantics (`b16-1b-proxy-and-route-cookies.test.ts`, SDK source)

| statement | status |
|---|---|
| Rotation is the proxy's job: `updateSession` runs `getClaims()` on every matched request (matcher covers `/api`); a refresh writes the rotated pair onto the forwarded request (`request.cookies.set`, so the route handler's `Cookie` header already carries the fresh session) and onto the response with the server-owned options, and applies the SDK's anti-caching headers | CONFIRMED (fake SSR through the real `updateSession` with a `NextRequest`) |
| The proxy never fails a request: unconfigured → pass-through with zero clients; SDK throw → pass-through with no cookie write and no diagnostic | CONFIRMED |
| The route's verifier client is read-only; if it ever refreshed (only possible when the proxy did not — e.g. proxy refresh failed within budget), the rotated pair would live only in that request's memory and the browser would keep the old refresh token; Supabase's reuse detection tolerates a 10-second reuse interval, beyond which the family is revoked | CONFIRMED by SDK/docs reading; the design keeps rotation in the proxy exactly as the official pattern prescribes |
| A session is considered expired 90 s early (`EXPIRY_MARGIN_MS`), so rotation happens before the access token actually expires | CONFIRMED (SDK constants) |
| Deadline semantics: both proxy and route bound every provider call to 5 s; an already-expired session that cannot refresh within the budget is retired locally (H7) — a still-valid token is preserved | CONFIRMED (real HTTP) |
| Real refresh-token rotation through `proxy.ts` against a live Auth server (fresh pair issued, old pair rejected after the reuse interval) | **BLOCKED** (no reachable project) — the opt-in live test records whether a rotation occurred on a fresh session and checks the family/flags if it did |

## Sign-in success body

`{ ok: true }` only — no token, session, or user object (fake SSR through the real route; pinned since B16.0.24.1). Real HTTP success: BLOCKED.
