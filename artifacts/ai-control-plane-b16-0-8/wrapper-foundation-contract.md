# B16.0.8 §B — Wrapper foundation contract

All wrappers live in the ONE canonical module
[`app/lib/auth/route-handlers.ts`](../../app/lib/auth/route-handlers.ts) and are
recognized ONLY by exact module + exported-symbol provenance.

## The wrapper set

| Wrapper | Protocol | Callback input |
|---|---|---|
| `authenticatedRoute` | session auth, no body | `{ context, meta, params?, signal? }` |
| `authenticatedJsonRoute` | session auth + bounded JSON | `{ context, body, bytes, meta, params?, signal? }` |
| `publicRoute` **(new)** | public policy, no body (GET/HEAD) | `{ meta, params?, signal? }` |
| `publicJsonRoute` | public policy + bounded JSON | `{ body, bytes, meta, params?, signal? }` |
| `workerRoute` **(new)** | worker secret, NO body (dispatch surfaces) | `{ principal, meta, signal? }` |
| `workerJsonRoute` | worker secret + bounded JSON | `{ principal, body, bytes, meta, signal? }` |
| `kicadLibraryRoute` **(new, narrow)** | historical KiCad `Token` boundary | `{ meta, params? }` |

Runtime ordering in every wrapper: policy resolution (authorizeRequest) →
identity/principal → role/membership/CSRF → media type (415 before any pull) →
bounded/deadline body read → parse/validate → callback. `kicadLibraryRoute` is
the one documented exception: it runs ONLY the historical token boundary (see
its TRUTHFUL SCOPE NOTE — the external KiCad protocol tolerates URL shapes the
exact-path policy lookup refuses, proven by the Stage 5 tests; forcing the
adapter in would break the pinned protocol).

## Declared configuration (no escape hatch)

Body wrappers declare `maxBytes` (explicit), `deadlineMs`, JSON media
requirement (default on; explicit opt-out only), `requireObject`,
`forbiddenBodyKeys`. All wrappers may declare (SafeMetadataOptions):

- `query: true` — a bounded (≤64 keys, ≤2048 chars/value, first-value-wins),
  frozen query projection in `meta.query`;
- `safeHeaders: [...]` — an exact allowlist projected into `meta.headers`;
  `Cookie`, `Set-Cookie`, `Authorization`, `Proxy-Authorization`, and any name
  matching /secret|token|cookie|auth|credential|session|password|key/i can
  NEVER be allowlisted — the wrapper THROWS at construction; undeclared headers
  are structurally unavailable to callbacks;
- `routeParams: [...]` — the declared dynamic params resolved from the Next
  context into a bounded (≤512 chars), frozen plain record; a missing/invalid
  declared param refuses 400 `AUTH_ROUTE_PARAM_INVALID`; the raw Next context
  object never reaches a callback;
- `exposeAbortSignal: true` — the request `AbortSignal` (exposes no
  headers/body/identity).

Worker wrappers additionally declare `unauthorized: { code, noStore? }` — a
declared preservation of a route's HISTORICAL 401 refusal contract (code string
+ Cache-Control presence), applied only to the worker-unauthenticated 401;
every other refusal is canonical. This is declared configuration, not a
passthrough: no option exposes the Request, Headers, cookies, or the body
stream, and there is no generic escape-hatch wrapper.

## Back-compat pins preserved

The B16.0.5 §D integrity test still passes unchanged: without opt-ins,
`authenticatedJsonRoute`'s callback input keys are exactly
`["body","bytes","context","meta"]` and `meta` is `{method, pathname}` — every
new projection is opt-in, so existing wrapped behavior is byte-identical.
