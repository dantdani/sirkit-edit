# B16.0.24 §F — trace & redaction proof

The B11/B11.1 trace machinery is unchanged by the migration; it is created and
finalized inside the callback (now under the wrapper boundary).

- **Trace recording + redaction remain active**: the callback constructs the
  `AgentTraceRecorder` with the run identity, prompt digest, registry digest,
  scope, and context digests; the recorder observes NORMALIZED events only and
  can never alter authorization or the run outcome. **CONFIRMED**.
- **Secrets and hidden reasoning cannot enter events or traces**: the loop
  emits only normalized `AgentRunEvent`s; provider bodies/stacks/secrets/hidden
  reasoning are never surfaced (unchanged); a provider failure becomes a
  bounded `run_failed` with a redacted message. **CONFIRMED**.
- **A trace is not marked complete before terminal settlement**: `finalizeTrace`
  is passive and idempotent; the terminal is recorded before finalize; standing
  b11-1 asserts `sink.completed.length === 1`, `validateAgentRunTrace === []`,
  exactly one terminal event, across normal/throw/cancelled paths. **CONFIRMED**.
- **A failing sink factory cannot abort the request**: it falls back to an
  isolated in-memory sink and is classified on the trace; standing b11-1 R4
  asserts a throwing sink factory still returns 200 with the baseline event
  sequence. **CONFIRMED**.
- **A request refused BEFORE the stream produces no trace**: standing b11-1
  asserts `sink.completed.length === 0` for a body-shape 400. **CONFIRMED**.
- **Credentials are excluded from logs/traces/artifacts**: the auth routes
  hold credentials only in local callback scope and never log/echo/trace them;
  chat never receives credentials. **CONFIRMED**.
