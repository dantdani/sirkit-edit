# B16.0.24 §B — auth callback security proof

`GET /api/auth/callback` → `publicRoute({ query: true, requestOrigin: true })`.
The callback receives NO raw Request.

- **`code` and `next` via bounded query projection**: `meta.query.code` /
  `meta.query.next` (frozen, first-value-wins, 2048-char cap). **CONFIRMED**.
- **`next` is a same-origin relative path**: `safeRedirectPath` rejects
  absolute URLs, `//host` protocol-relative, `/\` and any backslash,
  `javascript:` and every non-`/` value → falls back to `/`; a valid
  `/projects/1` is preserved. Pinned. **CONFIRMED**.
- **Redirect origin is server-owned, not a header**: `meta.origin` is
  `resolveExpectedOrigin` — the validated `SIRKIT_EXPECTED_ORIGIN` in
  production, the router's request-URL origin in local_dev — never `Host` /
  `X-Forwarded-Host` / `Forwarded`. Gate: the route contains no `requestUrl` /
  `new URL(request…)`; `requestOrigin` is the callback's SOLE adopter
  (repo-wide). **CONFIRMED** (correction from the raw `new URL(request.url).origin`).
- **Fail-closed redirects**: missing config, missing code, exchange error, SDK
  exception all return the bounded `/signin?error=auth` 303 to the verified
  origin. Pinned: no code → 303 same-origin `/signin?error=auth`; a hostile
  absolute `next` → still same-origin `/signin`. **CONFIRMED**.
- **No token / code / session / provider diagnostic in body or URL**: the
  response is a bare 303 redirect to a relative path; the §A pin asserts the
  location matches neither `token` nor `code=`. **CONFIRMED**.
- **Cookies written only by the server-side @supabase/ssr client** via
  `next/headers` `cookies()` — never reconstructed from the Request.
  **CONFIRMED**.
- **Retry/replay**: a code is consumed exactly once by
  `exchangeCodeForSession`; the route holds no code state and exposes a code no
  more than the provider permits (the provider owns single-use). **CONFIRMED**.

---

## [SUPERSEDED IN PART — B16.0.24.1 §3]

The "Retry/replay … CONFIRMED" and exchange-success behaviors above were
design claims without executable coverage. Now **CONFIRMED** by fake
@supabase/ssr clients: a successful exchange calls `exchangeCodeForSession`
exactly once with the code, writes session cookies ONLY through the SSR cookie
adapter, and redirects to the validated `next` path; a failed exchange or SDK
exception yields the bounded `/signin?error=auth` with no code, cookie value,
or provider diagnostic (sentinel-checked) in the redirect. See
`artifacts/ai-control-plane-b16-0-24-1/supabase-ssr-fake-client-proof.md`.
