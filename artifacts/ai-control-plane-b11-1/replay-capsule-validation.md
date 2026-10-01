# B11.1 §G — exact replay-capsule validation

> **SUPERSEDED IN PART BY B11.2.** This document's claim that capsule context
> fixtures are validated as *opaque payloads* scanned for forbidden field
> NAMES was **false in a way that mattered**: an unknown field could be
> attached to a fixture board, pass validation, and be carried verbatim into
> `canonicalState.pcb` (reproduced as B11.2 R1). The capsule's forbidden-name
> list also missed compound names (`clientSecret`, `refreshToken`,
> `providerClient`, `rawSdkPayload` — B11.2 R2), and the whole-capsule secret
> scan ran on the SERIALIZED form, so credential-shaped JSON nested inside a
> string was hidden by quote escaping (B11.2 R3). `scanOpaqueFixture` is
> retired; the capsule schema became `sirkit.agent-replay-capsule.v2` with a
> versioned `context` (and is now v3 / context v2 after B11.3 made the board [superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): B11.3's statement; the capsule is `sirkit.agent-replay-capsule.v4` since B21-F, a v3 document refused explicitly, and the context stays `sirkit.agent-replay-context.v2` - `artifacts/ai-control-plane-b21/evaluation-matrix.md` section 2]
> key-exact at every depth). See
> [../ai-control-plane-b11-2/replay-context-schema.md](../ai-control-plane-b11-2/replay-context-schema.md)
> and [../ai-control-plane-b11-2/recursive-redaction-results.md](../ai-control-plane-b11-2/recursive-redaction-results.md).
> The historical record below is retained unchanged as evidence.

## Contract (`validateReplayCapsule` in app/lib/agent/replay-capsule.ts)

Recursive EXACT keys with hard bounds for every level:

| Level | Exact keys |
| --- | --- |
| capsule | schema, caseId, provider, promptVersion, promptDigest, registryDigest, scope, context, userMessage, steps, expected |
| scope | tenantId, projectId, branchId |
| context | schematic, board, schematicHeadMark, selection, netlist, editorSchematicDigest |
| step | text, toolCalls, stopReason, model, usage (+ optional `failure`) |
| tool call | callId, providerName, argumentsText |
| usage | inputTokens, outputTokens (nonnegative safe integers) |
| failure | reason, message |
| expected | discoveredTools, toolOutcomes, terminal, traceDigest |
| tool outcome | toolId, outcomeClass, status |
| expected.terminal | outcome (closed vocabulary), failureReason |

Bounds (`REPLAY_CAPSULE_BOUNDS`): 32 steps · 16 tool calls per step ·
20 000 argument chars · 20 000 message chars · 256 array entries · 128 id
chars · 2 000 000 serialized bytes · 12 reported issues.

## Forbidden by name

`continuation`, `opaqueProviderContinuation`, `providerContinuation`,
`state`, `reasoning`, `reasoning_content`, `encrypted_content`,
`thinking`, `redacted_thinking`, `rawProviderBody`, `rawResponse`,
`rawRequest`, `providerResponse`, `providerRequest`, `response`,
`request`, `httpResponse`, `body`, `headers`, `client`, `sdk`, `openai`,
`anthropic`, `authorization`, `apiKey`, `api_key`, `x-api-key`,
`credential`, `credentials`, `secret`, `password`, `token`,
`accessToken`, `access_token`, `bearer`.

Exact-key validation already refuses ANY unknown field; the name list
turns the dangerous ones into a precise, self-explaining refusal, and it is
applied recursively inside the opaque context fixtures (schematic, board,
selection, netlist) where exact keys cannot be enforced.

## Whole-capsule secret denylist

The serialized capsule is scanned with the shared trace secret patterns.
The refusal is a stable structured `ReplayCapsuleInvalidError` with
`code: "REPLAY_CAPSULE_INVALID"` and a bounded issue list that names PATHS
only — a test asserts neither the issues nor the error message ever echo
the secret.

## Fails before any execution

`replayCapsule` validates on its FIRST statement, before
`sirkitToolRegistry()`, context assembly, discovery, gateway construction,
loop execution, or any tool invocation, and it THROWS rather than
appending a failure and continuing. A test installs a sink factory that
records whether it was ever touched and asserts it was not.
`runEvaluationCase` catches the error and scores the case as failed, so a
hostile capsule in a suite is a scored failure rather than a crash.

## The finding this section produced

Running the generator immediately after adding the validator failed with
`capsule: contains secret-shaped content` — the B11 evaluation matrix's
own `e15-redaction` fixture embedded `sk-live-AAAABBBBCCCCDDDD` as a
selection ref id to exercise warning redaction. That is exactly the class
of fixture this section forbids. The case was repurposed to use a benign
dead ref (it still proves the trace stays bounded and redacted), and the
secret-refusal proof moved to the B11.1 suite where it belongs.
