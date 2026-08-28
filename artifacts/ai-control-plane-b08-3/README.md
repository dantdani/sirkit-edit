# AI Control Plane — B08.3: Owned PCB Sync Orchestration and Verified Qualification Adoption

## Why this stage exists

Independent verification accepted B08.2's internal bare-authority boundary
and the autoroute/auto-place/repair/AI-assist lifecycle work, but found:

1. **`handleSync` was unscoped** — the multi-stage sync preparation
   (physical bindings → publication → snapshot-revision persistence →
   preflight → pending-plan/progress/dialog/toast) captured no lifecycle
   scope and checked nothing after its awaits: a checkpoint restore could
   let the old request keep binding/publishing, persist a stale snapshot
   revision, publish a stale pending plan, mutate progress/toast/dialog
   state, and block a new-generation sync.
2. **Busy flags/finalizers were ambient** — `syncing`,
   `applyingRef`+`applying`, `qualifying` with unconditional finalizers;
   the B08.2 invalidation effect reset only the three hooks.
3. **Qualification adoption was unverified** — the client type omitted
   `boardDigest`, and any found `loadBoard()` record was adopted and
   toasted "Board qualified", even an old or mismatched one.

## The owned workflow layer (`app/lib/pcb/lifecycle/owned-operations.ts`)

Framework-independent production controller; PcbEditor is now purely the
composition/UI layer supplying ports (fetches, caches, adoption bundles,
toasts) and rendering registry-derived busy state.

- **`PcbOwnedOperationRegistry`** — per-kind (`sync-preparation` /
  `sync-apply` / `qualification`) REQUEST-owned busy records over the
  B08.2 `PcbBoardLifecycleOwner`: `begin` refuses duplicates only while
  the holder's generation is current (zombies never block a fresh
  generation — they are evicted); `finish` releases only the exact owning
  requestId (a stale finalizer can never clear/replace/unblock a newer
  request's state); `retireGeneration` — called synchronously inside
  `adoptBoardLifecycle` — clears every slot so the replacement generation
  is idle immediately, explicitly settling even the SUCCESSFUL operation
  whose own adoption advanced the generation. The editor subscribes and
  derives `syncing`/`applying`/`qualifying` from the registry.
- **`runOwnedSyncPreparation`** — ownership verified before dequeuing
  each binding, after every binding response, before/after publication,
  before snapshot-revision persistence, before/after preflight, and
  (structurally, via owned-gated ports) before every pending-plan,
  progress, dialog, or toast write. Bindings and preflight take the
  lifecycle AbortSignal (`PcbSyncClient.preflight` gained an optional
  `{signal}`); publication and apply are deliberately NOT canceled — the
  response is the only evidence of durable commitment, so a stale run
  DETACHES the result and settles its server effect truthfully per stage
  (see the state machine). A stale preflight result is discarded and can
  never repopulate `pendingPreflight`.
- **`runVerifiedServerAdoption`** — shared sync-apply/qualification
  workflow: irreversible commit → stale settlement (`settleServerCommit`:
  same-identity reconcile notice / cross-identity discard) → verified
  authoritative reload — EXACT `revision`, EXACT `digest`, and the
  record's full tenant/project/branch/board identity against the captured
  scope — → the all-or-nothing local adoption bundle. Missing, failed, or
  mismatched reloads preserve the local board, write no cache/evidence/
  checkpoint, emit no ordinary success, and record a truthful
  same-identity authority-reconciliation notice
  (`authorityDivergenceNotice` — new in `board-lifecycle.ts`); the
  server's irreversible truth is never described as canceled or unchanged.

## Qualification verification (defect 3)

- The typed `/api/pcb/qualify` response now includes **`boardDigest`**
  (the route always returned it).
- Success REQUIRES non-empty `boardRevision` AND `boardDigest`; the
  reloaded record must match both plus the captured identity. Only that
  exact verified record is cached, assigned as `authoritativeRecord`,
  adopted, written to stage evidence, checkpointed, or described as
  qualified — the success toast moved INSIDE the verified adopt bundle.

## Behavioral verification (no source-string satisfaction)

`app/lib/pcb/lifecycle/__tests__/b08-3-owned-sync.test.ts` — **13
passed**, all against the production controller + a real owner/registry
with deferred promises racing lifecycle replacements:

1. binding deferred + checkpoint restore (stop, no publish/preflight, no
   stale UI, truthful `bindings` settlement, fresh sync starts);
2. publication commits then replacement (no snapshot-revision
   persistence, no pending plan, `published` settlement; cross-identity →
   `discard` — nothing written);
3. late preflight (pendingPreflight stays empty; no stale progress/toast);
4. abort-ignoring zombie sync preparation (new generation immediately
   idle, new sync starts, zombie finalizer no-ops);
5/6. the same zombie-finalizer proof for sync apply AND qualification;
7. apply commits after same-identity checkpoint restore (no adoption/
   reload/cache, reconcile notice only, new work unblocked);
8. apply completes after project/branch change (settlement = discard;
   recorder writes nothing);
9. qualification success + failed reload → verification-failed, authority
   notice, nothing adopted;
10. wrong revision → refused; 11. right revision/wrong digest (and
    missing keys) → refused;
12. exact revision+digest+identity adoption succeeds once, evidence
    carries the verified keys, adoption's own retire settles the busy
    slot; foreign-identity record refused;
13. same-digest lifecycle restoration invalidates all three in-flight
    operations (generation authoritative; signals aborted; all three
    restart cleanly).

## Verification (observed on this tree)

- B04–B08.3 gate: **316 passed** (accepted 303 + 13 new).
- `npx tsc --noEmit` clean.
- ESLint: changed files clean EXCEPT 5 findings in `PcbEditor.tsx` that
  are pre-existing react-hooks compiler-family diagnostics (imperative
  ref writes in the reseed effect; palette/context-menu builders reading
  refs during render — code untouched by B08.3, same rule family as the
  accepted 14-error `app/page.tsx` baseline). They were previously HIDDEN
  because the render-branch lazy ref-init made the React Compiler bail
  out of the whole component; B08.3's state-held owner removed that
  accidental bailout. Documented as surfaced baseline — not suppressed,
  not introduced.
- PCB sweep + full suite: see the final report (documented perf flakes
  isolated-rerun).

## Files

`sync-workflow-state-machine.md` (states + per-stage server-effect truth
table), `ownership-matrix.md` (request/busy/finalizer ownership),
`qualification-adoption-contract.md` (revision/digest/identity contract);
race fixtures live in the b08-3 suite itself.

## Corrected B08.2 artifact claims

`../ai-control-plane-b08-2/producer-ownership-matrix.md` and `README.md`
are corrected in place: `handleSync` had been OMITTED from the producer
matrix; the sync/apply/qualification rows implied complete ownership
while their busy flags/finalizers were ambient; and the sync/
qualification handler wiring was not behaviorally tested (only
`settleServerCommit` mechanics were).
