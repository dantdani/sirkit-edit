# B07.5 — Recovery Decision Ownership

## The failure (CONFIRMED)

`resolveRecoveryKeepLocal`, `resolveRecoveryAdoptCanonical`, and
`resolveRecoveryStartFresh` each:

1. captured the recovery record and `schematicSessionRef.current` from
   project A;
2. invoked the asynchronous session recovery method;
3. let the user switch to project B;
4. applied the resolved outcome unconditionally — updating
   `schematicRecovery`, showing a toast, persisting a projection-conflict
   record, or calling `adoptCanonicalSchematic` with A's canonical state.

Project B's UI could therefore be replaced by A's canonical schematic,
its (unrelated) recovery dialog closed or repopulated, and its history/
selection reset. Nothing serialized duplicate clicks.

## The contract

ONE reusable adapter — `OwnedRecoveryDecisionAdapter`
(`app/lib/engineering/project-async-scope.ts`) — behind one shared page
entry point (`submitRecoveryDecision` in `app/page.tsx`); the three
handlers only supply `decide` and `applyOutcome`.

Submission-time identity requirements (all refused as
`refused-identity` BEFORE anything is submitted):

- a captured session must exist and equal `scope.session` (the session
  the active generation was begun with);
- `recovery.projectId` must equal `scope.projectId`;
- the scope must still be current.

In-flight rules:

- single-flight: a second click while a decision is in flight returns
  `refused-busy` and does NOT release or disturb the first decision's
  ownership; the dialog buttons are additionally `disabled` on
  `recoveryDecisionBusy`;
- completion classification: `applied` only when the scope's generation
  is still active; application additionally re-checks
  `schematicSessionRef.current === session` at the final boundary; ALL
  UI/persistence effects (dialog update/close, toast, projection
  adoption, `saveProjectFields` conflict record) live inside that gate;
- `stale-project`: the outcome (and any error) is ignored entirely. The
  DURABLE effect of the decision stands on its captured old-project
  session — quarantine-first semantics in the session methods are
  unchanged — and reopening that project surfaces the resulting
  canonical state through normal hydration/reconciliation;
- `failed` while current: a truthful toast; the dialog stays open for
  retry or another choice (B06.3 unchanged).

Transition reset (`resetTransientProjectState`):
`recoveryDecisionAdapterRef.current.reset()` releases decision
ownership, `setRecoveryDecisionBusy(false)` re-enables buttons,
`setSchematicRecovery(null)` clears the dialog — all AFTER
`beginProject` already staled the old generation.

Defense in depth: `adoptCanonicalSchematic` itself now refuses any
session that is not the active mounted session, so even a hypothetical
bypass of every upstream check cannot invalidate the current project's
gesture coordinator or replace its projection/history.

## Tests (b07-5-async-ownership-closure.test.ts §1)

- T1/T2/T3 — adopt-canonical / keep-local / start-fresh begun in A and
  resolved after switching to B change nothing in B (dialog, toast,
  adoption, persistence, busy state, B's session lifecycle).
- T4 — a late A outcome neither closes nor repopulates B's dialog even
  when B hydrated clean.
- T5 — duplicate clicks: exactly one owned decision; busy follows the
  first.
- T6 — no-switch adopt-canonical end-to-end: dialog closes, projection
  adopts, conflict record persists, session becomes ready.
- T6b — identity mismatches (foreign recovery record, foreign session)
  refuse before submission.
