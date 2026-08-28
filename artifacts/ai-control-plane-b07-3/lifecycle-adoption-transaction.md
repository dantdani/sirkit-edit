# B07.3 — Lifecycle Adoption Transaction

Every lifecycle replacement — AI/generated schematic apply, topology-edit
apply, auto/manual tidy apply, checkpoint restore, sheet-size change — runs
through `SchematicGestureCoordinator.adoptLifecycle` as ONE queued
transaction. The B07.2 order (invalidate → render → adopt async → toast)
is gone; nothing is rendered, persisted, checkpointed, or reported as
successful before canonical adoption succeeds.

## Transaction steps (in order, inside one FIFO job)

1. **Capture** (at request submission, and for async producers at
   INVOCATION time via `captureLifecycleInvocationContext`): projectId,
   session closure, authoritative base digest.
2. **Project/epoch check** — stale (coordinator epoch or `stillCurrent()`
   project token) → `canceled-stale-project`, nothing ran.
3. **Gesture policy** — active preview → `refused-busy` (never silently
   invalidated and overwritten).
4. **Exact-base pin** — `expectedBaseDigest` (captured before the producing
   request) no longer matches the authoritative digest →
   `canceled-stale-base`: the result is surfaced as stale; the project is
   left unchanged; machine output is never silently rebased.
5. **Validation** — the complete candidate must pass the shared canonical
   identity + geometry contract → `rejected-invalid` otherwise.
6. **Canonical adoption** — `session.adoptLifecycleProjection` on the
   CAPTURED session (quarantine-first B06.3; typed failure codes map to
   `rejected-conflicted` / `unavailable` / `canceled-stale-base` /
   `persistence-failed` / `rejected-invalid`).
7. **Token re-check** — a switch during adoption leaves the old session's
   durable adoption intact but never touches the new project's UI →
   `canceled-stale-project`.
8. **Only now**: `applyUi` (one of the two approved projection appliers —
   canonical, with a history label, for undoable replacements; lifecycle
   for sheet-size) and `onAdopted` extras: chat append, auto-run token,
   selection/tool reset, checkpoint scheduling, page-size value, checkpoint
   chat + pcbWorking write + PCB hydration + "Restored" toast + dialog
   close.

On ANY failure or stale token: the prior projection, authoritative mirror,
history cursor, chat, PCB, page size, and stored project remain unchanged,
and the structured reason is surfaced (`setGenError`/toast) — except
`canceled-stale-project`, which is intentionally silent in the NEW project.

## Per-flavor notes

| Flavor | Pin | applyUi | onAdopted extras |
|---|---|---|---|
| AI generation (`handleGenerateSchematic`) | captured before the fetch; travels with the pending-replace confirmation dialog | canonical (`Generated schematic: …`) | auto-run token, page size, selection/tool reset, chat, delayed checkpoint |
| Topology edit (tier-2) | same pin as the edit invocation | canonical (`Applied AI edit`) | as above, `skipAutoRun` for suggestion applies |
| Tidy | pin captured before the screenshot; ALSO refused while a preview is active or the queue is busy (the screenshot captures the live canvas) | canonical | suppressed-chat/silent auto mode |
| Checkpoint restore | readiness gate (`edit`) first — also NOT a recovery bypass; project token | canonical (`Restored checkpoint: …`) | page size, checkpoint chat, pcbWorking write + board restore + PCB hydration, toast, dialog close |
| Sheet size | project token | lifecycle (not undoable) | `setPageSize` — the controlled UI value changes only after adoption |

## Undo/redo transaction

`runHistoryStep`: peek target (`SchematicHistory.peekUndo/peekRedo`, cursor
untouched) → `session.reconcileHistoryStep` (verified replay or documented
reconcile-rebase; quarantine-blocked or invalid/stale targets FAIL with
nothing changed) → epoch re-check → cursor move (`undo()/redo()`) →
projection apply. The job blocks gestures and commands until settlement.
Outcomes: `applied` / `noop` / `refused-busy` / `canceled-stale` /
`failed` (structured, displayed).
