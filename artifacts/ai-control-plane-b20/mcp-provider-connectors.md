# Provider-native MCP connectors (B20-A5) — refused as policy

Labels: **CONFIRMED** (read at the cited file:line, or executed and measured), **INFERRED** (reading-based conclusion),
**RECORDED** (written down without a claim), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**.

Line numbers are of the A5 working tree (2026-09-23) on `chapter/b20-mcp-adapter`. A5 moved lines in
`app/lib/agent/adapters.ts` (a header paragraph, one import and six lines inside each normalizer, so everything from
line 20 on shifted) and in `app/lib/llm/errors.ts`. Those two files are cited by line on four earlier pages, so those
citations shifted too. Re-pinned in this change and gated by T7:
`artifacts/ai-control-plane-b18/chat-execution-ux.md:26` (`adapters.ts`),
`artifacts/ai-control-plane-b18/safe-mutation-contract.md:209` (`adapters.ts`),
and `artifacts/ai-control-plane-b19/import-security-matrix.md:407` (`adapters.ts`), `:479` (`adapters.ts`), `:765` (`adapters.ts`). `artifacts/ai-control-plane-b20/discovery.md:105` (`adapters.ts`) is the lead's file, and its re-pin —
the two fixture-adapter imports move from lines 42-43 to lines 58-59 — is handed over with this increment.

## Decision

- **Nothing is rendered (OD-90).** Sirkit renders NO provider-native MCP connector in B20: no OpenAI Responses MCP tool,
  no Anthropic MCP connector and no MCP-connector beta header, for any server, row, role, provider or flag state. No
  feature flag enables one and no new environment variable exists. An external MCP server reaches a model only through
  Sirkit's own client and A4's one Sirkit-mediated observation read:
  `app/lib/engineering/tool-catalog.ts:497` (`sirkit.mcp.observation-read`). **CONFIRMED** (absence, by the gates below).
- **No credential reaches a provider (OD-45).** No credential Sirkit holds or can obtain for an MCP server — an access
  token or client secret read by environment NAME, a token A3's client obtains, or a Sirkit-issued MCP bearer token —
  is ever placed in a provider request, in any field, header, URL or message. **CONFIRMED** (structurally; see the
  stated limits).
- **Unrequested output fails the run closed (OD-91).** A provider response carrying an output item the agent adapters did
  not request stops the run before anything of it is used: a well-formed item outside the handled set fails
  `provider_unrequested_output`, and a malformed one fails `provider_unknown`.
  Read the two halves apart:
  a malformed list fails `provider_unknown` as it did before A5
  — a non-array `output` or `content` already raised a TypeError inside the adapter's `try` — but
  a malformed ITEM now fails the run too,
  which is a DELIBERATE fail-closed change and not parity. Before A5 the adapters' filters skipped any entry that was
  not a `function_call` / `text` / `tool_use` and round-tripped it verbatim into the continuation, so an entry with a
  non-string, inherited-only, over-long or non-token `type` — and a list past the item cap — completed the step.
  **CONFIRMED**.
- **A reversal has written conditions (OD-92).** What any future connector would have to meet is recorded below. It is
  not implemented, and none of it is code.

This closes **D20-29** as policy. The live behaviour of both connectors stays **BLOCKED-LIVE-QUALIFICATION** (OD-7,
LB-2: there are no provider credits). It supports program scenario 15 ("without credential or project leakage") on the
provider-native side.

## Provider facts

Fetched live on 2026-09-23 and recorded verbatim, with the six labels per provider, in
`artifacts/ai-control-plane-b20/mcp-reference-notes.md:221` (`Re-read of 2026-09-23`). What follows is the summary the
decision rests on.

- **P1. Anthropic's connector.** Beta header `mcp-client-2025-11-20` (or the newer `mcp-client-2026-09-15`, which
  "includes everything" the former does); Streamable HTTP and SSE; tools only; remote HTTPS only; `authorization_token`
  supplied by the API consumer, who runs OAuth themselves. **CONFIRMED (notes)**.
- **P2. OpenAI's connector.** The Responses `type: "mcp"` tool; Streamable HTTP or HTTP/SSE; the page names MCP revision
  2025-03-26; `authorization` is not stored; `require_approval` takes `"always"`, `"never"` or an object; the other
  fields are `allowed_tools`, `server_label`, `server_description`, `server_url`, `tunnel_id`, `connector_id` (legacy)
  and `defer_loading`; the output items are `mcp_list_tools`, `mcp_call` and `mcp_approval_request`, answered by an
  `mcp_approval_response` input item. **CONFIRMED (notes)**.
- **P3. Both connectors are handshake-era**: 2025-11-25 and earlier, never 2026-07-28. **CONFIRMED (notes)**.
- **P4. The provider opens the connection itself** and performs the calls; results enter the model's context inside the
  provider's own turn. **INFERRED** from P1's remote-only, consumer-token design and P2's item names.
- **P5. Anthropic has no per-call approval control.** The only control is which tools are enabled; the page recommends
  disabling write tools "when you want a human confirmation step before state changes". **CONFIRMED (notes,
  2026-09-23)**.
- **P6. OpenAI waits for an approval it never gets from a human here.** With approval required the provider emits
  `mcp_approval_request` and continues only after the API consumer sends `mcp_approval_response`. The names and values
  are **CONFIRMED (notes)**; the wait semantics are **INFERRED**.
- **P7. Live behaviour of both connectors is BLOCKED-LIVE-QUALIFICATION.** There are no provider credits.
- **P8. Anthropic's consumer-pinned listing.** Under `mcp-client-2026-09-15` the consumer may copy a server's tool list
  into the toolset's `tools` field, and the API then does not ask the server for its tools. It does not move tools/call:
  the provider still opens the connection and runs every call. **CONFIRMED (notes, 2026-09-23)**; new since 2026-09-17.

## Why no connector can sit behind the same policy

Runbook line 716 permits a provider-native connector only "behind the same policy". That cannot be met, because Sirkit's
controls run in Sirkit's own request path — not in the provider's.

| # | the control | where Sirkit enforces it | what a connector does instead | label |
|---|---|---|---|---|
| M1 | descriptor gates and the reviewed pin; the untrusted label | `app/lib/mcp/tool-discovery.ts:350` (`descriptor_pin_mismatch`); `app/lib/mcp/foreign-tools.ts:457` (`untrusted: true`) | the provider lists the tools itself (P4) over the handshake era (P3), so the pin binds a read the model never sees; two of OD-81's three guarantees are lost. Anthropic's consumer-pinned listing (P8) narrows this for that provider alone | INFERRED |
| M2 | A4's normalisation, withholding, disclosure projection, quarantine and per-run budget | `app/lib/agent/mcp-observation-reads.ts:333` (`disclosureOf`); `app/lib/mcp/observation.ts:471` (`normalizeMcpToolResult`) | results reach the model inside the provider's turn, unprojected and unrecorded | INFERRED |
| M3 | A0/A1 admission, per-process meters, breaker, endpoint and address checks; OD-75's argument screen | `app/lib/mcp/server-registry.ts:307-317` (`admittedMcpServer`); `app/lib/mcp/agent-port.ts:217` (`mcpAgentToolAllowlist`) | requests leave from the provider; model-authored arguments reach the server unscreened and unmetered | INFERRED |
| M4 | the loop's sanitiser and the run trace's attribution | `app/lib/agent/redaction.ts:51-55` (`sanitizeModelBoundText`); `app/lib/agent/loop.ts:86` (`sanitizeModelBoundText`) ([PR-D, 2026-10-17] line 85 until `535760f` inserted a line above it; T6 resolves it) | provider-run output is never sanitised and never attributed; the continuation is opaque by construction | CONFIRMED (code) / INFERRED (consequence) |
| M5 | human approval | none exists for a provider-run call; the adapter reads only function calls, `app/lib/agent/adapters.ts:77-79` (`judgeProviderOutput`) | OpenAI waits for an `mcp_approval_response` (P6) — an answer from Sirkit would be silent approval; Anthropic has no per-call approval at all (P5) | INFERRED |
| M6 | credentials stay server-side | `app/lib/mcp/http-transport.ts:995` (`Authorization`) — a row's token travels only as a Bearer header to that row's endpoint | a non-`none` row needs `authorization_token` (Anthropic) or `authorization` / `tunnel_id` (OpenAI). That is forwarding, which runbook lines 636 and 716 forbid | CONFIRMED (fields, rules) |

## The closed refusal

`providerConnectorVerdict` states the refusal in closed codes for every input: `app/lib/mcp/provider-connector-policy.ts:129-162` (`providerConnectorVerdict`).
Its vocabulary is closed at fourteen codes, in this order: `app/lib/mcp/provider-connector-policy.ts:27-42` (`PROVIDER_CONNECTOR_REFUSALS`).
Each carries one fixed sentence: `app/lib/mcp/provider-connector-policy.ts:64-79` (`PROVIDER_CONNECTOR_SENTENCES`).
The verdict admits only `"refused"`.

| code | class | when it is added | decision |
|---|---|---|---|
| `connectors_refused` | decision | always | OD-90 |
| `provider_unrecognised` | input | the provider is neither `"openai"` nor `"anthropic"` | OD-90 |
| `provider_reads_server_directly` | mechanism | always (M1) | OD-90 |
| `results_bypass_observation` | mechanism | always (M2, M4) | OD-90 |
| `egress_bypasses_sirkit` | mechanism | always (M3) | OD-90 |
| `calls_not_traced` | mechanism | always (M4) | OD-90 |
| `handshake_era_only` | mechanism | always (P3) | OD-41 |
| `no_human_approval` | provider | the provider is one the agent adapters serve (M5) | OD-90 |
| `live_behaviour_unqualified` | mechanism | always (P7) | OD-7 |
| `server_not_admitted` | row | no row, a violation naming the row, or admission refuses it | OD-48, OD-54 |
| `credential_required` | row | the row's auth mode is not `none`, or it references a secret | OD-45 |
| `descriptors_unpinned` | row | the row pins no tools/list digest | OD-48 |
| `disclosure_not_permitted` | row | the row's `agentDisclosure` is not `permitted` | OD-36 |
| `no_agent_tools` | row | the row's `agentTools` approves no usable tool, so no tool of it is agent-callable | OD-74 |

The row half is judged whatever the admission says, so one answer names every reason at once. It judges five row facts,
A4L's per-tool allowlist included: a row whose `agentTools` approves nothing is a row Sirkit's own agent roster drops
outright (`app/lib/mcp/server-registry.ts:129` (`agentTools`); `app/lib/mcp/agent-port.ts:253` (`mcpAgentToolAllowlist`)),
and a vocabulary that could not say so would report a row Sirkit itself refuses as carrying no row-level obstacle at all.
The id is echoed only for a row that was FOUND and that validates with no violation naming it: a pattern-valid id can
still be shaped like a secret: `app/lib/mcp/server-registry.ts:34` (`MCP_SERVER_ID_PATTERN`) and
`app/lib/mcp/server-registry.ts:366-368` (`isMcpSecretShapedText`), and such a row's id never reaches the verdict. The lookup is attempted only for a string
within the id pattern's length (`app/lib/mcp/provider-connector-policy.ts:103` (`SERVER_ID_MAX_CHARS`)), judged before
any pattern runs.

## What enforces it

The policy module enforces nothing and has no production caller. What makes the decision true is structural.

- **The response side — the guard.** It is pure, imports nothing and never throws: `app/lib/agent/provider-output-guard.ts:58-81` (`judgeProviderOutput`).
  The handled OpenAI output item types: `function_call`, `message`, `reasoning` — `app/lib/agent/provider-output-guard.ts:15` (`OPENAI_HANDLED_OUTPUT_TYPES`).
  The handled Anthropic content block types: `redacted_thinking`, `text`, `thinking`, `tool_use` — `app/lib/agent/provider-output-guard.ts:22` (`ANTHROPIC_HANDLED_BLOCK_TYPES`).
  A list holds at most 1 024 items, its count read once before any item: `app/lib/agent/provider-output-guard.ts:67` (`PROVIDER_OUTPUT_ITEMS_MAX`).
  Each item's `type` is an OWN property: `app/lib/agent/provider-output-guard.ts:72` (`Object.hasOwn`).
  It is at most 64 characters, judged before any pattern or comparison: `app/lib/agent/provider-output-guard.ts:74-75` (`WELL_FORMED_TYPE`).
  That bound exists only so the pattern never runs on an unbounded string, never to decide WHETHER a type is provider-run.
  It was 32, which is shorter than the two text-editor code-execution result blocks the installed Anthropic SDK declares
  (38 and 44 characters) — exactly the provider-ran-a-tool-on-its-own items OD-91 detects — so those were classified as
  shape faults and failed `provider_unknown` instead of `provider_unrequested_output`:
  `app/lib/agent/provider-output-guard.ts:24-33` (`PROVIDER_OUTPUT_TYPE_MAX_CHARS`).
  Items are judged in order and the FIRST unhandled item decides the kind. `thinking` and `redacted_thinking` are opaque
  continuation content the code base already refuses to persist: `app/lib/agent/replay-capsule.ts:151` (`redacted_thinking`) ([B21 F, 2026-09-28] re-pinned from line 125: the capsule v4 grew the file above it).
  B09 names `thinking` as preserved: `artifacts/ai-control-plane-b09/provider-continuation-matrix.md:8` (`thinking/tool_use blocks preserved verbatim`).
- **The response side — the adapters.** Each adapter reads its list ONCE and judges it before reading any other field of
  the response, then uses only that local for tool calls and for the continuation:
  `app/lib/agent/adapters.ts:74-80` (`normalizeOpenAIStep`) and `app/lib/agent/adapters.ts:175-181` (`normalizeAnthropicStep`).
  The error carries no cause, no provider status, no provider code and no provider message, only one fixed sentence:
  `app/lib/llm/errors.ts:47-48` (`unrequested_output`).
  The run then fails `provider_unrequested_output`, or `provider_unknown` for a malformed list: `app/lib/agent/loop.ts:774` (`provider_${error.reason}`). [PR-F lead, 2026-10-17] 773 -> 774 (the PR-F loop additions). [PR-D, 2026-10-17] Both loop citations on this page moved in place, line 85 to 86 and 767 to 773: `535760f` (product reliability A+B, 2026-10-14) inserted lines in `app/lib/agent/loop.ts` above them, and T6 of `b20-a5-connector-tripwires` resolves both (red at `535760f`).
  The trace's closed vocabulary admits it: `app/lib/agent/trace.ts:108-111` (`PROVIDER_REASON_PATTERN`).
  The run-failure card offers Retry / Switch, as for every provider failure: `app/lib/agent/run-consumer.ts:19-21` (`isRecoverableProviderFailure`).
  It is not automatically retryable: `app/lib/llm/errors.ts:151-153` (`isRetryableReason`).
- **The request side — the shapes, pinned at run time.** Both agent adapters render FUNCTION TOOLS ONLY:
  `app/lib/agent/provider-tools.ts:352-359` (`renderOpenAiResponsesTool`) and `app/lib/agent/provider-tools.ts:369-376` (`renderAnthropicAgentTool`).
  Their request key sets are closed (eleven keys for OpenAI, six for Anthropic) and their client types are narrowed to
  one SDK surface each: `app/lib/agent/adapters.ts:65` (`Pick<OpenAI, "responses">`) and `app/lib/agent/adapters.ts:167` (`Pick<Anthropic, "messages">`).
  Every create call passes options `{ signal }` alone. The ratchet drives both adapters over the whole agent-exposed
  declaration set plus a foreign-shaped one and refuses any connector vocabulary in the serialised request.
- **The request side — the tripwire.** No production source file carries a connector wire spelling: the body fields and
  item types case-sensitively, the header names, header values and provider hosts case-folded, and three patterns
  (a `type: "mcp"` tool entry, a `.beta.` SDK surface, a `betas` array). There is no allowlist; any hit is a reviewed pin
  move.
- **The request side — the importer, closure and constructor gates.** Exactly five production modules import a provider
  SDK at run time, none of them reaches `app/lib/mcp/**` or `app/lib/auth/mcp-bearer.ts` through its runtime import
  closure, and every provider client is constructed with only `apiKey`, `maxRetries` and `timeout` — never
  `defaultHeaders`, `defaultQuery` or `baseURL`: `app/lib/agent/adapters.ts:112` (`new OpenAI(`) and `app/lib/agent/adapters.ts:213` (`new Anthropic(`). [B24-B3, 2026-10-08] Six since B24-B3: the record-only model-in-loop command's contract-turn clients, `app/lib/evaluation/live-contract-clients.ts` (`new OpenAI(` and `new Anthropic(`, each with only `apiKey`, `maxRetries: 0` and `timeout`; it reaches neither `app/lib/mcp/**` nor the bearer module, and no route reaches it), so T2 counts six importers and T4 eight constructions (OD-125, OD-216).
- **The statement.** Its only runtime import is the registry: `app/lib/mcp/provider-connector-policy.ts:19` (`./server-registry`).
  It has no production importer, its verdict type admits only `"refused"`, and it is pure, frozen and byte-deterministic.
- **B09's continuation matrix is unchanged and still true.** Its conversation-state row reads "continuation input = prior
  items + EVERY output item of each response, appended verbatim":
  `artifacts/ai-control-plane-b09/provider-continuation-matrix.md:7` (`appended verbatim`). Since A5 that describes an
  ACCEPTED response: a response carrying an unhandled or malformed item is refused before any continuation is built, so
  nothing of it is preserved and no continuation exists for it. Every response that does produce a continuation still
  carries every one of its output items.

## OD-92 — the conditions any future connector must meet

Recorded, not implemented. If OD-90 is ever reversed, a connector may be rendered only when all of the following hold,
each proven by test.

**Enablement.** (1) Its own flag, exactly `"1"`, on top of `SIRKIT_MCP_ENABLED`; both off by default; never for an
operator-disabled id. (2) An approved, valid row with `auth.mode: "none"` and no secret reference,
`agentDisclosure: "permitted"`, a non-null `descriptorPin` and a NON-EMPTY `agentTools` — A4L's per-tool allowlist is
fail closed and a row that approves no tool is no roster row at all
(`app/lib/mcp/agent-port.ts:253` (`mcpAgentToolAllowlist`)). (3) OpenAI only: Anthropic stays refused until its live
documentation shows a per-call approval control (P5).

**The rendered request.** (4) The server URL byte-equal to the row's `canonicalUri`, which by construction carries no
query and no userinfo — so a tunnelled or provider-hosted server shape, which carries no server URL of its own to
compare, is refused outright rather than judged by this condition. (5) The server label equal to the row id. (6) The
allowed-tool list exactly the sorted INTERSECTION of the row's `agentTools` allowlist with a `listMcpTools` listing of
that row that is pinned and not truncated, taken in the same run before each provider request: the operator's approval
names the tools, never the server alone, so rendering the whole listing would offer tools no one approved.
(7) Approval required on every call. (8) No header field, no authorization field, no tunnel reference (`tunnel_id`) and
no provider-hosted connector id (`connector_id`) — the connector reaches the server only by the row's own canonical
https URL, and `tunnel_id` is a second credential-bearing field (M6), not merely another way to name a server.

**Approval.** (9) Every approval request answered only by a human, through a run-stream surface that shows the server,
the tool and the arguments after OD-75's screen, bound to the run, the call and the arguments digest. Sirkit never
answers one itself.

**Integrity and withdrawal.** (10) The rendered object deep-frozen and byte-deterministic, its digest in the trace.
(11) A pin mismatch, an unpinned or truncated listing, an `agentTools` change that empties the allowlist, the flag off
or an operator-disabled id withdraws the connector before the next provider request. (12) OD-91 admits the resulting
provider items only for that run's rendered server.
(13) Live qualification (LB-2) before any production use.

**Residuals the owner would be accepting** (RECORDED): the provider's own listing read is not the one Sirkit pinned
(unless the provider supports a consumer-pinned listing, P8); results reach the model without A4's normalisation and
disclosure projection; the calls bypass Sirkit's admission, meters, breaker and address checks; and the trace attributes
them only through the rendered connector's digest and the admitted output items, not by Sirkit-side server, tool and
version records.

## Sirkit's own endpoint and provider-hosted clients

A5 governs what Sirkit SENDS to a provider. It does not govern what a member does with Sirkit's own MCP endpoint.

- A member could paste a Sirkit-issued MCP token into a provider's connector outside Sirkit. That is bearer semantics
  under OD-43, and the endpoint's own controls apply (OD-65). **RECORDED** as a limit.
- A handshake-era client cannot call Sirkit's modern-only server anyway: an absent or unsupported protocol version is
  refused at the protocol check (`app/lib/mcp/server/protocol.ts:171-174` (`UNSUPPORTED_PROTOCOL_VERSION`)).
  **INFERRED**; live behaviour BLOCKED-LIVE-QUALIFICATION.
- No handshake-era server support is added here (OD-41's alternative stays unexercised).

## Limits

RECORDED. Each is a place the gates above do not reach.

- **The tripwire reads source text.** A token assembled at run time escapes it. The two agent adapters are covered at run
  time by the request-shape ratchet; the other four SDK modules are covered by the lexical, importer, closure and
  constructor gates only.
- **A direct environment read escapes the gates.** A provider-SDK module reading `process.env[<name>]` for a credential
  needs no connector token and no MCP import. The closure gate forbids the MCP modules that hold the names and the
  values; a literal read is not caught.
- **Raw fetch without the SDK.** A module calling a provider host without the SDK is caught only through the host tokens
  of the lexical tripwire.
- **Where the guard runs.** Only in the two agent adapters. It does not run on the non-agent generation path, the parts
  rerank or embeddings — none of which declares a tool a provider could run.
- **Item-level reads.** The list is read once and shared by the guard and the normalisation, but each item's `type` is
  read again when normalising. SDK responses are parsed JSON (INFERRED), so this matters only for a non-JSON object.
- **Future provider items.** The closed type sets may refuse a benign item a provider adds later; the run then fails as a
  recoverable provider failure. A hyphenated or non-lower-case type, and one past the 64-character bound, are treated as
  shape faults and fail `provider_unknown` rather than `provider_unrequested_output`, so the trace reason and the user's
  sentence do not distinguish them from a garbled response. The bound is set well clear of the longest type either SDK
  declares today. [B20 A5 lead] That longest is 45 characters, `text_editor_code_execution_str_replace_result`, and it is
  nested in a tool-result content union rather than the top-level output union, so it never reaches the guard; 44 was the
  longest measured among the types that can. A provider that later spells one longer would lose that distinction. Live
  behaviour is BLOCKED.
- **A malformed item is a behaviour change, not parity.** Before A5 a malformed ITEM inside a well-formed list completed
  the step and was round-tripped into the continuation; it now stops the run. Only a malformed LIST behaves as it did
  before A5.
- **Spent tokens.** A refused response's tokens are spent, and its usage is not recorded.
- **Account-level connectors.** Whether either provider can hold a connector configured on the account, outside any
  request, is UNKNOWN: neither page documents one. The guard refuses its items on the agent path whatever the answer.
- **Sirkit's own endpoint.** As above.

## Evidence

Four suites, all under the `app/lib/mcp` directory filter of the prompt-to-gerber job
(`.github/workflows/deterministic-manufacturing.yml:132` (`app/lib/mcp`)), so no workflow entry was added. [B24-D0, 2026-10-09] Since OD-30's split the filter line stays at `:132` (`app/lib/mcp`) while prompt-to-gerber excludes it and the four suites run in the appended `agent-boundary-suites` job (ci-split.md). [B24-D2, 2026-10-09] Both citations moved in place from line 131 to 132: B24-D1's start step (workflow line 32, `3d5f225`) shifted the filter line by one, and T6 of `b20-a5-connector-tripwires` resolves both (red at `3d5f225`).

- `app/lib/mcp/__tests__/b20-a5-provider-connector-policy.test.ts` — 10 cases
- `app/lib/mcp/__tests__/b20-a5-provider-request-shape.test.ts` — 4 cases
- `app/lib/mcp/__tests__/b20-a5-provider-output-guard.test.ts` — 13 cases
- `app/lib/mcp/__tests__/b20-a5-connector-tripwires.test.ts` — 7 cases

A5 total: 34 cases. [B20 A5 lead] The tenth policy case is the review's residual: the policy judges A4L's `agentTools`
with its own copy of the rule, so that copy is now pinned to agree with `mcpAgentToolAllowlist` over fourteen shapes a
registry row can hold (dropping the count bound from either copy fails it).

The request-shape ratchet and the tripwires T1-T3 pin EXISTING behaviour and were green before any A5 code; the guard,
the policy, T4's two new-module pins and the three page checks (T5, T6 and the review's T7) were red first.

## BLOCKED-LIVE-QUALIFICATION

Nothing about either connector's live behaviour is claimed here. No provider request was made, no MCP server was
contacted, and no credential was read. The refusal is a decision plus its structural proof; the live behaviour of the
Anthropic MCP connector and of the OpenAI MCP tool stays unqualified until LB-2 lifts (OD-7).
