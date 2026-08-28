# B16.0.23 §G — AI/provider boundary

`spice/ai` (`authenticatedJsonRoute`, provider-credit, editor-class + CSRF,
8 MB / 30 s). Fake LLM router; zero credits.

- **All refusals spend ZERO provider calls**: 401/foreign/revoked/viewer/
  commenter/cross-origin, media/size/JSON/abort, and the required-field 400
  all return before `llmRouter.generate` (pinned: `generate` uncalled).
  **CONFIRMED**.
- **A valid request calls the provider EXACTLY once per iteration with the
  pinned parameters**: `provider`, `maxTokens: 4096`, `temperature: 0`,
  `toolChoice: "required"`, the system prompt, and all 20 tools. Pinned.
  **CONFIRMED**.
- **Requested-provider routing preserved**: `anthropic` honored; an
  unrecognized provider falls back to `openai` (historical `requestedProvider`
  default). Pinned. **CONFIRMED**.
- **Inline schemas moved beside a schema-derived validator**: the 20 tool
  schemas now live in `app/api/spice/ai/_tools.ts`; `validateSpiceToolInput`
  walks the EXACT schema nodes (required keys, types, enums, numeric bounds,
  array item shapes) — provider output is structurally validated BEFORE any
  tool handler runs. The array is frozen. **CONFIRMED**.
- **Adapter parity** (`b16-0-23-adapter-schema-parity`, fake SDK clients):
  every tool's `inputSchema` reaches BOTH the OpenAI `parameters` and the
  Anthropic `input_schema` by REFERENCE IDENTITY (`toBe`), un-weakened, and
  `toolChoice:"required"` survives as OpenAI `"required"` / Anthropic
  `{type:"any"}`. The validator is proven to derive from the same nodes.
  **CONFIRMED**.
- **Provider vs local error split (the §G correction)**: the
  `llmRouter.generate` call has its OWN try/catch that is the ONLY producer of
  `providerErrorResponse` (503). Local failures — no tool call
  (`SPICE_AI_NO_TOOL_CALL`), structural tool-input failure
  (`SPICE_AI_TOOL_INPUT_INVALID`), unknown tool / semantic refusal
  (`SPICE_AI_REQUEST_INVALID`) — return deterministic local 422s that never
  blame the provider. A genuine provider rejection alone keeps the 503
  envelope (pinned stable). Gate: exactly one `providerErrorResponse` call,
  dominated by `llmRouter.generate`. **CONFIRMED**.
- **AI is proposal-only**: `run_simulation` merely RECORDS a `request-run`
  proposal operation; the job store stays empty through the whole exchange
  (pinned). AI cannot create, run, cancel, delete, certify, or approve a
  simulation. **CONFIRMED** — see
  [human-truth-contract.md](human-truth-contract.md).
