# B16.0.22 — CSRF & zero-body-pull proof

Pin: `[$name] production cross-origin → 403 with ZERO body pulls` — all four
POST methods (assignment-queue, footprint-resolution, physical-bindings,
replacement-authority), pre AND post migration.

Method: production env stub (`SIRKIT_AUTH_MODE=production`, Supabase URL/key,
`SIRKIT_EXPECTED_ORIGIN=http://localhost`), authorized admin principal, a
counting `ReadableStream` body (`pull` increments a counter), `Origin:
http://evil.example`.

Result: **403 with `pulls === 0`** for every POST — the exact-origin CSRF
check completes inside `authorizeRequest` BEFORE any body byte is pulled.
**CONFIRMED** (pre = post).

GETs carry no CSRF requirement (pinned from the policy rows: `requiresCsrf
false` for all four GETs) and never read a body.

The assignment-queue declared-length refusal likewise pulls ZERO body bytes
(counting-stream pin, 413). **CONFIRMED**.
