# B12.8 — retained-pending proof

All through the REAL `createAutosaver` + `settleAutosaveForTransition`
(`b12-8-observer-isolation.test.ts`).

## Closure of the reproduction

| Step | Pre-B12.8 | Post-B12.8 |
| --- | --- | --- |
| schedule + first settlement (healthy save; observer throws on "saving") | observer throw escapes; save NEVER runs (`calls 0`); settlement `{ok:false, "…subscriber trap"}` | save executes exactly once (`calls 1`); settlement `{ ok: true }`; status `saved` |
| second settlement | `{ ok: true }` with the work LOST | `{ ok: true }` as a true no-op (`calls` stays 1 — nothing pending) |
| status after the cycle | stranded `"saving"` | `saved` |

## Failure-path retention under throwing observers

With a save failing `{ok:false, reason:"quota"}` and observers throwing
at every state: `flush()` returns `false`, status commits
`{error, "quota"}` (never stranded `saving`), the write stays pending —
the next flush re-runs the SAME save (call count increments), and after
the callback heals, settlement returns `{ ok: true }` with the RETAINED
write persisted and status `saved`. The observer's thrown
credential-bearing value appears nowhere: the settlement detail carries
only the authoritative `quota` reason.

Every notification state was exercised with a thrower (`dirty`,
`saving`, `saved`, `error`) against both the succeeding and the failing
save paths — the authoritative results (`flush()` boolean, save call
counts, committed status, pending retention) are identical to a
subscriber-free run in every case.

## The debounce path

`schedule()` + throwing observer, letting the TIMER run the write: the
save executes, status ends `saved`, and the process-level
`uncaughtException`/`unhandledRejection` captures (asserted EMPTY in the
suite's `afterAll`) prove no observer failure escapes the timer callback.
