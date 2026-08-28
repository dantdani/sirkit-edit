# B06.2 — Hydration Readiness Contract

Closes the hydrate/edit race: B06.1 installed the SavedProject projection,
started `openForProject` asynchronously, and left editing enabled — a click
captured against the stale visible state could later be classified as legacy
divergence and rebase the canonical store backward.

## Session lifecycle

```
unopened ──openForProject()──▶ hydrating ──▶ ready
                                   │  ╲
                                   │   ╲ recovered-canonical → (adoption handshake) → ready
                                   ├──▶ conflicted  (explicit recovery choice required)
                                   └──▶ unavailable (durable storage cannot open)
```

- The session flips to `hydrating` SYNCHRONOUSLY when `openForProject` is
  called — before any store I/O — so there is no window in which a command
  can slip past the gate.
- `execute()` checks the lifecycle synchronously at CALL time (and again
  inside the queue): anything but `ready` returns a truthful structured
  rejection (`session_not_ready` — “schematic history is loading”,
  `session_conflicted`, `session_unavailable`). Rejected commands never
  enter execution, never rebase, never mutate.
- `reconcileHistoryStep` is a no-op unless `ready`.

## Adoption handshake

When canonical recovery wins (`recovered-canonical`), the session stays
non-ready until the UI PROVES adoption: `confirmAdoption(state)` succeeds
only when the adopted state's digest equals the recovered head projection.
Until then `headMark()` is null (autosave cannot pair a stale projection
with an adopted-looking mark) and every command is rejected. The superseded
projection's digest enters a permanent stale set: even after readiness, a
command built on the pre-recovery snapshot is rejected with
`STALE_PRE_RECOVERY_SNAPSHOT` — it can never trigger a backward rebase.

## Project switching

`dispose()` marks the session `unavailable`, rejects every queued task, and
the page guards every async callback with a session-identity check. A
pending AI proposal and any pending recovery dialog are discarded on
hydration/switch (`setPendingTier1(null)`, `setSchematicRecovery(null)`).

## Serialized delete/replacement planning

Delete and BOM-replacement impact plans are now built INSIDE
`buildOperations`, against the canonical schematic handed to the command at
its serialized execution position (only static catalog pin/part data is
fetched beforehand). A queued delete or swap therefore executes a plan
computed on the current head — never on the snapshot captured at click time.
Sealed-proposal applies additionally pin `expectedBaseDigest`, re-verified
inside the queue. Rapid edit+delete and edit+replace pairs are tested to
preserve the earlier edit with zero rebases.

Tests: `__tests__/b06-2-authority-hydration.test.ts` §3 (deferred-store
hydration timing, stale-click refusal, adoption gating, disposal) and §4
(rapid delete/replacement).
