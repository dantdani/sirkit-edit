# B16.0.24.1 §3 — Supabase SSR boundary proof (fake clients, zero network)

Seams: `vi.mock("@supabase/ssr")` (a scripted `createServerClient` recording
url/key and capturing the route's cookie adapter; scripted
`exchangeCodeForSession` / `signInWithPassword` / `signOut`) +
`vi.mock("next/headers")` (a fake cookie store recording `set` calls). The
fake SDK implementations write session cookies THROUGH the captured adapter —
proving the route's `setAll → cookieStore.set` wiring end to end. Zero network.

## Callback (`GET /api/auth/callback`)

- Successful exchange: `exchangeCodeForSession` called EXACTLY once with the
  one-time code; the client was constructed with the exact configured
  url/key; the session cookie write flowed through the SSR adapter into the
  cookie store; 303 to the validated `next` path on the verified origin; the
  redirect URL contains no code, token, cookie value, or sentinel. **CONFIRMED**.
- Failed exchange: 303 `/signin?error=auth`; the provider's error message
  (sentinel-loaded) does NOT appear in the redirect; zero cookie writes.
  **CONFIRMED**.
- SDK exception: still the bounded `/signin?error=auth`. **CONFIRMED**.

## Sign-in (`POST /api/auth/signin`)

- Valid credentials: `signInWithPassword` EXACTLY once with
  `{ email: <trimmed>, password }`; cookies written via the adapter; the
  response body is EXACTLY `{ ok: true }` — no token/session/user object.
  **CONFIRMED**.
- Invalid credentials: wrong-password and unknown-account SDK errors produce
  BYTE-IDENTICAL 401 `AUTH_SIGNIN_FAILED` envelopes — no account enumeration.
  **CONFIRMED**.
- Zero SDK calls on every pre-credential refusal: CSRF, media type, malformed
  body, credential validation, and production-unconfigured — `createServerClient`
  never constructed, `signInWithPassword` never called. **CONFIRMED**.

## Sign-out (`POST /api/auth/signout`)

- Configured production: `signOut` EXACTLY once; the session-cookie
  retirement write flowed through the SSR adapter; 200
  `{ ok: true, signedOut: true }`. **CONFIRMED**.
- SDK failure: 500 `{ ok:false, code:"AUTH_SIGNOUT_FAILED", error:"Sign-out
  could not be completed." }` — the SDK's sentinel-loaded message never leaks.
  **CONFIRMED**.
- Zero SDK calls on CSRF / unconfigured / local_dev paths. **CONFIRMED**.

## Scope of the claim

These prove the SDK BOUNDARY CONTRACT (call counts, arguments, cookie-adapter
wiring, envelope discipline). LIVE Supabase behavior against a real project
remains UNKNOWN — unchanged, and now stated precisely in the superseded
B16.0.24 notes.
