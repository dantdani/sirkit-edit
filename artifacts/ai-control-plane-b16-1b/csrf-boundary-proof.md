# B16.1B §C/§G — CSRF boundary proof (exact origin)

Authority: the ONE server-owned expected origin (`SIRKIT_EXPECTED_ORIGIN`, validated; production requires it, https or loopback http). The `Origin` header is parsed strictly and compared as a complete normalized origin (scheme + host + effective port). `Host`, `X-Forwarded-*`, `Forwarded` never redefine it. Safe methods are exempt. Unchanged design (B16.0.2); this stage re-proves it through the wrappers, the real SDK identity path, and real HTTP.

## Ordering guarantee (pinned by `b16-1b-auth-composition.test.ts`, `b16-1b-real-sdk-identity.test.ts`)

For a cookie-authenticated state-changing request, CSRF runs BEFORE identity, liveness, membership, body, and handler:

| Origin presented | status / code | body pulls | claims verifier | liveness | membership | handler |
|---|---|---|---|---|---|---|
| missing | 403 `AUTH_ORIGIN_MISSING` | 0 | 0 | 0 | 0 | 0 |
| `null` | 403 `AUTH_ORIGIN_NULL` | 0 | 0 | 0 | 0 | 0 |
| bare host / trailing slash / credentials | 403 `AUTH_ORIGIN_MALFORMED` | 0 | 0 | 0 | 0 | 0 |
| http on an https expected origin (downgrade) | 403 `AUTH_CROSS_ORIGIN_DENIED` | 0 | 0 | 0 | 0 | 0 |
| foreign origin | 403 `AUTH_CROSS_ORIGIN_DENIED` | 0 | 0 | 0 | 0 | 0 |
| port mismatch | 403 `AUTH_CROSS_ORIGIN_DENIED` | 0 | 0 | 0 | 0 | 0 |
| foreign origin + `X-Forwarded-Host`/`Host` spoof | 403 `AUTH_CROSS_ORIGIN_DENIED` | 0 | 0 | 0 | 0 | 0 |
| production without `SIRKIT_EXPECTED_ORIGIN` | 403 `AUTH_ORIGIN_NOT_CONFIGURED` | 0 | 0 | 0 | 0 | 0 |
| exact same origin, session revoked | 401 `AUTH_UNAUTHENTICATED` | 0 | 1 | 1 | 0 | 0 |
| exact same origin, viewer on an editor-only route | 403 `AUTH_ROLE_DENIED` | 0 | 1 | 1 | 1 | 0 |
| exact same origin, live member | handler runs once | — | 1 | 1 | 1 | 1 |

"Body pulls" is measured with a counting `ReadableStream` (`highWaterMark: 0`): a refusal never consumes a byte.

## Real Next.js HTTP (production build, loopback origin `http://127.0.0.1:3100`)

| probe | result |
|---|---|
| `POST /api/pcb-sync` missing Origin | 403 `AUTH_ORIGIN_MISSING` |
| foreign Origin | 403 `AUTH_CROSS_ORIGIN_DENIED` |
| Origin `null` | 403 `AUTH_ORIGIN_NULL` |
| foreign Origin + `X-Forwarded-Host` | 403 `AUTH_CROSS_ORIGIN_DENIED` |
| exact same origin (no session) | 401 — CSRF passed, identity refused |
| `POST /api/auth/signin` cross-origin | 403 `AUTH_CROSS_ORIGIN_DENIED` (before the body is read) |
| `POST /api/auth/signout` cross-origin | 403 `AUTH_CROSS_ORIGIN_DENIED` (before any SDK work) |
| `GET /api/auth/callback` | safe method — exempt; the exchange cannot be forged cross-site because the PKCE verifier lives only in the initiating browser's storage (`AuthPKCECodeVerifierMissingError` fails locally without a network call) |

All CONFIRMED (real HTTP). Same-origin traffic with a live session against a real project: BLOCKED (see the live matrix).

## Public auth routes

`/api/auth/signin` and `/api/auth/signout` are public policy rows WITH `requiresCsrf: true` (unchanged); the wrapper enforces it before any cookie or SDK work (pinned by the B16.0.24.1 zero-SDK-call tests and re-run green here).
