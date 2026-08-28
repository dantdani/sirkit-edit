/**
 * B12.3 §F — the reentrant-safe project-transition state machine (R3
 * closure).
 *
 * Pre-edit counterexample (real coordinator): a request made synchronously
 * inside `beforeInstall` produced ["install:C", "install:B"] — the OLDER
 * captured winner installed after the newer target. Latest-wins must hold
 * for requests made while awaiting retirement, inside beforeInstall, inside
 * install, during persistence callbacks, and after cancellation.
 */

import { describe, expect, it } from "vitest";
import { ProjectCommitInterlock } from "../project-commit-interlock";
import { ProjectTransitionCoordinator, type ProjectTransitionOutcome } from "../project-transition-coordinator";

async function flush(count = 8): Promise<void> {
  for (let index = 0; index < count; index += 1) await Promise.resolve();
}

function harness(hooks?: { failFlushOnce?: boolean }) {
  const events: string[] = [];
  let flushFailures = hooks?.failFlushOnce ? 1 : 0;
  const coordinator: ProjectTransitionCoordinator = new ProjectTransitionCoordinator({
    beforeInstall: () => {
      events.push("hook");
      reentry?.();
      if (flushFailures > 0) { flushFailures -= 1; return { ok: false, detail: "flush failed" }; }
      return { ok: true };
    },
  });
  let reentry: (() => void) | null = null;
  const outcomes: Array<{ target: string; outcome: ProjectTransitionOutcome }> = [];
  const to = (target: string, during?: () => void) => coordinator.request(
    () => { events.push(`install:${target}`); during?.(); },
    (outcome) => outcomes.push({ target, outcome }),
  );
  return { coordinator, events, outcomes, to, setReentry: (fn: (() => void) | null) => { reentry = fn; } };
}

describe("B12.3 §F — reentrant transitions preserve deterministic latest-wins", () => {
  it("R3 closure: a request made synchronously inside beforeInstall supersedes the in-flight winner — only the LATEST installs", async () => {
    const h = harness();
    h.to("A");
    expect(h.events.filter((event) => event.startsWith("install:"))).toEqual(["install:A"]);
    const lease = h.coordinator.currentInterlock()!.acquireCommitLease();
    if (!lease.ok) throw new Error("lease refused");
    let reentered = false;
    h.setReentry(() => {
      if (!reentered) { reentered = true; h.to("C"); } // a click on C during B's hook
    });
    h.to("B");
    expect(h.events.filter((event) => event.startsWith("install:")).length).toBe(1); // barrier pending
    expect(h.coordinator.transitionPending).toBe(true);
    lease.lease.release();
    await flush();
    h.setReentry(null);
    // ONLY C installed; B was superseded BEFORE any install; no older-over-newer.
    expect(h.events.filter((event) => event.startsWith("install:"))).toEqual(["install:A", "install:C"]);
    expect(h.outcomes.find((entry) => entry.target === "B")?.outcome.status).toBe("superseded");
    expect(h.outcomes.find((entry) => entry.target === "C")?.outcome.status).toBe("installed");
    expect(h.coordinator.transitionPending).toBe(false);
    // The surviving incarnation's interlock is fresh and ACTIVE.
    expect(h.coordinator.currentInterlock()!.retired).toBe(false);
  });

  it("a request made synchronously DURING an install supersedes it: the just-installed incarnation retires exactly once and the newer target installs", async () => {
    const h = harness();
    h.to("A");
    let fired = false;
    const interlocks: ProjectCommitInterlock[] = [];
    h.coordinator.request(
      () => {
        h.events.push("install:B");
        interlocks.push(h.coordinator.currentInterlock()!);
        if (!fired) { fired = true; h.to("C"); } // a click on C during B's install
      },
      (outcome) => h.outcomes.push({ target: "B-install", outcome }),
    );
    await flush();
    expect(h.events.filter((event) => event.startsWith("install:"))).toEqual(["install:A", "install:B", "install:C"]);
    // B's incarnation was retired (exactly once — retire() is idempotent and
    // only the cycle loop calls it); C's incarnation is ACTIVE.
    expect(interlocks[0]!.retired).toBe(true);
    expect(h.coordinator.currentInterlock()!.retired).toBe(false);
    expect(h.coordinator.currentInterlock()).not.toBe(interlocks[0]);
    expect(h.outcomes.find((entry) => entry.target === "C")?.outcome.status).toBe("installed");
  });

  it("duplicate requests while awaiting retirement: one hydration, earlier request reported superseded", async () => {
    const h = harness();
    h.to("A");
    const lease = h.coordinator.currentInterlock()!.acquireCommitLease();
    if (!lease.ok) throw new Error("lease refused");
    h.to("B");
    h.to("B");
    lease.lease.release();
    await flush();
    expect(h.events.filter((event) => event === "install:B").length).toBe(1);
    const bOutcomes = h.outcomes.filter((entry) => entry.target === "B").map((entry) => entry.outcome.status);
    expect(bOutcomes.sort()).toEqual(["installed", "superseded"]);
  });

  it("a FAILED required persistence flush does not install; the requester gets transition-failed; the current project stays recoverable and a retry succeeds", async () => {
    const h = harness({ failFlushOnce: true });
    h.to("A"); // first hook invocation FAILS the flush
    expect(h.events).toEqual(["hook"]);
    expect(h.outcomes[0]).toEqual({ target: "A", outcome: { status: "transition-failed", detail: "flush failed" } });
    expect(h.coordinator.currentInterlock()).toBeNull(); // nothing installed yet
    expect(h.coordinator.transitionPending).toBe(false);
    // The retry (flush now healthy) succeeds.
    h.to("A");
    expect(h.events.filter((event) => event.startsWith("install:"))).toEqual(["install:A"]);
    expect(h.outcomes[1]?.outcome.status).toBe("installed");
  });

  it("teardown during the hook prevents installation; teardown during the barrier prevents late hydration; the coordinator stays usable", async () => {
    const h = harness();
    h.setReentry(() => h.coordinator.cancelPending()); // teardown DURING the hook
    h.to("A");
    h.setReentry(null);
    expect(h.events.filter((event) => event.startsWith("install:"))).toEqual([]);
    expect(h.outcomes[0]?.outcome.status).toBe("superseded");
    // Usable after teardown: a fresh request installs.
    h.to("A2");
    expect(h.events.filter((event) => event.startsWith("install:"))).toEqual(["install:A2"]);
    // Teardown while the barrier is pending:
    const lease = h.coordinator.currentInterlock()!.acquireCommitLease();
    if (!lease.ok) throw new Error("lease refused");
    h.to("B");
    h.coordinator.cancelPending();
    lease.lease.release();
    await flush();
    expect(h.events.filter((event) => event === "install:B")).toEqual([]);
    expect(h.coordinator.transitionPending).toBe(false);
  });

  it("no unhandled rejection escapes hooks, installs, retirement, or teardown", async () => {
    const rejections: unknown[] = [];
    const listener = (reason: unknown): void => { rejections.push(reason); };
    process.on("unhandledRejection", listener);
    try {
      const events: string[] = [];
      const coordinator: ProjectTransitionCoordinator = new ProjectTransitionCoordinator({
        beforeInstall: () => { throw new Error("hook exploded"); },
      });
      const outcomes: ProjectTransitionOutcome[] = [];
      coordinator.request(() => { events.push("install:A"); }, (outcome) => outcomes.push(outcome));
      expect(outcomes[0]?.status).toBe("transition-failed"); // a THROWING hook is a typed failure
      expect(events).toEqual([]);
      // A throwing INSTALL is also a typed failure, and the barrier path
      // consumes both retire() continuations.
      const healthy = new ProjectTransitionCoordinator();
      healthy.request(() => { /* A installs */ });
      const lease = healthy.currentInterlock()!.acquireCommitLease();
      if (!lease.ok) throw new Error("lease refused");
      const late: ProjectTransitionOutcome[] = [];
      healthy.request(() => { throw new Error("install exploded"); }, (outcome) => late.push(outcome));
      lease.lease.release();
      await flush();
      expect(late[0]?.status).toBe("transition-failed");
      await flush(16);
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", listener);
    }
  });

  it("idle transitions and outcome reporting stay synchronous and truthful", () => {
    const h = harness();
    h.to("A");
    h.to("B");
    expect(h.events.filter((event) => event.startsWith("install:"))).toEqual(["install:A", "install:B"]);
    expect(h.outcomes.map((entry) => `${entry.target}:${entry.outcome.status}`)).toEqual(["A:installed", "B:installed"]);
    expect(h.coordinator.transitionPending).toBe(false);
  });
});
