# B12.6 — truthful autosave settlement at the project-transition boundary

Corrective stage over B12.5, closing the one production-composition
defect the independent verifier found: page.tsx's
`ProjectTransitionCoordinator.beforeInstall` called
`autosaverRef.current?.flush()` and DISCARDED its boolean —
`Autosaver.flush()` reports failure by return value (false, save kept
pending, status `error`), never by throwing, so the hook's try/catch was
unreachable protection and a failed retiring-project save was silently
classified successful: the replacement installed, became current, and
took the pointer over unpersisted outgoing work.

Closure: `settleAutosaveForTransition(autosaver)` — a small, hook-free
production helper in [app/lib/project/autosave.ts](../../app/lib/project/autosave.ts)
that treats BOTH a false return and an exception as typed transition
failure with bounded, secret-redacted detail (preferring the autosaver's
own recorded error detail), and `{ ok: true }` for a missing autosaver
or no pending work. page.tsx's `beforeInstall` IS this helper
(source-gated); the coordinator's existing B12.4/B12.5 failure semantics
then guarantee the target never installs, the pointer never moves, and
the survivor is reactivated with a fresh ACTIVE interlock. A failed
flush leaves the save PENDING (the autosaver's own contract), so a retry
after storage recovers persists the survivor's work BEFORE any
replacement installs.

Documents: [pre-edit-counterexamples.md](pre-edit-counterexamples.md) ·
[root-cause.md](root-cause.md) ·
[implementation-contract.md](implementation-contract.md) ·
[transition-state-evidence.md](transition-state-evidence.md) ·
[test-evidence.md](test-evidence.md) ·
[invariant-preservation.md](invariant-preservation.md) ·
[changed-files.md](changed-files.md) ·
[unknowns-and-deviations.md](unknowns-and-deviations.md) ·
[verdict.md](verdict.md)
