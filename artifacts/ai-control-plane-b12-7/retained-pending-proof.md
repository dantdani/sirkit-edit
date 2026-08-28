# B12.7 — retained-pending proof

All through the REAL `createAutosaver` (`b12-7-total-settlement.test.ts`).

## R1 closure trace (unstringifiable thrown save value)

| Step | Pre-B12.7 | Post-B12.7 |
| --- | --- | --- |
| `schedule()` → first settlement | conversion trap ESCAPES `run()`; `pending` stays false | `run()` renders totally, restores `pending = true`, status `{error, "unrenderable thrown value"}`; settlement returns typed failure |
| status after first failure | stranded `"saving"` | `"error"` |
| second settlement | `{ ok: true }` — the write is GONE (`calls` stays 1) | typed failure again; the SAME save re-runs (`calls` 2) — retained |
| save callback heals | (nothing left to save) | third settlement `{ ok: true }`, `calls` 3, status `saved` — the ORIGINAL pending write persisted |

The same retention is proven for a hostile `Error.message` getter, a
thrown `Symbol`, and a thrown `null` (each: typed failure, status
`error` with the rendered detail, save re-ran on the next settlement),
and for a foreign truthy non-`{ok:true}` SAVE RESULT (`{ok:"yes"}` →
flush false, status `error` "save failed without a usable reason",
retried).

## The debounce path

`schedule()` + the hostile save, letting the DEBOUNCE TIMER (not a
flush) run the write: no uncaught exception anywhere (process-level
`uncaughtException` + `unhandledRejection` captures asserted EMPTY in
the suite's `afterAll`), status lands on the retained `error` state, and
a later settlement still refuses — the timer callback is exactly as
total as the flush path, because they share `run()`.

## Ordering guarantee

`pending = true` is restored BEFORE `setStatus` runs — so even a
throwing status LISTENER (outside this stage's scope but inside its
blast radius) can no longer reopen the loss window: the write is already
retained by the time any foreign code executes.
