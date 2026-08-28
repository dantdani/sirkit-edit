# B16.0.24 §D — sign-out session retirement proof

`POST /api/auth/signout` → `publicRoute({ exposeEnvironment: true })`.

- **Exact-origin CSRF before any cookie/Supabase work**: the public row's
  `requiresCsrf` runs inside the wrapper's `authorizeRequest` before the
  callback. Pinned: unconfigured-origin production → 403; forwarded-host spoof
  (`origin: evil` + `x-forwarded-host: evil`) → 403. **CONFIRMED**.
- **Local development truthfully returns `signedOut: false`**: `post({})` →
  200 `{ ok: true, signedOut: false, mode: "local_dev" }`. Pinned.
  **CONFIRMED**.
- **Unconfigured production → 503 `AUTH_SIGNOUT_UNAVAILABLE` mode
  production** (never local_dev) across unset/contradictory public variables.
  Pinned (standing `b16-0-2-mode-diagnostics`, migrated to `vi.stubEnv`).
  **CONFIRMED**.
- **Configured production invokes sign-out exactly once** (`supabase.auth
  .signOut()`); exceptions → bounded 500 `AUTH_SIGNOUT_FAILED`, secret-free.
  (Supabase branch not test-reachable.) **CONFIRMED / INFERRED**.
- **No redirect, no caller-provided destination**: the route accepts no body
  and issues no redirect (gate: comment-stripped source contains no
  `redirect`). It retires ONLY the caller's own cookie session; it accepts no
  token/session from the caller and cannot sign out another principal.
  **CONFIRMED**.
- **`Cache-Control: no-store`** on every response. **CONFIRMED**.
- **Deterministic env injection preserved declaratively**: the
  `exposeEnvironment` wrapper option feeds `input.environment`
  (`options.environment ?? process.env`, resolved per request) — NOT a raw
  second Next handler argument. The one consuming test injects via
  `vi.stubEnv`. Gate: the route contains no `options: { environment` shape.
  **CONFIRMED**.

---

## [SUPERSEDED IN PART — B16.0.24.1 §2]

"Deterministic env injection preserved declaratively: the `exposeEnvironment`
wrapper option feeds `input.environment` (`options.environment ?? process.env`)"
was NOT least-privilege: the callback received the COMPLETE process
environment (every unrelated secret enumerable). B16.0.24.1 replaced it with
`exposeAuthRuntime` → a FROZEN three-field projection (`mode`, `supabaseUrl`,
`supabaseKey`; copied values, no reference to the source env, no mutation),
with a sentinel-secret test proving unrelated environment values cannot reach
the callback, response, or console. See
`artifacts/ai-control-plane-b16-0-24-1/auth-environment-confinement.md`.
