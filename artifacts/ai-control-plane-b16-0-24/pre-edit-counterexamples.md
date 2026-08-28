# B16.0.24 §A — pre-edit observed realities and corrections

The §A suite ran GREEN against the RAW handlers first (19/19), then 19/19
after migration. Observations that shaped the migration:

## Reproduced / recorded realities

1. **Chat resolves trusted context AFTER body validation** — its project
   scope is IN the body (client sends zero `x-sirkit-*` headers; the policy
   identitySource `body-scope-server-actor` is byte-pinned in a committed CSV).
   So the migration KEEPS chat's body-before-auth ordering; the new
   `agentStreamRoute` wrapper reads the bounded body, projects the body scope,
   then resolves trusted context — it cannot resolve identity before the body
   because the selector lives in the body. **CONFIRMED**.
2. **`/api/simulate` was behavior-untested** — no test spawned ngspice, mocked
   child_process, or asserted any envelope. This gave freedom to harden and
   MANDATED writing the first behavior test (fake spawn). **CONFIRMED**.
3. **Sign-out's raw second handler argument** (`POST(request, { environment })`)
   was the exact anti-pattern the mandate names — replaced by the declarative
   `exposeEnvironment` wrapper option; the one consuming test migrated to
   `vi.stubEnv`. **CONFIRMED**.
4. **No Supabase success path is covered** — every tested auth path returns
   before the SSR client (CSRF / validation / unconfigured / local_dev /
   redirect). The credential-verification branches stay UNKNOWN by design; the
   migration preserves that (no new coverage claimed for them). **CONFIRMED**.

## Corrections (documented supersessions)

5. **§B callback redirect origin** — the raw callback built the redirect from
   `new URL(request.url).origin`, which in production is derived from the
   `Host` header. Corrected to the SERVER-OWNED `resolveExpectedOrigin`
   (`meta.origin` via `requestOrigin: true`): production-configured
   deployments now redirect only to the validated `SIRKIT_EXPECTED_ORIGIN`, so
   no `Host`/`X-Forwarded-Host` value can determine the redirect origin. In
   local_dev (where the tests run) `resolveExpectedOrigin` returns the request
   URL origin — identical to the old behavior — so the §A pins are unchanged.
   **CONFIRMED**.
6. **§G simulate execution hardening** — the raw runner used the SHARED
   `tmpdir()` as cwd, inherited the FULL server environment, accumulated
   unbounded stdout/stderr, parsed unbounded points/tokens, logged the full
   netlist/raw output to server logs, and echoed the netlist in error bodies.
   Corrected to a per-request `mkdtemp` isolated directory, a minimal env
   allowlist (`safeEnvironment`), `shell:false` (explicit), bounded
   output/parse, injection guards (input control-char screen + output
   include/lib/shell screen), removal of design-data logging, and deterministic
   cleanup in every path. The success envelope
   (`{ok,analysis,analysisType,variables,points,netlist,nodeMap,pinNodes}`) is
   preserved for the client. **CONFIRMED**.

## No fail-open found in the auth/chat boundaries

The auth routes, chat authorization, and the chat streaming settlement were
already sound; this stage relocated their boundaries into canonical wrappers
without weakening them (163 standing chat/auth/gate tests pass unchanged).
