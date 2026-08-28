# B12.6 — transition-state evidence (real coordinator path)

All proven in `b12-6-autosave-settlement.test.ts` with the REAL
`createAutosaver` (real failure behavior — no mocked booleans), the REAL
`ProjectTransitionCoordinator`, the production `markProjectCurrent`
pointer commit inside the install bodies, and the page's exact hook
composition (`beforeInstall: () => settleAutosaveForTransition(autosaver)`).

## On settlement failure (quota-failing save pending on the survivor)

| Required proof | Observed |
| --- | --- |
| Target installer never invoked | `events` stay `[A]` — B's install body never ran |
| Current-project pointer unchanged | `currentProjectId()` still A (the pointer commit lives inside the never-invoked install body — B12.5 §C ordering untouched) |
| No target history/session/projection/UI adoption | harness `visible` stays A; nothing from B's prepare/commit ever executed |
| Survivor active and usable again | `currentInterlock()` is a FRESH ACTIVE interlock (B12.4 §D reactivation, post-barrier); a real commit lease is acquired and released |
| Exactly one terminal outcome | one `transition-failed` with bounded detail (`…could not be saved: quota`), no `recovery` flag (pre-install failure — nothing half-adopted) |
| No null-interlock window | `currentInterlock()` non-null at every observation point |
| No lease/timer/transition-pending leak | `transitionPending` false after settlement; the autosaver's debounce timer was consumed by `flush()`; no lease outstanding |
| Failed save retained | autosaver status `{state:"error", detail:"quota"}` with the write still pending |

## Recovery

After storage recovers, re-requesting B first re-runs A's pending save
(save call count increments; status → `saved`) and only then installs B
(`events [A, B]`, pointer → B, one `installed` outcome). Order proven:
the save-call increment happens before B's install body pushes its
event.

## Composition with B12.5 §D

- **Barrier compatibility:** with a commit lease held on A's interlock,
  the settlement (and its save attempt) does not even run until the
  barrier settles — `saveCalls` stays 0 during suspension,
  `transitionPending` truthfully true; after release the settlement
  refuses, the survivor is reactivated fresh-ACTIVE, exactly one
  outcome.
- **Reentrant-callback compatibility:** a retry requested INSIDE the
  `transition-failed` outcome callback (after healing storage) proceeds
  as a normal cycle: A's work persists (`saved`) before B installs;
  outcomes `[B1:transition-failed, B2:installed]`.
