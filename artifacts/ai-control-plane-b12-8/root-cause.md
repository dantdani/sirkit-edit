# B12.8 — root cause

## The unguarded observer call inside the loss window

```
const setStatus = (next) => {
  status = next;
  for (const listener of listeners) listener(status);   // ← unguarded
};

const run = () => {
  if (!pending) return true;
  pending = false;                 // ┐ the loss window
  setStatus({ state: "saving" });  // ┘ ← observer throw ESCAPES here
  … save() …                       //   never reached
```

`run()` calls `setStatus("saving")` between clearing `pending` and
executing `save()`. Any subscriber throw at that moment escaped `run()`
with `pending === false` and no save attempted: the write existed
nowhere, the next `flush()` truthfully saw "nothing pending" and
returned true, and no state transition ever completed (status stranded
`"saving"`).

## Why B12.7 did not close it

B12.7 made `run()` total against hostile SAVE RESULTS and hostile THROWN
VALUES from `save()` itself, and deliberately moved `pending = true`
BEFORE `setStatus` on the failure path so a throwing listener could not
reopen the loss window THERE. But the `"saving"` notification precedes
the save — there is no failure state to restore yet, and the observer
call itself was still a throw path. B12.7's verdict recorded exactly
this as PROPOSED follow-up ("hardening setStatus's listener loop against
throwing subscribers"); the independent verifier confirmed it is not a
hardening nicety but a data-loss defect: a subscriber — UI status
badges, telemetry, anything — could silently destroy pending work and
convert the transition settlement into a false success.

## The authority inversion

The autosaver's contracts make `flush()`'s boolean and the
`pending`/status pair the SINGLE source of truth that B12.6/B12.7 built
the transition boundary on. An unguarded observer loop made every
subscriber a silent co-author of that truth. The closure removes the
inversion structurally: observers see committed state and can affect
nothing else.
