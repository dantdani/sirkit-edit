# B16.0.24 — authorization & scope proof

Every one of the five methods now resolves its boundary inside a canonical
wrapper; the callback never touches the raw Request.

| method | wrapper | authorization boundary (in the wrapper) |
|---|---|---|
| callback GET | `publicRoute` | public row; no CSRF (GET); `resolveExpectedOrigin` for the redirect |
| signin POST | `publicJsonRoute` | public row + same-origin CSRF (`authorizeRequest`) before body |
| signout POST | `publicRoute` | public row + same-origin CSRF before any cookie/Supabase work |
| chat POST | `agentStreamRoute` | body-scope selector → `resolveTrustedRequestContext` (identity + LIVE membership + production CSRF) → exact policy role gate |
| simulate POST | `authenticatedJsonRoute` | header-selector `authorizeRequest` (identity + membership + role + CSRF) before the bounded read |

- **Trusted human identity, membership, role, scope for chat** are resolved by
  the wrapper before the provider loop: a viewer → 403 `AUTH_ROLE_DENIED` with
  zero provider work; cross-origin (production) → 403 with no run-id / no
  ndjson content-type (pinned). The scope is the body selector (the client
  sends no headers); the byte-pinned policy `identitySource:
  "body-scope-server-actor"` is unchanged. **CONFIRMED**.
- **Simulate** authorizes (header selector) + CSRF before any temp file or
  process work; unauthenticated → 401 with zero spawns (pinned). **CONFIRMED**.
- **No callback reconstructs URL / cookies / headers / identity / role /
  scope** — gate: comment-stripped source of all five routes contains no
  `request.{json,text,body,headers,url,signal,cookies}`, no
  `new URL(request…)`, no `resolveTrustedRequestContext`/`authorizeRequest`/
  `authorizeActor`/`requireSameOrigin`. Cookie WRITES by the @supabase/ssr
  client (via `next/headers`) are the sanctioned session mechanism.
  **CONFIRMED**.
- **Standing regression surface green**: 163 chat/auth/gate/CSV tests pass
  unchanged, including the byte-exact `auth-route-coverage.csv` (chat policy
  row untouched) and the boundary gate. **CONFIRMED**.
