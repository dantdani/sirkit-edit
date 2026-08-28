# B16.0.24 §C — sign-in credential boundary

`POST /api/auth/signin` → `publicJsonRoute({ maxBytes: 16_000,
deadlineMs: 10_000, legacyReaderRefusals: "auth-signin-v1" })`.

- **CSRF before body**: the public row's `requiresCsrf` runs inside the
  wrapper's `authorizeRequest`; cross-origin → 403, origin-less → 403 (pinned),
  before any body pull. **CONFIRMED**.
- **Exact 16,000-byte ceiling / 10-second deadline**: passed to the reader;
  the standing `b16-0-2-bounded-json` 408 (fake timers) and 413 (firehose,
  `pulled ≤ 65536·2`) pins pass unchanged. **CONFIRMED**.
- **Exact historical refusal codes** via the closed `auth-signin-v1` profile
  (frozen in-module table, routes cannot inject envelopes): over-limit → 413
  `AUTH_SIGNIN_PAYLOAD_TOO_LARGE`; invalid JSON/UTF-8 → 400
  `AUTH_SIGNIN_INVALID_JSON`; timeout → 408
  `AUTH_SIGNIN_BODY_DEADLINE_EXCEEDED`; aborted → 400 `AUTH_SIGNIN_BODY_ABORTED`;
  unreadable → 400 `AUTH_SIGNIN_BODY_UNREADABLE`; non-object → 400
  `AUTH_SIGNIN_OBJECT_REQUIRED`; media → 415 `AUTH_MEDIA_TYPE_UNSUPPORTED`
  (canonical). Sign-in is the SOLE adopter (repo-wide gate). **CONFIRMED**.
- **Object-only + email/password length limits**: 320-char email, 1024-char
  password; missing/oversize → 400 `AUTH_SIGNIN_CREDENTIALS_REQUIRED`. Pinned.
  **CONFIRMED**.
- **Uniform authentication failure**: `signInWithPassword` error → 401
  `AUTH_SIGNIN_FAILED` with no account-existence signal (design; the Supabase
  branch is not test-reachable). **CONFIRMED / INFERRED**.
- **Server-side cookies; zero token/session/user in the body**: success →
  `{ ok: true }` no-store; the SSR client writes cookies. §A asserts the
  unconfigured 503 body matches no `token|session|access|secret`. **CONFIRMED**.
- **Zero Supabase calls on any refusal**; **exactly one credential call on a
  valid attempt** (the single `signInWithPassword`). **CONFIRMED / INFERRED**.
- **Production-unconfigured → 503 `AUTH_SIGNIN_UNAVAILABLE`**. Pinned.
  **CONFIRMED**.
- **No signup path**: §A asserts `signup`/`sign-up`/`register`/`create-account`
  directories do not exist under `app/api/auth`. **CONFIRMED**.
- **No credential retention**: credentials live only in the callback's local
  scope; they are never logged, echoed, placed in a URL, or written to any
  trace/diagnostic/artifact. **CONFIRMED**.

---

## [SUPERSEDED IN PART — B16.0.24.1 §3]

The two INFERRED rows above ("uniform authentication failure … not
test-reachable" and "exactly one credential call … CONFIRMED / INFERRED") are
now **CONFIRMED** by fake @supabase/ssr clients (zero network): valid
credentials call `signInWithPassword` exactly once (email trimmed), session
cookies are written through the SSR cookie adapter, the success body is
EXACTLY `{ ok: true }`, and wrong-password vs unknown-account produce
byte-identical 401 envelopes (no enumeration). See
`artifacts/ai-control-plane-b16-0-24-1/supabase-ssr-fake-client-proof.md`.
