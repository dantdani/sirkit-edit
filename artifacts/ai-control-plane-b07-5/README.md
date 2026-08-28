# AI Control Plane — B07.5: Recovery, Checkpoint, Simulation, and Provider-Event Async Ownership Closure

## Executive summary

Independent B07.4 verification confirmed the six named B07.4 closures
(scoped suggestion batches, pinned replacement dialog, immediate captured
checkpoint write, preflight delete/swap pinning, tier-1 invocation
pinning, request-owned busy/error/stream state) but found the
project-async ownership boundary still open around five ambient callback
families — and one regression: the B07.2 page-structure gate failed
because the ambient `addCheckpoint` removal also removed the page's
`consumer: "checkpoint"` readiness evaluation.

B07.5 closes the boundary:

- **Recovery decisions** (`resolveRecoveryKeepLocal` / `AdoptCanonical` /
  `StartFresh`) submit through ONE `OwnedRecoveryDecisionAdapter`:
  scope + recovery-project-id + captured-session identity checks before
  submission, single-flight duplicate refusal, disabled in-flight buttons,
  and stale-generation completions that update nothing.
- **Checkpoint lists** load through a `LatestRequestGate` under a captured
  scope; hydration resets the list intentionally; restore refuses any
  checkpoint whose `projectId` is not the active project at the entry
  AND adoption boundaries (`checkpointBelongsToProject`).
- **Checkpoint creation** re-evaluates `consumer: "checkpoint"` readiness
  on the CAPTURED session immediately before the write (B07.2 gate green
  again, now as a genuine behavioral contract).
- **Hydration** success AND error callbacks share one gate
  (`hydrationScope` + exact session): an old project's open failure can
  no longer toast into the new project.
- **Simulation** runs through `OwnedSimulationRunner`: scope + request id
  + base digest at invocation, `scope.signal` on the fetch, stale-project
  and stale-base results discarded, AbortError classified as
  cancellation, and all simulation state reset on project transition.
- **Provider-failure events** are owner-aware end to end:
  `throwAiResponseError` takes an `AiRequestOwnership`, re-checks it
  after the body-parse await, dispatches nothing when stale, wraps the
  retry so it refuses once stale, and the page listener re-checks
  `stillCurrent` on delivery. SpiceStudio, PCB AssistBox, and
  useNetClass now carry explicit ownership (page project-generation scope
  + component lifetime); a stale net-class delta is refused before
  application.
- **Audit closure**: every remaining ambient promise callback in the page
  and directly mounted editor components is classified in
  `remaining-async-callback-audit.csv`. The audit surfaced one
  additional CONFIRMED cross-project path — PcbEditor captured its
  project scope/sync identity ONCE at mount while the page keeps it
  mounted across project switches (board checkpoints and working copies
  written under the old project id). Closed by keying PcbEditor (and,
  as defense in depth, SpiceStudio and BomView) by project id, so a
  project switch remounts them with the new identity while tab switches
  within a project keep the mount.

The B07.4/B07.3/B07.2/B07.1/B07 and B06 guarantees are unchanged; all
their suites remain green (see Verification).

## Confirmed failures (reproduced before fixing)

- **A (recovery)** — the three recovery handlers captured
  `schematicRecovery` + `schematicSessionRef.current` and ran
  `session.resolveConflict…().then(...)` unscoped: a decision begun in A
  could, after switching to B, update `schematicRecovery`, toast, and
  (adopt-canonical) call `adoptCanonicalSchematic` with A's state over
  B's UI. Duplicate clicks could submit competing decisions.
- **B (checkpoint lists)** — `refreshCheckpoints()` and hydration both
  ran `checkpointStore().list(id).then(setCheckpoints)` ambiently: a
  slower A list could replace B's list, present A's checkpoints in B's
  history dialog, and `restoreCheckpoint` performed no
  `checkpoint.projectId` identity check of its own.
- **B07.2 regression** — `consumer: "checkpoint"` no longer appeared in
  `app/page.tsx` (the B07.4 removal of the ambient `addCheckpoint`
  helper deleted the gate with it), so checkpoint creation had no
  readiness/recovery evaluation at the write site.
- **C (hydration errors)** — `openForProject(...).then` checked the
  active session, but the `.catch` path was unguarded: an A open failure
  settling after a switch showed its toast in B.
- **E (simulation)** — `handleRunSim` had no scope, no AbortSignal, and
  wrote `simResult`/`simError`/`panes`/`activePaneId`/`chartPanelOpen`/
  `simLoading` after arbitrary awaits; none of that state was reset by
  `resetTransientProjectState` — an A simulation could present its
  waveforms (or error, or loading clear) in B, and a same-project result
  could land on a superseded schematic base.
- **F (provider events)** — `throwAiResponseError` dispatched
  `sirkit:ai-provider-failure` globally before any scope check ran, so
  an old A request could repopulate `aiProviderFailure`,
  `lastAiRetryRef`, and chat-open state after B's reset — and the
  retained retry could replay A's request against B. Component callers
  (SpiceStudio, AssistBox, useNetClass) passed no ownership at all.
- **Audit finding (PcbEditor identity)** — `init.scope` /
  `syncIdentity` / `boardCheckpoint` captured the project at mount;
  the page latches PcbEditor mounted, so after a switch it kept
  operating (and durably writing) under the previous project's id.

## Ownership contracts (implemented)

See `recovery-async-ownership.md`,
`checkpoint-read-restore-ownership.md`, and
`provider-event-ownership.md` for the per-family contracts, and
`remaining-async-callback-audit.csv` for the full classification.

New reusable mechanisms in
`app/lib/engineering/project-async-scope.ts`:

- `OwnedRecoveryDecisionAdapter` — identity-checked, single-flight,
  generation-owned recovery decisions.
- `OwnedSimulationRunner` — request-owned simulation execution with
  stale-base discard and abort-as-cancellation.
- `LatestRequestGate` / `SingleFlightGate` — the underlying gates
  (latest-request-wins reads; one owned decision at a time).

`app/lib/project/checkpoints.ts` adds `checkpointBelongsToProject` —
the final identity boundary for checkpoint restoration.

`app/lib/ai-preferences.ts` (`AiRequestOwnership`,
`AiProviderFailureDetail`) carries the provider-event ownership
contract; the page factory `captureAiRequestOwnership` hands
project-generation ownership to mounted components.

## Verification (all observed on this tree)

- New suite `app/lib/engineering/__tests__/b07-5-async-ownership-closure.test.ts`:
  **33 passed** (behavioral tests over the production adapters with real
  sessions/coordinators and deferred promises; page-wiring source gates
  supplementary).
- `b07-2-interaction-interlock` — **14 passed** (previously 13 passed /
  1 failed on the `consumer: "checkpoint"` gate).
- `b07-4-project-async-scope` — 18 passed; `b07-3-serialization` — 20;
  `b07-1` — 38; `b07-graph-gestures` — 19; `b06-schematic-mutations` —
  32; `b06-1` — 25; `b06-2` — 20; `b06-3` — 9.
- Full engineering directory: 22 files / 417 passed (before adding the
  B07.5 suite; 450 with it).
- Full repository suite, TypeScript (`tsc --noEmit`), and ESLint on
  every changed file: see the final report for exact counts.

## Files changed

- `app/page.tsx` — recovery adapter wiring + disabled buttons; scoped
  checkpoint loader; exact-project restore; checkpoint readiness gate;
  hydration scope on then/catch; owned simulation; transition reset for
  checkpoints/history-dialog/recovery-gate/simulation; ownership factory
  for components; project-keyed PcbEditor/SpiceStudio/BomView.
- `app/lib/engineering/project-async-scope.ts` — the two new adapters.
- `app/lib/project/checkpoints.ts` — `checkpointBelongsToProject`.
- `app/components/spice/SpiceStudio.tsx`,
  `app/components/pcb/AssistBox.tsx`,
  `app/components/pcb/hooks/useNetClass.ts`,
  `app/components/pcb/PcbEditor.tsx` — explicit AI request ownership.
- `artifacts/ai-control-plane-b07-4/README.md` — supersession addendum;
  its deferred-effect and transition-reset matrices corrected.

## Out of scope (unchanged)

No B08 work: no canonical PCB mutation parity, no MCP, no provider
expansion, no agent orchestration, and NO mutation tool exposed to the
AI (registry/tool gates re-verified green).
