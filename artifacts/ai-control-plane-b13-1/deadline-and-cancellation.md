# B13.1 §F — deadline and cancellation

## The defect (R7)

B13's `loadRunComponentAuthority` raced the source against a timer. At
the deadline it RETURNED unavailable but the underlying repository work
kept running with a live signal (`sourceKeptRunning=true` in the probe),
could settle later, and could produce unhandled rejections.

## The rule

`loadRunComponentAuthority` now owns an internal `AbortController`:

1. **Pre-aborted request ⇒ no I/O.** If `signal.aborted` on entry, return
   unavailable immediately; the source is never invoked.
2. The external request signal is LINKED (`addEventListener("abort", …)`)
   to the internal controller, so client disconnect also cancels the load.
3. The deadline timer calls `controller.abort()` — the SAME signal handed
   to `source.bindings.loadForComponent(...)` and honored by the
   production Postgres adapter, so timed-out work is truly cancelled, not
   abandoned.
4. **One terminal settlement.** The race resolves exactly once; a `settled`
   latch discards any late source resolution or rejection.
5. The load promise carries a terminal
   `.then(() => {}, () => {})` — a late rejection after the deadline can
   never become an unhandled rejection.
6. `finally`: timer cleared, abort listener removed (no listener leaks on
   long-lived request signals).

Failure remains fail-closed: rejection, abort, and deadline all fold to
`{ status: "unavailable" }` → the route withholds the resource and the
tool stays unexposed; unrelated chat continues.

## Proof (§F — fake timers, adversarial sources)

- A source that never settles: at `vi.advanceTimersByTime(deadline)` the
  loader returns unavailable AND the source-visible signal is aborted
  (`aborted === true` observed inside the source).
- Pre-aborted external signal: source invocation count stays 0.
- Late resolve after deadline: discarded (result stays unavailable, no
  second settlement).
- Late REJECT after deadline: discarded with ZERO unhandled rejections
  (asserted via a `process.on("unhandledRejection")` trap around timer
  flush).
- External abort mid-flight cancels the source the same way.
