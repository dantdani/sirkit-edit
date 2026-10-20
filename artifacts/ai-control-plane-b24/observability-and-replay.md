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
  repository (case 4); whether the browser proof calls those routes is the lead's Playwright run to record. [PR-L/M integration, 2026-10-18] Since then `/api/parts/search` (and `/api/parts/categories`) answer from the committed fixture catalog under the fixture runtime, with no provider call (the Build Library answered 500 there); case 4 drives the footprint search, which still reaches `embedBatch`.
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
  request id or cost is recorded; a call record holds tokens, never a price. [B24-closeout, 2026-10-10] superseded: B24-C2's record, artifacts/ai-control-plane-b24/observability-and-replay.md:752.
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
| `.github/workflows/deterministic-manufacturing.yml:378` | one database-delivery line, `app/lib/qualification/database/__tests__/b24-c1-durable-records-pglite.test.ts`, after B24-A4's last PGlite entry (`:377`; [B24-D0, 2026-10-09] was `:340` after `:339` before B24-D0's 38 prompt-to-gerber `--exclude` lines at `:293-330`; [B24-D1, 2026-10-09] now `:381` after B24-D1's OD-30 steps at `:32` and `:344-345`) | the PGlite suite, admitted file by file (OD-222) |
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

| B24-C1 durable traces (D24-20, D24-21; OD-207, OD-231) | `observability-and-replay.md` (part 1); code `app/lib/observability/{run-trace-store,llm-call-record,llm-call-record-store,llm-call-record-runtime}.ts`, `app/api/chat/trace-runtime.ts`, in place `app/api/chat/route.ts:40`, `app/lib/auth/route-handlers.ts` (six lines), `app/lib/llm/router.ts`, `app/lib/embeddings.ts`, `app/lib/parts-search.ts`, `instrumentation.ts`; workflow `deterministic-manufacturing.yml:378` ([B24-D0, 2026-10-09] was `:340` before B24-D0's 38 prompt-to-gerber `--exclude` lines at `:293-330`); suites `b24-c1-durable-trace` (16), `b24-c1-durable-records-pglite` (6), `b24-c1-llm-call-record` (14 `it(` and one `it.each`, 36 tests) | done 2026-10-08 offline, two review rounds; the real database platform BLOCKED-LIVE-QUALIFICATION (LB-14), a scheduled write on a serverless host (LB-13), live usage shapes (LB-2, LB-7, LB-9); census 168 / 165 / 3 / 0, counts 47 / 36 / 9 / 27, 107 action records, 32 migrations; [B24-D1, 2026-10-09] the workflow line is now `:381` after B24-D1's OD-30 steps at `:32` and `:344-345` |

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

# B24-C2 - Observability and replay, part 2: attribution, cost and latency

Base: `4ec18eb` on `chapter/b24-production-qualification` (B24-A1..A4, B1, B2, B3 and C1 committed). B24-C2 closes D24-22 and D24-23
offline (this part; runbook `:1076` "request and trusted context references;", `:1080` "tool discovery/calls/results;", `:1084`
"retries/cancellation/errors;", `:1085` "token/cost/latency budgets;", `:1086` "final user-visible result."; `:1088` "Do not store hidden
reasoning. Redact secrets and sensitive source content."; OD-208 applied, OD-209's cost half amended, OD-232 the choices beyond them) and
D24-13 and D24-25 (`retention-and-deletion.md`). It was delivered in one workflow run in two tagged halves for one commit by the lead
(lead decision D21): B24-C2a, this part; B24-C2b, retention and redaction. Every line number below is the B24-C2 working tree's unless it
names another tree. The labels are part 1's.

## 19. What B24-C2a is

- **What it is.** One sibling record per validated run trace, written ONCE after the recorder has handed the trace to C1's sink and
  never read by any route, tool or page (readers are B24-C3's, OD-211): `agent.run-trace-attribution.v1`
  (`app/lib/observability/run-trace-attribution.ts`), the document `sirkit.agent-run-trace-attribution.v1`, keyed by trace id in the run's
  scope, bound to the stored trace by `traceDigest` (`agentRunTraceDigest`). It says who asked (the trusted context by digest and closed
  class), what was asked (a salted message digest and the character count), what was discovered (the toolset digest and count) and read
  (per read, the source revision and the consumed resources' ids and digests), what was refused before it ran (the closed classes), what
  the user saw (a salted answer digest and the count), the provider's request ids, the budget, the cost through the one price table and the
  latency on a monotonic clock. Beside it, one `agent.trace-salt.v1` per scope (`trace-salt.ts`), created once by compare-and-set.
- **What it is not.** No route, agent or MCP tool, action record, UI control, environment name or flag, migration or dependency (OD-42):
  the census stays 168 / 165 / 3 / 0, the tool counts 47 / 36 / 9 / 27, the action records 107, the migrations 32 (both aggregates ride the
  durable-workflow tables), the classification CSV byte-identical, `.env.example` unchanged, the nine B11-scanned files at their hashes.
  No text field of any kind: every value is a digest, an id matching a pattern, a closed class, a count or a bounded number, and
  `findSecretShapedPath` runs over the whole document (`b24-c2-attribution` 2). Nothing in `trace.ts` or `trace-recorder.ts` moved.
- **What the builder did not run.** No `next dev`, `next build`, `next start` or Playwright; no database but PGlite in the test process;
  no provider, model, host or account. Every live half is **BLOCKED-LIVE-QUALIFICATION** (section 25).

## 20. The pre-edit counterexamples (red first; **CONFIRMED**)

- **C2a.** `b24-c2-attribution` and `b24-c2-cost` failed to load on `4ec18eb` ("Cannot find module `@/app/lib/observability/trace-salt`",
  "Cannot find module `@/app/lib/evaluation/model-price-table`"; exit 1, 2.66 s). Their behavioural counterexamples are the cases themselves:
  case 1 (no attribution exists for a completed chat request under the fixture runtime) and case 7 (an `AgentStep` carries no request id)
  cannot pass on `4ec18eb`'s adapters and route.
- **C2b.** `b24-c2-retention` and `b24-c2-retention-pglite` failed to load (no policy, no port); `b24-c2-redaction` ran 2 / 10 on
  `4ec18eb`'s three stores (exit 1, 2.96 s): a secret-shaped instruction was stored in the grant's excerpt as typed, a key fragment survived
  the 240 cut, U+200B was kept, 501 edits left 501 audit entries, a 501-entry stored project loaded whole, a 29,000-character change set was
  stored, and the provider's `detail` and log line carried the key (`retention-and-deletion.md` section 1).

## 21. The attribution document (D24-22, OD-208; **CONFIRMED** in memory)

- **Where and when.** One aggregate per trace id, `durableWorkflowId("agent-run-trace-attribution", { ...scope, traceId })`, written at
  revision 0 by compare-and-set with `outbox: []` under the idempotency key `run-trace-attribution:<traceId>` (a replay writes nothing;
  the same trace id again answers `replayed`), validated before persist, the record digest and the document digest re-verified on load
  (`AGENT_RUN_TRACE_ATTRIBUTION_MISMATCH`, one closed error). The write is scheduled from the route's `finalizeTrace`
  (`app/api/chat/route.ts:463`, in place) after the recorder's hand-over, through the composition root `app/api/chat/attribution-runtime.ts`
  (beside C1's `trace-runtime.ts`; its one production importer is the route, on its line 35): the repository is `getDurableWorkflowRepository()`
  resolved at write time (PostgreSQL in production, the fixture runtime's in-memory repository under the fixture runtime), the pending writes
  bounded at 64, every failure counted by a closed class - `trace_unavailable`, `store_unavailable`, `refused`, `write_failed`, `dropped` -
  and nothing about the write can change the stream, the terminal or the run (`b24-c2-attribution` 10: a throwing store factory, B21-B's
  recorded stream digest unchanged).
- **The closed keys**, in order: `schema`, `runId`, `traceId`, `traceDigest`, `scope`, `trustedContext` (`correlationId`, `role`,
  `membershipRevision`, `authClass`, `principalRef`), `request` (`messageDigest`, `messageChars`), `plan` (`kind`: `single`, `dag`,
  `refused`), `toolset` (`declarationsDigest`, `toolCount`; null for a refused plan), `reads` (`canonicalRevisionDigest`, `count`, `withheld`,
  `entries[]` of `sourceRevisionDigest`, `resources[]` of `resourceId`, `sourceVersion`, `contentDigest`, and `resourcesWithheld`),
  `refusedCalls` (the six `tool_refused` statuses of `loop.ts` - `unknown_tool`, `budget_exhausted`, `invalid_input`, `repeated_call`,
  `proposal_exists`, `execution_exists` - plus `other`), `provider` (`requestIds`, `requestIdsWithheld`, `retryCeiling`, `sdkRetriesObserved`),
  `answer` (`digest`, `chars`, `outcome`; null when nothing was answered), `deploymentConfigurationDigest`, `budget` (the six fields),
  `cost`, `latency` (`clock`, `firstTextOffsetMs`, `terminalOffsetMs`, `eventOffsets[]` of `seq`, `offsetMs`) and `diagnostics` (the closed
  pair `salt_unavailable`, `deployment_configuration_unavailable`). An unknown key, a text value, a reasoning-shaped key and an unsalted
  digest where a salted one belongs are refused and nothing is written (case 2).
- **The salt (OD-232, a stated choice: per scope, finer than OD-208's per tenant).** One random 32-byte salt per (tenant, project, branch),
  kept as `agent.trace-salt.v1` (`saltHex`, created once by compare-and-set under one idempotency key per scope); two concurrent first runs
  converge on one salt (the loser meets the winner's replay or the moved head and reads it back; case 9, the store and two parallel chat
  requests). The digests are `sd1-` + HMAC-SHA256(salt, domain NUL text) with the domains `principal`, `message` and `answer`, so equal
  texts in different roles never share a digest. The salt is never logged and never written into a trace or an attribution; when it cannot
  be resolved the digests are null and the diagnostic is `salt_unavailable` - an unsalted digest is never written (cases 3, 10). Deleting a
  scope's salt crypto-shreds every salted digest written under it (`retention-and-deletion.md`).
- **The sources.** `trustedContext` from the route's trusted context only (`principalId` salted, `role`, `membershipRevision`,
  `authClass` = `AuthMethod`, `correlationId` as a bounded id); `request` from `userMessage`; `plan.kind` from `planChatRun`
  (`route.ts:426`); `toolset` from `buildRunToolset(...).declarations` on the run's registry and context, recomputed at record time (the
  loop's own derivation; a refused plan has none); `reads` from a `ReadToolInvocationService` the composition root constructs and the route
  injects through the gateway's existing `readService` option (`route.ts:398`; `gateway.ts` unchanged), at most 64 reads of 64 resources
  each, the rest counted (case 4); `refusedCalls` and the first `text_delta` and `run_completed` from the route's `emit` (`route.ts:486`);
  `provider.requestIds` from the coordinator adapter, observed in place (`route.ts:427`): each resolved step's `providerRequestId` - the
  SDK's `_request_id`, which both installed SDKs type `_request_id?: string | null` on a parsed response (`@anthropic-ai/sdk` 0.98.0 and
  `openai` 6.48.0, `internal/parse.d.ts:14`; INFERRED from the declarations, no live call) and which the two adapter normalizers set in
  place (`adapters.ts:88, :190`; [B24-C2 review, 2026-10-09] re-derived by anchor: the `usage:` lines, not the `model:` lines below them) only when the response carries one, as the optional `providerRequestId` of `AgentStep` (`contracts.ts:233`)
  - at most 2 x `maxModelSteps` (12), each matching `^[A-Za-z0-9_-]{1,128}$` and free of a secret shape, the excess and the withheld
  counted in `requestIdsWithheld` (cases 4, 7). A dag plan's follow-up turn runs on the same observed adapter under the same budget
  (`orchestration-runtime.ts` keeps `...rest` and wraps `deps.adapter`), so its ids are counted and no specialist id is (case 14, B21-E3's
  scenario 17: the first turn's and the follow-up's ids, none withheld). `retryCeiling` is the coordinator adapter's configured value,
  `COORDINATOR_SDK_RETRY_CEILING` (`adapters.ts`, appended): OpenAI `2` (`maxRetries: number = 2`), Anthropic `"sdk_default"` (`maxRetries`
  passed only when given); `sdkRetriesObserved` is always `"unknown"` - 9.5 item 33 stays UNKNOWN, stated, never guessed (case 8). `answer`
  is the salted digest and the length of `run_completed.finalText` with the trace's terminal outcome; a refused plan answers its refusal
  text (`emitRefusedRun`), so its answer is that text's digest (case 5b).
- **The deployment configuration digest (OD-199).** A1's record digests the provider registry among its inputs, so the chat route may not
  import it: the B19-D chat-closure tripwire and `b23-a-tier3-vocabulary` 7 keep `app/lib/manufacturing-providers/` out of the route's
  closure (case 12 pins that `app/lib/deployment/configuration.ts` is not in it). `instrumentation.ts` therefore builds the record once at
  start-up, after the fixture clock and C1's binding, and publishes its digest on a `globalThis` slot
  (`app/lib/observability/deployment-configuration-digest.ts`; a record that cannot be built publishes nothing and never blocks start-up);
  the attribution reads the published digest, or carries null with `deployment_configuration_unavailable` (case 13: unpublished, then
  `register()` under the nodejs runtime publishes exactly `deploymentConfiguration().digest`). The call records carry no digest (OD-231 (j)):
  one place, never both.
- **Recording is passive and total.** The collector (`run-attribution-collector.ts`) never throws into the stream, the recorder or the
  adapter and changes no event, step or document; a throwing inner sink still throws to the recorder, which classifies it (case 6).
  `record` is idempotent across the route's three `finalizeTrace` paths. Specialist traces are attributed by B21-E's per-task record
  (`trace-attribution.ts`), stated, not rebuilt. The trace's own `argsDigest` and `outputDigest` stay unsalted (B11's open question,
  `redaction-and-retention-policy.md:52-57`; salting them would be a pin move on `trace.ts`).

## 22. Budgets, cost and latency (D24-23, OD-209's cost half; **CONFIRMED**)

- **`budget`.** The run's `AgentRunBudget` snapshot: the six fields of `request.budget`, which is `DEFAULT_AGENT_BUDGET`
  (`contracts.ts:181-188`, `route.ts:508`): `maxModelSteps` 6, `maxToolCalls` 10, `perToolTimeoutMs` 15,000, `runDeadlineMs` 120,000,
  `maxIdenticalCalls` 2, `executionSettlementTimeoutMs` (case 1).
- **One price table (lead decision D1).** `app/lib/evaluation/model-price-table.ts`, beside B3's `live-spend.ts` (OD-232: the one table
  sits beside the one schema), declares `MODEL_PRICE_TABLE: LivePriceTable | null = null` - no owner table has been supplied; a test pins the
  null (`b24-c2-cost` 1, 5) - and `priceUsage({ provider, model, usage }, table)`, which prices through B3's `livePriceTableProblems` and the
  `procurement.ts` decimal helpers: `costMicrounits = addDecimal(multiplyDecimalByInteger(inputPerMillion, inputTokens),
  multiplyDecimalByInteger(outputPerMillion, outputTokens))` - a price per million tokens times a token count is the cost in millionths of the
  currency, the per-million units B3 compares in, so there is no division and no rounding; no `Number(`, `parseFloat` or `parseInt` touches
  money (source check, case 4). It answers `{ status: "unpriced", reason }` with the closed reasons `no_owner_price_table` (no table, or a
  table the validator refuses: never used to price), `model_not_in_table` (the model matched exactly: never a prefix, never another provider's
  model, never a default price) and `usage_out_of_range` (a token count that is not a safe integer in 0..100,000,000, `multiplyDecimalByInteger`'s
  range) - never a throw, never zero (runbook `:147`; a zero cost is a priced zero against a table) - or `{ status: "priced",
  priceTableVersion, currency, costMicrounits }` (cases 2, 3: `"20"` for 10 in and 5 out at 1 and 2 per million; `"525.3"` for 1234 in and
  567 out at 0.15 and 0.60). No second schema, validator, table constant or money cap exists: no `sirkit.model` + `-price-table` name under
  `app/` or `scripts/` (case 4, the needle joined). The route prices the trace's `terminal.usage` at write time with `trace.provider` and
  `trace.model` and passes the result in; C1's call records keep their token counts and are never stored priced (C3's read mode prints
  tokens as stored); OD-107's "reported, not priced" stays true until the owner supplies a table.
- **`latency`.** `{ clock: "monotonic", firstTextOffsetMs, terminalOffsetMs, eventOffsets: [{ seq, offsetMs }] }` on an injected monotonic
  clock (`performance.now` in production), measured where OD-208 asked: at the sink's `append` (C1's sink wrapped at `route.ts:437`, one
  entry per appended trace event keyed by its `seq`, at most `TRACE_BOUNDS.maxEvents` = 256, non-decreasing) and at the first `text_delta`
  seen by `emit`; `terminalOffsetMs` is the trace's terminal event's offset; never inside `trace.ts` or `trace-recorder.ts` (case 6: offsets
  10, 30, 40, 50, 90 on a stepped clock; a 300-step run keeps exactly 256).

## 23. What is not recorded (**CONFIRMED** where a case names it; otherwise **INFERRED**)

- The SDK's own retries: `sdkRetriesObserved` is `"unknown"` by contract (D24-22's UNKNOWN, 9.5 item 33). One record per run, however many
  HTTP requests the SDK made; the request ids are the responses' ids as the SDK surfaced them.
- Specialist turns: attributed by B21-E's per-task record, not here; their request ids are not collected (the specialist adapters are
  `agentAdapterForRole`'s, not the observed coordinator adapter).
- Tier 2 approvals: browser-local (OD-210; B24-C3 records the limitation).
- Reads beyond 64, resources beyond 64 per read, request ids beyond 2 x `maxModelSteps`: counted, not kept.
- A run that dies before finalization, a request refused before the recorder, a trace the recorder never hands to a sink, a replay: no
  attribution, as part 1 states for the trace (section 6).
- Content of any kind: no prompt, answer, query, tool argument, provider message or principal id - only their digests or counts.

## 24. The import gates and the pins (**CONFIRMED**, `b24-c2-attribution` 11, 12; the gate sets of section 28)

- The attribution store's runtime imports are exactly `../agent/trace`, `../durable-workflow/stable`, `../engineering/stable`; the salt
  store's `../durable-workflow/stable`, `node:crypto`; the price table's `../release-engineering/procurement`, `./live-spend`. The closures of
  the attribution store, the salt store, the collector, the digest slot, the price table, C1's run-trace store, the loop, the gateway, the
  trace contract and the recorder reach no provider SDK specifier and none of `durable-workflow/runtime.ts`, `server-repository.ts`,
  `db/client.ts`, `db/schema.ts`, `trace-runtime.ts` or `attribution-runtime.ts`, so B24-C3's trace-read core can verify through the stores
  (D11). C1's gates hold unmoved: `trace-runtime.ts` keeps its three runtime specifiers and its one production importer (the route, line 40,
  as C1 left it); `run-trace-store.ts`'s importers are `trace-runtime.ts` and `app/lib/observability/`; the one `PostgresDurableWorkflowRepository`
  construction stays `durable-workflow/runtime.ts` (neither composition root nor the retention port constructs one: D11, prefer neither).
  The route keeps its 562 lines and B21-E4's markers at 35, 504 and 507; every C2 edit is in place on the lines C1 left (35, 398, 427, 437,
  463, 486).
- The nine B11-scanned files hash to B21-E2b's `SCANNED_AT_HEAD`, read from its source (lead decision D20; case 11 holds no hash of its own).
- **Two reviewed pin moves, each in place with a dated `[B24-C2, 2026-10-08]` note:** `b24-c1-llm-call-record` 12's `SEAM_CLOSURE` gains
  `app/lib/agent/redaction.ts` (reached through `llm/errors.ts`, which now runs the provider's message through the redaction authority; the
  module imports nothing, so no closure grows beyond it); `b21-e1-stop-reasons` 1's `AgentStep` field list gains `providerRequestId?`
  (folded onto the `model` line after a doc comment, so no cited line of `contracts.ts` moves; E1's `stop?` stays the one field E1 added).
  Neither was listed in the task's "pins this change could move"; both are listed here and in the ledger text.
- The workflow line (database-delivery `:341`) moved B21's C49, C93 and C94 (`:372` -> `:373`, `:375` -> `:376`, `:384` -> `:385`; [B24-closeout, 2026-10-10] superseded: B24-D1's record, artifacts/ai-control-plane-b24/performance-and-reliability.md:305.
  `b21-f-page` 6), `ci-admission.md:185` (`:358` -> `:359`) and added A1's insertion-table row (`b24-a1-environment-profile` 14, 16, 17 green);
  B23's C64 and its prose citation cite `:335`, above the line, and did not move.

## 25. Live: BLOCKED-LIVE-QUALIFICATION

- **LB-14** (the database platform): no attribution, salt or purge touched the real database platform or any staging or production database;
  every database proof ran on PGlite in the test process (`b24-c2-retention-pglite`), every other suite with `DATABASE_URL` unset or emptied
  (vitest's guard). The purge CLI, its dry run included, never ran against a live database and never will by the builder (OD-191, OD-202).
- **LB-13** (staging and production): the attribution's write is scheduled after the response, as C1's; whether a serverless platform keeps
  it alive is UNKNOWN until the owner names the platform (OD-190). `instrumentation.ts` now also builds A1's record at start-up; its first
  production build is `production-smoke`'s CI run on this commit (the lead's; section 30).
- **LB-2, LB-7, LB-9** (live models): the request ids, their shapes and the SDKs' retry behaviour were observed on fakes only; a live
  provider's `_request_id` is INFERRED from the SDK declarations and never seen.

## 26. What stays open (**INFERRED**, low)

- The salt record is a durable row like any other: an operator with database write access can read it and recompute a digest from a
  guessed text (a dictionary attack on the message digests); the salt's purpose is to stop correlation across scopes and the casual reading
  of a digest, not to resist an insider with the row. Deleting the salt crypto-shreds the digests; no key management exists in the product
  (OD-42).
- `deploymentConfigurationDigest` is null wherever `register()` did not run (a test process, a worker without instrumentation): the
  diagnostic says so; nothing else changes.
- The toolset digest is recomputed at record time from the same registry and context the loop used; a context that changed between the two
  computations (none does today: `runContext` is frozen for the run) would digest differently.
- The B11 trace's `argsDigest` and `outputDigest` stay unsalted (B11's open question); salting them is a `trace.ts` pin move for the owner.
- Under the fixture runtime every attribution's `at` is the frozen instant, as every durable time there (part 1, section 12).

## 27. Superseded statements, handed to B24-F (file:line at C2's commit)

- `app/lib/observability/llm-call-record.ts:1-20` and part 1's section 4: "never ... a provider request id (OD-208, B24-C2)" - still true
  of the call record; the run's request ids are now kept on the attribution, not the call record (stated here, not edited).
- Part 1's section 11 (`observability-and-replay.md:296-304`), "Retention and deletion ... nothing purges either aggregate" and
  "Attribution, cost and principal ... no request digest, principal digest, budget, per-event offset, provider request id or cost is
  recorded" - true of C1's tree, superseded by this increment (left as written; this part is the record).
- `artifacts/remaining-builder-program/OWNER_DECISIONS.md`, OD-209's "B24-C2 amends this entry when it prices recorded usage" - amended in
  this commit (the lead's file; the dated amendment is in section 30).
- `artifacts/ai-control-plane-b24/discovery.md:951` (the lead's file), OD-202's "MCP traces 90 days" and "answer text 30 days", and `:952`
  OD-208's "per-tenant salted" - restated by `retention-and-deletion.md` and section 21 (the MCP and B05 traces are rings, so process
  lifetime; the resume record is deleted whole; the salt is per scope).
- `app/lib/agent/trace-recorder.ts:41-45` and `:108-109` stay as part 1's section 10 records them (B11-scanned, not edited).

## 28. Test-first record and gates (2026-10-08; **CONFIRMED**)

Every run went through the lock script (two workers), `DATABASE_URL` unset in the shell and emptied by vitest's guard; no browser spec ran.
"files" is passed (+ skipped) of the total; "tests" likewise. Logs are kept outside the repository (`scratchpad/b24/logs/c2-*.log`).

| step | what ran | result |
|---|---|---|
| baseline, `4ec18eb` | the 15 pinned suites C2 touches (`b24-c1-llm-call-record`, `b24-c1-durable-trace`, `b21-e1/e3/e4/f-page`, `b23-b-dfm-quote-flow-page`, `b23-a-tier3-vocabulary`, `b23-a-provider-admission`, `b23-b-egress-import-gate`, `b24-a1-environment-profile`, `errors.test`, `b22-c-ai-evidence`, `b19-e-ci-job-scope`, `b19-d-external-text-injection-route`) | 15 files, 182 / 182, exit 0 (46.1 s) |
| C2a red | `b24-c2-attribution`, `b24-c2-cost` | 2 files failed to load (no `trace-salt`, no `model-price-table`); exit 1 (2.7 s) |
| C2a green, three runs | the same, after the modules, the route, the adapters, the contract and `instrumentation.ts` | 13 / 19 then 15 / 19 then 18 / 19: every red the suite's own expectation (the `local_dev` principal is the project admin; a Tier 3 refusal is `run_completed` with no step; the D11 regex matched a docblock that spelled the constructor - reworded; the retry ceiling made a closed class; the membership revision's form; C1's store factory bound in the test; the composition root names the aggregates); the last red awaited C2b's policy |
| C2b red | `b24-c2-retention`, `b24-c2-redaction`, `b24-c2-retention-pglite` | 2 files failed to load; redaction 2 / 10 (section 20); exit 1 (3.0 s) |
| C2b green, two runs | the five C2 suites | 36 / 41 (the straddling fixture began inside a token, so the design-text rule rightly kept it; `request-run` on a made-up plan; the ellipsis cut may split the replacement token; the census regex ran across lines and missed the resume record; the script's docblock spelled the variable - each the suite's own), then **5 files, 41 / 41, exit 0 (23.5 s)** |
| tsc | `--noEmit -p tsconfig.json` | exit 2 (six: the auth class union, two literal-typed parameters, the hostile sink's type, the variable fixture) then **exit 0** |
| eslint | the 25 changed TypeScript files | exit 1 (a loop variable named `module`) then **exit 0** |
| `app/lib/qualification` (every B24 suite, the PGlite ones included) | 37 files | 36 / 37 (A1's flag census: two imports at the top of `spice/project.ts` moved its cited `:72`; hoisted to the end) then **37; 375 + 3, exit 0 (137.9 s)** |
| `app/api/chat/__tests__`, `app/lib/llm/__tests__`, `app/lib/computation/__tests__` (`b22-closeout-statements`, `b22-c-ai-evidence`), `b19-e-ci-job-scope` | 59 files | **57 + 2; 488 + 18, exit 0 (73.5 s)** |
| `app/lib/agent/orchestration/__tests__` (the hash pins, the import gates, the B21 pages, `b21-closeout-statements`) | 49 files | 48 / 49 (`b21-e1-stop-reasons` 1: the `AgentStep` field pin; moved in place, section 24) then, with `app/lib/manufacturing-providers/__tests__` (`b23-closeout-statements`, `b23-a-provider-admission` 8, `b23-b-dfm-quote-flow-page` 3): **30 files; 393, exit 0 (130.3 s)**; the other 48 orchestration files 459 / 459 in the first run |
| `app/lib/agent/__tests__` (B09-B11, `b11-5-capture-exactness`), `app/lib/execution-grant/__tests__`, `app/api/agent/__tests__`, `app/lib/durable-workflow/__tests__`, `app/lib/fixture-runtime`, `app/lib/spice/__tests__`, `b18-c-granted-execution-dialog`, `b18-d-granted-execution-card` | 54 files | **52 + 2; 763 + 5, exit 0 (45.1 s)** |
| `app/lib/auth/__tests__`, `app/api/__tests__` (the census 168 / 165 / 3 / 0) | 68 files | **68; 1538 + 9, exit 0 (88.6 s)** |
| `app/lib/mcp`, `app/api/mcp/__tests__` (the tool counts 47 / 36 / 9 / 27, the process gate) | 52 files | **52; 920, exit 0 (114.5 s)** |
| `app/lib/engineering/__tests__`, `app/lib/project/__tests__` (`b14-4-ast-import-gates`) | 136 files | **136; 1401, exit 0 (156.9 s)**, no worker timeout |
| the database-delivery list (the workflow's `:322-341`: `app/lib/db` and 19 files) | 25 files | 21 + 3 / 25 (B16-B's env tripwire: the retention suite read `process.env.DATABASE_URL` bare; now a constant) then the two files **33 / 33, exit 0 (25.0 s)**; the other 23 files 189 + 12 in the first run |
| generators | `generate-agent-artifacts` (36 of 47 tools), `generate-b16-0-2-artifacts`, `generate-b17-control-inventory` (631 controls, 63 surfaces), `generate-b11-artifacts` (19 / 19, 61 / 61), `generate-action-toolability-matrix` (107 records, 154 entries) | each exit 0; the tree's hash (`git diff` and every untracked file) `9a5d0ca8...` identical before and after, 30 status entries: **zero drift** |
| control bytes and line endings | every changed or new file | none holds a control byte or a CR |
| the closeout tripwires and the page suites | `b21-closeout-statements`, `b22-closeout-statements`, `b23-closeout-statements`, `b24-c1-durable-trace` 13, `b24-a1-environment-profile`, the five C2 suites, after both pages were written | recorded in the increment report (a page cannot carry the result of the run that reads its final text; the C1 precedent) |
| review round, 2026-10-09 (test-first) | `b24-c2-redaction` with case 5's fourth bound, case 6's pre-redaction stored entry and the new case 11 on the unfixed stores | **red** 3 / 11 (5: the bounds held three keys; 6: a stored key-bearing reason loaded as typed; 11: the evidence `signal` stored as typed), exit 1 (2.5 s); after the fix **11 / 11, exit 0** (2.5 s) |
| review round, 2026-10-09 (test strength) | `b24-c2-retention-pglite` with the new case 6, against the port with its three `head_moved` throws deleted (`retention.ts:201, :203, :206`), then against the port restored byte for byte (sha256 `431e9dfc…ac53e` before and after) | mutated: **5 / 6** - case 6 red at its `applyRetention` assertion (deleted aggregates 3, records 4, replays 5; `head_moved` 0), cases 1-5 green, so the five earlier cases did not reach the guards; restored: **6 / 6, exit 0** (3.5 s). A first mutated run failed for the wrong reason (the suite had not imported `applyRetention`, a `ReferenceError`) and does not count; the import was added and the proof re-run |
| review round, 2026-10-09 (gates) | the C2 gate sets, tsc, eslint and the five generators on the final tree | in the increment report (the same precedent) |

Not run by the builder: both Playwright configs, `next build`, `next start`, `next dev` and CI (section 30). The B17-A browser suite is not
needed: C2 changes no UI and no control (`generate-b17-control-inventory`: no drift).

## 29. Suites

| suite | it( | cases |
|---|---|---|
| `app/lib/qualification/__tests__/b24-c2-attribution.test.ts` | 14 | the fixture-runtime counterexample with the closed keys, the budget and the unpriced cost; the Tier 3-refused plan; the dag run's request ids and an unknown-tool refusal; the one salt; passive failure; the published digest; the validator and the store; `salt_unavailable`; the bounds; the monotonic clock; the real adapters' `_request_id`; the retry ceiling; the B11 hashes (D20); the import gates and the route's lines |
| `app/lib/qualification/__tests__/b24-c2-cost.test.ts` | 5 | unpriced without a table; exact decimal text; the refused table, the unknown model, the range; one schema; the pins |
| `app/lib/qualification/__tests__/b24-c2-retention.test.ts` | 7 | the policy rows and the aggregate census (34 types); allowlist-only; the planner's cutoffs, limit and digest; the CLI's dry run and refusals; the closed flags; dry run then apply; the output rule and the modules' imports |
| `app/lib/qualification/__tests__/b24-c2-redaction.test.ts` | 11 | the grant excerpt (four); the SPICE audit log (five: the bound, the load with a pre-redaction entry, the change set, B22-C's fields, the evidence references - [B24-C2 review, 2026-10-09] case 11 added, case 6 extended); the provider detail (two) |
| `app/lib/qualification/database/__tests__/b24-c2-retention-pglite.test.ts` | 6 | the dry run; the apply; the kept and fresh rows; the completed outbox and the deferred keys; `mixed_commit`, `outbox_in_flight` and the moved set; `head_moved` by the port itself ([B24-C2 review, 2026-10-09] case 6 added: the moved head, the moved record set, the grown replay set) |

The four non-PGlite suites ride prompt-to-gerber's `app/lib/qualification/__tests__` filter (OD-222); the PGlite suite is admitted to
database-delivery by its one line (`:341`), outside every prompt-to-gerber filter (`b19-e-ci-job-scope` green). Slowest cases: `b24-c2-attribution` 12
(13.4 s, the closures; limit 180 s), `b24-c2-retention` 1 (9.2 s, the census; limit 120 s); every case over 1.5 s declares its own timeout.

## 30. For the lead (B24-C2a's share; B24-C2b's is on `retention-and-deletion.md`)

Every text below is written out in full for a reserved file. Nothing here was written to `OWNER_DECISIONS.md`, `EXECUTION_LEDGER.md`,
`PROGRAM_STATE.json`, `LIVE_BLOCKERS.md`, `discovery.md` or the B24 `README.md`. No OD-208 heading exists at `4ec18eb` (`grep '^## OD-208'`
finds none), so the entry below is its one heading; OD-209's heading is B3's (`OWNER_DECISIONS.md:2903`), so its cost half is a dated
amendment; the next free number at `4ec18eb` is OD-232 (the headings end at OD-231, `:2946`), one entry for every C2 choice (on
`retention-and-deletion.md`).

### Closure clauses (each one dated line under its defect in `discovery.md`)

- [B24-C2, 2026-10-08] D24-22: closed offline by B24-C2 (OD-208 applied; OD-232): every validated run trace gets one `sirkit.agent-run-trace-attribution.v1` beside it (`agent.run-trace-attribution.v1`, `app/lib/observability/run-trace-attribution.ts`), keyed by trace id in the run's scope and bound to the stored trace by digest, written once by compare-and-set from the chat composition root (`app/api/chat/attribution-runtime.ts`, imported in place on `route.ts:35`) after the recorder's hand-over: who asked (the trusted context by closed class and a per-scope salted principal digest, `agent.trace-salt.v1`), what was asked (a salted message digest and the count), the discovered toolset digest, at most 64 reads' source revisions and consumed resources, the refused-call classes, the provider request ids (the SDKs' `_request_id`, at most 2 x maxModelSteps, bounded), the retry ceiling with the SDK's retries stated UNKNOWN, a salted answer digest and A1's deployment configuration digest published by `instrumentation.ts`; no text field, `findSecretShapedPath` over the document, no edit to a B11-scanned file; proven through the production chat POST in memory (`b24-c2-attribution`); the real database platform is BLOCKED-LIVE-QUALIFICATION (LB-14), live request ids LB-2, LB-7, LB-9; `observability-and-replay.md` part 2.
- [B24-C2, 2026-10-08] D24-23: closed offline by B24-C2 (OD-209's cost half amended; lead decision D1): the attribution carries the run's budget (`DEFAULT_AGENT_BUDGET`'s six fields), its cost through the program's one price table (`app/lib/evaluation/model-price-table.ts`: `MODEL_PRICE_TABLE: LivePriceTable | null = null`, `priceUsage` over B3's `sirkit.live-price-table.v1` validator and the `procurement.ts` decimal helpers - decimal text in per-million units, no division, no float; "unpriced" with a closed reason until the owner supplies a table, never zero) and its latency on a monotonic clock (one offset per appended trace event by seq, at most 256, the first text delta and the terminal) measured at C1's sink and the route's emit, never inside `trace.ts` or `trace-recorder.ts`; C1's call records stay token counts, never priced (`b24-c2-cost`, `b24-c2-attribution` 1, 6); `observability-and-replay.md` part 2.

### Section 10 amendment (for `discovery.md`)

- [B24-C2, 2026-10-08] B24-C2 landed attribution, cost and latency (D24-22, D24-23; OD-208 applied, OD-209's cost half amended) and retention and redaction (D24-13, D24-25; OD-202 applied) in one run, C2a then C2b (OD-232 the choices beyond the drafts); one workflow line (database-delivery `:341`); suites `b24-c2-attribution`, `b24-c2-cost`, `b24-c2-retention`, `b24-c2-redaction`, `b24-c2-retention-pglite` (section 7 wrote `b24-c-*`; `CHAPTERS`' `b24-` admits both). Pins the plan did not name, each moved in place with a dated note: `b24-c1-llm-call-record` 12's `SEAM_CLOSURE` (+ `app/lib/agent/redaction.ts`, reached through `llm/errors.ts`), `b21-e1-stop-reasons` 1's `AgentStep` field list (+ `providerRequestId?`), `ci-admission.md:185` (+1). The census the task named as 30 types at `f663d71` is 34 at C2 (C1's two, C2's two); OD-202's "MCP traces 90 days" and "answer text 30 days" and OD-208's per-tenant salt are restated (process lifetime for the rings; the resume record deleted whole; the salt per scope). No migration (32), no census, tool-count, classification or flag move. `observability-and-replay.md` part 2, `retention-and-deletion.md`.

## OD-208 — Trace attribution additions, as applied (B24-C2, 2026-10-08)

- A sibling `agent.run-trace-attribution.v1` per validated trace (`sirkit.agent-run-trace-attribution.v1`, `app/lib/observability/run-trace-attribution.ts`), keyed by trace id in the run's scope and bound to the stored trace by `agentRunTraceDigest`; never inside `trace.ts` (no B11-scanned file edited, OD-113's hashes unchanged). Written once by compare-and-set at revision 0 with no outbox effect, idempotent per trace id, validated before persist, re-verified on load (`AGENT_RUN_TRACE_ATTRIBUTION_MISMATCH`).
- Its values are digests, ids matching a pattern, closed classes, counts and bounded numbers - no text field - with `findSecretShapedPath` over the whole document: the trusted context (correlation id, role, membership revision, auth class) with a salted principal digest; a salted user-message digest and its character count; the plan kind; the discovered toolset digest and count; at most 64 reads' source revisions and consumed resources' ids and digests; the refused-call classes (the six `tool_refused` statuses plus `other`); the provider request ids as bounded strings (at most 2 x maxModelSteps, the rest counted), the configured retry ceiling and `sdkRetriesObserved: "unknown"`; a salted answer digest and count with the terminal outcome; A1's deployment configuration digest (one place: the call records carry none); the budget, the cost and the latency (OD-209).
- The salt is one random 32-byte value per scope (tenant, project, branch) - finer than this decision's per-tenant draft, OD-232 - kept as `agent.trace-salt.v1`, created once by compare-and-set, never logged, never written into a trace or an attribution; unavailable, the digests are null with the closed diagnostic `salt_unavailable`, never unsalted.
- Recording is passive: the write is scheduled from the chat route's finalization through `app/api/chat/attribution-runtime.ts` (the route's one new import, in place on its line 35), every failure counted by a closed class, the stream and the terminal unchanged (B21-B's recorded digest). Specialist traces stay attributed by B21-E's per-task record. The SDK's own retries stay UNKNOWN, stated.
- Readers are B24-C3's (OD-211); retention 90 days through OD-202's purge; live request ids BLOCKED-LIVE-QUALIFICATION (LB-2, LB-7, LB-9).

### OD-209 amendment

- [B24-C2, 2026-10-08] Cost, as applied: recorded usage is priced through the one schema `sirkit.live-price-table.v1`, its validator `livePriceTableProblems` and the `procurement.ts` decimal helpers (lead decision D1) by `priceUsage` in `app/lib/evaluation/model-price-table.ts`, whose one table constant `MODEL_PRICE_TABLE: LivePriceTable | null` is pinned `null`: every run's attribution is `unpriced` with a closed reason (`no_owner_price_table`, `model_not_in_table`, `usage_out_of_range`) until the owner supplies a table that passes the validator, by a reviewed change; a priced answer is decimal text in per-million units with the table's version and currency, never a float, never zero for "unpriced"; the money cap stays OD-216's; C1's call records are never stored priced.

# B24-C3 - Observability and replay, part 3: the read mode and the recorded limits

Base `600d1ba` (B24-C2 committed) on `chapter/b24-production-qualification`; written 2026-10-09 (local). Labels: **CONFIRMED** only for what a
named case executed or a cited line reads; **INFERRED** where the code shows a consequence as far as code can; **RECORDED** for a stated
limit; **UNKNOWN** where nothing here can tell; **BLOCKED-LIVE-QUALIFICATION** for every step that needs a real database, a host or an owner
resource. Every citation of this part is in section 41 and resolves on its line (`b24-c3-recorded-limits` 11). No reserved file was edited.

## 31. What B24-C3 is

- **The read mode (D24-26, OD-211).** B24-C2's purge CLI gains `--read`: `scripts/retention-purge.ts --read --kind <kind> --tenant <id>
  --project <id> --branch <id> [--run <runId>] [--limit <1..100>] [--acknowledge-unaudited-read]` reads one kind's records of one scope,
  each through its own store's verified reader, over a read-only adapter of the durable-workflow repository, and writes ONE JSON document
  (`sirkit.trace-read-export.v1`) to stdout. The pure core is `app/lib/observability/trace-read.ts` (C39-C46), beside C1's stores and inside
  their approved-importer root (lead decision D11: no importer list moved); the CLI's dispatch is the script's (C47-C49). No route, MCP tool,
  agent tool or UI reads a stored trace; no access record is written (`accessAudit: "not_recorded"`, OD-111 stands).
- **The recorded limits (D24-24 as recorded, OD-210; the rest of D24-26).** Each limit the program states about approvals, settlement,
  the ledger, replay and the in-process rings is a pin on the code (section 34, `b24-c3-recorded-limits`), with its strength shown over an
  injected in-memory variant of the file it pins - never a file edited on disk.
- **Code:** `app/lib/observability/trace-read.ts` (new), the `--read` dispatch in `scripts/retention-purge.ts` (its dispatcher `main` takes
  its seams as overrides and ends the database client after a read; section 33), one database-delivery line
  (`deterministic-manufacturing.yml:380`, C50; [B24-D0, 2026-10-09] was `:342` before B24-D0's 38 prompt-to-gerber `--exclude` lines at `:293-330`; [B24-D1, 2026-10-09] now `:383` after B24-D1's OD-30 steps at `:32` and `:344-345`), one in-place comment on `app/lib/durable-workflow/retention-cli.ts:13`. No reader was added
  to a C1 or C2 store: each already had a digest-verified one (C61-C64). No change to the nine B11-scanned files, to `tool-invocation.ts`, to
  the MCP trace modules, to a journal, a grant module or a route; no migration (32), no census, tool-count, classification or flag move; no
  dependency (OD-42); no UI control (no B17-A run needed).
- **Suites** (section 40): `b24-c3-trace-read` (10), `b24-c3-recorded-limits` (11) under A1's directory filter, `b24-c3-trace-read-pglite`
  (4) in A4's PGlite folder with its explicit database-delivery entry (lead decision D17).
- **Review round (2026-10-09).** The adversarial review's eleven confirmed findings are closed test-first in this tree (section 39's review
  rows): the dispatcher is driven, not only read as text (`b24-c3-trace-read-pglite` 4); the deadline is on the whole read; a withheld
  document counts every collected record; the client is ended after a read; `TRACE_READ_HEAD_MISMATCH` and `TRACE_READ_FAILED` are reached;
  the Tier 1 pin sees quoted and computed keys, assignment statements and calls naming the property; the no-access-audit filters show their
  strength; the two limits of the read mode's access control are recorded (section 36); OD-233 (i) is reworded; the hand check that stood in
  for the pre-edit run of the B22/B23 page suites is recorded as a deviation (section 39).

## 32. The pre-edit counterexample (red first; **CONFIRMED**)

- **D24-26 at `600d1ba`.** With C1's store written, no operator path returned a trace: the one operator CLI, `scripts/retention-purge.ts`
  at HEAD, contained no `--read` (`git show HEAD:scripts/retention-purge.ts`: 0 occurrences) and its parser refused the flag as unknown
  (`b24-c2-retention` 5, `RETENTION_ARGUMENT_UNKNOWN`, green at HEAD). With the core set aside, `b24-c3-trace-read` and
  `b24-c3-trace-read-pglite` fail to load: `Cannot find module '@/app/lib/observability/trace-read'` - 2 files failed, no tests, 1.52 s
  (`c3-01-red-core-absent.log`).
- **The limits suite before part 3 existed:** `b24-c3-recorded-limits` 1 failed (11, the page) / 10 passed, 21.18 s
  (`c3-02-red-limits-no-page.log`). Cases 1-10 are green on the base because they pin true facts; each shows its strength inside the case by
  turning red over an injected variant - a route importing a journal or the replay capsule, a stubbed write row for `policyFor`, a second
  `attestation` literal, a moved `session.runId`, a key list naming a run, a ring constant moved, an injected caller of a sink setter.

## 33. The read mode (D24-26, OD-211; **CONFIRMED** in memory and on PGlite)

**The four kinds** (C40), each read through its store's own verified reader - digest recomputed, document re-validated (C61-C64, C66,
C67) - and nothing else: `run-trace` (`agent.run-trace.v1`, C1), `run-trace-attribution` (`agent.run-trace-attribution.v1`, C2),
`llm-call-record` (`llm.call-record.v1`, C1), `specialist-trace` (`agent.orchestration-trace.v1`, B21-E2b, C65). Any other `--kind` is
`read_kind_unknown` before any repository call (`b24-c3-trace-read` 8): the orchestration run record (C68) and the resume record (C69, which
holds the coordinator's answer of up to 60,000 characters, C70), the grants and their index (C71, C72, with the 240-character instruction
excerpt, C73), the autonomy setting (C74), the provider exchange (C75) and the computation evidence (C76) are not traces or hold text, and
the core imports no store of theirs (its runtime imports are exactly the four stores' modules, the redaction authority, the call record's
key shapes and `durable-workflow/stable`; case 8).

**Read-only by construction** (`b24-c3-trace-read` 2; the PGlite suite 2). The core receives `DurableWorkflowRepository` (C52) behind
`readOnlyTraceRepository` (C45): `listHeads`, `history`, `loadHead` and `loadRecord` pass through under the deadline (the SELECT-only methods
of the PostgreSQL repository, C55, C56); `commit`, `claimOutbox`, `completeOutbox` and `failOutbox` reject `TRACE_READ_WRITE_REFUSED`;
`getReplay` (C53) and `listOutbox` (C54) reject `TRACE_READ_METHOD_REFUSED` - they would hand out replay results and outbox payloads of every
aggregate type in the scope. A counting Proxy over the in-memory repository sees exactly `{listHeads, history, loadHead}` across the four
kinds and a `--run` read; the repository's heads and outbox are byte-identical after every read; on PGlite every base table of the public
schema (enumerated at run time from `information_schema.tables`, the four durable tables among them) keeps its row count and row digest
after a read, a refused read and a read that meets a corrupt row. The core's runtime closure holds no retention module, and its source names
no purge. No database-level read-only session is used (a stated choice, OD-233).

**Inputs.** The closed flags: `--read`, `--kind`, `--tenant`, `--project`, `--branch` (validated by `canonicalDurableScope`, C57, and
read as the substrate stores them), an optional `--run`, `--limit` and `--acknowledge-unaudited-read`. `--limit` is per mode (lead decision
D12): with `--read` 1..100 aggregates, default 20 (C41); without `--read` the purge's 1..10000, default 1,000, untouched. Each refusal has
its own code before any repository call, before `.env.local` is loaded and before any repository is opened (`b24-c3-trace-read` 6): an
unknown flag (`read_argument_unknown`), a stray word, a repeated flag (`read_argument_repeated`), a missing value or a missing required
flag (`read_argument_missing`), a malformed `--limit` or `--run` or a value that is secret-shaped or over 512 characters
(`read_argument_malformed`, the value never echoed), a scope the substrate would refuse (`read_scope_invalid`), an unknown kind
(`read_kind_unknown`), and any of C2's purge-only flags - `--apply`, `--confirm`, `--as-of` (C44, pinned equal to `RETENTION_CLI_FLAGS`
less `--limit`) - beside `--read` (`read_arguments_conflict`). `--run` selects one run-id-keyed aggregate - `run-trace` by its run id,
`specialist-trace` by its per-task run id `<parentRunId>:<index>-<role>` - and is `read_run_unsupported` for the two kinds keyed by a
trace id or a call id (list them; each record carries its run id) and for a coordinator run id on a specialist trace (a stated choice,
OD-233). Without `--read` the read flags stay unknown to the purge parser, which refuses them as it refuses any other flag.

**Verification and the read policy** (C58; `b24-c3-trace-read` 3, 4, 5). The heads of the kind in the scope are listed (at most
`--limit`, by aggregate key), and each is read back through its store - `history` for the run-id-keyed kinds, `load` for the others - which
recomputes the record digest and the document digest and re-validates the document (C66, C67 and C1's, C2's validators). A head whose
payload names no selector or another aggregate's key is `corrupt` `TRACE_READ_KEY_MISMATCH`; a chain whose last record is not the head is
`corrupt` `TRACE_READ_HEAD_MISMATCH` (C81; case 4 edits the listing's revision and then its digest alone, the chain untouched, for every
kind); a store's refusal is `corrupt` with the store's own bounded code (`AGENT_RUN_TRACE_MISMATCH`, `AGENT_RUN_TRACE_ATTRIBUTION_MISMATCH`,
`LLM_CALL_RECORD_MISMATCH`, `AGENT_ORCHESTRATION_TRACE_MISMATCH`; anything else `TRACE_READ_FAILED`, C82 - case 4 makes a store's own reader
throw a bare object with no code and then an Error with a free-text message, and neither value is printed; the same bare throw from the
REPOSITORY is the adapter's `read_unavailable`). A `corrupt` entry carries its key, revision, status and code and nothing of the row: no
payload, no thrown message, no stack (case 4 plants a digest, a payload, a key and a type edit behind a Proxy for every kind; the PGlite
suite edits a payload in SQL). Another scope's records are
never listed, and a record of scope B kept under scope A's own key with consistent digests is `corrupt` by the store's own scope check
(case 3). A `--run` read of an absent aggregate is `absent` `TRACE_READ_ABSENT`, exit 0.

**No secret** (C59, C60; `b24-c3-trace-read` 5). A record whose rendering the redaction authority's `containsSecretShapedText` or the call
record's key-shape rule flags (a PEM marker among those shapes) is `withheld` `TRACE_READ_SECRET_SHAPED` and never printed; the whole
document is checked again before it is written, and a rendering that still carries a shape is withheld whole (one `withheld` entry keyed by
the kind, `omitted` every record collected - kept and dropped by the cap, C84). Case 5 reaches that branch: two records each clean alone
whose compact renderings together match the redaction authority's credential-in-URL pattern (C90: `scheme://` ends one record's last
warning, an `@` before any whitespace opens the next, and `JSON.stringify` emits no whitespace between them) are withheld whole with exit 1
and nothing of either printed; in the other order both are read; with the cap dropping a third record first, `omitted` is three, not the
two the check saw. **INFERRED:** that pattern crosses record boundaries, so benign content of that shape withholds the document whole -
over-withholding, the policy's safe side (section 36). **RECORDED:** the B11 trace validator does not know the PEM marker (a warning carrying one is admitted by `validateAgentRunTrace`
and kept by C1's store), so the withholding is what keeps it off the operator's screen; a key-shaped value never reaches `ok` in any kind - the
validators refuse it on write and on read (`corrupt`) - and the stdout of every case is clear of secret shapes.

**Export** (the closed keys C80; `b24-c3-trace-read` 1, 6). One JSON document on stdout, no file write; its closed keys in order: `schema`
(`sirkit.trace-read-export.v1`), `generatedAt`, `target` (host:port/database only), `scope`, `kind`, `accessAudit` (`not_recorded`),
`records` (key, revision, recordDigest, document - the verified stored record), `refused` (key, revision, status, code), `truncated`,
`omitted`. The output is capped at 1 MiB UTF-8 (C42): whole records are dropped from the end, never cut (60 run traces of 250 steps, 1.5 MB,
read at `--limit 100`: the kept records are the first n heads, each whole and equal to its stored digest). The WHOLE read has a 30 s
deadline from its first repository call (C42, C83, C85), and so has each repository call within it; on expiry, or on a driver error at the
repository's opening or after the first repository call, the export is still one JSON document with one `refused` entry keyed by the kind,
status `unavailable`, code `read_unavailable`, and no driver text (a fake clock: a hanging first call, and a repository answering every
statement after 20 s - the listing, then the one chain, 40 s in all - are each still pending at 29 999 ms and `read_unavailable` at 30 000
ms; an injected throwing repository whose message carries a user:password URL). **Exit codes** (C43): 0 every record `ok` or `absent`; 1 any
record `corrupt` or `withheld`; 2 refused before reading; 3 `read_unavailable`.

**Production runtime** (`b24-c3-trace-read` 7; the PGlite suite 2). Under the purge's predicate (A1's `staging` or `production` profile,
or `NODE_ENV=production`, evaluated after `.env.local` is loaded) the read is refused `read_production_unacknowledged` with zero repository
calls; with `--acknowledge-unaudited-read` it reads and the export states `accessAudit: "not_recorded"` (OD-211; OD-111 stands).

**The CLI wrapper** (C47-C49; `b24-c3-trace-read` 9, 10). `scripts/retention-purge.ts` dispatches on `selectsTraceRead(argv)` - any
`--read` - before the purge parser sees the arguments; the purge mode's behaviour is unchanged (the same `runRetentionCli` call with the same
port, clock, writers and production predicate, now reached through the dispatcher, the predicate evaluated when the dispatcher runs). The
read mode follows `scripts/db-migrate.ts` (C77-C79): the arguments parse first, `.env.local` is loaded only here (`loadEnvLocal`, handed to
the core as its loader; the purge mode never calls it), a missing `DATABASE_URL` exits 2 naming the variable only, the target is printed as
host:port/database, and no driver text is ever printed - stronger than `db-migrate.ts`'s redaction of the URL's user and password, which it
therefore never needs. The wrapper constructs `PostgresDurableWorkflowRepository` for the read mode (C48; the constructor census is now
exactly `durable-workflow/runtime.ts` and this script, D11) and hands it to the core's read-only adapter; the core itself reads nothing of
the process environment and imports no provider SDK, no durable runtime, no database client and no schema (case 10). The script exports its
dispatcher `main` (argv, env, overrides; C86), whose seams - the loader of `.env.local`, the two writers, `repositoryFor`, the purge port,
the clock, the production predicate and the client's close - default to the operator's real ones, and calls it on its last line only when
it is the entry module (C49; the guard's pattern, C88, admits the script's path with or without a suffix, since `tsx scripts/retention-purge`
resolves `argv[1]` without one). `b24-c3-trace-read-pglite` 4 imports and DRIVES the dispatcher over PGlite with the loader, the writers,
the port and the close stubbed and the repository its real default: `--read` reaches the read runner and the PostgreSQL repository and
never the retention port (the loader called once, `close(true)` once); a purge argv (`--limit 1`) runs C2's dry run through the port (the
inventory read, never a purge) and never the loader; `--read` beside `--apply` is refused before the loader (`close(false)`); a read flag
without `--read` is the purge parser's `RETENTION_ARGUMENT_UNKNOWN`; every table is identical throughout. Case 9 pins `runTraceReadCli`
with `env: {}`, a stub loader that records its one call and a `repositoryFor` that throws a driver error carrying a fake user:password URL;
case 10 pins the script's text and closure and the guard's pattern parsed from the source. After the read mode, when a repository was
opened, the dispatcher ends the process's database client (`getSqlClient().end({ timeout: 5 })`, C87, C89): a deadline leaves a statement
pending on its socket - the client's `connect_timeout` and `idle_timeout` (C91, C92) bound connecting and idle sockets only - which would
otherwise keep the process alive until the server answered; the close is pinned by the PGlite case's stub and by text, and its effect on a
live socket is UNKNOWN (section 36).

## 34. The recorded limits (D24-24 as recorded, OD-210; D24-26; **CONFIRMED** by the pin, **INFERRED** where marked)

Each limit below is a fact the code holds at `600d1ba` plus B24-C3, cited in section 41 and pinned by the named case of
`b24-c3-recorded-limits`; the case turns red when the fact changes and, inside itself, over an injected variant of the file it pins.

| limit | the fact, with its citations | pinning case |
|---|---|---|
| Tier 2 approvals are browser-only: the approved-mutation and approved-PCB-mutation journals are IndexedDB stores imported by the PCB editor component and in no route's runtime closure | the two journal stores (C1, C2) and the Tier 1 grant journal (C3, C4) are in the runtime closure of no `app/api/**/route.ts`, each pinned by exact path; the three `-journal-idb.ts` files on disk are exactly those | `b24-c3-recorded-limits` 1 |
| The server's two apply-time checks write nothing: POST /api/pcb/apply-authorization and POST /api/replacement-authority are authenticated-read rows with no write authority | `policyFor` (C7) answers `authenticated-read`, `authoritativeWrite: false`, no release, transfer or spend flag for both rows (C5, C6); the apply-authorization route's one runtime import is the canonical wrapper (C8) and it states it performs no mutation (C9); the replacement route is READ/PROVE ONLY (C10) | `b24-c3-recorded-limits` 2, 3 |
| No server record ties a Tier 2 apply to a run (INFERRED: the pins show it as far as code can - the journals are browser-side, the server checks are reads) | C1, C2, C5-C10 together; nothing under `app/api/` imports a journal, and the two checks hold no write | `b24-c3-recorded-limits` 1, 2, 3 |
| Tier 1 settlement is browser-attested: the server records what the browser reports, marked so | under `app/lib/execution-grant/` the only string literal assigned to an `attestation` property - as an object-literal member with a plain, quoted or computed key, or by an assignment statement to `.attestation` / `["attestation"]`, with no call naming the property by string (`defineProperty`, `Reflect.set`) - is "browser-attested" (C11); the only other `attestation:` copies an existing settlement's field (C12); `SettleRequest.settlement` omits the field (C13); the settlement type's literal (C14); the behavioural pins exist (C20, C21) | `b24-c3-recorded-limits` 4, 6 |
| The Tier 1 grant is server-held and bound to the run - the limit is the OUTCOME's attestation, not a missing run-bound record | `ExecutionGrantSession.runId` (C15) is set from the run context at mint (C16) under a mint idempotency key on the run and the call (C17), and the browser-side parser requires it (C18, C19) | `b24-c3-recorded-limits` 5 |
| The grant's browser journal is the browser's; the server holds only the grant record and its browser-attested settlement | `agent-execution-journal-idb.ts` (C3, importer C4) is in no route closure | `b24-c3-recorded-limits` 6 |
| Tier 3: the exchange ledger names the committer but no run | `committedBy` (C22); the closed attempt key list carries no run id (C23) | `b24-c3-recorded-limits` 7 |
| Replay covers authored capsules only; live traces are digest-only, so a stored trace cannot be replayed | `replay-capsule.ts` is in no route closure, and its runtime importers are the two evaluation modules and the B11 generator (C24-C26); `trace.ts` states that digest-only traces cannot reconstruct model output and the capsule is never persisted from live runs (C27, C28) | `b24-c3-recorded-limits` 8 |
| MCP request and read traces and B05's read traces die with their process or instance | the request ring holds 1,000 per process (C29, C30), the read ring 1,000 (C31, C32), B05's read trace 500 per `ReadToolInvocationService` (C33, C34) - one instance per gateway (C37) and per MCP read path (C38); no production caller of either sink setter (C35, C36); `tool-invocation.ts` imports nothing under `durable-workflow/` | `b24-c3-recorded-limits` 9 |
| No access audit: who read a stored trace is not recorded (OD-211; OD-111 stands) | the export states `accessAudit: "not_recorded"` (C39); the core's closure holds no retention module; no access-audit store exists (the three filters shown over an injected retention import in the core and an injected access-audit store); case 2 of the read suite proves no write | `b24-c3-recorded-limits` 10 |

## 35. Live: BLOCKED-LIVE-QUALIFICATION

- **LB-14** (the database platform): the read mode never ran against "the main Supabase project" (OD-191), a staging or a production
  database, and never will by the builder; its only runs are `b24-c3-trace-read`'s (in memory) and `b24-c3-trace-read-pglite`'s (a
  disposable in-process PostgreSQL). Whether a production server's `listHeads` order, its jsonb round trip and its statement timeouts behave
  as PGlite's is UNKNOWN until an operator runs the read against an owner-supplied disposable project (the lead's, never the builder's).
- **LB-13** (staging and production; OD-190): the read mode is an operator's process, not a hosted one; in a production runtime it refuses
  without the acknowledgement. What a real host's `.env.local` and `DATABASE_URL` hold is the operator's; nothing here reads them in a test.
- **No live call** was made: no provider, no model, no host contacted; every record read was written by its own store inside the test process.

## 36. What stays open (**INFERRED**, low)

- `--run` names a run-id-keyed aggregate only; an attribution is found by listing the scope (at most 100 heads per read) and reading its
  `runId` - a scope with more attributions than the limit needs more than one read, and the listing is by aggregate key, not by time.
- The 1 MiB cap drops whole records from the end of the listing order (by aggregate key): which records survive is deterministic, not
  "the newest".
- The withholding rule is the redaction authority plus the call record's key shapes; a shape neither knows is not withheld (the B11
  validators keep such text out of every stored kind but a run trace's warnings, which hold at most 32 sanitized lines of 300 characters).
- `redactedTraceReadTarget` prints the URL's pathname as the database name; a path with more than one segment prints as given (no secret
  rides in a path the operator wrote).
- The PGlite suite's second case snapshots every table by `string_agg(t::text)`; a table with a non-deterministic row text (none today) would
  need an order of its own.
- **Authorization is the database credential alone** (review round). `--tenant`, `--project` and `--branch` are the operator's assertions:
  the core canonicalizes them (C98) and the repository filters rows by exactly that scope (C95) over the process's one connection; no
  membership, role or policy module is in the core's closure (`b24-c3-trace-read` 10), and the durable tables' row security has no policy
  and no FORCE, so the owning role bypasses it (C96, C97). Whoever holds `DATABASE_URL` reads any tenant's traces, and the export carries no
  operator identity (`accessAudit: "not_recorded"`). The alternative - a membership check against the scope, or OD-192's application role -
  is the owner's (OD-211 as applied, section 42).
- **The production refusal keys on the runtime, not on the target** (review round). The predicate is `NODE_ENV` (C93) or the declared profile
  `SIRKIT_DEPLOYMENT_ENV` (C94), never the database the URL names: a development-profile shell whose `.env.local` names a production database
  reads without `--acknowledge-unaudited-read`. OD-191's rule is the operator's, not the code's.
- **Over-withholding** (review round). The whole-document check applies the redaction authority's credential-in-URL pattern (C90) to compact
  JSON, where `[^\s@]*` crosses record boundaries: a URL at the end of one record and an `@` before any whitespace in the next withhold the
  document whole though each record alone is `ok` (case 5 shows it). The safe side of B16-A's policy; the operator narrows the read
  (`--run`, `--limit`) to see the records.
- **The read's wall clock** (review round). The deadline bounds the whole read, so a server answering each statement in 29 s completes one
  listing at most before `read_unavailable`; `--limit` and `--run` are the operator's levers, and a larger read is several reads.
- **The entry guard's live behaviour** (review round; UNKNOWN). No builder run ever executed the script as the entry module (OD-191): the
  guard's pattern (C88) is pinned parsed from the source over the script's path with and without a suffix, vitest's own entry, another
  script, a backup copy and an empty `argv[1]`; what a given loader puts in `process.argv[1]` is the lead's run (section 42).
- **The client's close** (review round; UNKNOWN live). `getSqlClient().end({ timeout: 5 })` (C87) never ran against a socket; postgres.js
  documents that pending queries are rejected and connections destroyed at the timeout. The purge mode ends no client: its process lives
  until its idle sockets close (`idle_timeout: 20`, C92) - B24-C2's behaviour, unchanged here (INFERRED).

## 37. Superseded statements, handed to B24-F

Each is left as written and listed for B24-F's one table at closeout commit 1/2 (lead decision D5; file:line at `600d1ba` plus this
change):

- `app/lib/agent/trace-recorder.ts:41-45` (B11-scanned, hash-pinned; recorded by C1 in section 10): "Durable retention, retention duration,
  and operator access are EXPLICIT FUTURE OWNER DECISIONS" - operator access now exists through the read mode (OD-211), retention through
  C2's purge (OD-202); the module still introduces neither.
- `artifacts/ai-control-plane-b11/redaction-and-retention-policy.md:52-57` (C1's dated note sits at `:43`, covering `:45-50`; the lines
  `:52-57` are the "future owner decisions" bullets on readers and access audit): readers exist (the read mode); the access audit stays
  deferred and stated.
- `app/api/chat/attribution-runtime.ts:18`, "(D11: the one PostgreSQL repository construction site stays `durable-workflow/runtime.ts`)" -
  since B24-C3 the sites are two: the runtime's and the purge CLI's read mode (the chat runtimes still construct none).
- `artifacts/remaining-builder-program/OWNER_DECISIONS.md` OD-232 (g) "the wrapper loads no `.env.local`" and (h) "the one construction
  site stays `durable-workflow/runtime.ts`" (the lead's file; the amendment is drafted in section 42).
- `artifacts/ai-control-plane-b24/retention-and-deletion.md:138`, "the wrapper loads no `.env.local`" - carries this task's dated note in
  place.
- `artifacts/ai-control-plane-b24/discovery.md:385-386` and `:752-755` (the lead's file): "written and never read by any route, UI or MCP
  tool" stays true; "Stored traces have no reader, no export" does not (the closure clause in section 42 records it).

## 38. Pins moved, and why (each in place, with a dated `[B24-C3, 2026-10-09]` note)

| pin | move | why |
|---|---|---|
| `.github/workflows/deterministic-manufacturing.yml:380` | one database-delivery line, `app/lib/qualification/database/__tests__/b24-c3-trace-read-pglite.test.ts`, after C2's entry (`:379`; [B24-D0, 2026-10-09] was `:342` after `:341` before B24-D0's 38 prompt-to-gerber `--exclude` lines at `:293-330`; [B24-D1, 2026-10-09] now `:383` after B24-D1's OD-30 steps at `:32` and `:344-345`), above `--reporter=dot` | the PGlite suite, admitted file by file (OD-222; `b19-e-ci-job-scope`) |
| B21 C49, C93, C94 (`artifacts/ai-control-plane-b21/evaluation-matrix.md:1139, :1183, :1184`; `b21-f-page` 6) | `:373` -> `:374`, `:376` -> `:377`, `:385` -> `:386`, each with `re-pinned +1` naming the entry at `:342` | the inserted line moves every later workflow line +1 (lead decision D8) [B24-closeout, 2026-10-10] superseded: B24-D1's record, artifacts/ai-control-plane-b24/performance-and-reliability.md:305. |
| `artifacts/ai-control-plane-b24/environments-and-deployment.md` section 10 | one row appended to the insertion table (task `[B24-C3, 2026-10-09]`, job `database-delivery`, first line `:342`, count 1) | A1's insertion-table protocol; no earlier row and no number of sections 10 and 14 moved |
| `artifacts/ai-control-plane-b24/ci-admission.md:185` | the browser job's `timeout-minutes: 30` citation `:359` -> `:360`, earlier notes kept | the same +1 (re-derived by anchor) |
| `b24-c2-retention` 5 (`--read` refused) | retitled in place: `--read` is refused by the PURGE parser alone; the wrapper dispatches it to the read mode before that parser, and `--read` beside a purge flag is refused there (`b24-c3-trace-read` 6); the assertions on `runRetentionCli` hold unchanged, so does `--limit`'s purge range | lead decision D12 |
| `b24-c2-retention` 1 (`:193`, the script's specifiers) | the filter now expects exactly `../app/lib/load-env-local`; no postgres, pglite or disposable specifier joins | the read mode's loader lives in the wrapper (D12) |
| `b24-c2-retention` 7 (`:338-339`, the script's text) | the script constructs `PostgresDurableWorkflowRepository` for `repositoryFor` and names `loadEnvLocal` exactly twice (the import and the hand-over); it still never names `DATABASE_URL` | D11, D12 |
| `b24-c1-durable-trace` 11, `b24-c1-llm-call-record` 12, `b24-c2-attribution` 12 (the constructor census) | each expects `["app/lib/durable-workflow/runtime.ts", "scripts/retention-purge.ts"]` (sorted), the two C1 titles restated in place | D11: the CLI is the planned second constructor; `b24-c3-trace-read` 10 pins the pair |
| `app/lib/durable-workflow/retention-cli.ts:13` | the header's parenthesis restated in place (one line kept) | the comment said `--read` was refused until C3 adds it |
| `artifacts/ai-control-plane-b24/retention-and-deletion.md:138` | a dated note appended on the line | the wrapper now loads `.env.local` for the read mode |
| `b24-c3-trace-read` 10 (this task's own text pin of the entry guard; review round) | the guard's pattern is `/retention-purge(?:\.[cm]?[jt]s)?$/` - the suffix optional - and the CLI's runtime specifiers gain `../app/lib/db/client` | `tsx scripts/retention-purge` resolves `argv[1]` without a suffix; the client is ended after a read (section 33) |

**Not moved:** B23's C64 (`dfm-quote-flow.md:537`, `:335`) and its prose citation (`dfm-quote-flow.md:269`, `:335`), B23's C14 and C46
(`:227`) and B22's C76 (`:226`) sit above the inserted line (checked by hand before and after: `:226` `app/lib/computation/__tests__`, `:227`
`app/lib/manufacturing-providers/__tests__`, `:335` the B23 PGlite entry); `b23-a-provider-admission` case 8 (lead decision D6: the suites sit
under `app/lib/qualification/`, an admitted root; `trace-read.ts` and the script never name the provider directory); C1's approved-importer
gates (D11: the core is under `app/lib/observability/`); the nine B11 hashes; the census 168 / 165 / 3 / 0; the tool counts 47 / 36 / 9 / 27;
the action records 107; the migrations 32; the six SDK importers; the B01 CSV; the B17 inventory; `package.json`; the chat route's 562 lines.

## 39. Test-first record and gates (2026-10-09; **CONFIRMED**)

| step | what ran | result |
|---|---|---|
| red, core absent | `b24-c3-trace-read`, `b24-c3-trace-read-pglite` with `trace-read.ts` set aside | 2 files failed to load (`Cannot find module`), no tests, 1.52 s |
| red, page absent | `b24-c3-recorded-limits` before part 3 | 1 failed (11) / 10 passed, 21.18 s |
| first green attempt | the two read suites with the core and the dispatch | 5 failed / 8 passed, 27.31 s - every failure the suites' own: the unit helper opened a fresh repository where the seeded one was meant (four cases), and the PGlite scope assertion used a tenant id that is a prefix of the other scope's; both fixed in the tests |
| green | the two read suites | 2 files, 13 / 13, 29.50 s |
| pins before the move | `b24-c1-durable-trace`, `b24-c1-llm-call-record`, `b24-c2-attribution`, `b24-c2-retention` on the new tree, unmodified | 5 failed / 68 passed, 35.62 s - exactly the five predicted pins: the three constructor-census assertions (`+ scripts/retention-purge.ts`), the script's `load-env` specifier (`:193`) and the script's constructor text (`:338`) |
| pins after the move | the same four suites | 4 files, 73 / 73, 44.76 s |
| gate (a) | the three C3 suites with every C1 and C2 suite (11 files, the three PGlite ones included) | 125 / 125, 64.49 s, exit 0 |
| gate (b) | `app/lib/qualification/__tests__` (33 files) | 347 passed, 3 skipped (350), 83.70 s, exit 0 |
| gate (c) | `app/lib/agent/__tests__` (36 files; B11.5 case 12's write-primitive scan among them) | 415 / 415, 38.32 s, exit 0 |
| gate (d) | `app/lib/agent/orchestration/__tests__` (49 files: the B21 import gates, `b21-e2b-trace-attribution`'s sha pins, `b21-f-page` with the moved C49, C93, C94, `b21-closeout-statements`) | 460 / 460, 63.64 s, exit 0 |
| gates (e), (f) | `app/lib/durable-workflow/__tests__`, `app/lib/execution-grant/__tests__` (5 files) | 4 files passed, 1 skipped; 23 passed, 2 skipped (25), 3.59 s, exit 0 |
| gate (g) | `app/lib/engineering/__tests__` (99 files) | 1107 / 1107, 70.26 s, exit 0 |
| gates (h), (i) | `app/lib/mcp` (with `b20-b4-process-gate` and the counts 47 / 36 / 9 / 27) and `b14-4-ast-import-gates` (46 files) | 847 / 847, 137.24 s, exit 0 - no AST gate timed out |
| gates (j), (k), (l) | `app/lib/auth/__tests__`, `app/api/__tests__` (the census 168 / 165 / 3 / 0), `b18-b-execution-grant-route`, `b19-e-ci-job-scope` (70 files) | 1559 passed, 9 skipped (1568), 90.57 s, exit 0 |
| gates (m), (n) | `app/lib/computation/__tests__`, `app/lib/manufacturing-providers/__tests__` (57 files: `b22-closeout-statements`, `b23-closeout-statements`, `b22-a1-page` 5, `b23-b-dfm-quote-flow-page` 3, `b23-d-physical-evidence-contract` 9, `b23-a-provider-admission` 8, `b23-a-tier3-vocabulary`'s 107 action records) | 55 files passed, 2 skipped; 687 passed, 18 skipped (705), 181.24 s, exit 0 |
| gate (o) | the database-delivery list exactly as CI selects it (26 files; the junit reporter flags omitted so nothing is written into the repository; no `DATABASE_URL`) | 23 files passed, 3 skipped; 194 passed, 12 skipped (206), 145.35 s, exit 0 |
| tsc | `tsc --noEmit -p tsconfig.json` | exit 0, no output |
| eslint | the eleven changed `.ts` files (the core, the script, `retention-cli.ts`, the fixtures, the three C3 suites, the four moved suites) | exit 0, no output |
| generators | `generate-agent-artifacts`, `generate-b16-0-2-artifacts`, `generate-b17-control-inventory`, `generate-b11-artifacts`, `generate-action-toolability-matrix`, one after another under the lock | each exit 0; `git status` afterwards names only this task's files - zero drift (47 registered / 36 exposed tools, 107 action records, 631 controls on 63 surfaces, B11 19 / 19 cases and 61 / 61 checks) |
| by hand | the workflow lines the unmoved citations name | `:226` `app/lib/computation/__tests__` (B22 C76), `:227` `app/lib/manufacturing-providers/__tests__` (B23 C14, C46), `:335` the B23 PGlite entry (C64 and `dfm-quote-flow.md:269`), `:342` the new entry, `:360` `timeout-minutes: 30`, `:374`, `:377`, `:386` the browser job's three steps; `drizzle/` holds 32 migrations; every changed file is LF (`git ls-files --eol`: `w/lf`) with no control byte [B24-closeout, 2026-10-10] superseded: B24-D1's record, artifacts/ai-control-plane-b24/performance-and-reliability.md:305. |
| final | `b21-closeout-statements`, `b22-closeout-statements`, `b23-closeout-statements`, `b24-c1-durable-trace` (its page case 13) and the three C3 suites on this page as finished (7 files) | 67 / 67, 42.80 s, exit 0; the five page-reading suites re-run once more after this row was written (the last line of this table is the re-run's record) |
| final, re-run | the three closeout tripwires, `b24-c1-durable-trace` and `b24-c3-recorded-limits` after this table's last two rows were written | see the increment report: the page cannot carry its own last run; the lead's close records it |

The B24-C3 suites, every other suite that reads a file this task changed, the gates the task names, tsc, eslint and the generators were
each run after the edits and are green; a timed-out AST gate did not occur, so no re-run alone was needed. The final run - the three
closeout tripwires, `b24-c1-durable-trace` (its page case 13) and the three C3 suites on this finished page - is recorded in the last row.

The gate sets of the task, each one vitest at a time under the lock, every runner process stopped after it, are recorded in the rows below
as they ran (the exact counts and exit codes; a timed-out AST gate is re-run alone and both runs recorded).

**Deviation, RECORDED (review finding security-7):** the task's "run before and after the workflow edit" for `app/lib/computation/__tests__`
and `app/lib/manufacturing-providers/__tests__` was met after the edit only (gates (m), (n), 687 passed); before the edit the three anchors
the unmoved citations name were checked by hand (`:226` `app/lib/computation/__tests__`, `:227` `app/lib/manufacturing-providers/__tests__`,
`:335` the B23 PGlite entry; the insertion is at `:342`, below all three). No pre-edit run log exists (`c3-01` to `c3-21`: only `c3-15` names
the B22/B23 page suites), so the ledger cannot show those four suites green at `600d1ba` from this task's own runs; the lead's two options
are in section 42.

### Review round (2026-10-09; **CONFIRMED**)

| step | what ran | result |
|---|---|---|
| baseline | the seven suites that read the files this round edits (`b24-c1-durable-trace`, `b24-c1-llm-call-record`, `b24-c2-attribution`, `b24-c2-retention`, the three C3 suites), unmodified | 7 files, 97 / 97, 67.17 s, exit 0 (`c3fix-00`) |
| counterexample (correctness-1) | the dispatch inverted on disk (`if (!selectsTraceRead(argv))`, sha256 `f5c186…`); `b24-c2-retention`, `b24-c3-trace-read`, `b24-c3-trace-read-pglite` | 3 files, 20 / 20, 24.51 s, exit 0 - every pin on the dispatcher was text; the script restored to its sha256 `27de51…` (`c3fix-01`) |
| red | the extended unit suites on the unfixed code (the old visitor restored for the run) | 2 files, 4 failed / 17 passed, 25.88 s, exit 1: limits 4 (a computed-key `attestation` literal invisible to the object-literal visitor), read 5 (`omitted` 2 where 3 records were collected), read 6 (the slow repository still pending at 30 000 ms), read 10 (the CLI's specifiers); read 4 and limits 10 green, as coverage-only findings (`c3fix-02`) |
| green | the three C3 suites after the fixes | 3 files, 24 / 25, 28.40 s: only 11 (the page) red, on the four citations the edits moved (C46-C49), re-derived in section 41 (`c3fix-03`) |
| breakage proofs | four sources broken on disk at once - `settle.ts` + a computed-key `attestation` literal; `app/lib/observability/access-audit-store.ts` created (`aggregateType: "agent.access-audit.v1"`) and a retention import appended to the core; the head comparison reduced to the revision; the dispatch inverted - then every source restored byte-for-byte (`sha256sum -c`: OK, OK, OK; the file removed) | 3 files, 8 failed / 17 passed, 28.19 s, exit 1, each red the intended one: limits 4, limits 10, read 4 (the head-only digest tamper admitted), pglite 4 (the `--read` argv ran the dry run), and read 2, 8, 10 and limits 11 as the same breakages' side effects (the retention import in the core's closure and specifiers; C47's anchor) (`c3fix-04`) |
| green, final | the three C3 suites on the restored sources and this page, with `b21-closeout-statements`, `b23-closeout-statements` and `b24-c1-durable-trace` (its page case) | 6 files, 59 / 59, 43.28 s, exit 0 (`c3fix-05`); `b22-closeout-statements` (under `app/lib/computation/__tests__`) ran green in gate (m) below and in the last row |
| gate (a), re-run | the three C3 suites with every C1 and C2 suite (11 files) | 126 / 126, 72.32 s, exit 0 (one case more than C3's 125: the PGlite suite's 4) |
| gate (b), re-run | `app/lib/qualification/__tests__` (33 files) | 347 passed, 3 skipped (350), 91.30 s, exit 0 |
| gate (c), re-run | `app/lib/agent/__tests__` (36 files; B11.5 case 12's write-primitive scan: no C3 suite spells one) | 415 / 415, 36.97 s, exit 0 |
| gate (d), re-run | `app/lib/agent/orchestration/__tests__` (49 files) | 460 / 460, 61.94 s, exit 0 |
| gates (e), (f), re-run | `app/lib/durable-workflow/__tests__`, `app/lib/execution-grant/__tests__` (5 files) | 4 files passed, 1 skipped; 23 passed, 2 skipped (25), 3.61 s, exit 0 |
| gate (g), re-run | `app/lib/engineering/__tests__` (99 files) | 1107 / 1107, 69.67 s, exit 0 |
| gates (h), (i), re-run | `app/lib/mcp` and `b14-4-ast-import-gates` (46 files) | 847 / 847, 124.69 s, exit 0; no AST gate timed out |
| gates (j), (k), (l), re-run | `app/lib/auth/__tests__`, `app/api/__tests__`, `b18-b-execution-grant-route`, `b19-e-ci-job-scope` (70 files) | 1559 passed, 9 skipped (1568), 90.37 s, exit 0 |
| gates (m), (n), re-run | `app/lib/computation/__tests__`, `app/lib/manufacturing-providers/__tests__` (57 files) | 55 files passed, 2 skipped; 687 passed, 18 skipped (705), 180.83 s, exit 0 |
| gate (o), re-run | the database-delivery list exactly as CI selects it (26 files; no junit reporter; `DATABASE_URL` unset for the run) | 23 files passed, 3 skipped; 195 passed, 12 skipped (207), 133.64 s, exit 0 (one more than C3's 194: the PGlite suite's 4) |
| tsc, re-run | `tsc --noEmit -p tsconfig.json` | first run exit 2: two TS2322 in `b24-c3-trace-read` 5 (`readTraceExport`'s `bounds` was typed `Partial<typeof TRACE_READ_BOUNDS>`, whose members are literal types, so a computed cap was refused); the option type widened in place to `{ maxOutputBytes?: number; readDeadlineMs?: number }` (no line moved); second run exit 0, no output |
| eslint, re-run | the eleven changed `.ts` files | exit 0, no output |
| generators, re-run | `generate-agent-artifacts`, `generate-b16-0-2-artifacts`, `generate-b17-control-inventory`, `generate-b11-artifacts`, `generate-action-toolability-matrix`, one after another under the lock | each exit 0 (47 registered / 36 exposed tools; the B16.0.2 CSV; 631 controls on 63 surfaces; B11 19 / 19 cases, 61 / 61 checks; 107 action records, 154 route coverage entries); `git status` afterwards names exactly the baseline's seventeen files - zero drift |
| by hand | every changed file | LF with no control byte (a PCRE scan for CR and for C0 bytes); the sources restored after the breakage proofs verified by `sha256sum -c` |
| final, re-run | the three C3 suites, the three closeout tripwires and `b24-c1-durable-trace` after this table was written | see the increment report: the page cannot carry its own last run |

## 40. Suites

| suite | `it(` | what it covers |
|---|---|---|
| `app/lib/qualification/__tests__/b24-c3-trace-read.test.ts` | 10 | the four kinds through their own stores; the counting Proxy and the adapter's refusals; scope isolation; corrupt digest, payload, key, type, the head-only tamper (`TRACE_READ_HEAD_MISMATCH`) and a store reader's own throw (`TRACE_READ_FAILED`); the PEM marker withheld, the key shape never `ok`, the whole-document withholding and its `omitted`; refusals, bounds, the 1 MiB cap, the whole-read deadline and the driver error; the production acknowledgement; the excluded kinds; the CLI with `env: {}`; the import gates (no auth module in the core), the constructor census and the guard's pattern |
| `app/lib/qualification/__tests__/b24-c3-recorded-limits.test.ts` | 11 | one case per limit of section 34, each with its injected variant (case 4's over quoted and computed keys, assignment statements and calls naming the property; case 10's over a retention import and an access-audit store); the page's limits and citations |
| `app/lib/qualification/database/__tests__/b24-c3-trace-read-pglite.test.ts` | 4 | the round trip over PostgreSQL; every public base table identical before and after a read, a refused read and a corrupt read; a payload changed in SQL `corrupt`; a foreign scope never returned; the script's dispatcher driven over PGlite (the read mode, the purge mode's dry run, the two refusals, the production predicate, the client's close) |

The two unit suites ride A1's directory filter (`:228`) with no explicit entry; the PGlite suite is admitted by one explicit database-delivery
entry (C50) and is under no prompt-to-gerber filter (`b19-e-ci-job-scope`, `CHAPTERS` C51). Locally the three take about 30 s together.
The fixtures (`_b24-c3-fixtures.ts`, not a test file) build every record through its own producer: B11's recorder, B24-C2's collector,
B24-C1's closed call record, B21-E2b's cascade.

## 41. Citations

Each row resolves on the line it names (`b24-c3-recorded-limits` 11): the anchor is a substring of that line at this commit.

| id | file | line | anchor |
|---|---|---|---|
| C1 | `app/components/pcb/PcbEditor.tsx` | 60 | `approved-pcb-mutation-journal-idb` |
| C2 | `app/lib/engineering/approved-mutation-journal.ts` | 49 | `(approved-mutation-journal-idb.ts),` |
| C3 | `app/lib/engineering/agent-execution-journal.ts` | 2 | `[B18-B] The DURABLE agent-execution journal` |
| C4 | `app/components/pcb/PcbEditor.tsx` | 63 | `agent-execution-journal-idb` |
| C5 | `app/lib/auth/route-policy.ts` | 107 | `read("/api/replacement-authority", ["POST"]` |
| C6 | `app/lib/auth/route-policy.ts` | 111 | `read("/api/pcb/apply-authorization", ["POST"]` |
| C7 | `app/lib/auth/route-policy.ts` | 313 | `export function policyFor(pathname: string, method: string)` |
| C8 | `app/api/pcb/apply-authorization/route.ts` | 26 | `import { selectorEnvelopeJsonRoute } from "@/app/lib/auth/route-handlers";` |
| C9 | `app/api/pcb/apply-authorization/route.ts` | 10 | `It performs NO mutation, holds NO apply/commit authority` |
| C10 | `app/api/replacement-authority/route.ts` | 5 | `READ/PROVE ONLY.` |
| C11 | `app/lib/execution-grant/settle.ts` | 58 | `attestation: "browser-attested"` |
| C12 | `app/lib/execution-grant/store.ts` | 175 | `attestation: transition.settlement.attestation` |
| C13 | `app/lib/execution-grant/settle.ts` | 18 | `settlement: Omit<ExecutionGrantSettlement, "attestation"` |
| C14 | `app/lib/engineering/execution-grant.ts` | 192 | `attestation: "browser-attested";` |
| C15 | `app/lib/engineering/execution-grant.ts` | 114 | `lineageId: string; runId: string;` |
| C16 | `app/lib/execution-grant/mint.ts` | 175 | `session: { ...request.session, runId: ctx.runId },` |
| C17 | `app/lib/execution-grant/mint.ts` | 186 | `grant-mint:${ctx.runId}:${request.origin.callId}` |
| C18 | `app/lib/engineering/execution-grant.ts` | 367 | `export function parsePublicExecutionGrant(raw: unknown)` |
| C19 | `app/lib/engineering/execution-grant.ts` | 379 | `!str(session.runId)) return null;` |
| C20 | `app/api/agent/__tests__/b18-b-execution-grant-route.test.ts` | 206 | `attestation: "browser-attested"` |
| C21 | `app/lib/execution-grant/__tests__/b18-b-mint-consume-decisions.test.ts` | 268 | `attestation: "browser-attested"` |
| C22 | `app/lib/manufacturing-providers/exchange-ledger.ts` | 62 | `readonly committedBy: string;` |
| C23 | `app/lib/manufacturing-providers/exchange-ledger.ts` | 179 | `const ATTEMPT_KEYS = ["idempotencyKey", "planId", "planDigest", "providerIdempotencyKey", "requestDigest", "committedBy",` |
| C24 | `app/lib/agent/evaluation.ts` | 13 | `from "./replay-capsule";` |
| C25 | `app/lib/agent/evaluation-cases.ts` | 18 | `from "./replay-capsule";` |
| C26 | `scripts/generate-b11-artifacts.ts` | 18 | `from "../app/lib/agent/replay-capsule";` |
| C27 | `app/lib/agent/trace.ts` | 11 | `Digest-only traces deliberately CANNOT reconstruct model output` |
| C28 | `app/lib/agent/trace.ts` | 13 | `which is never persisted from live runs.` |
| C29 | `app/lib/mcp/server/request-trace.ts` | 15 | `export const MCP_SERVER_TRACE_RING_MAX = 1000;` |
| C30 | `app/lib/mcp/server/request-trace.ts` | 117 | `while (ring.length > MCP_SERVER_TRACE_RING_MAX) ring.shift();` |
| C31 | `app/lib/mcp/server/read-trace.ts` | 15 | `export const MCP_READ_TRACE_RING_MAX = 1_000;` |
| C32 | `app/lib/mcp/server/read-trace.ts` | 212 | `while (ring.length > MCP_READ_TRACE_RING_MAX) ring.shift();` |
| C33 | `app/lib/engineering/tool-invocation.ts` | 204 | `this.maxTraces = options?.maxTraces ?? 500;` |
| C34 | `app/lib/engineering/tool-invocation.ts` | 442 | `if (this.traceLog.length > this.maxTraces) this.traceLog.shift();` |
| C35 | `app/lib/mcp/server/request-trace.ts` | 124 | `export function setMcpServerTraceSinkFactory(` |
| C36 | `app/lib/mcp/server/read-trace.ts` | 219 | `export function setMcpReadTraceSinkFactory(` |
| C37 | `app/lib/agent/gateway.ts` | 494 | `new ReadToolInvocationService(registry)` |
| C38 | `app/lib/mcp/server/read-call.ts` | 235 | `service = new ReadToolInvocationService(registry, { now: () => Date.now() });` |
| C39 | `app/lib/observability/trace-read.ts` | 60 | `export const TRACE_READ_ACCESS_AUDIT = "not_recorded" as const;` |
| C40 | `app/lib/observability/trace-read.ts` | 41 | `export const TRACE_READ_KINDS = Object.freeze(["run-trace", "run-trace-attribution", "llm-call-record", "specialist-trace"] as const);` |
| C41 | `app/lib/observability/trace-read.ts` | 52 | `export const TRACE_READ_LIMITS = Object.freeze({ default: 20, max: 100 });` |
| C42 | `app/lib/observability/trace-read.ts` | 53 | `export const TRACE_READ_BOUNDS = Object.freeze({ maxOutputBytes: 1_048_576, readDeadlineMs: 30_000 });` |
| C43 | `app/lib/observability/trace-read.ts` | 54 | `export const TRACE_READ_EXIT = Object.freeze({ ok: 0, failed: 1, refused: 2, unavailable: 3 });` |
| C44 | `app/lib/observability/trace-read.ts` | 57 | `export const TRACE_READ_PURGE_ONLY_FLAGS = Object.freeze(["--apply", "--confirm", "--as-of"] as const);` |
| C45 | `app/lib/observability/trace-read.ts` | 204 | `export function readOnlyTraceRepository(` |
| C46 | `app/lib/observability/trace-read.ts` | 360 | `export async function runTraceReadCli(deps: TraceReadCliDeps): Promise<number> {` |
| C47 | `scripts/retention-purge.ts` | 75 | `if (selectsTraceRead(argv)) {` |
| C48 | `scripts/retention-purge.ts` | 65 | `repositoryFor: () => new PostgresDurableWorkflowRepository()` |
| C49 | `scripts/retention-purge.ts` | 88 | `if (ENTRY_MODULE) void main(process.argv.slice(2), process.env)` |
| C50 | `.github/workflows/deterministic-manufacturing.yml` | 493 | `app/lib/qualification/database/__tests__/b24-c3-trace-read-pglite.test.ts` |
| C51 | `app/lib/acquisition/__tests__/b19-e-ci-job-scope.test.ts` | 54 | `const CHAPTERS = ["b19-", "b20-", "b21-", "b22-", "b23-", "b24-"] as const;` |
| C52 | `app/lib/durable-workflow/types.ts` | 50 | `export interface DurableWorkflowRepository {` |
| C53 | `app/lib/durable-workflow/types.ts` | 55 | `getReplay<TResult extends object = object>(` |
| C54 | `app/lib/durable-workflow/types.ts` | 60 | `listOutbox(input?:` |
| C55 | `app/lib/durable-workflow/server-repository.ts` | 14 | `async loadHead<T extends object = object>(value: DurableAggregateIdentity)` |
| C56 | `app/lib/durable-workflow/server-repository.ts` | 17 | `async history<T extends object = object>(value: DurableAggregateIdentity)` |
| C57 | `app/lib/durable-workflow/stable.ts` | 18 | `export function canonicalDurableScope(scope: DurableWorkflowScope)` |
| C58 | `app/api/pcb-sync/manufacturing-summary.ts` | 11 | `[B16-A F12] ONE read policy for every durable subject.` |
| C59 | `app/lib/agent/redaction.ts` | 67 | `export function containsSecretShapedText(text: string): boolean {` |
| C60 | `app/lib/observability/llm-call-record.ts` | 124 | `export const secretShaped = (value: string): boolean =>` |
| C61 | `app/lib/observability/run-trace-store.ts` | 150 | `async history(scope: DurableWorkflowScope, runId: string): Promise<RunTraceRecordEntry[]> {` |
| C62 | `app/lib/observability/run-trace-attribution.ts` | 314 | `async load(scope: DurableWorkflowScope, traceId: string)` |
| C63 | `app/lib/observability/llm-call-record-store.ts` | 117 | `async load(scope: DurableWorkflowScope, callId: string)` |
| C64 | `app/lib/agent/orchestration/trace-attribution.ts` | 309 | `async history(scope: DurableWorkflowScope, runId: string): Promise<OrchestrationTraceRecordEntry[]> {` |
| C65 | `app/lib/agent/orchestration/trace-attribution.ts` | 254 | `export const ORCHESTRATION_TRACE_AGGREGATE_TYPE = "agent.orchestration-trace.v1" as const;` |
| C66 | `app/lib/agent/trace.ts` | 406 | `export function validateAgentRunTrace(untrusted: unknown): string[] {` |
| C67 | `app/lib/agent/orchestration/trace-attribution.ts` | 204 | `export function validateOrchestrationTrace(untrusted: unknown): string[] {` |
| C68 | `app/lib/agent/orchestration/store.ts` | 37 | `export const ORCHESTRATION_AGGREGATE_TYPE = "agent.orchestration-run.v1" as const;` |
| C69 | `app/lib/agent/orchestration/store.ts` | 383 | `export const ORCHESTRATION_RESUME_AGGREGATE_TYPE = "agent.orchestration-resume.v1" as const;` |
| C70 | `app/lib/agent/orchestration/store.ts` | 398 | `maxAnswerChars: 60_000` |
| C71 | `app/lib/engineering/execution-grant.ts` | 26 | `export const EXECUTION_GRANT_AGGREGATE_TYPE = "agent.execution-grant.v1" as const;` |
| C72 | `app/lib/engineering/execution-grant.ts` | 27 | `export const EXECUTION_GRANT_INDEX_AGGREGATE_TYPE = "agent.execution-grant-index.v1" as const;` |
| C73 | `app/lib/engineering/execution-grant.ts` | 88 | `export const MAX_INSTRUCTION_EXCERPT = 240;` |
| C74 | `app/lib/agent/autonomy-store.ts` | 27 | `export const AUTONOMY_AGGREGATE_TYPE = "agent.autonomy-settings.v1";` |
| C75 | `app/lib/manufacturing-providers/exchange-ledger.ts` | 43 | `export const PROVIDER_EXCHANGE_AGGREGATE_TYPE = "mfg.provider-exchange.v1" as const;` |
| C76 | `app/lib/computation/evidence-store.ts` | 35 | `export const COMPUTATION_EVIDENCE_AGGREGATE_TYPE = "computation.evidence.v1" as const;` |
| C77 | `scripts/db-migrate.ts` | 41 | `function redactedTarget(url: string): string {` |
| C78 | `scripts/db-migrate.ts` | 61 | `loadEnvLocal();` |
| C79 | `scripts/db-migrate.ts` | 63 | `DATABASE_URL is not set (add it to .env.local or the environment)` |
| C80 | `app/lib/observability/trace-read.ts` | 62 | `export const TRACE_READ_EXPORT_KEYS = Object.freeze(["schema", "generatedAt", "target", "scope", "kind", "accessAudit", "records", "refused", "truncated", "omitted"] as const);` |
| C81 | `app/lib/observability/trace-read.ts` | 307 | `TRACE_READ_ENTRY_CODES.headMismatch` |
| C82 | `app/lib/observability/trace-read.ts` | 262 | `return TRACE_READ_ENTRY_CODES.failed;` |
| C83 | `app/lib/observability/trace-read.ts` | 331 | `const collected = await withDeadline(() => collect(` |
| C84 | `app/lib/observability/trace-read.ts` | 332 | `const collectedCount = collected.records.length;` |
| C85 | `app/lib/observability/trace-read.ts` | 192 | `function withDeadline<T>(work: () => Promise<T>, deadlineMs: number): Promise<T> {` |
| C86 | `scripts/retention-purge.ts` | 73 | `overrides: Partial<RetentionPurgeDeps> = {}): Promise<number> {` |
| C87 | `scripts/retention-purge.ts` | 69 | `close: async (opened) => { if (opened) await getSqlClient().end({ timeout: 5 }); },` |
| C88 | `scripts/retention-purge.ts` | 87 | `const ENTRY_MODULE = /retention-purge(?:\.[cm]?[jt]s)?$/.test(process.argv[1] ?? "");` |
| C89 | `scripts/retention-purge.ts` | 80 | `try { await deps.close(opened); } catch {` |
| C90 | `app/lib/agent/redaction.ts` | 32 | `:\/\/[^\s@]*@(?:[^\s@]*@)*/gi,` |
| C91 | `app/lib/db/client.ts` | 35 | `connect_timeout: 15,` |
| C92 | `app/lib/db/client.ts` | 42 | `idle_timeout: 20,` |
| C93 | `app/lib/auth/mode.ts` | 23 | `return environment.NODE_ENV === "production";` |
| C94 | `app/lib/auth/deployment-profile.ts` | 21 | `export const DEPLOYMENT_PROFILE_ENV = "SIRKIT_DEPLOYMENT_ENV";` |
| C95 | `app/lib/durable-workflow/server-repository.ts` | 9 | `function scopeWhere(scope: DurableWorkflowScope, table:` |
| C96 | `drizzle/0031_rls_default_deny.sql` | 172 | `ALTER TABLE "durable_workflow_heads" ENABLE ROW LEVEL SECURITY;` |
| C97 | `drizzle/0031_rls_default_deny.sql` | 15 | `nothing here forces one (the owner bypass; INFERRED for the real platform, LB-14).` |
| C98 | `app/lib/observability/trace-read.ts` | 171 | `scope = canonicalDurableScope({ tenantId: values.get("--tenant")!` |
| C99 | `app/lib/observability/trace-read.ts` | 369 | `if (deps.productionRuntime() && !command.acknowledge) return refuse("read_production_unacknowledged",` |

## 42. For the lead

Every text below is written out in full for a reserved file. Nothing here was written to `OWNER_DECISIONS.md`, `EXECUTION_LEDGER.md`,
`PROGRAM_STATE.json`, `LIVE_BLOCKERS.md`, `discovery.md` or the B24 `README.md`. No OD-210 and no OD-211 heading exists at `600d1ba`
(`grep '^## OD-21[01]' OWNER_DECISIONS.md` finds none), so each entry below is its one heading; the headings end at OD-232 (`:2972`), so the
next free number is OD-233, one entry for every C3 choice beyond the drafts; OD-232 takes a dated amendment for its (g) and (h).

### Closure clauses (each one dated line under its defect in `discovery.md`)

- [B24-C3, 2026-10-09] D24-24: closed AS RECORDED by B24-C3 (OD-210 applied: nothing is built, the limitation is pinned): Tier 2 approvals stay browser-only - the approved-mutation and approved-PCB-mutation IndexedDB journals are imported by the PCB editor and reach no `app/api/**/route.ts` closure (pinned by exact path), the server's two apply-time checks (`POST /api/pcb/apply-authorization`, `POST /api/replacement-authority`) are authenticated-read rows with `authoritativeWrite: false` and the apply-authorization route's one runtime import is the canonical wrapper - so no server record ties a Tier 2 apply to a run (INFERRED, as far as code can show); Tier 1 settlement stays browser-attested, structurally (under `app/lib/execution-grant/` the only `attestation` literal is "browser-attested", `settle.ts:58`, the only other `attestation:` copies a stored settlement, `store.ts:175`, and `SettleRequest.settlement` omits the field), while the grant itself is server-held and bound to the run (`session.runId` set from the run context at mint, `mint.ts:175`, required by the browser-side parser) - the limit is the outcome's attestation, not a missing run-bound record; Tier 3's exchange ledger names `committedBy` and no run; each pinned by `b24-c3-recorded-limits` 1-7 with an injected variant turning each pin red; `observability-and-replay.md` part 3.
- [B24-C3, 2026-10-09] D24-26: closed offline by B24-C3 (OD-211 applied; OD-233): stored traces have a reader and an export - B24-C2's purge CLI's `--read` mode (`scripts/retention-purge.ts`, the pure core `app/lib/observability/trace-read.ts`) reads one of four closed kinds (`run-trace`, `run-trace-attribution`, `llm-call-record`, `specialist-trace`) of one scope, each record through its store's digest-verified reader, over a read-only adapter of the durable-workflow repository (`listHeads`, `history`, `loadHead`, `loadRecord` only; every write and `getReplay`/`listOutbox` refused), as one JSON document on stdout under B16-A's read policy (`ok`/`absent`/`corrupt`/`withheld` with closed codes, never a payload, a message or a stack), a 1 MiB cap dropping whole records, a 30 s deadline on the whole read and on each repository call within it, `--limit` 1..100 default 20, and a production runtime refusing without `--acknowledge-unaudited-read`; the access audit stays deferred and stated (`accessAudit: "not_recorded"`, OD-111); the MCP and B05 rings (1,000; 1,000; 500) still die with their process or instance and replay still covers authored capsules only, each pinned (`b24-c3-recorded-limits` 8, 9, 10); proven in memory (`b24-c3-trace-read`) and on PGlite (`b24-c3-trace-read-pglite`); a read against a real store is BLOCKED-LIVE-QUALIFICATION (LB-14; LB-13 for production); `observability-and-replay.md` part 3.

### Section 10 amendment (for `discovery.md`)

- [B24-C3, 2026-10-09] B24-C3 landed the read mode of the purge CLI (D24-26; OD-211 applied; OD-233) and the recorded limits (D24-24 as recorded; OD-210 applied) in one run (lead decision D21); one workflow line (database-delivery `:342`); suites `b24-c3-trace-read`, `b24-c3-recorded-limits`, `b24-c3-trace-read-pglite` (section 7 wrote `b24-c-trace-read`; lead decision D17). Where the discovery and the code disagreed at `f663d71` (each re-read at `600d1ba`): D24-24 names one journal and one server check where the code has two of each (two Tier 2 IndexedDB journals plus the Tier 1 grant journal; two read-only server checks, both `read(...)` rows); the Tier 1 grant is server-held and run-bound (`session.runId`), the settlement alone browser-attested; section 2.5's "specialist trace store written only" was too strong - `DurableOrchestrationTraceStore.history` is digest-verified and had no production caller until this read mode; the rings are 1,000 per process for each MCP trace and 500 per `ReadToolInvocationService` instance. Pins moved by review, each in place with a dated note: the constructor census of `b24-c1-durable-trace` 11, `b24-c1-llm-call-record` 12 and `b24-c2-attribution` 12 (+ `scripts/retention-purge.ts`, D11); `b24-c2-retention` 1 (the script's `load-env-local` specifier), 5 (`--read` refused by the purge parser alone) and 7 (the script's constructor and loader text) (D12); B21's C49, C93, C94 (+1); `ci-admission.md:185` (+1); A1's insertion-table row; `retention-cli.ts:13` and `retention-and-deletion.md:138` (dated notes). The adversarial review's eleven confirmed findings were closed test-first in the same commit: the dispatcher is driven over PGlite (`b24-c3-trace-read-pglite` 4), the 30 s deadline is on the whole read, a withheld document's `omitted` counts every collected record, the database client is ended after a read, `TRACE_READ_HEAD_MISMATCH` and `TRACE_READ_FAILED` are reached, the Tier 1 pin reads quoted and computed keys, assignment statements and calls naming the property, the no-access-audit filters show their strength, the two limits of the read mode's access control are recorded (the credential is the only authorization; the production refusal keys on the runtime, not the target), OD-233 (i) is reworded, and the hand check that stood in for the pre-edit run of the B22/B23 page suites is recorded as a deviation. No migration (32), no census, tool-count, classification or flag move; no new dependency. `observability-and-replay.md` part 3.

## OD-210 — A server-side record of Tier 2 approvals, as applied (B24-C3, 2026-10-09)

- Not built in B24: a server-side record of Tier 2 approvals changes the approval flow (the browser's prepare-before-commit journals and the server's read-only apply-time checks), which is out of B24's scope. Recorded as a limitation and PINNED: `b24-c3-recorded-limits` 1-3 go red when a route's runtime closure reaches an approved-mutation IndexedDB journal, when either apply-time check gains write authority or when the apply-authorization route gains a second runtime import.
- The Tier 1 settlement stays browser-attested, stated and pinned structurally (`b24-c3-recorded-limits` 4: the one `attestation` literal under `app/lib/execution-grant/` is "browser-attested"; the settle request carries no such field); the grant itself is server-held and bound to the run (`session.runId` set at mint, `b24-c3-recorded-limits` 5), so the limitation is the outcome's attestation, not a missing run-bound record.
- Tier 3's exchange ledger names its committer and no run (`b24-c3-recorded-limits` 7); nothing of it moves.
- The alternative - a server-held Tier 2 approval record written by the apply-time check and tied to the run - is the owner's, outside B24.

## OD-211 — Who may read stored traces, as applied (B24-C3, 2026-10-09)

- No new route, MCP tool, agent tool or UI reads a stored trace (pinned: `trace-read.ts` and `scripts/retention-purge.ts` are in no route, MCP server, loop, gateway or orchestration closure, `b24-c3-trace-read` 10). Operator access is the purge CLI's read mode only: `scripts/retention-purge.ts --read --kind <kind> --tenant <id> --project <id> --branch <id> [--run <runId>] [--limit <1..100>] [--acknowledge-unaudited-read]`, over the pure core `app/lib/observability/trace-read.ts`, which the CLI alone imports.
- The read is read-only by construction (a read-only adapter over the durable-workflow repository: four SELECT-only methods, every write and `getReplay`/`listOutbox` refused), reads four closed kinds through their stores' digest-verified readers, prints one JSON document on stdout under B16-A's read policy, withholds any secret-shaped rendering, caps the output at 1 MiB (whole records dropped), bounds every repository call by 30 s and refuses in a production runtime without `--acknowledge-unaudited-read`.
- The access audit is deferred and stated: the export says `accessAudit: "not_recorded"` and no access record is written (OD-111 stands). The alternative (an access-audit aggregate the read mode writes) is the owner's.
- The scope flags (`--tenant`, `--project`, `--branch`) are the operator's unauthenticated assertions: the database credential is the only authorization, so a `DATABASE_URL` holder reads any tenant's traces (the core has no auth module in its closure, the repository filters by the asserted scope over the process's one connection, and the durable tables' row security has no policy and no FORCE, which the owning role bypasses), and the export carries no operator identity. The alternative - a membership check against the scope, or OD-192's application role - is the owner's.
- The production refusal keys on the runtime's declared profile (`SIRKIT_DEPLOYMENT_ENV` staging or production) or `NODE_ENV=production`, never on the database the URL names: a development-profile process whose `.env.local` names a production database reads without the acknowledgement. OD-191's rule is the operator's, not the code's.
- Never run by the builder against a live database (OD-191, LB-14): proven in memory and on PGlite only.

## OD-233 — B24-C3: stated choices beyond its task text, as applied (B24-C3, 2026-10-09)

- (a) The readable kinds are exactly `run-trace`, `run-trace-attribution`, `llm-call-record` and `specialist-trace`; every other aggregate type - the orchestration run and resume records (the latter holds up to 60,000 characters of the coordinator's answer), the grants and their index (the 240-character instruction excerpt), the autonomy setting, the provider exchange, the computation evidence, the trace salt - is `read_kind_unknown` with zero repository calls, and the core imports no store of theirs.
- (b) A production runtime (the purge's predicate: A1's `staging` or `production` profile, or `NODE_ENV=production`) refuses without `--acknowledge-unaudited-read` (`read_production_unacknowledged`); with it the read proceeds and the export states `accessAudit: "not_recorded"`.
- (c) `--limit` is per mode: 1..100 aggregates, default 20, with `--read`; the purge's 1..10000, default 1,000, untouched (lead decision D12). The output is capped at 1 MiB UTF-8 by dropping whole records from the end (`truncated`, `omitted`); the WHOLE read has a 30 s deadline from its first repository call, and so has each repository call within it (a read of n aggregates is bounded by the one deadline, not by n of them). Exit codes: 0 every record `ok` or `absent`; 1 any `corrupt` or `withheld`; 2 refused before reading; 3 `read_unavailable` (a deadline, or a driver error at the repository's opening or after the first repository call), the export still one JSON document with the code and no driver text.
- (d) The export goes to stdout only; nothing is written to a file, and the CLI prints no driver text at all (stronger than `db-migrate.ts`'s redaction of the URL's user and password).
- (e) No database-level read-only session or role is used: the writes are refused by the adapter (`TRACE_READ_WRITE_REFUSED`; `getReplay`/`listOutbox` `TRACE_READ_METHOD_REFUSED`) and the no-write property is proven on PGlite over every base table of the public schema. The alternative (a read-only database role for the operator, OD-192's application role) is the owner's.
- (f) `--run` selects one run-id-keyed aggregate (`run-trace` by run id; `specialist-trace` by its per-task run id) and is refused `read_run_unsupported` for the kinds keyed by a trace id or a call id and for a coordinator run id on a specialist trace: the operator lists the scope and reads each record's run id.
- (g) A read that does not complete is one `refused` entry keyed by the kind, status `unavailable`, code `read_unavailable`, inside the closed keys; a `--run` read of a missing aggregate is `absent` `TRACE_READ_ABSENT` (exit 0); a head whose payload names another aggregate is `TRACE_READ_KEY_MISMATCH`, a chain whose last record is not the head `TRACE_READ_HEAD_MISMATCH`, a store reader's throw with no bounded code `TRACE_READ_FAILED` (each reached by `b24-c3-trace-read` 4), and a store's refusal carries the store's own bounded code.
- (h) The withholding rule is the redaction authority's `containsSecretShapedText` plus the call record's `secretShaped` (the PEM marker and the other key shapes B24-A2's scan knows), applied to each record's rendering and again to the whole document; a whole-document hit withholds every record behind one `withheld` entry keyed by the kind, `omitted` counting every collected record (kept and dropped by the cap). The credential-in-URL pattern crosses record boundaries in compact JSON, so benign content of that shape is over-withheld: the policy's safe side, stated.
- (i) The wrapper loads `.env.local` for the read mode only (`scripts/db-migrate.ts`'s order: the arguments parse first), constructs `PostgresDurableWorkflowRepository` for that mode (D11: the constructor census is now the durable runtime and this script) and runs its dispatcher only when it is the entry module (`process.argv[1]` names it, with or without a suffix); the dispatcher `main` (argv, env, overrides) takes its seams - the loader, the writers, `repositoryFor`, the purge port, the clock, the production predicate and the client's close - as overrides defaulting to the operator's real ones, so a suite imports and drives it (`b24-c3-trace-read-pglite` 4). The purge mode's behaviour is unchanged: the same `runRetentionCli` call with the same port, clock, writers and production predicate, now reached through the dispatcher and the entry guard, the predicate evaluated when the dispatcher runs (the invocation lines were re-authored; the purge parser, port and runner are B24-C2's).
- (j) The specialist trace's aggregate key formula is restated in the core (`specialistTraceAggregateKey`) because the orchestration store's key function is module-local; `b24-c3-trace-read` 1 pins the two equal on a stored head.
- (k) Pins moved in place by review beyond the task's list: the constructor census of `b24-c1-durable-trace` 11, `b24-c1-llm-call-record` 12 and `b24-c2-attribution` 12; `b24-c2-retention` 1 and 7 (the script's loader specifier and text); `retention-cli.ts:13`; `retention-and-deletion.md:138`.
- (l) After the read mode, when a repository was opened, the dispatcher ends the process's database client (`getSqlClient().end({ timeout: 5 })`): a deadline leaves a statement pending on its socket, which would otherwise keep the process alive until the server answered. Pinned by the PGlite case's stub (`close(true)` after a read, `close(false)` after a refusal, no close after the purge mode) and by text; its effect on a live socket is UNKNOWN (LB-14). The purge mode ends no client (B24-C2's behaviour, unchanged).
- (m) The entry guard's pattern is `/retention-purge(?:\.[cm]?[jt]s)?$/` - the script's path with or without a suffix (`tsx scripts/retention-purge` resolves `argv[1]` without one), never vitest's entry, another script or a backup copy - pinned parsed from the source (`b24-c3-trace-read` 10). Its live behaviour under a given loader is UNKNOWN until the lead's run.
- (n) The Tier 1 structural pin reads every assignment of an `attestation` property under `app/lib/execution-grant/`: object-literal members with a plain, quoted or computed key, assignment statements to `.attestation` or `["attestation"]`, and any call naming the property by string (`Object.defineProperty`, `Reflect.set`), the last class refused whatever its value; a read of the property is no assignment.

### OD-232 amendment

- [B24-C3, 2026-10-09] (g) and (h), as amended by B24-C3 (OD-211, OD-233): the wrapper `scripts/retention-purge.ts` now loads `.env.local` for its READ mode only (the purge mode still loads none) and constructs `PostgresDurableWorkflowRepository` for that mode, so the one construction site besides `durable-workflow/runtime.ts` is the CLI (D11 as B24-C3's task planned it); the retention port and the chat runtimes still construct none.

### The LB-14 note

- [B24-C3, 2026-10-09] LB-14 note: B24-C3's read mode (`scripts/retention-purge.ts --read`, `runTraceReadCli`) never ran against a live database and never will by the builder: its only runs are `b24-c3-trace-read`'s (in memory) and `b24-c3-trace-read-pglite`'s on a disposable in-process PostgreSQL (the four kinds round-trip; every public base table identical before and after a read, a refused read and a corrupt read; a payload edited in SQL `corrupt`; a foreign scope never returned). A production server's listing order, jsonb round trip and statement timeouts under the read's 30 s deadline stay UNKNOWN until an operator runs it against an owner-supplied disposable project.

### The README row

| B24-C3 readers and recorded limits (D24-24 as recorded, D24-26; OD-210, OD-211, OD-233) | `observability-and-replay.md` (part 3); code `app/lib/observability/trace-read.ts` (new), `scripts/retention-purge.ts` (the `--read` dispatch; its dispatcher driven over PGlite), in place `app/lib/durable-workflow/retention-cli.ts:13`; workflow `deterministic-manufacturing.yml:380` ([B24-D0, 2026-10-09] was `:342` before B24-D0's 38 prompt-to-gerber `--exclude` lines at `:293-330`); suites `b24-c3-trace-read` (10), `b24-c3-recorded-limits` (11), `b24-c3-trace-read-pglite` (4) | done 2026-10-09 offline, the review round's eleven findings closed in-tree; the read against a real store BLOCKED-LIVE-QUALIFICATION (LB-14, LB-13); census 168 / 165 / 3 / 0, counts 47 / 36 / 9 / 27, 107 action records, 32 migrations; `accessAudit: "not_recorded"`; [B24-D1, 2026-10-09] the workflow line is now `:383` after B24-D1's OD-30 steps at `:32` and `:344-345` |

### The ledger paragraph

### B24-C3 - readers and recorded limits (2026-10-09 local; increment workflow + lead; this commit)

Test-first on `chapter/b24-production-qualification` from `600d1ba`, one run (D21). Red first: with the core set aside, `b24-c3-trace-read`
and `b24-c3-trace-read-pglite` failed to load (2 files, no tests), and the one operator CLI at HEAD held no `--read` (C2's parser refused it
as unknown, `b24-c2-retention` 5); `b24-c3-recorded-limits` ran 1 failed (the page) / 10 passed before part 3 existed, each code-fact case
red over its injected variant inside the case. `app/lib/observability/trace-read.ts` is the pure core: a read-only adapter over the
durable-workflow repository (`listHeads`, `history`, `loadHead`, `loadRecord` under a 30 s deadline; every write and `getReplay`/`listOutbox`
refused), the four closed kinds (`run-trace`, `run-trace-attribution`, `llm-call-record`, `specialist-trace`) read through their stores'
digest-verified readers, B16-A's `ok`/`absent`/`corrupt`/`withheld` policy with closed codes and no payload, message or stack, the redaction
authority's and the call record's secret shapes over each record and again over the whole document, a 1 MiB cap dropping whole records, the
exit codes 0/1/2/3 and the production acknowledgement; `scripts/retention-purge.ts` gains the `--read` dispatch (`.env.local` loaded for the
read mode only, `DATABASE_URL` named only, the target as host:port/database, no driver text, the PostgreSQL repository constructed here - D11's
second site - and the dispatcher called only as the entry module); no reader was added to a C1 or C2 store (each had one). One
database-delivery line (`:342`) moved B21's C49, C93, C94 and `ci-admission.md:185` +1 in place with A1's insertion-table row; pins moved in
place with dated notes: the constructor census of `b24-c1-durable-trace` 11, `b24-c1-llm-call-record` 12 and `b24-c2-attribution` 12 (+ the
CLI, D11), `b24-c2-retention` 1, 5 and 7 (the script's loader and constructor text, `--read` refused by the purge parser alone, D12),
`retention-cli.ts:13`, `retention-and-deletion.md:138` - the four suites red before the move (5 failed / 68 passed, exactly the five pins) and
green after (73 / 73). Suites `b24-c3-trace-read` (10), `b24-c3-recorded-limits` (11), `b24-c3-trace-read-pglite` (4): 25 / 25 (the first
green attempt 5 failed / 8 passed on the suites' own helper bugs, fixed in the tests). The adversarial review's eleven confirmed findings
were closed test-first in this tree (section 39, review round): the inverted dispatch left every pin green (the counterexample, 20 / 20),
the extended suites went red on the unfixed code (4 failed / 17 passed), four sources were broken on disk at once and each intended case
went red (8 failed / 17 passed), every source restored byte-for-byte by sha256; the fixes - the dispatcher `main` (argv, env, overrides)
driven over PGlite, the whole-read deadline, the withheld document's `omitted`, the client's close, `TRACE_READ_HEAD_MISMATCH` and
`TRACE_READ_FAILED` reached, the Tier 1 pin over quoted and computed keys, assignment statements and calls, the no-access-audit variants,
the entry guard's suffix-optional pattern - and the records (the two limits of the read mode's access control, OD-233 (i) reworded, the
pre-edit hand check as a deviation); the gate sets on the final tree, re-run after the review round
(`observability-and-replay.md` section 39): C1-C3 126; qualification 347 + 3; agent 415; orchestration 460; durable and grant 23 + 2;
engineering 1107; mcp and B14.4 847; auth, api and B19-E 1559 + 9; computation and manufacturing 687 + 18; database-delivery 195 + 12; tsc 0
(after one in-place type widening in the core); eslint 0 on 11 files; five generators zero drift. The limits of D24-24 are recorded and pinned (OD-210), the read mode is OD-211 as applied,
the choices beyond the drafts OD-233. Census 168 / 165 / 3 / 0, counts 47 / 36 / 9 / 27, 107 action records, 32 migrations unchanged; no new
dependency; no UI control; every live step BLOCKED-LIVE-QUALIFICATION (LB-14, LB-13).

### The lead's runs (not run by the builder)

- **CI on the pushed commit:** prompt-to-gerber's duration against its 25-minute limit (C3's two unit suites ride A1's directory filter;
  locally about 25 s together) - within five minutes of the limit, STOP (OD-30; the split is B24-D1's); database-delivery against its 15
  (one more PGlite file, about 3 s locally).
- **The B17-A browser suite:** not needed - C3 changes no UI and no control (`generate-b17-control-inventory`: no drift, section 39).
- **The entry guard's positive branch** (review finding security-5; the builder never runs the script as the entry module, OD-191): in a
  fresh worktree with NO `.env*` file and no `DATABASE_URL` in the shell, `pnpm exec tsx scripts/retention-purge.ts --read --kind run-trace
  --tenant t --project p --branch b` must exit 2 with the one stderr line `REFUSED read_database_url_missing: DATABASE_URL is not set (add it
  to .env.local or the environment). - nothing was read.` and nothing on stdout; the same without the suffix (`scripts/retention-purge`)
  by the suffix-optional guard; and a bare `pnpm exec tsx scripts/retention-purge.ts --kind run-trace` must exit 2 with `REFUSED
  RETENTION_ARGUMENT_UNKNOWN`. Each refusal is before any repository, so nothing is contacted. Record the three exit codes against section
  36's guard line (UNKNOWN until then).
- **The pre-edit run of the B22/B23 page suites** (review finding security-7; section 39's deviation note): either accept the hand check -
  the three anchors `:226`, `:227`, `:335` verified unmoved before and after the insertion at `:342` - and keep the note as the record, or run
  `b22-a1-page`, `b23-b-dfm-quote-flow-page`, `b23-d-physical-evidence-contract` and `b23-a-provider-admission` once at `600d1ba` (the
  lead's `git stash`, never the builder's) and add their counts to the note.
- **Never run** `scripts/retention-purge.ts --read` against any database (OD-191, OD-211, LB-14).

[B24-D1, 2026-10-09] C50 re-pinned `:380` -> `:383` in place: B24-D1's OD-30 steps at `:32` and `:344-345`; `b24-c3-recorded-limits` resolves it. [PR-G, 2026-10-17] C50 re-pinned `:383` -> `:422` in place: PR-G's 39 prompt-to-gerber lines at `:294-312`, `:316` and `:352-370` (OD-250). [PR-L7, 2026-10-20] C50 re-pinned `:422` -> `:493` in place: PR-L7's 71 prompt-to-gerber lines at `:313-381` and `:440-441` (OD-254).
