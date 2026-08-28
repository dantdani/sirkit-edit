# B12.8 — observer-isolation contract

Site: `setStatus` inside `createAutosaver`
([app/lib/project/autosave.ts](../../app/lib/project/autosave.ts)).

## The contract

| Requirement | Mechanism |
| --- | --- |
| Commit the internal status BEFORE notifying | `status = next` is the first statement; every observer (and everything after a throwing observer) reads committed state — proven by the dirty-state assertion running against a throwing dirty-observer |
| Notify from a stable snapshot | the listener SET is copied (`[...listeners]`) and the status value delivered is the committed `next` object created fresh per transition |
| Catch failures from each subscriber independently | per-listener `try/catch` inside the loop |
| Continue notifying remaining subscribers after one throws | the loop continues; proven with a thrower registered BEFORE a recorder that still receives `dirty → saving → saved` |
| Never rethrow into schedule()/run()/flush()/destroy()/debounce/settlement | the catch swallows; nothing after `setStatus` observes observer failure; process-level uncaught/unhandled captures asserted EMPTY across the suite incl. the debounce-timer path |
| Never include thrown subscriber values or secrets in persisted state or diagnostics | the catch binds nothing and records nothing — a hostile observer throwing a credential-bearing value has NO output channel (proven: settlement detail carries the authoritative save reason only) |
| Listeners added during notification do not run in that same cycle | the snapshot copy excludes them; they receive every LATER cycle (proven) |
| (Additional) listeners removed during notification are skipped | membership re-check (`listeners.has`) before each call — an unsubscribe taking effect mid-cycle is honored |

## Authoritative behavior under observer failure (all proven)

- A successful save executes EXACTLY once and `flush()` returns `true`
  even if observers throw at every transition; status ends `saved`.
- A failed save returns `false`, ends `error` with the authoritative
  reason, and stays pending, even if observers throw — and the retained
  write re-runs on the next flush/settlement.
- No observer can fabricate a false successful flush, strand status at
  `saving`, or emit an uncaught exception from the debounce timer.

## What observers still can do

Exactly what observers should: read every committed status transition,
in subscription order, with delivery guaranteed regardless of other
subscribers' behavior. `subscribe`'s unsubscribe function is unchanged.
