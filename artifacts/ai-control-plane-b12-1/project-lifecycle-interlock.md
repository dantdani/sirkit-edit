# B12.1 §B — the project-lifecycle commit interlock

> **SUPERSESSION NOTE (B12.2).** The production wiring below (the nulled
> `commitInterlockRef` + recursive `hydrateProjectRef` deferral) was NOT a
> serialized transition coordinator: a second transition during a pending
> retirement found a NULL interlock, bypassed the barrier, disposed the
> leased project, and a stale deferred continuation later overwrote the
> newer target (counterexample R1 — `["deferred:B","hydrate:A->C",
> "hydrate:C->B"]`). The INFERRED claim that every retirement interleaving
> was excluded was false for overlapping transitions. Superseded by
> `../ai-control-plane-b12-2/project-transition-state-machine.md`.
> Preserved as historical evidence.


Module: [`app/lib/engineering/project-commit-interlock.ts`](../../app/lib/engineering/project-commit-interlock.ts)
Supersedes: B12's `scope-hydration-recovery-matrix.md` retirement rows.

## What was wrong (R4)

B12's only protection was a **post-await** check (`headMark()` after the
commit) — which cannot undo a durable commit. With a delayed store commit,
retiring the project mid-commit produced: the **retired** durable store
advanced to a new head carrying the applied schematic, while the caller was
told `refused: postcondition-failed` and the identity was poisoned. A
durable mutation of a retired project, reported as "nothing verified" — and
B07.3's "the old durable effect stands" documentation was doing the work an
actual interlock should do. B12.1 explicitly forbids resolving this by
documentation.

## The policy

ONE explicit lifecycle policy shared by approved apply and project
transition, implemented as a lease protocol:

```
ProjectCommitInterlock          state: active → retiring → retired
  acquireCommitLease()          refused (synchronously) once retiring/retired
  retire(): Promise<void>       marks retiring SYNCHRONOUSLY; settles only
                                after every outstanding lease releases
```

- One interlock per **project incarnation**, created with the session
  (`hydrateProject`), retired before the session is invalidated, disposed,
  or replaced.
- The apply acquires the lease **at the serialized execution position,
  immediately before the durable-commit critical section** (after
  verification, before `session.execute`) and holds it through commit,
  postconditions, adoption, and gate settlement — released in the service's
  `finally`.
- Only APPROVED applies acquire leases. Interactive gesture commits keep
  their documented B07.3 semantics — B12.1 interlocks the approved path, as
  scoped.

## The two orderings

**Transition first.** `retire()` marks the interlock retiring
*synchronously at the call*, so an apply that reaches lease acquisition any
time after transition began is refused → `session-superseded`, **zero
durable transaction**, claim released (not consumed, not poisoned — the
proposal died with its project). A queued apply that has not yet reached
execution position is additionally canceled by the coordinator epoch /
`stillCurrent` before executing — it never runs against the retired project
**or its replacement**.

**Lease first.** `retire()` does not settle while a lease is held. The
transition (`hydrateProject`) awaits it BEFORE `invalidate()`, before
`dispose()`, before the scope-generation advance, and before the
replacement session exists. The critical section completes fully — durable
commit, postconditions, **adoption into the still-current old project's
UI/history**, receipt, consumption — and the caller is told the TRUTH
(`committed`). Only then does retirement proceed. It is therefore
impossible for `dispose()`/retirement to occur in the middle of an approved
durable commit and then report the mutation as though nothing happened.

The replacement project's UI, history, session, and durable store are
untouched by late old-project completions: while the lease is held no
replacement exists yet (the transition is waiting), and after retirement a
stale proposal is foreign-scope to any genuinely different project.

## Production wiring (`page.tsx`)

```
hydrateProject(record):
  priorInterlock = commitInterlockRef.current; commitInterlockRef.current = null
  if (priorInterlock.busy)  → await priorInterlock.retire(), then re-enter hydrateProject
  else                      → retire() completes synchronously; proceed as before
  … gestureCoordinator.invalidate() → session.dispose() → new session →
    commitInterlockRef.current = new ProjectCommitInterlock() →
    beginProject(generation advance) → resetTransientProjectState …
```

The common case (no approved commit in flight) is byte-for-byte the old
synchronous hydration; the deferred branch exists only while an approved
critical section is actually running.

`applyTier1Proposal` passes `interlock: commitInterlockRef.current` and
`stillCurrent: () => scope.isCurrent()` into the service.

## Non-retirement invalidation (recovery) stays fail-closed

Canonical recovery invalidates the coordinator WITHOUT retiring the
interlock (it is not a project transition). If it races the window between
commit and adoption, the service poisons the identity and refuses
`postcondition-failed` — the durable commit is truthfully reported as
unadoptable, the editor adopts nothing, and no retry can double-commit.
That is the existing recovery path, now the ONLY remaining way a commit can
land without adoption.

## Evidence

`b12-1-lifecycle-interlock.test.ts`: retirement-before-submission,
retirement-while-queued (page ordering), recovery invalidation of a queued
apply, lease-first retirement waiting (deterministic microtask probes — no
wall-clock sleeps), post-retirement replay/fresh-apply containment,
recovery-invalidation-mid-commit poisoning, and the interlock's own state
machine (idempotent release/retire, refusal in retiring AND retired
states). Production-context orderings re-proven per provider origin in
`b12-1-production-integration.test.ts`.
