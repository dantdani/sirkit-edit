# Astra increment A — model compatibility, offline (PR-F, 2026-10-17)

Tree `codex/astra-foundation`, base `e581755`. Builder fC. This page is a set of CITED NOTES and offline contract pins. It is NOT an
activation record: no live provider was called, no key was read, no model answered. "Fake-backed tests establish contracts, not
Astra's engineering quality" (directive 4). Labels: **RECORDED** (read on the official page on the date shown), **CONFIRMED** (read at
the cited file:line, or a test that ran), **UNKNOWN** (the page is silent), **BLOCKED-LIVE-QUALIFICATION**.

## 1. Official documentation, read 2026-10-17 (WebFetch; no page states a publication date)

| # | Page | What it states about `gpt-6-astra` (verbatim where quoted) | Label |
| --- | --- | --- | --- |
| D1 | `https://developers.openai.com/api/docs/models/gpt-6-astra` | Model id `gpt-6-astra` ("GPT-6 Astra"; the only snapshot listed, also the default); context window 1,050,000; maximum input 922,000; maximum output 128,000; knowledge cutoff Apr 30, 2026; reasoning effort values `low`, `medium`, `high`, `xhigh`, `max`; endpoints Responses (`v1/responses`), Chat Completions, Batch — Fine-tuning, Assistants, Realtime, Embeddings not supported; features: streaming, structured outputs, function calling, file search, image input, web search, prompt caching; price per 1M tokens: input $10, cached input $1, cache writes $12.50, output $50 (over 272K input tokens: 2x input/cache, 1.5x output; Batch/Flex 50%; Fast mode 2x). | RECORDED |
| D2 | `https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra` | "GPT-6 Astra and GPT-6.1 Sol do not support `none`; use `low` instead"; from `minimal` migrate to `low`; with any effort other than `none`: "remove `temperature`, `top_p`, and `top_logprobs`"; tool calling: Astra supports Chat Completions "but tool calling requires Responses"; async tool calling (`async: true`, result returned under the original `call_id`); `configuration_update` input item changes effort mid-conversation; `prompt_cache_options.ttl: "30m"` replaces `prompt_cache_retention`; capabilities carried over from GPT-5.6: structured outputs, streaming, persisted reasoning, compaction, pro mode; the page does NOT list Astra's full effort set, `strict`, `tool_choice`, `parallel_tool_calls`, `store`, usage fields, timeouts or cancellation. Other ids named: `gpt-6.1-sol`, `gpt-6-luna`, `gpt-6-sol`, `gpt-5.5`. | RECORDED |
| D3 | `https://developers.openai.com/api/docs/guides/function-calling` | Function tool: `type: "function"`, `name`, `description`, `parameters` (JSON Schema), `strict`; strict requires `additionalProperties: false` on every object and every property listed in `required`, optionality as `["type", "null"]`; a `strict: true` tool whose schema does not meet this is REJECTED; in Responses an OMITTED `strict` "attempts normalization and falls back to `strict: false`"; `tool_choice`: `auto` (default), `required`, `{type:"function", name}`, `allowed_tools`, `none`; `parallel_tool_calls: false` → zero or one call; output item `{type:"function_call", call_id, name, arguments}`; results as `{type:"function_call_output", call_id, output}`; "for reasoning models, any reasoning items returned with tool calls must be passed back alongside the tool call outputs"; examples use `gpt-6-astra`; "GPT-6 Astra and GPT-6.1 Sol require the Responses API for tool calling"; links the reference `…/api/reference/resources/responses/methods/create` (the only reference page linked). | RECORDED |
| D4 | `https://developers.openai.com/api/docs/guides/reasoning` | `reasoning.effort` values `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` — "model-dependent"; `gpt-6-astra` does not support `none`: setting it returns "HTTP 400"; the GPT-5.6 / GPT-6 family defaults to `medium` when the effort is omitted (Sirkit never omits it: `openai-config.ts:49`); `reasoning.mode` `standard` | `pro`; `reasoning.context` `auto` | `current_turn` | `all_turns` (GPT-5.6 defaults to `all_turns`); with `store: false` reasoning items in `output` "include an `encrypted_content` property by default" and the legacy `include: ["reasoning.encrypted_content"]` "is still accepted for compatibility"; reasoning reuse only within one model family; usage: `output_tokens_details.reasoning_tokens`, `input_tokens_details.cached_tokens`; `max_output_tokens` caps reasoning + visible output; an exhausted limit is `status: "incomplete"`, `incomplete_details.reason: "max_output_tokens"` (possibly before any visible output); no timeouts or cancellation described. | RECORDED |
| D5 | `https://developers.openai.com/api/reference/resources/responses/methods/create` (five windows of the 506,638-character page) | `model`: "Model ID used to generate the response, like `gpt-6-astra`"; `instructions` not carried over with `previous_response_id`; `max_output_tokens` includes reasoning tokens; `store` defaults to true; `temperature` 0-2 and `top_p` with no reasoning-model note; `tool_choice` `none` | `auto` | `required` | object forms; `truncation` `disabled` (default) → 400 when the input exceeds the window; `background` boolean; `reasoning.effort` enum as D4, `summary` `auto` | `concise` | `detailed`; `include` enum holds `reasoning.encrypted_content` ("for multi-turn use when `store` is `false`"); response `status`: `completed`, `failed`, `in_progress`, `cancelled`, `queued`, `incomplete`; `incomplete_details.reason`: `max_output_tokens`, `max_messages`, `content_filter`, `steered`; `usage`: `input_tokens`, `output_tokens`, `total_tokens`, `input_tokens_details.cached_tokens` (+ `cache_write_tokens`), `output_tokens_details.reasoning_tokens`; `error`: `code` (e.g. `server_error`, `rate_limit_exceeded`, `invalid_prompt`), `message`, `param`, `type`; `reasoning` output item: `id`, `summary`, `content`, `encrypted_content` ("populated by default"), `status`; `service_tier` `ultrafast` "currently available for `gpt-5.6-sol`". Version markers on the page: "models released after September 1, 2026", image snapshots dated 2026-09-08. No `timeout` parameter exists. | RECORDED |
| D6 | `https://developers.openai.com/api/reference/resources/responses/methods/cancel` | `POST /responses/{response_id}/cancel`; "Only responses created with the `background` parameter set to `true` can be cancelled"; behaviour for a non-background response not stated. | RECORDED |

What the pages do NOT establish (UNKNOWN until a live turn): the exact HTTP shape of a `none`-effort refusal beyond "HTTP 400"; whether
`xhigh` / `max` are accepted for the owner's account tier; request timeouts (none is a documented API parameter — the SDK's client
timeout is the only bound: `adapters.ts:112` 120 000 ms, `openai-provider.ts:155` 10 min); cancellation of a NON-background response
(Sirkit never sets `background`; its cancellation is the SDK `signal` which closes the connection, `adapters.ts:141, :157`); the
account availability of `gpt-6-astra` for the owner's key.

## 2. Installed SDK, read 2026-10-17

`openai` **6.48.0** (`node_modules/openai/package.json`). `ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | null`
(`resources/shared.d.ts:192`); `ResponseIncludable` holds `'reasoning.encrypted_content'` (`resources/responses/responses.d.ts:3068`).
So the profile's five documented efforts and the adapters' `include` value type-check against the installed SDK. **CONFIRMED** (tsc:
0 errors in the files this increment touched; the 4 errors on the tree at the time of the run are another builder's in-flight
`app/components/pcb/MissingPartsList.tsx`).

## 3. What the existing adapters already do, and what PR-F changed

### 3.1 Verification of the adapters against D1-D6 (code read, offline)

| Contract | Code | Pin |
| --- | --- | --- |
| Responses API, flat function tools, `strict: true` on every tool | `adapters.ts:116-131`; `provider-tools.ts:352-360` (`strict: true` always, over the proven wire subset); chat path: `openai-provider.ts:85-93` (`strict: tool.strict ?? false` — the callers' declaration; every `propose` route declares `strict: true`) | `pr-f-astra-profile` 4, 5; `b16-0-*-adapter-schema-parity` |
| Sequential tool calls | `parallel_tool_calls: false` (`adapters.ts:124`) — D3: zero or one call | `pr-f-astra-profile` 4 |
| Manual continuation with reasoning items | `store: false`, `include: ["reasoning.encrypted_content"]` (`adapters.ts:126-129`), the response's `output` appended verbatim to the next input (`:94`); results as `function_call_output` under the exact `call_id` (`:150-154`) — D3/D4 | `pr-f-astra-profile` 4 (the second call's input holds the prior output item) |
| No temperature, no top_p | The agent adapter never sets either (`adapters.ts:116-131`); the chat provider omits `temperature` for `OPENAI_NO_TEMPERATURE_MODEL_FAMILY` (`openai-provider.ts:161, :170`), which PR-F extends to `gpt-6-astra` — D2 | `pr-f-astra-profile` 4, 5 |
| Reasoning effort pinned to the documented set | `configuredOpenAIReasoningEffort` (`openai-config.ts:44-51`) bounded by the profile (`boundOpenAIReasoningEffort`, appended): `none` / `minimal` / unknown → the pinned `high`; `low`..`max` as configured; the gpt-5.6 family unchanged — D1/D4 | `pr-f-astra-profile` 2 |
| Stop normalization | `openAIStepStop` (`adapters.ts:278-286`): `completed` → `end_turn` (or `refusal`), `incomplete` + `max_output_tokens` → `max_tokens`, other `incomplete` → `incomplete`, `failed` / `cancelled` / `queued` / `in_progress` → `unknown` — D5's `status` enum and `incomplete_details.reason` (`max_messages`, `content_filter`, `steered` fall into `incomplete`, never a pass) | `b21-e1-stop-reasons` |
| Usage | `input_tokens`, `output_tokens` read (`adapters.ts:88`); `reasoning_tokens` and `cached_tokens` are NOT read (D4/D5 name them) — a known gap for pricing reasoning tokens exactly (they are billed as output tokens and are inside `output_tokens`) | — |
| Errors | `toProviderError` (`app/lib/llm/errors.ts`) classifies status and code (`rate_limit`, `insufficient_quota`, `overloaded`, `timeout`, `network`, `bad_request`); the breaker reads it (`provider-policy.ts:158-164`) | `b21-e1-provider-breaker` 3, 4, 11 |
| Timeouts, cancellation | SDK client timeout 120 000 ms with `maxRetries` 2 (coordinator) / 0 (specialist) (`adapters.ts:106, :112`); the run's `AbortSignal` passed to every `create` (`:141, :157`); the DAG's 300 000 ms (`scheduler.ts:64`). No `background`, no cancel endpoint (OD-119) | `b21-e1-provider-breaker` 5; `b21-e1-provider-policy` 5 |
| The model actually used is disclosed | `AgentStep.model = response.model` (`adapters.ts:89`); `LLMResponse.model = response.model` (`openai-provider.ts:117`); the call record keeps "the answer's own model" (`llm-call-record.ts:71, :185`); the scheduler records the route AND the reported model (`scheduler.ts:151, :570`) and a `compatible_fallback` degraded event names both (`:504`) | `pr-f-astra-profile` 5 (a fake answering `gpt-5.6-sol` to an Astra request labels the step `gpt-5.6-sol`; a breaker fallback's route carries `fallbackFrom` naming Astra) |

No label check was added: the disclosure exists at every seam that stores or prices a model name. The one place the reported model does
not reach is the chat bubble (`chat-run-view.ts:143` ignores `run_completed.model`); that is a UI gap recorded in `rebaseline.md` §4, not a
mislabel.

### 3.2 The change (files, in place; no cited line moved)

- `app/lib/llm/openai-config.ts` — the `OpenAIModelProfile` gains optional `reasoningEfforts`, `reasoningEffort`, `admission` (:10, one line);
  the profile `"gpt-6-astra": { label "GPT-6 Astra", contextWindowTokens 1_050_000, maxOutputTokens 128_000, reasoningEfforts ["low","medium","high","xhigh","max"], reasoningEffort "high", admission "server-env" }`
  (:37, on the closing line of the gpt-5.6-luna entry); `configuredOpenAIReasoningEffort` routes its two returns through the bound (:49-50);
  `OPENAI_REASONING_MODEL_FAMILY = /^gpt-5\.6(?:-|$)|^gpt-6-astra$/` and `OPENAI_NO_TEMPERATURE_MODEL_FAMILY = /^(?:gpt-5|o\d)|^gpt-6-astra$/`
  (:60-61, anchored exactly: `gpt-6-luna`, `gpt-6-sol`, `gpt-6.1-sol`, `gpt-6-astra-<date>` stay outside); `boundOpenAIReasoningEffort` appended.
  `DEFAULT_OPENAI_MODEL` line 1 unchanged; the two environment readers (:41, :48) unchanged; no new `SIRKIT_` name.
- `app/lib/agent/orchestration/provider-policy.ts` — `qualifiedModel` (:87) requires, for a profile with `admission: "server-env"`, that
  the role map name the model (`serverEnvAdmission`, appended; a refused map names nothing; `inherit` is accepted as the provider because
  the landing provider's rules still judge it); import of `openAIModelProfile` on :25; the module comment (:13) says so. Everything else —
  the closed schema, the refusal codes, the fallback, the meters — is untouched.
- `app/lib/deployment/configuration.ts` — OUTSIDE the assignment's file list, touched for one reason: its `reasoningEffortOf` (:103-109) is
  the deployment configuration's MIRROR of `openai-config.ts:47-50` (its own comment), pinned equal by `b24-a1-configuration` case 3; without
  the same bound the record would report `none` for a configured Astra while the adapter sends `high` — an undisclosed substitution. Two
  lines in place (:107-108) and the import (:27). `pr-f-astra-profile` case 2 pins the mirror for every effort value.
- Tests: `app/lib/llm/__tests__/pr-f-astra-profile.test.ts` (5 cases, new); reviewed pin moves with dated notes in
  `b21-e1-provider-policy.test.ts` (the two rule sources; `gpt-6-astra` kept in the empty-env unqualified list and `gpt-6-luna` added; the
  override example that must be refused is `gpt-6-luna`, and the override naming Astra is now asserted admitted), `b21-e1-provider-breaker.test.ts`
  case 6 and `b21-e2-run-events.test.ts` (the refused example `gpt-6-astra` → `gpt-6-luna`).
- Page: `artifacts/ai-control-plane-b21/provider-routing-and-failure.md` section 1 quotes the two new rule sources with a dated note
  (`b21-e1-page` case 2 compares them to the rule objects).

### 3.3 Admission, stated once

`gpt-6-astra` is QUALIFIABLE and never default:

1. coordinator: only through the existing configured-model path (`SIRKIT_OPENAI_MODEL=gpt-6-astra`), which already qualifies any configured model (today's rule, `provider-policy.ts:87` first clause) — not changed, not recommended before a live turn;
2. specialist: only when `SIRKIT_ORCHESTRATION_ROLE_MODELS` names it for that role (`{"<role>":{"provider":"openai","model":"gpt-6-astra"}}`); every other role keeps inheriting `gpt-5.6-sol`;
3. never by the family rule alone: `qualifiedModel("openai", "gpt-6-astra", {})` is false (`b21-e1-provider-policy` 3, `pr-f-astra-profile` 3);
4. never for a sibling id: `gpt-6-luna` / `gpt-6-sol` / `gpt-6.1-sol` are refused `model_unqualified` ("until it is qualified live (LB-9)") even when the role map names them.

### 3.4 Gates run (all offline)

- `pnpm exec vitest run --reporter=dot app/lib/llm/__tests__ b21-e1-provider-policy b21-e1-provider-breaker b21-e2-run-events` — 12 files, 67 tests passed.
- `pnpm exec vitest run --reporter=dot b21-e1-page b21-e1-fallback b21-e1-stop-reasons b21-e1-chat-provider b24-a1-configuration b24-a1-flags b24-a2-env-names` — 7 files, 59 tests passed.
- `pnpm exec eslint <the 7 changed .ts files>` — 0.
- `pnpm exec tsc --noEmit -p tsconfig.json` (after deleting `.next/dev/types/validator.ts`) — 4 errors, all in another builder's untracked `app/components/pcb/MissingPartsList.tsx`; 0 in the files of this increment.
- A further guard run (import gates, readiness, secret scan, attribution, E2 page) is recorded in the builder's report.

## 4. Live blockers — exact, for the lead and the owner

Nothing below was attempted. A models-list probe or a live turn is the LEAD's decision under the owner's authorization, not this builder's.

| Blocker | Exact resource | What it would establish | What it would NOT establish |
| --- | --- | --- | --- |
| LB-F1 account availability of `gpt-6-astra` | The owner's OpenAI key's model access: `GET /v1/models` (a models-list probe, zero tokens) or the first `responses.create` with `model: "gpt-6-astra"` — the API refuses an unavailable model with a 404 / `model_not_found`-class error that `toProviderError` classifies `bad_request` (no retry, breaker untouched: `provider-policy.ts:163`). Also whether the account's tier admits `xhigh` / `max`. | That the id resolves for this account and which effort values it accepts. | Anything about tool-calling behaviour or engineering quality. |
| LB-F2 the cumulative allowance | US$5.00 total for the builder's live tests (`../live-spend.json`: 0.19 spent, 4.81 provable remaining). At D1's list prices one coordinator turn with the agent adapter costs at most 4 096 output tokens × $50/M = $0.205 plus input (a 25 000-token context ≈ $0.25 uncached): ≈ $0.46 worst case per turn; a `max` or `xhigh` effort consumes the same `max_output_tokens` ceiling as reasoning first (D4), so the cap, not the effort, bounds the cost. The record-only command's `--spend-cap` and `--price-table` (`sirkit.live-price-table.v1`) must carry Astra's prices before any live request; the repository's `MODEL_PRICE_TABLE` constant stays null (OD-107). | — | — |
| LB-F3 one authorized live CONTRACT turn (`scripts/run-b21-live-orchestration-evaluation.ts --contract-turns` with the role map naming Astra for one role, SDK retries 0, under LB-F2) | PROVES: the request the adapter builds (strict tools, `parallel_tool_calls: false`, pinned effort, no temperature, `include: reasoning.encrypted_content`, `store: false`) is ACCEPTED by the API for `gpt-6-astra`; the response's `model` string the account actually serves (a snapshot id would be disclosed as such by `adapters.ts:89`); that a forced tool call returns a `function_call` item with `call_id` and parseable `arguments`; that a continuation with the returned reasoning items is accepted; the real `usage` fields and latency; the breaker classification of whatever error occurs. | Does NOT prove: Astra's engineering quality, the correctness of any placement or routing proposal, specialist disagreement or fallback (LB-9: one provider, one DAG shape), behaviour on a 50-instance board, cost at scale, or anything the fixture agent scripts. "Fake-backed tests establish contracts, not Astra's engineering quality" — and one live contract turn establishes the contract live, nothing more. |
| LB-F4 the owner's directive 4 preconditions | "Live validation requires an approved spend budget and available credentials": the owner's 2026-09-24 authorization (sparingly, main key) and the 2026-10-14 cap stand; the lead decides whether this increment's turn is inside them. | — | — |

Open until a live turn (UNKNOWN, not failures): whether `strict: true` on the 40 exposed tools' schemas is accepted by Astra exactly as by
gpt-5.6 (the schemas are inside the proven wire subset, `provider-tools.ts:27-29`); whether the account returns `reasoning` output items
with `encrypted_content` under `store: false` as D4 states; the real `status` / `incomplete_details.reason` values Astra emits at the
4 096-token ceiling.
