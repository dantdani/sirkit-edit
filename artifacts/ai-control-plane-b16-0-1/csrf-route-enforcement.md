# B16.0.1 §C — automatic same-origin CSRF at real route boundaries

## Enforcement points (a caller can no longer forget it)

1. **Policy-driven (the main path).** Every authenticated non-GET/HEAD row in
   the exact policy table carries `requiresCsrf: true`; `authorizeRequest`
   passes `enforceSameOrigin: policy.requiresCsrf` into
   `resolveTrustedRequestContext`, which runs `requireSameOrigin` — the
   Origin host must equal the forwarded/Host header (or the request URL host).
   The §I invariant gate pins that NO authenticated human non-GET row can lack
   the flag.
2. **Public rows with CSRF** (the §H auth boundary): `authorizeRequest`
   enforces `requiresCsrf` directly for public-class rows too, and the
   signin/signout routes ALSO call `requireSameOrigin` in-route before the
   body is read (defense in depth — they do not depend on the adapter).
3. **Body-scope routes** (chat, apply-authorization): these resolve the
   trusted context with an explicit body selector and pass
   `enforceSameOrigin: true` directly.
4. **Workers**: the constant-time secret is the boundary; policy rows carry
   `requiresCsrf: false` (no cookie authentication exists to forge).

## Mode gating (documented, deliberate)

`requireSameOrigin` inside the trusted resolver runs only when
`resolveAuthMode(environment) === "production"` — local_dev and the test
environment carry no browser Origin and have no cookie session to forge.
Production behavior is proven by injecting the production environment
(`SIRKIT_AUTH_MODE=production` + Supabase config) with the identity seams
still injected, so the refusal is demonstrated for a FULLY AUTHENTICATED,
role-authorized member:

- cross-origin POST → 403 `AUTH_CROSS_ORIGIN_DENIED`
- origin-less POST → 403 `AUTH_ORIGIN_MISSING`
- GET/HEAD never demand an Origin header
- same-origin equivalent authorizes

## Proof

- `app/lib/auth/__tests__/b16-0-1-route-authorization.test.ts` — release +
  pcb-sync surfaces.
- `app/api/chat/__tests__/b16-0-1-chat-authorization.test.ts` — cross-origin
  and origin-less chat POST → 403 with NO run id and no NDJSON stream (i.e.
  refused BEFORE any provider call).
- `app/api/auth/__tests__/b16-0-1-signin.test.ts` — the sign-in boundary
  refuses cross-origin before reading the body; the shared adapter enforces
  the public+CSRF row.
- `app/api/assignment-queue/__tests__/_scope.test.ts` — the migrated scope
  family under the production environment (`AUTH_CROSS_ORIGIN_DENIED` /
  `AUTH_ORIGIN_MISSING` pinned).
- B16.0's `b16-0-local-dev-and-csrf` suite continues to pass unweakened.
