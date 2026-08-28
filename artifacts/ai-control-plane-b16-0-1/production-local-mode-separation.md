# B16.0.1 §G — production/local mode separation (R7 closure)

## The rules (app/lib/auth/mode.ts)

1. `NODE_ENV=production` ⇒ `resolveAuthMode` returns `"production"` FIRST —
   before any other input is consulted. `SIRKIT_AUTH_MODE=local_dev` can never
   override a production runtime.
2. A missing deployment host never implies loopback: the
   `SIRKIT_DEPLOY_HOST` / `SIRKIT_ALLOW_LOCAL_DEV_HOST` escape hatch was
   REMOVED. Host headers are request data, not trusted configuration, and are
   consulted by nothing in mode resolution.
3. `localDevAllowed` requires BOTH a non-production runtime AND a resolved
   `local_dev` mode — the fixed local principal is constructible only there.
4. Explicit `SIRKIT_AUTH_MODE=local_dev` is the preferred way to enable local
   identity in a non-production runtime; ambiguous environments do not
   silently become local admin.
5. Production without verified Supabase configuration fails CLOSED at the
   trusted-context resolver (`sensitiveOperationsBlocker`) — sensitive routes
   refuse rather than degrade.
6. The visible local-development warning is preserved.

## Negative matrix (test-pinned)

`b16-0-trusted-request-context.test.ts` (item 18 tightened in this stage) and
the B16.0 mode suite cover the combinations: production+SIRKIT_AUTH_MODE=
local_dev → production; production+missing host vars → production; loopback
host in production → production; non-production default → local_dev;
non-production explicit production → production (used by the CSRF tests to
exercise the production path with injected identities).

## Interactions

- CSRF (§C) is production-gated inside the resolver — this is the SAME mode
  authority, so a production runtime can never skip CSRF by mode confusion.
- The §H sign-in boundary is unavailable (503) when Supabase is not
  configured; local_dev has nothing to sign into and production without
  configuration is already fail-closed.
