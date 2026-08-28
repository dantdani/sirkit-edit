# B13.2 §C — the abort settlement state machine

## The defect (R5)

`loadRunComponentAuthority` raced `Promise.race([load, deadline])`. External
abort aborted the internal controller but was NOT a race member, so a source
that never settles (even after observing abort) left the returned promise
pending until the separate 5 s authority deadline:
`{"midFlightExternalAbort":"HUNG","sourceSawAbort":true}`.

## The state machine

Three inputs, ONE terminal settlement, guarded by a `settled` latch:

```
                    ┌──────────────── external abort ──────────────┐
                    │                                              │
  [pre-aborted?] ───┼── yes ──> return null (NO I/O, no controller) │
        │ no        │                                              ▼
        ▼           │                                     controller.abort()
  start load ───────┼── deadline fires ──> controller.abort() ──> settle(null)
        │           │                                              ▲
        └── source settles ── loaded & non-empty ──> settle(records)│
                            └ unavailable/empty/reject ──> settle(null)
```

`settle(value)`:
1. returns immediately if already settled (late arrivals discarded);
2. marks settled;
3. `clearTimeout(timer)`;
4. `removeEventListener("abort", onExternalAbort)`;
5. resolves the outer promise exactly once.

Both source arms (`then`'s fulfil AND reject handlers) call `settle`, so a
late rejection is handled rather than orphaned — no unhandled rejection is
possible. `controller.abort()` is invoked by at most one winning arm, and
`AbortController` itself is idempotent, so the source observes exactly one
abort event (asserted: `abortCount === 1`).

## Requirements → proof

| requirement | test |
| --- | --- |
| 1. mid-flight abort returns null IMMEDIATELY, no deadline wait | 11 (settles with ZERO timer advance) |
| 2. internal controller aborted exactly once | 11, 12, 13 (`abortCount === 1`) |
| 3. deadline timer cleared | 11, 12, 13 (`vi.getTimerCount() === 0`) |
| 4. external listener removed | `settle` step 4; no leak across the 13 loop |
| 5. late source resolution discarded | 14/15 |
| 6. late source rejection handled | 14/15 |
| 7. no unhandled rejection | 14/15 (`process.on("unhandledRejection")` trap empty) |
| 8. pre-aborted input performs no I/O | 15b (`started === 0`) |
| 9. exactly one terminal settlement | 13 (`settlements === 1` in both race orders) |

All §C tests use fake timers and a source that deliberately never resolves
after observing abort; test 11 asserts settlement BEFORE advancing to the
deadline, which is the exact discrimination R5 failed.

At the route level, §E test 23b proves the same property through the REAL
`/api/chat` handler: a mid-flight abort settles the request in well under the
5 s authority deadline while the durable source is still hanging, and the
source's signal was actually aborted.
