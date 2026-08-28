# AI Control Plane — B08.1: PCB Lifecycle-Generation and Retired-Session Hardening

> **[CORRECTED BY B08.2]** Independent verification of this stage
> confirmed the retired-history model and linearizable retirement but
> found two claims below FALSE as shipped: (1) "product editor code never
> authorizes" was only a convention — `authorizeBarePcbHistory` was a
> public export reachable from the engineering barrel, so ANY module
> could mint bare authority (and unauthorized-unbound refusals were
> mislabeled `session_retired`); (2) the async-ownership claim was
> incomplete — autoroute/auto-place/repair ran on digest pins and ambient
> single-flight flags WITHOUT lifecycle scopes, the lifecycle owner
> carried a partial identity (hardcoded `branchId: "main"`), and a
> same-digest checkpoint restore could not invalidate in-flight candidate
> work; the §3 wiring proof was a source-string assertion.
> `artifacts/ai-control-plane-b08-2/` implements the real boundary:
> internal test-only capability + CI import gate + route
> de-authorization + `canonical_authority_missing` taxonomy, and a
> full-identity generation-first `PcbBoardLifecycleOwner` with scoped,
> request-keyed, abortable producers and a dedicated reconciliation-
> notice boundary — all proven behaviorally.

## Why this stage exists

Independent B08 verification confirmed the canonical PCB mutation work but
found the lifecycle-safety acceptance claim FALSE. Four confirmed defects,
each reproduced by a failing test first:

1. **Retired mistaken for never-bound** — `dispose()` deleted the history
   from the active-session WeakMap; `commitPcbCandidate`/
   `applyEditsCanonical` read the missing binding as permission for the
   legacy whole-board fallback. The original B08 T15 asserted only
   `typeof result.ok` and deliberately did not compare board/history.
2. **In-flight commit published after disposal** — `runCommit` awaited
   `executor.execute()` and then applied the result to the delegate
   history without rechecking lifecycle ownership.
3. **`adoptBoardLifecycle` was not a boundary** — it only dispatched
   `set-board`; session disposal happened later in a React effect.
4. **Same-project stale adoption** — sync apply and qualification could
   adopt their returned board, write checkpoints/evidence/cache, and toast
   stale success after a same-project checkpoint restoration.

## The ownership model (implemented)

**History binding states** (`editor-adapter.ts`):
`active` (in SESSIONS) → `retired` (permanent RETIRED tombstone on
dispose) — never back; `unbound` = genuinely never canonical. Legacy
mutation authority exists ONLY for `unbound` histories explicitly
authorized via `authorizeBarePcbHistory` (planner/test compositions: the
server repair-agent route's throwaway history, and tests). Product editor
code never authorizes; active/retired histories can never be downgraded.
`commitPcbCandidate`, `applyEditsCanonical`, and the select/move legacy
branches all return structured `session_retired` refusals (zero board/
history/revision/envelope mutation) for retired or unauthorized histories.

**Linearizable retirement** (`CanonicalEditorSession`): queued work
refuses (existing `enqueue` gate); work already awaiting execution
rechecks `disposed` AFTER the executor await and BEFORE publishing —
`SESSION_RETIRED_IN_FLIGHT` structured refusal, no delegate publish, no
durable-envelope mirror (persistEnvelope also guards), no metadata
update; undo/redo reconciliation rechecks after its await too. A new
session is fully usable.

**Lifecycle-generation owner** (`PcbEditor`): a
`ProjectAsyncScopeRegistry` (B07.4 semantics reused — identity,
generation, request id, AbortSignal, timers) owned by the editor.
`adoptBoardLifecycle` SYNCHRONOUSLY runs the history cleanup (unsubscribe
+ tool destroy + session dispose → RETIRED), nulls
`historyRef`/`moveToolRef`, advances the generation, and only then
dispatches the replacement. Every non-edit board replacement flows
through it (hydration restores, server-authority adoption, sync adoption,
qualification adoption, checkpoint restore); unmount disposes the
registry; project change remounts (B07.5 key).

**Scoped producers**: `handleApplySync`, `handleQualify`, and the
hydration `loadBoard` resolution capture a lifecycle scope at submission
and verify it before EVERY side effect (adoption, authoritative cache,
working state, checkpoint, evidence, toasts). Autoroute/auto-place/repair
keep their base-digest pins + single-flight flags, and their board writes
now hit the retired-history refusal wall as defense in depth
(usePcbRepair additionally refuses via `serviceCurrent`).

**Server truth preserved**: PCB-sync CAS and release authority untouched.
When a stale scope learns the server DID commit (apply/qualify), local
adoption/cache/checkpoint/evidence/success are refused and an explicit
"applied on the server … reconcile" condition is surfaced — never
"canceled/unchanged", never a stale success toast, never an overwrite of
the checkpoint-restored board.

## Verification

- `b08-1-lifecycle-hardening.test.ts` — **8 passed** (exact digests,
  entry counts, reference identity, durable-envelope digest; includes the
  paused-in-flight retirement race and the explicit bare authorization).
- B08 T15 REPLACED with real zero-mutation assertions (the detached-
  mutation-accepting comment is gone).
- The B04+B06+B07+B08 gate: **291 passed** (the accepted 283 + 8 new).
- PCB component/domain sweep: green after moving inspector-commands and
  routing-rules-panel onto the explicit test authorization; remaining
  full-suite failures are the documented parallel-load flakes (all pass
  isolated — see the final report).
- `npx tsc --noEmit` clean; ESLint clean on changed files (pre-existing
  baseline unchanged).

## Corrected B08 claims

`artifacts/ai-control-plane-b08/README.md` and
`pcb-mutation-coverage.csv`/`b08-regression-fixtures.json` are corrected
in place: the pre-B08.1 lifecycle rows/claims were wrong exactly as the
verifier found (see the addendum markers there).
