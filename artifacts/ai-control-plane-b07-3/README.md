# AI Control Plane — B07.3: Atomic Schematic Adoption, FIFO Command Execution, and Async Project-Epoch Isolation

> **ADDENDUM / SUPERSESSION (B07.4, 2026-08-07).** Independent post-stage
> verification CONFIRMED this stage's FIFO/adoption core (it is unchanged
> and its suites remain green) but found the PROJECT scoping around it
> incomplete, and **B07.4 (`artifacts/ai-control-plane-b07-4/`) supersedes
> this stage's readiness verdict**: (1) `pendingSuggestions` was an
> unscoped bare array that survived project switches — Apply Suggestions
> could drive a mutation of project B from project A's findings; (2) a
> stale generation response could still open the replacement dialog over
> another project (the pin was checked only at final application); (3) the
> post-generation checkpoint ran on an ambient 600 ms `setTimeout` that
> re-read `projectRef`/authoritative state at fire time — A's checkpoint
> could be written into B; (4) catalog preflights (KiCad delete, BOM swap)
> awaited part data and then submitted to `schematicSessionRef.current`,
> retargetable to another project's same-ID components; (5) tier-1
> provider output was compiled and sealed against RESPONSE-time state — a
> silent unreviewed rebase; (6) busy flags, provider errors, retries,
> `lastDesignPrompt`, chat message ids, and the auto-pipeline timer were
> ambient across projects. B07.4 added the `ProjectAsyncScope` ownership
> mechanism, an explicit tested project-transition reset, and per-failure
> pinning. Where this stage's async matrix claimed complete stale-response
> handling for those paths, the corrected rows live in
> `artifacts/ai-control-plane-b07-4/deferred-effect-ownership.csv`. The
> report below is preserved verbatim as the historical record.

## Executive summary

Independent B07.2 verification found three remaining consistency races:
concurrent ordinary commands could BOTH commit durably while the later UI
adoption was discarded as "stale" (splitting the visible state from the
durable canonical head), lifecycle replacements RENDERED their candidate
before canonical adoption succeeded (an invalid AI result stayed visible
over a still-ready session holding the old head), and asynchronous
AI/advisory work carried no project/base pinning (late responses could land
in the wrong project or overwrite newer edits). B07.3 replaces the
independent-promises-plus-epoch-discard model with ONE explicit FIFO
interaction queue (commands, gesture commits, lifecycle adoptions, undo/
redo), a transactional lifecycle-adoption gateway (validate → canonical
adoption → only then UI/extras), transactional undo/redo (reconcile first,
cursor and projection after success), and immutable invocation contexts
(project token + exact authoritative base digest) for every asynchronous
schematic producer and advisory consumer. No mutation tool was exposed; no
B06/B07 gate was weakened.

## Pre-fix reproductions (all CONFIRMED by execution or source before fixing)

1. **Concurrent commands split durable and UI state (A).** Two commands
   submitted together: A `applied`, B `discarded-stale`; durable head
   sequence 2 (BOTH commands committed); the visible state showed only A's
   effect and its digest no longer matched the durable head — exactly the
   independent reproduction (`statusA: completed, statusB: discarded-stale,
   durableCommits: [A, B]`). Reproduced by an automated test before the fix.
2. **Lifecycle candidates rendered before adoption (B).** The B07.2 page
   order (invalidate → apply UI + authoritative mirror → adopt async →
   toast on failure) let an INVALID candidate with two components stay
   visible and authoritative while the still-`ready` session held the
   one-component head. Reproduced by an automated harness test mirroring
   the page order.
3. **Unpinned async work (C).** CONFIRMED by source: `/api/chat`
   `schematicState`, the tier-1 edit summary, the topology-edit netlist,
   design review, layout critic (plus its LIVE-SVG screenshot), and
   cross-verify all read the VISIBLE arrays (preview-reachable), and their
   result writers (`setMessages` appends, `setPendingSuggestions`,
   `setPendingTier1`) had no project association.

## Root causes

- B07.2's gateway ran commands as independent promises and discarded any
  completion whose projection epoch had advanced — but every successful
  adoption advanced that epoch, so the second of two concurrent commands
  was always discarded AFTER its durable commit.
- Lifecycle handlers applied optimistic UI updates and treated canonical
  adoption as a background follow-up.
- Async handlers captured nothing at invocation time: at response time they
  read and wrote whatever project/state happened to be current.

## The serialization model (implemented)

See `interaction-serialization-contract.md`. In one line: **everything that
can advance or replace the canonical schematic is a FIFO job on one queue;
a job reads the LATEST authoritative base at execution position and applies
its own result before the next job starts; staleness is project/session
staleness only (invalidate/dispose or an explicit project token), never
"another command got there first".**

## The lifecycle adoption transaction (implemented)

See `lifecycle-adoption-transaction.md`. Every lifecycle replacement (AI
generation/apply, topology apply, tidy apply, checkpoint restore,
sheet-size change) flows through `SchematicGestureCoordinator.adoptLifecycle`:
epoch + project-token check → gesture-preview refusal → exact-base pin
check → full identity/geometry validation → canonical adoption
(quarantine-first, typed `SchematicLifecycleAdoptionResult` codes, on the
CAPTURED session) → token re-check → ONLY THEN `applyUi` + `onAdopted`
extras (history label, chat, checkpoint payload, PCB restore, page size,
dialogs, success message). Structured outcomes: `adopted`,
`rejected-invalid`, `rejected-conflicted`, `persistence-failed`,
`canceled-stale-project`, `canceled-stale-base`, `unavailable`,
`refused-busy`. There are no optimistic authoritative updates left; no
direct `adoptLifecycleProjection(...).then(...)` remains in page handlers.

## Undo/redo (implemented)

`SchematicHistory.peekUndo/peekRedo` determine the target WITHOUT moving
the cursor; `SchematicEditorSession.reconcileHistoryStep` now returns a
truthful `{ok, detail}` (verified replay, documented reconcile-rebase, or a
failure that changed nothing); the coordinator's `runHistoryStep` job
reconciles FIRST and moves the cursor + applies the projection only on
success, blocking gestures and commands until the durable reconciliation
settles. Failures surface as structured messages and leave cursor,
projection, authoritative state, and canonical head unchanged.

## Async project-epoch isolation (implemented)

Every asynchronous schematic producer captures an immutable invocation
context (`captureLifecycleInvocationContext`: projectId + session closure +
authoritative base digest) BEFORE its request; adoption is pinned with
`expectedBaseDigest` + `stillCurrent` (project token — the coordinator
epoch alone cannot see a submission that happens after a switch). Advisory
consumers (chat, review, cross-verify, tidy) read ONE validated
authoritative snapshot, never the visible arrays; tidy additionally REFUSES
while a gesture owns the preview (its screenshot captures the live canvas);
result writers go through `appendChatFor(projectId, …)` and
digest-checked suggestion gates, so stale findings are labeled as snapshot
reviews and never presented as current suggestions; a tier-1 proposal
prepared for another project is discarded, not surfaced. The auto
tidy→review pipeline is pinned to the project that scheduled it. The full
per-handler audit is `async-project-epoch-matrix.csv`.

## Changed files and symbols

- `app/lib/engineering/schematic-gesture-coordinator.ts` — FIFO `enqueue`
  queue; `runCanonicalCommand` (adoption inside the job; outcomes
  `applied/noop/rejected/refused-gesture-active/canceled-stale/failed`);
  `adoptLifecycle` transactional gateway (+ `stillCurrent` project token);
  `runHistoryStep`; `busy`; project-epoch-only staleness; `begin()`
  refuses while the queue is busy.
- `app/lib/engineering/schematic-session.ts` — typed
  `SchematicLifecycleAdoptionResult` codes on `adoptLifecycleProjection`;
  `reconcileHistoryStep` returns truthful outcomes (quarantine-blocked
  rebases and stale/invalid targets are failures that change nothing).
- `app/lib/project/schematic-history.ts` — `peekUndo`/`peekRedo`.
- `app/page.tsx` — `runSchematicCommand` on the queue contract;
  transactional `runHistoryStep` undo/redo; `applySchematic` rewritten as a
  gateway transaction with invocation pins (generation, topology edit,
  tidy, pending-replace all pass pins); transactional `restoreCheckpoint`
  (readiness-gated, everything including PCB/chat/dialog/success only in
  `onAdopted`); transactional `changeSheetSize` (UI value changes only
  after adoption); authoritative+validated chat snapshot (omitted when
  invalid); review/cross-verify/tidy snapshots + digest/project-gated
  results; `appendChatFor`; project-pinned auto pipeline.
- Tests — new `__tests__/b07-3-serialization.test.ts` (20); B07.2 suite
  updated to the queue contract (T8/T9 now FIFO-applied, T11
  canceled-stale); B07.1 §D fake-host tests updated to the queue model
  (D2's premise is impossible by construction and now tests the lifecycle
  variant).

## Test commands and results (2026-08-07, repo root)

```
npx vitest run app/lib/engineering/__tests__/b07-3-serialization.test.ts   # PASS (20)
npx vitest run app/lib/engineering/__tests__/b07-2-interaction-interlock.test.ts \
               app/lib/engineering/__tests__/b07-1-identity-geometry-gestures.test.ts \
               app/lib/engineering/__tests__/b07-graph-gestures.test.ts    # PASS (14 + 38 + 19)
npx vitest run app/lib/engineering app/lib/pcb app/lib/spice app/lib/project app/api lib
   # 1911 passed, 19 skipped; 4 timing-budget failures (auto-place,
   # compute-fill, pcb-repair-agent, route-tool) — ALL pass in isolation
npx vitest run                                                             # see final report
npx tsc --noEmit                                                           # PASS
npx eslint <changed files>                                                 # PASS (page.tsx pre-existing findings only)
```

## Remaining UNKNOWN items

- The screenshot-based tidy flow refuses during previews and captures while
  the render equals the authoritative snapshot; a render that lags React by
  a frame at capture time would still be a faithful-but-momentary variance
  (UNKNOWN practical exposure; the state payload itself is always the
  authoritative snapshot).
- `send()` chat streaming appends are id-keyed (inherently project-safe);
  the initial user/log/assistant append happens synchronously at submit —
  no known gap, listed for completeness.
- Whether any field data exercises the `canceled-stale-base` path in
  practice (expected rare; the paths are test-pinned).

## B08 readiness

With FIFO execution, transactional adoption, transactional undo/redo, and
project/base pinning in place — and every B06/B07 gate green — the
schematic semantic-control layer is consistent under concurrency. B08 is
safe to begin once the owner authorizes it.
