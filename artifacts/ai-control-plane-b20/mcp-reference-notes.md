# MCP reference notes — read at execution time on 2026-09-17 (B20 start)

Sources fetched today (WebFetch, live): modelcontextprotocol.io/specification/latest (resolves to revision **2026-07-28**),
/specification/versioning, /specification/2026-07-28/{changelog, basic/index, basic/transports/streamable-http,
basic/transports/stdio, basic/authorization, basic/authorization/security-considerations, basic/patterns/mrtr, server/discover,
server/tools}, /docs/2026-07-28/tutorials/security/security_best_practices; platform.claude.com/docs/en/agents-and-tools/mcp-connector
(docs.anthropic.com/en/docs/mcp now 301s to platform.claude.com and then 307s to modelcontextprotocol.io);
developers.openai.com/api/docs/guides/tools-connectors-mcp (platform.openai.com/docs/... 301s there);
registry.npmjs.org/@modelcontextprotocol/sdk (+ unpkg types.js of 1.30.0).

## 1. Which revision is current

- The **current** protocol version is **2026-07-28** (versioning page). Previous revision: 2025-11-25. Schema of record:
  schema/2026-07-28/schema.ts.
- **The official TypeScript SDK (`@modelcontextprotocol/sdk` 1.30.0, dist-tag latest, no 2.x tag) implements
  LATEST_PROTOCOL_VERSION "2025-11-25", SUPPORTED ["2025-11-25","2025-06-18","2025-03-26","2024-11-05","2024-10-07"]; it defines
  none of server/discover, subscriptions/listen, InputRequiredResult, resultType, CacheableResult/ttlMs, Mcp-Method.** So the
  SDK speaks the previous (handshake) era only.
- Anthropic's Messages API MCP connector (beta header `mcp-client-2025-11-20`) links the 2025-11-25 authorization spec; it
  supports "Streamable HTTP and SSE transports", tools only, remote HTTPS only (no stdio), `authorization_token` supplied by the
  API consumer who runs OAuth themselves. OpenAI's Responses `type: "mcp"` tool supports "Streamable HTTP or the HTTP/SSE
  transport", references the 2025-03-26 spec, `authorization` token not stored, `require_approval` "always"/"never"/object,
  `allowed_tools`, `server_label`, `server_url`, `connector_id`, `headers`, output items mcp_list_tools/mcp_call/
  mcp_approval_request/mcp_approval_response.
- Consequence for B20: implement the **2026-07-28 revision natively** (it is the current spec; the runbook forbids a remembered
  or deprecated draft) AND the **2025-11-25 era** (initialize handshake, Mcp-Session-Id, GET stream) for interoperability with
  the provider connectors and the SDK-based ecosystem — exactly the "Backward Compatibility" the 2026-07-28 spec defines. Owner
  decision to record (OD-41): dual-era support, current revision first; the older era is the compatibility path, never the
  authority path.

## 2. 2026-07-28 key changes (changelog, verbatim gist)

1. No protocol-level sessions, no `Mcp-Session-Id`; list endpoints do not vary per connection; cross-call state = explicit
   server-minted handles passed as ordinary tool arguments (SEP-2567).
2. Stateless: no `initialize`/`notifications/initialized`. Every request carries `_meta["io.modelcontextprotocol/protocolVersion"]`
   (required) and `_meta["io.modelcontextprotocol/clientCapabilities"]` (required); `clientInfo` SHOULD; results SHOULD carry
   `_meta["io.modelcontextprotocol/serverInfo"]`. Version mismatch → `UnsupportedProtocolVersionError` (-32022) listing supported
   versions (SEP-2575).
3. `server/discover` — servers MUST implement; returns `supportedVersions`, `capabilities`, `instructions`, serverInfo in _meta,
   plus `ttlMs`/`cacheScope`.
4. `subscriptions/listen` replaces the GET stream and resources/subscribe: one long-lived POST response stream; opt-in types
   `toolsListChanged`, `promptsListChanged`, `resourcesListChanged`, `resourceSubscriptions`; notifications tagged with
   `_meta["io.modelcontextprotocol/subscriptionId"]`.
5. Removed `ping`, `logging/setLevel`, `notifications/roots/list_changed`; log level per request via
   `_meta["io.modelcontextprotocol/logLevel"]`; servers MUST NOT emit `notifications/message` for requests without it.
6. Tasks moved to extension `io.modelcontextprotocol/tasks` (tasks/get polling, tasks/update).
7. **MRTR**: server-to-client requests (roots/list, sampling/createMessage, elicitation/create) are no longer sent as requests;
   the server returns `InputRequiredResult` (`resultType: "input_required"`, `inputRequests` map, opaque `requestState`); the
   client retries the ORIGINAL request with `inputResponses` (+ `requestState` echoed exactly) under a NEW id. Only prompts/get,
   resources/read, tools/call may return it. `requestState` MUST be treated as attacker-controlled; integrity-protect (HMAC/AEAD)
   when it influences authz/logic; SHOULD bind principal + TTL + originating-request digest; single-use must be enforced
   server-side when required. Servers MUST NOT send inputRequests the client did not declare capability for.
8. Every result carries required `resultType` ("complete" | "input_required" | extension values); absent → treat as "complete"
   (older servers); unrecognized → invalid.
9. No SSE resumability (`Last-Event-ID` gone); a broken stream loses the request; re-issue with a new id.
Minor: `extensions` in capabilities; OpenTelemetry `traceparent`/`tracestate`/`baggage` in _meta; deterministic tools/list
order; required headers `Mcp-Method` (all POSTs) and `Mcp-Name` (tools/call, resources/read, prompts/get) + `x-mcp-header`
→ `Mcp-Param-{Name}`; `CacheableResult` (`ttlMs`, `cacheScope` "public"|"private") REQUIRED on tools/list, prompts/list,
resources/list, resources/read, resources/templates/list (and server/discover supports caching); resource-not-found now
-32602; `iss` validation (RFC 9207) MUST when present; DCR needs `application_type`; client credentials keyed by issuer;
inputSchema/outputSchema any 2020-12 keywords, structuredContent any JSON value; `$ref` to network URIs MUST NOT be
auto-dereferenced; composition bounds SHOULD; error code policy: -32000..-32019 legacy (do not allocate), -32020..-32099
spec-reserved (-32020 HeaderMismatch, -32021 MissingRequiredClientCapability, -32022 UnsupportedProtocolVersion); app errors
outside -32768..-32000.
Deprecated: Roots, Sampling, Logging features (SEP-2577); HTTP+SSE transport (2024-11-05); includeContext thisServer/allServers;
DCR (RFC 7591) in favour of Client ID Metadata Documents.

## 3. Streamable HTTP (2026-07-28) — normative

- Single MCP endpoint, POST only. Client MUST: POST each JSON-RPC request/notification; `Accept: application/json, text/event-stream`;
  include `MCP-Protocol-Version` (MUST equal the _meta value, else 400 + -32020), `Mcp-Method`, `Mcp-Name` where applicable
  (Base64 sentinel `=?base64?...?=` when not header-safe); body = ONE request or notification, never a response.
- Server: notification accepted → `202` no body; request → `application/json` single object or `text/event-stream` scoped to
  that request (only request-related notifications, then the final response; MUST NOT send independent requests on it);
  `X-Accel-Buffering: no` SHOULD; keep-alive comment lines on long streams; unknown method → 404 + -32601; unsupported version
  → 400 + -32022; missing required _meta → 400 + -32602; missing client capability → 400 + -32021.
- Security: servers MUST validate `Origin` (403 if present and invalid); local servers SHOULD bind 127.0.0.1; SHOULD authenticate.
- Cancellation on HTTP: client closes the SSE response stream (no notifications/cancelled); server MUST NOT send more messages.
- Legacy traffic on a modern-only server: GET/DELETE → 405; ignore `Mcp-Session-Id` (never mint/echo); ignore `Last-Event-ID`.
- Modern client probing a server: try a modern request; on 400 inspect the body — a recognized modern JSON-RPC error means modern
  (retry per `supported`), an empty/unrecognized body means legacy → `initialize` handshake. A modern server MAY treat a request
  with no MCP-Protocol-Version header as 2025-03-26 only if it supports such clients; otherwise reject.
- `x-mcp-header`: constraints (tchar token, unique CI, primitive types only, statically reachable via `properties` chain only);
  clients MUST exclude a tool whose annotation violates them from tools/list and SHOULD log; servers MUST reject
  `Mcp-Param-*` that mismatch the body (400 + -32020); do not mark sensitive params.

## 4. stdio (2026-07-28)

Newline-delimited JSON-RPC on stdin/stdout, no embedded newlines; stderr free-form logging; server MUST NOT write non-MCP to
stdout; server MUST NOT write requests to stdout (MRTR instead); cancellation via `notifications/cancelled`; shutdown by
closing stdin then wait then force (TerminateProcess/Job Objects on Windows); restart on unexpected exit and re-establish
listen streams; probe with `server/discover` first (DiscoverResult → modern; recognized modern error → modern; anything else or
timeout → legacy initialize); no per-request headers — everything in `_meta`; the process is NOT a session: unrelated requests
may interleave; credentials come from the environment (authorization spec does not apply to stdio).

## 5. Authorization (2026-07-28) — normative

- HTTP transports SHOULD conform; stdio SHOULD NOT (environment credentials). AS MUST implement OAuth 2.1 (draft-13).
- MCP servers MUST implement Protected Resource Metadata (RFC 9728); clients MUST use it for AS discovery; AS MUST provide RFC 8414
  or OIDC discovery; clients MUST support both.
- Client registration: Client ID Metadata Documents SHOULD (URL-shaped client_id); DCR MAY (deprecated; needs `application_type`);
  pre-registration allowed. Credentials keyed by issuer; never reused across AS.
- PKCE: clients MUST implement, MUST verify support via `code_challenge_methods_supported` (absent → MUST refuse), MUST use S256.
- Resource indicators (RFC 8707): `resource` MUST be in authorization and token requests, = the MCP server's canonical URI
  (scheme+host[:port][/path], lowercase, no fragment, no trailing slash by convention). Sent regardless of AS support.
- `iss` (RFC 9207): client MUST record the validated issuer before redirecting; compare with simple string comparison, no
  normalization; if `authorization_response_iss_parameter_supported` true and `iss` absent → reject; on mismatch MUST NOT act
  on error fields either.
- Tokens: `Authorization: Bearer` on EVERY request; MUST NOT be in the query string. Servers MUST validate audience (issued for
  this server), 401 invalid/expired, 403 insufficient scope with `WWW-Authenticate: Bearer error="insufficient_scope",
  scope="...", resource_metadata="..."`, 400 malformed. Clients MUST NOT send tokens not issued by the server's AS; servers MUST
  NOT accept or transit other tokens (**token passthrough forbidden**); upstream APIs get a SEPARATE token; the MCP server MUST
  NOT pass through the client's token.
- Scopes: challenge `scope` is authoritative for the operation; clients SHOULD least-privilege, step-up = union of previous and
  challenged scopes, bounded retries; servers MUST honour scope hierarchies; `offline_access` not a resource requirement.
- Security considerations: HTTPS for all AS endpoints; redirect URIs localhost or HTTPS; exact redirect URI registration/match;
  state SHOULD; refresh-token rotation for public clients; short-lived access tokens; CIMD fetch SSRF protections; localhost
  redirect warnings; proxies with static upstream client id MUST obtain per-client consent (confused deputy).
- Best practices: SSRF on OAuth metadata URLs — HTTPS only (loopback exception in dev), block private/link-local/loopback ranges
  incl. 169.254.169.254, validate redirect targets per hop, consider DNS pinning; state-handle hijacking — a handle is never
  authentication, bind handles to the verified principal (`<user_id>:<handle>`), random + expiring; local server compromise —
  show the exact command, explicit consent, sandbox, least privilege; authorization URL validation — allow only http(s), reject
  javascript:/data:/file:/vbscript:, never open via a shell; scope minimization.

## 6. Tools (2026-07-28)

- `tools` capability with `listChanged`; tools/list MUST NOT vary per connection or as a side effect (MAY vary by the
  authorization on the request); deterministic order SHOULD; pagination `cursor`/`nextCursor`; `ttlMs` + `cacheScope` required.
- Tool: `name` (SHOULD 1–128 chars, `[A-Za-z0-9_.-]`, case-sensitive, unique per server; aggregators SHOULD prefix by server),
  `title`, `description`, `icons`, `inputSchema` (valid JSON Schema object, 2020-12 default; no-arg tools
  `{type:"object", additionalProperties:false}`), `outputSchema`, `annotations` (**clients MUST treat annotations as untrusted
  unless from trusted servers**), `_meta`.
- tools/call result: `resultType`, `content[]` (text/image/audio/resource_link/resource), `structuredContent` (MUST conform
  to outputSchema; SHOULD also serialize into a text block), `isError` for execution errors (model-recoverable) vs JSON-RPC
  errors for protocol errors (-32602 unknown tool). May return InputRequiredResult.
- Security: servers MUST validate inputs, access control, rate limit, sanitize outputs; clients SHOULD confirm sensitive ops, show
  inputs, validate results before the LLM, follow $ref rules, timeouts, audit logs. "Human in the loop with the ability to deny".
- Stateful tools: explicit opaque random handles; a handle is a name not a capability; validate authorization per call; state
  retention stated in the description; expiry → tool execution error.

## 7. Base protocol (2026-07-28)

Requests: id string|integer, never null, unique among in-flight. Results: `resultType` required. Errors: integer codes; `data`
optional. Notifications: no id. Statelessness: servers MUST NOT rely on prior requests on the same connection for context;
state spanning requests MUST be referenced by an explicit identifier. `_meta` key syntax: optional reverse-DNS prefix + `/`;
prefixes whose second label is `modelcontextprotocol` or `mcp` are reserved; name `[A-Za-z0-9]` at both ends with `-_.` inside.
JSON Schema: 2020-12 MUST; unsupported dialect → error; network `$ref` MUST NOT be auto-dereferenced (opt-in only with host
allowlist, private-range rejection, timeouts, size limits, logging); unresolved external $ref → reject; composition bounds
(depth, subschema count, time budget) SHOULD. Icons: https or data: only, same-origin, no credentials, magic-byte checks.

## 8. Re-read of 2026-09-21 (B20-B3: tools/call results and `_meta`)

- **Sources:** modelcontextprotocol.io/specification/2026-07-28/server/tools, /specification/2026-07-28/basic/index, and schema/2026-07-28/schema.ts, all fetched live.
- **`tools/call` results:**
  - `structuredContent` is any JSON value that conforms to `outputSchema` when one is defined; servers MUST provide conforming structured results.
  - A tool returning structured content SHOULD also return the serialized JSON in a TextContent block; the spec's own example carries both.
  - `isError: true` reports tool execution errors (input validation, business logic); unknown tools and malformed requests are JSON-RPC errors such as `-32602`.
  - Types: `CallToolResult extends Result { content: ContentBlock[]; structuredContent?: unknown; isError?: boolean }`, and `Result` requires `resultType` with an optional `_meta: ResultMetaObject`.
- **`_meta`:**
  - `RequestMetaObject extends MetaObject = Record<string, unknown>`; third-party extensions use their own vendor prefix.
  - A prefix whose second label is `modelcontextprotocol` or `mcp` is reserved; a name begins and ends alphanumeric.
  - A missing required `_meta` field is `-32602` with HTTP 400. `dev.sirkit/*` keys are valid on both request params and results.
- **SEP-2567 ("Stateful Tools", non-normative):** the protocol has no handle concept; a handle is an ordinary string argument, "a name, not a capability", authorized on every call.

## 9. Re-read of 2026-09-21 (B20-A3: authorization)

- **Sources (fetched live 2026-09-21, each page also read in its `.md` form):** modelcontextprotocol.io/specification/2026-07-28/basic/authorization, /specification/2026-07-28/basic/authorization/authorization-server-discovery, /extensions/auth/oauth-client-credentials, /extensions/auth/overview and /extensions/overview; github.com/modelcontextprotocol/ext-auth `specification/draft/oauth-client-credentials.mdx` ("Protocol Revision: draft"); RFC 8414, RFC 9728, RFC 6749 and RFC 8707 (rfc-editor.org); draft-ietf-oauth-v2-1-13 (ietf.org). Nothing below is in code: A3 stopped at this re-read (last bullet).
- **Protected-resource metadata (authorization-server-discovery):**
  - MCP servers MUST implement ONE of two mechanisms: `resource_metadata` in the `WWW-Authenticate` header of a 401 (RFC 9728 §5.1), or a well-known URI, path-inserted (`/.well-known/oauth-protected-resource<endpoint path>`) or at the root. A server that publishes its metadata only through the challenge conforms.
  - Clients MUST support both, MUST use the challenge URL when present, and otherwise MUST fall back to the well-known URIs in that order (path-inserted, then root). The metadata MUST list at least one authorization server; the client chooses (RFC 9728 §7.6) and keeps credentials and tokens per authorization server.
  - The page's sequence diagram (non-normative) begins with an unauthenticated MCP request; when neither well-known URI answers it reads "Abort or use pre-configured values".
  - Consequence for A3: the task's default (D2, OD-64) discovers from the well-known URIs and sends no request without a token to a row that needs one (`mcpPost` answers `token_unavailable`), so it never receives the 401 that carries the challenge URL. Under that default A3 cannot reach a conforming server that publishes its metadata only through the challenge; that row ends in `prm_unavailable`. Reaching it needs an unauthenticated first request (or one probe after both well-known URIs answer 404 or 410) or a row-pinned metadata URL: an OD-64 decision.
- **Authorization-server metadata:** with an issuer path, `/.well-known/oauth-authorization-server{path}`, then `/.well-known/openid-configuration{path}`, then `{path}/.well-known/openid-configuration`; without a path, the first two. The document's `issuer` MUST be identical to the issuer the URL was built from (RFC 8414 §3.3; OIDC Discovery §4.3), else it MUST NOT be used; RFC 8414 §3.1 removes a terminating `/` of the issuer before inserting. This matches task §5.9.
- **Canonical server URI (basic/authorization):** the canonical form uses lowercase scheme and host components, but implementations SHOULD accept uppercase scheme and host components for robustness and interoperability; the form without a trailing slash SHOULD be used. RFC 9728 §3.3: the metadata `resource` MUST be identical to the resource identifier the well-known URL was built from, or, for metadata fetched from a challenge URL, to the URL of the request to the resource server. Consequence: the task's exact comparison (D3; suite 2's "case variant" row) follows RFC 9728 "identical" and departs from this SHOULD for an uppercase scheme or host: an OD-64 decision (record the departure, or compare scheme and host case-insensitively).
- **Signed metadata:** consumers MAY ignore `signed_metadata` (RFC 9728 §2.2); the §3.3 signature rule binds a consumer that uses it.
- **Scopes:** the challenge `scope` is authoritative for the current operation; the initial request SHOULD use the challenge `scope`, else all of `scopes_supported`, omitting `scope` when that is undefined; step-up requests the union of the previously requested set and the challenge; clients acting on their own behalf (`client_credentials`) MAY attempt step-up or abort immediately; retry limits SHOULD. Task D4's `scopes_supported` ∩ the row ceiling narrows the SHOULD (OD-62).
- **Resource indicator:** `resource` MUST be in every token request, the canonical URI, sent whether or not the authorization server supports it. RFC 8707 §2: an absolute URI without a fragment; `invalid_target` for a refused resource.
- **Client-credentials extension (`io.modelcontextprotocol/oauth-client-credentials`):**
  - The extension page's client guide lists "Declare support" first: include the extension in the per-request capabilities, `_meta["io.modelcontextprotocol/clientCapabilities"].extensions["io.modelcontextprotocol/oauth-client-credentials"] = {}`. The extensions overview: clients declare extensions in every request's `clientCapabilities`, extensions are never active by default, and a server that requires an authentication extension can reject a client that does not declare it. The ext-auth normative draft does not itself state the declaration.
  - Client authentication (ext-auth draft): clients MUST use JWT authentication (RFC 7523 §2.2, RECOMMENDED) or a client secret "transmitted in the request content" as OAuth 2.1 §2.4.1 defines. When supporting the flow, the authorization server's metadata MUST include `token_endpoint_auth_methods_supported` with at least one of `private_key_jwt` and `client_secret_basic` (and `token_endpoint_auth_signing_alg_values_supported` for JWT). Its flow diagram begins with an MCP request without a token and reads `resource_metadata` from the 401.
  - draft-ietf-oauth-v2-1-13 §2.4.1: the authorization server MUST support client credentials in the request body; HTTP Basic is MAY. RFC 6749 §2.3.1 is the reverse (Basic MUST, the body NOT RECOMMENDED). The task's §5.9 (Basic unless only `client_secret_post` is listed) is the reverse of the extension's body method: an OD-64 decision.
- **RFC 8414 §2:** `grant_types_supported` omitted means `["authorization_code", "implicit"]` (confirms task D10); `token_endpoint_auth_methods_supported` omitted means `client_secret_basic`.
- **RFC 6749:** §4.4.2 `grant_type=client_credentials`, `scope` optional, the client MUST authenticate; §4.4.3 a refresh token SHOULD NOT be included; §5.1 `token_type` is case-insensitive, `expires_in` RECOMMENDED, `scope` REQUIRED when it differs from the request, `Cache-Control: no-store`; §5.2 a 400 (a 401 for `invalid_client` over an Authorization header) with one closed `error` code.
- **Outcome:** the declared capability contradicts task §4 (no decision declares one; the transport sends `clientCapabilities` `{}` unless a caller passes more, `http-transport.ts` `McpPostOptions.clientCapabilities`), which is the task's stop condition. A3 stopped before code on 2026-09-21 (no source changed). A re-dispatch waits on a decision on the capability declaration and on OD-61..OD-64, where OD-64 now also settles the client-authentication method, the challenge-only metadata path and the uppercase comparison.
