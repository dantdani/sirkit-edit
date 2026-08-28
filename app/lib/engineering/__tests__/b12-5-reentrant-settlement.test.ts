/**
 * B12.5 §D — reentrant failure settlement (R3 closure).
 *
 * Outcome callbacks are arbitrary reentrant code and are part of the
 * coordinator's state-machine proof: a lease acquired inside a
 * `transition-failed` callback blocks the next install until it releases,
 * `transitionPending` stays truthful through the wait, `live` is never
 * overwritten while active or busy, no lease is ever stranded on an
 * unreachable interlock, and install failures settle with §C semantics
 * (pre-commit → survivor reactivated; thrown/commit-phase → blocking
 * recovery with a retired, non-replaced target interlock).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProjectTransitionCoordinator, type ProjectTransitionOutcome } from "../project-transition-coordinator";
import type { CommitLease, ProjectCommitInterlock } from "../project-commit-interlock";

const unhandled: unknown[] = [];
const capture = (reason: unknown): void => { unhandled.push(reason); };
beforeAll(() => { process.on("unhandledRejection", capture); });
afterAll(() => {
  process.off("unhandledRejection", capture);
  expect(unhandled).toEqual([]); // §D: zero unhandled rejections across every scenario
});

async function flush(rounds = 8): Promise<void> {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
}

describe("B12.5 §D/R3 — a lease acquired in a failed-outcome callback blocks the next install", () => {
  it("R3 closure: C stays PENDING until that exact lease releases; transitionPending stays true; nothing is stranded", async () => {
    let failNext = false;
    const transition = new ProjectTransitionCoordinator({
      beforeInstall: () => (failNext ? { ok: false, detail: "flush failed" } : { ok: true }),
    });
    const events: string[] = [];
    transition.request(() => { events.push("A"); });
    failNext = true;
    let reactivated: ProjectCommitInterlock | null = null;
    let heldLease: CommitLease | null = null;
    transition.request(
      () => { events.push("B"); },
      (outcome) => {
        if (outcome.status !== "transition-failed") return;
        failNext = false;
        // Reentrant code inside the failed outcome: lease the reactivated
        // survivor interlock, then request C.
        reactivated = transition.currentInterlock();
        const lease = reactivated!.acquireCommitLease();
        if (!lease.ok) throw new Error("lease refused");
        heldLease = lease.lease;
        transition.request(() => { events.push("C"); });
      },
    );
    await flush();
    // C has NOT installed — the pre-B12.5 behavior was events ["A","C"]
    // with the lease stranded on an abandoned interlock.
    expect(events).toEqual(["A"]);
    expect(transition.transitionPending).toBe(true);      // truthful while the barrier is pending
    expect(transition.currentInterlock()).toBe(reactivated); // the leased interlock is REACHABLE (retiring, not abandoned)
    expect((reactivated as ProjectCommitInterlock | null)!.busy).toBe(true);
    await flush();
    expect(events).toEqual(["A"]); // still waiting — arbitrary time does not bypass the lease
    heldLease!.release();
    await flush();
    // Only the release lets C in — through a normal full cycle.
    expect(events).toEqual(["A", "C"]);
    expect(transition.transitionPending).toBe(false);
    const installed = transition.currentInterlock()!;
    expect(installed).not.toBe(reactivated);
    expect(installed.retired).toBe(false);
    expect((reactivated as ProjectCommitInterlock | null)!.retirementSettled).toBe(true); // settled, never stranded
    expect((reactivated as ProjectCommitInterlock | null)!.busy).toBe(false);
  });

  it("a request from a failed-outcome callback begins a NORMAL cycle: the beforeInstall hook runs for it too", async () => {
    const hookCalls: string[] = [];
    let failNext = false;
    const transition = new ProjectTransitionCoordinator({
      beforeInstall: () => {
        hookCalls.push(failNext ? "failing" : "ok");
        return failNext ? { ok: false, detail: "flush failed" } : { ok: true };
      },
    });
    transition.request(() => { /* A */ });
    failNext = true;
    transition.request(
      () => { /* B */ },
      (outcome) => {
        if (outcome.status !== "transition-failed") return;
        failNext = false;
        transition.request(() => { /* C */ });
      },
    );
    await flush();
    expect(hookCalls).toEqual(["ok", "failing", "ok"]); // C went through its own hook
    expect(transition.transitionPending).toBe(false);
  });

  it("a request from an INSTALLED outcome callback is never stranded and receives its own terminal outcome", async () => {
    const transition = new ProjectTransitionCoordinator({ beforeInstall: () => ({ ok: true }) });
    const events: string[] = [];
    const outcomes: string[] = [];
    transition.request(() => { events.push("A"); });
    transition.request(
      () => { events.push("B"); },
      (outcome) => {
        outcomes.push(`B:${outcome.status}`);
        if (outcome.status === "installed" && !events.includes("D")) {
          transition.request(() => { events.push("D"); }, (later) => outcomes.push(`D:${later.status}`));
        }
      },
    );
    await flush();
    expect(events).toEqual(["A", "B", "D"]);
    expect(outcomes).toEqual(["B:installed", "D:installed"]);
    expect(transition.transitionPending).toBe(false);
  });
});

describe("B12.5 §D — install-failure settlement", () => {
  it("a typed PRE-COMMIT install failure retires the target incarnation and reactivates the survivor with a fresh ACTIVE interlock", async () => {
    const transition = new ProjectTransitionCoordinator({ beforeInstall: () => ({ ok: true }) });
    transition.request(() => { /* A */ });
    const interlockA = transition.currentInterlock()!;
    const outcomes: ProjectTransitionOutcome[] = [];
    let targetIncarnation: ProjectCommitInterlock | null = null;
    transition.request(
      () => {
        targetIncarnation = transition.currentInterlock(); // the incarnation created for this install
        return { ok: false, detail: "pointer refused" };
      },
      (outcome) => outcomes.push(outcome),
    );
    await flush();
    expect(outcomes).toEqual([{ status: "transition-failed", detail: "pointer refused" }]);
    const survivor = transition.currentInterlock()!;
    expect(survivor).not.toBe(interlockA);            // fresh (A's was retired by the barrier)
    expect(survivor).not.toBe(targetIncarnation);     // never the failed target's
    expect(survivor.retired).toBe(false);
    expect((targetIncarnation as ProjectCommitInterlock | null)!.retirementSettled).toBe(true); // target incarnation not authoritative
    const lease = survivor.acquireCommitLease();
    expect(lease.ok).toBe(true);
    if (lease.ok) lease.lease.release();
    expect(transition.transitionPending).toBe(false);
  });

  it("a THROWN install (unknowable progress) enters blocking recovery: recovery-flagged outcome, retired target interlock stays live, leases refuse", async () => {
    const transition = new ProjectTransitionCoordinator({ beforeInstall: () => ({ ok: true }) });
    transition.request(() => { /* A */ });
    const outcomes: ProjectTransitionOutcome[] = [];
    transition.request(
      () => { throw new Error("half-adopted explosion"); },
      (outcome) => outcomes.push(outcome),
    );
    await flush();
    expect(outcomes).toEqual([{ status: "transition-failed", detail: "half-adopted explosion", recovery: true }]);
    const live = transition.currentInterlock()!;
    expect(live.retired).toBe(true);                 // retired — approved applies refuse in recovery
    expect(live.acquireCommitLease().ok).toBe(false);
    expect(transition.transitionPending).toBe(false);
    // No silent survivor claim was made; the coordinator remains
    // mechanically usable for an explicit recovery-driven rehydration.
    const events: string[] = [];
    transition.request(() => { events.push("recovered"); });
    await flush();
    expect(events).toEqual(["recovered"]);
    expect(transition.currentInterlock()!.retired).toBe(false);
  });

  it("a lease leaked by a FAILED install body is awaited before the survivor is reactivated — never raced, never stranded", async () => {
    const transition = new ProjectTransitionCoordinator({ beforeInstall: () => ({ ok: true }) });
    transition.request(() => { /* A */ });
    const outcomes: ProjectTransitionOutcome[] = [];
    let leaked: CommitLease | null = null;
    let targetIncarnation: ProjectCommitInterlock | null = null;
    transition.request(
      () => {
        targetIncarnation = transition.currentInterlock();
        const lease = targetIncarnation!.acquireCommitLease();
        if (lease.ok) leaked = lease.lease;
        return { ok: false, detail: "failed with a leaked lease" };
      },
      (outcome) => outcomes.push(outcome),
    );
    await flush();
    // The cycle is SUSPENDED on the leaked lease — no reactivation yet,
    // the leased interlock stays reachable, transitionPending truthful.
    expect(outcomes).toEqual([]);
    expect(transition.transitionPending).toBe(true);
    expect(transition.currentInterlock()).toBe(targetIncarnation);
    leaked!.release();
    await flush();
    expect(outcomes).toEqual([{ status: "transition-failed", detail: "failed with a leaked lease" }]);
    expect(transition.currentInterlock()!.retired).toBe(false); // fresh survivor interlock after settlement
    expect(transition.transitionPending).toBe(false);
  });
});

describe("B12.5 §D — adversarial settlement closures (internal refutation pass)", () => {
  it("a request made AFTER cancelPending while the cycle is suspended on a barrier proceeds normally (StrictMode remount is never consumed by a stale cancel)", async () => {
    const transition = new ProjectTransitionCoordinator({ beforeInstall: () => ({ ok: true }) });
    const events: string[] = [];
    transition.request(() => { events.push("A"); });
    const interlockA = transition.currentInterlock()!;
    const lease = interlockA.acquireCommitLease();
    if (!lease.ok) throw new Error("lease refused");
    const outcomes: string[] = [];
    transition.request(() => { events.push("B"); }, (outcome) => outcomes.push(`B:${outcome.status}`));
    expect(transition.transitionPending).toBe(true); // suspended on A's barrier
    transition.cancelPending();                       // unmount
    transition.request(() => { events.push("C"); }, (outcome) => outcomes.push(`C:${outcome.status}`)); // remount — AFTER the cancel
    lease.lease.release();
    await flush();
    expect(events).toEqual(["A", "C"]);               // C installed — not silently dropped
    expect(outcomes).toEqual(["B:superseded", "C:installed"]);
    expect(transition.transitionPending).toBe(false);
    expect(transition.currentInterlock()!.retired).toBe(false); // C's active incarnation
  });

  it("a cancel with NO follow-up request never leaves the survivor with a retired interlock outside a pending transition", async () => {
    const transition = new ProjectTransitionCoordinator({ beforeInstall: () => ({ ok: true }) });
    transition.request(() => { /* A */ });
    const interlockA = transition.currentInterlock()!;
    const lease = interlockA.acquireCommitLease();
    if (!lease.ok) throw new Error("lease refused");
    transition.request(() => { /* B */ });
    transition.cancelPending();
    lease.lease.release();
    await flush();
    expect(transition.transitionPending).toBe(false);
    const survivor = transition.currentInterlock()!;
    expect(survivor).not.toBe(interlockA);   // A's was retired by the barrier
    expect(survivor.retired).toBe(false);    // …and the survivor got a FRESH ACTIVE one
    const release = survivor.acquireCommitLease();
    expect(release.ok).toBe(true);
    if (release.ok) release.lease.release();
  });

  it("a request issued from a cancel-DROPPED request's superseded callback is never stranded", async () => {
    const transition = new ProjectTransitionCoordinator({ beforeInstall: () => ({ ok: true }) });
    const events: string[] = [];
    const outcomes: string[] = [];
    transition.request(() => { events.push("A"); });
    const lease = transition.currentInterlock()!.acquireCommitLease();
    if (!lease.ok) throw new Error("lease refused");
    transition.request(
      () => { events.push("B"); },
      (outcome) => {
        outcomes.push(`B:${outcome.status}`);
        if (outcome.status === "superseded") {
          transition.request(() => { events.push("D"); }, (later) => outcomes.push(`D:${later.status}`));
        }
      },
    );
    transition.cancelPending(); // drops B; B's callback immediately requests D
    lease.lease.release();
    await flush();
    expect(events).toEqual(["A", "D"]);                     // D ran — zero-outcome stranding is impossible
    expect(outcomes).toEqual(["B:superseded", "D:installed"]);
    expect(transition.transitionPending).toBe(false);
  });

  it("cancelPending from an INSTALLED outcome callback followed by a reentrant request installs that request", async () => {
    const transition = new ProjectTransitionCoordinator({ beforeInstall: () => ({ ok: true }) });
    const events: string[] = [];
    const outcomes: string[] = [];
    transition.request(() => { events.push("A"); });
    transition.request(
      () => { events.push("B"); },
      (outcome) => {
        outcomes.push(`B:${outcome.status}`);
        if (outcome.status === "installed" && !events.includes("X")) {
          transition.cancelPending();
          transition.request(() => { events.push("X"); }, (later) => outcomes.push(`X:${later.status}`));
        }
      },
    );
    await flush();
    expect(events).toEqual(["A", "B", "X"]);
    expect(outcomes).toEqual(["B:installed", "X:installed"]);
    expect(transition.transitionPending).toBe(false);
  });

  it("a hostile hook outcome (throwing `detail` getter) becomes a typed failure — one outcome, no unhandled rejection", async () => {
    let hostile = false;
    const transition = new ProjectTransitionCoordinator({
      beforeInstall: () => {
        if (!hostile) return { ok: true };
        return { ok: false, get detail(): string { throw new Error("evil detail getter"); } } as unknown as { ok: false; detail: string };
      },
    });
    transition.request(() => { /* A */ });
    hostile = true;
    const outcomes: ProjectTransitionOutcome[] = [];
    transition.request(() => { /* B */ }, (outcome) => outcomes.push(outcome));
    hostile = false;
    await flush();
    expect(outcomes.length).toBe(1);
    const outcome = outcomes[0]!;
    expect(outcome.status).toBe("transition-failed");
    if (outcome.status === "transition-failed") expect(typeof outcome.detail).toBe("string");
    expect(transition.transitionPending).toBe(false);
    // The suite-level afterAll asserts the unhandled-rejection capture is EMPTY.
  });

  it("dispose() during a failing hook mints NO fresh leaseable authority after permanent shutdown", async () => {
    let disposeDuringHook = false;
    const transition: ProjectTransitionCoordinator = new ProjectTransitionCoordinator({
      beforeInstall: () => {
        if (!disposeDuringHook) return { ok: true };
        transition.dispose();
        return { ok: false, detail: "flush failed during teardown" };
      },
    });
    transition.request(() => { /* A */ });
    disposeDuringHook = true;
    const outcomes: ProjectTransitionOutcome[] = [];
    transition.request(() => { /* B */ }, (outcome) => outcomes.push(outcome));
    await flush();
    expect(outcomes).toEqual([{ status: "transition-failed", detail: "flush failed during teardown" }]);
    // No reactivation after dispose: the retired survivor interlock stays,
    // and every lease is refused — permanent shutdown holds.
    expect(transition.currentInterlock()!.acquireCommitLease().ok).toBe(false);
  });
});

describe("B12.5 §D — teardown, cancellation and StrictMode", () => {
  it("cancelPending during the mid-cycle barrier wait drops the pending target; the coordinator stays usable after remount", async () => {
    let failNext = false;
    const transition = new ProjectTransitionCoordinator({
      beforeInstall: () => (failNext ? { ok: false, detail: "flush failed" } : { ok: true }),
    });
    const events: string[] = [];
    transition.request(() => { events.push("A"); });
    failNext = true;
    let heldLease: CommitLease | null = null;
    const outcomes: string[] = [];
    transition.request(
      () => { events.push("B"); },
      (outcome) => {
        if (outcome.status !== "transition-failed") return;
        failNext = false;
        const lease = transition.currentInterlock()!.acquireCommitLease();
        if (lease.ok) heldLease = lease.lease;
        transition.request(() => { events.push("C"); }, (later) => outcomes.push(`C:${later.status}`));
      },
    );
    await flush();
    expect(transition.transitionPending).toBe(true);
    // StrictMode teardown while the barrier is pending: C becomes inert.
    transition.cancelPending();
    expect(outcomes).toEqual(["C:superseded"]);
    heldLease!.release();
    await flush();
    expect(events).toEqual(["A"]); // C never installed after cancellation
    expect(transition.transitionPending).toBe(false);
    // Remount: the coordinator is fully usable again.
    transition.request(() => { events.push("remounted"); });
    await flush();
    expect(events).toEqual(["A", "remounted"]);
    expect(transition.currentInterlock()!.retired).toBe(false);
  });

  it("dispose during the barrier wait installs nothing and reports supersession exactly once", async () => {
    let failNext = false;
    const transition = new ProjectTransitionCoordinator({
      beforeInstall: () => (failNext ? { ok: false, detail: "flush failed" } : { ok: true }),
    });
    const events: string[] = [];
    transition.request(() => { events.push("A"); });
    failNext = true;
    let heldLease: CommitLease | null = null;
    const outcomes: string[] = [];
    transition.request(
      () => { events.push("B"); },
      (outcome) => {
        if (outcome.status !== "transition-failed") return;
        failNext = false;
        const lease = transition.currentInterlock()!.acquireCommitLease();
        if (lease.ok) heldLease = lease.lease;
        transition.request(() => { events.push("C"); }, (later) => outcomes.push(`C:${later.status}`));
      },
    );
    await flush();
    transition.dispose();
    heldLease!.release();
    await flush();
    expect(events).toEqual(["A"]);
    expect(outcomes).toEqual(["C:superseded"]);
    // Requests after dispose are refused with a typed supersession.
    const late: string[] = [];
    transition.request(() => { events.push("late"); }, (outcome) => late.push(outcome.status));
    expect(late).toEqual(["superseded"]);
    expect(events).toEqual(["A"]);
  });
});
