# B21 — provider reference notes (OpenAI Responses / Agents / tools; Anthropic Messages / tool use), read live 2026-09-24

Every B21 increment implements against the facts recorded here (dated, with the URL that served each page), never against
remembered provider knowledge. A page that answered 403 or redirected to an unrecorded host stays UNKNOWN until an increment
fetches it and records the date. Hosts that serve the official pages today (OD-118): `developers.openai.com/api/docs`,
`platform.claude.com/docs`, and for the Anthropic Agent SDK `code.claude.com` (not fetched); the hosts the runbook names
(`platform.openai.com/docs`, `docs.anthropic.com`) redirect, and `platform.openai.com/docs/api-reference/*` answers 403 to a fetch.
Labels as in `README.md`. Copied verbatim from `discovery.md` section 1.2 by the lead; later re-reads append dated sections.

## The pages read on 2026-09-24 (providers reader, WebFetch; every item **RECORDED**, none executed)

- **Host relocation, unchanged since 2026-09-17** (`artifacts/ai-control-plane-b20/mcp-reference-notes.md:6-8`): `platform.openai.com/docs/*`
  → 301 `developers.openai.com/api/docs/*`; `platform.openai.com/docs/api-reference/*` → 403 to WebFetch; `docs.claude.com/en/*` → 302 and
  `docs.anthropic.com/en/*` → 301 `platform.claude.com/docs/en/*`. New today: `platform.claude.com/docs/en/agent-sdk/{overview,subagents}` →
  307 `code.claude.com`, a third host not recorded anywhere in the repository and therefore NOT fetched. The hosts named by the task
  and the runbook no longer serve the pages (D21-29).
- **OpenAI structured outputs** (`https://developers.openai.com/api/docs/guides/structured-outputs`): `text.format = { type: "json_schema",
  strict, name, schema }`; strict requires `additionalProperties: false` and every field required; supported keywords
  type/properties/items/enum/$ref; refusals arrive as a `refusal` field; the page recommends `gpt-6-astra` for new projects. The code's
  default is `gpt-5.6-sol` (`app/lib/llm/openai-config.ts:1`) and its reasoning/temperature rules are pinned to gpt-5.x (`:47`;
  `openai-provider.ts:161`).
- **OpenAI function calling** (`…/guides/function-calling`): the flat function-tool shape matches the renderer (`provider-tools.ts:341-`
  region, reader `:344-360`); `tool_choice` accepts auto/required/none/`{type:"function",name}` and an `allowed_tools` subset; parallel
  function calling is on by default and `parallel_tool_calls: false` yields at most one call per turn (the code sets false,
  `adapters.ts:124`); reasoning items must be passed back with outputs (the code round-trips them and requests
  `reasoning.encrypted_content`, `:128`); custom tools and tool search exist (outside the handled set → refused by the OD-91 guard).
- **OpenAI streaming** (`…/guides/streaming-responses`): `stream: true` emits SSE semantic events (`response.created`,
  `response.output_text.delta`, `response.completed`, `error`); the code's unused stream consumer handles a subset
  (`openai-provider.ts:196-215`, reader).
- **OpenAI background mode** (`…/guides/background`): `background: true` runs asynchronously; poll `GET /responses/{id}`;
  `POST /responses/{id}/cancel` is idempotent; cancellation of non-background responses is not documented; with `store: false` response
  data is still kept about 10 minutes for polling; `sequence_number` allows resume of a background stream. The code sends `store: false`
  (`adapters.ts:129`) and uses neither background nor cancel.
- **OpenAI Agents SDK** (`…/guides/agents`, `/agents/sdk`): the SDK runs inside the application (runner, handoffs, sessions; TypeScript
  and Python); a separate "Agents API runs a managed harness in OpenAI's service"; the handoff and agents-as-tools wire mechanics are
  on sub-pages that were not fetched; the repository has no Agents SDK dependency (`package.json:47, :64`).
- **OpenAI Responses reference** (`https://developers.openai.com/api/reference/resources/responses/methods/create`, partial excerpt):
  parameters include `background`, `include`, `conversation`, `context_management`, `access_programs`; the tool list includes function,
  MCP, shell, computer, custom tools and namespaces. The defaults of `parallel_tool_calls` and `store` and the full `tool_choice` union
  were not in the retrievable excerpt — **UNKNOWN**.
- **Anthropic tool use** (`https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview`, `/define-tools`): tools are
  `{ name ^[a-zA-Z0-9_-]{1,128}$, description, input_schema }` with optional `strict`, `input_examples`, `cache_control`,
  `defer_loading`, `allowed_callers`; `tool_choice` auto/any/tool/none with `disable_parallel_tool_use`; any/tool prefill the assistant
  turn; the page states forced any/tool "return a 400 error" on Claude Opus 5.5, Claude Fable 5.1 and Claude Mythos 5.1 and are
  unsupported with manual extended thinking — the documented alternative is auto plus strict tool use or structured outputs. The code
  maps required→any and `{name}`→tool (`anthropic-provider.ts:73-78`), the propose routes and the parts rerank force a tool, and the
  default model `claude-opus-4-7` (`anthropic-provider.ts:86`; `adapters.ts:208`) is not in the restricted list.
- **Anthropic strict tool use and structured outputs** (`…/tool-use/strict-tool-use`, `…/build-with-claude/structured-outputs`):
  `strict: true` is grammar-constrained sampling without a beta header; `output_config.format = { type: "json_schema", schema }` is GA
  (`output_format` deprecated); listed models claude-opus-5-5, claude-opus-5, claude-sonnet-5, claude-haiku-4-5-20251001
  (`claude-opus-4-7` not listed); the schema subset requires `additionalProperties: false`, allows enum/const/anyOf/$defs/formats,
  `minItems` only 0 or 1, and lists `minLength`/`maxLength`/`pattern`/`minimum`/`maximum` and recursion as unsupported; grammars are
  cached 24 h; `output_config.effort` exists. The agent wire subset (`provider-tools.ts:36-39`) conforms; the propose routes' strict
  schemas carry `maxLength`/`maxItems` (`app/lib/llm/__tests__/b16-0-17-2-adapter-schema-parity.test.ts:25-26, :66-67, :73-76`).
- **Anthropic stop reasons** (`…/build-with-claude/handling-stop-reasons`): `end_turn`, `max_tokens`, `stop_sequence`, `tool_use`,
  `pause_turn`, `refusal` (not retryable on another model), `model_context_window_exceeded`; all HTTP 200. The code passes
  `stop_reason` through untyped (`app/lib/llm/types.ts:75`) and the loop never reads it (grep `stopReason` in `loop.ts`: none).
- **Anthropic streaming** (`…/build-with-claude/streaming`): SSE `message_start` … `message_stop`, `input_json_delta` for tool input,
  in-stream `overloaded_error` ≙ 529; fine-grained tool streaming per tool; an interrupted stream can be resumed but tool_use and
  thinking blocks cannot be partially recovered. The code maps 529 to `overloaded` (`app/lib/llm/errors.ts:134`); its stream path has no
  production caller (`router.ts:36-39`; grep `.stream(`: router and one fixture test only).
- **Anthropic Message Batches** (`…/build-with-claude/batch-processing`): up to 100 000 requests / 256 MB, results within 24 h at 50 %
  price, cancel endpoint, canceled/expired requests not billed. The code uses no batch API.
- **Anthropic Messages reference** (`https://platform.claude.com/docs/en/api/messages`): `output_config`, `thinking`, `service_tier`,
  `container`, `cache_control`, `metadata.user_id`; usage reports `cache_creation_input_tokens`, `cache_read_input_tokens`,
  `server_tool_use`. The adapters read only `input_tokens`/`output_tokens` (`adapters.ts:190`, reader; `types.ts:65-68`).
- **Anthropic provider-side agent features** (tool-use overview): the Advisor tool, Tool search, Tool Runner and Claude Managed Agents
  are provider-specific; their `server_tool_use` / `*_tool_result` blocks are exactly what the OD-91 guard refuses
  (`app/lib/agent/provider-output-guard.ts:22`).
- **Since the B20-A5 re-read of 2026-09-23** (which covered only the two MCP-connector pages): every page above is new to the reference
  notes; no page changes OD-90/OD-91's premises.

## Re-reads

- (none yet; each increment that re-reads a page appends the date, the URL and what changed)
