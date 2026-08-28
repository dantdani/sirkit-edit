# B11 — `sirkit.agent-run-trace.v1`

> **EXTENDED BY B11.2.** `TRACE_BOUNDS` gained `maxRecorderDiagnostics`,
> `maxSerializedChars`, `maxScanNodes`, and `maxScanDepth`, and the
> whole-document secret scan now walks ORIGINAL key names and string values
> before serialization. The trace schema itself (`sirkit.agent-run-trace.v1`)
> and the closed 10-entry diagnostic vocabulary are UNCHANGED. See
> [../ai-control-plane-b11-2/bounded-validation-results.md](../ai-control-plane-b11-2/bounded-validation-results.md).

> **SUPERSESSION NOTE (B11.1).** The validation guarantees described below were INCOMPLETE: forged timestamps, a summary disagreeing with the event ledger, negative/fractional totals, string or extra-key usage, an invalid top-level failure reason, and a MISSING `run_started` all validated clean. B11.1 rewrote `validateAgentRunTrace` into an internal-consistency validator and extended the closed diagnostic vocabulary. See artifacts/ai-control-plane-b11-1/trace-validation-closure.md.

Module: `app/lib/agent/trace.ts`. Every run produces exactly one document.

## Captured (bounded, auditable metadata only)

| Field | Content |
| --- | --- |
| `runId`, `traceId` | Run ledger identity (≤128 chars each) |
| `provider`, `model` | `openai`/`anthropic`; normalized adapter model id (≤100) |
| `promptVersion`, `promptDigest` | `AGENT_SYSTEM_PROMPT_VERSION` + digest — never the prompt text |
| `registryDigest` | Tool-registry/manifest digest |
| `scope` | Exactly `{tenantId, projectId, branchId}` |
| `contextDigests` | `canonicalRevisionDigest`, `schematicDigest`, `selectionDigest`, `netlistDigest`, `resourceManifestDigest` (each nullable) |
| `startedAt`, `endedAt` | Recorder clock (a deterministic test clock in replay) |
| `events[]` | `run_started` \| `step` \| `tool_invocation` \| `terminal` |
| `step` | normalized `model`, `inputTokens`, `outputTokens`, `toolCallCount` |
| `tool_invocation` | `callId`, `toolId`, `version`, `operationClass`, `argsDigest`, `outcomeClass`, `status`, `verification`, `outputDigest`, `proposalId`, `proposalDigest` |
| `terminal` | closed-vocabulary `outcome` + `failureReason`, plus ledger-computed `steps`, `toolCalls`, `usage` |
| `warnings[]` | ≤32 sanitized strings, ≤300 chars each |
| `recorderDiagnostics[]` | closed vocabulary (see below) |

## Never captured

API keys/credentials/environment values; raw provider request or response
bodies; hidden reasoning or Anthropic thinking blocks; OpenAI
continuation/reasoning state; stack traces; complete board/schematic/
context dumps; unrestricted user prompts or tool outputs; browser-supplied
authority claims. Payloads enter only as `engineeringDigest` values
(`argsDigest`, `outputDigest`, `proposalDigest`).

## Closed vocabularies

- `outcomeClass`: `read` | `proposal` | `proposal_blocked` | `refused`
- `terminal.outcome`: `completed` | `failed` | `cancelled`
- `failureReason`: `cancelled`, `deadline`, `max_steps`, `toolset_invalid`,
  `internal_error`, `stream_error`, or `provider_<reason>` (pattern-bound)
- `recorderDiagnostics`: `trace_sink_failure`,
  `trace_event_capacity_reached`, `trace_post_terminal_append_refused`

## Bounds

`maxIdChars` 128 · `maxModelChars` 100 · `maxDigestChars` 100 ·
`maxWarningChars` 300 · `maxWarnings` 32 · `maxEvents` 256 ·
`maxStatusChars` 64 · `maxFailureReasonChars` 64. Overflow is refused at
validation and truncated (never silently reshaped) at record time.

## Validation guarantees (`validateAgentRunTrace`)

Exact top-level keys; exact per-event keys; strictly increasing `seq`;
`run_started` first; **exactly one** terminal event and **nothing after
it**; closed vocabulary enforcement; nullable-digest discipline; bounded
warnings; and a whole-document secret-shaped-content denylist as defense in
depth. `agentRunTraceDigest` is the deterministic identity used by replay
pins.
