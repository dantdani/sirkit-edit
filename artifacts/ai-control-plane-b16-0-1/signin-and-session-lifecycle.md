# B16.0.1 §H — production sign-in / session lifecycle (R8 closure)

## Surfaces

- **`POST /api/auth/signin`** — existing-account password sign-in via the
  official `@supabase/ssr` server client (`signInWithPassword`). Same-origin
  CSRF BEFORE the body is read; `application/json` only; bounded credentials
  (email ≤ 320 chars, password ≤ 1024, body ≤ 16 KB); UNIFORM 401
  `AUTH_SIGNIN_FAILED` on any credential failure (no user enumeration); the
  SSR client writes httpOnly session cookies and the response body carries NO
  token/session/user object; unconfigured deployments refuse 503
  `AUTH_SIGNIN_UNAVAILABLE`.
- **`GET /api/auth/callback`** — the PKCE flow completion
  (`exchangeCodeForSession`) for magic-link/OAuth on existing accounts. The
  `next` target passes `safeRedirectPath` (single-leading-slash relative paths
  only — absolute/protocol-relative/backslash/scheme tricks fall back to `/`);
  failures redirect same-origin to `/signin?error=auth` with a bounded flag,
  never a provider diagnostic or token.
- **`app/signin/page.tsx`** — minimal client form posting same-origin with
  `credentials: "same-origin"`; explicitly states there is no self-service
  sign-up; bounded error messages only.
- **`POST /api/auth/signout`** (B16.0, unchanged) — clears the session
  cookies; same-origin only. Sign-out retires the authenticated principal:
  every subsequent sensitive request 401s, and a sealed proposal authored
  before sign-out permanently fails apply-time reauthorization
  (`membership-unavailable`) — proven in the §F denial matrix.
- **Session refresh** — the official proxy path (`updateSession` in
  `supabase-server.ts`, `getClaims()`-verified) is unchanged from B16.0.

## Boundaries

- **No signup**: no signup/register/create-account route exists anywhere under
  `/api/auth` — pinned by test against the filesystem.
- **No service-role key in browser code**: only the publishable/anon key is
  referenced; the §I import gate keeps `supabase-server.ts` (and the rest of
  the server auth core) unreachable from browser modules.
- **Policy rows**: signin/signout are `public` + `requiresCsrf` (sign-in can
  never require prior authentication; the credential verification IS the
  authentication); the callback is a public GET navigation. The shared
  adapter enforces CSRF even on these public rows.
- **Expired/replaced identity**: pending proposal UI state cannot survive an
  identity change — apply-time reauthorization refuses (`principal-changed` /
  `membership-unavailable`) and the review UI surfaces the precise refusal,
  requiring a fresh proposal.
- **No real emails/users in tests**: everything above is proven against the
  unconfigured branch + injected identity seams; live credential verification
  remains UNKNOWN (R9) — see unknowns-and-owner-decisions.md.

## Proof

`app/api/auth/__tests__/b16-0-1-signin.test.ts` (7 tests: CSRF-before-body,
media/JSON/bounds, 503 fail-closed, no-signup pin, policy row + adapter
enforcement, callback same-origin redirects, safeRedirectPath matrix).
