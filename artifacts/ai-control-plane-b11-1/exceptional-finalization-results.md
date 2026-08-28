# B11.1 §E — exceptional-path route finalization

## Restructure (`app/api/chat/route.ts`)

1. **The trace is OPENED by the route**, before the loop:
   `traceRecorder.recordRunStarted()` runs inside a passive `try`. The
   recorder's `recordRunStarted` is idempotent, so the loop's own
   normalized `run_started` event is a no-op and the trace event order is
   unchanged. This is what makes an exceptional path produce a *complete*
   (and therefore persistable) trace — see the finding below.
2. **One funnel**: `finalizeTrace(outcome, failureReason)` records the
   terminal if none exists, finalizes, and validates. It is idempotent
   (`traceRecorder.isFinalized`), fully wrapped in `try/catch`, and emits
   no UI events.
3. **Every path calls it**:
   - normal completion / normalized provider failure / cancellation /
     deadline / tool refusal → the loop's normalized `result`;
   - unexpected loop throw or stream-infrastructure failure → the outer
     `catch` records `failed`/`stream_error` FIRST, then emits the UI
     `run_failed`, then finalizes;
   - the `finally` block calls `finalizeTrace("failed","stream_error")`
     again as a belt-and-braces guard for a path that reached neither
     branch (for example an `enqueue` failure mid-stream); idempotence
     makes it a no-op after a successful finalization.
4. `emit` inside the outer catch is itself wrapped, so a dead controller
   cannot prevent finalization; `controller.close()` is wrapped too.
5. A failing sink factory can never abort `POST` (see §C).

## Results (`b11-1-route-finalization.test.ts`, production POST)

| Path | NDJSON | Trace |
| --- | --- | --- |
| Normal completion | one `run_started`, one terminal | one VALID trace, `completed` |
| Unexpected loop throw (R6) | one `run_failed/stream_error` | **one VALID trace, `failed`/`stream_error`** (was zero) |
| Throwing sink factory (R4) | unchanged, HTTP 200 | run streams normally (was: POST threw) |
| Malformed sink object / sink throwing on every call | byte-identical event sequence to the healthy baseline | classified, never fatal |
| Hostile sink vs healthy sink | identical advertised toolset | tracing never touches discovery or authorization |
| Pre-stream refusal (400) | no stream | no trace at all |

## The finding this section produced

The first version of the exceptional path finalized nothing even after the
restructure: with the loop throwing before emitting anything, the trace had
no `run_started`, so the new completeness validator correctly refused it
and §D correctly withheld it from the sink. The fix was not to relax
validation but to make the route open the trace itself — the run genuinely
started, so the trace should say so. Requirements A, D and E interacted to
expose a real ordering bug that neither would have caught alone.
