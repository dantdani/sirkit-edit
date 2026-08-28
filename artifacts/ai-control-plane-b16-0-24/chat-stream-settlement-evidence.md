# B16.0.24 §F — chat stream settlement evidence

The versioned NDJSON protocol is preserved exactly; the wrapper adds only the
authorization boundary and hands the callback the abort `signal` used to build
and settle the stream.

- **Each line is one complete valid event**: `JSON.stringify({ v: 1, seq,
  ...event }) + "\n"`; the §A pin parses every line as JSON. **CONFIRMED**.
- **`v`, `runId`, monotonic `seq`**: `v === 1` on every line; `seq` increments
  from 1 (pinned `lines[i].seq === i+1`); the response carries
  `X-Sirkit-Run-Id: run-<uuid>`, `X-Sirkit-Chat-Protocol: "1"`,
  `X-Sirkit-AI-Provider`, `Cache-Control: no-store`, `Content-Type:
  application/x-ndjson; charset=utf-8`. **CONFIRMED**.
- **Exactly one terminal event**: the route's own `streamTerminalEmitted`
  guard (kept) plus the loop's guard ensure one `run_completed | run_failed`;
  the §A pin asserts `terminals.length === 1`; standing b11-1 asserts the same
  across normal / throw / cancelled / hostile-sink paths. **CONFIRMED**.
- **Disconnect/abort stops further useful work**: the wrapper's `signal` is
  wired to the run's `AbortController` (`if (signal.aborted) abort.abort();
  else signal.addEventListener("abort", …)`) and threaded into the cancellable
  authority + replacement-pin-fact reads; an already-aborted request yields one
  `run_failed` and no `run_completed` (standing b11-1); a mid-flight abort
  settles < 2 s while the durable source is cancelled (standing b13-2 23/23b).
  **CONFIRMED**.
- **Late resolutions cannot emit after termination; late rejections are not
  unhandled**: the terminal guard and the passive finalizer are unchanged;
  the hostile never-settles/rejects/throws-cancel pins (b10-2) still produce no
  unhandled rejection. **CONFIRMED**.
- **Backpressure and output bounds**: the streaming bounded read caps the
  request; the loop's budget caps output. **CONFIRMED**.
- **Stream-creation failure keeps its pre-stream structured response;
  post-stream failures become protocol events**: a refusal before the stream
  returns a JSON `{ok:false,…}` with no run-id/ndjson (pinned); a failure after
  the stream opens is a `run_failed` event, never a malformed HTTP response
  (b11-1). **CONFIRMED**.
- **Replay pins byte-identical**: no golden trace/replay digest literal is
  pinned in any chat test; `validateAgentRunTrace(trace) === []` and the
  single-terminal invariant hold unchanged. **CONFIRMED**.
