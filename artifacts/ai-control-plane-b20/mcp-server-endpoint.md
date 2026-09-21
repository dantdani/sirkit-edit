# B20-B2 — the Sirkit MCP endpoint, its principal, its route policy and the census move

Labels: **CONFIRMED** (executed and measured), **INFERRED** (code reading), **PROPOSED** (designed, not exercised),
**RECORDED** (written down without a claim), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**.

B2 serves Sirkit's own MCP surface over Streamable HTTP, revision **2026-07-28**, and nothing more: `server/discover`,
`tools/list` (the member's role subset of B1's exposure) and `tools/call` (a closed refusal for every tool until B3 serves
reads and B4 inert proposals). MCP stays an adapter around the canonical registry: the principal is re-checked against the
LIVE membership on every call, the tool listing is B1's rendering filtered by role, and nothing reachable over MCP can
publish, approve, bind, withdraw, rebind, purchase, qualify, release, run a process, replace state or write a database or
file (CONFIRMED by `b20-b2-import-gates` and `b20-b2-mcp-endpoint` E7). Closes D20-4, D20-5 and D20-35; closes D20-3 in part
(the external authorization server is BLOCKED-LIVE, section 9).

## 1. The routes and the census move — CONFIRMED

| method | path | wrapper | policy row |
|---|---|---|---|
| POST | `/api/mcp` | `mcpBearerJsonRoute` (new canonical wrapper, sole adopter) | `authenticated-mcp`, identity source `mcp-bearer`, every member, no CSRF |
| POST | `/api/mcp/token` | `authenticatedJsonRoute` | `authenticated-read`, `trusted-context`, every member, same-origin CSRF |
| GET | `/.well-known/oauth-protected-resource/api/mcp` | `publicRoute` | `public`, `none`, no CSRF |

The census moves from **162 / 159 / 3 / 0** to **165 / 162 / 3 / 0** (route methods / canonical wrappers / approved factories
/ raw). The three new methods are canonical wrappers; the factories are unchanged and raw stays 0; `_raw-route-baseline.json`
is byte-identical. Every route inventory now walks `app/api` AND `app/.well-known` through the one helper
`app/lib/auth/route-tree.ts` (D-12, OD-66); `app/.well-known` holds exactly one reviewed file. Below each root the helper
skips only `__tests__` and `node_modules`: dot and route-group directories are walked, because Next's route discovery
ignores only `_`-prefixed parts and so serves a route file under, say, `app/api/.internal/` (review fix; the design's D-12
had also skipped dot-entries, which would have hidden such a route from the census and every inventory).

Regenerated in the same change (each exactly +3 rows, the toolability matrix +1 record, no other row moved):
`exact-route-authorization-policy.csv`, `route-data-and-resource-classification.csv`, `auth-route-coverage.csv`,
`api-route-coverage.csv`, `ui-command-toolability-matrix.csv`, `method-authorization-matrix.csv`,
`request-body-boundary-matrix.csv`, `route-wrapper-matrix.csv`. Unchanged: `ui-control-fingerprint.json`,
`_raw-route-baseline.json`. The three route matrices are now byte-pinned to pure renderers the generators export (D20-35);
the generators write only when run as a script.

## 2. The principal (D-1, OD-65) — CONFIRMED

`McpBearerContext` (`app/lib/auth/mcp-bearer.ts`) is its own closed type with `authMethod: "mcp_bearer"`; `AuthMethod`,
`VerifiedRunPrincipal`, `AgentActor` and `AgentTraceIdentity` are unchanged, so the principal can never reach a
`TrustedRequestContext` consumer. Its engineering actor is `{ actorKind: "ai", role: <mapped LIVE role>,
delegatedByActorId: <member>, delegatedCapabilities: ["read_project"], delegationExpiresAt: <token expiry> }`: every
human-only path (qualification, release, apply, grant consumption) refuses it by kind. The token id is kept only as
`tokenIdDigest` (the first 32 hex characters of sha256 over it).

## 3. The token (D-2, D-3, D-4, OD-43) — CONFIRMED

JWS compact HS256. The header segment is exactly the base64url of `{"alg":"HS256","typ":"sirkit-mcp-at+jwt"}` and is compared
as bytes, never parsed. The payload holds exactly eleven claims: `iss` (the configured origin), `aud` (`<origin>/api/mcp`),
`sub` (the member's user id), `iat`, `exp` (`iat` + 3 600 s), `jti` (16 random bytes, base64url), `scope` (`sirkit.mcp`),
`sirkit_tenant`, `sirkit_project`, `sirkit_branch` (a selector, never authorized: D20-32) and `sirkit_mbr` (the membership
revision at mint). Verification judges each bound before the work it protects, in this order: the clock, the configuration,
the length, the three segments, the header bytes, the signature (constant time), then the payload (bounded, canonical
base64url, fatal UTF-8, a plain object with exactly the eleven keys, prototype keys refused), then `iss`, `aud`, the patterns,
the lifetime, the not-before skew and the expiry.

The configuration is read at call time by NAME: `SIRKIT_MCP_TOKEN_SECRET` (32 to 1 024 bytes, no surrounding whitespace,
never equal to the trimmed worker secret or the KiCad library token) and `SIRKIT_EXPECTED_ORIGIN` (https, or http on a
loopback host only, in production; no fallback to the request URL). The secret never enters a returned object, a response,
a header or a trace. The verifier is a seam (`setMcpAccessTokenVerifierFactory`); whatever verifier ran, the wrapper
re-checks every claim it relies on (issuer, audience, scope, ids, lifetime, expiry) and pins the membership revision.

**Recorded relaxation of B16.1B section E** ("token validity is not session liveness"): the session is confirmed live at
mint (the token route resolves the cookie identity through the provider's liveness check), but a sign-out, a remote session
revocation, or a Supabase ban or deletion does NOT end an issued MCP token before its expiry unless the membership changes.
Nothing is stored; no bearer-side liveness check exists (discovery section 8, question 1). Pinned by
`b20-b2-mcp-token-route` case 11.

## 4. The policy and the wrapper (D-5, D-6, OD-44) — CONFIRMED

`authorizeRequest`, `selectorEnvelopeJsonRoute` and `agentStreamRoute` refuse an `mcp-bearer` row with 500
`AUTH_POLICY_WRAPPER_MISMATCH` before any identity, CSRF or body work, so an ambient cookie can never authenticate the
bearer-only endpoint; `mcpBearerJsonRoute` refuses every other row the same way. The policy-blind `kicadLibraryRoute` is
closed by a static tie in both directions (`b20-b2-mcp-route-policy` case 12). The CSRF exemption outside the worker rows is
exactly POST `/api/mcp` (`b16-0-1-ci-gates`).

`mcpBearerJsonRoute` runs, in order: the flag (404, zero other work); the options (500); the exact policy (500); the
production blocker (403); the configuration and the verifier (503); Origin (absence accepted; a present value, blank
included, parsed strictly and equal to the configured origin in every mode, else 403); no query string (400
`invalid_request`); the Authorization header (absent or another scheme: 401 with no error code; over its bound or not
`Bearer 1*SP b64token`: 400 `invalid_request`); the verifier and the claim re-check (401 `invalid_token`); the rate limit
(429); the LIVE membership (a missing, revoked or changed membership is the same 401 `invalid_token`: no oracle); the role
gate; media; the bounded body (a body that is not JSON is `-32700`); the handler, which receives exactly
`{ principal, message, bytes, mcp, meta, signal }`.

Challenges carry server-owned constants only: `Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource/api/mcp",
scope="sirkit.mcp"`, plus `error="invalid_request"` on the 400s of the query and Authorization steps, or
`error="invalid_token", error_description="The access token is invalid or expired."` on an invalid token. Every 401 carries
one; no other status does.

**Proxy note (F14b)** RECORDED: the site proxy (`proxy.ts`) still runs the Supabase session refresh on `/api/mcp` and the
metadata path, as on every non-asset path; it may read and rotate a browser's session cookies, but it confers no identity on
these routes (the wrapper and the handler never read a cookie). Excluding them from the proxy matcher is an owner
alternative (OD-44).

## 5. The JSON-RPC dispatch (D-7, OD-57) — CONFIRMED

The validator's order is pinned (`b20-b2-server-protocol` case 3): the shape (`-32600`, the id echoed only when valid); the
`MCP-Protocol-Version` header (absent or over its bound: `-32020` naming the supported versions; present but not
2026-07-28: `-32022` with the schema's two required fields, `data.supported` and `data.requested`, the latter the header
value when it is date-shaped and the empty string otherwise, so nothing else a peer wrote is echoed); `Mcp-Method` present
and equal (`-32020`); no `Mcp-Param-*` (`-32020`: no exposed
tool declares `x-mcp-header`); a notification is 202 with no body; a method other than the three is 404 `-32601` (before
`_meta` and `Mcp-Name`, so `initialize`, `ping`, `subscriptions/listen`, `resources/read` and `prompts/get` all answer it);
`_meta` with both required per-request fields (`-32602`, HTTP 400), its version equal to the header (`-32020`); `Mcp-Name`
decoded and equal to a string `params.name` on `tools/call`, absent otherwise (`-32020`).

| JSON-RPC error | HTTP status |
|---|---|
| `-32700`, `-32600`, `-32022`, `-32020`, `-32602` for missing or invalid `_meta` | 400 |
| `-32601` | 404 |
| `-32602` for an unknown tool, a cursor or non-object arguments (one identical body, nothing echoed) | 200 |
| `-32603` | 500 |

Every JSON-RPC error carries the request's id when it can be read (a valid string or safe-integer id), including the
`-32603` of a throw inside the dispatch or the handler, and leaves `id` out otherwise (a parse error, an invalid id, a
refused notification): the 2026-07-28 schema's `JSONRPCErrorResponse.id` is an optional `RequestId` (a string or a number),
never null.

`tools/list` is B1's `renderMcpToolListing` filtered to the tools whose `requiredRoles` include the caller's mapped project
role (never re-derived; never `discoverTools`): `ttlMs` 60 000, `cacheScope` `private`, `dev.sirkit/registryDigest` and
`dev.sirkit/listingDigest` (the B1 digest formula over the served subset) in `_meta`, no `nextCursor`. Required authority,
project state, revision and capability are call-time conditions (B3/B4). A listed tool on `tools/call` answers 200
`{ resultType: "complete", isError: true, _meta["dev.sirkit/refusal"]: "not_served" }`. Every response is `no-store`
JSON except the 202, which has no body and so no media type. `Mcp-Session-Id` is never set, and one received is ignored.

## 6. Token issuance (D-8) — CONFIRMED

POST `/api/mcp/token` runs the canonical wrapper first (policy, blocker, CSRF in production, cookie identity with session
liveness, ACTIVE membership, media, a 256-byte / 5 s body), then: the flag (404), the configuration (503), a human
`supabase_cookie` or `local_dev` principal (403), a body of exactly `{}` (400), the mint limit (429), the mint (503 on
failure). 200 answers `{ ok, access_token, token_type: "Bearer", expires_in: 3600, scope: "sirkit.mcp", resource, project }`
with `Cache-Control: no-store` and `Pragma: no-cache`. The token appears only in that body. Recorded limit: in local_dev,
CSRF is not enforced and the local-development provider authenticates every request.

## 7. Limits (D-9) — CONFIRMED

Per-process fixed windows (stated like OD-53): the token route 10 per 60 s per (tenant, project, principal); the endpoint
120 per 60 s per (tenant, project, token subject). Keys are built from verified ids only; at most 10 000 keys, expired
windows swept first, a new key refused when still full (fail closed); a refusal consumes nothing; `Retry-After` is whole
seconds in [1, 60]; an invalid clock, key or constant refuses.

## 8. The request trace (D-10) — CONFIRMED

`sirkit.mcp-server-request.v1`: one closed record per request the dispatch handled (request id, received time, elapsed time,
method as a closed value, served tool id or null, closed outcome, HTTP status, protocol version, the principal's ids, mapped
role, membership revision, `mcp_bearer` and token-id digest, the registry and listing digests). No token, token id or raw
header. A record outside the schema is dropped; a failing sink never changes the response; the default sink is a
per-process ring of 1 000. Recorded limit: the wrapper's refusals, before the dispatch, are not traced. Whether B3 widens
`AgentTraceIdentity.provider` stays B3's decision.

## 9. The protected-resource metadata (D-11, OD-43, OD-66) — CONFIRMED, with a recorded deviation

GET `/.well-known/oauth-protected-resource/api/mcp` answers exactly `{ resource: "<origin>/api/mcp", scopes_supported:
["sirkit.mcp"], bearer_methods_supported: ["header"], resource_name: "Sirkit" }` (flag off 404, not configured 503,
`no-store`). The URL is the RFC 9728 section 3.1 path insertion for the resource, and `resource` equals the token audience
(section 3.3).

**Deviation, CONFIRMED against the specification (section 11):** the document names no `authorization_servers`, because no
OAuth authorization server exists in B20. The MCP 2026-07-28 authorization specification states that the Protected Resource
Metadata document an MCP server returns MUST include `authorization_servers` with at least one authorization server. A
client that discovers OAuth through this document cannot obtain a token; only pre-issued Sirkit tokens work, so runbook
`:740` is met only in part and D20-3 closes as partial / BLOCKED-LIVE (LB-1). This is the default of OD-43 and the lead's
stop-and-report item.

## 10. Route tree and standing statements (D-12, D-13) — CONFIRMED

The fifteen route walkers and the two route-handler prefix filters use `route-tree.ts`; a tripwire forbids any other file
under app/ or scripts/ from carrying a route-file matcher in any common spelling (a quoted `route.ts` compared with
`==`/`===`/`!=`/`!==`, passed to `.endsWith(`, used as a `case` label or bound to a named constant, and the name spelled as a
regular expression anywhere but the first argument of `.replace(`). The tripwire is lexical, so it is backed by a census:
every route handler Next would serve from app/ (any `route.<source extension>` outside a `_`-prefixed folder, dot and
group directories included) must be a `route.ts` the helper lists (`b20-b2-route-tree` C8). `tsconfig.json` includes
`app/.well-known/**/*.ts`. The three
"no MCP surface" test titles (`b10-editor-context`, `b11-1-trace-integrity`, `b11-trace-replay-evaluation`) were retitled with
their assertions unchanged: B2 made them false (an MCP endpoint now exists), and their other clauses were never asserted.

## 11. The re-read of 2026-09-20 (section 0.4 of the task) — CONFIRMED (fetched live)

Sources: modelcontextprotocol.io/specification/2026-07-28/{basic/transports/streamable-http, basic/versioning, basic/index,
server/tools, server/utilities/pagination, basic/authorization, basic/authorization/authorization-server-discovery};
rfc-editor.org RFC 9728, RFC 6750, RFC 7235; platform.claude.com/docs/en/agents-and-tools/mcp-connector;
developers.openai.com/api/docs/guides/tools-connectors-mcp.

1. Streamable HTTP status rules. Missing required `_meta` fields: `-32602`, "On HTTP, the response status MUST be 400"
   (basic/index). Unknown tool (tools, Error Handling), invalid cursor (pagination: "SHOULD result in an error with code
   -32602") and a `CallToolRequest`-schema failure are protocol errors with no HTTP status stated, so they stay 200 (U3).
   A request without the `MCP-Protocol-Version` header, on a server that does not support pre-2025-06-18 clients, is
   rejected "per Server Validation", which lists a missing required standard header under 400 `-32020` HeaderMismatch; an
   unsupported version is 400 `-32022`. The versioning page's compatibility matrix: a legacy client against a modern server
   on HTTP "is missing the required headers and is rejected per server validation with 400 Bad Request", and a modern-only
   server SHOULD name its supported versions in any error to `initialize`. **This differs from the design's default** (400
   `-32022` for a missing header, U8): the endpoint follows the specification — absent or over-bound header `-32020` with
   `data.supported`, unsupported value `-32022` with `data.supported` and `data.requested` (item 6) — and E6/E7 pin it.
2. Authorization: "The Protected Resource Metadata document returned by the MCP server MUST include the
   `authorization_servers` field containing at least one authorization server" (authorization-server-discovery). The MUST
   is CONFIRMED; the D-11 default stands (section 9) until the lead decides.
3. RFC 9728: `resource` REQUIRED, `authorization_servers` OPTIONAL in RFC 9728 itself, `scopes_supported` RECOMMENDED,
   `bearer_methods_supported` OPTIONAL, `resource_name` defined; section 3.1 path insertion; section 3.3 `resource` identical
   to the identifier used to build the URL; section 5.1 `resource_metadata` in `WWW-Authenticate`. As designed.
4. RFC 6750 section 2.1 `credentials = "Bearer" 1*SP b64token`; section 3: no error code when the request lacks
   authentication information; section 3.1 `invalid_request` 400, `invalid_token` 401, `insufficient_scope` 403; section 2
   "Clients MUST NOT use more than one method to transmit the token". RFC 7235 section 2.1: the auth-scheme is a
   case-insensitive token. As designed.
5. Provider connectors: the Anthropic Messages API connector (beta `mcp-client-2025-11-20`) links the 2025-11-25
   authorization specification and supports Streamable HTTP and SSE; the OpenAI Responses `type: "mcp"` tool references the
   2025-03-26 specification. Both are handshake-era: neither can call this modern-only server (INFERRED from OD-41; an
   `initialize` gets 400 `-32020`).
6. Schema re-read of 2026-09-21 (review fix; schema/2026-07-28/schema.ts and basic/versioning, fetched live):
   `UnsupportedProtocolVersionError.error.data` is `{ supported: string[]; requested: string }`, both required, and the
   versioning page's example carries `"requested": "1900-01-01"`; `JSONRPCErrorResponse` is `{ jsonrpc; id?: RequestId;
   error }` with `RequestId = string | number`, so an error answer never sends `"id": null`; `HeaderMismatchError` (`-32020`)
   requires no `data`, so the `data.supported` of a missing version header is allowed. The endpoint now sends `requested` and
   leaves an unreadable id out (E5, E6, E15; I3).

## 12. UNKNOWNs settled

| # | item | settlement |
|---|---|---|
| U1 | Next serves `app/.well-known` route handlers | INFERRED (route discovery ignores only `_`-prefixed parts); the wire proof is B20-D3 |
| U2 | 405 for the unexported GET and DELETE on `/api/mcp` | UNKNOWN until B20-D3; no policy row exists for either (E12) |
| U3 | HTTP status of a request-level `-32602` | unknown tool, cursor, arguments 200; missing `_meta` 400 (re-read item 1) |
| U4 | RFC field names, credential syntax; the `authorization_servers` MUST | as designed; the MUST CONFIRMED (section 9) |
| U5 | B1's API and `x-mcp-header` | `renderMcpToolListing` used as landed; no exposed tool declares `x-mcp-header`, so every `Mcp-Param-*` is refused |
| U6 | the b16-0-4 / b16-0-7 matrices current on the base tree | CONFIRMED current (both generators on `77125bd`: zero diff) |
| U7 | eslint lints `app/.well-known` | CONFIRMED (linted with the change set, no ignore warning) |
| U8 | the answer to a legacy `initialize` | 400 `-32020` naming the supported versions (re-read item 1; differs from the design default) |
| U9 | whether B1's tools can meet `requiredAuthority` through MCP | RECORDED for B3: B2 lists what B1 exposes; authority is a call-time condition |

## 13. Closed codes and bounds

Wrapper refusal codes (`MCP_ENDPOINT_REFUSAL_CODES`): `MCP_NOT_ENABLED`, `AUTH_ROUTE_MISCONFIGURED`, `AUTH_POLICY_MISSING`,
`AUTH_POLICY_WRAPPER_MISMATCH`, `AUTH_PRODUCTION_NOT_CONFIGURED`, `MCP_NOT_CONFIGURED`, `AUTH_ORIGIN_NULL`,
`AUTH_ORIGIN_MALFORMED`, `AUTH_CROSS_ORIGIN_DENIED`, `MCP_QUERY_REFUSED`, `MCP_UNAUTHENTICATED`,
`MCP_AUTHORIZATION_MALFORMED`, `MCP_TOKEN_INVALID`, `MCP_RATE_LIMITED`, `AUTH_MEMBERSHIP_UNAVAILABLE`, `AUTH_ROLE_UNMAPPED`,
`AUTH_ROLE_DENIED`, `AUTH_CAPABILITY_DENIED`, `AUTH_MEDIA_TYPE_UNSUPPORTED`, `MCP_NOT_ACCEPTABLE`, `AUTH_PAYLOAD_TOO_LARGE`,
`AUTH_BODY_DEADLINE_EXCEEDED`, `AUTH_BODY_ABORTED`, `AUTH_BODY_UNREADABLE`.

Token verification refusals (`MCP_TOKEN_REFUSALS`, in judging order): `clock_invalid`, `not_configured`, `malformed`,
`unsupported_algorithm`, `bad_signature`, `claims_invalid`, `wrong_issuer`, `wrong_audience`, `lifetime_exceeded`,
`not_yet_valid`, `expired`. Mint refusals add `mint_failed`.

Token route codes (`MCP_TOKEN_ROUTE_CODES`): `MCP_NOT_ENABLED`, `MCP_NOT_CONFIGURED`, `MCP_TOKEN_PRINCIPAL_REFUSED`,
`MCP_TOKEN_BODY_INVALID`, `MCP_RATE_LIMITED`, `MCP_TOKEN_MINT_FAILED`.

JSON-RPC codes: `-32700`, `-32600`, `-32601`, `-32602`, `-32603`, `-32020`, `-32022`.

Trace outcomes (`MCP_SERVER_TRACE_OUTCOMES`): `discovered`, `listed`, `not_served`, `unknown_tool`, `arguments_invalid`,
`cursor_refused`, `invalid_params`, `invalid_request`, `header_mismatch`, `unsupported_protocol_version`,
`method_not_found`, `notification_accepted`, `internal_error`.

Bounds (`MCP_BEARER_BOUNDS`): `MCP_TOKEN_LIFETIME_S` = 3600, `MCP_TOKEN_MAX_CHARS` = 2048, `MCP_TOKEN_PAYLOAD_MAX_BYTES` = 1024,
`MCP_TOKEN_CLOCK_SKEW_S` = 30, `MCP_TOKEN_SECRET_MIN_BYTES` = 32, `MCP_TOKEN_SECRET_MAX_BYTES` = 1024,
`MCP_TOKEN_ID_BYTES` = 16, `MCP_AUTHORIZATION_MAX_CHARS` = 2100, `MCP_CONTENT_TYPE_MAX_CHARS` = 256,
`MCP_ACCEPT_MAX_CHARS` = 1024, `MCP_ACCEPT_MAX_RANGES` = 32, `MCP_PROTOCOL_VERSION_HEADER_MAX_CHARS` = 32,
`MCP_METHOD_HEADER_MAX_CHARS` = 128, `MCP_NAME_HEADER_MAX_CHARS` = 2048, `MCP_ROUTE_MAX_BYTES_CEILING` = 1048576,
`MCP_ROUTE_DEADLINE_MS_CEILING` = 60000. The endpoint route declares 65 536 bytes / 10 000 ms, the token route 256 bytes /
5 000 ms. Limits: 10 per 60 s (token route), 120 per 60 s (endpoint), at most 10 000 keys each. The trace ring holds 1 000
records. `tools/list` and `server/discover` carry `ttlMs` 60 000.

## 14. The suites (CONFIRMED, run through the heavy-job runner; the page test counts `it(` blocks)

| suite | cases |
|---|---|
| `app/lib/auth/__tests__/b20-b2-mcp-access-token.test.ts` | 15 |
| `app/lib/auth/__tests__/b20-b2-mcp-route-policy.test.ts` | 13 |
| `app/lib/auth/__tests__/b20-b2-route-tree.test.ts` | 8 |
| `app/lib/auth/__tests__/b20-b2-route-matrices-pinned.test.ts` | 5 |
| `app/api/mcp/__tests__/b20-b2-mcp-endpoint.test.ts` | 36 |
| `app/api/mcp/__tests__/b20-b2-mcp-token-route.test.ts` | 12 |
| `app/api/mcp/__tests__/b20-b2-protected-resource-metadata.test.ts` | 5 |
| `app/api/mcp/__tests__/b20-b2-own-client-interop.test.ts` | 4 |
| `app/lib/mcp/server/__tests__/b20-b2-server-protocol.test.ts` | 6 |
| `app/lib/mcp/server/__tests__/b20-b2-import-gates.test.ts` | 4 |

CI: the four `app/lib/auth/__tests__/b20-b2-*` suites are explicit `prompt-to-gerber` entries; `app/api/mcp/__tests__` is a
new directory filter; the two `app/lib/mcp/server` suites ride the existing `app/lib/mcp` filter. No B2 suite starts PGlite.

Interop note (suite H): A2's `discoverMcpServer` and `listMcpTools` are not on this branch (it is based on B1, `77125bd`);
the suite drives Sirkit's own endpoint with the A1 transport `mcpPost` and checks the shapes A2 validates. Sirkit's own
client would keep none of the listed tools: A2's foreign-tool gate refuses names in the `sirkit.` namespace
(`reserved_namespace`), as intended for a foreign server (INFERRED from A2; not exercised on this branch).
