# B08.2 — Async Producer Ownership Matrix (PCB board lifecycle)

> **[CORRECTED BY B08.3]** This matrix OMITTED `handleSync` — the main
> multi-stage sync preparation (bindings → publication → snapshot-revision
> persistence → preflight → plan/progress/dialog/toast) ran with NO
> lifecycle scope and no post-await ownership checks. The sync-apply and
> qualification rows also overstated ownership: their busy flags were
> ambient booleans (`applyingRef`+`applying`, `qualifying`, plus
> `syncing`) with unconditional finalizers, and their handler wiring was
> not behaviorally tested (only `settleServerCommit` mechanics were).
> B08.3 (`../ai-control-plane-b08-3/`) closes all of it: the
> `PcbOwnedOperationRegistry` request-owned busy records, the
> `runOwnedSyncPreparation` workflow, the shared
> `runVerifiedServerAdoption` workflow (which also adds the missing
> qualification revision/digest/identity verification), and 13 behavioral
> race tests against the production controller.

Owner: `PcbBoardLifecycleOwner` in `PcbEditor` (`pcbLifecycleRef`), full
identity `{tenantId, projectId, branchId, boardId}` from the durable sync
scope (local sentinel for demo/local). `adoptBoardLifecycle` =
synchronous session retirement → `owner.adopt(identity)` (generation++,
signal abort) → `lifecycleGeneration` bump → dispatch. GENERATION is the
staleness authority; digest pins only narrow.

| producer | scope capture | signal wiring | busy keying | side effects gated after every await | on lifecycle replacement | test |
|---|---|---|---|---|---|---|
| autoroute (`useAutoroute.run`) | at submission | `scope.signal` → fetch AbortController | `activeRef {requestId, isCurrent}` — stale generation never blocks a new run; only the owning request releases | queued/running state, elapsed timer ticks, result/state, error/state, all toasts, commit SUBMISSION itself | fetch aborted; `invalidate()` discards result/error/busy silently | 6, 7 |
| auto-place (`useAutoPlace.run/apply`) | at submission AND at apply | `scope.signal` → worker `terminate()` (via cancelRef) | `activeRef` request-keyed (as above) | progress writes (interval + worker progress), preview candidate publication, result/state, error/state, toasts, apply completion callbacks | worker terminated; candidate carries its scope → `apply()` refuses stale preview EVEN with an identical digest; `invalidate()` clears candidate/progress/busy | 8, 9 |
| repair (`usePcbRepair.createPlan/previewFixes/applyPreview/undoLast`) | per operation | `scope.signal` → operation AbortController (fetches take controller.signal) | controller-keyed progress (`stopProgress(controller)`), progress ticks owned-gated | plan/preview state, progress, errors, toasts, `onApplied`, native-fallback planning refusal when stale | aborted; `invalidate()` discards plan/preview + service refs silently; `serviceCurrent` history-identity guard retained as defense in depth | 10, 11 |
| AI assist (AssistBox) + net-class briefs | per request (`assistOwnership`: page B07.5 generation AND board lifecycle scope) | n/a (ownership refusal) | component busy (aliveRef) + remount | pending chip, notices, provider-failure retries, apply completion | stale responses discarded; `key={assist-generation-N}` remount drops pending chips | 12 |
| sync apply (`handleApplySync`) | at submission | deliberately NOT aborted (the response is needed to classify a durable server commit) | `applyingRef` | apply-failed toast, verification toast, cache, authority record, adoption, pendingPreflight, success toast, checkpoint | verified commit settles through `settleServerCommit` → reconcile notice or discard | b08-1 T5/T6 (behavioral) |
| qualification (`handleQualify`) | at submission | deliberately NOT aborted (same reason) | `qualifying` | failure toast, cache, authority, adoption, evidence, stale-notice clear, checkpoint, success toast | same reconciliation boundary | b08-1 T5/T6 (behavioral) |
| hydration `loadBoard` | effect entry | effect cleanup + scope gate | n/a | every adoption / cache / conflict stash / toast (`cancelled \|\| !scope.isCurrent()`) | late resolution ignored | b08-1 (retained) |

## Finalizer discipline

Every producer's cleanup is REQUEST-owned: elapsed intervals are local to
the run, abort listeners are removed in `finally`, and the busy flag is
released only when `activeRef.current.requestId === requestId` (or the
progress controller matches). A stale run's finalizer can never clear a
newer run's busy/progress state; a newer generation never waits on a
zombie request (b08-2 test 7).

## Same-digest invalidation (generation over digest)

`owner.adopt()` increments the generation even when the adopted board's
digest equals the current one (checkpoint restoration to an identical
board). Auto-place candidates carry their capture scope, so `apply()`
refuses on generation alone while the digest pin still matches —
proven in b08-2 test 9 without relying on `invalidate()`.
