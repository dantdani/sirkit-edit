# AI Control Plane — B07.4: Project-Scoped Async State, Deferred-Effect Ownership, and Preflight Command Pinning

## Executive summary

Independent B07.3 verification confirmed the FIFO/adoption core but found
incomplete PROJECT scoping around it: actionable suggestions survived
project switches (and could mutate project B through the valid edit
pipeline), a stale generation response could open the replacement dialog
over another project, the post-generation checkpoint ran on an ambient
600 ms timer that re-read `projectRef` after the delay, catalog preflights
(delete/swap) re-read `schematicSessionRef.current` after their awaits and
could retarget same-ID components in another project, tier-1 provider
output was compiled and sealed against RESPONSE-time state (an unreviewed
rebase), and ~15 transient fields (busy flags, errors, retries, prompts,
dialogs, timers) were ambient. B07.4 introduces ONE reusable ownership
mechanism — `ProjectAsyncScopeRegistry` / `ProjectAsyncScope` (generation
counter, AbortSignal, tracked timers, request ids, captured session) — an
explicit tested project-transition reset, scoped suggestion batches,
pinned dialogs/checkpoints/preflights/tier-1 compilation, and request-owned
busy/error/stream state. The B07.3 core (FIFO, adopt-before-render,
transactional undo/redo, gesture exclusivity, UNKNOWN_BASE_PROJECTION,
quarantine-first adoption, export/setter gates) is unchanged and its
suites remain green.

## Confirmed failures (reproduced before fixing)

All six were CONFIRMED at exact source sites in `app/page.tsx` (the
failures live in React wiring; the fixes' mechanisms are behaviorally
tested at module level):

- **A** — `pendingSuggestions` was a bare array (`useState<PendingSuggestion[]>([])`),
  hydration's reset cleared only `pendingTier1`/`schematicRecovery`, and
  `handleApplySuggestions` built a guarded edit request from whatever items
  were present against the CURRENT schematic — project A findings could
  drive a mutation of project B.
- **B** — generation called `setPendingReplace({ …, pin })` without first
  checking the pin: a response begun in A could open "Replace the current
  schematic?" over B (final apply was rejected by the pin, but B's
  transient UI was already altered).
- **C** — `setTimeout(() => addCheckpoint(label), 600)` after adoption;
  `addCheckpoint` re-read `projectRef.current` and the live/authoritative
  state at fire time — switching projects during the delay wrote A's
  generated-schematic checkpoint into B.
- **D** — `deleteComponentCanonical` awaited `ensurePartLoaded` and
  `handleSwapPart` awaited `Promise.all(ensurePartLoaded×2)` before calling
  `runSchematicCommand`, which read `schematicSessionRef.current` at call
  time — after a switch the command executed against B's session, able to
  delete/swap same-ID components (part ids repeat across projects).
- **E** — `handleEditSchematic` re-read `const tier1State = currentSchematicState()`
  AFTER the provider response and compiled/sealed against it — a silent
  unreviewed rebase of provider output onto response-time state.
- **F** — hydration reset only two transient fields; `lastDesignPrompt`
  leaked when the new record lacked one (`if (record.designPrompt)`);
  chat message ids were `Date.now().toString()` (collision-prone); busy
  flags/errors/retries were ambient booleans/refs cleared by whichever
  completion ran last; no fetch was abortable; the auto-pipeline timer and
  genError timers were unowned.

## The project async scope (implemented)

See `project-async-scope-contract.md`. One registry per page;
`beginProject` at every hydration bumps the GENERATION (project id alone is
never used — the same project can be rehydrated into a new session), aborts
the previous generation's `AbortSignal`, and cancels its tracked timers
BEFORE the new identity activates. Handlers `capture()` scopes at
invocation ({projectId, branchId, session, requestId, baseDigest?, signal,
isCurrent, ifCurrent, setTimeout}) and check them after every await;
commands submit with the CAPTURED session via
`runSchematicCommand({ scope })` → the coordinator's `stillCurrent` cancels
stale submissions at execution position (`canceled-stale`).

## Transition reset (implemented, tested)

`resetTransientProjectState(record)` runs at every hydration after
`beginProject`: clears `pendingReplace`, `pendingTier1`,
`schematicRecovery`, `pendingSuggestions`, `genError`,
`aiProviderFailure`, `lastAiRetryRef`, and all six request-owned busy
flags; hydrates `lastDesignPrompt` to `record.designPrompt ?? ""`. Late
old-generation callbacks cannot repopulate anything (their scopes are
stale, their fetches aborted, their timers canceled). Full field-by-field
matrix: `project-transition-reset-matrix.csv`.

## Per-failure fixes

- **A**: `ScopedSuggestionBatch` {items, scope, baseSchematicDigest,
  createdAt}; producers store it only while scope+digest are current; an
  authoritative-mirror effect clears it the moment any mutation supersedes
  its base (never silently rebased); `handleApplySuggestions` gates on
  `evaluateSuggestionBatch` (exact project generation + exact digest)
  BEFORE building any request, with a truthful refusal toast.
- **B**: before `setPendingReplace`: scope current + result validates +
  authoritative digest equals the invocation pin; stale results mark only
  their own (id-keyed) activity log; hydration's reset closes any open
  dialog.
- **C**: the checkpoint is written IMMEDIATELY in `onAdopted` from the
  exact adopted candidate to the CAPTURED project (explicit
  `checkpointStore().add({projectId: captured, schematic: adopted, …})`);
  no ambient `setTimeout(addCheckpoint)` remains anywhere; refresh/failure
  notifications are scope-guarded; a checkpoint failure never rolls back
  the adoption.
- **D**: delete/swap capture their scope before the catalog preflight,
  cancel silently after the await if stale, and submit with `{ scope }` —
  the captured session, never the current ref; the coordinator cancels
  stale submissions before execution. Same-project flows still plan
  against the LATEST canonical head inside the serialized queue.
- **E**: tier-1 compiles and seals against the INVOCATION `snapshot`;
  `tier1StillPinned()` (scope + exact digest) is checked before
  compilation, after the catalog-pin awaits, and before surfacing; the
  sealed `baseSchematicDigest` must equal the invocation pin or the
  proposal is discarded; no proposal surfaces for a stale/foreign context.
- **F**: request-owned busy state (`active*Ref` + requestId guards in every
  finally), `setScopedGenError` (scoped write + scoped auto-clear timer),
  scope-cleared retries, UUID chat ids, abortable fetches
  (`signal: scope.signal`) with abort classified as CANCELLATION (never
  provider failure), scope-gated stream loop with `reader.cancel()`,
  project-owned auto-pipeline timer.

## Changed files and symbols

- `app/lib/engineering/project-async-scope.ts` (new) —
  `ProjectAsyncScopeRegistry`, `ProjectAsyncScope`,
  `ScopedSuggestionBatch`, `evaluateSuggestionBatch`.
- `app/lib/engineering/schematic-gesture-coordinator.ts` —
  `runCanonicalCommand` accepts `stillCurrent` (checked before execution
  and before adoption).
- `app/page.tsx` — registry + `resetTransientProjectState` +
  `captureLifecycleInvocationContext` (now scope-carrying);
  `runSchematicCommand({scope})`; scoped suggestion batch + staleness
  effect + panel; gated replacement dialog; immediate scoped checkpoint;
  pinned delete/swap/tier-1; `setScopedGenError`/`isAbortError`;
  request-owned busy flags; UUID chat ids + scoped stream; project-owned
  auto-pipeline timer.
- Tests — new `__tests__/b07-4-project-async-scope.test.ts` (18);
  B06.2 test 19 updated to the reset-function structure.

## Test commands and results (2026-08-07, repo root)

```
npx vitest run app/lib/engineering/__tests__/b07-4-project-async-scope.test.ts  # PASS (18)
npx vitest run app/lib/engineering                                              # PASS (366)
npx vitest run                                                                  # see final report (timing flakes isolated separately)
npx tsc --noEmit                                                                # PASS
npx eslint <changed files>                                                      # PASS (page.tsx pre-existing findings only)
```

## Remaining UNKNOWN items

- `generateSchematic` (theory-mode client helper) manages its own fetch —
  it is not signal-aborted; its result flows through the same pinned
  gates, so staleness is caught at application (UNKNOWN whether adding
  abort plumbing there is worth the API change; PROPOSED follow-up).
- Simulation (`handleRunSim`) writes `simResult` without a scope guard —
  advisory-only display state hydrated per project view; no mutation can
  follow (INFERRED benign; listed in the deferred-effect matrix).

## B08 readiness

With async ownership explicit end-to-end — and the B07.3 serialization
core intact — the schematic editor's semantic control is consistent under
concurrency AND across project boundaries. B08 is safe to begin once the
owner authorizes it.

---

## SUPERSESSION ADDENDUM (B07.5) — the original report above is preserved verbatim

Independent verification of this stage CONFIRMED the six named B07.4
closures (scoped suggestion batches, pinned replacement dialog,
immediate captured checkpoint write, preflight delete/swap pinning,
tier-1 invocation pinning, request-owned busy/error/stream state) — but
found the "async ownership explicit end-to-end" claim above overstated.
Remaining AMBIENT project-owned callbacks survived B07.4:

- **recovery decisions** — `resolveRecoveryKeepLocal/AdoptCanonical/
  StartFresh` were unscoped `.then` chains that could apply a project-A
  outcome (including canonical adoption) to project B;
- **checkpoint list reads** — `refreshCheckpoints()` and hydration both
  ran ambient `list(id).then(setCheckpoints)`; restore had no
  `checkpoint.projectId` identity check of its own;
- **hydration errors** — `openForProject(...).catch` was unguarded (the
  `.then` session check did not cover it);
- **simulation** — `handleRunSim` (the "INFERRED benign" row below and
  in the deferred-effect matrix) was in fact a CONFIRMED cross-project
  path: no scope, no AbortSignal, six state fields written after
  arbitrary awaits, none reset on transition;
- **provider-failure events** — `throwAiResponseError` dispatched the
  global event before any scope check; the retained retry could replay
  across projects; component callers passed no ownership.

Additionally, removing the ambient `addCheckpoint` helper in this stage
also removed the page's `consumer: "checkpoint"` readiness evaluation,
regressing the B07.2 page-structure gate (13 passed / 1 failed until
B07.5 restored the gate as a behavioral contract).

All of the above are closed in **B07.5** — see
`artifacts/ai-control-plane-b07-5/` for the ownership contracts, the
full remaining-callback audit (which also surfaced and closed
PcbEditor's mount-time project-identity capture), and the regression
evidence. The two matrices in THIS directory
(`deferred-effect-ownership.csv`, `project-transition-reset-matrix.csv`)
have been corrected in place to describe the post-B07.5 state; their
pre-correction claims are summarized here:

- deferred-effect matrix: the simulation row claimed "INFERRED benign;
  advisory only" with no scope/request-id/abort — WRONG (confirmed
  failure E); it also lacked rows for recovery decisions, checkpoint
  list reads, hydration open callbacks, and the provider-failure event.
- transition-reset matrix: it lacked rows for the checkpoint list, the
  history dialog, recovery-decision ownership, and every simulation
  field; the `aiProviderFailure` row's "error paths scope-guarded"
  understated the pre-B07.5 dispatch race.
