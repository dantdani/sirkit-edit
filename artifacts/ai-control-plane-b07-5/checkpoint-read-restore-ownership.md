# B07.5 — Checkpoint Read / Restore / Creation Ownership

## The failures (CONFIRMED)

1. `refreshCheckpoints()` and checkpoint loading inside
   `hydrateProject()` both ran
   `checkpointStore().list(projectId).then(setCheckpoints)` ambiently: a
   slower project-A promise resolving after a switch replaced project
   B's checkpoint list, presenting A's checkpoints in B's history dialog
   — from which `restoreCheckpoint` would happily adopt A's schematic
   and board into B (it verified readiness, not identity).
2. The B07.2 regression: the page no longer evaluated
   `consumer: "checkpoint"` anywhere, so the generation-checkpoint write
   had no readiness/recovery gate of its own.

## The read contract (lists)

`refreshCheckpoints` (the ONLY list producer; hydration calls it after
its intentional reset):

- captures a `ProjectAsyncScope` and refuses if the registry's project
  is not the requested id;
- runs through a `LatestRequestGate`: only the NEWEST request of the
  CURRENT generation may apply; stale-generation results AND errors are
  ignored; older same-generation requests are `superseded`;
- applied rows are additionally filtered with
  `checkpointBelongsToProject(row, id)` — a store that somehow returned
  foreign rows still cannot surface another project's checkpoint;
- a failure while current-and-newest resets the list to the intentional
  empty state.

Hydration order: `beginProject` (stales the old generation) →
`resetTransientProjectState` (`setCheckpoints([])`,
`setHistoryOpen(false)` — no stale row can be clicked) → …
`refreshCheckpoints()` under the NEW generation.

## The restore contract

`checkpoint.projectId` is already mandatory on `ProjectCheckpoint`
(B07.4); B07.5 adds `checkpointBelongsToProject` and enforces it at BOTH
boundaries:

- entry: a mismatched checkpoint is refused with a truthful toast before
  any gate, adoption, or mutation;
- adoption: the coordinator `stillCurrent` predicate re-checks
  `restoreScope.isCurrent()` + active-project id + the identity
  predicate — a mismatched object that somehow reaches
  `restoreCheckpoint` (stale render, late callback, forged object) is
  canceled by the coordinator with NO schematic, PCB, chat, dialog,
  history, or storage change. React state having been cleared is never
  relied on.

The transactional shape (B07.3 — adoption first on the captured
session, then UI/chat/board/persistence inside `onAdopted`) is
unchanged.

## The creation contract (generation checkpoints)

Inside `applySchematic`'s `onAdopted` (the only checkpoint producer for
generations), immediately before `checkpointStore().add`:

- `evaluateSchematicConsumerGate({ lifecycle: session?.lifecycle …,
  recoveryPending: …, consumer: "checkpoint" })` on the CAPTURED
  session — never an ambient ref;
- `scope.isCurrent()` — the captured owning generation must still be
  active;
- the write uses the exact adopted candidate and the captured project
  (B07.4 unchanged); if the gate refuses, the checkpoint is silently not
  written — the adoption itself stands;
- success/failure notifications remain `scope.ifCurrent`-gated.

This restores the B07.2 page gate (`consumer: "checkpoint"`) as a
genuine behavioral readiness contract, not a string.

## Tests (b07-5-async-ownership-closure.test.ts §2–§4)

- T7 — an A list (or A error) resolving after the switch cannot touch
  B's list.
- T8 — an older same-generation request cannot overwrite a newer
  refresh.
- T9/T9b — hydration resets the list intentionally; applied reads are
  identity-filtered.
- T10 — the identity predicate refuses mismatched/empty/null ids.
- T11 — a mismatched checkpoint at the ADOPTION boundary: canceled, no
  canonical write, no UI application, no `onAdopted`.
- T12 — a current-project restore still succeeds transactionally.
- T13/T13b — the checkpoint write decision is refused for every
  non-ready lifecycle, pending recovery, and stale scope; the page
  evaluates it on the captured session inside `onAdopted`.
- The previously failing B07.2 gate is green (14/14).
