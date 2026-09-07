# B16.1B §B — the current official Supabase contract vs the implementation

Sources: the official pages fetched on 2026-09-07 (paraphrased; section names in brackets) and the INSTALLED SDK sources (`@supabase/auth-js` 2.112.3 `dist/main/GoTrueClient.js`, `@supabase/ssr` 0.12.4 `dist/main/*`), which are the ground truth for what actually runs.

## 1. Identity validation: `getClaims()` ≠ session liveness

| official statement | source | implementation |
|---|---|---|
| The server reads the session from cookies, which anyone can spoof; always use `getClaims()` to protect pages and data; never trust `getSession()` in server code because it is not guaranteed to revalidate the token | creating-a-client (Next.js tab) [Hook up proxy: Danger] | `getClaims()` is the only claims source; `getSession()` user data is never used (gate-pinned) |
| `getClaims()` verifies the JWT against the JWKS (`/.well-known/jwks.json`); with asymmetric keys validation is local and "does not involve Auth server"; with the legacy shared secret validation is performed by the Auth server "so that revocation can be enforced" | auth-getclaims; signing-keys [Benefits of the signing keys system] | installed `getClaims` (GoTrueClient.js): decode → `validateExp` → `fetchJwk` (global cache, 10-minute TTL) → local `crypto.subtle.verify` when `alg` is asymmetric and `kid` present; otherwise `getUser(token)` fallback |
| `getUser()` makes a network request to the Auth server; the value is authentic and can be the basis for authorization rules | auth-getuser | the new liveness boundary calls `getUser()` once per request on the same client and requires `user.id === claims.sub` |
| "Cookie Max-Age/Expires only govern whether the browser sends the cookie; the only reliable way to know a user is logged out or the session has ended is to fetch the user with `getUser()`" | advanced-guide [FAQ: shorter Max-Age?] | exactly the §E closure |
| "There is no way to revoke an access token JWT until it expires" (sign-out revokes refresh tokens) | auth-signout | the verdict distinguishes token validity from liveness: after sign-out the JWT stays cryptographically valid until `exp`; Sirkit now refuses it through `getUser()` liveness |
| `getSession()` loads values straight from client storage; with cookie storage the values may not be authentic; strongly advised against; use `getUser` instead | auth-getsession [IMPORTANT] | never used for authorization |

## 2. SSR cookies, proxy rotation, PKCE

| official statement | source | implementation |
|---|---|---|
| Two clients: browser client and per-request server client; a client is a configured fetch and must be rebuilt per request | creating-a-client [Do I need a new client for every route?] | one server client per request (WeakMap keyed on the `Request`), never global; no browser client exists in Sirkit |
| The proxy must refresh via `getClaims()`, write rotated cookies onto the request (`request.cookies.set`) and the response, and apply the headers `setAll` hands it (Cache-Control/Expires/Pragma) so CDNs never cache a session | creating-a-client [Write utility functions / What does the cookies object do?] | `updateSession` does all three; B16.1B added the header application and a bounded fetch |
| Do not run code between `createServerClient` and `getClaims()` | embedded proxy sample | preserved |
| Default cookie name `sb-<project_ref>-auth-token`; chunking above 3180 encoded chars into `.0`, `.1`, … | creating-a-client; installed `cookies.js`, `chunker.js` | identity verifier reads the whole family from the `Cookie` header |
| SSR defaults: `path:"/"`, `sameSite:"lax"`, `httpOnly:false`, `maxAge: 400 days`, no `secure` | installed `utils/constants.js` | Sirkit passes `cookieOptions` = `{httpOnly:true, sameSite:"lax", path:"/", secure: expected-origin-is-https}`; the docs say HttpOnly is "unnecessary" because both tokens are passed to browser components — Sirkit has no browser Supabase client, so HttpOnly is defence in depth, not a contradiction |
| A good `SameSite` default is `Lax`; cookies typically need `Secure` so they travel only over HTTPS | advanced-guide [FAQ: SameSite] | `Lax`; `Secure` derived from the server-owned `SIRKIT_EXPECTED_ORIGIN` (https ⇒ Secure; loopback http ⇒ not Secure so a loopback qualification can run) |
| PKCE: the callback receives `?code=…`; `exchangeCodeForSession(code)`; the code is valid 5 minutes and exchangeable once; the verifier lives in storage on the same device | pkce-flow [How it works, Limitations] | callback route: bounded query projection → exchange → safe same-origin redirect; a missing verifier fails locally (`AuthPKCECodeVerifierMissingError`) with no network call |
| Sign-out scopes `global` (default; every device), `local`, `others`; server-side all refresh tokens revoked | auth-signout | Sirkit calls `signOut({ scope: "global" })` and reports `remoteRevocation: "confirmed" | "unconfirmed"` from the SDK's returned error |

## 3. Sessions, refresh rotation, JWT fields

| official statement | source | implementation |
|---|---|---|
| Access tokens are short-lived (default 1 hour); refresh tokens never expire but are single-use; both rotate on every refresh; reuse outside the 10-second reuse interval terminates the whole session | sessions [What is a session?, FAQ] | rotation is the proxy's job (official pattern); route verifiers are read-only, so they never persist a rotation (B16.1B documents the consequence in `cookie-and-refresh-proof.md`) |
| Every access token carries `session_id`, correlatable with `auth.sessions` | sessions [Access token claims] | `sessionIdentity` = `claims.session_id` (never a token) |
| Required claims: `iss, aud, exp, iat, sub, role, aal, session_id, email, phone, is_anonymous`; `sub` is the user UUID; `role` is the Postgres role for RLS; `aal` is `aal1`/`aal2` | jwt-fields [Required claims]; jwts [Introduction] | `userId ← sub`; `authStrength ← aal`; the JWT `role` (a Postgres role) is NEVER the project role — project role comes only from `project_members`; `user_metadata`/`app_metadata` never consulted |
| Rate limits: `/auth/v1/token` 1800/hour per IP with bursts of 30; sustained excess → 429 | rate-limits | the qualification matrix issues a handful of requests; the bounded fetch never retries beyond the SDK's own loop |
| "Allow new users to sign up" can be turned off; then only existing users can sign in | general-configuration | Sirkit exposes no signup route at all (pinned); the project-side setting is UNKNOWN (project unreachable) |

## 4. Installed-SDK facts that drove the design (static, CONFIRMED by reading the shipped code)

| fact | location |
|---|---|
| `getClaims()`: `getSession()` first (may refresh via `/token?grant_type=refresh_token`), `validateExp`, then `fetchJwk` → local verify, or `getUser(token)` fallback for HS*/no-kid/no-WebCrypto | GoTrueClient.js `getClaims` |
| the JWKS cache is process-global per storage key (`GLOBAL_JWKS[storageKey]`), TTL 10 minutes — a warm process pays no network for ES256 verification | GoTrueClient.js `jwks` getters, constants `JWKS_TTL` |
| `getUser()` → `GET /auth/v1/user` with the session's access token; `session_not_found` → `AuthSessionMissingError` + `_removeSession()` | GoTrueClient.js `_getUser` |
| `signOut`: `POST /logout?scope=…`; 401/403/404 ignored; any other error still removes the local session and is RETURNED as `{ error }` | GoTrueClient.js `_signOut` |
| refresh retry: exponential backoff (200, 400, 800, … ms) for `AuthRetryableFetchError` only, inside a 30-second window (`AUTO_REFRESH_TICK_DURATION_MS`); retryable = transport failure or HTTP 500–504 / 520–530; anything else is non-retryable | GoTrueClient.js `_refreshAccessToken`; fetch.js `NETWORK_ERROR_CODES` |
| a session is considered expired 90 s early (`EXPIRY_MARGIN_MS = 3 × 30 s`) | constants.js |
| SSR server storage stages writes in memory (`setItems`) and reads them back within the request; the real cookie write happens in the auth-state hook via `setAll`; a no-op `setAll` therefore never persists a rotation | cookies.js `createStorageFromOptions`, `applyServerStorage` |
| `setSession(...)` calls `_getUser(access_token)` then emits `SIGNED_IN` → cookie write | GoTrueClient.js `setSession` |
| cookie storage key: `sb-${hostname.split(".")[0]}-auth-token` | supabase-js `dist/index.cjs` line 631 |

## 5. Where the implementation deliberately differs from the sample code

- The proxy does NOT redirect unauthenticated users to `/login` (the sample does); Sirkit's routes fail closed with the uniform 401 and the sign-in page is reached by the app. Authorization never happens in the proxy.
- The three writing routes (sign-in, callback, sign-out) and the proxy pass a per-request **bounded fetch** to the SDK (`global.fetch`), which the samples do not; without it an unreachable provider held a request for ~51 s (reproduced).
- The identity verifier's server client is **read-only** (`setAll` no-op) by design; rotation is the proxy's job exactly as the docs prescribe.
