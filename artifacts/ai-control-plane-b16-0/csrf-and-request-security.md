# B16.0 — CSRF and request security

`app/lib/auth/request-security.ts`, for cookie-authenticated state-changing
requests (Next.js Route Handlers get no automatic CSRF):

- **Same-origin** (`requireSameOrigin`): POST/PUT/PATCH/DELETE compare the
  `Origin` header host against `X-Forwarded-Host`/`Host` (falling back to the
  request URL host). A cross-origin or missing-Origin state-changing request
  is refused 403. GET/HEAD/OPTIONS are exempt. Enforced by the assignment-
  queue mutation surface, the sign-out route, and any resolver call with
  `enforceSameOrigin` (production).
- **Content type** (`requireJsonContentType`): only `application/json`
  (415 otherwise).
- **Size ceilings**: retained per route (`PCB_SYNC_API_MAX_BYTES` 8 MB,
  physical-binding 2 MB, assignment-queue 1 MB).
- **Open-redirect prevention** (`safeRedirectPath`): only a same-origin
  relative path survives; `//host`, absolute URLs, and backslash tricks fall
  back to `/`.
- **Bounded diagnostics** (`jsonError`): public messages are ≤300 chars and
  never carry a token, cookie, secret, or raw stack.
- **401 vs 403**: authentication failures return 401 (`unauthenticated`);
  authorization failures return 403 (`forbidden`).
- **Constant-time secret compare** (`constant-time.ts`): `timingSafeEqualString`
  uses `node:crypto` `timingSafeEqual` (matching the existing `server-auth.ts`
  precedent), folding length differences into the decision without a
  length-revealing early return. Used by the worker-secret boundary.
- **No token in URL/log/error**: identity never travels in a query string; the
  correlation id is a non-secret digest.

## Cookie attributes

Session cookies are managed by `@supabase/ssr` with `HttpOnly` / `Secure` /
`SameSite` per the SDK's defaults; rotation writes fresh cookies in `proxy.ts`.
Auth-bearing responses set `Cache-Control: no-store` so a rotated `Set-Cookie`
is never cached and served to another user.
