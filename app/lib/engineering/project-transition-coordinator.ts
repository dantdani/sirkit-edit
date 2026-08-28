/**
 * B12.2 §A / B12.3 §F / B12.5 §C§D — the serialized project-transition
 * coordinator.
 *
 * B12.2 closed the null-interlock deferral (a transition can never bypass a
 * held approved-commit lease, and no project is disposed mid-lease). B12.3
 * closed reentrancy for requests made while awaiting retirement, inside
 * `beforeInstall`, inside an install, and after cancellation. B12.5 closes
 * the remaining production-boundary gaps:
 *
 *  R3 — reentry from a `transition-failed` OUTCOME CALLBACK could abandon
 *       a live leased interlock: after a failed hook the survivor was
 *       reactivated, the callback leased it and requested C, and the loop
 *       overwrote `live` with C's fresh incarnation — installing C
 *       immediately while the lease sat on an unreachable interlock. Now
 *       EVERY winner is consumed only after the CURRENT live interlock's
 *       retirement barrier has fully settled (`retirementSettled`), so a
 *       lease acquired by reentrant outcome code blocks the next install
 *       until it releases, `transitionPending` stays truthfully true
 *       through the wait, and `live` is never overwritten while active or
 *       busy.
 *
 *  §C — installs are TRANSACTIONAL: the install body returns a typed
 *       result. A PRE-COMMIT failure (`{ok:false}` without `recovery`)
 *       means nothing visible changed — the failed target's incarnation is
 *       retired and the survivor is reactivated with a fresh ACTIVE
 *       interlock. A COMMIT-PHASE failure (`{ok:false, recovery:true}`) —
 *       or a THROWN install, whose progress is unknowable — enters
 *       explicit blocking recovery: the target incarnation is retired (all
 *       approved leases refuse), NO survivor claim is made, and the page
 *       presents a blocking recovery surface instead of either project
 *       being reported installed.
 *
 * Outcome callbacks are arbitrary reentrant code and are part of this
 * state machine's proof: after EVERY outcome report the loop re-consults
 * `latest`, so a request issued from any callback (failed, superseded, or
 * installed) begins a normal cycle with full barrier semantics and
 * receives exactly one terminal outcome. No unhandled rejection can
 * escape: hooks, installs, and callbacks are caught, and every awaited
 * barrier promise is resolve-only.
 *
 * Hook-free and framework-free: page.tsx imports it, and tests drive the
 * exact same class.
 */

import { ProjectCommitInterlock } from "./project-commit-interlock";

export type BeforeInstallOutcome = { ok: true } | { ok: false; detail: string };

/**
 * [B12.5 §C] The install body's typed result. `void` (legacy bodies) means
 * installed. `recovery: false/absent` = PRE-COMMIT failure: the body
 * guarantees nothing visible changed. `recovery: true` = commit-phase
 * failure: visible state may be partially adopted — blocking recovery.
 */
export type ProjectInstallResult = { ok: true } | { ok: false; detail: string; recovery?: boolean } | void;

export type ProjectTransitionOutcome =
  | { status: "installed" }
  | { status: "superseded" }
  | { status: "transition-failed"; detail: string; recovery?: boolean };

interface PendingRequest {
  id: number;
  install: () => ProjectInstallResult;
  onOutcome?: (outcome: ProjectTransitionOutcome) => void;
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ProjectTransitionCoordinator {
  private requestCounter = 0;
  /** The live incarnation's interlock — active or RETIRING; null only
   *  before the first project is installed. Never overwritten while it is
   *  active or busy: every overwrite site runs strictly after the
   *  previous holder's retirement barrier has settled. */
  private live: ProjectCommitInterlock | null = null;
  /** True from the moment a cycle begins until hooks, installation AND
   *  every mid-cycle retirement barrier have settled — reentrant requests
   *  during that whole span JOIN the cycle. */
  private cyclePending = false;
  private latest: PendingRequest | null = null;
  private cancelRequested = false;
  /** [B12.5 §D] Cancellation is GENERATIONAL: only requests made BEFORE
   *  the cancelPending() call are dropped. A request that arrives AFTER
   *  it (the StrictMode remount racing a still-suspended canceled cycle)
   *  proceeds as a normal transition instead of being silently consumed
   *  by the stale cancel flag. */
  private cancelBelowId = 0;
  private disposed = false;

  constructor(private readonly hooks?: { beforeInstall?: () => BeforeInstallOutcome | void }) {}

  /** The interlock approved applies must acquire from. NEVER null while a
   *  project exists — during a pending transition this is the RETIRING
   *  interlock, whose lease acquisition (and replay lookup) refuses. */
  currentInterlock(): ProjectCommitInterlock | null {
    return this.live;
  }

  /** True while a transition cycle (barrier, hooks, or installation) is
   *  pending — including while a MID-CYCLE retirement barrier (e.g. a
   *  lease acquired by reentrant failure-callback code) is awaited (§D). */
  get transitionPending(): boolean {
    return this.cyclePending;
  }

  /**
   * Request a transition. `install` runs only if this request is still the
   * LATEST when the current incarnation's retirement barrier fully settles
   * AND after every reentry-window re-consultation. Superseded requests
   * receive `superseded`; hook and install failures yield
   * `transition-failed` (with `recovery: true` when the target entered
   * blocking recovery).
   */
  request(install: () => ProjectInstallResult, onOutcome?: (outcome: ProjectTransitionOutcome) => void): void {
    if (this.disposed) { this.report(onOutcome, { status: "superseded" }); return; }
    const id = ++this.requestCounter;
    const previous = this.latest;
    this.latest = { id, install, ...(onOutcome ? { onOutcome } : {}) };
    if (previous) this.report(previous.onOutcome, { status: "superseded" });
    if (this.cyclePending) return; // JOIN the running cycle — never bypass it
    this.cyclePending = true;
    this.cancelRequested = false;
    // The advance loop's synchronous prefix runs before this returns (an
    // idle coordinator installs synchronously); it suspends only while a
    // busy interlock's retirement barrier is genuinely pending. The loop
    // is total — the returned promise never rejects.
    void this.advance();
  }

  /**
   * §D — the reentrant-safe completion loop. Structure per iteration:
   *
   *   1. teardown/cancel checkpoint;
   *   2. exit when no request is pending;
   *   3. RETIRE the current live interlock and await full settlement
   *      (covers the initial transition, a reactivated survivor leased by
   *      reentrant failure-callback code, and a just-installed-but-
   *      superseded incarnation — `transitionPending` stays true);
   *   4. consume the winner, run the hook, re-consult;
   *   5. install behind a fresh incarnation with typed §C failure
   *      handling;
   *   6. report, then re-consult (outcome callbacks are reentrant code).
   */
  private async advance(): Promise<void> {
    try {
      for (;;) {
        if (this.disposed) {
          this.cancelRequested = false;
          const dropped = this.latest;
          this.latest = null;
          // Reentrant requests made inside this report hit request()'s
          // disposed fast-path and receive their own outcome — no strand.
          if (dropped) this.report(dropped.onOutcome, { status: "superseded" });
          return;
        }
        if (this.cancelRequested) {
          this.cancelRequested = false;
          // [B12.5 §D] Drop only PRE-cancel requests; a post-cancel
          // request (remount) proceeds through this same cycle.
          if (this.latest !== null && this.latest.id <= this.cancelBelowId) {
            const dropped = this.latest;
            this.latest = null;
            this.report(dropped.onOutcome, { status: "superseded" });
          }
          // A canceled cycle must not leave the SURVIVOR without commit
          // capability: when its barrier already settled and no work
          // remains, reactivate a fresh ACTIVE interlock (mirrors the
          // failure-path reactivations — never while active or busy).
          if (this.latest === null && this.live !== null && this.live.retirementSettled) {
            this.live = new ProjectCommitInterlock();
          }
          // Re-consult: the dropped callback may have requested, and a
          // surviving post-cancel request must run — never a bare return
          // that strands `latest` with no cycle.
          continue;
        }
        if (this.latest === null) return;
        // §D — the current live interlock's retirement barrier must fully
        // settle before the next winner is consumed. Leaseless retirement
        // settles synchronously (the idle fast path stays synchronous);
        // held leases suspend the cycle here with transitionPending true.
        const prior = this.live;
        if (prior !== null && !prior.retirementSettled) {
          const barrier = prior.retire();
          if (!prior.retirementSettled) {
            await barrier;
            continue; // re-run every checkpoint after the suspension
          }
        }
        const winner = this.latest;
        this.latest = null;
        // Hooks run with the cycle still pending (transitionPending true).
        let hookOutcome: BeforeInstallOutcome = { ok: true };
        try {
          const returned = this.hooks?.beforeInstall?.();
          // Snapshot INSIDE the try: a hostile outcome object (throwing
          // `detail` getter) must become a typed failure here, never an
          // unhandled rejection at a later read site.
          if (returned && returned.ok === false) {
            hookOutcome = { ok: false, detail: typeof returned.detail === "string" ? returned.detail : String(returned.detail) };
          }
        } catch (error) {
          hookOutcome = { ok: false, detail: failureMessage(error) };
        }
        if (!hookOutcome.ok) {
          // A failed required persistence flush must not silently install:
          // the current project stays in place AND stays USABLE. [B12.4 §D]
          // The retirement barrier settled above, so the SURVIVING
          // incarnation is reactivated with a fresh ACTIVE interlock —
          // never racing an old lease. A newer request that arrived during
          // the failing hook still wins (no reactivation then — the next
          // iteration's barrier would only re-retire it). Never after
          // dispose(): permanent shutdown mints no leaseable authority.
          if (!this.disposed && this.live !== null && this.latest === null) {
            this.live = new ProjectCommitInterlock();
          }
          this.report(winner.onOutcome, { status: "transition-failed", detail: hookOutcome.detail });
          // [B12.5 §D] The failed-outcome callback is reentrant code: if it
          // leased the reactivated interlock and requested another target,
          // the next iteration RETIRES that interlock and waits for the
          // lease before installing (R3 closure).
          continue;
        }
        if (this.latest !== null || this.cancelRequested) {
          // A newer request (or teardown) arrived DURING the hook — the
          // captured winner is superseded BEFORE any install.
          this.report(winner.onOutcome, { status: "superseded" });
          continue;
        }
        // The new incarnation's interlock exists before its install runs.
        const incarnation = new ProjectCommitInterlock();
        this.live = incarnation;
        let failure: { detail: string; recovery: boolean } | null = null;
        try {
          const returned = winner.install();
          // Snapshot inside the try — hostile result objects become typed
          // recovery failures via the catch, never later throw sites.
          if (returned !== undefined && returned.ok === false) {
            failure = { detail: typeof returned.detail === "string" ? returned.detail : String(returned.detail), recovery: returned.recovery === true };
          }
        } catch (error) {
          // [B12.5 §C] A THROWN install has unknowable progress — fail
          // CLOSED to blocking recovery; never claim either project
          // installed on top of possibly half-adopted state.
          failure = { detail: failureMessage(error), recovery: true };
        }
        if (failure !== null) {
          // The failed target's incarnation must not remain authoritative:
          // retire it. Its barrier settles synchronously unless the failed
          // install body leaked a lease — then the cycle waits it out.
          const barrier = incarnation.retire();
          if (!incarnation.retirementSettled) await barrier;
          if (!failure.recovery) {
            // PRE-COMMIT failure (§C): the install body guarantees nothing
            // visible changed — pointer, visible project, session and live
            // interlock still agree on the survivor, which is reactivated
            // with a fresh ACTIVE interlock.
            if (!this.disposed && this.latest === null) {
              this.live = new ProjectCommitInterlock();
            }
            this.report(winner.onOutcome, { status: "transition-failed", detail: failure.detail });
            continue;
          }
          // COMMIT-PHASE (or unknown-phase) failure: explicit blocking
          // recovery. The RETIRED incarnation stays in place — every
          // approved lease refuses — and no survivor claim is made.
          this.report(winner.onOutcome, { status: "transition-failed", detail: failure.detail, recovery: true });
          continue;
        }
        this.report(winner.onOutcome, { status: "installed" });
        // The installed-outcome callback is reentrant code too: a request
        // issued inside it must not strand. The next iteration retires the
        // just-installed incarnation (awaiting any lease) and proceeds.
        continue;
      }
    } finally {
      this.cyclePending = false;
    }
  }

  private report(onOutcome: ((outcome: ProjectTransitionOutcome) => void) | undefined, outcome: ProjectTransitionOutcome): void {
    if (!onOutcome) return;
    try { onOutcome(outcome); } catch { /* outcome reporting must never break the cycle */ }
  }

  /** Teardown: pending continuations become inert; the coordinator stays
   *  usable (StrictMode dev remount). Safe to call during a hook, an
   *  install, or a mid-cycle barrier wait — the cycle drops remaining
   *  work at its next checkpoint. */
  cancelPending(): void {
    this.cancelRequested = this.cyclePending;
    // Generation mark: everything requested up to NOW is canceled;
    // anything requested after this call proceeds normally (§D).
    this.cancelBelowId = this.requestCounter;
    const dropped = this.latest;
    this.latest = null;
    if (dropped) this.report(dropped.onOutcome, { status: "superseded" });
  }

  /** Permanent shutdown (tests): no further installs ever run. [B12.5 §D]
   *  The dropped pending request still receives its ONE terminal outcome. */
  dispose(): void {
    this.disposed = true;
    const dropped = this.latest;
    this.latest = null;
    if (dropped) this.report(dropped.onOutcome, { status: "superseded" });
  }
}
