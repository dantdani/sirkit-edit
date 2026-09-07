# B16.1B §E — session-liveness decision and closure

## The question (R8) and the answer

**Is a cryptographically valid JWT from a remotely revoked Supabase session still accepted by the `getClaims()`-only identity path?**

- **YES, with asymmetric signing keys** (ES256/RS256 — the default for new Supabase projects and the family the official docs recommend). Reproduced with the REAL installed SDK: a locally generated ES256 key pair, a genuinely signed unexpired token, a JWKS served by a `fetch` spy, and `/auth/v1/user` answering 403 `session_not_found`. The pre-edit path resolved `ok: true` and made **zero** `/user` calls. **CONFIRMED (real SDK, offline).**
- **NO with the legacy HS256 shared secret**: the SDK's own `getClaims()` falls back to `getUser(token)` for symmetric keys, so the Auth server refuses the revoked session. **CONFIRMED (real SDK, offline).**
- Which family the real project uses is **UNKNOWN** (project unreachable — see `configuration-readiness.md`). A design whose revocation behaviour depends on an unverifiable project setting is not acceptable; the closure below is correct under both.

This matches the official contract exactly: `getClaims()` proves a token is genuine and unexpired; "there is no way to revoke an access token JWT until it expires"; "the only reliable way to know a user is logged out or the session has ended is to fetch the user with `getUser()`" (see `official-supabase-contract.md`). **Token validity ≠ session liveness.** The pre-edit design conflated them; this stage stops calling it "immediately revoked".

## The closure (one provider-neutral boundary)

| element | file | behaviour |
|---|---|---|
| provider-neutral liveness contract | `app/lib/auth/session-liveness.ts` | `SessionLivenessVerifier.confirm(request, expectedUserId, signal)` → `{live:true,userId}` or `{live:false, reason: revoked|mismatch|timeout|aborted|error|unavailable}`; `confirmSessionLiveness(...)` runs EXACTLY one confirmation with settle-once semantics: deadline → `timeout`, caller abort → `aborted`, throw/reject → `error`, malformed outcome → `error`; a late resolution or late rejection after settlement is ignored (never a second outcome, never an unhandled rejection) |
| adapter | `app/lib/auth/identity-provider.ts` `SupabaseIdentityProvider` | order preserved: `getClaims()` signed-claim validation → local `exp` re-check → **liveness** → principal. `outcome.userId` must EXACTLY equal `claims.sub`; anything else → `null` → the resolver's existing uniform 401 `AUTH_UNAUTHENTICATED`. Zero liveness calls when claims fail (expired/malformed/absent) |
| production verifiers | `createSupabaseSessionVerifiers(env)` | ONE `@supabase/ssr` server client per `Request` (WeakMap keyed on the request object) used for both `getClaims()` and `getUser()`; cookies from the `Cookie` header; read-only (`setAll` no-op — rotation is the proxy's job); every SDK call through a per-request bounded fetch |
| bounded, abort-safe transport | `app/lib/auth/bounded-fetch.ts` | one deadline (`SESSION_VERIFICATION_DEADLINE_MS` = 5 000 ms) per request for ALL provider calls (JWKS, refresh, user); the caller's `request.signal` cancels in-flight calls; after the deadline the SDK receives a NON-RETRYABLE sentinel (HTTP 400, `error_code: sirkit_verification_deadline`, no secret) so its refresh-retry loop stops instead of sleeping through its 30-second window |
| composition | `app/lib/auth/identity-runtime.ts` | the production factory composes claims + liveness; `local_dev` is unchanged; routes never call the SDK — "exactly one verification sequence per request, no duplicated route-level lookups" holds structurally |
| authority | unchanged | project role comes ONLY from `project_members`; `getSession().user`, `user_metadata`, the JWT `role`/`app_metadata`, and the `getUser()` user object are never authorization authority — the user object contributes exactly one fact: its `id` for the equality check |

### Failure classes → uniform 401 (all pinned by tests)

revoked (server 403 `session_not_found`) · mismatch (`user.id ≠ claims.sub`) · timeout (deadline) · aborted (client disconnect) · SDK error / rejection · provider unavailable (unconfigured / SDK missing). The 401 body is byte-identical to the pre-existing contract: `{"ok":false,"code":"AUTH_UNAUTHENTICATED","error":"Missing, expired, or invalid authentication."}`, `Cache-Control: no-store`, no `Set-Cookie`.

### Exactly-once (pinned)

Per verify: one `getClaims`, one `getUser`, in that order, on the same client (`b16-1b-session-liveness.test.ts`, `b16-1b-real-sdk-identity.test.ts`). HS256 projects: the SDK's internal `/user` fallback inside `getClaims` plus the explicit liveness call = two `/user` round trips for a LIVE session (a revoked one is refused by the first) — documented cost, accepted rather than special-casing SDK internals.

## Latency and availability — honest accounting

| scenario | before | after | evidence |
|---|---|---|---|
| ES256, warm JWKS cache, live session | 0 network calls (local verify) | **+1** `GET /auth/v1/user` round trip | real-SDK tests (fetch spy); live RTT UNKNOWN — typical Supabase Auth RTT is tens to a few hundred ms (INFERRED, not measured) |
| ES256, cold process | 1 (JWKS) | 2 (JWKS + user); the JWKS cache is process-global with a 10-minute TTL | SDK source |
| HS256 (legacy), live session | 1 (`/user` inside `getClaims`) | 2 | real-SDK test |
| in-process overhead of the boundary itself (fake verifier) | — | < 5 ms per request (settle-once race, no timers left behind) | `b16-1b-session-liveness.test.ts` |
| expired-session cookie with the provider UNREACHABLE (real Next.js HTTP) | **51 116 ms** (unbounded SDK retry, proxy + route) | **6 294 ms** (5 s proxy budget + 1 s route; the route's own client saw the sentinel immediately after the proxy retired the session) | `live-auth-qualification-matrix.md` rows H7 |
| self-signed / HS256 cookie, provider unreachable | 68 / 24 ms | 27 / 13 ms | rows H5/H6 |

Availability trade-off (deliberate, documented): an authenticated request now requires the Auth server to be reachable within the budget; a provider outage makes protected routes fail CLOSED (401) instead of open. That is the mandate's requirement ("Failure, timeout, mismatch or SDK error must fail closed").

Cookie side effect of the deadline (documented, SDK semantics): when the access token is ALREADY expired and the refresh cannot complete within the budget, the SDK treats the non-retryable sentinel as a definitive refresh failure and removes the local session; the proxy therefore emits a retirement `Set-Cookie` (`Max-Age=0`, HttpOnly, Path=/) — observed on real HTTP (row H7). The remote session is NOT revoked by that; the browser simply has to sign in again. A still-valid access token is never retired by a deadline.

## Sign-out truthfulness (H22 closure)

`POST /api/auth/signout` now calls `signOut({ scope: "global" })` and reports two facts separately: `signedOut: true` (the LOCAL cookie family was retired — the SDK always does this) and `remoteRevocation: "confirmed" | "unconfirmed"` (whether the Auth server acknowledged the global revocation). Before, a failed remote call was reported as a successful sign-out. Pinned with fake and real SSR clients; observed on real HTTP (row H22: 200 + retirement cookie while the server was unreachable — now labelled `unconfirmed`).

## Membership revocation (R9)

Membership is re-read from server-owned storage on EVERY request (no cache): active → revoked is observed on the immediately following request without any token refresh; a role change changes `membershipRevision` (retiring bound approvals). **CONFIRMED (offline, fake repository + real SDK identity).** Live confirmation of the Postgres path: **BLOCKED**.

## The verdict, stated precisely

| fact | what proves it | Sirkit's behaviour after B16.1B |
|---|---|---|
| **JWT validity** | signature against the project keys + `exp` (`getClaims()`) | required; a forged/tampered/expired/`alg=none` token is 401 |
| **session liveness** | one server confirmation (`getUser()`), id == `sub` | required; a valid token from a revoked session is 401 |
| **membership authority** | `project_members` (tenant, project, user) active row | required on every request; role never from the token |
| **local cookie retirement** | `Set-Cookie … Max-Age=0` on sign-out / dead session | performed; reported as `signedOut`, never as proof of remote revocation |
| **remote revocation** | Auth server acknowledges `POST /logout?scope=global` | reported as `remoteRevocation`; the access token itself stays cryptographically valid until `exp` (Supabase design) but is refused by liveness |

Live proof of the whole chain against a real project: **BLOCKED** (see `live-auth-qualification-matrix.md`); the opt-in live test replays a pre-sign-out cookie jar after sign-out and expects 401 — that is the single assertion that turns this CONFIRMED-offline closure into CONFIRMED LIVE.
