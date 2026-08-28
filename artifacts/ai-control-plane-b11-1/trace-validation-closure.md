# B11.1 §A — complete trace validation

> **SUPERSEDED IN PART BY B11.2.** The whole-document secret scan described
> here ran on `JSON.stringify(trace)` only. Serialization escapes nested
> quotes, so credential-shaped JSON embedded in a trace field was invisible to
> it (reproduced as B11.2 R4). `recorderDiagnostics` also had no length bound,
> so a hostile array was fully scanned and Set-constructed before any check
> (B11.2 R6). Both are closed: the scan now walks ORIGINAL key names and
> string values before serialization, and the diagnostics length bound is
> checked BEFORE any scanning or Set construction. See
> [../ai-control-plane-b11-2/recursive-redaction-results.md](../ai-control-plane-b11-2/recursive-redaction-results.md)
> and [../ai-control-plane-b11-2/bounded-validation-results.md](../ai-control-plane-b11-2/bounded-validation-results.md).
> The historical record below is retained unchanged as evidence.

`validateAgentRunTrace` (app/lib/agent/trace.ts) was rewritten from a
per-field shape check into an **internal-consistency** validator. A
document whose summary disagrees with its own event ledger is now refused.

## Enforced invariants

| Invariant | Rule |
| --- | --- |
| Structure | exact top-level keys; exact keys for `scope`, `contextDigests`, `terminal`, `terminal.usage`, and EVERY event kind |
| run_started | exactly one, at index 0 |
| terminal | exactly one, and it must be the LAST event |
| ordering | `seq` strictly increases; nothing appears after the terminal |
| timeline | `startedAt`/`endedAt` finite; `endedAt >= startedAt` |
| totals | `terminal.steps` === step-event count; `terminal.toolCalls` === tool-invocation count |
| usage | `terminal.usage.{inputTokens,outputTokens}` === summed step usage; each a nonnegative safe integer |
| counters | `steps`/`toolCalls` nonnegative safe integers (fractional and negative refuse) |
| summary agreement | top-level `terminal.outcome`/`failureReason` EXACTLY equal the terminal event's |
| model | top-level `model` === the LAST step's model, or `""` when no step exists |
| outcome semantics | `completed` ⇒ null reason; `cancelled` ⇒ the normalized `cancelled` reason; `failed` ⇒ a closed-vocabulary reason |
| diagnostics | closed vocabulary AND unique |
| redaction | no secret-shaped content anywhere in the serialized document |
| output | bounded to `TRACE_BOUNDS.maxValidationIssues` (12) |

## Why the recorder cannot produce a disagreeing summary

`AgentTraceRecorder.compose()` DERIVES the summary from the event ledger:
outcome and reason come from the terminal event, totals from counting
events, usage from summing step events. Callers pass only an intent
(`{outcome, failureReason}`) used when no terminal was recorded yet. There
is no code path that can write a summary that disagrees with the ledger —
the validator's consistency rules are therefore an independent check on
any document reaching a sink or an evaluation, not merely a restatement of
the recorder.

## Closed diagnostic vocabulary (extended in B11.1)

`trace_clock_failure`, `trace_digest_failure`,
`trace_event_capacity_reached`, `trace_input_normalized`,
`trace_post_terminal_append_refused`, `trace_reentrant_call_refused`,
`trace_sink_factory_failure`, `trace_sink_failure`,
`trace_validation_failure`.

## Defect found while implementing

Deriving the summary with `terminalEvent?.failureReason ?? "internal_error"`
silently rewrote a completed run's legitimately `null` reason into
`internal_error` (nullish coalescing treats `null` as absent). The
evaluation matrix caught it immediately — eight cases failed with
`a completed run must carry a null failureReason`. Fixed with an explicit
presence test; the code now carries a comment warning against `??` there.
