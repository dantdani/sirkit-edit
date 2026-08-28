# B12.7 — coordinator recovery proof

Proven through the REAL `ProjectTransitionCoordinator` with the page's
exact hook composition
(`beforeInstall: () => settleAutosaveForTransition(autosaver)`) and the
real `createAutosaver` whose save THROWS the unstringifiable hostile
value (`b12-7-total-settlement.test.ts`, coordinator block):

| Required proof | Observed |
| --- | --- |
| The target does not install after the hostile first failure | install events stay `["A"]`; B's installer never invoked |
| Current-project pointer and visible project unchanged | both still `A` |
| Exactly one `transition-failed` outcome | `outcomes.length === 1`, typed status |
| The outgoing save remains pending | status `{error, "unrenderable thrown value"}`; save call count 1 |
| After the save callback heals, retry invokes it AGAIN before the target installs | call count 1 → 2 on the retry request, status → `saved`, THEN events become `["A","B"]` and the pointer/visible move to B with one `installed` outcome |
| No transition/interlock/lease/timer/status leak | `transitionPending` false after settlement; survivor interlock ACTIVE (a real commit lease acquired and released); the debounce timer was consumed by the flush; final state after recovery: active interlock, `transitionPending` false, status `saved` |

The B12.6 evidence (barrier compatibility — the settlement does not run
until a held lease releases; reentrant-callback retry) continues to hold
unchanged: the B12.6 suite runs green against the B12.7 autosaver, and
the B12.5 §D settlement-loop suites are untouched.
