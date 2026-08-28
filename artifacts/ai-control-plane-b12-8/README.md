# B12.8 — failure-isolated autosave observers

Corrective stage over B12.7, closing the last autosave-layer authority
leak: `setStatus` notified subscribers inline with no guard, so a
listener throwing on the `"saving"` notification — which fires AFTER
`pending = false` and BEFORE `save()` — aborted `run()`, the healthy
write never executed (`calls: 0`), the pending state was lost, the next
settlement falsely reported success, and status stranded at `"saving"`.
A passive OBSERVER held veto power over whether the user's work was
saved.

Root requirement enforced: **status subscribers are observers, never
mutation authorities.** `setStatus` now commits the internal status
first, notifies from a stable snapshot (reentrant additions excluded
from the current cycle, mid-cycle removals skipped), catches each
subscriber independently, keeps delivering to the remaining subscribers,
never rethrows into `schedule()`/`run()`/`flush()`/`destroy()`/the
debounce callback/transition settlement, and gives thrown subscriber
values NO output channel (not recorded in status, diagnostics, or
persisted state).

Documents: [pre-edit-counterexamples.md](pre-edit-counterexamples.md) ·
[root-cause.md](root-cause.md) ·
[observer-isolation-contract.md](observer-isolation-contract.md) ·
[retained-pending-proof.md](retained-pending-proof.md) ·
[coordinator-proof.md](coordinator-proof.md) ·
[test-evidence.md](test-evidence.md) ·
[invariant-preservation.md](invariant-preservation.md) ·
[changed-files-and-deviations.md](changed-files-and-deviations.md) ·
[verdict.md](verdict.md)
