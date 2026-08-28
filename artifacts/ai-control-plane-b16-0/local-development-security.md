# B16.0 — local-development security

## Explicit, non-production, fail-safe

`resolveAuthMode(env)` (a pure function over an injectable environment):

- `SIRKIT_AUTH_MODE=production` ⇒ production (always).
- `NODE_ENV=production` ⇒ production, and can drop to local_dev ONLY with the
  explicit `SIRKIT_AUTH_MODE=local_dev` opt-in AND a loopback/local host
  (`localDevAllowed`) — a production deployment can never silently fall into
  local_dev.
- `SIRKIT_AUTH_MODE=local_dev` (non-production) ⇒ local_dev.
- Nothing set, non-production (dev/test) ⇒ local_dev (frictionless, and
  truthful — it is not a production deployment).

In local_dev the server derives ONE fixed local principal
(`local-dev-principal`, `project_admin`, `human`); actor/role headers are
ignored for identity; only the project/branch SELECTOR is honored.

## Fail-closed production

`sensitiveOperationsBlocker(env)` returns a blocker when the runtime is
production but `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
are absent — `resolveTrustedRequestContext` then refuses every sensitive
request (403). Production without configured authentication cannot authorize
sensitive operations.

## Visible banner

`app/components/auth/LocalDevIdentityBanner.tsx` renders
`LOCAL DEVELOPMENT IDENTITY — NOT PRODUCTION AUTHENTICATION` whenever the
public `NEXT_PUBLIC_SIRKIT_AUTH_MODE` is not `production` (default: visible).
Mounted in `app/layout.tsx` above all content; renders nothing in production.
Diagnostics identify local-dev authentication truthfully (`authMethod:
"local_dev"`, `authStrength: "local_dev"`).

## No backdoor

- No test-only bypass is compiled into the production path: the injectable
  identity/membership seams default to the production/local_dev providers and
  are altered only when a test explicitly calls `set…Factory`.
- No publicly reachable bootstrap/login bypass exists; `/api/auth/signout`
  clears a session (same-origin only) and never issues one.
- Local-dev identity is never labelled production authentication in any
  response or banner.
