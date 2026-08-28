# B14.3 §A — the shared bounded reader's lifecycle bounds

`app/lib/http/bounded-stream.ts` — `readBoundedStream(body, limit, lifecycle?)`.

## The contract

`lifecycle` is OPTIONAL (`{ signal?: AbortSignal; deadlineMs?: number }`):

- **Absent** → the EXACT pre-B14.3 B10 default (`readToLimit`, the original
  read loop verbatim): byte ceiling only; a stream that never yields is the
  caller's liveness problem, exactly as before. Existing B10 consumers (the
  chat route's `readBoundedBody`) pass no lifecycle and are byte-for-byte
  unaffected — no B10/B10.1/B10.2 byte-limit behavior was weakened
  (`over-limit` still stops immediately at the ceiling; cancellation stays
  best-effort/never-awaited; wire bytes, never character counts).
- **Present** → the B09.2/B13.2 hard-race discipline around the read itself:
  - `signal`: external abort terminates the read (`"aborted"`); a
    PRE-aborted signal settles WITHOUT calling `getReader()` (§A test 2 —
    a throwing duck-typed `getReader` proves it is never reached).
  - `deadlineMs`: a hard deadline on total stream consumption
    (`"timeout"`) — a stream that never emits its first chunk settles at
    the bound (§A test 1).
  - EXACTLY ONE terminal settlement — a private latch; whichever of
    {abort, deadline, over-limit, completion, read failure} wins is final.
  - On abort/timeout/over-limit the ACTIVE reader receives BEST-EFFORT,
    NON-AWAITED cancellation (`void reader.cancel(...).catch(...)` inside
    try/catch) — a `cancel()` that throws synchronously, rejects, or never
    settles cannot delay the result (§A test 4, both hostile variants).
  - Late read RESOLUTIONS are discarded by the latch; late read REJECTIONS
    are observed by the read loop's catch — the unhandledRejection trap
    stays empty (§A test 5, both directions, via a duck-typed reader that
    IGNORES cancellation).
  - The deadline timer and abort listener are removed on EVERY terminal
    path — `vi.getTimerCount() === 0` after each §A settlement.

The result union gains `"aborted" | "timeout"`; those reasons are
UNREACHABLE for callers that pass no lifecycle (the chat route's
non-exhaustive over-limit/unreadable mapping is unchanged and still
compiles against the widened union).

## Why the extension lives HERE

R1/R2 both reduced to the same primitive gap: `await reader.read()` with no
signal or deadline path. Bounding it once in the ONE shared reader closes
the stalled-request hang (§B threads `req.signal` + a route deadline) and
the abandoned-response read (§C threads the channel's internal signal) with
a single proven mechanism instead of two bespoke races.
