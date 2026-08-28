# B11 — pre-edit observability gaps and exposure audit

Discovery against the accepted B10.2 tree, BEFORE any B11 edit.

## Confirmed gaps (1–5)

1. **No server-owned run record.** `app/api/chat/route.ts` emitted the
   versioned NDJSON protocol (`{v, seq, ...AgentRunEvent}`) straight into
   the response stream. Nothing assembled a run-scoped document; once the
   stream closed, the run left no server-side ledger.
2. **`traceId` was an invocation label.** The only trace identifier was
   `traceId: \`agent-run-${runId}\`` passed into
   `ReadToolInvocationService.invoke` per tool call (gateway.ts) — a
   per-invocation correlation string inside the read service's redacted
   trace, never a versioned run ledger.
3. **Chat persistence stored conversational text.** The persisted project
   chat carries user/assistant message content only — no tool identities,
   outcomes, resource digests, or terminal classification, so it can
   neither audit nor replay an execution.
4. **Replay fixtures were build evidence.** `artifacts/ai-control-plane-b09/
   normalized-loop-replay-fixtures.json` pins the exposed declaration set
   for the B09 suites; it is not an executable evaluation framework and has
   no scoring, no case matrix, and no expected-outcome contract.
5. **No deterministic evaluation gate** existed for resource withholding,
   discovery correctness, tool-selection correctness, refusal correctness,
   provider-schema parity, terminal-event safety, proposal-only behavior,
   quota/failure classification, or absence of silent provider fallback.
   Each was covered by scattered stage suites; none was measurable as a
   scored, drift-detecting matrix.

## Exposure audit (6) — what could reach outputs before B11

| Surface | Reachable content | Risk found |
| --- | --- | --- |
| NDJSON UI events | `text_delta` (model text), tool ids/titles/status, sanitized warnings, sealed proposal artifacts | Model text and proposal bodies are intentionally user-facing; no credential path. **No secret, raw-body, or continuation exposure.** |
| Loop tool results (to the provider) | Bounded redacted JSON (`resultText`, ≤60k chars) with `{ok, status, output}` | Bounded by construction. |
| Provider failures | `LLMProviderError.message` (friendly text) sliced to 300 chars; upstream bodies never attached | Already redacted (B09/B09.1). |
| Persisted chat | user/assistant text only | No authority or credential content. |
| Proposal artifacts | operations, digests, scope, provenance `{provider, note, instruction}` — the instruction is the user's own text | Bounded (≤500 chars). |
| Provider continuation | `ProviderContinuation.state` (OpenAI reasoning items / Anthropic blocks) | Held in loop memory ONLY; never emitted, persisted, or logged. B11 keeps it out of the recorder by construction. |
| Unbounded data | Board/schematic/netlist never enter events | Confirmed absent. |

**Pre-existing risks requiring B11 controls:** (a) a future trace could
trivially capture the continuation state or raw tool outputs if the
recorder took typed payloads — B11's recorder accepts digests and closed
vocabularies only; (b) context-assembly warnings are free text and could
in principle carry pasted secrets — B11 sanitizes every warning at record
time and refuses secret-shaped documents at validation.

## Reproduction method

All six were established by direct source inspection of `route.ts`,
`loop.ts`, `gateway.ts`, `tool-invocation.ts`, the persisted-chat model,
and the committed B09 artifacts; the B11 suite now pins the resulting
invariants as executable gates rather than prose.
