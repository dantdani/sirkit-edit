# B24-C1 - Observability and replay, part 1: the durable run trace and the LLM call record

Labels: **CONFIRMED** (executed here and measured, or read at the cited file:line), **INFERRED** (code reading, nothing executed),
**PROPOSED** (designed, not exercised), **RECORDED** (written down without a claim of our own), **UNKNOWN**,
**BLOCKED-LIVE-QUALIFICATION** (needs a live resource the owner has not supplied; never faked, never claimed).

Base: `a405db9` on `chapter/b24-production-qualification` (B24-A1..A4, B1, B2 and B3 committed). B24-C1 closes D24-20 and D24-21 offline
(runbook B24-C `:1074` "Ensure provider-neutral traces capture:", of which C1 persists what the trace already holds and records `:1079`
"provider/model identity;", `:1084` "retries/cancellation/errors;" as outcome classes and part of `:1085` "token/cost/latency budgets;";
`:1088` "Do not store hidden reasoning. Redact secrets and sensitive source content. Replay against immutable snapshots must never mutate
current state unless a new explicit approval begins a new transaction."; `:1044` "Never reuse production data in tests."; OD-207 applied,
OD-231 the choices beyond it; LB-13, LB-14). It was delivered in one workflow run in two halves for one commit by the lead (lead decision
D21): B24-C1a, the durable run trace (sections 1-3), then B24-C1b, the LLM call record (sections 4-6). Every line number on this page is
the B24-C1 working tree's unless it names another tree. Parts 2 and 3 of this page are B24-C2's and B24-C3's.

## 0. What B24-C1 is

- **What it is.** Two durable records on the durable-workflow substrate, each written only after the work it records has ended and
  never read by any route, tool or page (readers are B24-C3's, OD-211):
  - `agent.run-trace.v1` (`app/lib/observability/run-trace-store.ts`): the chat route's finalized, validated
    `sirkit.agent-run-trace.v1` document, one record per trace in one aggregate per (scope, run id), bound at the chat composition root
    (`app/api/chat/trace-runtime.ts`, imported on `app/api/chat/route.ts:40`) through the recorder's injection point
    `setAgentTraceSinkFactory` - no B11-scanned file is edited (section 2);
  - `llm.call-record.v1` (`app/lib/observability/llm-call-record-store.ts`): one `sirkit.llm-call-record.v1` per provider call made
    inside the 22 model-egress paths other than `/api/chat`, through ONE seam (`app/lib/observability/llm-call-record.ts`) at the four
    provider-call points, scoped by the three route wrappers, bound by `instrumentation.ts` (section 4).
- **What it is not.** No route, agent or MCP tool, action record, UI control, environment name or flag, migration or dependency (OD-42):
  the census stays 168 / 165 / 3 / 0, the tool counts 47 / 36 / 9 / 27, the action records 107, the migrations 32 (the durable-workflow
  tables carry both aggregates), the classification CSV byte-identical (OD-231 (b)), `.env.example` unchanged. No content is kept: no
  prompt, answer, query, embedding text, tool argument, provider message or request id, principal, cost or key (a trace warning may carry
  up to 80 characters of a model-chosen tool name, section 12). The nine B11-scanned
  files keep their sha256 (`b21-e2b-trace-attribution.test.ts:42-53`). Nothing reads either record, nothing purges either (B24-C2,
  OD-202), and no attribution field is added (B24-C2, OD-208, OD-209).
- **What the builder did not run.** No `next dev`, `next build`, `next start` or Playwright; no database but PGlite in the test process;
  no provider, model, host or account. Every live half is **BLOCKED-LIVE-QUALIFICATION** (section 9).

## 1. The pre-edit counterexamples (red first; **CONFIRMED**)

Both halves were written test-first on `a405db9` before any production line moved:

- **The suites failed to load.** `b24-c1-durable-trace` and `b24-c1-durable-records-pglite` (C1a's two) failed with "Cannot find module
  `@/app/lib/observability/run-trace-store`" (and its relative form); `b24-c1-llm-call-record` (C1b) failed with "Cannot find module
  `@/app/lib/observability/llm-call-record`" once C1a was in place.
- **The behavioural counterexamples** were run alone on `a405db9` from a temporary probe suite (deleted after its run; its log is kept
  outside the repository): P1, a completed chat request under the fixture runtime (`run-51df2da6-…`), left **0** `agent.run-trace.v1`
  heads in the fixture's in-memory repository (expected 1); P2, a public parts search under the fixture runtime, made its embedding call
  (counted by a fake `openai` SDK, `>= 1`) and left **0** `llm.call-record.v1` heads in the reserved operator scope (expected 1). Both
  cases are kept, green, as `b24-c1-durable-trace` 1 and `b24-c1-llm-call-record` 4.

## 2. The durable run trace (D24-20, OD-207; **CONFIRMED** in memory and on PGlite)

- **What is kept.** The finalized, validated `sirkit.agent-run-trace.v1` document of every run that reaches the chat route's recorder
  (`app/api/chat/route.ts:437-465`): identities, digests, closed classes, usage counts and bounded warnings (secret patterns replaced,
  300 characters each, 32 at most; a warning may carry up to 80 characters of a model-chosen tool name, `app/lib/agent/loop.ts:414`, now
  durable with the trace - review round 2, security-5, section 12) - never a prompt, an answer, a provider body or hidden reasoning (the
  v1 contract, `app/lib/agent/trace.ts:5-13`). The record `sirkit.agent-run-trace-record.v1` has exactly `schema`, `runId`, `traceId`,
  `revision`, `at`, `digest` (`agentRunTraceDigest`) and `document`.
- **Where.** On the durable-workflow substrate (`durable_workflow_records` / `_heads` / `_replays`), as the aggregate
  `agent.run-trace.v1`: one aggregate per (scope, run id), key `durableWorkflowId("agent-run-trace", { ...scope, runId })` with the scope
  as the substrate stores it (NFC, trimmed; review round 2, security-1); PostgreSQL in production, the fixture runtime's in-memory
  repository under the fixture runtime. A resume reuses its run id
  (`app/api/chat/route.ts:367`), so a run's aggregate is a history: one record per trace id, in revision order (`b24-c1-durable-trace` 4:
  B21-E3's scenario 17, revisions 1 and 2 under one run id).
- **When.** After the recorder has validated the document and handed it to the sink (`trace-recorder.ts:586-593`): `complete` schedules
  one append and returns; the append starts on a later microtask, at the server clock (`app/api/chat/trace-runtime.ts:67`).
- **By whom it is bound.** `app/api/chat/trace-runtime.ts` calls `setAgentTraceSinkFactory(durableRunTraceSinkFactory)` once, when it is
  evaluated (`:115`); the chat route imports it on its line 40 (`import "./trace-runtime";`, appended in place after the recorder's own
  import - the B23-B2 precedent). Binding through the recorder's injection point is no edit to a B11-scanned file (discovery section 0).
  The production store factory resolves `getDurableWorkflowRepository()` lazily at write time (`:41`), so importing the route builds no
  database client; the module constructs no repository of its own (the one `new PostgresDurableWorkflowRepository()` stays
  `app/lib/durable-workflow/runtime.ts:19`, pinned by `b24-c1-durable-trace` 11 and `b24-c1-llm-call-record` 12).
- **The store** (`app/lib/observability/run-trace-store.ts`, pure: its runtime imports are `../durable-workflow/stable`,
  `../agent/trace` and `../engineering/stable`): each append is a compare-and-set commit with `outbox: []` (`:136`), idempotency key
  `agent-run-trace:<runId>:<traceId>`, scope key `durableScopeKey(scope, "agent-run-trace:<runId>")`; a stale revision (or a PostgreSQL
  unique-index refusal) is retried on the new head at most `casAttempts` (8, `:34`) times, then answers `stale_exhausted`. A document
  `validateAgentRunTrace` refuses, or whose scope the substrate would refuse (`invalid_document`), a scope other than the document's own
  (`scope_mismatch`) and a time that is not an ISO-8601 instant (`invalid_time`) write nothing (`:36`). Since review round 2 (security-1)
  scopes are compared and keyed as the substrate stores them (NFC, trimmed: `canonicalDurableScope`), so an id that differs only by
  surrounding whitespace names the same aggregate and `history` finds it through either form (`b24-c1-durable-trace` 6, 15;
  `b24-c1-durable-records-pglite` 6); before, such a document was a `scope_mismatch` - a refusal the chat route cannot reach, since its
  context assembler refuses an id outside its identifier rule before any run id or recorder exists (`app/lib/agent/context.ts:268-270`,
  400 `projectId is not a well-formed identifier`; case 15), so the move is defense in depth. The same trace id again answers from its
  replay. `history(scope, runId)` re-verifies every record: the aggregate key and scope, the revision order, the closed keys, the record
  digest, the trace digest, the document's validation, its run id, trace id and scope; any disagreement is one closed error,
  `AGENT_RUN_TRACE_MISMATCH`, that echoes nothing of the row (`b24-c1-durable-trace` 6: eight tampers; `b24-c1-durable-records-pglite` 3:
  a direct row edit on PostgreSQL).
- **Concurrency on PGlite.** Two concurrent appends of one run serialize to revisions 1 and 2, one row each, the head at 2
  (`b24-c1-durable-records-pglite` 4). RECORDED limit (the B23-B2 statement): PGlite is one connection running one transaction at a time,
  so the case proves the revision and replay paths, not two interleaved server transactions.
- **The stream does not change.** With the durable sink bound and with a run-local in-memory sink the flag-off stream is the same bytes,
  B21-B's digest recorded from HEAD `4b6d0e2` (`eng1-656c2588b836c043`; `b24-c1-durable-trace` 5); a failed (provider network), a
  cancelled (Stop while the turn hangs), a Tier 3-refused (no provider call) and a breaker-paused run (no provider call) each keep one
  record whose terminal is the stream's (case 3).

## 3. The import gate (section 7; **CONFIRMED** by AST, `b24-c1-durable-trace` 11 and 12)

Measured first at `a405db9` (`scratchpad` measurement, read-only): the runtime closures of `app/lib/agent/loop.ts` (155 files),
`gateway.ts` (226), `trace.ts` (9) and `trace-recorder.ts` (10) reach none of `app/lib/durable-workflow/runtime.ts`,
`server-repository.ts` or `app/lib/db/client.ts` - so no STOP. After C1a, through `_import-gate-helpers` and `_import-closure`:

- the closures of the loop, the gateway, the trace contract, the recorder and `run-trace-store.ts` contain none of the durable runtime,
  the server repository, the database client or `trace-runtime.ts`;
- `trace-runtime.ts` has exactly one production importer, `app/api/chat/route.ts`, and the edge sits on its line 40 (the line-start
  regex walker of `b19-d-external-text-injection-route` does not see an import appended mid-line, so the edge is pinned here);
- `run-trace-store.ts`'s production importers are `trace-runtime.ts` and modules under `app/lib/observability/` only - no module under
  `app/lib/agent/` or `app/lib/mcp/` and no route file (the route tree's own enumeration) imports it;
- the runtime imports of both modules are exactly the reviewed ones;
- injected probes are caught with their chains (a loop-side value import of `trace-runtime`, through it the durable runtime; a store-side
  import of the durable runtime; an MCP module importing the store), and a type-only import is not;
- the chat route keeps its 562 lines and B21-E4's markers at 35, 504 and 507 (`b21-e4-page`'s pin); one line names `trace-runtime`.

## 4. The LLM call record (D24-21, OD-207; **CONFIRMED** in memory and on PGlite)

- **The record** `sirkit.llm-call-record.v1` (`app/lib/observability/llm-call-record.ts`, pure: `node:async_hooks`, `node:crypto`,
  `../llm/types`, `../llm/errors`) has exactly `schema`, `callId` (`llmc-<uuid>`), `requestRef` (`llmr-<uuid>`, shared by every call of one
  request), `seq` (1..N as the request's calls start), `routeId` (the exact policy path, never the raw URL), `method`, `provider`,
  `model`, `kind` (`generate`, `stream`, `embedding`, `rerank`), `inputTokens`, `outputTokens` (`null` when the SDK reports none: an
  embedding's output, and every failed call), `latencyMs` (monotonic, `performance.now()`), `outcome` (`completed` or one of the twelve
  `LLMProviderFailureReason` values of `app/lib/llm/errors.ts:3-16`, classified by `toProviderError`: thirteen classes) and `startedAt`.
  `model` is the answer's model on success and the configured model on failure (the router passes `configuredOpenAIModel()` or
  `configuredAnthropicModel()`, embeddings `EMBEDDING_MODEL`, the rerank `RERANK_MODEL`); a value outside the identifier rule is recorded
  `unknown`, never echoed (OD-231 (g)). The validator bounds every integer, pins the ids, the route path (`/api` and static or bracketed
  segments only) and the model id, and refuses a secret-shaped value (the secret scan's key shapes, restated so that the statement matches
  none of them); its issues name keys, never values. Never in the record: a prompt, answer, query or embedding text, a tool argument, a
  provider message, a provider request id (OD-208, B24-C2), a principal, a cost (OD-209, B24-C2) or a key; the call records carry no
  configuration digest either (OD-199 is B24-C2's attribution document's, lead note 10).
- **The seam.** `withLlmCallScope({ routeId, method, scope }, fn)` runs `fn` on an `AsyncLocalStorage` anchored on `globalThis`
  (`Symbol.for("sirkit.b24-c1.llm-call-record-seam")`, `:81`) - the fixture container's precedent - so a route bundle and the
  instrumentation bundle share it. `recordModelCall(meta, invoke)` (`:216`) calls `invoke` at once and returns or throws exactly what it
  does (the same objects; a synchronous throw stays synchronous); inside a scope it builds one record when the call settles and hands it to
  the bound sink on a microtask (`:196`), a sink that throws counted `sink_failed`; outside a scope it counts `unscoped`, with no sink bound
  `unbound`, and writes nothing. `recordModelStream` (`:244`) writes one record when the iteration ends: `completed` with the done chunk's
  usage, the classified reason when it throws, `cancelled` when the consumer stops before the done chunk reached it (OD-231 (g)); a
  consumer that stops at the done chunk or later stopped a completed call, recorded `completed` with that chunk's usage (`:283`; review
  round, correctness-3, `b24-c1-llm-call-record` 7). Every error passes through as the same object - never a normalized copy, which
  would hide the SDK's own `status` and `code` from B24-A3's meter (`classifyEmbeddingError`); cases 3, 6 and 7 assert it by identity,
  and three deliberate breakages of the seam were each caught (section 15).
- **The scope**, entered by the three route wrappers in place (`app/lib/auth/route-handlers.ts:354, :358` in `authenticatedJsonRoute`
  with the trusted context's tenant, project and branch; `:446` in `publicRoute` and `:586, :590` in `publicJsonRoute` with the reserved
  operator scope `{ tenantId: "~sirkit-operator", projectId: "public-model-egress", branchId: "main" }`, no principal, OD-231 (a)); the
  tenant id's leading `~` lies outside `ID_PATTERN`, the trusted context's selector alphabet (`app/lib/auth/trusted-request-context.ts:43`),
  so no authenticated selector can name it and no membership can be resolved under it: the reservation is a property of the id space,
  pinned by `b24-c1-llm-call-record` 13 (review round 2, security-7; before, `sirkit-operator` lay inside the alphabet and a member
  provisioned under that tenant and project recorded into the operator scope - under `local_dev`, where every membership resolves, with
  no provisioning at all). The route id is `authorized.policy.path`, the exact policy path. The import is appended in place on `:43`
  (OD-231 (e)). Because the scope is
  entered only after `authorizeRequest` answered, a public request A3's limiter refuses (`authorize.ts:82`) reaches no handler: no
  provider call, no record (`b24-c1-llm-call-record` 2).
- **The four provider-call points, wrapped in place** (each wraps the provider call only; no SDK import or client construction is added,
  so `b20-a5-connector-tripwires` T2/T4, `b21-a-import-gates` 1's six SDK importers, `b24-a1-configuration` 14's six construction sites and
  `b23-a-route-vocabulary` case 8's connection-site counts hold as `a405db9` pins them):
  - `LLMRouter.generate`, `app/lib/llm/router.ts:33`, after the fixture short-circuit (`:26-32`);
  - `LLMRouter.stream`, `:38` (no production caller; one record when the iteration ends);
  - `embedBatch`, `app/lib/embeddings.ts:50-53`: the client is obtained first (`const openai = getOpenAIClient();`), so a missing
    `OPENAI_API_KEY` throws before the seam and leaves no call and no record; the usage is the answer's `model` and `usage.prompt_tokens`.
    One site serves every embedding path, admitted by A3's meter or not (the public searches through `admittedEmbedQuery`, assign/suggest
    through `searchFootprints`, the build loop through `searchPartsForAI`);
  - the rerank, `app/lib/parts-search.ts:495` (`recordedRerank`, declared at the end of the file): `rerankParts` obtains the client first
    (`:486-490`), so without `ANTHROPIC_API_KEY` there is no call and no record.

  The imports and the helper declarations are appended after each module's last line (hoisted), so no cited line moves.
- **The durable sink.** `app/lib/observability/llm-call-record-store.ts` (pure: `../durable-workflow/stable`, `../engineering/stable`,
  `./llm-call-record`) keeps one silent aggregate `llm.call-record.v1` per call id at revision 1 under the call's scope, idempotency key
  `llm-call:<callId>`; `load` and `list(scope)` re-verify (validation, closed keys, aggregate key, revision 1, scope, record digest), else
  `LLM_CALL_RECORD_MISMATCH` (B24-C3 reads through them). `app/lib/observability/llm-call-record-runtime.ts` binds it over
  `getDurableWorkflowRepository()` (resolved at write time); its one production importer is `instrumentation.ts`, whose `register()`
  imports it dynamically under `NEXT_RUNTIME === "nodejs"`, after the fixture clock (`instrumentation.ts:12`, `:16-17`;
  `b24-c1-llm-call-record` 10). Its pending writes sit in a bounded set (`LLM_CALL_PENDING_BOUND` 256); a failure is counted by a closed
  class - `store_unavailable`, `refused`, `write_failed`, `dropped` - never a message (case 9). Its appends run one at a time, in order
  (`llm-call-record-runtime.ts:37`, `:66`; review round, correctness-4, case 9): its one importer is the instrumentation bundle, which
  need not share module instances with the route bundles, so its `getDurableWorkflowRepository()` - and through it `db/client.ts` -
  may be a second instance with a PostgreSQL pool of its own (INFERRED; no `next start` ran here). Serial appends keep that pool to one
  session at a time instead of up to its `max` of 8, under the session pooler's cap of 15 (`db/client.ts:36-41`); the bound counts
  queued writes, and a write the store never settles holds the queue (section 12).

## 5. The 22 derived paths and their call points (**CONFIRMED**, `b24-c1-llm-call-record` 1, 1b, 11)

The paths are DERIVED, never a hand list: `routeResourceClassification()`'s rows with `modelEgress` true are 23 (one method each),
`/api/chat` (POST) among them; without it 22, 21 POST and one GET. Each path's exported handler is one of the three scope-entering wrappers
(the B16.0.7 classifier: `authenticatedJsonRoute` on the 20 member rows, `publicJsonRoute` on `POST /api/parts/search`, `publicRoute` on
`GET /api/pcb/footprints/search`); no route file of the 22 has `app/lib/agent/adapters.ts` in its runtime closure (measured at
`a405db9` and pinned); the production importers of `app/lib/llm/openai-provider.ts` and `anthropic-provider.ts` are exactly
`app/lib/llm/router.ts` and `scripts/run-b21-live-orchestration-evaluation.ts` (B24-B3's stated choice, OD-230 (h); D10) - C1 adds none.
Each path was driven through its REAL exported handler with fake `openai` and `@anthropic-ai/sdk` constructors and a fake database client
(the router, the providers, embeddings, parts-search, the build loop and the footprint search are the real ones; five domain validators
are stubbed exactly as the B16.0 tranche suites stub them, so a minimal pinned problem reaches its provider call):

| path | method | call points reached | calls (asserted) |
|---|---|---|---|
| `/api/architecture/propose`, `/api/power/propose`, `/api/interfaces/propose`, `/api/schematic`, `/api/schematic/edit`, `/api/schematic/layout-critic`, `/api/schematic/review` | POST | `LLMRouter.generate` (Anthropic) | one |
| `/api/calculation/propose`, `/api/circuit-knowledge/propose`, `/api/circuit-verification/propose`, `/api/component-selection/propose`, `/api/schematic-compiler/propose` | POST | `LLMRouter.generate` (OpenAI) | one |
| `/api/schematic/build`, `/api/schematic/edit-build` | POST | the build loop's turns, `embedBatch` (its `search_parts`), the rerank | N >= 2 |
| `/api/schematic/build-multi` | POST | the planner turn, then one build loop (a one-block plan) | N >= 2 |
| `/api/pcb/assign/suggest` | POST | two router turns and `embedBatch` (`search_footprints` through `searchFootprints`) | three |
| `/api/pcb/ai-rules/from-brief` | POST | two router turns (an invalid delta, then its one retry) | two |
| `/api/pcb/edit/assist`, `/api/pcb/repair/agent`, `/api/spice/ai` | POST | router turns (a tool call, then a turn with none) | N >= 2 |
| `/api/parts/search` | POST | `embedBatch` through A3's meter, reserved operator scope | one |
| `/api/pcb/footprints/search` | GET | `embedBatch` through A3's meter, reserved operator scope | one |

For every path: the records equal the fake SDK's calls one to one - the path, the method, the scope, the fake's provider, model and token
counts, `completed` - numbered 1..N under one request reference; on the eight multi-call paths N >= 2. No stored value holds the prompt,
query, answer or provider-message sentinels. One injected failure per call point (case 3): an Anthropic 429 through the router is
`rate_limit`, an OpenAI 401 `authentication`, a provider's own missing key `missing_credentials` (no request left Sirkit for it: the
Anthropic client refuses to build a request without a key; RECORDED from the SDK's message, the fake raises it), an embedding 429
`rate_limit` and a rerank 529 `overloaded`; each failed record carries the configured model and no token count, and every response is the
same bytes with the sink bound and unbound (the 503 `providerErrorResponse` body, the lexical fallback, the build loop's answer).

## 6. What is not kept (**CONFIRMED** where a case names it; otherwise **INFERRED** from the code)

- **Appended events.** `DurableRunTraceSink.append` keeps nothing: the finalized document carries every event (case 7).
- **A run that dies before finalization.** A process killed between `run_started` and the route's `finalizeTrace` leaves no record
  (INFERRED: the write is scheduled only in `complete`).
- **A request refused before the recorder.** A body, bounded-read or resume refusal (`route.ts:366`) answers before the recorder exists:
  no trace, as before.
- **A trace the recorder never hands to a sink.** `trace_validation_failure` and `trace_digest_failure` (`trace-recorder.ts:586-592`)
  stop the hand-over; nothing is written.
- **A replay.** `replayCapsule` gives its recorder `options.sink ?? new InMemoryTraceSink()` (`replay-capsule.ts:621`), never the factory:
  replaying B11's `e03-valid-board` builds no store and schedules no write (case 10; runbook `:1088`; `b11-4-no-execution`).
- **A failure before any request leaves Sirkit.** A missing `OPENAI_API_KEY` before an embedding, a missing `ANTHROPIC_API_KEY` before a
  rerank (`b24-c1-llm-call-record` 3b, on fresh module instances).
- **The SDK's own retries.** One record per SDK call: `embeddings.ts:25` sets no `maxRetries` and the router's OpenAI client sets 5
  (`openai-provider.ts:152-156`), so a call the SDK retried is one record with the final outcome and the whole latency (D24-22's UNKNOWN).
- **The two fixture short-circuits.** `LLMRouter.generate` under the fixture runtime (`router.ts:26-32`) and `runBuildToolLoop`
  (`build-loop.ts:139`) make no provider call and write no record (case 4). The public searches have no fixture branch: under the fixture
  runtime a request to `/api/parts/search` or `/api/pcb/footprints/search` reaches `embedBatch` and records into the fixture's in-memory
  repository (case 4); whether the browser proof calls those routes is the lead's Playwright run to record.
- **A whole, self-consistent rewrite** of a stored record (its fields and its digest recomputed together) by someone with database write
  access is not detectable without a signature: the digests catch a partial edit (RECORDED, low; section 12).
- **`/api/chat`'s model calls.** They go through `app/lib/agent/adapters.ts`, not the router: the run trace covers them (its `step` events
  carry the model and the tokens); no call record is written for them.

## 7. The synchronous-sink rule and the failure classes

The recorder's sink contract is synchronous (`trace-recorder.ts:29-31`): a returned thenable is a `trace_sink_contract_violation`
(`:303-326`). So both durable writes are scheduled, never returned: the trace sink's `complete` returns `undefined` and never throws (a
finalized trace carries no `trace_sink_*` diagnostic: `b24-c1-durable-trace` 2, 7); the call record's seam hands the record over on a
microtask. Each write's failure is caught and counted by a closed class, never a message, a stack or a fragment of the document:

| record | classes | proven |
|---|---|---|
| `agent.run-trace.v1` (`trace-runtime.ts`) | `store_unavailable` (the factory threw), `refused` (a closed store refusal), `stale_exhausted` (conflicts past `casAttempts`; the commit tried exactly 8 times), `write_failed` (the repository rejected), `dropped` (past `RUN_TRACE_PENDING_BOUND`, 64) | `b24-c1-durable-trace` 8 |
| `llm.call-record.v1` (`llm-call-record-runtime.ts`) | `store_unavailable`, `refused`, `write_failed`, `dropped` (past 256); the seam's own `unscoped`, `unbound`, `invalid`, `sink_failed` | `b24-c1-llm-call-record` 6, 9 |

With `DATABASE_URL` emptied the production default still resolves (`getDurableWorkflowRepository()` never throws,
`durable-workflow/runtime.ts:17-20`) and the write fails inside `getDb()` (`db/client.ts`, reached from `server-repository.ts`): the chat
run counts `write_failed` and nothing else changes - the status, the stream (B21-B's digest), the terminal (`b24-c1-durable-trace` 9).
Every chat request in every chat suite now schedules one such write; every suite run here had `DATABASE_URL` unset or emptied. The
review round found that about a dozen older suites drive the chat route with no `DATABASE_URL` stub and no store of their own (eleven
under `app/api/chat/__tests__`, B10-B19, plus `b16-0-ai-approval-lifecycle` and `b12-boundary-and-e2e`; RECORDED from the review and a
grep), so a shell that exported `DATABASE_URL` would have had them write `agent.run-trace.v1` rows into that database (correctness-5,
security-4). Since the review round vitest's one setup file, `app/lib/qualification/__tests__/_database-env-guard.ts`
(`vitest.config.ts:18`), removes an ambient `DATABASE_URL` before every test file, whatever else is set: the DB-backed qualification
suites take their database from `SIRKIT_DB_QUALIFICATION_URL` (B16-B, never `DATABASE_URL`) and publish it themselves after the guard
has run, and CI sets no `DATABASE_URL`, so neither changes (`b24-c1-durable-trace` 14 reads the guard's mark at load: it ran).

## 8. The classification, unchanged (OD-231 (b); **CONFIRMED**)

A run trace and a call record are operator telemetry, not project data: no `durable_access` moves. All 20 member rows of the 22 stay
`durable_access none` and the public rows stay free of durable access (`publicTouchesDurableData`,
`app/lib/auth/route-resource-classification.ts:213`); `artifacts/ai-control-plane-b16-0-2/route-data-and-resource-classification.csv` and
its pins are byte-identical (`generate-b16-0-2-artifacts`: no drift). The alternative - re-annotating the 22 rows - would move the B16.0.2
and B23-A2 pins and force the public rows to OD-231 (a)'s alternative; it is the owner's to take.

## 9. Live: BLOCKED-LIVE-QUALIFICATION

- **LB-14** (the database platform): no write was made to the real database platform or to any staging or production database; every
  database proof ran on PGlite in the test process (`b24-c1-durable-records-pglite`), and every other suite with `DATABASE_URL` unset or
  emptied. The PostgreSQL isolation level of a production server stays UNKNOWN (the B23-B2 statement).
- **LB-13** (staging and production; OD-190): both writes are scheduled after the work they record and are never awaited by the response.
  Whether a serverless platform keeps such a write alive after the response has been sent is **UNKNOWN** and BLOCKED-LIVE-QUALIFICATION
  until a hosting platform is named; on a long-lived Node server (`next start`) the write runs on the process's event loop (INFERRED).
- **LB-2, LB-7, LB-9** (live models): every provider here is an in-process fake; the record shapes of a live call - its real model id,
  its real token counts, a real provider's failure classes and retries - are not measured (OD-216). No live call was made.
- **The production-mode bundle**: `instrumentation.ts` now imports `llm-call-record-runtime.ts` (and through it the durable runtime and
  the database schema) under the nodejs runtime. `next build` bundles it; that build, and `production-smoke`'s CI run, are the lead's
  (section 18). No `next build`, `next start` or `next dev` was run by the builder. Whether that bundle's database client is a second
  instance with a pool of its own (section 4; INFERRED) can be measured only on a server holding a database: BLOCKED-LIVE-QUALIFICATION
  (LB-14).

## 10. The stale B11 statements (recorded, never edited)

`app/lib/agent/trace-recorder.ts` is B11-scanned and sha256-pinned (`b21-e2b-trace-attribution.test.ts:42-53`; OD-113), so two of its
statements are recorded here and left as written:

- `trace-recorder.ts:41-45` - "Durable retention, retention duration, and operator access are EXPLICIT FUTURE OWNER DECISIONS — nothing
  here introduces database persistence." True of the module (it still introduces none); no longer of the product: the chat route binds a
  durable sink since B24-C1 (section 2). Retention and operator access stay open (B24-C2, B24-C3).
- `trace-recorder.ts:108-109` - "Production default: run-local in-memory (no retention decision is made here)." The module's default
  factory is still the run-local in-memory sink; the production chat route replaces it at evaluation (`trace-runtime.ts:115`).

`artifacts/ai-control-plane-b11/redaction-and-retention-policy.md:43` carries a dated `[B24-C1, 2026-10-08]` note in place, covering its
three bullets `:45-50` (the run-local default factory, "No database, file, or network write exists anywhere in the trace path", the
factory as a future injection point); the note carries none of the B21, B22 or B23 closeout tripwires' scanned phrases or note prefixes,
and all three suites ran before and after the edit (section 16).

## 11. What is deferred (never built here)

- **Retention and deletion** (B24-C2, OD-202): nothing purges either aggregate; both grow until the owner's retention rule and its CLI
  exist.
- **Attribution, cost and principal** (B24-C2, OD-208, OD-209): no request digest, principal digest, budget, per-event offset, provider
  request id or cost is recorded; a call record holds tokens, never a price.
- **Readers** (B24-C3, OD-211): no route, MCP tool, agent tool or UI reads either record; `DurableRunTraceStore.history`,
  `DurableLlmCallRecordStore.load` and `.list` are the verified read paths C3 builds on.
- **Legacy routes** are not retired (OD-106 stands).

## 12. What stays open (**INFERRED**, low)

- A whole, self-consistent rewrite of a stored record (its fields and both digests) by someone with database write access is not
  detectable without a signature; the digests catch a partial or accidental edit. No signing key exists in the product (OD-42).
- The call record's `startedAt` and the trace record's `at` read the server clock, which the fixture runtime freezes: under the fixture
  runtime every record carries the fixed instant (as every durable time there does).
- A provider whose SDK retried a call is one record with the final outcome and the whole latency; how many HTTP requests it made is not
  visible (D24-22's UNKNOWN).
- Every route that uses one of the three wrappers enters the call scope, not only the 22; a provider call reached from any of them is
  recorded under its own exact policy path. The census pins that only the 22 derived paths reach a provider today.
- (review round) The instrumentation bundle's database client may be a second instance with a pool of its own (section 4): serial
  appends hold it to one session, but the pool itself, and whether a route bundle shares it, is not measured (no `next start` ran;
  BLOCKED-LIVE-QUALIFICATION, LB-14). A durable fix would anchor the database client on `globalThis`, as the fixture container is: a
  change to `db/client.ts`, which some 49 test files name and several point at a database of their own, so it is left to the owner.
- (review round) A call-record append the store never settles holds the one-at-a-time queue: every later record of that process is
  then `dropped` and counted until it settles (a dead database connection ends it at the driver's own timeouts; no response changes).
- (review round) The run trace's writes stay concurrent (bounded at 64): `trace-runtime.ts` is imported by the chat route, so it shares
  the route bundle's database client.
- (review round 2, security-5; RECORDED) A trace warning may carry up to 80 characters of a model-chosen tool name: for a tool no run
  exposes, `app/lib/agent/loop.ts:414` writes `The model requested unknown tool "<name>"` (the provider's tool name sliced to 80
  characters) followed by `refused.`; the recorder keeps it through `sanitizeTraceText` (secret patterns replaced, 300 characters;
  `app/lib/agent/redaction.ts:60-64`), the validator bounds it (300 characters, 32 warnings) and refuses only a secret shape, and since
  B24-C1 it is durable with the trace. Nothing redacts a model-chosen identifier beyond the secret patterns; the loop, the recorder and
  the redaction module are B11-scanned and not edited here. `b24-c1-durable-trace` 16 pins the text as it is kept; how long it is kept
  is B24-C2's retention rule (OD-202).
- (review round 2, security-7) The reserved operator scope is enforced by the id space alone (section 4): no rule in the selector path
  names it, and no reader exists yet. B24-C3's readers should treat `~sirkit-operator` as the operator's own scope, never a tenant's.
- (review round 2, security-1) The store compares and keys scopes as the substrate stores them (section 2). The chat route's identifier
  rule (`app/lib/agent/context.ts:268-270`) refuses a padded id before any run id or recorder exists, and the recorder's document keeps
  its scope as the route passed it (B11, not edited), so no document with a rewritable scope reaches the store today; the canonical
  keying guards a future caller.

## 13. Superseded statements, handed to B24-F

Each is left as written by B24-C1 and listed for B24-F's one table at closeout commit 1/2 (file:line at C1's commit):

- `app/lib/agent/trace-recorder.ts:41-45` and `:108-109` (section 10; recorded, never edited - B11-scanned and hash-pinned);
- `artifacts/ai-control-plane-b11/redaction-and-retention-policy.md:43-50` (its dated `[B24-C1, 2026-10-08]` note on `:43`);
- `app/api/parts/search/route.ts:19`, B24-A3's trailing comment "(embeddings.ts unchanged)", and `app/lib/embedding-admission.ts:4`,
  "`app/lib/embeddings.ts`, not edited: the DB schema imports it" - since B24-C1 `embeddings.ts:50-53` carries the call-record seam (the
  meter's arithmetic is unchanged: it still counts `embedQuery` calls);
- `app/lib/qualification/__tests__/b24-a3-embedding-admission.test.ts:197`, case 7's title "embeddings.ts is unchanged (one client, no
  maxRetries ...)" - its assertions still hold (one client, no `maxRetries`, no "admission" in the file); the title's "unchanged" does
  not;
- `artifacts/ai-control-plane-b24/abuse-controls.md:31`, "`embeddings.ts` and the nine B11-scanned files are untouched" - true of B24-A3's
  increment, not of the tree after B24-C1;
- `artifacts/ai-control-plane-b24/discovery.md:360` and `:713` (the lead's file), "`setAgentTraceSinkFactory` has no production caller" -
  its production caller is `app/api/chat/trace-runtime.ts:115` (the closure clause for D24-20 in section 18 records it);
- `artifacts/ai-control-plane-b24/discovery.md:426` and `:759` (the lead's file), which cite `vitest.config.ts:13-18` for the test block
  that sets no `testTimeout` - the claim holds, but the block is `:13-19` since the review round's setup line (`:18`);
- `artifacts/ai-control-plane-b20/discovery.md:103`, "vitest: `environment node`, include ..., alias `@`, no timeouts configured" -
  true still, but the config now also names one setup file (`_database-env-guard.ts`).

## 14. Pins moved, and why (each in place, with a dated `[B24-C1, 2026-10-08]` note)

| pin | move | why |
|---|---|---|
| `app/api/chat/route.ts:40` | `import "./trace-runtime";` appended in place after the recorder's import, with a dated tag; 562 lines kept, `[B21 E4]` markers at 35, 504, 507 kept | the binding's one edge (C1a) |
| `.github/workflows/deterministic-manufacturing.yml:340` | one database-delivery line, `app/lib/qualification/database/__tests__/b24-c1-durable-records-pglite.test.ts`, after B24-A4's last PGlite entry (`:339`) | the PGlite suite, admitted file by file (OD-222) |
| B21 C49, C93, C94 (`artifacts/ai-control-plane-b21/evaluation-matrix.md:1139, :1183, :1184`; `b21-f-page` 6) | `:371` -> `:372`, `:374` -> `:375`, `:383` -> `:384`, each with `[B24-C1, 2026-10-08] re-pinned +1` naming the entry at `:340` | the inserted line moves every later workflow line +1 (D8) |
| `artifacts/ai-control-plane-b24/environments-and-deployment.md` section 10 | one row appended to the insertion table (task `[B24-C1, 2026-10-08]`, job `database-delivery`, first line `:340`, count 1) | A1's insertion-table protocol; no earlier row and no number of sections 10 and 14 moved (`b24-a1-environment-profile` 14, 16, 17 green) |
| `artifacts/ai-control-plane-b24/ci-admission.md:185` | the browser job's `timeout-minutes: 30` citation `:357` -> `:358`, with `[B24-C1, 2026-10-08] was \`:357\``, earlier notes kept | the same +1 (re-derived by anchor) |
| `artifacts/ai-control-plane-b11/redaction-and-retention-policy.md:43` | a dated note in place | Lead note 7 |
| `app/lib/auth/route-handlers.ts:43, :354, :358, :446, :586, :590` | the call-record import appended on `:43`; the five handler calls wrapped in `withLlmCallScope` in place; 1,093 lines kept | the scope (C1b); `:43` is the one line beyond the task's five (OD-231 (e)) |
| `app/lib/llm/router.ts:33, :38` and appended lines `:51-67` | the two provider calls wrapped in place; the imports and three helpers appended after the last line | the call points (C1b) |
| `app/lib/embeddings.ts:50-53` and appended lines `:69-77` | the client obtained first, the SDK call inside the seam; the import and the usage helper appended | the call point (C1b) |
| `app/lib/parts-search.ts:495` and appended lines `:607-619` | the rerank through `recordedRerank`; the import and two helpers appended | the call point (C1b) |
| `instrumentation.ts:13-17` | the binding appended inside `register()`, after the fixture clock | the binding (C1b) |
| `vitest.config.ts:18` (and the new `app/lib/qualification/__tests__/_database-env-guard.ts`) | one line appended after the include line: `setupFiles` naming the guard, with a dated `[B24-C1 review, 2026-10-08]` tag; lines 1-17 unchanged, so the include line (`_ci-admission.ts`'s anchor, `b24-b1-catalog`, `b24-b2-ci-admission`) and B19's `:15-17` citations hold | the review round's guard (correctness-5, security-4; section 7) |

**Not moved:** B23's C64 (`artifacts/ai-control-plane-b23/dfm-quote-flow.md:537`) and its prose citation of the PGlite entry
(`dfm-quote-flow.md:269`) cite `:335`, above the inserted line; the nine B11 hashes; the census 168 / 165 / 3 / 0; the tool counts
47 / 36 / 9 / 27; the action records 107; the migrations 32; the six SDK importers and the six client construction sites; the
classification CSV; the B01 matrix, the B17 inventory and the B11 replay pins; the chat stream's bytes (`b21-b-chat-router` 1);
`drizzle/`; `.env.example` and A1's flag inventory. B24-B1's catalog does not list every `b24-` suite (it links one, `b24-b2-power-ground`),
so C1 adds no catalog row and the catalog is not regenerated. No count of a shared in-memory repository needed a move: no suite in the
gates below counts every record of one.

## 15. Test-first record (**CONFIRMED**)

| step | what ran | result |
|---|---|---|
| probe, `a405db9` | P1 (chat under the fixture runtime), P2 (public search under the fixture runtime, fake `openai`) | both red: 0 heads, expected 1 (section 1) |
| C1a red | `b24-c1-durable-trace`, `b24-c1-durable-records-pglite` | 2 files failed to load: no `run-trace-store` |
| C1a green | the same, after `run-trace-store.ts`, `trace-runtime.ts`, `route.ts:40` | first run 14 / 16 (a resume case that built a second store per request, a jsonb key-order check): both tests' own errors, fixed in the tests; then 16 / 16 |
| C1b red | `b24-c1-llm-call-record` | failed to load: no `llm-call-record` (a syntax error of the suite's own fixed first) |
| C1b green | the three C1 suites | first run 39 / 40 (a tamper probe that rewrote a record and its digest consistently, which no digest can catch - replaced by an id swap, and the limit recorded, section 12); then 52 / 52 |
| review red, first run | `b24-c1-durable-trace` (new 13, 14), `b24-c1-llm-call-record` (3, 6, 7, 9 strengthened), on the reviewed tree | 7 failed / 42 passed: the four intended reds below, and three cascades - case 9's held writes stayed held after its failed expectation, so the after-each drain timed out for 9, 10, 11 and 12; case 9 now releases its gate in a `finally` |
| review red | the same | 4 failed / 45 passed: durable-trace 13 (section 16's two unfilled placeholders, for the generators' and the tripwires' final runs, and three cross-references landing in the wrong section: the lead's runs and the D24-20 clause cited as section 17, the tripwire runs as section 15), durable-trace 14 (no `setupFiles`), llm-call-record 7 (a consumer that stopped at the done chunk recorded `cancelled`, the configured model, no tokens), llm-call-record 9 (256 appends started while the first was held) |
| correctness-2 mutants | the seam saved (sha256 `9cd3e562…`), then broken three ways, one at a time, each arm made to `throw toProviderError(meta.provider, error)`: M1 the rejection arm of `recordModelCall`, M2 the stream's `next()` catch, M3 the synchronous catch; `b24-c1-llm-call-record` against each | M1 caught by 3 (the embedding's SDK error reached its caller as an `LLMProviderError`) and 6 (the raw 403); M2 by 7 (the raw stream error); M3 by 6 (the synchronous throw); 7 and 9 also red in each run (correctness-3 and -4, not yet fixed); the source restored and verified at `9cd3e562…` before any fix (the strengthened identity checks pass on the unmutated seam: the code was right, the tests could not tell) |
| review round 2, baseline | the three C1 suites on the reviewed tree, before any edit (2026-10-08, 20:55) | 3 files, 54 / 54, exit 0 (35.6 s) |
| review round 2, red | `b24-c1-durable-trace` (6 extended; 15 and 16 new), `b24-c1-llm-call-record` (13 new), `b24-c1-durable-records-pglite` (6 new), on the unfixed code (21:01) | 5 failed / 53 passed, exit 1 (28.9 s): durable-trace 6 (a document whose project id is blank answered `scope_mismatch`, expected `invalid_document`; its padded replay would have followed), pglite 6 and durable-trace 15's store half (a document whose project id carries a leading space refused `scope_mismatch`: 0 records), llm-call-record 13 (a member provisioned under `sirkit-operator` / `public-model-egress` was ADMITTED: one provider call, one record in the operator scope - the handler's 500 `no review returned` is the fake's text answer for that route, as in case 1), durable-trace 16 (the suite's own assertion: the planted name's tail recurred in its head, while the kept warning text was as the finding says; the assertion fixed, the two non-PGlite suites re-run red at 21:03 and 21:06: 4 failed / 48 passed, exit 1) |
| review round 2, the refuted half | durable-trace 15's chat half: the production chat POST with `scope.projectId` ` project-1` (the editor context's scope and head mark padded alike) | 400 `{"ok":false,"error":"projectId is not a well-formed identifier"}` with no `X-Sirkit-Run-Id`: `assembleAgentRunContext` (`app/lib/agent/context.ts:268-270`, called at `route.ts:286`) refuses an id outside its identifier rule before the run id (`:367`) and the recorder (`:438`) exist, nothing is scheduled and nothing counted - the review's chat-level scenario does not reach the store (CONFIRMED; pinned by case 15, which then proves the store's canonical keying through the sink directly) |
| review round 2, green | the three C1 suites after `run-trace-store.ts` (scopes compared and keyed as the substrate stores them), `llm-call-record.ts:41` (`~sirkit-operator`) and this page's sections 0, 2, 4, 12 and 18 (21:10) | 3 files, 58 / 58, exit 0 (39.6 s) |

## 16. Gates (2026-10-08; **CONFIRMED**)

Every run went through the lock script (two workers), with `DATABASE_URL` unset in the shell (and emptied by `vi.stubEnv` in every C1
suite; since the review round also removed by vitest's setup guard); no browser spec ran. "files" is passed (+ skipped) of the total;
"tests" likewise. The last column is review round 2's re-run of every set on the final tree (2026-10-08, 21:15-21:31, one set after
another under the lock, every set exit 0, no worker timeout, the duration in seconds); the first review round's re-run was cut by a
session restart before any set finished and left no record.

| set | baseline at `a405db9` (before any edit) | C1a tree | C1a + C1b tree (reviewed) | review round 2 (final tree) |
|---|---|---|---|---|
| `app/lib/qualification` (every B24 suite, the PGlite ones included) | 29 files; 276 + 3 tests | 31; 292 + 3 | 32; 328 + 3 | 32; 334 + 3 (131 s) |
| `app/api/chat/__tests__` | 22; 149 | 22; 149 | 22; 149 | 22; 149 (22 s) |
| `app/lib/agent/orchestration/__tests__` (`b21-closeout-statements`, `b21-f-page`, `b21-e4-page`, `b21-d3-pin-facts`, `b21-a-import-gates`) | 49; 460 | 49; 460 | 49; 460 | 49; 460 (65 s) |
| `app/lib/computation/__tests__` + `b19-e-ci-job-scope` (`b22-closeout-statements`, `b22-b-exposure`, `b22-a1-spice-ai-approval`, `b22-c-ai-evidence`) | 27 + 2; 314 + 18 | 27 + 2; 314 + 18 | 27 + 2; 314 + 18 | 27 + 2; 314 + 18 (49 s) |
| `app/lib/manufacturing-providers/__tests__` (`b23-closeout-statements`, `b23-a-route-vocabulary`, `b23-a-provider-admission`, `b23-lead-wrapper-signal-retention`) | 29; 387 | see below; 29; 387 on the rerun files | 29; 387 | 29; 387 (138 s) |
| the database-delivery list (the workflow's, read from the file: `app/lib/db` and 18 files) | - | 21 + 3; 183 + 12 | 21 + 3; 184 + 12 | 21 + 3; 185 + 12 (138 s) |
| `app/lib/auth/__tests__` | 41; 479 + 9 | see below | 41; 479 + 9 | 41; 479 + 9 (54 s) |
| `app/lib/mcp`, `app/api/mcp/__tests__`, `app/lib/durable-workflow/__tests__` | 54 + 1; 930 + 2 | 54 + 1; 930 + 2 | 54 + 1; 930 + 2 | 54 + 1; 930 + 2 (117 s) |
| `app/lib/agent/__tests__` (the B09-B11 suites, `b11-4-no-execution`, `b11-5-capture-exactness`) | 36; 415 | 36; 415 | 36; 415 | 36; 415 (40 s) |
| `app/lib/engineering/__tests__`, `app/lib/project/__tests__` (`b14-4-ast-import-gates`) | 136; 1401 | 136; 1401 | 136; 1401 | 136; 1401 (156 s) |
| `app/api/__tests__`, `app/lib/llm/__tests__`, `app/lib/fixture-runtime/__tests__`, `b19-d-build-loop-injection`, `b19-d-review-price-consistency`, `app/api/pcb/ai-rules/__tests__`, `app/api/pcb/edit/__tests__` | 41 + 1; 1155 + 4 | - | 41 + 1; 1155 + 4 | 41 + 1; 1155 + 4 (48 s) |

- **The C1a manufacturing run** exited 1 after 937 s: `b23-a-no-order-structural` 2 and 3 and `b23-d-physical-evidence-contract` 8 timed
  out (cases of 718 s and 753 s, a 120 s limit, and "Timeout calling onTaskUpdate") while the machine had 1.1-2.8 GB free. The two files
  re-run alone right after: 22 / 22 passed in 25 s, exit 0; the final run of the whole directory passed in 180 s. Both runs are recorded;
  nothing was loosened (lead lesson 3).
- **The C1a auth run** exited 1: `b20-b2-route-tree` 3 caught a route-file matcher (a `route.ts` regex) in `b24-c1-durable-trace` 11 - the
  suite's own; it now uses the route tree's enumeration (`listRouteFiles`). Re-run: `b20-b2-route-tree` and `b24-c1-durable-trace`, 20 / 20.
- **The interrupted run** (review round, security-8). A run of `app/lib/qualification` started at 13:37, after this page was first
  written; its log was last written at 18:40 and holds no summary: `b24-c1-durable-trace` 11 "Test timed out in 180000ms" after
  18,041,835 ms and `b24-a4-rls-default-deny` 8 after 2,917,066 ms, while `b24-a2-env-names` reported 15,119,197 ms with its ten cases
  skipped. Durations of hours for cases that take seconds point to a suspended host (INFERRED), not to the code; it is recorded, not
  dismissed. Re-run on an awake host before any review edit: `b24-c1-durable-trace` alone, 12 / 12, exit 0 (case 11 15.1 s; 19:11),
  then `app/lib/qualification` as a set, 32 files, 328 + 3, exit 0 in 235 s (durable-trace 11 11.8 s, llm-call-record 11 41.1 s;
  19:12-19:16). No TypeScript file changed between the 13:13 run of the reviewed tree and the review round.
- **tsc** `--noEmit -p tsconfig.json`: the builder's runs at 12:27 (C1a) and 13:07 (C1b) each exited 0 but each predated a later test
  edit - the C1b one the last edit of `b24-c1-llm-call-record` at 13:08:33 - so neither is a record of the final tree (security-3). On
  the final tree, every review fix in: exit 0 (19:29-19:31). Review round 2: exit 0 after its code and test edits (21:11-21:12) and
  again after its last test edit (section 15's content anchor on `context.ts`; the run is recorded in the round's report).
- **eslint**: the fourteen changed TypeScript files, exit 0 (13:09, C1b); on the final tree the sixteen (with `vitest.config.ts` and
  `_database-env-guard.ts`): exit 0 (19:32). Review round 2: the seventeen (the three suites and the two edited modules among them),
  exit 0 (21:15).
- **Generators** (`generate-action-toolability-matrix`, `generate-agent-artifacts`, `generate-b17-control-inventory`,
  `generate-b16-0-2-artifacts`, `generate-b11-artifacts`): zero drift after C1a (13:05, `git status` and `git diff` hashed before and
  after); the builder did not re-run them after C1b (correctness-1, security-2). On the final tree (19:32), each exit 0 - 107 action
  records and 154 route coverage entries; 36 statically exposed tools of 47 registered; 631 classified controls on 63 surfaces; the
  classification CSV; B11's 19 / 19 cases and 61 / 61 checks - with the tree's hash (`git diff` and every untracked file's sha256)
  `489d2bb1…` and its 22-entry `git status` identical before and after: zero drift. Review round 2 (21:15): the same five, each exit 0
  with the same summaries, the tree's hash `5f1a9c93…` identical before and after: zero drift.
- **The closeout tripwires** (`b21-closeout-statements`, `b22-closeout-statements`, `b23-closeout-statements`) ran in the baseline, after
  the B11 and B21/B24 page edits, after this page was first written (13:36: 3 files, 27 / 27, exit 0), in the review round before its
  page edits (19:16: 3 files, 27 / 27, exit 0), in review round 2 inside the orchestration, computation and manufacturing sets above
  (21:17-21:22, on this page as edited through section 18) and once more after the last edit of this page - a page cannot carry the
  result of the run that reads its final text, so that run is recorded in the round's report, not here.
- **Control bytes and line endings:** no changed or new file holds a control byte or a CR.
- **Not run by the builder:** both Playwright configs, `next build`, `next start`, `next dev` (section 18), and CI.

## 17. Suites

| suite | it( | cases |
|---|---|---|
| `app/lib/qualification/__tests__/b24-c1-durable-trace.test.ts` | 16 | the fixture-runtime counterexample; one record; failed, cancelled, Tier 3-refused, breaker-paused; resume revision 2; the stream's bytes; the store's refusals, the padded and the blank id, and eight tampers; the synchronous sink; the five failure classes; `DATABASE_URL` emptied; replay; the import gate; the route's lines; (review round) this page's placeholders and cross-references; vitest's database guard; (review round 2) the padded chat scope refused before the recorder and kept by the store through the sink; the warning's 80 characters of a model-chosen tool name, and this page's sections 2 and 12 |
| `app/lib/qualification/database/__tests__/b24-c1-durable-records-pglite.test.ts` | 6 | the run trace's round trip, replay and resume, a direct row edit, two concurrent appends; the call record's round trip, replay and row edit (the reserved operator scope as the constant); (review round 2) a padded project id keyed by the trimmed one on PostgreSQL |
| `app/lib/qualification/__tests__/b24-c1-llm-call-record.test.ts` | 14 (and one `it.each` over the 22 paths: 36 tests) | the 22 paths; the call points; the limiter's refusal; one failure per call point and a missing key, and (review round) each call point's error reaching its caller as the same object; the fixture runtime; the contract; the seam, its answers and errors passed through by identity; the stream, a consumer stopping at the done chunk included; the store; the runtime's classes and its one-at-a-time appends; the binding; the census; the import gates; (review round 2) the operator tenant id outside the selector alphabet: a member provisioned under it refused as malformed, a look-alike recorded under its own scope |

The two non-PGlite suites ride prompt-to-gerber's `app/lib/qualification/__tests__` filter (OD-222); the PGlite suite is admitted to
database-delivery by its one line (`:340`), outside every prompt-to-gerber filter (`b19-e-ci-job-scope` green). Slowest cases here:
`b24-c1-llm-call-record` 11 (34.3 s alone, 47.3 s in the full qualification run: 22 closures, a yield between walks; limit 180 s) and `b24-c1-durable-trace` 11 (9.3 s; limit 180 s);
every case over 1.5 s declares its own timeout.

## 18. For the lead

Every text below is written out in full for a reserved file. Nothing here was written to `OWNER_DECISIONS.md`, `EXECUTION_LEDGER.md`,
`PROGRAM_STATE.json`, `LIVE_BLOCKERS.md`, `discovery.md` or the B24 `README.md`.

### Closure clauses (each one dated line under its defect in `discovery.md`)

- [B24-C1, 2026-10-08] D24-20: closed offline by B24-C1 (OD-207 applied): every run that reaches the chat route's recorder hands its finalized, validated `sirkit.agent-run-trace.v1` document to a durable sink bound through `setAgentTraceSinkFactory` at the chat composition root (`app/api/chat/trace-runtime.ts`, imported on `app/api/chat/route.ts:40`; no B11-scanned file edited), kept as `agent.run-trace.v1` on the durable-workflow substrate - one record per trace in one aggregate per scope and run id (the scope as the substrate stores it), a resume's trace at revision 2 - and retrievable by run id through `DurableRunTraceStore.history`, every load re-verified; proven in memory, through the production chat POST and on PGlite (`b24-c1-durable-trace`, `b24-c1-durable-records-pglite`); the real database platform is BLOCKED-LIVE-QUALIFICATION (LB-14), and whether a serverless platform keeps the scheduled write alive is LB-13's (OD-190); `observability-and-replay.md`.
- [B24-C1, 2026-10-08] D24-21: closed offline for the 22 derived paths by B24-C1 (OD-207 applied; OD-231 (a): the two public paths under the reserved operator scope `~sirkit-operator`, which no authenticated selector can name): every provider call made inside one of the 22 `model_egress` paths other than `/api/chat` leaves one `sirkit.llm-call-record.v1` (route, method, scope, provider, model, call kind, token counts, latency, a closed outcome class, the start time; no content) through one seam at the four call points (`LLMRouter.generate`/`stream`, `embedBatch`, the rerank), kept as `llm.call-record.v1` through the sink `instrumentation.ts` binds; each path driven through its real handler with fake SDKs (`b24-c1-llm-call-record`), on PGlite too; the fixture runtime's router short-circuit and a failure before any request leaves Sirkit write none, the SDK's own retries are not visible (D24-22's UNKNOWN), and live usage shapes stay BLOCKED-LIVE-QUALIFICATION (LB-2, LB-7, LB-9); `observability-and-replay.md`.

### Section 10 amendment (for `discovery.md`)

- [B24-C1, 2026-10-08] B24-C1 landed the durable run trace (D24-20) and the LLM call record (D24-21) in one run, C1a then C1b (OD-207 applied; OD-231); one workflow line (database-delivery `:340`); suites `b24-c1-durable-trace`, `b24-c1-durable-records-pglite`, `b24-c1-llm-call-record` (section 7 wrote `b24-c-*`; `CHAPTERS`' `b24-` admits both). Pins the plan did not name: `app/lib/auth/route-handlers.ts:43` (the seam's import, in place), `artifacts/ai-control-plane-b24/ci-admission.md:185` (the browser timeout citation, +1), the appended lines of `router.ts`, `embeddings.ts` and `parts-search.ts`. No migration (32), no census, tool-count, classification or flag move. Two review rounds, test-first: the second keyed the run-trace store by the scope as the substrate stores it (security-1; the chat route's identifier rule, `app/lib/agent/context.ts:268-270`, already refused a padded id before its recorder - the review's chat-level scenario refuted and pinned), moved the reserved operator tenant id outside the selector alphabet (`~sirkit-operator`, security-7) and recorded that a trace warning may carry up to 80 characters of a model-chosen tool name (security-5). `observability-and-replay.md`.

### The OD-207 heading

No OD-207 heading exists at `a405db9` (`grep '^## OD-207' OWNER_DECISIONS.md` finds none), so the entry below is its one heading. If the
lead commits C1a and C1b separately, C1a's commit takes the heading with its first three bullets and C1b's appends the last three as a
dated `### OD-207 amendment` under it. The next free number at `a405db9` is OD-231 (the headings end at OD-230, `OWNER_DECISIONS.md:2918`).

## OD-207 — Durable run traces and the model-calling routes, as applied (B24-C1, 2026-10-08)

- A durable `agent.run-trace.v1` aggregate on the durable-workflow substrate (`app/lib/observability/run-trace-store.ts`): one record per trace (`sirkit.agent-run-trace-record.v1`: schema, run id, trace id, revision, time, trace digest, the validated document), one aggregate per scope and run id; a compare-and-set commit with no outbox effect, idempotent per trace id, retried at most eight times on a moved head; every load re-verified, else `AGENT_RUN_TRACE_MISMATCH`.
- Bound through `setAgentTraceSinkFactory` at the chat composition root (`app/api/chat/trace-runtime.ts`, imported on `route.ts:40`): no B11-scanned file is edited (no pin move; OD-113's hashes unchanged). The sink is synchronous and schedules one write per finalized trace; a failure is counted by a closed class (`store_unavailable`, `refused`, `stale_exhausted`, `write_failed`, `dropped`) and never changes the stream, the terminal or the run.
- A replay persists nothing (runbook `:1088`): `replayCapsule` never uses the factory.
- The 22 `model_egress` paths other than `/api/chat` (B23-A2's derived column, `route-resource-classification.ts:130`; 21 POST and one GET) get `sirkit.llm-call-record.v1` - route id, method, provider, model, call kind, token counts, latency, outcome class, start time, and the bookkeeping fields of OD-231 (c); no content - written through one shared seam (`app/lib/observability/llm-call-record.ts`) at the four provider-call points and kept as `llm.call-record.v1` (`llm-call-record-store.ts`), bound by `instrumentation.ts` (`llm-call-record-runtime.ts`).
- One record per SDK call (the SDK's own retries are not visible); a failure before any request leaves Sirkit (a missing key before an embedding or a rerank) writes none; the fixture runtime's router short-circuit writes none.
- Legacy routes are not retired by B24 (OD-106 stands); readers are B24-C3's (OD-211); retention B24-C2's (OD-202); attribution and cost B24-C2's (OD-208, OD-209).

## OD-231 — B24-C1: stated choices beyond its task text, as applied (B24-C1, 2026-10-08)

- (a) The two public paths (`POST /api/parts/search`, `GET /api/pcb/footprints/search`): each record goes under one reserved operator scope, `{ tenantId: "~sirkit-operator", projectId: "public-model-egress", branchId: "main" }`, with no principal; it is written only for a request B24-A3's limiter admitted (the scope is entered after `authorizeRequest` answers). The tenant id's leading `~` lies outside `ID_PATTERN`, the trusted context's selector alphabet (`app/lib/auth/trusted-request-context.ts:43`), so no authenticated selector can name the scope and no membership can be resolved under it: the reservation is a property of the id space, not of a rule (review round 2, security-7; `b24-c1-llm-call-record` 13). The alternative (no durable record, only an in-process counter; D24-21 then closed for 20 of 22) is the owner's.
- (b) A run trace and a call record are operator telemetry, not project data: no `durable_access` moves; the classification CSV and its pins are byte-identical. The alternative (re-annotating the 22 rows, a reviewed move of the B16.0.2 and B23-A2 pins, with (a)'s alternative for the public rows) is the owner's.
- (c) Bookkeeping fields beyond OD-207's list: `callId`, `requestRef`, `seq`, `method`, `kind`, `startedAt`; none holds content.
- (d) The chat route's binding is a side-effect import, `import "./trace-runtime";`, appended in place on `route.ts:40` after the recorder's own import (the line the task names), with a dated tag; the module binds once when it is evaluated and exports `durableRunTraceSinkFactory` for a test that reset the recorder's factory.
- (e) `app/lib/auth/route-handlers.ts:43` carries the seam's import, appended in place after `policyFor`'s: a sixth line beyond the five handler calls the task names, so the file keeps its 1,093 lines by split (`b24-a1-environment-profile` 9, `b24-a3-principal-limits` 7).
- (f) In `router.ts`, `embeddings.ts` and `parts-search.ts` the seam's import and the helpers (`configuredModelOf`, `generateUsage`, `streamUsage`, `embeddingUsage`, `recordedRerank`, `rerankUsage`) are appended after the last line (hoisted; the B21-E1 / B24-A1 precedent in `anthropic-provider.ts`), so no cited line moves; `embeddings.ts:50` obtains the client before the seam (`const openai = getOpenAIClient();`); `parts-search.ts:495` calls `recordedRerank(client, {...})`, so its closing line is unchanged.
- (g) A model value outside the identifier rule is recorded `unknown`, never echoed; a stream the consumer stops before its end is recorded `cancelled`.
- (h) Bounds: `casAttempts` 8 (the exchange ledger's); 64 pending run-trace writes and 256 pending call-record writes per process; `list` at most 1,000 records.
- (i) The call scope is entered by the three wrappers for every route they serve, not only the 22: a provider call is recorded wherever it is made, under its exact policy path; the census pins that only the 22 derived paths reach one today.
- (j) The call records hold no configuration digest (OD-199 is B24-C2's attribution document's: "one place, never both").
- (k) B24-B1's catalog lists one `b24-` suite, not every one, so C1's suites are not added to it.
- (l) The run-trace store compares and keys scopes as the substrate stores them (NFC, trimmed; `canonicalDurableScope`), so a document whose id differs only by surrounding whitespace names its own project's aggregate and is found through either form; a document whose scope the substrate would refuse is `invalid_document` (review round 2, security-1; defense in depth: the chat route's identifier rule, `app/lib/agent/context.ts:268-270`, refuses such an id before its recorder exists).
- (m) A trace warning may carry up to 80 characters of a model-chosen tool name (`app/lib/agent/loop.ts:414`), kept durably as the recorder wrote it (secret patterns replaced, 300 characters); B24-C1 adds no redaction of it (the redacting modules are B11-scanned) and records the fact (review round 2, security-5; `b24-c1-durable-trace` 16).

### The LB-13 note

- [B24-C1, 2026-10-08] LB-13 note: both durable writes of B24-C1 (the run trace, the LLM call record) are scheduled after the work they record and never awaited by the response; whether a serverless host keeps such a write alive after the response has been sent is UNKNOWN until the owner names the hosting platform (OD-190) - on a long-lived `next start` process it runs on the event loop (INFERRED). `instrumentation.ts` now binds the call record's sink under the nodejs runtime; `production-smoke` is its first production build.

### The LB-14 note

- [B24-C1, 2026-10-08] LB-14 note: `agent.run-trace.v1` and `llm.call-record.v1` ride the existing durable-workflow tables (no migration; 32); proven on PGlite only (`b24-c1-durable-records-pglite`: round trips, replay, resume, a direct row edit caught, two concurrent appends serialized) - no write was made to the real database platform or any staging or production database.

### The README row

| B24-C1 durable traces (D24-20, D24-21; OD-207, OD-231) | `observability-and-replay.md` (part 1); code `app/lib/observability/{run-trace-store,llm-call-record,llm-call-record-store,llm-call-record-runtime}.ts`, `app/api/chat/trace-runtime.ts`, in place `app/api/chat/route.ts:40`, `app/lib/auth/route-handlers.ts` (six lines), `app/lib/llm/router.ts`, `app/lib/embeddings.ts`, `app/lib/parts-search.ts`, `instrumentation.ts`; workflow `deterministic-manufacturing.yml:340`; suites `b24-c1-durable-trace` (16), `b24-c1-durable-records-pglite` (6), `b24-c1-llm-call-record` (14 `it(` and one `it.each`, 36 tests) | done 2026-10-08 offline, two review rounds; the real database platform BLOCKED-LIVE-QUALIFICATION (LB-14), a scheduled write on a serverless host (LB-13), live usage shapes (LB-2, LB-7, LB-9); census 168 / 165 / 3 / 0, counts 47 / 36 / 9 / 27, 107 action records, 32 migrations |

### The ledger paragraph

### B24-C1 - durable traces: the run trace and the LLM call record (2026-10-08 local; increment workflow + lead; this commit)

Test-first on `chapter/b24-production-qualification` from `a405db9`, one run in two tagged halves (D21). Pre-edit probe on `a405db9`: a
completed chat request under the fixture runtime left 0 `agent.run-trace.v1` heads, and a public parts search made its embedding call and
left 0 `llm.call-record.v1` heads (both expected 1). B24-C1a: the two suites failed first with their modules absent; `run-trace-store.ts`
keeps the validated trace as `agent.run-trace.v1` (compare-and-set, no outbox, replay per trace id, every load re-verified), and
`app/api/chat/trace-runtime.ts`, imported in place on `route.ts:40`, binds a synchronous sink through `setAgentTraceSinkFactory` that
schedules one write per finalized trace and counts five closed failure classes - no B11-scanned file edited, the stream's bytes unchanged
(B21-B's digest); one database-delivery line (`:340`) moved B21's C49, C93, C94 and `ci-admission.md:185` +1 in place, with A1's
insertion-table row; the B11 retention page carries a dated note. B24-C1b: the suite failed first with the seam absent;
`llm-call-record.ts` (pure) wraps the four provider-call points in place (`router.ts:33, :38`, `embeddings.ts:50-53`, `parts-search.ts:495`),
the three route wrappers enter the scope in place (`route-handlers.ts:43, :354, :358, :446, :586, :590`), and `instrumentation.ts` binds
the durable sink (`llm.call-record.v1`); the 22 derived paths were each driven through their real handler with fake SDKs, one record per
call. Two review rounds, each test-first on the reviewed tree: the first made the seam's error identity, the stream's done chunk and the
call-record runtime's serial appends testable and fixed them, and gave vitest one setup file that removes an ambient `DATABASE_URL`; the
second keyed the run-trace store by the scope as the substrate stores it (NFC, trimmed; the chat route's own identifier rule already
refused a padded id before its recorder - CONFIRMED and pinned), moved the reserved operator tenant id outside the selector alphabet
(`~sirkit-operator`, so no authenticated selector can name it) and recorded that a trace warning may carry up to 80 characters of a
model-chosen tool name. Suites `b24-c1-durable-trace` (16), `b24-c1-durable-records-pglite` (6), `b24-c1-llm-call-record` (14 `it(` and
one `it.each`, 36 tests): 58 / 58; the gate sets re-run on the final tree (`observability-and-replay.md` section 16; one load-timeout run
and one tripwire hit on C1's own test in the first round, both recorded); tsc 0; eslint 0 on 17 files; five generators no drift. No
migration, census, tool-count, classification or flag move; every live step BLOCKED-LIVE-QUALIFICATION (LB-13, LB-14, LB-2, LB-7, LB-9).

### The lead's runs (not run by the builder)

- **Both Playwright configs, once** (no vitest beside them): the fixture runtime now writes run traces into its in-memory repository,
  and - under `next dev`, whose `register()` binds the call-record sink - a call record for each public search the browser makes
  (`/api/parts/search`, `/api/pcb/footprints/search` reach `embedBatch` under the fixture runtime; the router and the build loop
  short-circuit). Record whether the browser proof calls those two routes; never assume it.
- **The local production-mode run** (a fresh worktree with no `.env*` file): `next build` now bundles `instrumentation.ts`'s dynamic
  import of `app/lib/observability/llm-call-record-runtime.ts` (and through it the durable runtime and the database schema) for the nodejs
  runtime; then `next start` and `production-smoke`'s probes. Expected unchanged answers (INFERRED: the sink is bound at start and no
  route makes a provider call in the probes).
- **CI on the pushed commit:** prompt-to-gerber's duration against its 25-minute limit (C1's two non-PGlite suites ride its directory
  filter; locally they take about 60 s together under load) - within five minutes of the limit, STOP (OD-30); database-delivery against
  its 15 (one more PGlite file, about 4 s locally); `production-smoke` green.
- **The B17-A browser suite:** not needed - C1 changes no UI and no control (`generate-b17-control-inventory`: no drift).
