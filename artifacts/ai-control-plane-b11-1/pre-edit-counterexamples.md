# B11.1 pre-edit counterexamples (R1–R6)

Independently reproduced against the B11 tree with transient vitest files
(deleted after capture), BEFORE any B11.1 edit. Exact captured output:

## R1 — incomplete trace validation

Against an otherwise valid completed trace, **8 of 8** forgeries validated
clean, and a trace with `run_started` removed entirely also validated:

```
R1 forgeries ACCEPTED by the validator: ["endedAt < startedAt",
  "terminal outcome != terminal event","invalid top-level failureReason",
  "negative steps","negative toolCalls","string usage",
  "extra keys in usage","totals disagree with ledger"]
R1 missing run_started issues: []
```

## R2 — sink mutation corrupts recorder authority

A sink whose `append(event)` rewrote `event.kind` and whose
`complete(trace)` rewrote provider/scope/events:

```
R2 provider after sink mutation: anthropic | projectId: attacker | events: 0
R2 event kinds: []
```

The recorder's own finalized trace carried every one of the sink's
mutations — identity, scope, and the entire event ledger were attacker
controlled.

## R3 — complete-only failure unclassified

A sink whose `append` succeeded and whose `complete` threw:

```
R3 appended: 2 | diagnostics: []
```

The returned trace claimed a clean run.

## R4 — sink factory failure breaks chat

With the production sink factory set to throw, a valid `POST /api/chat`:

```
R4 POST threw: factory failed
```

The request never returned a stream.

## R5 — replay capsule neither exact nor sanitized

A capsule carrying `opaqueProviderContinuation` (with
`encrypted_content`), `rawProviderBody`, `thinking`, and
`authorization: "Bearer sk-live-…"`:

```
R5 hostile capsule ok: true | failures: [] | executed: true
```

The forbidden fields passed validation and the replay executed.

## R6 — exceptional route path records no trace

An unexpected `runAgentLoop` throw (not the loop's normalized terminal
conversion) reaching the route's outer handler, with a capturing sink:

```
R6 emitted events: ["run_failed/stream_error"]
R6 traces finalized to the sink: 0
```

Confirmed structurally as well: the outer `catch` block emitted
`run_failed/stream_error` and then fell through to `finally {
controller.close(); }` without any `traceRecorder` call.

---

All six are closed and permanently regression-tested in
`app/lib/agent/__tests__/b11-1-trace-integrity.test.ts` (22 tests) and
`app/api/chat/__tests__/b11-1-route-finalization.test.ts` (6 tests).
