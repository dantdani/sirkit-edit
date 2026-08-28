# B12.2 §A — the project-transition state machine

> **SUPERSESSION NOTE (B12.3).** The completion logic below cleared the
> pending flag BEFORE running hooks/installs, so a request made
> synchronously inside `beforeInstall` started a second immediately-
> completing cycle whose newer install the stale outer frame then
> overwrote (counterexample R3: `install:C` followed by `install:B`).
> Superseded by
> `../ai-control-plane-b12-3/reentrant-transition-contract.md` (the
> reentrant-safe completion loop with typed hook/transition outcomes).
> Preserved as historical evidence.


Module: [`app/lib/engineering/project-transition-coordinator.ts`](../../app/lib/engineering/project-transition-coordinator.ts)
Supersedes: B12.1's page-side deferral (`commitInterlockRef` nulled at
deferral + recursive re-entry through `hydrateProjectRef`).

## What was wrong (R1)

The B12.1 deferral had no request identity, nulled the interlock ref the
moment a deferral began, and re-entered `hydrateProject` through an ambient
mutable ref with no staleness check. Reproduced consequence:

```
["deferred:B", "hydrate:A->C", "hydrate:C->B"]   → final project B
```

- A→C **bypassed** the retiring interlock (the ref was already null) and
  **disposed A while its approved commit lease was held** — the in-flight
  commit landed on the retired store while the caller was refused
  (recreating R4's lie);
- a NEW apply during the window received **no interlock at all**;
- the stale deferred B continuation later **overwrote the newer C**.

## The coordinator

```
state: { requestCounter, live: ProjectCommitInterlock | null,
         retirementPending, latest: {id, install} | null, disposed }

request(install):
  id = ++requestCounter               // monotonic transition identity
  latest = { id, install }            // LATEST target wins, always
  if retirementPending: return        // JOIN the pending barrier — never bypass
  retirementPending = true
  prior = live
  complete():
    retirementPending = false
    winner = latest; latest = null
    if !winner: return                // canceled teardown — nothing installs
    hooks.beforeInstall?()            // flush the retiring project's persistence
    live = new ProjectCommitInterlock()
    winner.install()
  if !prior || !prior.busy: prior?.retire(); complete()   // synchronous idle fast-path
  else: prior.retire().then(complete)                     // barrier = every lease released

currentInterlock(): live              // ACTIVE or RETIRING — never a null window
cancelPending(): latest = null        // teardown: continuations become inert
```

## Guarantees, mapped to the requirements

| Requirement | Mechanism |
| --- | --- |
| Retiring interlock reachable until retirement completes | `live` is replaced only in `complete()`, immediately before the winner installs — `currentInterlock()` never yields null between incarnations |
| Retirement started exactly once per incarnation | the `retirementPending` guard; `retire()` is itself idempotent |
| Every hydration entry point serialized | page.tsx's `hydrateProject` is the single funnel (bootstrap, switch, create, import all call it) and is now a thin `request(() => installProject(record, opts))` |
| Requests during pending retirement join the barrier | `if retirementPending: return` after updating `latest` — no second retirement, no bypass |
| Monotonic identity, latest-wins | `latest` is overwritten; `complete()` runs only the final value; earlier installs are unreachable |
| Stale deferred continuations inert | losers are never stored anywhere else — there is no per-request continuation to fire |
| Transition-first ⇒ zero durable transaction | the winning install runs only after `retire()` marked the interlock synchronously; any apply reaching its lease refuses (`session-superseded`) |
| Lease-first ⇒ transition waits | `prior.retire().then(complete)` settles only after commit + adoption + receipt finalization (the service holds the lease through its `finally`) |
| No dispose mid-lease | `session.dispose()` lives inside `installProject`, which runs only in `complete()`, after the barrier |
| New applies during pending retirement refuse | they acquire from the RETIRING `currentInterlock()`; the service's interlock input is now REQUIRED, so no apply can proceed without one |
| Persist before install | `beforeInstall` (page: `autosaver.flush()`) runs after the barrier, before the winner installs |
| Teardown prevents late hydration | `cancelPending()` (unmount) — the barrier completes with no winner and installs nothing; the coordinator stays usable across a StrictMode remount |
| Toasts/selection/list updates belong to the winner | they live inside `installProject`, which only the winner runs |

## Page wiring

```tsx
projectTransitionRef = new ProjectTransitionCoordinator({ beforeInstall: () => autosaverRef.current?.flush() });
hydrateProject(record, opts) = projectTransitionRef.current!.request(() => installProject(record, opts));
applyTier1Proposal: interlock = projectTransitionRef.current!.currentInterlock()  // never null while a project exists
```

`commitInterlockRef` and `hydrateProjectRef` are deleted; the interlock's
lifecycle belongs to the coordinator (created in `complete()` immediately
before the winning install, so every installed project is born with an
acquirable interlock).

## Evidence

`b12-2-transition-serialization.test.ts` — all eight required orderings,
including the exact R1 sequence failing closed
(`["install:A","install:proj-C"]`, final project C, A disposed only after
its critical section settled) and the free-gateway lease-backstop proof for
requirement 6. See
[concurrency-regression-matrix.md](concurrency-regression-matrix.md).
