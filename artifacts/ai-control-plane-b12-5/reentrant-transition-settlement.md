# B12.5 §D — reentrant failure settlement

Module: [`app/lib/engineering/project-transition-coordinator.ts`](../../app/lib/engineering/project-transition-coordinator.ts)
Supersedes: the B12.3/B12.4 completion loop, whose only retirement
barrier ran at `request()` time — later loop iterations overwrote `live`
without retiring it (pre-edit counterexample R3).

## The defect (R3)

After a failed `beforeInstall`, B12.4 correctly reactivated the survivor
with a fresh interlock — and then invoked the `transition-failed`
outcome callback, which is arbitrary reentrant code. The callback leased
that reactivated interlock and requested C; the loop consumed C and
assigned `live = new ProjectCommitInterlock()` directly: C installed
immediately (`events ["A","C"]`), the lease sat on an abandoned,
unreachable interlock (`reactivatedLeaseHeld: true`), and
`transitionPending` was already false.

## The settlement loop

`advance()` — one loop, every iteration:

```
1. teardown/cancel checkpoint (dropped request → superseded, once)
2. exit when no request is pending
3. RETIRE this.live and await FULL settlement (retirementSettled — the
   new interlock getter distinguishing settled from merely-retiring):
     · leaseless retirement settles synchronously (idle fast path
       unchanged — an idle request still installs before request()
       returns)
     · a held lease SUSPENDS the cycle here: transitionPending stays
       true, currentInterlock() stays the reachable retiring interlock
4. consume the winner; run beforeInstall; re-consult latest
     · hook failure → reactivate survivor (fresh interlock; only when
       nothing newer arrived) → report → re-consult
5. live = new incarnation; run the typed install (§C)
     · { ok:false } pre-commit → retire incarnation (awaiting any leaked
       lease) → reactivate survivor → report → re-consult
     · { ok:false, recovery:true } or THROW → retire incarnation → report
       recovery-flagged failure → NO survivor claim (blocking recovery)
6. report installed → re-consult (installed callbacks are reentrant too)
```

`live` is overwritten ONLY after the previous holder's retirement
barrier has settled — never while active or busy — so no lease can ever
be stranded on an unreachable interlock. A request made from ANY outcome
callback (failed, superseded, installed) lands in `latest` and is
consumed by the next iteration as a completely normal cycle: barrier,
hook, fresh incarnation, typed install, exactly one terminal outcome.
`dispose()` now reports the dropped pending request as superseded — the
one place a request could previously end without a terminal outcome.

## R3 after the fix

The callback's lease now BLOCKS C: `events` stay `["A"]`,
`transitionPending` stays true, `currentInterlock()` is the reachable
retiring survivor interlock, and only releasing that exact lease lets C
install (through its own hook). Arbitrary microtask time does not bypass
the wait.

## Install-failure semantics (§C tie-in)

- Typed pre-commit failure: the target's incarnation is retired (its
  barrier awaited if the failed body leaked a lease) and the survivor
  gets a fresh ACTIVE interlock — B12.4 left the FAILED target's
  interlock live and ACTIVE after a thrown install, which is now
  impossible.
- Thrown install (unknowable progress) and typed commit-phase failure:
  blocking recovery — the RETIRED target incarnation stays in place,
  every approved lease refuses, and no survivor-installed claim is made.
  The coordinator remains mechanically usable for an explicit
  recovery-driven rehydration request.

## Evidence

`b12-5-reentrant-settlement.test.ts` (14): R3 exact closure; normal-cycle
proof (the hook runs for the callback-requested target); installed-
callback reentry never strands; pre-commit failure reactivation with a
never-target interlock; thrown-install blocking recovery with refused
leases; leaked-lease settlement (suspension until release, truthful
transitionPending); cancelPending during the mid-cycle barrier +
remount usability; dispose during the barrier with exactly-once
supersession; plus the six adversarial closures below (post-cancel
request survival, cancel-without-follow-up survivor reactivation,
cancel-dropped-callback reentry, installed-callback cancel+request,
hostile hook outcome, dispose-during-hook) — all under a process-level
unhandled-rejection capture that must end the suite EMPTY. The B12.2 §A
(7), B12.3 §F (7) and B12.4 §D (2) coordinator suites all pass
unchanged.

## Internal adversarial refutation pass (post-implementation)

An independent internal refutation pass against the settlement loop found
four gaps, each empirically confirmed and CLOSED before this stage's
verdict (permanent tests in the suite's "adversarial settlement closures"
block):

1. **Stranded zero-outcome request (critical).** The teardown/cancel
   checkpoint reported the dropped request's supersession and then BARE
   RETURNED — a request() made inside that superseded callback JOINed a
   cycle that immediately ended, leaving `latest` pending with no cycle
   and no outcome. The checkpoint now re-consults (`continue`) after
   every drop, and `dispose()`'s report relies on the disposed fast-path
   so reentrant requests always receive their own outcome.
2. **Stale cancel consuming a post-cancel request (major).**
   `cancelRequested` survived across the JOIN path, so a request made
   AFTER `cancelPending()` while the canceled cycle was suspended on a
   barrier (the real StrictMode remount ordering) was silently dropped —
   and the survivor was left holding a RETIRED interlock outside any
   pending transition. Cancellation is now GENERATIONAL
   (`cancelBelowId`): only requests made before the cancel are dropped;
   and a canceled cycle whose barrier already settled reactivates the
   survivor with a fresh ACTIVE interlock before exiting.
3. **Hostile hook outcome (minor).** `hookOutcome.detail` was read
   outside the guard, so a hook returning `{ok:false}` with a throwing
   `detail` getter caused an unhandled rejection and a zero-outcome
   winner. Hook and install results are now SNAPSHOTTED to plain strings
   inside their try blocks.
4. **Post-dispose reactivation (minor).** The hook-failure reactivation
   site lacked the `!disposed` guard the install-failure site had, so
   dispose() during a failing hook could mint a fresh leaseable
   interlock after permanent shutdown. Guard added; a permanent test
   pins lease refusal.
