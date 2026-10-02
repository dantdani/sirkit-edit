# B16.0.24 — Unknowns & owner decisions

## Decisions taken

1. **Three narrow declarative wrapper capabilities, all sole-adopter gated**:
   `requestOrigin` (callback), `legacyReaderRefusals: "auth-signin-v1"`
   (sign-in), `exposeEnvironment` (sign-out). Each is a closed/declarative
   addition — routes cannot inject envelope, origin, or env logic. **CONFIRMED**.
2. **A dedicated `agentStreamRoute` wrapper for chat** rather than forcing chat
   onto a header-selector JSON wrapper. Chat's scope is in the body (the client
   sends no headers; the policy `body-scope-server-actor` is byte-pinned in a
   committed CSV), it uses lenient JSON + a custom 413 envelope, it streams
   NDJSON, and it needs the abort signal — none expressible by
   `authenticatedJsonRoute`/`selectorEnvelopeJsonRoute` without polluting them.
   The new wrapper is gated as chat's sole adopter. **CONFIRMED**.
3. **Chat keeps its body-before-auth ordering** (the scope IS the auth
   selector); the wrapper reads the bounded body, projects the scope, then
   resolves the trusted context. The rich validation stays in the callback and
   runs after authorization. No test pins the exact 400-vs-403 precedence for
   an unauthorized+bad-body request, so nothing regresses. **CONFIRMED**.
4. **Sign-out env injection migrated from the raw 2nd Next arg to `vi.stubEnv`
   + `exposeEnvironment`** — the one consuming test (`b16-0-2-mode-diagnostics`)
   was updated. **CONFIRMED**.
5. **Simulate hardened in place, not blocked** — the isolated-dir /
   env-allowlist / bounded-output / injection-guard hardening is not an
   architectural expansion, so authoritative execution stays available (the
   §H fail-closed fallback was not needed). **CONFIRMED**. [superseded 2026-10-02 by the B22 closeout (D22-14, OD-144): authoritative execution was never available: the legacy path is a diagnostic local process (OD-136), and production simulation authority stays BLOCKED (OD-134, LB-10)]
6. **`b13-2 23b` mid-flight-abort** is a wall-clock timing sensitivity (fixed
   25 ms window) under parallel load, not a functional regression: it passes in
   isolation (3/3) and on the second full run; the route's abort handling is
   unchanged (settles < 2 s, source cancelled). **CONFIRMED**.

## Unknowns carried forward

- **R9 live-Supabase production auth remains UNKNOWN** — no test mocks
  @supabase/ssr or `next/headers`, so the sign-in-success, sign-out-success,
  and callback exchange-success branches stay UNKNOWN by design (every tested
  path returns before the SSR client). The migration preserves that exactly.
- **The three factory routes** (mapping-verification / passive-policy /
  pcb-sync POST) remain DI factories by design and are the entire baseline.

## Scope adherence

No Supabase calls, provider credits, real processes, live simulators, network,
or DB writes in tests. Protected original `C:\Users\robsa\sirkit` untouched.
B16.1, MCP, multi-agent orchestration, provider expansion, signup, external
model downloads, and simulator-platform expansion NOT started.

---

## [SUPERSEDED IN PART — B16.0.24.1 §3]

"R9 live-Supabase production auth remains UNKNOWN — no test mocks
@supabase/ssr or `next/headers`" is superseded for the SDK-BOUNDARY portion:
fake SSR clients now prove the exchange/sign-in/sign-out success branches and
their cookie-adapter writes. LIVE-Supabase production behavior (real network,
real project) remains UNKNOWN — only the boundary contract is proven.
