# B12.8 — pre-edit counterexample (verbatim)

Reproduced against PRODUCTION code before any edit with a disposable
probe (`app/lib/engineering/__tests__/__b128probe__.test.ts`, deleted
after capture; run: `npx vitest run … — 1 passed`), using the real
`createAutosaver` and `settleAutosaveForTransition`: a save callback
that increments a counter and SUCCEEDS; a subscribed listener that
throws when `status.state === "saving"`; pending work scheduled; two
settlements.

```
B12.8 OBSERVED: {"first":{"ok":false,"detail":"autosave flush threw: subscriber trap"},"afterFirst":{"state":"saving"},"second":{"ok":true},"afterSecond":{"state":"saving"},"calls":0}
```

Byte-identical to the independent verifier's observation. `setStatus`
notified listeners inline with no guard, so the OBSERVER's throw escaped
out of `setStatus({state:"saving"})` — a call that sits AFTER
`pending = false` and BEFORE `save()` — aborting `run()` in the exact
window B12.7 closed for hostile SAVE results. The healthy write never
executed (`calls: 0`), the pending state was lost, the next settlement
falsely reported `{ ok: true }`, and status stranded at `"saving"`.
B12.7's `pending`-before-`setStatus` ordering protected the FAILURE
path's restore; the "saving" transition itself remained an unguarded
observer call inside the loss window — a passive observer held veto
power over whether the user's work was saved at all.
