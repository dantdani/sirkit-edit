# B20-A0 — the MCP server registry

Labels: **CONFIRMED** (executed and measured), **INFERRED** (code reading), **PROPOSED** (designed, not exercised),
**RECORDED** (written down without a claim), **UNKNOWN**.

The registry is code, not a document: `app/lib/mcp/server-registry.ts` (version `1.0.0`, `MCP_SERVER_REGISTRY_VERSION`
at `:25`). Its render is `mcp-server-registry.csv` in this directory, gated byte-for-byte by
`app/lib/mcp/__tests__/b20-a0-server-registry.test.ts` (regenerate with `npx tsx scripts/generate-b20-mcp-server-registry.ts`).
It is modelled on the B19 source registry (`app/lib/acquisition/source-registry.ts`): one reviewed row per server, secrets
by environment NAME only, frozen in place at module load, every rule a row must satisfy in one validator, and no add, remove
or enable API — a row changes only by a reviewed change to the module. Line numbers below are of the tree this page was
written on (B20-A0 after its review fixes); the tests, not the numbers, are the gate.

## 1. The empty allowlist (OD-48) — CONFIRMED

The registry ships with **zero rows** (`ENTRIES` at `server-registry.ts:110-114`): `MCP_SERVER_REGISTRY` is `[]` (`:116`,
frozen in place by `frozenMcpServerEntries`, `:138-140`, whose nested freeze — every row, every nested object and array —
is proven on a fixture row because the registry has no row to prove it on), `MCP_SERVER_IDS` is `[]`, `mcpServerEntry(id)`
is `null` for every id, and `admittedMcpServer(id)` answers `unknown_server` for every id, so the MCP client (A1 onwards)
can reach nothing. The committed CSV is the header line alone (28 columns), and the byte pin fails the moment a row is
added without regenerating it. A server is added only by a reviewed row (section 7). While a row's `descriptorPin` is
`{ toolsListDigest: null, pinnedAt: null }`, no discovery result is ever trusted as pinned.

## 2. Schema — `McpServerRegistryEntry` (`server-registry.ts:88-108`)

| field | shape | rule (validator section 3) |
|---|---|---|
| `id` | `^[a-z0-9][a-z0-9-]{1,30}$` | unique; the meter key and the id an operator names in `SIRKIT_MCP_DISABLED_SERVERS`; an id that fails the pattern is never echoed — its violations are labelled `(malformed id, row n)` |
| `title` | 1..120 characters | display only; secret-shape and control-character scanned like every string |
| `canonicalUri` | RFC 8707 canonical form (section 4) | https; lowercase scheme and host; optional non-default port; optional plain path; no query, fragment, trailing slash or userinfo; host a public DNS name; **unique across the revision** (`duplicate-canonical-uri`): one server is one row, so one decision, one meter and one credential cover it |
| `endpoint` | `{ host, port, path }` | must be exactly what `canonicalUri` derives: the origin's host and port (`null` when the https default is not spelled out) and the exact path. A row on `:8443` is not the row on `:443`, and neither admits the other. Registry data in A0: the transport (A1) must build the request URL from `canonicalUri` and compare `url.origin` and `url.pathname` against the row — the wire allowlist is origin **and** path, never host only (D20-20: registry half closed here, wire half PROPOSED for A1 in `mcp-client-boundary.md`) |
| `supportedProtocolVersions` | `readonly string[]` | must include `2026-07-28`; `2025-11-25` only with `compatibilityEra: true` (OD-41); nothing else; no duplicates |
| `compatibilityEra` | boolean | true if and only if `2025-11-25` is listed |
| `auth.mode` | `none` \| `client-credentials-env` \| `pre-issued-token-env` | `none`: no references; `pre-issued-token-env`: exactly one `access-token` reference; `client-credentials-env`: exactly a `client-id` and a `client-secret` reference (OD-46) |
| `auth.secrets[]` | `{ env, role }` | `env` is an environment variable NAME (`^[A-Z][A-Z0-9_]{2,63}$`), never a value; roles closed; no duplicates in a row; **no credential name (`client-secret`, `access-token`) referenced by two rows** (`shared-secret-reference`): a credential is issued for one server and is never sent to two (`mcp-reference-notes.md` section 5); a `client-id` is a public identifier and may be shared |
| `auth.scopes[]` | OAuth scope tokens | printable ASCII without space, quote or backslash; no duplicates |
| `descriptorPin` | `{ toolsListDigest: null \| "sha256:<64 hex>", pinnedAt: null \| ISO date }` | both null or both set; null means "never trusted as pinned"; registry data in A0 — nothing compares it yet (A2) |
| `limits.requestsPerMinute` | integer 4..600 | the server's minute window; the floor is 4 so the agent's 25% share (OD-40, `floor(max × 0.25)`) is never rounded to 0 — below 4 the window would refuse the agent forever while reading as a temporary pause |
| `limits.maxConcurrent` | integer 1..16 | in-flight bound for the transport (A1); not a meter in A0 |
| `limits.deadlineMs` | integer 1 000..30 000 | the transport's hard deadline |
| `limits.maxResponseBytes` | integer 1 024..8 000 000 | the bounded reader's ceiling |
| `limits.breaker` | `{ failureThreshold: 1..20, cooldownMs: 1 000..3 600 000 }` | the per-server breaker |
| `limits.perTool?` | `Record<toolName, { requestsPerMinute }>` | tool name `^[A-Za-z0-9_.-]{1,128}$` (the specification's bound); 4..the server's `requestsPerMinute` (the same floor, for the same reason) |
| `maxRedirects` | the literal `0` | the validator refuses anything else (D20-24: a same-origin redirect would re-send `Authorization`) |
| `agentDisclosure` | `permitted` \| `prohibited` \| `unknown` | `unknown` = labels only (OD-36 pattern); never `permitted` on a disabled or blocked row |
| `terms` | `{ documentationUrl?, checkedOn?, retentionNote? }` | a plain https link; an ISO date; a non-empty note; an **approved** row needs both the link and the date |
| `state` | `{ status: approved \| disabled \| blocked, ownerDecision: "OD-n", reason }` | every row carries an owner decision id; a blocked row declares no secret references |

## 3. Validator — `validateMcpServerRegistry(entries)` (`server-registry.ts:294-413`) — CONFIRMED

Returns structured violations `{ id, rule, message }` with a closed rule vocabulary (`McpRegistryRule`, `:235-255`):
`duplicate-id`, `duplicate-canonical-uri`, `shared-secret-reference`, `id`, `title`, `canonical-uri`, `endpoint`,
`protocol-versions`, `auth-mode`, `secret-reference`, `scopes`, `descriptor-pin`, `limits`, `per-tool`, `redirects`,
`agent-disclosure`, `terms`, `state`, `secret-shaped`, `control-characters`. Every rule in section 2 has a refusal case in
`b20-a0-server-registry.test.ts` (71 rows: one change per case against a fixture row that passes every rule, so each
refusal is caused by that change alone; the cross-row rules use two rows).

Cross-row rules (`:296-300`, `:318-321`, `:345-350`): ids, canonical URIs and secret references are unique across the
revision, so a disable decision cannot be split across two ids for one server, one server cannot hold two minute windows,
and one credential (a client secret or an access token; a client id is not a credential) cannot be sent to two servers.

Secret-shape scan (`:270`, `:406-410`): every string in a row — keys and values, to depth 8 — is tested against the B19
source registry's long-token shapes (`sk-ant-…`, `sk-…`, `ghp_…`, `AKIA…`, PEM private-key markers, `hf_…`, JWT-shaped)
AND the redaction authority's classifier in its token-anchored form (`containsTokenAnchoredSecretShapedText`,
`app/lib/agent/redaction.ts:67-74`, built on `MODEL_BOUND_SECRET_PATTERNS`: bearer tokens, `key: value` and JSON-quoted
credential fields, `ENV=value` dumps, URL userinfo, and `sk-` / `sk-ant-` keys only at a token boundary). A host label or
a title such as `desk-lamp-tools` or `Flask-based-docs`, where `sk-` sits inside a word, is an identity and not a key and
is accepted; `sk-…` at the start of a string or after a space or a slash is still refused. Proven on the title, the
reason, the documentation URL, the retention note and a scope, and the two identities are proven accepted.

Nothing unvetted is echoed (`:303-305`): an id that fails its pattern — it could be secret-shaped or carry control
characters — is replaced by `(malformed id, row n)` in the violation's `id` and at the head of every message, so the
generator's error output and the suite's assertion text never carry it; `admittedMcpServer` replaces such an id with
`(malformed id)`; a per-tool name is echoed only when it matches the tool-name pattern; an environment variable NAME is
echoed only when it matches the env-name pattern.

## 4. Canonical URI — `mcpEndpointOfCanonicalUri(uri)` (`server-registry.ts:172-204`) — CONFIRMED

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

## 5. Admission — `admittedMcpServer(id, env = process.env, entries?)` (`server-registry.ts:221-231`) — CONFIRMED

Returns `{ admitted: true, entry }` only for an **approved** row, and only with the feature flag on. Closed refusal codes
(`McpServerRefusal`, `:208`): `unknown_server` (no row: OD-48), `blocked`, `disabled` (message names the row's owner
decision), `feature_disabled` (`SIRKIT_MCP_ENABLED` is not `1`) and `operator_disabled` (the id is in
`SIRKIT_MCP_DISABLED_SERVERS`). The environment is read at call time and defaults to `process.env` — as `mcpFeatureState`
does and as `admitSource(id, env)` requires its record — so an omitted environment consults the flag rather than skipping
it: no caller is admitted by omission (proven: with the flag unset in `process.env`,
`admittedMcpServer("docs-example", undefined, rows)` is `feature_disabled`, and with the id listed there it is
`operator_disabled`). The registry state wins over the list: listing a disabled, blocked or unknown id never admits it; the
list can only remove (OD-54). Messages name variables and decisions, never a value. Nothing consumes the admission in A0;
A1's transport calls it with the environment it runs in.

## 6. The rendered artifact — `renderMcpServerRegistryCsv(entries)` (`server-registry.ts:427-471`) — CONFIRMED

28 columns in a fixed order (`MCP_SERVER_REGISTRY_CSV_COLUMNS`, `:427-431`; `endpoint_port` is empty for the https
default), one row per entry sorted by id (so the render is the same whatever order the rows are declared in), RFC 4180
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
6. `npx tsx scripts/generate-b20-mcp-server-registry.ts` regenerates the CSV; the byte pin and the validator run in CI
   (`app/lib/mcp` is a `prompt-to-gerber` directory filter, OD-59).
7. Nothing at run time can add, enable or widen a row: the module is frozen in place and exports no such function (the
   test `exports no add/remove/register/enable API` pins the export names).

## 8. Not done in A0 — RECORDED

- No network code, no transport, no endpoint: the registry does not fetch (A1).
- The endpoint (origin and exact path) and the descriptor pin are registry data in A0: nothing at the wire reads them yet.
  The existing `OutboundPolicy` admits by hostname alone (`app/lib/net/outbound-fetch.ts:113`) and `policyFromRegistry`
  copies hosts only (`app/lib/distributors/egress.ts:30-41`), which is the wire half of D20-20; the transport (A1) must
  build the request URL from `canonicalUri` and admit only its origin and exact path (an origin-and-path extension of
  `OutboundPolicy`, or an MCP-side check before `outboundFetch`) — PROPOSED. The pin comparison against a live
  `tools/list` is A2.
- No OAuth flow: only `none`, `client-credentials-env` and `pre-issued-token-env` by environment NAME (OD-46; A3).
- `limits.maxConcurrent` is recorded but not metered; the transport enforces it as an in-flight bound (A1).
