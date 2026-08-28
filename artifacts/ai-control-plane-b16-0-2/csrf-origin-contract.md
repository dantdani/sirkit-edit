# CSRF exact-origin contract (§C / R4)

## The one server-owned authority
`app/lib/auth/expected-origin.ts` → `resolveExpectedOrigin(request, env)`:
- **Production** (`resolveAuthMode === "production"`): the expected origin is
  `SIRKIT_EXPECTED_ORIGIN`, a single validated absolute origin. `https` is
  required for a non-loopback host. Missing or malformed configuration **fails
  closed** (`AUTH_ORIGIN_NOT_CONFIGURED` / `AUTH_ORIGIN_CONFIG_MALFORMED`) —
  every protected non-idempotent request is refused until the deployment
  declares its public origin.
- **Local development** (non-production runtime): honours `SIRKIT_EXPECTED_ORIGIN`
  when set, otherwise uses the **request URL's** origin (scheme+host+port).
  Never a forwarding header — truthful because local_dev is not production auth.

`Host`, `X-Forwarded-Host`, `X-Forwarded-Proto`, `X-Forwarded-Port`,
`Forwarded`, `X-Original-Host`, `X-Host` are **never** consulted (gate-pinned;
source-scanned). A deployment proxy declares its origin through configuration,
not headers.

## The comparison
`requireSameOrigin(request, env)` (safe methods GET/HEAD/OPTIONS exempt):
1. resolve the server-owned expected origin (fail closed on config error);
2. strictly parse the `Origin` header — reject missing / `null` / malformed /
   credential-bearing / path-or-query-carrying / non-http(s) / non-canonical;
3. compare the **complete normalized origin** — scheme, hostname, effective
   port (default ports elided identically on both sides).

Runs inside `authorizeRequest` for every authenticated non-GET row and for the
public auth boundary rows (sign-in/sign-out), and directly in
apply-authorization — **before** any body byte, provider call, repository read,
mutation, release, or stream/listener creation.

## The two reproduced bypasses, now refused (pinned tripwires)
1. `https://sirkit.example` + `Origin: http://sirkit.example` (same host, scheme
   downgrade) → `AUTH_CROSS_ORIGIN_DENIED`.
2. Host `sirkit.example`, `Origin: https://evil.example`,
   `X-Forwarded-Host: evil.example` → `AUTH_CROSS_ORIGIN_DENIED`.

Also refused: port mismatch, sibling/superstring/subdomain host, `Origin: null`,
missing Origin, malformed Origin, and every forwarding header for every mode.
