# B07.3 — Schematic Interaction Serialization Contract

## One FIFO queue

`SchematicGestureCoordinator` owns ONE promise-chained FIFO queue. Every
canonical mutation path is a job on it:

| Job | Entry point | Outcome type |
|---|---|---|
| Ordinary canonical command | `runCanonicalCommand({label, execute})` | `applied` / `noop` / `rejected` / `refused-gesture-active` / `canceled-stale{stage}` / `failed` |
| Gesture commit | `commit(label, finalGraph)` (preview ownership releases synchronously at pointer-up; the commit body is a job) | rollback/adoption via host + notify |
| Lifecycle adoption | `adoptLifecycle(request)` | `adopted` / `rejected-invalid` / `rejected-conflicted` / `persistence-failed` / `canceled-stale-project` / `canceled-stale-base` / `unavailable` / `refused-busy` |
| Undo/redo | `runHistoryStep(request)` | `applied` / `noop` / `refused-busy` / `canceled-stale` / `failed` |

## Required properties (each pinned by a test)

- **FIFO within one project/session.** Jobs run strictly in submission
  order; a queued job obtains the LATEST authoritative base when it reaches
  execution position, never its submission-time base. *(§1 tests 1–2)*
- **Adoption inside the job.** A command's canonical result is applied to
  the visible projection + authoritative mirror INSIDE its job, so job N+1
  starts only after job N's result is authoritatively applied, and the
  visible authoritative state equals the durable head after queue
  settlement. **No committed result is ever discarded for the active
  project** — the B07.2 epoch-discard model is gone. *(test 1)*
- **Failures release the queue.** A rejected/failed job changes nothing and
  the next job executes against the unchanged authoritative head. *(test 3)*
- **Sealed bases stay sealed.** A digest-pinned command (tier-1 apply)
  queued behind another mutation rejects `stale_revision`
  (EXPECTED_BASE_DIGEST_MISMATCH) at the session — the fresh-base rule
  never rebases a sealed proposal. *(test 4)*
- **Project staleness only.** `invalidate()` (project switch, hydration,
  recovery, disposal) bumps the project epoch. A queued job that reaches
  execution position stale is CANCELED before running
  (`canceled-stale{stage:"before-execution"}`); a job whose epoch goes
  stale mid-flight keeps its (captured old-session) durable effect but
  never touches the new project's UI
  (`canceled-stale{stage:"after-commit"}`). *(tests 5–6)*
- **Gesture exclusivity.** `begin()` refuses while a preview is active, a
  commit/command/adoption/history job is queued or running (`busy`), or
  the coordinator is disposed; commands/adoptions/history jobs refuse while
  a preview is active (`refused-gesture-active` / `refused-busy`) — the
  user's drag is never silently invalidated. *(B07.2 §1, B07.3 §2 test 17)*
- **No deadlocks.** A gesture commit followed by an ordinary command is
  plain FIFO (the B07.2 wait-loop is gone); undo/redo jobs block gestures
  and commands until durable reconciliation settles, then release. *(test 20)*
- **No check-then-act races.** Refusal checks live INSIDE the queued job at
  execution position; preview ownership transitions are synchronous;
  `runExclusiveSync` remains for synchronous entry points.
- **Queue cleanup.** `dispose()` (unmount) and `invalidate()` orphan every
  queued job's UI effects; the chain itself always settles (rejections are
  swallowed by the chain but returned to each caller).

## Session-level defense (unchanged from B07.2, still pinned)

`SchematicEditorSession.execute` refuses unknown base projections
(`stale_revision` / `UNKNOWN_BASE_PROJECTION`); legacy interactive
rebasing does not exist. Lifecycle rebases happen only through the typed
`adoptLifecycleProjection` (now returning
`SchematicLifecycleAdoptionResult` codes: `adopted` / `already-canonical` /
`not-ready` / `no-service` / `stale-superseded` / `invalid` /
`quarantine-failed`).
