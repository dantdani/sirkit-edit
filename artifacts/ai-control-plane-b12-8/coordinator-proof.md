# B12.8 — coordinator proof

Proven through the REAL `ProjectTransitionCoordinator` with the page's
exact hook (`beforeInstall: () => settleAutosaveForTransition(autosaver)`)
and TWO hostile subscribers attached to the real autosaver (one throwing
on `"saving"`, one throwing on every state):

| Required proof | Observed |
| --- | --- |
| A throwing observer cannot prevent the outgoing save from executing | the save ran exactly once (`calls 1`; pre-B12.8: 0) and status ended `saved` |
| The target installs only AFTER the save actually succeeds | one `installed` outcome; install events `["A","B"]` with the save-call increment strictly first |
| A REAL save failure still blocks the target | with the save failing `quota`: one `transition-failed`, events stay `["A"]`, status `{error, "quota"}`, pending retained (`calls 1`) — the refusal is the SAVE's, not the observer's |
| Recovery retries the retained write before installation | after healing: `calls` 1 → 2, status `saved`, THEN `["A","B"]` with one `installed` outcome |
| Exactly one terminal outcome per request | asserted on both the refusal and both installs |
| No interlock, lease, timer, transition, pending, or status leak | `transitionPending` false after every settlement; the survivor interlock ACTIVE with a real lease acquired/released; the debounce timer consumed by the flush; final states `saved`/active |

The B12.6 barrier/reentrancy compatibility evidence and the B12.7
hostile-thrown-value coverage run unchanged against the B12.8 autosaver
(B12 family 195/195).
