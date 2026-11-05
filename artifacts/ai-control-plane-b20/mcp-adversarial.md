# B20 — the adversarial chapter (B20-D)

Labels: **CONFIRMED** (executed and measured, or read at the cited anchor), **INFERRED** (code reading), **RECORDED**
(written down without a claim), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**.

This page is D's own. `mcp-client-boundary.md`, `mcp-server-reads.md`, `mcp-exposure.md`, `mcp-server-proposals.md` and
`mcp-parity.md` are unchanged by D; `mcp-server-endpoint.md` carries D3's live re-read and its U1/U2 settlements, because
that page is not reserved. **Where the adversarial evidence lives is RECORDED here, not spent as an owner decision:** D
holds exactly four numbers, OD-102 to OD-105, and one new D-owned page with content-anchored citations and test-pinned
case counts costs no decision that the four already cover. Folding each attack into the page of the increment that owns
its module would have meant four edits, three of them to reserved files, and no single place a reviewer can read the
chapter's adversarial verdict.

## 0. What D asserts, and what it deliberately does not

The runbook's B20-D (`Sirkit_Remaining_Builder_Master_Runbook.md:752-754`) names sixteen attacks. Fifteen of them already
have at least one case in an A, B or C suite. D therefore asserts only two kinds of thing (**OD-103**):

- **(a) the one attack no suite has** — the DNS rebinding flip (§D1.5); and
- **(b) answers that are COMPOSED or POPULATION-WIDE.** For D1 that is *one hostile server, one agent run*, asserted on
  the agent-visible refusal code, its FIXED sentence, the `McpObservationRecord`, the `ExternalToolAttribution` and the
  leak sweep. For D2 it is *the whole descriptor population under every mapped role*, asserted on the identity of the
  answers and the absence of side effects.

Every D case that composes over an existing case BINDS that case by an assertion in its own body, and names it: the D1
table below names the suite per row, and the sweep's composing cases (E2, E4, E5, E6, E7b, E10) carry the bound title in
their own `it(` title. The binding is by SUITE FILE and `it(` COUNT for A-suite cases and by TITLE STRING for the
committed B and C cases, because A titles are still moving (**DEC-2**: one A4 title was cited at three different line
numbers by three readers in one week). The committed titles bound today, and by which case: B3 case 2 and B4 case 5 by
E2, B3 case 3 by E5, B3 case 5 by E4 and E6, B3 case 9 by E7b, B3 cases 7 and 8 by E10, B4 case 5 again by N6 for the
whole name-spellings suite (N1–N5 are one spelling attack on the case N6 binds and name none themselves), and B2 J2
case 2 by G-D4. A case with **no precedent** binds nothing and says so with "—" in the D1 table: the rebinding suite
(DEC-1(a)), the sweep's own population cases (E1, E1b, E1c, E3, E7, E8, E9, E11, E12) and D1's own whole-script sweeps
(18, 19).
**The count binding is a deliberate coupling:** every A-suite case addition is a D page edit (the table in §D1.6),
recorded for the lead as such rather than hidden behind a title marker.

**Scenario 16 is not D's.** The runbook's final-acceptance scenario 16 (`:1182`, "Expose a Sirkit read/propose tool over
MCP with the same role/revision behavior as native invocation") is evidenced by
`b20-b3-mcp-tools-call-reads` cases 2 and 3. D2 cites those two by title and asserts the titles still exist; it does not
re-run a native comparison. **D evidences scenario 15** (`:1181`, "Use an approved external MCP read tool without
credential or project leakage"): D1's composed hostile-server runs are that evidence.

**Not built, and why (OD-102).** `discovery.md:356` names, as part of the recorded B20-D plan, an optional
`describe.skipIf(SIRKIT_LIVE_MCP_CONTRACT !== "1")` live contract against one approved external server. It is **not
written**. OD-48's approved-server allowlist is empty, so the block would be a permanently skipped test — a claim of
coverage with no evidence behind it. The in-process `OutboundDeps` hostile-server harness
(`app/lib/mcp/__tests__/_hostile-server.ts`) is the standing substitute and is what closes D20-28's loopback half. The
live contract is named as a follow-up for the increment that approves the first server.

**What stays open after D**

| item | state |
|---|---|
| discovery §8 UNKNOWN 1 — Supabase Auth as an OAuth 2.1 AS with RFC 8707/9728 | **BLOCKED-LIVE-QUALIFICATION** (LB-1). D changes nothing. |
| discovery §8 UNKNOWN 2 — whether undici permits setting an `Origin` from server code | **not needed.** The 2026-07-28 Streamable HTTP specification requires no client `Origin` (re-read 2026-09-23, §D3.2); D1 pins that the Sirkit client sends none. |
| D20-3 — the `authorization_servers` MUST | partly **BLOCKED-LIVE-QUALIFICATION**. The re-read of 2026-09-23 confirms the MUST verbatim ("The Protected Resource Metadata document returned by the MCP server **MUST** include the `authorization_servers` field containing at least one authorization server"). B2's served document omits it because no authorization server exists in B20 (OD-43). D3 W7 pins the served document **as it is**, including the absent field. |
| D20-25 (stdio, OD-47), D20-29 (provider-native connector live behaviour, A5) | unchanged by D. |
| a pinned egress dispatcher | a follow-up: it needs `undici`, and OD-42 forbids a new runtime dependency without an owner decision. |

**Sizes substituted, and why.** Three D1 cases name a magnitude in the runbook's language (an 8 MB body, a 5 M-character
text block, a `structuredContent` of 200 000 nodes). Each is asserted against **the bound that actually stops it**, at a
size that exceeds that bound with a margin, because the literal magnitudes would cost tens of megabytes of heap on a
16 GB machine for no additional proof: the ceiling is a registry-row value (`maxResponseBytes`) or a normalizer bound
(`MCP_OBSERVATION_BOUNDS`), and every one of them is read from its own module at run time, never typed into a case.

**One case that would not fail was deleted.** `withheld_budget` on a *content block* is unreachable: a text block is
charged its scan WINDOW, so sixteen blocks charge at most `16 x (MCP_OBSERVATION_BOUNDS.scanChars + the longest
credential)`, which is below `MCP_OBSERVATION_BOUNDS.scrubBudgetChars`. Case 12 asserts that arithmetic from the
constants and then proves `withheld_budget` where it IS reachable — on `structuredContent`, whose charge is per leaf
window. **CONFIRMED** by measurement.

## D1. The malicious external server (the client half)

One hostile MCP server driven through the whole composed client in one agent run:
`discoverMcpServer` -> `listMcpTools` -> `callMcpTool` -> `normalizeMcpToolResult` -> `callMcpToolForAgent` ->
`McpObservationReadService` -> the `GatewayInvocationOutcome` and its `ExternalToolAttribution`. Fakes are in-process
handlers injected through `OutboundDeps`; the global fetch is poisoned; every credential is an obvious fake assembled at
run time. No network, no DNS, no database. **No production code changed** (DEC-12).

### D1.1 The attacks, their composed answers and the bound that stops each

| # | the attack | the composed answer | the bound | composes over |
|---|---|---|---|---|
| 1 | a 302 to another origin on `tools/call` | `redirect_refused` -> port `transport_failed`, `sent` -> the fixed sentence -> attribution `transport_failed` | the row's `maxRedirects: 0`; exactly one `tools/call` on the wire | `b20-a1-http-transport` |
| 2 | a 307 to the SAME origin, another path | identical; the second path is never requested | the same row pin — the only thing that makes the same-origin header re-send inert | `b20-a1-http-transport` |
| 3 | a 401 challenge naming `resource_metadata` with `?access_token`; a PRM naming an issuer with a query; a discover `_meta` naming a "next endpoint" | `prm_url_not_allowed` / `prm_issuer_not_pinned` -> `authorization_failed`, `sent: false`; the `_meta` endpoint is ignored | `admitAgainst` refuses `?` and `#`; the row's endpoint is the only URL | `b20-a3-prm-discovery` |
| 4 | a PRM naming another `resource` in six spellings | `prm_resource_mismatch` -> `authorization_failed` | the exact comparison (LD-5) | `b20-a3-prm-discovery` |
| 5 | two credential-bearing rows in one run | row A's token never reaches row B's wire | the per-row token cache | `b20-a3-token-cache` |
| 6a | a server-INVENTED value in a text block | disposition `text` either way; a **secret-shaped** one is replaced by the redaction marker by the display scrub, a merely credential-sounding one is shown under an untrusted key only; neither becomes a subject | `scrubVendorText` -> `sanitizeTraceText` | `b20-a4-observation-normalizer` |
| 6b | an echo of the CLIENT'S OWN sent token in a text block, a `structuredContent` string and a `structuredContent` KEY | `withheld_credential` in all three | `skeletonCarries(..., subjects, true)` | `b20-a4-observation-normalizer` |
| 7 | five schema bombs in one listing | each excluded with its own reason; the clean tool is still offered and callable | `MCP_SCHEMA_MAX_BYTES`, depth, subschema and property bounds | `b20-a2-foreign-tools` |
| 8 | 500 tools in one listing | the listing settles; the agent catalog is EXACTLY the operator's allowlist (a floor, not only a ceiling: an empty catalog fails), each tool by its exact name, `toolsTotal` the allowlist's size; the scrub budget is a measured bound (A2 accepts more than the allowlist and fewer than 500, the rest excluded whole as `schema_text_budget`); the first approved tool is callable after the listing | `MCP_TOOLS_PER_SERVER_MAX`, the scrub budget, `MCP_AGENT_TOOLS_MAX`, `MCP_AGENT_CATALOG_TOOLS_MAX` | `b20-a2-tool-discovery` |
| 9 | two rows each offering `search` | the catalogs are disjoint by `serverId`; a call naming row A reaches row A's host only | routing by `serverId` and exact tool name | `b20-a2-foreign-tools` |
| 9b | a provider name past 64 characters | `name_unrepresentable` — and the **stated limit** below | `MCP_SERVER_ID_PATTERN` | `b20-a2-foreign-tools` |
| 10 | forged `readOnlyHint` / `destructiveHint` / `openWorldHint` | a declared write is still `declared_write`; the agent's label moves with the registry ROW's disclosure and never with the forgery — two rows that differ in `agentDisclosure` alone, the same forged listing behind both, NO disclosure override on the run, the harness reading the rows through the production lookup (`mcpServerEntry`, by exact id) and the production default pinned as text | `declared_write`; `McpAgentDisclosure` read from the registry (OD-76) | `b20-a2-foreign-tools` |
| 10b | `annotations.audience` in six shapes on the wire, and two THROWING accessors asked of the normalizer DIRECTLY (an accessor cannot travel the wire: serialised by a fake it throws inside the fake, which is case 18's rejecting transport) | `withheld_audience` for an audience that leaves the model out, `text` for the rest; the accessor object and the accessor element are both `normalize_failed` — the normalizer's own catch, the getter provably read, nothing of the thrown error in the answer | `forUserOnly` reads at most 8 entries, the length judged first; the one try/catch of `normalizeMcpToolResult` | `b20-a4-observation-normalizer` |
| 11 | a directive in every judged place (title, description, enum member, property name, property description, server instructions, name, version, a notification method and its leaves and keys, a content text, a `structuredContent` string and KEY, a `resource_link` uri and name, a `_meta` value) | each excluded, withheld or scrubbed; the model-bound projection carries no directive | `MCP_DIRECTIVE_SCAN_CHARS`; the per-listing scrub budget | `b20-a2-foreign-tools` |
| 12 | enormous content in four shapes | `response_too_large` -> `transport_failed`; `blocksNotRead`; the shown text cut to the 2 000-code-point bound with `rawChars` recording the real length; `structuredContent` `unsafe` and `withheld_budget` | the row's `maxResponseBytes`; `MCP_OBSERVATION_BOUNDS`; `MAX_MCP_OUTPUT_CHARS` | `b20-a4-observation-normalizer` |
| 13 | keep-alive comments for the whole deadline; one notification then silence | both `timeout` -> `transport_failed`, no partial text | the row's `deadlineMs` | `b20-a1-http-transport` |
| 14 | two responses with one id; a response whose id is not the request's; two byte-identical text blocks | the first two are closed transport failures; the third is ONE block with `repeats: 2` | the stream stops at the first matching response | `b20-a1-http-transport` |
| 15 | the caller aborts after the first notification | `cancelled` -> the fixed sentence -> class `cancelled`; **no** `notifications/cancelled` is sent; the operation is still charged | the abort listener; the budget is charged before the port is asked and never refunded | `b20-a1-http-transport` |
| 16 | an `input_required` (MRTR) result on `tools/call` and on `tools/list` | deliberately ASYMMETRIC, each half pinned: on `tools/call` `input_required_unsupported` -> the fixed sentence -> class `upstream_error`; on `tools/list` the listing closes it as `unexpected_input_required` (the specification allows it on `tools/call`, `resources/read` and `prompts/get` only) -> port `listing_failed` -> its fixed sentence -> class `result_invalid`; the elicitation is never answered, its prompt never shown, the budget charged on both | the transport's typed outcome; `LISTING_CODES` | `b20-a1-http-transport` |
| 17 | a 401 naming an IN-ceiling scope (one refresh), then a 403 `insufficient_scope` naming a second in-ceiling scope (one step-up), then a 401 again (the backoff), over four agent calls in one run | call 1 is `authorization_failed` after exactly `MCP_TOKEN_REQUESTS_PER_CALL_MAX` token requests and `MCP_AUTHORIZED_POST_MAX_EXCHANGES` posts (derived from the constants, never typed); calls 2-4 are `paused` with `retryAtMs` exactly `T0 + MCP_AUTHORIZATION_BACKOFF_MS` (Sirkit's OWN backoff on the frozen clock), class `not_sent`, no token request; the FIFTH call is `run_call_limit` **before the port is asked**; the whole run's exchanges are one exact tally; no challenge text and no server-named scope anywhere | `MCP_AUTHORIZED_POST_MAX_EXCHANGES`, `MCP_TOKEN_REQUESTS_PER_CALL_MAX`, `MCP_AUTHORIZATION_BACKOFF_MS`, `MAX_MCP_NETWORK_OPERATIONS_PER_RUN` | `b20-a3-authorized-post` |
| 17b | a 401 whose challenge names a scope OUTSIDE the row's ceiling, on every call | `scope_exceeds_row` -> `authorization_failed`, `sent: false`: no refresh, no token request for the named scope and NO backoff — the next agent call goes to the wire again and meets the same closed answer, each call costing exactly one token request and one `tools/call`; the named scope never survives | the row's scope ceiling | `b20-a3-authorized-post` |
| 18 | every script re-run in one loop | nothing threw or rejected; `mcpInFlight` returns to 0; each attribution is a closed record of identities and hashes only | — | — |
| 19 | the budget across runs | an exhausted run never borrows another run's allowance | `operationsUsed(runId)` | — |

### D1.2 The leak sweep (DEC-4)

`nothingLeaked` is the single leak assertion, and it does **not** use `JSON.stringify`: that drops `undefined`, functions,
symbol keys and non-enumerable properties, never emits an assigned `__proto__` and **throws** on a `BigInt` or a cycle, so
a sweep over it would be unfalsifiable exactly where a leak would hide. It walks own properties through `Reflect.ownKeys`
under its own bounds (20 000 nodes, depth 12, 1 MiB of accumulated string), over the agent's sentence and MODEL-BOUND
projection, the port's answer, the observation record and the trace attribution, and reports rather than swallows every
structural finding. It asserts:

- no 8-character window of the skeleton of any sent token, client id or client secret survives anywhere;
- no planted peer marker and no caller-named forbidden literal survives;
- no hostname the run contacted and no `<host><path>` of any request survives; no `Mcp-Param-*` value survives;
- the model-bound projection carries no `://` at all;
- no string reads as a directive outside `untrustedText` / `untrustedValue` / `untrustedTitle` / `untrustedDescription`;
- every object reached has `Object.prototype`, `Array.prototype` or `null` as its prototype, no OWN `__proto__`, no
  accessor, no symbol key, no function and no BigInt.

Sirkit's own CLOSED vocabularies are exempt from the directive rule, and only from that rule: the A2 matcher reads
`withheld_credential` as a directive because it names a credential, so a sweep that judged Sirkit's own disposition names
would fire on the very refusal it is asserting. The exempt set is built from the closed unions themselves
(`MCP_BLOCK_DISPOSITIONS`, `MCP_STRUCTURED_STATES`, `MCP_CONTENT_TYPES`, `OBSERVATION_BLOCK_DISPOSITIONS`,
`OBSERVATION_STRUCTURED_STATES`, `EXTERNAL_RESULT_CLASSES`, `MCP_PORT_REFUSAL_CODES`), never typed as literals.

### D1.3 Two facts the design predicted differently, re-derived on this tree

- **The result class of an unsent authorization refusal is `authorization_failed`, not `not_sent`.**
  `externalResultClassOf` answers `cancelled`, then `authorization_failed`, and only then `not_sent` for an unsent
  outcome. `not_sent` is the class of a `paused` or `transport_failed` outcome that never went out — which is what the
  rebinding flip produces (§D1.5). **CONFIRMED** by cases 3, 4 and R1.
- **A peer-invented SECRET-SHAPED value does not reach the model.** The disposition is `text` (no `withheld_credential`,
  because Sirkit never sent that value), but `scrubVendorText` runs `sanitizeTraceText` over every shown text and that
  replaces a secret-shaped substring with the redaction marker whoever invented it. Only a value that merely *sounds*
  like a credential is shown, and then only under an untrusted key. **CONFIRMED** by case 6a. The owner question below is
  therefore narrower than it looked.
- **The port shows no egress code.** `mcpPortRefusalOf` folds every `egress_refused` outcome into `transport_failed`,
  `sent: false` and drops the transport's `egressCode`, so a composed run cannot say WHICH check refused it. The rebinding
  suite therefore observes the transport-level outcome one layer down — one `mcpPost` per admission against the same row,
  fake and resolver — and pins the code there (`egress_refused` / `address_blocked` for the flip, `dns_failed` for a
  failed lookup, `timeout` for one that never settles, `network_error` for a resolver answering non-strings,
  `endpoint_mismatch` for a crafted row). **CONFIRMED** by R1, R4 and R5.

### D1.4 Limits recorded, not claimed

- **Cross-server provider-name collision is not detected (FACT 12).** `acceptForeignTools` seeds its `providerNames` set
  per CALL — one call is one server — and the agent port passes no `reservedProviderNames`. A crafted pair (server `a__b`
  tool `c` against server `a` tool `b__c`, both mapping to `mcp_a__b__c`) is therefore **not refused**. What prevents harm
  is that `MCP_SERVER_ID_PATTERN` admits no underscore, so `a__b` is not an admissible server id, and that the composed
  path routes by `serverId` and exact tool name, never by provider name. Case 9b asserts **those two facts**, not a
  refusal that cannot happen. The runbook's "tool-name collision" item is the client half's, and on the client half it is
  a stated limit.
- **A peer-invented, non-secret-shaped value is shown as untrusted text.** If the owner wants such a value withheld, that
  is a change to `app/lib/mcp/observation.ts` and therefore a **stop for the lead** under DEC-12, not a quiet edit. D1
  case 6a records the current behaviour; it does not change it. (Recorded for the lead as a suggested follow-up.)
- **The rebinding window inside one admission -> connect pair stays open.** See §D1.5.

### D1.5 D20-23 — the DNS rebinding window, closed AS RECORDED under OD-51

D20-23 is the one item on the runbook's B20-D list where **no existing suite has the attack at all**: a search for
`rebind` over the B20 client suites returns nothing. **OD-51** already records the mitigation this executes: "Accepted
mitigation recorded; the B20-D rebinding test proves refusal when the resolver flips between admission calls and
documents the residual window." **No new owner decision is spent on D20-23.**

`app/lib/mcp/__tests__/b20-d1-rebinding-window.test.ts` injects the flip through the resolver seam (`OutboundDeps.resolve`),
which `outboundFetch` consults ONCE PER ADMISSION, and proves:

- **R1** a resolver answering a public address on the discovery admission and `169.254.169.254` on the listing admission
  gives `egress_refused` / `address_blocked` -> port `transport_failed`, `sent: false` -> agent class **`not_sent`**, with
  the fixed sentence naming the server id alone and **no address, hostname or path anywhere** in the answer; the fake
  recorded exactly one request, the discovery one. The transport-level outcome of the same flip is observed by CODE
  (`egress_refused` with `egressCode: "address_blocked"` — the ADDRESS check, not the allowlist and not a failed lookup),
  and its sentence names the code alone, never an address, the hostname or the path.
- **R2** the private address SECOND in a two-address answer is still refused — EVERY resolved address must be public,
  because the transport may pick either.
- **R3** five blocked classes flipped in on the second admission (loopback, the link-local metadata service, a private
  range, carrier-grade NAT and an IPv6 unique-local address) all give the same closed answer and the same sentence.
- **R4** the ROW is the only thing that names a URL: a crafted revision whose canonical URI names another host is refused
  before anything is sent — by the transport's row-consistency check (`endpoint_mismatch`, which the port classes
  `port_failed`), which runs BEFORE the egress policy is even built, so no row can reach the allowlist with a host other
  than its own. The allowlist ITSELF is exercised at the egress boundary with a policy whose allowlist excludes the URL's
  host: `host_not_allowed` before any lookup and before any request (the resolver and the transport are both poisoned
  and neither is called). The transport's per-source allowlist is exactly `[server.endpoint.host]` and its egress
  sentence names the code alone (both pinned as source text, because the agent never sees that text), and a public
  answer really does reach `deps.fetch` so none of the assertions is vacuous.
- **R5** each resolver is pinned to the ONE answer it must produce, by transport code and port answer, with zero wire
  calls: a resolver that throws, one that rejects and one answering an empty list are `egress_refused` /
  `dns_failed`; one that never settles is raced by the row's deadline and closed as `timeout`; one answering non-strings
  throws inside the address check and is closed by the transport as `network_error`; every one of those five is port
  `transport_failed` with the fake recording NOTHING. Only the 10 000-address answer (every address public) is admitted
  and served. Nothing throws; `mcpInFlight` returns to 0.

**The residual window, recorded.** `app/lib/net/outbound-fetch.ts` states in its own header that the transport resolves
the name again when it connects, so a rebinding that flips a record between the admission check and that connect is not
excluded there; the per-source allowlist of exact hosts is what closes it in practice, and pinning the connection to the
checked address needs a custom dispatcher. R4 pins that text and the allowlist. A pinned dispatcher stays a follow-up
(it needs `undici`; OD-42).

### D1.6 Suites and case counts

| suite | cases |
|---|---|
| `app/lib/mcp/__tests__/b20-d1-malicious-server.test.ts` | 25 |
| `app/lib/mcp/__tests__/b20-d1-rebinding-window.test.ts` | 6 |

The A suites D1 composes over, bound by file and case count (DEC-2), never by title. **This table is the coupling:** a
case added to any of these eight suites is a D page edit here (and D1 case 21 and D3 G-D7 say so loudly), by design.

| suite | cases |
|---|---|
| `app/lib/mcp/__tests__/b20-a1-http-transport.test.ts` | 70 |
| `app/lib/mcp/__tests__/b20-a2-foreign-tools.test.ts` | 66 |
| `app/lib/mcp/__tests__/b20-a2-tool-discovery.test.ts` | 28 |
| `app/lib/mcp/__tests__/b20-a3-prm-discovery.test.ts` | 24 |
| `app/lib/mcp/__tests__/b20-a3-authorized-post.test.ts` | 38 |
| `app/lib/mcp/__tests__/b20-a3-token-cache.test.ts` | 17 |
| `app/lib/mcp/__tests__/b20-a4-observation-normalizer.test.ts` | 17 |
| `app/lib/mcp/__tests__/b20-a4-agent-read-port.test.ts` | 18 |

## D2. Hidden release tools and cross-project access (the server half)

Every descriptor of the canonical registry, under every mapped stored role, called through `POST /api/mcp` (**OD-104**).
That is the one thing no existing suite does: B3 case 7 proves two withheld reads plus `sirkit.manufacturing.release`,
B3 case 8 the five proposals, B4 case 5 the listed-means-served ratchet. D2 composes over those and asserts what only a
whole-population run can — that every unserved name answers ONE identical body, that the trace records each one, and that
no durable work happened on any of them.

**Scenario 16 is not claimed here.** Role and revision behaviour equal to native invocation is `b20-b3-mcp-tools-call-reads`
cases 2 and 3. D2 cites those two by title and asserts the titles still exist; it runs no native comparison.

### D2.1 The derived population

Every number below is computed from the landed registry and the landed reviewed lists at run time, never typed into a
case, so a reviewed subset move moves the sweep with it. As of base `6e3efa7` ([B22-B, 2026-10-01] updated for the five named computations, OD-139: 42 -> 47 descriptors, 26 -> 31 structurally excluded under the new `computation` reason; 210 -> 235 requests, 167 -> 192 refusals; the served reads unchanged; [B24-D2, 2026-10-09] updated for the paged board read, OD-235: 47 -> 48 descriptors, 7 -> 8 withheld (the read withheld from MCP by choice), 31 structurally excluded unchanged; 235 -> 240 requests, 192 -> 197 refusals; the served reads unchanged; [PR-D, 2026-10-17] updated for PR-D's four descriptors, OD-243 and d2: 48 -> 52 descriptors (the Build-mode generation proposal and d2's two Tier 0 reads, all three withheld from MCP; the not-callable component review request, structurally excluded as `not_agent_exposed`), 8 -> 11 withheld, 31 -> 32 structurally excluded; 240 -> 260 requests, 197 -> 217 refusals; the served reads unchanged):

| quantity | value |
|---|---|
| descriptors | 64 |
| MCP-exposed | 9 |
| withheld | 23 |
| structurally excluded | 32 |
| mapped stored roles | 5 |

The served listing is **not uniform across roles**: the viewer, the reviewer, the editor and the admin see the nine
reads, the commenter the seven its role permits. The sweep is therefore **320 requests**, of which **43 served reads**
and **277 unknown-tool refusals** ([PR-J5, 2026-10-23] updated for section J increment 5's organise proposal `sirkit.schematic.propose-sheet-organization`, withheld from MCP: 63 -> 64 descriptors, 22 -> 23 withheld, 32 structurally excluded unchanged; 315 -> 320 requests, 272 -> 277 refusals; the served reads unchanged; [PR-M, 2026-10-18] updated for section M2's two descriptors - the CAD acquisition start `sirkit.parts.acquisition-start` and status `sirkit.parts.acquisition-status`, both withheld from MCP: 61 -> 63 descriptors, 20 -> 22 withheld, 32 structurally excluded unchanged; 305 -> 315 requests, 262 -> 272 refusals; the served reads unchanged; [PR-L, 2026-10-18] updated for runbook L.5's two descriptors - the durable generation task's inspection `sirkit.generation.task-inspect` and its control request `sirkit.generation.task-control`, both withheld from MCP: 59 -> 61 descriptors, 18 -> 20 withheld, 32 structurally excluded unchanged; 295 -> 305 requests, 252 -> 262 refusals; the served reads unchanged; [PR-M, 2026-10-17] updated for PR-M's three descriptors - the schematic-instance inspection `sirkit.schematic.instance-inspect`, the resolution candidate search `sirkit.parts.candidate-search` and the component resolution proposal `sirkit.schematic.propose-component-resolution`, all three withheld from MCP: 56 -> 59 descriptors, 15 -> 18 withheld, 32 structurally excluded unchanged; 280 -> 295 requests, 237 -> 252 refusals; the served reads unchanged; [PR-F fE, 2026-10-17] updated for PR-F fE's stackup / via-policy proposal `sirkit.stackup.propose`, withheld from MCP: 55 -> 56 descriptors, 14 -> 15 withheld, 32 structurally excluded unchanged; 275 -> 280 requests, 232 -> 237 refusals; the served reads unchanged; [PR-F fD, 2026-10-17] updated for PR-F fD's module contract proposal, withheld from MCP: 54 -> 55 descriptors, 13 -> 14 withheld, 32 structurally excluded unchanged; 270 -> 275 requests, 227 -> 232 refusals; the served reads unchanged; [PR-F fB, 2026-10-17] updated for PR-F's two descriptors, the missing-facts read and the part draft request, both withheld from MCP: 52 -> 54 descriptors, 11 -> 13 withheld, 32 structurally excluded unchanged; 260 -> 270 requests, 217 -> 227 refusals; the served reads unchanged).

### D2.2 The partition (DEC-5), and why it exists

The two refusal kinds are partitioned BEFORE anything is asserted. A blanket "every spy is zero" would be false for the
served reads, which are expected to do durable work; conflating them is the defect the partition removes.

- **Partition A — the unknown-tool answers** (167): HTTP 200, `-32602`, the message exactly
  `"Unknown tool or invalid arguments"`, **no `data`**, the id echoed; the set of those bodies with the request id
  normalised has **cardinality 1**; the trace outcome is `unknown_tool` with `toolId: null`; **every spy is 0**.
- **Partition B — the served reads** (43): HTTP 200 tool results with **the floor** that every one of them really is
  served — `dev.sirkit/refusal` empty and the trace outcome `read_served` for all 43 (a post-check forced to "changed"
  would turn every one into `read_refused` and fail here) — `toolId` the served id, the board-reader spy **non-zero by
  design** (the read pipeline loads the durable board at step 9), no write asked of the read-only view (`viewWrite` 0)
  and none reached the repository (`workflowWrite` 0). **The write claim is structural, not measured:** the pipeline
  never touches the repository itself, it receives the read-only VIEW (`readOnlyDurableWorkflow`), which delegates reads
  and refuses every write without delegating; E1c proves both write counters MOVE when a write is attempted, so a 0 here
  is a live reading rather than a counter that cannot move by construction.
- **Across both:** the trace ring holds exactly 210 records and **never** the outcome `not_served`; **no response carries
  HTTP 429** — the tripwire that proves the limiter mitigation held, because a silent 429 would read exactly like the
  refusal Partition A asserts.

Two of the nine served reads declare required arguments, and the read pipeline judges arguments (step 5) before it loads
the board (step 9). The sweep therefore calls each served read with B3's own fixture arguments and everything else with
`{}`; without that, two of the nine would refuse before any durable work and prove nothing about the board.

### D2.3 Absence of work, proven by spies (DEC-6)

Two durable layers are counted, because the pipeline never sees the repository itself: the repository's OWN methods,
classified in full BY NAME as reads or writes (E1c asserts the classification is total over the prototype, so a new
method is a deliberate edit, and a method neither list names is counted as a write AND reported), and the read-only VIEW
the pipeline actually receives, with asked writes counted separately. The durable board reader is counted and **every
scope it is asked for is recorded**, so "the other project's rows were never read" is measured on the argument (E4, E6,
E9) rather than inferred from a count. The component-authority source and the live membership re-verifier are counted
too, and the re-verifier's count is asserted where it matters: 0 on every stale-revision and revision-required refusal
(E5 — steps 14 and 15 never ran), exactly 1 on every served read and on every read a mid-read revocation discarded (E5,
E7b). All reset per case; no wall-clock assertion anywhere. The database client is mocked to throw, and the sweep
asserts it was never reached.

**A membership revoked DURING the read, swept (E7b).** Over every read the admin's listing serves, a revocation planted
inside the B05 invocation — after the board load, before the membership re-read, exactly where B3 case 9 plants it for
one read — answers `membership_changed` with the result DISCARDED (an `isError` result with no output and no
`structuredContent`), after the board was loaded and post-checked and the live membership re-read exactly once; the
next request with the same token is the wrapper's byte-identical 401.

**What the spies do not cover, stated:** the fabrication release family is not spied, because the served
`sirkit.manufacturing.readiness-inspect` read legitimately consumes a static fabrication preset. That the server half can
never reach the release family at all is a STRUCTURAL property, proven by D3's import gate and by B2's J2 walk, not by a
call counter.

### D2.3b Sirkit's own MCP client tool, and a measured redundancy

E1b proves that `sirkit.mcp.observation-read` — A4's agent read of approved external MCP servers — is excluded from
Sirkit's own MCP server as `external_read`, is on no role's `tools/list`, and answers the identical `-32602` under every
mapped role. The server can never serve the client.

**Measured while checking the mutation:** the exclusion rests on **two independent grounds**, and either alone is
sufficient. The descriptor's `binding.status` is `bound-external-read`, which `structuralReasonOf` tests first; A4's added
`requiredAuthority.includes("external-mcp-observation")` clause is defence in depth for a descriptor that declares the
authority without that binding. Removing A4's clause therefore does **not** change this answer, so the case pins the
descriptor's own facts AND the rule's text, and a reviewed move of either one is visible. **CONFIRMED** by mutation.

### D2.4 Name spellings — a spelling attack, not a name collision

`b20-d2-name-spellings.test.ts` drives the dispatch with an injected registry and no route, over four representative ids:
a Tier 3 release, a grant-only mutation, a destructive mutation and a withheld proposal.

- **N1** thirteen spellings each — as written plus twelve renamed (upper case, mixed case, trailing dot, trailing and
  leading space, a zero-width joiner, a fullwidth spelling, an NFKC-folding confusable, a provider-style spelling, a
  foreign-namespace spelling, a `../`-style spelling and 2 048 characters) — body and header agreeing, are ONE identical
  200 `-32602` answer with outcome `unknown_tool`. The EMPTY name is the one spelling with a different — and stricter —
  answer: an empty `Mcp-Name` cannot be decoded, so it is 400 `-32020` before any name is looked up.
- **N2** `params.name` of the wrong type — a number, `null`, `true`, an array, an object and absent — is the same 200
  `-32602`, never a throw, even with the header absent (that check precedes the header check). A THROWING accessor on
  `params.name` is the one shape with its own answer, and it is a closed one: the read of the name is inside the
  validator's try, so the request is a **400** with nothing served, nothing of the throw and no stack in the body.
- **N3 / N3b** header and body disagreeing in both directions, and an `Mcp-Name` on `tools/list` or `server/discover`,
  are 400 `-32020` `header_mismatch` with nothing served.
- **N4** nested spellings on a SERVED read, each PINNED to the refusal the gate that reads it writes, with the caller's
  CURRENT pin sent so that the revision check (step 4) cannot mask the argument gate (step 3): a release id or a
  delegation key (`toolId`, `delegateTo`, `tool`, `name`) as an argument key, and `__proto__` and `constructor` as
  argument keys, are `invalid_arguments`; an `expectedRevision` that is a release id is 400 `-32602`; a
  `params.params.name` naming a release tool is IGNORED and the read is served for the named read only; a `dev.sirkit/*`
  `_meta` key with a throwing getter is served with the getter **never invoked**, because the argument gate reads the
  three binding keys by exact `Object.hasOwn` and never iterates the object. No release id is ever served or echoed.
- **N5** `arguments` of the wrong SHAPE, each pinned: an array, a string and `null` are the dispatch's identical
  unknown-tool answer with outcome `arguments_invalid`; a nine-key object and a 64 KiB object reach the argument gate and
  are `invalid_arguments` (the current pin sent); never a throw, nothing served.

**Why this is not a collision test.** The runbook's "tool-name collision" item is the CLIENT half's, and on that half it
is a stated limit (§D1.4). The server half has **no name namespace to collide in**: one registry, one exact match, one
identical refusal for everything else.

### D2.5 The recorded limit this sweep does not close

`app/lib/mcp/server/request-trace.ts` states that refusals of the wrapper, before the dispatch runs, are **not traced (a recorded limit)**.
E8 asserts that limit AS RECORDED — every tampered-token shape leaves the trace ring untouched — and names what
compensates: the endpoint limiter of 120 requests per 60 seconds per (tenant, project, subject). This is never phrased
as a security property. E8's shapes are at BOTH layers of the verifier, and the verifier's own verdict is pinned per
shape so that a re-signed token provably reaches the claim checks: every claim altered under the ORIGINAL signature, an
extra claim, a `__proto__` claim, an `alg: none` and another header, a truncated signature and another token's signature
are refused at the header bytes or the constant-time signature before the payload is read; a payload RE-SIGNED with the
fixture secret carrying a wrong audience, issuer, scope or an over-long lifetime is refused by the claim checks; one
re-signed with a wrong subject, project, tenant or membership revision passes the verifier and is refused by the WRAPPER
on the live membership; and one re-signed with ANOTHER secret (the fixture secret plus a suffix, 50 bytes) is `bad_signature`. Each is the identical 401 with
the identical body and challenge, every spy 0.

The no-oracle property lives **only on the `WWW-Authenticate` header and the response body**, and E7 and E9 assert it
there, each presentation IN ISOLATION so no leftover masks another: a membership revoked before the request, a
membership whose version moved, a membership whose ROLE moved after the mint, a token replayed after its membership
revision moved (and served again once the record is restored exactly), a token whose subject now belongs to ANOTHER
project only, a fresh token after it expires on the injected clock with the membership untouched (and served again once
the clock is put back), and a plainly forged token are all one byte-identical 401 with one byte-identical challenge. A
stored role outside the map, set BEFORE the mint so the wrapper reaches the role map, is 403 `AUTH_ROLE_UNMAPPED` with
no challenge and every spy 0 (E7); `automation` and `migration_admin` are unreachable.

**A Sirkit MCP token cannot be "presented against a second project" at all, and E9 pins why:** the endpoint derives
tenant, project and subject from the token's CLAIMS and reads no selector — not a header, not a body scope (the wrapper's
source is pinned on that). With a fresh token, the subject a member of a second project too and that project's board
published, every selector a request could carry steering there, the read is served for the token's own project, the
board reader is asked for that scope only, and nothing of the second project's board is in the answer.

### D2.6 Suites and case counts

| suite | cases |
|---|---|
| `app/api/mcp/__tests__/b20-d2-never-reachable-sweep.test.ts` | 16 |
| `app/lib/mcp/server/__tests__/b20-d2-name-spellings.test.ts` | 7 |

## D3. The authority import gate and the wire-level endpoint spec

### D3.1 The gate is ASYMMETRIC, and says so (OD-105)

The recorded B20-D3 plan says MCP modules must never import "grant mint/consume/settle, reauthorization, approval
controllers, manufacturing release". Three of those four are already on B2's J2 gate for the server half, whose entry
filter is byte-for-byte this gate's `SERVER_HALF`. Claiming the new gate "asserts nothing J2 asserts" would be false, so
the split is made explicit instead:

| half | entry rule | families asserted |
|---|---|---|
| `SERVER_HALF` | `app/lib/mcp/server/` + `app/api/mcp/` + `app/.well-known/` — byte-for-byte B2's `MCP_SERVER_SIDE`, and G-D1 asserts that equality from B2's own source | **APPROVALS only** |
| `CLIENT_HALF` | a DERIVED prefix: `app/lib/mcp/**` minus `server/`, plus `app/lib/agent/mcp-observation-reads.ts` and `app/api/chat/mcp-observation-runtime.ts` | **GRANTS, REAUTH, APPROVALS, RELEASE** |

- **GRANTS** matched **by prefix** — the whole `app/lib/execution-grant/` tree (today `consume`, `mint`, `route-contract`,
  `settle`, `store`; G-D1 pins that list, so a new module there joins the gate the day it is written AND is a visible
  edit rather than silent coverage; G-D3 proves it with a grant module that does not exist today)
- **REAUTH** matched **by prefix** — `app/lib/project/membership-reauthorization` (today the one module, pinned the same way)
- **APPROVALS** matched **by prefix** — `app/lib/engineering/approved-` plus `app/lib/engineering/agent-execution-journal`
- **RELEASE** `app/lib/pcb/fab/**`

Every family is matched by prefix for the reason the approval family is: an exact list is complete only today.

**Why the approval family is matched by prefix.** There are **nine** files, three of them `-idb` journals. B2's
extension-stripped EXACT match would let all three through an exact list of six. G-D1 derives the nine from the tree and
asserts the three `-idb` members are among them; G-D3 injects a probe for each of the three.

**The split fab-preset exemption.** `app/lib/pcb/fab/presets/index.ts` is static data the readiness read consumes, so it
is exempt on the SERVER walk and **refused** on the client walk. G-D3 asserts both directions of that in one case.

**What is new, and what is not.** The client half is on no existing gate as a DERIVED SET: **A4 case 11** walks two named
entry files (`agent-port.ts`, `observation.ts`), so a third client module joins nothing today. G-D1 asserts the client
half is a strict superset of those two. The approval family is new on **both** halves. G-D4 reads B2's, B3's, B4's and
A4's gate sources and asserts that grants, reauthorization and fabrication DO occur in B2's list (and binds J2 case 2 by
title), that D3's own source makes no server-half assertion over those three, and that D3 restates none of the other
gates' subjects. **That no other gate names the approval family is RECORDED for base `6e3efa7` (zero occurrences in all
four), never asserted:** asserting it would forbid B2's `FORBIDDEN` list from ever growing an approval name — a strictly
stronger gate — so B2, B3, B4 or A4 may add the family later without D3 refusing the strengthening.

**The negative tripwires probe the real entries in place.** G-D3 appends one forbidden import to the REAL source of
`mcp-observation-reads.ts` and of `mcp-observation-runtime.ts` in an injected copy of the tree and walks from
`entriesOf(CLIENT_HALF)` over it, so the entry rule itself selects them; a probe under an invented path would bypass that
rule and is kept only as a second reading.

**No opaque module load, as a computed set difference.** G-D5 computes `CLIENT_HALF` minus (B2 case 4's scope union B3
case 6's scope) — today the non-server `app/lib/mcp/*.ts` modules plus the two agent files — asserts the difference is
non-empty BEFORE asserting it holds no opaque load, so the case can never go vacuous, and pins both existing scopes as
their own sources write them.

### D3.2 The wire-level spec, and the live re-read that shaped it

`e2e/mcp-endpoint.spec.ts` is request-level only (no browser page, no editor, no chat) and closes D20-28's wire half. The
token is minted **once** (the token route's own limiter is 10 per 60 seconds) and is never logged, attached or
interpolated into a title. Every request states its full shape: `_meta` on every request; `Mcp-Name` equal to
`params.name` on `tools/call` and **absent** on `tools/list` and `server/discover`. No `Origin` is sent unless a row says
so, which the endpoint admits because it validates `Origin` only when present.

| # | request | what it proves |
|---|---|---|
| W1-W3 | `GET`, `DELETE`, `OPTIONS` on `/api/mcp` | **derived and recorded** (DEC-8), never asserted as 405, and the status must be within DEC-8's safe set **{405, 404, 204, 501} — never 200**, the one answer that would mean the method is SERVED; no served-surface key (`result`, `tools`, `supportedVersions`, `capabilities`, `access_token`), no token, no stack frame, no file path, and a 204 carries no body at all. Settles discovery §8 **UNKNOWN 3** / endpoint page **U2** |
| W4-W5 | a foreign `Origin`; `Origin: null` | 403 `AUTH_CROSS_ORIGIN_DENIED` and 403 `AUTH_ORIGIN_NULL` |
| W6 | no `Authorization` | 401 `MCP_UNAUTHENTICATED` with the RFC 9728 challenge naming this origin's metadata URL, built from `baseURL` at run time |
| W7 | `GET /.well-known/oauth-protected-resource/api/mcp` | 200 with the resource, the one scope, `bearer_methods_supported: ["header"]` and **no `authorization_servers`** — closes endpoint page **U1** and pins OD-43's recorded deviation as it is |
| W8 | `POST /api/mcp/token` with `{}` from a cookie-less context | 200 with a token; asserted on its SHAPE only |
| W9 | a notification (`tools/list`, no `id`) | **202** with an empty body |
| W10-W11 | no `MCP-Protocol-Version`; `1900-01-01` | 400 `-32020` with `data.supported`, and 400 `-32022` with `data.supported` **and** `data.requested` |
| W12-W13 | `?x=1`; the fixture role cookie and no bearer | 400 `MCP_QUERY_REFUSED` with an `invalid_request` challenge; 401 — a cookie is not a bearer |
| W14 | `server/discover` with this origin's own `Origin` | 200 with the DiscoverResult |
| W15a-W15b | `tools/call` naming `sirkit.manufacturing.release`, header matching; then header/body disagreeing both ways | 200 `-32602` `"Unknown tool or invalid arguments"` with **no `data`**; 400 `-32020` |
| W16 | a served read with the full shape | a 200 tool result — so W15a's refusal is about the id, not about a malformed request |
| W17 | every response of the run | no body and **no header** carried the token, the secret, a stack frame or a file path — bodies and headers judged SEPARATELY (a raw body is never JSON-escaped first), with ONE file-path pattern shared with W1-W3 whose sight is proven first on a raw single-backslash Windows path, a JSON-escaped one and a POSIX one |

**The live re-read of 2026-09-23 (revision 2026-07-28)** shaped three of those rows and contradicted none of the five
stop conditions. In particular: a modern-only server answering a legacy `GET` or `DELETE` with 405 is a **SHOULD**, not a
MUST, and `OPTIONS` is not mentioned at all — which is exactly why W1-W3 derive rather than assert. The full findings are
recorded as item 8 of `mcp-server-endpoint.md` §11.

**The one configuration edit.** `playwright.config.ts` `webServer.env` gains `SIRKIT_MCP_ENABLED: "1"`,
`SIRKIT_EXPECTED_ORIGIN` built from `PORT`, and a run-time-assembled `SIRKIT_MCP_TOKEN_SECRET`. The literal 3100 appears
nowhere. `SIRKIT_EXPECTED_ORIGIN` moves CSRF resolution from `request-url-local-dev` to `configured`; the value equals the
origin `baseURL` produces, so every existing spec's `Origin` still matches. **The gate is that the four pre-existing
specs stay green in the same Playwright run** — that is the proof, not the argument. No CI workflow edit: `testDir` plus
`testMatch` pick the new spec up inside the existing `page-browser-e2e` job (OD-59 forbids an explicit entry anyway).

**Not in this spec:** the flag-off 404 (one `webServer` per run; B3 case 12 pins it in vitest), any live external server,
and any `SIRKIT_LIVE_MCP_CONTRACT` block (OD-102).

### D3.2b What the wire actually answered — CONFIRMED by measurement, 2026-09-23

The spec ran against `next dev` under the fixture runtime, request-level only, and all eleven cases passed.

| question | answer on the wire |
|---|---|
| unexported `GET /api/mcp` | **405** |
| unexported `DELETE /api/mcp` | **405** |
| unexported `OPTIONS /api/mcp` | **204** |

The two 405s match `app/api/mcp/route.ts`'s own header claim and the transport binding's SHOULD, so **nothing contradicts
the route header and there is no stop for the lead**. The `OPTIONS 204` is a NEW fact: `route.ts` makes no OPTIONS claim,
and the 2026-07-28 transport binding does not mention OPTIONS at all, so Next's App Router answers it itself. It is not a
CORS surface — the application sends no `Access-Control-Allow-*` header anywhere — so no cross-origin browser call can
follow that preflight to a POST, which is still refused by the Origin check. **Recorded for the lead as a follow-up:**
`route.ts`'s header sentence names GET and DELETE only and could name OPTIONS too. That is a comment change in a file D
does not touch (DEC-12).

This settles discovery §8 **UNKNOWN 3** and endpoint page **U2**; W7's 200 settles endpoint page **U1**.

**OD-30's budget, measured, not assumed.** On this machine, measured twice — on 2026-09-23 at the first landing and
again on 2026-09-24 after the review fixes (the second day's runs were slower across the board, which is the machine, not
the spec: the browser cases of `agent-execution` took three to four times longer that day):

| run | specs | cases | wall 2026-09-23 | wall 2026-09-24 |
|---|---|---|---|---|
| the four pre-existing specs | `agent-execution`, `prompt-to-gerber`, `security-headers`, `semantic-editor` | 37 | 261 s | 805 s |
| all five | the four plus `mcp-endpoint` | 48 | 244 s | 818 s |
| `mcp-endpoint` alone | the new spec, request-level only | 11 | 12 s | 10 s |

The new spec adds eleven request-level cases and roughly ten seconds of wall time, all of it the server start; the
four-versus-five difference is below run-to-run variance on either day. The `page-browser-e2e` job's timeout is 30
minutes, so even the slower day's run sits well over twenty minutes inside it — far beyond OD-30's five-minute margin.
**The four pre-existing specs stayed green in the same run as the new one, with the configuration edit in place, on both
days**, which is §7.4's gate. **A side effect recorded for the lead:** the `agent-execution` spec rewrites the twenty B18
evidence PNGs under `artifacts/ai-control-plane-b18/evidence/` on every run; after each wire run they were restored from
HEAD's bytes and verified by blob hash, so no evidence artifact of another chapter moves with D.

### D3.3 Suites and case counts

| suite | cases |
|---|---|
| `app/lib/mcp/server/__tests__/b20-d3-authority-import-gates.test.ts` | 7 |
| `e2e/mcp-endpoint.spec.ts` | 11 |

## 8. The adversarial review of 2026-09-24, and what it moved

Four lenses (regressions, security, coverage, tests) confirmed the findings below against the first landing of D. Every
one was fixed test-first: the strengthened case was run against a deliberate breakage of the production source (restored
by hash afterwards) and recorded as catching it before the fix was accepted. **No production code changed** (DEC-12).

| finding | what was wrong | what now holds |
|---|---|---|
| W1-W3 admitted 200 | the safe set had grown a 200, the one status that means the method is served | `{405, 404, 204, 501}` only; no served-surface key; a 204 has no body |
| W17's pattern needed two backslashes | a raw Windows path in a plain body was missed | one pattern for W1-W3 and W17, its sight proven on three spellings first; bodies and headers judged separately |
| the durable-write spy could not move | the pipeline receives the read-only view, so the repository spy never saw a write; three mutating methods were classed as reads by a prefix regex | both layers counted, classified by the repository's own method names in full; E1c proves every write counter moves; the write claim stated as structural |
| E7(d) never reached the role map | the token was minted before the role change, so the revision check answered 401 first and `[401, 403]` hid it | the unmapped role is set BEFORE the mint: 403 `AUTH_ROLE_UNMAPPED`, no challenge, code asserted; a role moved after the mint is the identical 401 |
| E7(b) was missing | no mid-read revocation sweep | E7b sweeps every served read: `membership_changed`, the result discarded, the re-verifier read exactly once, the next request the identical 401 |
| E9(b) was not a cross-project presentation | its 401 was (a)'s leftover revision move | each presentation in isolation, restored between them; (b) a subject now in another project only; (b') the structural fact that no selector is read, with the board reader's scope recorded |
| E8 never reached the claim checks | every entry kept the original signature | nine re-signed shapes, one with another secret; the verifier's verdict pinned per shape |
| E11 sent 25 of 1 000 spellings, all of one shape | a stride of 40 over an 8-entry vocabulary | every value sent in three shapes (a `_meta` value, an argument KEY, an argument value under a key), coverage asserted; keys, unserved ids and another principal's token id, signature and revision checked too |
| E5 / E4 asserted less than their titles | the re-verifier spy and the reader's scope were never read | the re-verifier 0 on every refusal and 1 on every success; every scope the reader is asked for recorded and compared |
| E2 Partition B had no floor | `read_refused` was admitted for a served read | `dev.sirkit/refusal` empty and `read_served` for all 43 |
| N4 / N5 never read the refusal code | `revision_required` masked a removed argument gate; `read_served` admitted | the current pin sent; `invalid_arguments` / `arguments_invalid` / served pinned per shape |
| D1 case 17 never left `scope_exceeds_row` | the fake named a scope outside the ceiling on every 401 | in-ceiling scopes: one refresh, one step-up, the backoff, `paused` with `retryAtMs` from the constant; the old script is case 17b under its true name |
| D1 case 10(ii) pinned the test seam | `disclosureOf` was injected as a closure; both rows were `permitted` | two rows differing in `agentDisclosure` alone, the harness reading rows through `mcpServerEntry`, the production default pinned as text |
| D1 case 10b's throwing getter never reached the normalizer | a getter serialised by the fake throws inside the fake | the normalizer is asked directly with two accessor shapes: `normalize_failed`, the getter provably read |
| D1 case 11 filtered violations by the sentinel | any violation whose PATH held the peer-chosen key was dropped | the sweep asserted whole; wherever the sentinel survives it is under an untrusted key, asserted with the sweep's own reading |
| D1 case 6a's subject clause was vacuous | no credential row, so no `Authorization` header ever existed | a credential-bearing row echoes the invented value: every call carries a fake-issued token, the echo is `text`, never `withheld_credential` |
| D1 case 8 had no floor | an empty catalog passed | exactly the operator's allowlist, by name; the scrub budget measured; the first tool callable |
| D1 case 16(b) admitted two codes | `listing_failed` or `input_required_unsupported` | `listing_failed`, its sentence, class `result_invalid`, the budget — the asymmetry recorded |
| R1-R3 named an egress code they never observed; R4(a) was refused by a different check; R5 admitted an observation for a failing resolver | the port drops the egress code | the transport-level outcome observed one layer down and pinned per resolver; R4 names `endpoint_mismatch` and exercises the allowlist itself (`host_not_allowed`) |
| G-D4 forbade other gates from ever naming the approval family | a negative text scan | recorded for the base, never asserted; J2 case 2 bound by title |
| GRANTS was an exact list | a new grant module would join no gate | every family by prefix; G-D1 pins today's members; G-D3 probes a module that does not exist |
| G-D3's agent-side probes bypassed the entry rule | invented paths | the real entries probed in place, walked from `entriesOf(CLIENT_HALF)` |
| the page said N2's throwing getter is 200, N1 has fourteen spellings, N4 shapes are "each closed refusals", thirteen tampered shapes, a token "presented against a second project" | page drift | each sentence rewritten to what the suite asserts (§D2.4, §D2.5) |
| "every D case names the case it composes over" | not true of the population cases | reworded in §0; the bound titles listed; B3 cases 5 and 9 and J2 case 2 now bound |

## 9. Citations, as of base 6e3efa7

The anchor is what is checked (it occurs exactly once in its file, or in the body of the function it names); the line is
for the reader and is never checked.

| # | file | line as of 6e3efa7 | within | anchor | what it shows |
|---|---|---|---|---|---|
| C1 | `app/lib/mcp/http-transport.ts` | 999 | — | `allowedHosts: [server.endpoint.host]` | the per-source allowlist is exactly the row's endpoint host |
| C2 | `app/lib/mcp/http-transport.ts` | 1002 | — | `maxRedirects: server.maxRedirects` | the row's redirect rule reaches the egress policy |
| C3 | `app/lib/mcp/http-transport.ts` | 1042 | — | `the egress boundary refused the request (${exchange.code}); nothing was sent.` | `egress_refused` names the CODE, never a host or an address |
| C4 | `app/lib/net/outbound-fetch.ts` | 213 | — | `EVERY address must be public` | one private address among several refuses the whole name |
| C5 | `app/lib/net/outbound-fetch.ts` | 193 | — | `is not an allowed host for this source.` | the allowlist refusal |
| C6 | `app/lib/mcp/observation.ts` | 233 | — | `function forUserOnly(annotations: unknown): boolean {` | the ONE annotation the normalizer reads |
| C7 | `app/lib/mcp/observation.ts` | 313 | — | `blocks.push(block(index, type, "withheld_audience"));` | and it reads it only to withhold |
| C8 | `app/lib/mcp/foreign-tools.ts` | 1172 | — | `return { ok: false, reason: "declared_write", label: name };` | a declared write is refused whatever its hints read |
| C9 | `app/lib/mcp/foreign-tools.ts` | 1111 | — | `const providerNames = new Set<string>(reserved);` | the provider-name set is seeded per CALL: one call is one server |
| C10 | `app/lib/mcp/server-registry.ts` | 32 | — | `/^[a-z0-9][a-z0-9-]{1,30}$/` | no underscore is an admissible server id |
| C11 | `app/lib/mcp/agent-port.ts` | 264 | — | `entry.id === serverId` | the roster row is found by id, never by a provider name |
| C12 | `app/lib/agent/mcp-observation-reads.ts` | 154 | — | `export function externalResultClassOf(code: string, sent: boolean): ExternalResultClass {` | the result-class order: cancelled, authorization_failed, then not_sent |
| C13 | `app/lib/agent/mcp-observation-reads.ts` | 417 | — | `if (this.operationsUsed(input.runId) >= MAX_MCP_NETWORK_OPERATIONS_PER_RUN) return refuse("run_call_limit");` | the fifth call never reaches the port |
| C14 | `app/lib/agent/mcp-observation-reads.ts` | 419 | — | `this.charge(input.runId);` | the operation is charged BEFORE the port is asked, and never refunded |
| C15 | `app/lib/mcp/observation.ts` | 255 | `function judgeText(` | `if (window.length > budget.left) return { disposition: "withheld_budget", shown: null };` | a text block is charged its scan WINDOW, which is why sixteen of them cannot exhaust the budget |
| C16 | `app/lib/engineering/durable-read-bundle.ts` | 105 | — | `claimOutbox: readOnlyRefusal,` | the read-only VIEW the pipeline receives refuses a write without delegating (E1c) |
| C17 | `app/lib/auth/route-handlers.ts` | 1046 | — | `memberships.loadActiveMembership({ tenantId: claims.tenantId, projectId: claims.projectId, userId: claims.subject })` | scope comes from the CLAIMS; no selector is read (E9) |
| C18 | `app/lib/mcp/server/read-call.ts` | 664 | — | `if (recheck === "changed") throw new Refusal("membership_changed");` | a membership revoked during the read discards the result (E7b) |
| C19 | `app/lib/auth/mcp-bearer.ts` | 302 | — | `if (nowMs >= exp * 1000) return refuse("expired");` | expiry alone refuses a token (E9) |
| C20 | `app/lib/mcp/server/read-call.ts` | 525 | — | `if (!gated.ok) throw new Refusal("invalid_arguments");` | the argument gate (step 3) precedes the pin (step 4): N4/N5 send the current pin so it cannot be masked |
| C21 | `app/lib/mcp/agent-port.ts` | 164 | — | `if (code === "egress_refused") return of("transport_failed", false);` | the port folds every egress refusal and drops the egress code (R1, R4, R5) |
