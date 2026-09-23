# B20-A0 — the MCP server registry

Labels: **CONFIRMED** (executed and measured), **INFERRED** (code reading), **PROPOSED** (designed, not exercised),
**RECORDED** (written down without a claim), **UNKNOWN**.

The registry is code, not a document: `app/lib/mcp/server-registry.ts` (version `1.2.0` since B20-A4L: the per-tool agent
allowlist `agentTools` and its column, the OD-74 amendment; `1.1.0` was B20-A3's authorization-server pin and its two
columns, OD-61; `MCP_SERVER_REGISTRY_VERSION` at `:27`). Its render is `mcp-server-registry.csv` in this directory, gated byte-for-byte by
`app/lib/mcp/__tests__/b20-a0-server-registry.test.ts` (regenerate with `npx tsx scripts/generate-b20-mcp-server-registry.ts`).
It is modelled on the B19 source registry (`app/lib/acquisition/source-registry.ts`): one reviewed row per server, secrets
by environment NAME only, frozen in place at module load, every rule a row must satisfy in one validator, and no add, remove
or enable API — a row changes only by a reviewed change to the module. Line numbers below were re-pinned on the B20-A4L tree
(the page was written on B20-A0 after its review fixes); the tests, not the numbers, are the gate.

## 1. The empty allowlist (OD-48) — CONFIRMED

The registry ships with **zero rows** (`ENTRIES` at `server-registry.ts:134-138`): `MCP_SERVER_REGISTRY` is `[]` (`:140`,
frozen in place by `frozenMcpServerEntries`, `:162-164`, whose nested freeze — every row, every nested object and array —
is proven on a fixture row because the registry has no row to prove it on), `MCP_SERVER_IDS` is `[]`, `mcpServerEntry(id)`
is `null` for every id, and `admittedMcpServer(id)` answers `unknown_server` for every id, so the MCP client (A1 onwards)
can reach nothing. The committed CSV is the header line alone (31 columns), and the byte pin fails the moment a row is
added without regenerating it. A server is added only by a reviewed row (section 7). While a row's `descriptorPin` is
`{ toolsListDigest: null, pinnedAt: null }`, no discovery result is ever trusted as pinned; while its `agentTools` is `[]`,
no tool of it is ever agent-callable (B20-A4L) — and the row is then not on the agent roster at all (A4L review): it is not
offered by `servers`, and nothing is ever negotiated, listed or sent for it, since its answer is empty by construction.

## 2. Schema — `McpServerRegistryEntry` (`server-registry.ts:104-132`)

| field | shape | rule (validator section 3) |
|---|---|---|
| `id` | `^[a-z0-9][a-z0-9-]{1,30}$` | unique; the meter key and the id an operator names in `SIRKIT_MCP_DISABLED_SERVERS`; an id that fails the pattern is never echoed — its violations are labelled `(malformed id, row n)` |
| `title` | 1..120 characters | display only; secret-shape and control-character scanned like every string |
| `canonicalUri` | RFC 8707 canonical form (section 4) | https; lowercase scheme and host; optional non-default port; optional plain path; no query, fragment, trailing slash or userinfo; host a public DNS name; **unique across the revision** (`duplicate-canonical-uri`): one server is one row, so one decision, one meter and one credential cover it |
| `endpoint` | `{ host, port, path }` | must be exactly what `canonicalUri` derives: the origin's host and port (`null` when the https default is not spelled out) and the exact path. A row on `:8443` is not the row on `:443`, and neither admits the other. Registry data in A0: the transport (A1) must build the request URL from `canonicalUri` and compare `url.origin` and `url.pathname` against the row — the wire allowlist is origin **and** path, never host only (D20-20: registry half closed here, wire half PROPOSED for A1 in `mcp-client-boundary.md`) |
| `supportedProtocolVersions` | `readonly string[]` | must include `2026-07-28`; `2025-11-25` only with `compatibilityEra: true` (OD-41); nothing else; no duplicates |
| `compatibilityEra` | boolean | true if and only if `2025-11-25` is listed |
| `auth.mode` | `none` \| `client-credentials-env` \| `pre-issued-token-env` | `none`: no references; `pre-issued-token-env`: exactly one `access-token` reference; `client-credentials-env`: exactly a `client-id` and a `client-secret` reference (OD-46) and the `auth.authorizationServer` pin (B20-A3, OD-61); `none` and `pre-issued-token-env` carry no pin (absent or null) |
| `auth.authorizationServer` | `{ issuer, tokenEndpoint }` \| `null` (`McpAuthorizationServerPin`, `server-registry.ts:88-91`) | B20-A3 (OD-61), rule `authorization-server`: required on a `client-credentials-env` row, refused on every other mode. Both URLs pass `mcpAuthorizationUrlOf` (`:241-275`): a string of at most 512 characters (the length judged first); https; a lowercase public DNS host of at least two labels, never an IP literal or a loopback, private or metadata name; no spelled-out `:443`, no userinfo, query or fragment; plain path segments, never `.` or `..`; equal to its own reconstruction. The issuer may end in `/`; the token endpoint needs a non-root path and may not lie at or under any row's MCP endpoint on its origin (its own or another's: the endpoint's path, the path with a terminating slash, or any path below it — B20-A3 review; an MCP endpoint at `/` covers only the root). The authorization client compares what a server supplies with these values and never fetches it |
| `auth.secrets[]` | `{ env, role }` | `env` is an environment variable NAME (`^[A-Z][A-Z0-9_]{2,63}$`), never a value; roles closed; no duplicates in a row; **no credential name (`client-secret`, `access-token`) referenced by two rows** (`shared-secret-reference`): a credential is issued for one server and is never sent to two (`mcp-reference-notes.md` section 5); a `client-id` is a public identifier and may be shared, but never names an `access-token` or `client-secret` reference of any row (`shared-secret-reference`, B20-A3 review: the client id is sent to the row's token endpoint) |
| `auth.scopes[]` | OAuth scope tokens | printable ASCII without space, quote or backslash; no duplicates; at most 32 (`MCP_SCOPES_MAX`, `:41`; B20-A3: the scope ceiling of the authorization client, OD-62, the count judged before any entry meets the pattern) |
| `descriptorPin` | `{ toolsListDigest: null \| "sha256:<64 hex>", pinnedAt: null \| ISO date }` | both null or both set; null means "never trusted as pinned"; registry data in A0 — nothing compares it yet (A2) |
| `limits.requestsPerMinute` | integer 4..600 | the server's minute window; the floor is 4 so the agent's 25% share (OD-40, `floor(max × 0.25)`) is never rounded to 0 — below 4 the window would refuse the agent forever while reading as a temporary pause |
| `limits.maxConcurrent` | integer 1..16 | in-flight bound for the transport (A1); not a meter in A0 |
| `limits.deadlineMs` | integer 1 000..30 000 | the transport's hard deadline |
| `limits.maxResponseBytes` | integer 1 024..8 000 000 | the bounded reader's ceiling |
| `limits.breaker` | `{ failureThreshold: 1..20, cooldownMs: 1 000..3 600 000 }` | the per-server breaker |
| `limits.perTool?` | `Record<toolName, { requestsPerMinute }>` | tool name `^[A-Za-z0-9_.-]{1,128}$` (the specification's bound); 4..the server's `requestsPerMinute` (the same floor, for the same reason) |
| `maxRedirects` | the literal `0` | the validator refuses anything else (D20-24: a same-origin redirect would re-send `Authorization`) |
| `agentDisclosure` | `permitted` \| `prohibited` \| `unknown` | `unknown` = labels only (OD-36 pattern); never `permitted` on a disabled or blocked row |
| `agentTools` | `readonly string[]`, REQUIRED (`server-registry.ts:123-129`) | B20-A4L (the OD-74 amendment), rule `agent-tools`: the tools of this row's pinned listing an agent may be offered and may call. Fail closed — `[]` is legal and makes NO tool of the row agent-callable (and takes the row off the agent roster, so nothing is sent for it), and a row without the field is refused. At most 32 entries (`MCP_AGENT_TOOLS_MAX`, `:44`; the count is judged before any entry meets the pattern, as the scope ceiling is, so an over-bound list is refused WHOLE — the port reads it the same way and admits none of its names, never its first 32); every entry a tool name of the same pattern the client admits for a foreign name (`MCP_TOOL_NAME_PATTERN`, `:36`, ASCII by construction); no duplicate; sorted in code-point order, which is the order the `agent_tools` CSV cell renders. It only NARROWS: a name the pinned listing does not hold, or one the A2 descriptor gates did not accept, is still refused by the port. A row that is not `permitted` for an agent may still carry names — the disclosure decides whether the row is offered at all |
| `terms` | `{ documentationUrl?, checkedOn?, retentionNote? }` | a plain https link; an ISO date; a non-empty note; an **approved** row needs both the link and the date |
| `state` | `{ status: approved \| disabled \| blocked, ownerDecision: "OD-n", reason }` | every row carries an owner decision id; a blocked row declares no secret references |

## 3. Validator — `validateMcpServerRegistry(entries)` (`server-registry.ts:395-586`) — CONFIRMED

Returns structured violations `{ id, rule, message }` with a closed rule vocabulary (`McpRegistryRule`, `:321-351`):
`duplicate-id`, `duplicate-canonical-uri`, `shared-secret-reference`, `id`, `title`, `canonical-uri`, `endpoint`,
`protocol-versions`, `auth-mode`, `secret-reference`, `scopes`, `descriptor-pin`, `limits`, `per-tool`, `redirects`,
`agent-disclosure`, `terms`, `state`, `secret-shaped`, `control-characters`, (B20-A3) `authorization-server` and (B20-A4L) `agent-tools`. Every rule
in section 2 has refusal cases: the A0 rules in `b20-a0-server-registry.test.ts` (77 rows, six of them B20-A4L's `agent-tools` rules: one change per case against a
fixture row that passes every rule, so each refusal is caused by that change alone; the cross-row rules use two rows), the
`authorization-server` rule, its two cross-row rules and the 32-scope cap in `b20-a3-registry-authorization-pin.test.ts`
(19 refused URL spellings in both pin fields, the mode rule both ways, the accepted spellings, the cross-row rules on two
rows, in both orders: a shared client id with another issuer, a token endpoint at or under an MCP endpoint, and a client id
that names another row's access token or client secret).

Cross-row rules (`:397-424`, `:443-445`, `:471-475`, `:480-483`, `:500-512`): ids, canonical URIs and secret references are unique
across the revision, so a disable decision cannot be split across two ids for one server, one server cannot hold two
minute windows, and one credential (a client secret or an access token; a client id is not a credential) cannot be sent
to two servers; and (B20-A3, OD-61) rows that share a client-id reference pin the identical issuer (credentials are keyed
by issuer), no row's `tokenEndpoint` lies at or under any row's MCP endpoint on its origin (the client secret never goes to
an MCP server: a terminating slash or a sub-path of the endpoint is refused as the endpoint itself is), and (B20-A3 review)
a client-id reference never names any row's access-token or client-secret reference (a client id is sent to the row's
token endpoint, so a credential named as one would reach an authorization server it was not issued for) — whatever the
order of the rows.

Secret-shape scan (`:360`, `:580-583`): every string in a row — keys and values, to depth 8 — is tested against the B19
source registry's long-token shapes (`sk-ant-…`, `sk-…`, `ghp_…`, `AKIA…`, PEM private-key markers, `hf_…`, JWT-shaped)
AND the redaction authority's classifier in its token-anchored form (`containsTokenAnchoredSecretShapedText`,
`app/lib/agent/redaction.ts:67-74`, built on `MODEL_BOUND_SECRET_PATTERNS`: bearer tokens, `key: value` and JSON-quoted
credential fields, `ENV=value` dumps, URL userinfo, and `sk-` / `sk-ant-` keys only at a token boundary). A host label or
a title such as `desk-lamp-tools` or `Flask-based-docs`, where `sk-` sits inside a word, is an identity and not a key and
is accepted; `sk-…` at the start of a string or after a space or a slash is still refused. Proven on the title, the
reason, the documentation URL, the retention note and a scope, and the two identities are proven accepted. The two
classifiers are one exported rule since the B20-A3 review (`isMcpSecretShapedText`, `:366-368`): the authorization client
refuses a crafted row's secret-shaped environment NAME by it, as this validator would.

Nothing unvetted is echoed (`:427-429`): an id that fails its pattern — it could be secret-shaped or carry control
characters — is replaced by `(malformed id, row n)` in the violation's `id` and at the head of every message, so the
generator's error output and the suite's assertion text never carry it; `admittedMcpServer` replaces such an id with
`(malformed id)`; a per-tool name is echoed only when it matches the tool-name pattern; an environment variable NAME is
echoed only when it matches the env-name pattern.

## 4. Canonical URI — `mcpEndpointOfCanonicalUri(uri)` (`server-registry.ts:196-228`) — CONFIRMED

RFC 8707 canonical form as `mcp-reference-notes.md` section 5 records it (`scheme+host[:port][/path]`, lowercase, no
fragment, no trailing slash). Accepted: `https://mcp.example.com/mcp`, a bare host (endpoint path `/`), a non-default
port (the derived endpoint carries `port: 8443` and the row's `endpoint.port` must equal it), a mixed-case path (paths are
case-sensitive), a host label carrying `sk-` inside a word. Refused, each with its own reason and a test: http; uppercase
scheme or host (the string must equal its own canonical reconstruction, so one server has one spelling); IPv4 and IPv6
literals and an all-numeric last label; `localhost`, `*.localhost`, `*.local`, `*.internal`, `*.home.arpa`, `metadata`
(the same names `app/lib/net/ip-policy.ts:97-103` refuses, re-stated here without its Node import so the module stays
browser-safe); a single-label host; userinfo; a query (even an empty `?`); a fragment; a trailing slash (after the host
too); the default port spelled out; dot, empty, percent-encoded or whitespace path segments. The egress boundary (A1)
applies the address policy again at the wire on every resolved address; this is the reviewed-row rule, not the runtime
SSRF wall.

## 5. Admission — `admittedMcpServer(id, env = process.env, entries?)` (`server-registry.ts:307-317`) — CONFIRMED

Returns `{ admitted: true, entry }` only for an **approved** row, and only with the feature flag on. Closed refusal codes
(`McpServerRefusal`, `:294`): `unknown_server` (no row: OD-48), `blocked`, `disabled` (message names the row's owner
decision), `feature_disabled` (`SIRKIT_MCP_ENABLED` is not `1`) and `operator_disabled` (the id is in
`SIRKIT_MCP_DISABLED_SERVERS`). The environment is read at call time and defaults to `process.env` — as `mcpFeatureState`
does and as `admitSource(id, env)` requires its record — so an omitted environment consults the flag rather than skipping
it: no caller is admitted by omission (proven: with the flag unset in `process.env`,
`admittedMcpServer("docs-example", undefined, rows)` is `feature_disabled`, and with the id listed there it is
`operator_disabled`). The registry state wins over the list: listing a disabled, blocked or unknown id never admits it; the
list can only remove (OD-54). Messages name variables and decisions, never a value. Nothing consumes the admission in A0;
A1's transport calls it with the environment it runs in.

## 6. The rendered artifact — `renderMcpServerRegistryCsv(entries)` (`server-registry.ts:607-647`) — CONFIRMED

31 columns in a fixed order (`MCP_SERVER_REGISTRY_CSV_COLUMNS`, `:600-604`; `endpoint_port` is empty for the https
default; B20-A3 inserted `authorization_issuer` and `token_endpoint` after `scopes`, empty for a row without a pin; B20-A4L
inserted `agent_tools` after `agent_disclosure` — the allowlist joined by `;`, empty for a row that approves no tool), one row per entry sorted by id (so the render is the same whatever order the rows are declared in), RFC 4180
quoting. Secret references render as `NAME|role`; no value exists in a row, so none can render. Proven deterministic on
two fixture rows, byte-matched against the committed CSV, and this page's own column count is checked against the
constant by the suite.

## 7. How a row is added

1. A reviewed PR adds one object to `ENTRIES` and bumps `MCP_SERVER_REGISTRY_VERSION`.
2. The row carries `state.ownerDecision` naming the owner decision that admits that server (identity, canonical URL,
   terms) — the empty-allowlist default is OD-48, so a first server is a new decision.
3. Its canonical URI and its secret references are its own: no other row may carry the same canonical URI or reference the
   same environment variable name.
4. `terms.documentationUrl` and `terms.checkedOn` record the server's documentation and the date it was read; the row is
   `approved` only with both.
5. `descriptorPin.toolsListDigest` and `pinnedAt` are set together once the server's `tools/list` has been reviewed
   (A2 compares discovery against the pin); until then discovery is never trusted as pinned.
6. `agentTools` names, sorted, the tools of that reviewed listing an agent may call — nothing else of it is offered or sent
   (B20-A4L, the OD-74 amendment). A row that approves no tool for the agent carries `[]`; the field is never omitted, and
   such a row is off the agent roster entirely, so no request is made for it (A4L review).
   Annotations decide nothing here: a tool that declares `readOnlyHint: true` is agent-callable only if this list names it.
7. `npx tsx scripts/generate-b20-mcp-server-registry.ts` regenerates the CSV; the byte pin and the validator run in CI
   (`app/lib/mcp` is a `prompt-to-gerber` directory filter, OD-59).
8. Nothing at run time can add, enable or widen a row: the module is frozen in place and exports no such function (the
   test `exports no add/remove/register/enable API` pins the export names).

## 8. Not done in A0 — RECORDED

- No network code, no transport, no endpoint: the registry does not fetch (A1).
- The endpoint (origin and exact path) and the descriptor pin are registry data in A0: nothing at the wire reads them yet.
  The existing `OutboundPolicy` admits by hostname alone (`app/lib/net/outbound-fetch.ts:113`) and `policyFromRegistry`
  copies hosts only (`app/lib/distributors/egress.ts:30-41`), which is the wire half of D20-20; the transport (A1) must
  build the request URL from `canonicalUri` and admit only its origin and exact path (an origin-and-path extension of
  `OutboundPolicy`, or an MCP-side check before `outboundFetch`) — PROPOSED. The pin comparison against a live
  `tools/list` is A2.
- No OAuth flow: only `none`, `client-credentials-env` and `pre-issued-token-env` by environment NAME (OD-46; A3). — B20-A3
  added the authorization-server pin to the registry (OD-61) and the client-credentials flow to the client
  (`mcp-client-boundary.md`, Authorization client (A3)).
- `limits.maxConcurrent` is recorded but not metered; the transport enforces it as an in-flight bound (A1).
