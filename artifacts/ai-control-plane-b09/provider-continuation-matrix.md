# B09 — Provider Continuation Matrix

| concern | OpenAI (Responses API) | Anthropic (Messages API) |
|---|---|---|
| tool declaration shape | FLAT `{type:"function", name, description, parameters, strict:true}` — never the nested Chat Completions `{function:{…}}` shape | `{name, description, input_schema, strict:true}` |
| strict schemas | `strict:true`; every object level `additionalProperties:false` + full `required`; optionals rendered nullable | same rendered schema (byte-equal semantic core; parity report) |
| conversation state | MANUAL (`store:false`): continuation input = prior items + EVERY output item of each response, appended verbatim | full `messages` list; assistant turns carry the RAW content blocks verbatim |
| reasoning/continuation items | `include: ["reasoning.encrypted_content"]`; reasoning items round-trip inside the opaque continuation state — never in traces, chat persistence, or user output | thinking/tool_use blocks preserved verbatim inside the opaque continuation state — never surfaced |
| tool-call id | `function_call.call_id` preserved; result returned as `{type:"function_call_output", call_id, output}` | `tool_use.id` preserved; result returned as `{type:"tool_result", tool_use_id, content, is_error?}` |
| result ordering | one `function_call_output` per call, appended after the response's own items, in call order | `tool_result` blocks FIRST in the next user message (before any other content), in call order |
| tool failure marking | failure encoded in the bounded JSON payload (`ok:false`, status) | same payload PLUS `is_error: true` on the block |
| parallel tool calls | `parallel_tool_calls: false` | `tool_choice: {type:"auto", disable_parallel_tool_use:true}` |
| multi-call batches (defense) | loop resolves strictly sequentially in provider order; every call answered | same |
| usage/stop normalization | `usage.input_tokens/output_tokens`, `response.status` | `usage.input_tokens/output_tokens`, `stop_reason` |
| errors | `toProviderError` classification (rate_limit / insufficient_quota / authentication / model_access / timeout / network / overloaded / cancelled / bad_request), redacted | same classifier |

Semantic parity: the loop, gateway, tool schemas, budgets, prompts, and
event protocol are IDENTICAL across providers — adapters translate
mechanics only (proven by contract tests 1–10 and the parity artifact).
