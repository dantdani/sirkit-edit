# B20-A — the Sirkit-managed MCP client boundary

Labels: **CONFIRMED** (executed and measured), **INFERRED** (code reading), **PROPOSED** (designed, not exercised),
**RECORDED** (written down without a claim), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**.

Built increment by increment (discovery section 7): A0 registry, admission key and flag (this page's first section);
A1 transport (headers, error bodies, SSE, cancellation); A2 client negotiation, discovery and descriptor gates; A3
authorization client; A4 observation envelope and trace attribution; A5 provider-native connector policy. Every increment
is against the current specification revision 2026-07-28 (`mcp-reference-notes.md`; OD-41) with no SDK dependency (OD-42).
Line numbers of `http-transport.ts`, `sse-reader.ts`, `outbound-fetch.ts`, `admission-control.ts` and `redaction.ts` were
re-derived on the A1 review-2 tree (2026-09-19), in both sections; every other line number is of the tree its section was
written on. They drift with every edit: the tests are the gate, and the case counts below are pinned by one of them.

## Registry and admission (A0) — CONFIRMED

Closes the registry half of D20-20 (closed id union, no canonical URI, no pinned descriptor: now one reviewed row per
server with an RFC 8707 canonical URI unique across rows, an origin-and-path endpoint and a descriptor pin); its wire half
was left open for A1 — at A0 `outboundFetch` admitted by hostname alone (`app/lib/net/outbound-fetch.ts:193`; `:113` on
the A0 tree) and `policyFromRegistry` copied hosts only (`app/lib/distributors/egress.ts:30-41`), so nothing at the wire
read the endpoint or the pin — closed in A1 by the MCP-side check `endpointMatches`
(`app/lib/mcp/http-transport.ts:609-619`) before
`outboundFetch`, whose own hostname admission is unchanged and is never reached for MCP without that check; the pin
comparison against a live `tools/list` stays A2's (Deferred). Closes D20-21 (no per-tool quota dimension), D20-24 (policy pins
`maxRedirects: 0`), D20-26 (no feature flag), D20-27 (CI guard covers `/b19-/` only). No network code, no transport, no
endpoint, no new dependency.

### What is enforced

| control | where | what |
|---|---|---|
| allowlist of identities and canonical URLs | `app/lib/mcp/server-registry.ts:88-108` (entry), `:172-204` (canonical URI), `:294-413` (validator) | one reviewed row per server; RFC 8707 canonical URI, unique across the revision (`duplicate-canonical-uri`); the endpoint is the origin's host and port and the exact path, exactly as the URI derives them (registry data: the wire check is A1's); the registry is empty (OD-48) and frozen in place (`:116`, `frozenMcpServerEntries` `:138-140`, nested freeze proven on a fixture row); no add/remove API |
| pinned descriptors | `server-registry.ts:76-80`, `:357-363` | `descriptorPin` is `sha256:<64 hex>` + `pinnedAt`, both set or both null; null means never trusted as pinned; registry data — nothing compares it yet (A2) |
| secret references, never values | `server-registry.ts:36`, `:335-350`, `:406-410`; `app/lib/agent/redaction.ts:71-78` | env NAME pattern; no credential name referenced by two rows (`shared-secret-reference`; a `client-id` may be shared); every string secret-shape scanned with the B19 shapes and the token-anchored redaction classifier (`sk-` inside a word is an identity); a malformed id is never echoed (`:303-305`, `(malformed id, row n)`); the CSV renders `NAME|role` only |
| no redirects | `server-registry.ts:388` | `maxRedirects` must be `0`, so `outboundFetch` (A1) never re-sends `Authorization` on a same-origin hop (D20-24) |
| bounded limits | `server-registry.ts:38-50`, `:365-387` | minute window 4..600 and per-tool windows 4..the server's (the floor of 4 keeps the agent's 25% share above 0); concurrency 1..16; deadline 1..30 s; body 1 KiB..8 MB; breaker 1..20 failures, 1 s..1 h cooldown |
| per-server and per-tool quotas, breaker | `app/lib/acquisition/admission-control.ts:48-56` (key), `:87-118` (meters), `:197-215` (admit), `:284-301` (MCP entry points) | `requestMcpAdmission(server, tool, cost, now, purpose)` admits only when the server window AND (when `limits.perTool[tool]` exists as an own property) the tool window admit; a refusal by either reserves nothing; the breaker is the server's and refuses every tool while open; one half-open trial; `rate_limited` opens at once |
| agent purpose share (OD-40) | `admission-control.ts:159-183` | the agent purpose may use at most 25% of the server window and of each tool window; interactive use counts against the whole window; a window at the registry floor (4) still gives the agent one request |
| distributor sources unchanged | `admission-control.ts:87-94`, `:257-277` | same signatures, same windows, same sentences (pinned verbatim in `b20-a0-admission-by-server-and-tool.test.ts`) |
| feature flag (OD-54, flag part) | `app/lib/mcp/rollout.ts:12-26`; `.env.example:61-69` | `SIRKIT_MCP_ENABLED` enables only when its value is exactly `1`, compared untrimmed as `SIRKIT_DB_QUALIFICATION` is (`app/lib/db/test-qualification.ts:72`; a padded `1` does not enable); `SIRKIT_MCP_DISABLED_SERVERS` is a remove-only id list; read at call time through the environment-record pattern; no value echoed |
| admission by state and flag | `server-registry.ts:221-231` | approved only, and only with the flag on; the environment defaults to `process.env` at call time, so an omitted environment consults the flag rather than skipping it (as `admitSource(id, env)`); `unknown_server` / `blocked` / `disabled` / `feature_disabled` / `operator_disabled` closed codes; the registry state wins over the operator list |
| CI admission (OD-59) | `app/lib/acquisition/__tests__/b19-e-ci-job-scope.test.ts:53-54`, `:147-164`; `.github/workflows/deterministic-manufacturing.yml:131` | chapter list `["b19-", "b20-"]`; every `/b20-` suite must be selected by the right job; `app/lib/mcp` is a `prompt-to-gerber` directory filter (explicit files under it are refused by the redundancy rule) |

### Evidence

- `app/lib/mcp/__tests__/b20-a0-server-registry.test.ts` — 126 cases (as run on the review-2 tree; this page said 125): the committed registry validates and is empty,
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
  never sent to another port of the same host. — Closed in A1 (the MCP-side check `endpointMatches`; see Transport (A1)).
- Transport, response headers, non-2xx JSON-RPC bodies, SSE reading and cancellation → A1 (D20-16, D20-17). — Closed in
  A1 (see Transport (A1)).
- Negotiation (`server/discover`), discovery caching, comparing `tools/list` against `descriptorPin`, foreign name /
  description / annotation / schema gates → A2 (D20-18, D20-15, D20-13).
- OAuth flows: PRM (RFC 9728) and AS metadata discovery, `resource` indicators, audience and `iss` checks, scope step-up,
  in-process token cache → A3 (D20-19; OD-46 keeps credentials by environment name only in B20).
- Observation envelope, agent read port, trace attribution → A4 (D20-22, D20-11).
- Provider-native connector policy → A5 (D20-29, OD-45).

## Transport (A1) — CONFIRMED

Closes D20-16 (response headers and non-2xx bodies), D20-17 (an incremental SSE reader that never buffers a stream to
`done`), the wire half of D20-20 (the request URL is admitted by origin AND exact path, never host only) and the wire
test of D20-24 (a 3xx is a closed failure and `Authorization` is never re-sent). Three files: an ADDITIVE extension of
the one egress path (`app/lib/net/outbound-fetch.ts`), the SSE reader (`app/lib/net/sse-reader.ts`) and the transport
(`app/lib/mcp/http-transport.ts`, `mcpPost`) — plus one row in the schgen endpoint client's total map over the closed
egress codes (`app/lib/schgen/endpoint-client.ts:69-86`: `http_error` → its own `http_error`, unreachable there because
that policy never sets `errorBody`; `tsc` required the row). No negotiation, no discovery ingestion, no OAuth flow, no
observation record, no endpoint, no new dependency (OD-42); every fake server in the tests is in-process behind
`OutboundDeps`, and the global fetch is poisoned throughout. Line numbers are of the A1 tree after the review passes
(2026-09-17: eighteen confirmed findings from the four-lens review fixed test-first; 2026-09-19: one further confirmed
finding, the attribution's `method`, fixed test-first; 2026-09-19, review-2: the ten residual findings R2-A..R2-K of the
four independent checkers, fixed test-first; 2026-09-20, review-3: five further findings R3-1..R3-5 of the independent
checkers — the first a REGRESSION of review-2 — fixed test-first in `http-transport.ts`, `sse-reader.ts` and their two
suites only — the failing-first and mutation evidence is under Evidence below). Review-2
touched two B19 modules beside the A1 set, both additively for their existing callers: `admission-control.ts` (the
MCP-only outcome `inconclusive`; `recordOutcome` and `distributorJson` unchanged) and `app/lib/agent/redaction.ts` (the
URL-credential pattern in linear time; every suite that imports the module passes unchanged).

One deviation from the increment's letter, stated: beside the two egress extensions the plan named (headers, `errorBody`)
a third additive option, `streamBody: { contentTypes }`, hands a 2xx body of a named media type back UNREAD. Without it
the transport could not consume `text/event-stream` at all — `outboundFetch` reads every body through
`readBoundedStream`, which succeeds only when the stream ends (D20-17 itself). It is off unless a policy names a type,
applies to 2xx only, and the distributor policies never set it (pinned).

### What is enforced

| control | where | what |
|---|---|---|
| response headers, bounded and allowlisted | `outbound-fetch.ts:91-94` (bounds), `:147-165` (`responseHeaderSubset`) | a success result carries `headers`: `content-type`, `www-authenticate`, `retry-after`, `mcp-protocol-version` and any `mcp-*` name, lowercase, at most 16, a value over 2 048 UTF-8 bytes dropped whole (never truncated) and counted in `headersDropped`; `set-cookie`, `authorization`, `proxy-authenticate`, `cookie` and every other name are never surfaced (they are not "dropped": they never exist for the caller) |
| error bodies, only under the option | `outbound-fetch.ts:111-116` (`errorBody`), `:291-314`, `:86-87` (`errorBodyDropped`) | a 400..599 answer becomes the closed failure `http_error` with the status and the header subset; its body is read through the bounded reader under min(`maxBytes`, 64 KiB) — independent of `maxResponseBytes`; a non-finite `maxBytes` falls back to the ceiling — and the same deadline, only when its media type is one the option's `contentTypes` names (the policy's accepted types when omitted; an empty list reads no error body at all), otherwise cancelled unread with the headers kept; over the bound the body is dropped whole and `http_error` carries the headers alone — never a truncated body, and a 401's challenge (in the headers, read before the body) survives — with `errorBodyDropped: true` (review-2: present ONLY when a body of an accepted type was over the bound, so "no bytes" is never mistaken for "no body"; absent for a body that was read, for a type that is never read, and without the option); a 3xx stays the redirect rule, a 2xx is untouched; without the option every existing caller sees the B19 behaviour (pinned: a 500 JSON answer is still a success result with its status; the B19 egress and distributor suites pass unchanged) |
| the stream hand-off | `outbound-fetch.ts:118` (`streamBody`), `:319-322`; `sse-reader.ts:131-145` (`discardStream`) | a 2xx answer whose media type is named is returned with `body` (the unread stream, or null) and empty `bytes`; not for a 4xx (the error-body rule), not for another type; the consumer owns the remaining deadline and the cancel — and a stream the consumer does not read is closed by it at once (`discardStream`: best effort, no reader taken; the transport calls it on every refused hand-off, the reader on a pre-aborted read) |
| distributor policies unchanged | `app/lib/distributors/egress.ts:30-41`; `b20-a1-outbound-headers.test.ts` | `DISTRIBUTOR_EGRESS_POLICIES` set neither `errorBody` nor `streamBody` (pinned); a vendor's non-2xx body is still never read into a message |
| the SSE reader | `sse-reader.ts:165-336` | frames parsed as they arrive in the byte domain (LF or CRLF; `:` comments ignored and not counted toward an event; `data:` lines joined with LF; a colon-less `data` line is a data field with an empty value, under CRLF as under LF; `event:` parsed and IGNORED — a message is judged by its JSON-RPC shape, never by its event name; `id:` and `retry:` ignored — no resumability in 2026-07-28; an event ends on a blank line, one without data dispatches nothing, an unterminated final event is never dispatched); each event JSON-parsed as ONE JSON-RPC 2.0 object (`classifyJsonRpcMessage`, `:58-75`: request / notification / response / malformed — a batch, a null or float id, both or neither of result and error, a non-string method are malformed) |
| the reader stops at the response | `sse-reader.ts:256-260` | the response whose id equals `awaitId` (by value AND type) ends the read: the stream is cancelled ("response received") and nothing after it is pulled (proven with a pull-counting stream: two pulls for a notification and the response, then cancel); a response for another id is `sse_foreign_response`; a server-initiated REQUEST is `sse_unexpected_request` at once (servers MUST NOT send them) |
| the reader's bounds | `sse-reader.ts:147-158` (`capOf`, `deadlineOf`), `:179-183`, `:270`, `:295`, `:308`, `:238-239` | per-event bytes (default 256 KiB; an unterminated line counts toward it, so a line that never ends cannot grow; the transport passes the row's `maxResponseBytes`, so a streamed response may be as large as a JSON body), total bytes (default 1 MiB; the transport passes the row's `maxResponseBytes`), event count (default 1 024), notifications kept (default 64; the rest counted in `notificationsDropped`, never buffered), a deadline and the caller's signal. Review-2: a cap that is not a finite number >= 1 (NaN, an infinity, 0, a negative, not a number) IS THE DEFAULT, never "no cap" — `Math.max(1, NaN)` is NaN and `x > NaN` is never true, and the row's value feeds both byte caps; a fractional cap is floored; both byte caps have a hard ceiling of 16 MiB whatever is asked (a row allows 8 MB; the total is judged first, so at the ceiling the refusal is `sse_too_many_bytes`). `deadlineMs`: omitted means none (the caller's choice); GIVEN but not a finite number it is `SSE_DEFAULT_DEADLINE_MS` (30 s, the registry's longest row deadline) — never "no deadline", never the 1 ms a timer makes of NaN; a finite value below 1 is an exhausted budget and settles at once; above the timer's maximum it is that maximum |
| the reader's latch | `sse-reader.ts:174-177`, `:184-190` (the reader taken under a guard), `:205-229`, `:313-334` | the `bounded-stream.ts` discipline: exactly one settlement; a pre-aborted signal never takes a reader (the stream it was handed is still closed, best effort); abort and timeout settle at once with no bytes and a best-effort, never-awaited cancel (proven with the B14.3 `stubbornStream` whose cancel never settles); a late resolution is discarded and a late rejection observed; no message text reaches a sentence; review-3 (R3-5): a stream NO reader can be taken on — already locked by an injected or wrapping transport (production fetch never returns one), or a `getReader()` that throws — settles `sse_unreadable` with no bytes and is closed best effort: `getReader()` ran outside the latch and made the read REJECT |
| one message per POST, the transport owns `_meta` | `http-transport.ts:661-707` (`prepare`), `:232-239` (`isMethodName`) | `jsonrpc: "2.0"`; a plain method name (`isMethodName`: at most 128 characters — the length judged before the pattern —, the method alphabet only, never token-anchored secret-shaped; `sk-` inside a word is not a key); an id that is a non-empty string or an integer (never null, a float, a boolean or absent); object params; a caller `_meta` must be an object and may not carry a reserved key — any prefix with an `mcp` or `modelcontextprotocol` label (`io.modelcontextprotocol/…`, `modelcontextprotocol.io/…`, `dev.mcp/…`, `:530-535`) — or `traceparent` / `tracestate` / `baggage` (A4 adds those deliberately): `reserved_meta`; the transport then sets `io.modelcontextprotocol/protocolVersion` (the same value as the header), `…/clientCapabilities` (`{}` unless A2 declares more) and `…/clientInfo` (`{ name: "sirkit", version }`, the version pinned to package.json); a response shape, a body over 1 MB, an unserialisable message: `invalid_request` |
| the request headers | `http-transport.ts:830-837`, `:524-527` (`encodeMcpNameHeader`) | `Accept: application/json, text/event-stream`; `Content-Type: application/json`; `MCP-Protocol-Version` (the row must list it, else `protocol_version_unsupported`; the compatibility era only on a row with `compatibilityEra`, OD-41); `Mcp-Method`; `Mcp-Name` for tools/call and prompts/get (`params.name`) and resources/read (`params.uri`), as-is when header-safe (0x21–0x7E, space and tab inside, no leading or trailing whitespace) and otherwise as the `=?base64?…?=` sentinel over its UTF-8 — a value that already looks like the sentinel is encoded again; a value over 2 048 characters is refused; `x-mcp-header` mirroring (`Mcp-Param-*`) is A2 |
| admission of the URL by origin AND path (D20-20, wire half) | `http-transport.ts:710-720` (`endpointMatches`), `:838-849` (policy) | the URL is `canonicalUri` and nothing else; its origin (`https`, host and port) and pathname must equal the row's endpoint, with no query, fragment or userinfo — `endpoint_mismatch` before any call (a path, a port, a host that differs, a canonical URI on another port, a non-URL, a query string carrying a secret, userinfo — the last two pinned with the secret asserted absent from the outcome); the egress policy then names `allowedHosts: [endpoint.host]`, the row's `deadlineMs` and `maxResponseBytes`, `maxRedirects` from the row (0), `errorBody` at 64 KiB for `application/json` bodies only and `streamBody` for `text/event-stream`; `acceptContentTypes` is empty because a 202 carries no media type — the transport judges the media type of every 2xx itself (a 200 of a foreign type is read under the row's ceiling and then refused: a stated limit below) |
| no redirect, ever (D20-24, wire) | `http-transport.ts:869-871`; `outbound-fetch.ts:266-287` (the redirect rule) | 301, 302, 303, 307 and 308 are the closed failure `redirect_refused` after exactly one request; the request that carried `Authorization` is never re-sent (asserted on the fake's record) |
| the token | `http-transport.ts:619-639` (providers), `:801-816` | only an injected `tokenProvider` answers (A1 ships `none`, the pre-issued token read from the environment by the NAME the row references at call time — never cached — and the dispatching default; the client-credentials flow answers `token_unavailable` until A3); a token must be an RFC 6750 b64token (`token_malformed`, no call); a token for an auth-`none` row is `token_unexpected` (no call); no token for a row that needs one is `token_unavailable` (the sentence names the VARIABLE); a provider that throws is `token_unavailable` with a fixed sentence; the token travels as `Authorization: Bearer` on EVERY request and nowhere else, and the transport redacts the very token it sent from every server text it surfaces AND from every string leaf AND every object KEY of every result and notification (`redactResult`, `scrubNotification`, `:241-496`: an iterative walk, a `__proto__` key copied as a key; review-2: a key is server text exactly as a leaf is — a key the redaction leaves unchanged always keeps its name, a rewritten key that would equal another name gets a numeric suffix `#2`, `#3`, … in document order, so no entry overwrites another); a scope, an error code, a capability name or a `resource_metadata` URL that carries it is dropped (`:559-570`, `:974`); the server's `Content-Type` never carries it into a sentence (`nameableMediaType`, `:348-357`); pinned over twenty-two answers by `JSON.stringify` — an echo in a `complete` result (text and nested `structuredContent`, leaves and KEYS), an `input_required` result (leaves and a KEY), an SSE notification (a leaf and KEYS) and its response, a `requiredCapabilities` list, a `scope`, an `error` code, a `resource_metadata` path, an `error_description`, a JSON-RPC error message, a text body, a Location, a thrown transport error, a `supported` list, the `Content-Type` alone and as a subtype, and review-3 (R3-2) a notification's METHOD that IS the token (a bearer token is a plain method name), alone and under `notifications/`, on the kept path (redacted) and on the dropped path (the stub names `notifications/unknown`) — each paired with the branch it must reach from a closed breaker, and over the fake's recorded URL |
| the transport's own cut never makes a prefix of a token (review-2) | `http-transport.ts:241-262` (`scrubWindow`, `properPrefixLengthAtEnd`, `withoutSecretPrefixAtEnd`), `:323-346` (`scrubVendorText`) | the scrub reads only a window of the text — 4 x the bound, EXTENDED by the longest redaction subject (the sent token's length; 256 for a secret shape) — redacts over it and only then cuts to 4 x the bound, so a token that starts inside the kept part is whole when it is redacted (pinned: a token ending one before, exactly at and one after the cut, in an error message, an `error_description` and a notification leaf, with no 8-character prefix of it in the outcome); what the window's own END leaves of a later token is removed, because the redactions before it shorten the text and would pull it inside the cut (pinned, and proven by mutation); review-2 also normalised the text (NFC) BEFORE its one comparison, because the inert step applies NFC anyway and NFC turns U+212A KELVIN SIGN into the letter K — a token echoed with that sign would otherwise pass the comparison and become the real token afterwards (pinned, and proven by mutation). Comparing ONLY the NFC form was a regression for a token followed by a combining mark: the comparison is now three passes (next row) |
| the token comparison is three passes, failing closed (review-3, R3-1) | `http-transport.ts:70-75`, `:264-321` (`skeletonOf`, `skeletonCarries`, `disguisesSecret`), `:335-346` (`scrubVendorText`), `:418-434` (`redactResult`) | review-2 compared ONCE, on the NFC form, and NFC fuses a combining mark with the token's last character (e + U+0301, f + U+0307, `=` + U+0338): `includes(token)` was false and all but that character came back readable. Now (1) the RAW window and (2) its NFC form (KELVIN SIGN stays closed) — both redact IN PLACE — and (3) a SKELETON, NFKD without combining marks (`\p{M}`) and format / default-ignorable characters (`\p{Cf}`): a text whose skeleton still holds the token after (1) and (2) — a compatibility spelling (KELVIN, fullwidth, mathematical letters), a mark inside it or fused to its last letter, a zero-width joiner / U+200B / U+2060 / soft hyphen inside it, or any combination — is replaced WHOLE by `[redacted]`. At the end of a CUT window the same holds for a proper prefix of the token in the skeleton, unless it is literally the text's own end: what the cut leaves of a disguised token cannot be cut out by position (and a cut window never ends inside a surrogate pair). ONE predicate, `skeletonCarries`, is the comparison of every channel that DROPS what carries the token — a scope, an error code, a capability name, the stub's method (exact), the media type and the `resource_metadata` URL both as it was written AND as the parser made it (case-folded: the egress path lowercases the one; the URL parser lowercases and compatibility-folds a host and percent-encodes what a disguise is made of); it answers for all three passes at once, since a token is ASCII and the skeleton of a text is the skeleton of its NFC form. A RESULT is not normalised (data for A4): it gets (1) and (3) — a disguised leaf or key is replaced whole, an ASCII text is untouched by (3). Linear: each pass runs once per bounded window; the marks are dropped BEFORE NFKD, which reorders a run of marks quadratically (the skeleton is the same for every code point, checked exhaustively) and expands a character up to 18 x, so a result leaf of any length is read in chunks of 4 096 characters, never ending inside a surrogate pair, with the tail of each skeleton carried into the next (pinned: two million ill-ordered marks under 2 s — 14.6 s with NFKD first —, and every offset around a chunk boundary) |
| the scrub's own work is bounded (review-2) | `http-transport.ts:82-84` (bounds), `:436-490` (`scrubCost`, `scrubNotification`), `:943-946`; `app/lib/agent/redaction.ts:25-32` | the scrub runs the redaction regexes over server text synchronously — no deadline can interrupt it — and the row's `maxResponseBytes` (up to 8 MB) was its only bound. Now: a notification with more than 256 strings (leaves AND keys), or one that would take the call past 262 144 scrubbed characters (each leaf charged up to its window of 4 x 1 000 + 256, each key up to 4 x 128 + 256), is replaced by `{ jsonrpc: "2.0", method: <its method when it is a plain method name that (review-3, R3-2) does not carry the sent token, else "notifications/unknown">, params: { dropped: "too much text" } }` and counted in `notificationsDropped` on the outcome; it is counted BEFORE any regex runs and spends nothing of the budget, so a small notification after it still fits. A `result` is never dropped (it is the answer, data for A4): its token redaction is one split/join pass per leaf and per key, no regex — linear in the body the row's ceiling bounds (pinned: 20 000 leaves and keys under 2 s). The B19 URL-credential pattern is linear on a run of scheme characters (see Evidence) |
| the scrub never mints a structural key (review-3, R3-3) | `http-transport.ts:76-81`, `:361-416` (`uniqueKeys`, `mapStrings`), `:478-490` | the key scrub trims and strips format characters, so a key such as U+200B + `id`, `id ` or ` params` became `id` / `params` on a notification the reader had admitted WITHOUT them — the shape of a server-initiated REQUEST (which the reader refuses as `sse_unexpected_request`) or of a malformed message. At the TOP LEVEL of a notification a key the scrub REWROTE never takes `jsonrpc`, `method`, `id`, `params`, `result` or `error`: the name counts as taken and the key gets the collision suffix (`id#2`); at EVERY depth a rewritten key never becomes `__proto__`, `constructor` or `prototype`; an untouched key keeps its name exactly as before (a raw `__proto__` key is still copied as a key, never as a prototype). A method that scrubs to nothing is `notifications/unknown`. Pinned: every scrubbed notification still classifies as a notification under `classifyJsonRpcMessage`, has no `id` / `result` / `error`, and its `params` is a plain object or absent |
| admission and the in-flight bound | `http-transport.ts:818-825`, `:851-861`; `admission-control.ts:39-45` (`McpRequestOutcome`), `:217-239` (`settle`) | a pre-aborted signal, then `maxConcurrent` (`concurrency_exhausted`: nothing sent, nothing reserved), then `requestMcpAdmission(server, tool for tools/call, 1, now, purpose)` (`admission_refused` with the pause: the server window, the tool window, the breaker, the agent share); `recordMcpOutcome` in `finally` on every path (`breakerOutcome`, `:1002-1034`: a success closes, a 429 opens at once, a 5xx / timeout / network failure / unusable answer — protocol violation, redirect, stream failure, an error body dropped for its size — counts, an egress refusal counts as the distributor path counts it (after `endpointMatches` only the resolver's `dns_failed` / `address_blocked` can reach it, and a half-open trial that never reaches the server keeps the breaker open — pinned), a coherent refusal — 401, 403, a JSON-RPC error, a 400 protocol error, 404 with and without -32601, 405, a 400 with a challenge — is neutral, each neutral kind pinned alone with `failureThreshold + 1` answers in a row; review-2: our own abort is the MCP-only outcome `inconclusive` — it judged no answer of the server's, so as the half-open trial it RE-OPENS the breaker for another cooldown (a neutral trial would have closed it: a server never reached would look healthy) and otherwise changes nothing, no failure counted and no success counted; `recordOutcome` / `distributorJson` are unchanged and do not accept it); the in-flight count is released in `finally` |
| the answer (D20-16) | `http-transport.ts:863-951` (`interpretExchange`), `:953-999` (`interpretStatus`), `:726-743` (`interpretResponse`) | the table below; every server text the transport surfaces ITSELF — error messages, `error_description`, every string leaf of a notification (bounded to 1 000 code points each, the method included) and every KEY of one (bounded to 128; a key that scrubs to nothing becomes `(key)`; the collision rule above) — passes `scrubVendorText` (`:323-346`: the sent token and secret-shaped substrings redacted by `sanitizeTraceText`, control and format characters inert and the length bounded by `inertExternalText`); the server's `Content-Type` is server text too: the `unexpected_content_type` sentence names it only when it is a plain media type of at most 64 + 64 characters (`MEDIA_TYPE_PATTERN`, `:111`) that neither carries the sent token (compared case-folded: the egress path lowercases the header) nor is secret-shaped, and says "an unrecognised media type" otherwise; a `result` is DATA for A4's normaliser with the sent token redacted from every string leaf and key and nothing else touched (content bounding and inert-scrubbing of `content[]` is A4's, recorded); JSON-RPC `error.data` is not surfaced except the two bounded lists a 400 may carry — `requiredCapabilities` as capability NAMES only (`[A-Za-z0-9_./-]{1,128}`, no token-anchored secret shape, never the sent token; free text, a control or bidi character, a space are dropped) and `supported` as `YYYY-MM-DD` strings |
| SSE answers (D20-17) | `http-transport.ts:927-948`, `:786-793` (`remainingMs`) | a 200 `text/event-stream` is read by `readSseJsonRpc` with `awaitId` = the request id, the row's `maxResponseBytes` as BOTH the per-event and the total cap (a 300 KB response is `complete` streamed exactly as it is as JSON; a row's ceiling still refuses it as `stream_failed`) and the REMAINING deadline (pinned with a stepping clock: 9.5 s gone of 10 s, the held stream settles within 3 s real time, never the whole deadline restarted), clamped to [1, the row's deadline] (review-2: a wall clock that steps BACKWARDS by 60 s — or answers no number — never lengthens the read; pinned on a 1 s row); the response is interpreted exactly as a JSON one (resultType, id, error); the notifications seen before it are returned with the outcome, each string leaf and key inert, bounded and token-redacted, under the bounds of the scrub's work above; review-3 (R3-5): the read is guarded at its call site too (`:929-936`) — whatever rejects in it is `stream_failed` / `sse_unreadable`, and the stream is discarded best effort |
| unread hand-offs closed; a bodiless 202 probed | `http-transport.ts:888-917` | only `text/event-stream` is ever handed off unread. One the transport does not read — a 200 to a notification, a 201/206 to a request, a 202 that carries a byte — is refused AND its stream cancelled at once (`unexpected_status` / `protocol_violation`, one cancel asserted for each), since the egress deadline no longer covers a handed-off stream; an answer of any other type was read by the egress path under the row's ceiling and leaves no stream to close. A 202 with a null stream is accepted as bodiless; review-2: on the wire a bodiless 202 is a NON-null stream that ends at once, so a handed-off 202 stream is PROBED (`readBoundedStream` with a budget of no byte at all, under the remaining deadline and at most 1 s): ended with zero bytes it is `accepted`; any byte, or a stream that does not end within the probe, is `protocol_violation` and the stream is cancelled; a caller abort during the probe is `aborted`, a read failure `network_error`; review-3: each branch is pinned alone (R3-4: the probe under what REMAINS of the deadline — 9.9 s of 10 s gone, refused after about 100 ms and never after the row's deadline; an abort BETWEEN the hand-off and the probe, the one case where the probe takes no reader, still closes the stream exactly once; an abort DURING the probe is `aborted` and inconclusive for the breaker; a read that fails is `network_error` with status 202) and the probe call is guarded (R3-5, `:898-904`): a body that is already locked makes the shared reader reject — `network_error`, status 202, a best-effort discard |
| cancellation | `http-transport.ts` (the caller's `signal` on `outboundFetch`, on the reader and on the 202 probe) | the caller's abort aborts the fetch (before the answer) or cancels the stream (during an SSE answer): `aborted`; closing the stream IS the cancellation signal on HTTP — no `notifications/cancelled` is sent (pinned: one message on the wire); a pre-aborted signal sends nothing |
| attribution for A4 | `http-transport.ts:768-785`, `:232-239` | every outcome carries `serverId`, `protocolVersion`, `method`, `elapsedMs` (the injected clock's delta, pinned at 123 ms; never negative), `requestBytes` and `responseBytes`; `unauthorized` / `forbidden` / `error` carry `httpStatus`; `complete` / `input_required` carry `notifications` and `notificationsDropped`; `method` is the VALIDATED name (`isMethodName`, the one rule `prepare` refuses by) or empty — a refused method is never echoed, on any pre-flight refusal including the two made before the method is judged, so no field of an outcome is the caller's raw string (pinned: 5 000 000 characters, 129 characters, a control character, a bidi override, a secret shape in a sentence, as a plain name and as a segment, a non-string — each outcome under 1 000 serialised characters and nothing sent; a refusal made after the method was judged still names it); `protocolVersion` likewise is a well-formed revision date or empty (`:772-775`) |
| hygiene | `b20-a1-http-transport.test.ts` (source tripwire and console spies) | neither module contains `console.`; no header, token or URL with credentials appears in any sentence or result; `mcpPost` never throws (review-3: enforced, next row) |
| `mcpPost` never rejects (review-3, R3-5) | `http-transport.ts:747-766` (`mcpPost`, the last resort), `:854-857`, `:898-904`, `:929-936`; `sse-reader.ts:160-163` (`sseUnreadable`), `:184-190` | the page and the docstring said "never throws", but the 202 probe awaited `readBoundedStream` with no catch (`app/lib/http/bounded-stream.ts` takes its reader outside its `try`; shared B14/B19 code, NOT changed) and the SSE reader took its reader outside the latch: a handed-off body that is already locked — an injected or wrapping transport; production fetch never returns one — made `mcpPost` REJECT. Now the probe call and the SSE read are guarded at their call sites (`network_error` with status 202 and a best-effort discard; `stream_failed` / `sse_unreadable`), the reader itself settles `sse_unreadable`, the admitted exchange has a catch — closed `network_error` with a FIXED sentence, never the thrown text, the attribution kept, ONE breaker failure recorded by the `finally` — and the whole call has a last resort for a throw before admission or while the outcome itself is built (the same closed code, nothing recorded, nothing sent). Pinned with a locked 202 body, a locked 200 event stream, a signal whose listener registration throws once the answer is in, a response whose body getter throws on three answer shapes, and a clock that throws: each resolves, the in-flight count returns to 0, and three such calls — not two — open the breaker |

### Closed outcomes

Typed, non-closed kinds: `accepted` (202 with no body to a notification — a null stream, or review-2 a handed-off
stream the probe saw end with zero bytes), `complete` (`resultType: "complete"`; absent only in the legacy era),
`input_required` (MRTR: handed back untouched, never retried or fulfilled — A2/A4 refuse it) — both with `notifications`
and review-2 `notificationsDropped` (how many of them are the stub of one that carried too much text to scrub; 0 for a
JSON answer; review-3: each notification in an outcome still classifies as a notification — no structural key minted by
the scrub, a method never empty, a stub's method never the sent token),
`error` (a JSON-RPC error object: integer `code`, bounded inert `message`, `httpStatus`), `unauthorized` (401 — or a
400 that carries a Bearer challenge and no JSON-RPC error: RFC 6750 `invalid_request`, the credential's problem, never
`legacy_or_unknown` for the era probe; `httpStatus` says which) and `forbidden` (403) with the parsed Bearer `challenge`
(`scheme`; `resourceMetadata` only when https, credential-free, fragment-free, not a blocked name or address and not
carrying the sent token — RECORDED for A3, never fetched here; `scope` as validated tokens, at most 32, never the sent
token; `error` as a token, never the sent token; `errorDescription` scrubbed and bounded to 200; null when the header
carries no Bearer challenge).

| `closed` code | when | HTTP status carried | breaker |
|---|---|---|---|
| `invalid_request` | the message is not one JSON-RPC 2.0 request or notification (see `prepare`) — a method that is not a plain method name (over 128 characters, outside the method alphabet, secret-shaped) among them, never echoed in the outcome; a name too long for `Mcp-Name`; a body over 1 MB | — (nothing sent) | not recorded |
| `reserved_meta` | a caller `_meta` key with a reserved prefix or a trace key | — | not recorded |
| `protocol_version_unsupported` | the requested version is not one the row lists, or the legacy era on a row without it | — | not recorded |
| `endpoint_mismatch` | the canonical URI's origin or path is not the row's endpoint | — | not recorded |
| `token_unavailable` / `token_malformed` / `token_unexpected` | no token where one is due; not a b64token; a token for an auth-`none` row | — | not recorded |
| `concurrency_exhausted` | `limits.maxConcurrent` requests already in flight | — | not recorded (nothing reserved) |
| `admission_refused` (+ `pause`) | the server or tool window, the breaker or the agent share refuses | — | not recorded (nothing reserved) |
| `egress_refused` (+ `egressCode`) | the egress boundary refused before sending — after `endpointMatches` only the resolver's `dns_failed` and `address_blocked` can occur (`url_invalid`, `scheme_not_https`, `url_credentials`, `host_not_allowed` are excluded by the endpoint check) | — | failure (as `distributorJson` counts it; a half-open trial that fails here keeps the breaker open) |
| `redirect_refused` | any 3xx (D20-24) | 301/302/303/307/308 | failure |
| `timeout` | no complete answer, or no response on the stream, within the row's deadline | — | failure |
| `aborted` | the caller's signal, before or during the answer (the 202 probe included) | — | review-2: `inconclusive` (was neutral) — as the half-open trial it re-opens the breaker for another cooldown, otherwise nothing is counted either way; a pre-aborted signal is not recorded at all (nothing was admitted) |
| `network_error` | the request or the body read failed (review-2: a read failure of the 202 probe included; review-3: a 202 body no reader can be taken on, and — with a fixed sentence, never the thrown text — an exchange that throws where nothing expects it) | — / 202 | failure (the last resort BEFORE admission records nothing: nothing was admitted) |
| `response_too_large` | a 200 body over `maxResponseBytes`; review-2: a 400, 404 or 405 whose `application/json` error body was over 64 KiB and dropped by the egress path (`errorBodyDropped`) — it may have been a modern server's -32020 / -32021 / -32022 or -32601, so it is never `legacy_or_unknown` (on a 404 or 405 with or without a challenge; a 400 that carries a Bearer challenge is still `unauthorized`, and a 401 / 403 / 429 / 5xx is judged from its status and headers exactly as before) | the status | failure |
| `unexpected_content_type` | a 200 that is neither `application/json` nor `text/event-stream`; review-2: the sentence names the received media type only when it is a plain bounded one that neither carries the sent token nor is secret-shaped — otherwise "an unrecognised media type" (or "no content type") | 200 | failure |
| `protocol_violation` | a 202 with a body — bytes the egress path read, or review-2 a handed-off stream on which the probe saw a byte or no end within min(1 s, the remaining deadline); the stream is cancelled (a null stream, and a stream that ends with zero bytes, are no body: `accepted`); not one JSON-RPC 2.0 object; another request's id; a result that is not an object; `resultType` absent (current era) or unrecognised; an error without an integer code | 200 / 202 | failure |
| `header_mismatch` | 400 with -32020 | 400 | neutral |
| `missing_client_capability` (+ `requiredCapabilities`, at most 32 capability names of at most 128) | 400 with -32021 | 400 | neutral |
| `unsupported_protocol_version` (+ `supported`, at most 16 `YYYY-MM-DD` strings) | 400 with -32022 | 400 | neutral |
| `legacy_or_unknown` | a 400 whose body is empty, not JSON, not `application/json` or not a JSON-RPC error AND that carries no Bearer challenge (with one it is `unauthorized`); a 404 without -32601; every 405 — A2's era probe consumes it; review-2: NEVER when the error body was dropped for its size (that is `response_too_large`): an unread body proves nothing about the revision | 400 / 404 / 405 | neutral |
| `method_not_found` | 404 with -32601 | 404 | neutral |
| `rate_limited` (+ `retryAfterSeconds`) | 429; `Retry-After` only as an integer 0..86 400 (a date form is dropped) | 429 | rate_limited (opens at once) |
| `server_error` (+ `retryAfterSeconds`) | 500..599 | the status | failure |
| `unexpected_status` | any other status (a 200 to a notification, a 202 to a request, 1xx, 204, 3xx that is not a redirect, 4xx not listed); a stream on such an answer is closed | the status | failure |
| `stream_failed` (+ `sseCode`) | the SSE reader refused: `sse_malformed`, `sse_unexpected_request`, `sse_foreign_response`, `sse_event_too_large` (at the row's `maxResponseBytes`, the same ceiling a JSON body has), `sse_too_many_bytes`, `sse_too_many_events`, `sse_unreadable` (a read that fails; review-3: a stream no reader can be taken on, or a read that rejects), `sse_ended_without_response` (its `sse_timeout` and `sse_aborted` are the `timeout` and `aborted` rows) | 200 | failure |

A 400 carrying any other JSON-RPC error object (a -32602 for a missing `_meta`, say) is the typed `error` kind with
`httpStatus: 400`. On the egress path itself the new closed code is `http_error` (a 400..599 under `errorBody`), which
`mcpPost` consumes; an error body of a type the option does not name, or over its bound, leaves `http_error` with the
headers alone (no `bytes`) — and review-2 `errorBodyDropped: true` in the second case only; no other outbound code changed.

Behaviour changes of review-2 (2026-09-19), each recorded in its row above: a wire-level bodiless 202 typed
`text/event-stream` is probed and `accepted` (was `protocol_violation`: three such notifications opened the breaker); a
400 / 404 / 405 whose JSON error body was dropped for its size is `response_too_large`, a breaker failure (was
`legacy_or_unknown`, neutral); `aborted` is `inconclusive` for the breaker (was neutral, which closed an open breaker);
`complete` and `input_required` carry `notificationsDropped`, and a notification over the bounds of the scrub's work is a
stub (was scrubbed whatever its size); object KEYS of results and notifications are redacted / scrubbed (were copied
verbatim); the `unexpected_content_type` sentence names only a plain media type (was the raw header value); the SSE read's
remaining deadline is clamped to the row's (a clock stepping backwards lengthened it); the reader's caps fall back to their
defaults and have a ceiling (NaN and Infinity were no cap; 0 and a negative were 1); a token that straddles the scrub's
cut is redacted whole (a 26-character prefix survived); the text is NFC-normalised before the token comparison.

Behaviour changes of review-3 (2026-09-20), each recorded in its row above: a token echoed whole with ONE combining mark
after it is redacted again (review-2's single comparison on the NFC form let all but its last character through — a
regression of that round); a sentence, a notification leaf or key, a result leaf or key whose SKELETON holds the token —
a compatibility spelling, a mark or a format character inside it — is replaced WHOLE by `[redacted]` (was returned as
sent, or with the format character as a space), and a scope, an error code, a capability name, a media type or a
`resource_metadata` URL is dropped by the same comparison (a URL whose host the parser folds to the token, in any case,
included); the stub of a dropped notification names `notifications/unknown` when its method carries the sent token (was
the token itself); a key the scrub rewrites gets the collision suffix instead of a structural name at the top level of a
notification, or of `__proto__` / `constructor` / `prototype` anywhere (was `id`, `params`, …), and a method that scrubs
to nothing is `notifications/unknown` (was the empty string: a malformed message); a locked 202 body is `network_error`
with status 202, a locked event stream `stream_failed` / `sse_unreadable`, an exchange that throws `network_error` with a
fixed sentence (each was a REJECTION of `mcpPost`), and `readSseJsonRpc` settles `sse_unreadable` for a stream no reader
can be taken on (was a rejection). R3-4 changes no behaviour (test strength).

### Evidence

- `app/lib/net/__tests__/b20-a1-outbound-headers.test.ts` — 20 cases: the allowlisted subset lowercased and frozen;
  set-cookie / authorization / proxy-authenticate / cookie and every other name never surfaced; the count bound (20
  `mcp-*` → 16 kept, 5 counted); the byte bound (2 049 bytes dropped whole, 2 048 kept, 1 100 two-byte characters
  dropped: bytes, not characters); unchanged without the options (a 500 JSON answer is a success with its status, a
  401 of the wrong type is `unexpected_content_type` without headers or bytes, a 302 is refused before any pull);
  `errorBody` (a 400 JSON body on `http_error` with headers; a 401 `text/html` body cancelled unread with headers;
  400..599 only — 302, 200, 399, 600 are not; the bound is min(`maxBytes`, 64 KiB) and independent of `maxResponseBytes`,
  over it `http_error` with the headers and no `bytes`, for NaN and Infinity too; a 401 over the bound keeps its
  challenge; `errorBody.contentTypes` reads JSON only under an accept-anything policy with zero pulls of a `text/html`
  body, an empty list reads none; the shared deadline with a never-ending body; no body or header value in the
  sentence; review-2: `errorBodyDropped` is true exactly when a body of an accepted type was over the bound — 1 025 bytes
  under a bound of 1 024, and 65 537 under a NaN bound — and absent for a body read whole at the bound, for a `text/html`
  body that is never read, under an empty `contentTypes` list, without the option and on a success); `streamBody` (unread
  hand-off with zero pulls; not another type; not a 4xx; a null body); the distributor policies set neither option.
  Failing-first on the unchanged tree: 14 of 17 failed (the three pinned-unchanged cases passed).
- `app/lib/net/__tests__/b20-a1-sse-reader.test.ts` — 28 cases: keep-alive comments; CRLF and LF (both reads asserted
  in full with their byte counts, on one-line and multi-line events); review-2: the CR strip pinned on the FIELD NAME,
  the one place it is observable — a colon-less `data` line alone dispatches an empty, malformed event under CRLF exactly
  as under LF, a colon-less unknown field dispatches nothing, and inside an event the empty value is one more LF (a CR
  left on a data VALUE stays invisible: it is JSON whitespace wherever a line can end, and a raw CR or LF inside a string
  literal is malformed either way); multi-line data joined with exactly LF (a JSON
  string literal split across two `data:` lines is malformed), `event:`, `id:` and `retry:`; data-less events; frames split inside a line and inside a multi-byte character;
  notifications in order; the response stops the reader (two pulls, one cancel with the reason "response received");
  a foreign id (by value and type); a stream ending without the response and an unterminated final event; the
  `stubbornStream` settling at the deadline with no bytes and exactly one settlement despite a late chunk and a late
  rejection; abort mid-stream and a pre-aborted signal that never takes a reader yet closes a real stream it was
  handed (one cancel, zero pulls); the per-event cap (an event, and an unterminated line); the total cap; the event-count cap; the notification cap with the count of the rest; a read
  failure; review-2: NaN, Infinity, -1 and 0 for `maxEventBytes` (alone, and when the same value feeds both byte caps as
  the transport feeds them), `maxTotalBytes`, `maxEvents` and `maxNotifications`, each against a line, keep-alives or
  events that never stop — refused at the DEFAULT, asserted by the bytes and events consumed; the 16 MiB ceiling against
  two caps of 10^12; a fractional cap floored; `deadlineMs` NaN and both infinities read a 60 ms answer and, under fake
  timers, settle a held stream at exactly 30 000 ms; 0, -1 and 0.5 settle at once; malformed JSON and non-objects;
  non-JSON-RPC shapes; a server-initiated request; an error response for the awaited id; a string id; review-3: a stream no reader
  can be taken on — already locked (zero pulls), or a `getReader()` that throws (closed once, best effort) — settling
  `sse_unreadable` with no bytes instead of rejecting. Failing-first: the
  module did not exist (the suite failed to import).
- `app/lib/mcp/__tests__/b20-a1-http-transport.test.ts` — 70 cases against the scripted fake server: the request on the
  wire (URL, POST, manual redirects, the four headers, the transport-owned `_meta`, the byte counts); the clientInfo
  version pinned to package.json; header/_meta version equality and the row's version list; `Mcp-Name` per method and
  its sentinel encoding (non-ASCII, leading/trailing whitespace, a control character, a value that looks like the
  sentinel; the body keeps the raw name; a name too long refused); a caller `_meta` kept and twelve forged keys refused
  without a call; the capabilities option; ids (string, integer; null, float, boolean, absent, an object, empty
  refused; a wrong `jsonrpc`, an empty method, a response shape, array params refused); endpoint mismatch by path,
  port, host and canonical URI, a non-URL, a query string carrying a secret and userinfo (the secret absent from the
  outcome), with no call; the egress wall (a private address, a failed lookup);
  D20-24 for all five redirect statuses with `Authorization` sent once; the token (none; Bearer on every request
  including a notification, read at call time; unset, control character, space, empty, quoted, non-ASCII, `Bearer `-
  prefixed refused before any call; a provider offering a token to an auth-`none` row; a refusing and a throwing
  provider; the token absent from twenty-two answers (review-3 added four), each paired with the branch it reaches — an echo in a result, an
  `input_required` result, an SSE notification, a capability list, a scope, an error code, a metadata URL and review-2
  the KEYS of a nested `structuredContent`, of an `input_required` result and of a notification, and the `Content-Type`
  alone and as a subtype among them; review-2: the key collision rule and `__proto__` as a key; the media-type sentence
  (two plain types named, no content type, ten hostile values — 100 000 characters, 65 characters of type, ESC, a C1
  control, two slashes, none, an empty subtype, a secret shape, the token as a subtype and alone — each "an unrecognised
  media type" in a sentence under 300 characters, and a token with capitals against the lowercased header); a token ending
  one before, exactly at and one after the scrub's cut in three channels, and one cut by the END of the extended window
  with twenty redactions before it; a token echoed with KELVIN SIGN for its K);
  admission (the tool window then the server window; the agent share; three server errors and a single 429 open the
  breaker, a success closes it; a half-open trial whose name fails to resolve keeps it open; review-2: a caller abort as
  the half-open trial re-opens the breaker for another cooldown with no further network call, and on a closed breaker
  neither resets two counted failures nor adds a third, nor opens it alone four times in a row; ten coherent refusal kinds
  each pinned alone with four answers in a row; `maxConcurrent` with two in-flight calls, the third refused with nothing reserved, the
  count back to 0 and a freed slot admitting the next; the count released after a transport failure); the answers
  (202 with and without a body, 200 to a notification; a 2xx `text/event-stream` the transport does not read — 200
  and 202 to a notification, 201 and 206 to a request — refused AND cancelled, a bodiless 202 of that type accepted;
  review-2: a wire-level bodiless 202 of that type — an empty NON-null stream — accepted four times in a row with one
  call each and counted as a success, one byte on such a stream and a stream that never ends refused as
  `protocol_violation` and cancelled, the second within 3 s on a 10 s row; a 400 (-32022, -32020), a 404 and a 405 whose
  JSON body is 70 000 characters as `response_too_large` three times in a row opening the breaker, the same 400 with a
  Bearer challenge still `unauthorized`, a 70 000-character `text/html` 404 still `legacy_or_unknown`, a 60 000-character
  -32601 still `method_not_found`;
  complete; `resultType` absent in both eras and five bad values;
  `input_required` handed back once; a JSON-RPC error with a hostile message scrubbed and bounded, a non-integer code,
  a message-less error; eleven non-response bodies; `text/html` and no content type; SSE with a keep-alive, a
  notification and the response cancelled at the response, a server request on the stream, a resultType-less SSE
  response, `input_required` and an error on the stream, an empty stream; SSE notifications with hostile text (ESC,
  a bidi override, a secret shape, the token, 5 000 characters) inert, bounded and token-free with numbers and structure
  kept; review-2: notification KEYS — a bidi + ESC + 100 000-character key bounded to 128, a secret-shaped key, the token
  in a key, three keys that scrub to nothing as `(key)`, `(key)#3`, `(key)#4` beside an unchanged `(key)#2`; the bounds of
  the scrub's work — 256 strings and keys kept, 257 and a hostile-method 300 replaced by the stub (`notifications/unknown`
  for the second), 40 notifications of 8 045 characters of which 32 fit the call's 262 144 and 8 are stubs while a small
  one after them still fits, 200 leaves of 4 000 quadratic characters dropped in under 2 s, `notificationsDropped: 0` on
  JSON answers; a result of 20 000 leaves and keys redacted whole in under 2 s;
  a 300 KB response event `complete` streamed as it is as JSON and refused at a smaller row ceiling; 400 with
  -32020, -32021 bounded to 32 capability names (hostile entries — control and bidi characters, a secret shape, a
  space, the token — dropped), -32022 bounded to 16 validated versions and with no data, six unparseable forms, another
  JSON-RPC error, a Bearer challenge on a 400 as `unauthorized` (a JSON-RPC error still winning);
  401 with a full challenge and with none, a Basic challenge, seven rejected `resource_metadata` URLs, the scope and
  description bounds, a Digest-then-Bearer header; 403; 404 with and without -32601; 405; 429 with five `Retry-After`
  forms; 503 and 500; 204, 304, 418, 451; a `text/html` 503 body cancelled with zero pulls and a 401 whose JSON body is
  over 64 KiB keeping its challenge; an oversized 200; a thrown transport; an `http:` canonical URI); the row's
  deadline against a hung transport and against an SSE stream held open with keep-alives (cancelled once); the clock
  (`elapsedMs` = the injected delta; the SSE read under the REMAINING deadline with a stepping clock; review-2: a clock
  stepping BACKWARDS by 60 s on a 1 s row settling within 4 s);
  cancellation mid-SSE (one cancel, one message on the wire, the count released) and pre-aborted; an abort during the
  request aborting the fetch's signal; the source tripwire for `console.` and the console spies; the attribution fields
  on every outcome; review-2: this page's and the README's case counts equal to the `it(` cases of the four suites
  (reading only); and the attribution's `method` as the validated plain name or empty (eight hostile methods on four
  refusal shapes never echoed, nothing sent; a name at the 128 bound and `sk-` inside a word sent and named; a refusal
  made after the method was judged still naming it) and its `protocolVersion` as a well-formed revision date or empty
  (seven hostile options never echoed, nothing sent); review-3: the four R3-2 rows of the token table (a notification's
  METHOD that is the token, alone and under `notifications/`, kept and dropped); fourteen DISGUISES — a letter-ending
  token + U+0301 and + U+0307, a `=`-ending token + U+0338, a digit-ending token + U+0301, the last letter precomposed,
  KELVIN SIGN, KELVIN with a trailing mark, a mark inside, a letter inside precomposed, a zero-width joiner, U+200B,
  U+2060 and a soft hyphen inside, a fullwidth spelling — through nine channels (error.message, `error_description`, the
  challenge's scope / error / `resource_metadata` path, the `resource_metadata` host, capability names, the media-type
  sentence, a notification leaf and key, a `complete` and an `input_required` result leaf and key), each paired with the
  branch it must reach, by ONE criterion: no 8-character window of the token in the SKELETON of the serialised outcome (so
  a disguised survivor fails it too), with header values outside Latin-1 fed through a `Map` (a `Headers` object refuses
  them, a wrapping transport need not); where each pass acts (passes 1 and 2 redact in place, pass 3 whole) and a shouted
  host against a token with capitals; a disguised token cut by the END of the window — 400 zero-width joiners, and
  mathematical monospace with the window's end inside a surrogate pair — while a plain non-ASCII text that ends in the
  token's first letter is kept; the skeleton pass over a result — two million ill-ordered marks (4 MB) under 2 s, and every
  offset around a chunk boundary in two spellings; the minted keys (`id#2`, `id#3`, `params#2`, `result#2`, `error#2`,
  `method#2`, `jsonrpc#2`; `__proto__#2`, `constructor#2`, `prototype#2` below the top level, where `id` and `params` are
  kept; an untouched `__proto__` key; a method of U+200B) with every scrubbed notification classified by
  `classifyJsonRpcMessage`; the four probe branches (R3-4); a locked 202 body and a locked 200 event stream; a signal whose
  listener registration throws; a body getter that throws on three answer shapes and a clock that throws.
  Failing-first: the module did not exist (the suite failed to import).
- `app/lib/mcp/__tests__/b20-a1-redaction-linear.test.ts` — 4 cases (review-2) on the URL-credential pattern of
  `app/lib/agent/redaction.ts`: twenty rows (the scheme at the start of the text, after a space, a quote, a parenthesis,
  a colon, inside a word, compound, after a hyphen, after a digit and a dot, mixed case, an @ and a slash in the
  password, an empty user, token-only userinfo, two URLs, after a line break and a tab, after a non-ASCII letter, no
  credentials, an @ in a path, no letter before the separator) redacted exactly as the B19 pattern — kept verbatim in the
  suite as the reference — through `sanitizeTraceText`, `sanitizeModelBoundText` and both classifiers; a generated corpus
  of 1 875 texts (25 prefixes x 5 schemes x 5 userinfos x 3 rests): 1 500 identical to B19, 375 that differ only where
  the first letter of the run follows a digit of the run or an underscore — there the new pattern redacts MORE (B19
  started later in the run, or left the credential in place: `9https://u:pw@h`, `x_https://u:pw@h`), never less, with the
  same end; 200 scrubs of a 4 000-character "a." leaf under 2 000 ms; one 100 000-character text of each of seven run
  shapes classified and redacted under 1 000 ms, and a credential at the end of a 100 000-character run still one redaction.
- Review fixes (four-lens review, 2026-09-17), each test-first on the reviewed tree: 14 of 83 cases failed before the
  fixes (three egress cases: the over-bound error body, the over-bound 401, `errorBody.contentTypes`; one reader case:
  the pre-aborted hand-off; ten transport cases: the token echoes, the half-open trial, the per-kind neutral table,
  the unread hand-offs, notification scrubbing, the streamed event bound, capability names, the 400 challenge, the
  `httpStatus` on 401/403, error bodies as JSON only) and 83/83 pass after. Test-strength findings proven by mutation
  on the fixed tree and the source restored by hash: no CR strip (the CRLF case fails), `join("")` (the split literal
  case fails), `method_not_found` counted as a failure (the per-kind table fails on its fourth answer), the whole
  deadline restarted at the SSE hand-off (the clock case times out at 4 s), `endpointMatches` reduced to origin and
  pathname (the query-string row fails), admission always refusing (the token table fails on its first answer instead
  of passing vacuously).
- Review fix (adversarial review, 2026-09-19, finding regressions-5, low), test-first on the reviewed tree: the
  attribution's `method` was the caller's raw string on every pre-flight refusal — unbounded and unscrubbed, although A4's
  trace reads it. The new case failed before the fix with 36 rows (1 of 44): a 5 000 000-character method in an outcome of
  5 000 256 serialised characters; a 129-character method, a control character, a bidi override and a secret shape in a
  sentence echoed on all four refusal shapes (a request, a notification, and the two refusals made before the method is
  judged — a wrong `jsonrpc`, a response shape); a `sk-`-shaped plain name, alone and as a segment, SENT to the server and
  answered `complete`. After the fix — `isMethodName` as the one rule `prepare` refuses by and the attribution names a
  method by: bounded at 128 with the length judged first, the method alphabet, never token-anchored secret-shaped — 44/44
  and 84/84 over the three suites.
- Review fixes (review-2, 2026-09-19: the ten residual findings of four independent checkers, R2-A..R2-K), each
  test-first on the reviewed tree: 19 of 106 cases failed before the fixes — the token table on its first KEY row
  (`fake-…` as a key of `structuredContent`), the key collision rule, the media-type sentence, the straddling token
  (`x fake-mcp-token-a1b2c3d4e5f` in an error message: the token one character past the cut), the aborted half-open trial
  (`server_error` from the network where `admission_refused` was due: the breaker had closed), the wire-level bodiless 202
  (`protocol_violation`), the dropped error body (`legacy_or_unknown`), notification keys and the bounds of the scrub's
  work (`notificationsDropped` absent), the large result (keys unredacted), the backwards clock (the case timed out at 6 s:
  the read had 61 s), `errorBodyDropped` absent, the five reader-option cases (NaN `maxEventBytes` refused by the total cap
  at 1 MiB; NaN `maxTotalBytes` and `maxEvents` never refused — `sse_timeout` after 2 MiB and 1 100 events), the corpus
  (`9https://u:SENTINELPW@…` unredacted by B19) and the 100 000-character text (6 271 ms) — and 106/106 pass after; with
  the two cases added afterwards (KELVIN SIGN; the case counts of this page) 108/108. R2-K is test strength only (the case
  passes on the reviewed tree) and is proven by the named mutation, with four more, on the fixed tree with the sources
  restored by hash: the whole line decoded instead of the CR-stripped slice (the colon-less case fails on its CRLF row
  only: the read sails on to the response), the caps as they were (`Math.max(1, value ?? default)`: three cases fail), a
  NaN deadline reaching the timer (one case), no removal of the token prefix at the window's end (the straddling case
  fails on its last row: `fake-mcp` in the outcome), no NFC before the comparison (the KELVIN case fails) — 7 of 83 fail,
  exactly those. Measured (this machine, `tsx`, one process): 200 scrubs of a 4 000-character "a." leaf 1 371 ms before,
  24 ms after (85 times under the 2 000 ms pin); `sanitizeTraceText` over 100 000 characters of "a." 3 184 ms before, 1.4 ms
  after. RESIDUAL, recorded: the same pattern is still quadratic on a token with many scheme separators and no `@`
  ("a://a://…": every `scheme://` scans to the end of the token) — 100 000 characters 1 894 ms before, 1 662 ms after;
  making it linear changes what is redacted (a password containing `://`), so it is left to B19's owner; on the MCP path
  the bounds of the scrub's work cap it at the call's budget — 61 leaf windows, 210 ms measured. B19 follow-ups, recorded
  and not changed here: `distributorJson` records a caller abort as `neutral` (`app/lib/distributors/egress.ts:74`), so an
  aborted half-open trial closes a distributor's breaker exactly as it closed an MCP server's before this round;
  `sanitizeModelBoundText`'s control-character pattern is quadratic on a long run of spaces (100 000 spaces: 6 156 ms) —
  the transport does not use it.
- Review fixes (review-3, 2026-09-20: five findings of the independent checkers, R3-1..R3-5), each test-first on the
  reviewed tree: 9 of the 96 cases of the two changed suites failed before the fixes — the token table on its first
  dropped-METHOD row (`notifications[0].method` was the token); the disguise matrix with 141 problems (`fake-mcp` in the
  outcome through error.message, `error_description` and a notification for a token + U+0301 / U+0307 / U+0338 — the
  regression — and for every format character, mark inside and fullwidth spelling; through a result also for KELVIN SIGN;
  the `resource_metadata` URL kept with the disguise percent-encoded or folded into its host); the disguised token at the
  window's end; the result leaf behind the marks (returned as sent); the minted keys (`{ kind: "malformed" }` under
  `classifyJsonRpcMessage`); the locked bodies (`TypeError: Invalid state: ReadableStream is locked`, a rejection of
  `mcpPost` and of `readSseJsonRpc`); the throwing signal and the throwing body getter (the thrown `Error` itself) — and
  96/96 pass after, 120/120 over the four suites. R3-4 is test strength only (its four cases pass on the reviewed tree) and
  is proven by the four named mutations; with them, 34 mutations on the fixed tree, each run through both suites and the
  sources restored by sha256 after each, and EVERY one fails at least the case that names it: the probe under its own 1 s
  (the remaining-deadline case), no `discard()` after a failed probe (the abort between hand-off and probe: 0 cancels), no
  `aborted` branch, no `unreadable` branch; no pass 1, no pass 2 (the in-place assertions), no pass 3 in the scrub, none on
  a result, a skeleton without NFKD, one that keeps format characters, one that keeps marks (caught only by a mark INSIDE
  the token: two rows added for it), no rule for the end of a cut window, a window ending inside a surrogate pair, a plain
  end redacted whole, no carry between chunks, a chunk ending inside a surrogate pair, NFKD before the marks are dropped
  (14 638 ms where 2 000 is the pin), the metadata URL compared without case folding and as the parser made it only; the
  stub's method not compared; no reserved names, structural names reserved at every depth, an empty method kept; the probe
  call, the SSE call site and the reader's `getReader()` unguarded, no catch around the admitted exchange, no last resort,
  a last resort that records a second failure (the breaker opens after two calls); and five of the earlier rounds'
  comparisons now made by the one predicate (the media type's case folding, a scope, an error code, a capability name, the
  removal of a token prefix at the window's end) — still pinned. Measured (this machine, `node`, one process): NFKD over
  100 000 ill-ordered combining marks 2.6 s to 17 s, 8 ms with the marks dropped first; over 61 scrub windows of 4 256
  such characters (one call's budget) the skeleton pass costs 7 ms (577 ms with NFKD first).
- Lead follow-ups on the round-3 checker's two residual low items (2 cases failed first; the four suites are 122/122 after): a clock that throws or answers no number AFTER the call was admitted no longer skips the breaker record or replaces the call's outcome (every later read falls back to the last good tick; the first read and the admission read stay raw, so a clock that fails before anything is admitted is still the last-resort refusal); a bearer token of DIGITS ONLY is refused as `token_malformed` before anything is sent, from a provider and from the environment alike, because a server could echo it as a JSON number and numbers are never redacted (stated limit: the redaction covers strings and keys only).
- Gates on the A1 review-3 tree (through the bounded runner, one batch at a time): the four suites 120/120; the
  `app/lib/net`, `app/lib/http` and `app/lib/mcp` test directories 321/321 in 9 suites (the B19 egress suite unchanged);
  `app/lib/acquisition`, the distributor egress, quota/breaker and source-admission suites, `app/lib/schgen` and the
  cross-verify egress suite 250 passed and 2 skipped (the live contract) in 19 suites, the B19 admission suites unchanged;
  the redaction consumers — `app/lib/agent/__tests__`, the build-loop injection suite and the B12.7 total settlement —
  420/420 in 36 suites, unchanged; the B14.4 AST import gates, the B16.1C tripwires (162 = 159 + 3 + 0: no round adds a
  route) and the B11.5 capture exactness 47/47; `tsc` and `eslint` on every changed file (recorded in the round's report).

### Limits, stated (RECORDED)

- The DNS rebinding window of the egress path is unchanged (D20-23 stays for D1, OD-51): the transport admits the row's
  host by every resolved address and then lets `fetch` resolve again.
- The in-flight bound and the meters are per process (OD-53).
- `acceptContentTypes` stays empty on the MCP policy (a bodiless 202 carries no media type and must not be refused as a
  foreign type), so a 200 of a media type the transport does not read is pulled under the row's `maxResponseBytes` and
  the deadline before it is refused as `unexpected_content_type`: bounded waste, then discarded; error bodies are read
  as `application/json` only.
- A `result` is data: the transport redacts the sent token from its string leaves and keys and nothing else; bounding and
  inert-scrubbing `content[]` text, describing non-text blocks and validating `structuredContent` are A4's normaliser.
  Results are NOT Unicode-normalised here (review-3): a leaf or key is either returned as sent with the literal token
  redacted in place, or — when its skeleton holds the token — replaced whole. A4 must treat result text as untrusted and
  normalise it BEFORE any comparison of its own; nothing it compares against is normalised for it.
- The skeleton check FAILS CLOSED (review-3): a text that merely RESEMBLES the token after compatibility folding — the
  token's characters in order with only combining marks, format characters or compatibility spellings between or instead
  of them — is redacted whole, whether or not the server meant an echo; so is a text over its window whose cut end folds
  to a proper prefix of the token under a disguise. The text around it is lost with it, by design.
- The redaction is of the token as sent, literally and under that skeleton. A server that knows the token can always echo
  a PART of it, the token interleaved with text the skeleton keeps (a space, a control character, a letter), a case
  variant outside the two channels that lowercase, or an encoding of it (percent-escapes, Base64); the transport
  guarantees only that its own cuts, normalisation and parsers never turn a whole token into something that survives. A
  token that overlaps itself (`abab` in `ababab`) leaves what the left-to-right replacement leaves.
- NFC over a scrub window of ill-ordered combining marks is quadratic in ICU: pass 2 and the inert step each cost about
  9 ms for a window of 4 256 such characters, about 0.5 s each over the 61 windows of one call's budget (measured); the
  bounds of the scrub's work cap it there. The skeleton pass does not add to it (the marks are dropped first).
- The outcome's `notificationsDropped` counts the stubs (too much text to scrub). The reader's own count of notifications
  beyond its cap of 64 — never buffered — is not surfaced by the transport; A4 decides whether it needs it.
- The scrub's work is bounded per `mcpPost` call, not per process: `maxConcurrent` calls (at most 16 by the registry) can
  each spend their budget; the residual quadratic vector of the URL-credential pattern (Evidence) costs about 0.2 s of
  synchronous work per call at worst on the measured machine.
- The SSE reader's two byte ceilings are the same 16 MiB and the total is judged first, so at the ceiling the refusal is
  `sse_too_many_bytes`; the per-event ceiling is never the one that speaks there.
- `x-mcp-header` mirroring of tool parameters into `Mcp-Param-*` headers is A2's, with the constraint check that
  excludes a violating tool from `tools/list`; A1 sends no `Mcp-Param-*`.
- The `_meta` log level (`io.modelcontextprotocol/logLevel`) is a reserved key the caller may not set; A1 sets none, so
  a conforming server sends no `notifications/message` for A1's requests.
- The transport never sends a response, never batches, and sends `_meta` on notifications as well as requests (the
  version and capabilities a stateless server needs on every message).
- An `input_required` result is returned as data: nothing in A1 declares an input capability, so a conforming server
  never sends one; a non-conforming one gets no answer.
- `resource_metadata` is recorded, not fetched: A3 admits it through the same egress rules (https, public address,
  bounded, no redirect) before any PRM request.

### Deferred

- Negotiation (`server/discover`), the era probe that consumes `legacy_or_unknown` and `unsupported_protocol_version`,
  discovery caching (`ttlMs` / `cacheScope`), the descriptor pin comparison, foreign name / description / annotation /
  schema gates and `x-mcp-header` → A2 (D20-18, D20-15, D20-13).
- PRM (RFC 9728) and AS metadata discovery, the client-credentials flow, `resource` indicators, audience and `iss`
  checks, scope step-up from the recorded challenge, the in-process token cache → A3 (D20-19; OD-46).
- The observation envelope, the agent read port and trace attribution from the outcome's fields (`serverId`,
  `protocolVersion`, `method`, `elapsedMs`, the byte counts, the SSE notifications) → A4 (D20-22, D20-11).
- Provider-native connector policy → A5 (D20-29, OD-45).
