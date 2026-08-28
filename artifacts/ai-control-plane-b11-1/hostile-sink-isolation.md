# B11.1 §B/§C/§D — hostile-sink isolation, failure classification, validate-before-persist

> **EXTENDED BY B11.4.** The recorder totality closure here is unchanged and
> green. Separately, the sink-factory instrumentation this stage introduced for
> "nothing executes" was later shown to be vacuous — `replayCapsule` never
> calls the factory — and is replaced by real boundary instrumentation in
> [../ai-control-plane-b11-4/no-execution-proof.md](../ai-control-plane-b11-4/no-execution-proof.md).

> **SUPERSEDED IN PART BY B11.2.** This document's claim that *"Recording is
> TOTAL: no recorder method throws"* was true for the inputs B11.1 tested and
> **false** for malformed OUTER values and hostile accessors: `recordWarning`,
> `recordStep`, and `recordTool` all threw (reproduced as B11.2 R5, six call
> sites). Normalization began only after the fields had already been read.
> Every public method now runs inside a `total()` boundary and reads every
> field through `safeRead()`. See
> [../ai-control-plane-b11-2/recorder-totality-results.md](../ai-control-plane-b11-2/recorder-totality-results.md).
> The historical record below is retained unchanged as evidence.

## §B — isolation (R2)

Before B11.1 the recorder pushed the SAME object into its internal ledger
and into `sink.append`, and handed its cached `finalized` document straight
to `sink.complete`. A mutating sink therefore owned the trace.

Now (`app/lib/agent/trace-recorder.ts`):

- `deepFreeze(value)` freezes an object and then its children (the
  already-frozen early return happens BEFORE freezing, so it can only skip
  a subtree that is itself already frozen).
- `snapshot(value)` = `deepFreeze(structuredClone(value))` — an independent,
  immutable copy. `structuredClone` failure yields `null`, classified by
  the caller rather than thrown.
- Internal events are frozen at append time; the sink receives a SEPARATE
  snapshot.
- Constructor identity is copied (`{...identity}` with fresh `scope` and
  `contextDigests` objects) and deep-frozen, so a caller that keeps a
  reference to the objects it passed in cannot re-scope the recorder.
- `finalize()` returns a deep-frozen document; `sink.complete` receives a
  separate snapshot of it.
- `InMemoryTraceSink` stores snapshots of what it is handed, so a later
  caller mutation cannot rewrite its history either.
- Repeated `finalize()` returns the cached immutable document (equivalent
  content, no re-emission, no second terminal).

Proven by `B11.1 §B`: a sink that rewrites `event.kind`/`seq` on append and
`provider`/`scope.projectId`/`terminal.steps`/`events.length`/
`recorderDiagnostics` on complete leaves the returned trace fully intact
and still schema-valid.

## §B.2 — sink RE-ENTRANCY (found during B11.1, not in the original R-list)

Isolation by snapshot stops a sink from *mutating* recorder state, but it
does not stop a sink from *calling back into* the recorder. A probe during
implementation showed that a sink whose `append()` calls
`recorder.recordTerminal()` terminated the trace from inside the very first
append, so every later event was refused as post-terminal:

```
A events: ["run_started","terminal"]   ← the step was silently LOST
A valid: []                            ← and the truncated trace validated
```

A sink whose `complete()` called `finalize()` recursed until an internal
failure was swallowed, leaving a misleading `trace_digest_failure`.

Closure: an `inSinkCall` guard is raised around every sink callback
(`callSink`). While it is raised, `append`, `recordWarning`, and
`finalize` refuse and classify `trace_reentrant_call_refused` — a new
closed-vocabulary diagnostic. A re-entrant `finalize` returns a composed
snapshot without persisting, so no recursion is possible. After the fix:

```
A events: ["run_started","step","terminal"]  diagnostics: ["trace_reentrant_call_refused"]
A valid: []  ledger steps: 1                  ← ledger intact
B diagnostics: ["trace_reentrant_call_refused"]  valid: []
```

Permanent regression: §B "a RE-ENTRANT sink cannot inject, truncate, or
recursively finalize the ledger".

## §C — complete failure classification (R3)

Every recorder-side failure class is now represented and surfaced in the
RETURNED document:

| Failure | Diagnostic |
| --- | --- |
| sink factory throws or returns a malformed sink | `trace_sink_factory_failure` |
| `sink.append` throws | `trace_sink_failure` |
| `sink.complete` throws | `trace_sink_failure` (the R3 gap) |
| payload not digestible (cyclic) | `trace_digest_failure` |
| clock throws / nonfinite / goes backwards | `trace_clock_failure` |
| final document fails validation | `trace_validation_failure` |
| input coerced (tokens, ids, model, reason) | `trace_input_normalized` |
| event/warning capacity reached | `trace_event_capacity_reached` |
| append attempted after the terminal | `trace_post_terminal_append_refused` |

The thrown message and stack are never retained — only the classification.
A test drives a sink whose errors literally contain `sk-live-…` and
`Bearer …` and asserts neither appears anywhere in the trace.

`createAgentTraceSink()` never throws: a failing or malformed factory falls
back to an isolated in-memory sink and reports `factoryFailed`, which the
route turns into the `trace_sink_factory_failure` diagnostic.

## §D — validate before persistence

`finalize()` is ordered: **construct → validate → classify-or-persist →
return**. `sink.complete` is reached only when
`validateAgentRunTrace(candidate)` is empty; an invalid document is
classified `trace_validation_failure` and never handed to a storage sink.
The returned document then carries the final diagnostic set (including a
complete-only sink failure, which by construction cannot have been visible
before `complete` was attempted). Adding a closed-vocabulary diagnostic to
a valid document cannot invalidate it — asserted by test.
