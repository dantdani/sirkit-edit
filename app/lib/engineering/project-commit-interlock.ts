/**
 * B12.1 §B — the project-lifecycle commit interlock.
 *
 * A post-await `isCurrent` check cannot undo a durable commit, so approved
 * applies and project transition share ONE explicit lifecycle policy:
 *
 *  - If transition/retirement begins BEFORE the apply reaches its
 *    durable-commit critical section, the apply is refused a lease and
 *    cancels with ZERO durable transaction.
 *  - If the apply acquires the commit/adoption lease FIRST, `retire()` does
 *    not settle until every outstanding lease releases — retirement cannot
 *    occur in the middle of an approved durable commit and then report the
 *    mutation as though nothing happened.
 *
 * One interlock exists per project incarnation (created alongside the
 * session, retired before the session is disposed/replaced). It carries no
 * authority: it orders retirement against the approved critical section,
 * nothing else. Interactive gesture commits keep their documented B07.3
 * semantics; only APPROVED applies acquire leases.
 */

export interface CommitLease {
  /** Idempotent. Must be released when the commit/adoption critical section
   *  settles (success or failure) — a leaked lease would block retirement. */
  release(): void;
}

export type CommitLeaseAcquisition =
  | { ok: true; lease: CommitLease }
  | { ok: false; code: "retiring" | "retired" };

export class ProjectCommitInterlock {
  private state: "active" | "retiring" | "retired" = "active";
  private readonly leases = new Set<object>();
  private readonly retirementWaiters: Array<() => void> = [];

  get retired(): boolean {
    return this.state !== "active";
  }

  /** [B12.5 §D] True only when retirement has fully SETTLED (every lease
   *  released). `retired` is true from the moment retirement BEGINS; the
   *  transition coordinator must not install past a merely-retiring
   *  interlock whose leases are still held. */
  get retirementSettled(): boolean {
    return this.state === "retired";
  }

  /** True while an approved commit/adoption critical section holds a lease. */
  get busy(): boolean {
    return this.leases.size > 0;
  }

  /**
   * Acquire the commit/adoption lease at the serialized execution position,
   * immediately before the durable-commit critical section. Refused the
   * moment retirement has BEGUN (not merely completed): `retire()` marks the
   * interlock synchronously, so an apply that loses the race can never start
   * a durable commit against a retiring project.
   */
  acquireCommitLease(): CommitLeaseAcquisition {
    if (this.state !== "active") {
      return { ok: false, code: this.state === "retiring" ? "retiring" : "retired" };
    }
    const token = {};
    this.leases.add(token);
    let released = false;
    return {
      ok: true,
      lease: {
        release: () => {
          if (released) return;
          released = true;
          this.leases.delete(token);
          if (this.leases.size === 0 && this.state === "retiring") this.finishRetirement();
        },
      },
    };
  }

  /**
   * Begin retirement. New leases are refused SYNCHRONOUSLY from this call
   * on; the returned promise settles only after every outstanding lease
   * releases (i.e. after any in-flight approved commit/adoption critical
   * section settles). Idempotent — later calls await the same completion.
   */
  retire(): Promise<void> {
    if (this.state === "retired") return Promise.resolve();
    this.state = "retiring";
    if (this.leases.size === 0) {
      this.finishRetirement();
      return Promise.resolve();
    }
    return new Promise((resolve) => { this.retirementWaiters.push(resolve); });
  }

  private finishRetirement(): void {
    this.state = "retired";
    const waiters = this.retirementWaiters.splice(0);
    for (const waiter of waiters) waiter();
  }
}
