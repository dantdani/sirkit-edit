# B16.1B §C — pre-edit reproductions (against the UNCHANGED code)

Harness: a disposable vitest file (`app/lib/auth/__tests__/_b16-1b-probe.test.ts`, deleted after the permanent suites landed) driving the REAL `@supabase/ssr` + `@supabase/auth-js` SDK with a locally generated ES256 key pair and a `fetch` spy standing in for the Auth server; plus the real Next.js production server (`next build` + `next start` on loopback `http://127.0.0.1:3100`, `SIRKIT_EXPECTED_ORIGIN` = that origin) driven by a loopback HTTP matrix. Every identifier below is a synthetic sentinel; no secret, cookie value, or real email appears anywhere. Result of the pre-edit run: 27/27 probes behaved exactly as recorded below.

| # | reproduction | exact result (pre-edit) | label |
|---|---|---|---|
| R1 | `NODE_ENV=production` without Supabase configuration | resolver 403 `AUTH_PRODUCTION_NOT_CONFIGURED` before any identity call; `resolveAuthMode` = `production` regardless of `SIRKIT_AUTH_MODE=local_dev` or missing host; runtime factory composes the Supabase adapter and verifies nobody with zero network; sign-in 503 `AUTH_SIGNIN_UNAVAILABLE`; sign-out 503 `AUTH_SIGNOUT_UNAVAILABLE` (`mode: "production"`); callback 303 → `<expected-origin>/signin?error=auth` | CONFIRMED (fail-closed as designed) |
| R2 | cookies: missing; six malformed shapes (garbage, bad base64, base64 of non-JSON, JSON without tokens, JSON with a non-JWT token, raw JSON); expired (refresh rejected); forged ES256 signature; payload tampered after signing; `alg=none`; unknown `kid` | every case 401 `AUTH_UNAUTHENTICATED`; missing cookie = zero network; expired = exactly one refresh attempt and zero `/user`; never a crash | CONFIRMED (real SDK) |
| R3 | forged `x-sirkit-actor-id`, `x-sirkit-role=project_admin`, `x-sirkit-actor-kind=system_migration`, `x-sirkit-user-id` with a genuinely signed session | actor id = JWT `sub`, role = `project_members` (viewer), kind = human; headers inert | CONFIRMED (real SDK) |
| R4 | missing / revoked / foreign-project (active elsewhere) / foreign-tenant (active elsewhere) membership | four byte-identical 403 bodies `{"ok":false,"code":"AUTH_NO_ACTIVE_MEMBERSHIP","error":"You have no active membership for this project."}` | CONFIRMED |
| R5 | viewer on `POST /api/pcb-sync` (editor-only) | 403 `AUTH_ROLE_DENIED`; zero body pulls; handler never invoked | CONFIRMED |
| R6 | Origin missing / `null` / bare host / trailing slash / credentials / http-downgrade / foreign / port mismatch / forwarding-header spoof; production without `SIRKIT_EXPECTED_ORIGIN` | 403 `AUTH_ORIGIN_MISSING`, `AUTH_ORIGIN_NULL`, `AUTH_ORIGIN_MALFORMED` ×3, `AUTH_CROSS_ORIGIN_DENIED` ×4, `AUTH_ORIGIN_NOT_CONFIGURED`; zero body pulls; identity provider never invoked | CONFIRMED |
| R7 | same-origin authenticated `GET /api/pcb-sync` with a genuinely signed session | 200; handler invoked once with `actorId = sub`, `role = pcb_editor` (from membership `editor`) | CONFIRMED (real SDK) |
| **R8** | **a cryptographically VALID, unexpired ES256 token whose remote session no longer exists (`/user` answers 403 `session_not_found`)** | **ACCEPTED (`ok: true`); `/user` called 0 times — `getClaims()` verified the signature locally and never asked the server** | **CONFIRMED FAIL-OPEN (real SDK, asymmetric keys)** |
| R8′ | same with an HS256 (legacy shared-secret) token | refused 401 after 1 `/user` call — the SDK itself falls back to `getUser()` for symmetric keys | CONFIRMED (contrast) |
| R9 | active → revoked membership between two requests with the same unchanged session | second request 403 `AUTH_NO_ACTIVE_MEMBERSHIP`; zero refresh calls; a role change produces a different `membershipRevision` | CONFIRMED (membership is re-read per request) |
| R10 | all 31 collected refusal envelopes | every one `Cache-Control: no-store`, status ∈ {401, 403, 503}, keys ⊆ {ok, code, error, mode}, error ≤ 300 chars, no sentinel URL/key/token/refresh/cookie name in body or headers, no `Set-Cookie` | CONFIRMED |

## Real-HTTP reproductions (production build, loopback, Supabase unreachable)

| # | probe | pre-edit | defect |
|---|---|---|---|
| H7 | `GET /api/pcb-sync` with an EXPIRED session cookie (refresh endpoint unreachable) | 401 after **51,116 ms** | UNBOUNDED provider calls: the SDK retried the refresh with backoff inside its 30-second window, once in `proxy.ts` and once in the route — an attacker can hold server request handling ~50 s per request with a stale cookie |
| H22 | `POST /api/auth/signout` with a session cookie while the Auth server is unreachable | 200 `{ok:true, signedOut:true}` + local cookie retirement | CONFLATION: the SDK's returned error (remote revocation NOT performed) was discarded; "signed out" was claimed although the remote session (refresh-token family) stayed live |
| H5/H6 | self-signed ES256 cookie (JWKS unreachable) / HS256 cookie (`/user` unreachable) | 401 in 68 ms / 24 ms | fail-closed (no retry on those paths) — unchanged |
| H2–H4, H8–H21, H23 | no/forged/malformed cookie, CSRF classes, sign-in refusals, callback, sign-out CSRF, signup 404 | all as designed (see `live-auth-qualification-matrix.md`) | — |

## Additional findings surfaced while reproducing

| finding | evidence | disposition |
|---|---|---|
| The sign-in route's comment claimed the SSR cookies were "httpOnly, managed by @supabase/ssr"; the installed SSR default is `httpOnly: false` and no `secure` attribute | `@supabase/ssr` `utils/constants.js`; no `cookieOptions` passed anywhere | corrected — server-owned option set (`session-cookies.ts`); see `cookie-and-refresh-proof.md` |
| RLS for `project_members` existed ONLY in the SQL file; the drizzle schema (what `pnpm drizzle-kit push` applies, per README) declared neither `enableRLS()` nor the policy | `app/lib/db/schema.ts` vs `drizzle/0027_project_membership.sql` | corrected — policy + RLS declared in the schema, parity test-pinned; see `membership-and-rls-proof.md` |
| Migration `0027` is not registered in `drizzle/meta/_journal.json` (entries stop at 0026) | journal inspection | NOT changed (owner decision; documented) |
| R-extra: the PKCE callback in a production runtime WITHOUT `SIRKIT_EXPECTED_ORIGIN` redirects to the request-URL origin (Host-derived) | probe `callbackGet("https://attacker-host.example/api/auth/callback?code=x")` → 303 to that host | documented B16.0.24 fallback; only the caller's own request is affected (a victim's browser sends the real Host); production sign-in is impossible without the configured origin anyway — recorded, unchanged |
| `b16-0-ai-approval-lifecycle` test 22/23 times out (5 s) under the parallel auth batch | identical on the UNTOUCHED tree (git stash A/B) and 3/3 green in isolation (~1.5 s); the same dynamic-import flake was already recorded by B16.0.2 | pre-existing load-related import timeout, not a B16.1B regression |
