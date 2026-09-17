# B20-A — the Sirkit-managed MCP client boundary

Labels: **CONFIRMED** (executed and measured), **INFERRED** (code reading), **PROPOSED** (designed, not exercised),
**RECORDED** (written down without a claim), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**.

Built increment by increment (discovery section 7): A0 registry, admission key and flag (this page's first section);
A1 transport (headers, error bodies, SSE, cancellation); A2 client negotiation, discovery and descriptor gates; A3
authorization client; A4 observation envelope and trace attribution; A5 provider-native connector policy. Every increment
is against the current specification revision 2026-07-28 (`mcp-reference-notes.md`; OD-41) with no SDK dependency (OD-42).
Line numbers are of the tree each section was written on; the tests are the gate.

## Registry and admission (A0) — CONFIRMED

Closes the registry half of D20-20 (closed id union, no canonical URI, no pinned descriptor: now one reviewed row per
server with an RFC 8707 canonical URI unique across rows, an origin-and-path endpoint and a descriptor pin); its wire half
stays open for A1 — `outboundFetch` still admits by hostname alone (`app/lib/net/outbound-fetch.ts:113`) and
`policyFromRegistry` still copies hosts only (`app/lib/distributors/egress.ts:30-41`), so nothing at the wire reads the
endpoint or the pin yet (Deferred, PROPOSED). Closes D20-21 (no per-tool quota dimension), D20-24 (policy pins
`maxRedirects: 0`), D20-26 (no feature flag), D20-27 (CI guard covers `/b19-/` only). No network code, no transport, no
endpoint, no new dependency.

### What is enforced

| control | where | what |
|---|---|---|
| allowlist of identities and canonical URLs | `app/lib/mcp/server-registry.ts:88-108` (entry), `:172-204` (canonical URI), `:294-413` (validator) | one reviewed row per server; RFC 8707 canonical URI, unique across the revision (`duplicate-canonical-uri`); the endpoint is the origin's host and port and the exact path, exactly as the URI derives them (registry data: the wire check is A1's); the registry is empty (OD-48) and frozen in place (`:116`, `frozenMcpServerEntries` `:138-140`, nested freeze proven on a fixture row); no add/remove API |
| pinned descriptors | `server-registry.ts:76-80`, `:357-363` | `descriptorPin` is `sha256:<64 hex>` + `pinnedAt`, both set or both null; null means never trusted as pinned; registry data — nothing compares it yet (A2) |
| secret references, never values | `server-registry.ts:36`, `:335-350`, `:406-410`; `app/lib/agent/redaction.ts:67-74` | env NAME pattern; no credential name referenced by two rows (`shared-secret-reference`; a `client-id` may be shared); every string secret-shape scanned with the B19 shapes and the token-anchored redaction classifier (`sk-` inside a word is an identity); a malformed id is never echoed (`:303-305`, `(malformed id, row n)`); the CSV renders `NAME|role` only |
| no redirects | `server-registry.ts:388` | `maxRedirects` must be `0`, so `outboundFetch` (A1) never re-sends `Authorization` on a same-origin hop (D20-24) |
| bounded limits | `server-registry.ts:38-50`, `:365-387` | minute window 4..600 and per-tool windows 4..the server's (the floor of 4 keeps the agent's 25% share above 0); concurrency 1..16; deadline 1..30 s; body 1 KiB..8 MB; breaker 1..20 failures, 1 s..1 h cooldown |
| per-server and per-tool quotas, breaker | `app/lib/acquisition/admission-control.ts:42-50` (key), `:81-113` (meters), `:191-209` (admit), `:274-291` (MCP entry points) | `requestMcpAdmission(server, tool, cost, now, purpose)` admits only when the server window AND (when `limits.perTool[tool]` exists as an own property) the tool window admit; a refusal by either reserves nothing; the breaker is the server's and refuses every tool while open; one half-open trial; `rate_limited` opens at once |
| agent purpose share (OD-40) | `admission-control.ts:153-177` | the agent purpose may use at most 25% of the server window and of each tool window; interactive use counts against the whole window; a window at the registry floor (4) still gives the agent one request |
| distributor sources unchanged | `admission-control.ts:81-88`, `:247-267` | same signatures, same windows, same sentences (pinned verbatim in `b20-a0-admission-by-server-and-tool.test.ts`) |
| feature flag (OD-54, flag part) | `app/lib/mcp/rollout.ts:12-26`; `.env.example:61-69` | `SIRKIT_MCP_ENABLED` enables only when its value is exactly `1`, compared untrimmed as `SIRKIT_DB_QUALIFICATION` is (`app/lib/db/test-qualification.ts:72`; a padded `1` does not enable); `SIRKIT_MCP_DISABLED_SERVERS` is a remove-only id list; read at call time through the environment-record pattern; no value echoed |
| admission by state and flag | `server-registry.ts:221-231` | approved only, and only with the flag on; the environment defaults to `process.env` at call time, so an omitted environment consults the flag rather than skipping it (as `admitSource(id, env)`); `unknown_server` / `blocked` / `disabled` / `feature_disabled` / `operator_disabled` closed codes; the registry state wins over the operator list |
| CI admission (OD-59) | `app/lib/acquisition/__tests__/b19-e-ci-job-scope.test.ts:53-54`, `:147-164`; `.github/workflows/deterministic-manufacturing.yml:131` | chapter list `["b19-", "b20-"]`; every `/b20-` suite must be selected by the right job; `app/lib/mcp` is a `prompt-to-gerber` directory filter (explicit files under it are refused by the redundancy rule) |

### Evidence

- `app/lib/mcp/__tests__/b20-a0-server-registry.test.ts` — 125 cases: the committed registry validates and is empty,
  frozen in place with the nested freeze proven on a fixture row, without a mutating export; 26 accepted/refused
  canonical-URI spellings (a ported URI keeps its port; `sk-` inside a host label is accepted); 71 validator refusal rows,
  one rule each (the cross-row rules on two rows; the port mismatch both ways; the floor of 4 on both windows; a malformed
  id never echoed); admission codes including the omitted-environment case; CSV determinism, the port column, this page's
  column count and the byte pin.
- `app/lib/mcp/__tests__/b20-a0-admission-by-server-and-tool.test.ts` — 20 cases: server window, tool window, both
  required, tool refusal reserves nothing, prototype-named tools have no window, per-server breaker across tools and
  servers, half-open trial, agent share on both windows and at the registry floor, preview/pause per purpose, distributor
  outcomes and sentences unchanged, reset covers MCP meters.
- `app/lib/mcp/__tests__/b20-a0-feature-flag.test.ts` — 22 cases: off by default; a padded `1`, `true`/`yes`/`TRUE`/`on`/
  `01`/`1.0` never enable; list parsing; remove-only at the admission point; no value echoed; `.env.example` documents both.
- `b19-e-ci-job-scope.test.ts` — the two `[B20 A0]` cases failed before the workflow edit (`app/lib/mcp` absent; three
  B20 suites unadmitted) and pass after it; the five B19 cases unchanged.
- Review fixes (second pass, 2026-09-17), each test-first with the failure recorded on the unfixed tree: the omitted
  environment no longer skips the flag; `sk-` inside a word is accepted; minute windows start at 4; the endpoint carries
  the port and the CSV an `endpoint_port` column; canonical URIs and secret references are unique across rows; a malformed
  id is never echoed; the flag is compared untrimmed; the freezer is exported and its nested freeze proven (the
  shallow-freeze mutation fails the suite); this page and `mcp-server-registry.md` re-cited from the delivered tree.

### Limits, stated (RECORDED)

- Meters are per process (OD-53): several instances can together exceed one server's minute window; the server's own
  rate limiting is the backstop; a durable shared meter is a follow-up. No live server is enabled in B20 (OD-48).
- Every minute window has a floor of 4 requests (server and tool): the agent's share is `floor(max × 0.25)`, and below 4
  it would be 0 — a window the agent could never use while its refusal read as a temporary pause.
- `limits.maxConcurrent` is recorded in the row and not metered in A0; the transport (A1) enforces it as an in-flight bound.
- The canonical-URI rule refuses loopback, private and metadata names by name; the runtime SSRF wall (every resolved
  address public, exact host match) is the egress boundary's and applies in A1 on every request.
- The registry is browser-safe by construction (no Node import, no environment read at module load) so a later UI can
  show labels; nothing renders it yet.

### Deferred

- Wire-level admission by origin and exact path (the wire half of D20-20) → A1, PROPOSED: the transport builds the request
  URL from `canonicalUri` and compares `url.origin` and `url.pathname` against the row (an origin-and-path extension of
  `OutboundPolicy`, or an MCP-side check before `outboundFetch`); a token whose RFC 8707 `resource` names `:8443` is then
  never sent to another port of the same host.
- Transport, response headers, non-2xx JSON-RPC bodies, SSE reading and cancellation → A1 (D20-16, D20-17).
- Negotiation (`server/discover`), discovery caching, comparing `tools/list` against `descriptorPin`, foreign name /
  description / annotation / schema gates → A2 (D20-18, D20-15, D20-13).
- OAuth flows: PRM (RFC 9728) and AS metadata discovery, `resource` indicators, audience and `iss` checks, scope step-up,
  in-process token cache → A3 (D20-19; OD-46 keeps credentials by environment name only in B20).
- Observation envelope, agent read port, trace attribution → A4 (D20-22, D20-11).
- Provider-native connector policy → A5 (D20-29, OD-45).
