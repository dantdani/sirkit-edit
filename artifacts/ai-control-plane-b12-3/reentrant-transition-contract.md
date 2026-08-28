# B12.3 §F — the reentrant transition contract

> **SUPERSESSION NOTE (B12.6).** The row "a failed required persistence
> flush must not silently install" was proven only with hooks that
> RETURN `{ ok: false }` directly. The page's actual hook discarded
> `Autosaver.flush()`'s boolean (flush reports failure by return value,
> never by throwing), so in the real composition a failed flush DID
> silently install the replacement — reproduced and closed by B12.6's
> shared `settleAutosaveForTransition` boundary:
> `../ai-control-plane-b12-6/`. The coordinator-side mechanism below was
> and remains correct. Preserved as historical evidence.

> **SUPERSESSION NOTE (B12.4).** The failed-hook branch below left the
> SURVIVING project holding its RETIRED interlock — visible but with
> approved-mutation capability lost until a successful switch (B12.4
> counterexample R4) — and the page's pointer moved at LOAD time, so a
> failed/superseded switch left `sirkit:currentProjectId` on a target that
> never installed (R5). Corrected in
> `../ai-control-plane-b12-4/transition-failure-rollback.md` and
> `../ai-control-plane-b12-4/current-project-pointer-contract.md`.
> Preserved as historical evidence.


Module: [`app/lib/engineering/project-transition-coordinator.ts`](../../app/lib/engineering/project-transition-coordinator.ts)
Supersedes: B12.2's completion logic (which cleared `retirementPending`
before the hook, letting a reentrant request start a second immediately-
completing cycle whose result the stale outer frame then overwrote —
pre-edit counterexample R3: `install:C` followed by `install:B`).

## The completion loop

```
request(install, onOutcome?):
  latest = {id: ++counter, install, onOutcome}      // monotonic identity
  previous latest (if any) → onOutcome(superseded)
  if cyclePending: return                            // JOIN — never a second cycle
  cyclePending = true
  barrier = prior interlock retire (sync when leaseless;
            .then(complete, complete) — both continuations consumed)

completeCycle():   // cyclePending stays TRUE until this returns
  loop:
    canceled/disposed → drop latest (superseded), stop
    winner = latest; latest = null; none → stop
    hook (typed outcome, exceptions caught):
      failed → winner: transition-failed; newer request? continue : stop
    latest reappeared during the hook?  → winner: superseded; continue
    live = new incarnation interlock; winner.install() (caught):
      threw → winner: transition-failed; newer? retire(incarnation); continue : stop
    latest reappeared during the install? → winner: installed (truthful),
      retire(incarnation) — exactly once, inside this same cycle; continue
    winner: installed; stop
  finally: cyclePending = false
```

## Requirements → mechanisms

| Requirement | Mechanism |
| --- | --- |
| Latest-wins while awaiting retirement / in `beforeInstall` / in install / in persistence callbacks / after cancellation | ONE cycle; `latest` re-consulted after every synchronous reentry window; reentrant `request()` can only JOIN (`cyclePending` true throughout) |
| `transitionPending` true through hook and installation settlement | `cyclePending` cleared only in the loop's `finally` |
| An older captured winner can never install after a newer request appears | the post-hook checkpoint supersedes it BEFORE any install; the post-install checkpoint retires-and-replaces it |
| A request during hook/install becomes the next/latest winner | it lands in `latest` and the loop's next iteration runs it |
| Each incarnation retired at most once | the prior incarnation is retired only by the cycle's barrier; a superseded just-installed incarnation is retired exactly once by the same loop iteration that created it |
| No stale callback can retire the newly installed interlock | there are no per-request continuations — only the single loop ever retires or installs |
| `beforeInstall` returns a typed outcome | `{ ok: true } \| { ok: false; detail }` (void = ok for compatibility); exceptions are converted, never propagated |
| A failed required persistence flush must not silently install | `transition-failed` to the requester; the current project stays in place, recoverable; a later request retries the flush (proven) |
| No unhandled rejection from hooks/install/retirement/teardown | hooks and installs are try/caught; `retire().then(complete, complete)`; outcome callbacks are themselves caught; proven with a `process.on("unhandledRejection")` capture |
| Truthful outcomes to page entry points | `installed` / `superseded` / `transition-failed` per request; page.tsx toasts only `transition-failed` (the winner announces itself; superseded targets were never opened) |
| Teardown prevents late hydration, StrictMode-safe | `cancelPending()` drops `latest` and marks the running cycle to stop at its next checkpoint; the coordinator stays usable |

## §E tie-in

While a cycle is pending, `currentInterlock()` is the RETIRING interlock
and the approved apply's pre-flight (§E) refuses `session-superseded` —
even an exact consumed/durable receipt lookup publishes nothing during a
transition.

## Evidence

`b12-3-reentrant-transition.test.ts` (7): the exact R3 sequence now ends
`["install:A","install:C"]` with B superseded before any install;
install-reentrancy retires the superseded incarnation exactly once and
leaves the survivor's interlock ACTIVE; duplicate barrier-joins install
once; flush failure blocks installation and retries recoverably; teardown
during hook and during the barrier installs nothing; zero unhandled
rejections; idle behavior unchanged. The B12.2 §A suite (7) remains green.
