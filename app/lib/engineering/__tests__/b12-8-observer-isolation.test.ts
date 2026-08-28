/**
 * B12.8 — failure-isolated autosave observers.
 *
 * Status subscribers are observers, never mutation authorities. The
 * reproduced defect: a listener throwing on the "saving" notification
 * escaped setStatus — which runs AFTER `pending = false` and BEFORE
 * `save()` — so the healthy write never executed, the pending state was
 * lost, and the next settlement falsely succeeded.
 *
 * These tests import the SAME production `createAutosaver` and
 * `settleAutosaveForTransition` that page.tsx imports.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAutosaver, settleAutosaveForTransition } from "../../project/autosave";
import { ProjectTransitionCoordinator, type ProjectTransitionOutcome } from "../project-transition-coordinator";

const escaped: unknown[] = [];
const captureRejection = (reason: unknown): void => { escaped.push(reason); };
const captureException = (error: unknown): void => { escaped.push(error); };
beforeAll(() => {
  process.on("unhandledRejection", captureRejection);
  process.on("uncaughtException", captureException);
});
afterAll(() => {
  process.off("unhandledRejection", captureRejection);
  process.off("uncaughtException", captureException);
  expect(escaped).toEqual([]); // no observer failure ever escapes, anywhere
});

describe("B12.8 — observer failures cannot affect the save authority (items 1–6)", () => {
  it("closure of the reproduction: a throwing 'saving' observer no longer aborts the save — it executes exactly once, flush is true, status ends saved", () => {
    let calls = 0;
    const autosaver = createAutosaver(() => { calls += 1; return { ok: true }; }, { debounceMs: 5 });
    autosaver.subscribe((status) => { if (status.state === "saving") throw new Error("subscriber trap"); });
    autosaver.schedule();
    expect(settleAutosaveForTransition(autosaver)).toEqual({ ok: true });
    expect(calls).toBe(1);                       // executed exactly once
    expect(autosaver.status().state).toBe("saved");
    // A second settlement is a true no-op — nothing pending, no re-run.
    expect(settleAutosaveForTransition(autosaver)).toEqual({ ok: true });
    expect(calls).toBe(1);
  });

  it("throwing listeners during EVERY notification state (dirty, saving, saved, error) leave the authoritative behavior untouched", () => {
    for (const trapState of ["dirty", "saving", "saved", "error"] as const) {
      // Successful-save path (covers dirty/saving/saved traps).
      let calls = 0;
      const succeeding = createAutosaver(() => { calls += 1; return { ok: true }; }, { debounceMs: 5 });
      succeeding.subscribe((status) => { if (status.state === trapState) throw new Error(`${trapState} trap`); });
      succeeding.schedule();
      expect(succeeding.status().state).toBe("dirty"); // committed BEFORE the (possibly throwing) dirty observer
      expect(succeeding.flush()).toBe(true);
      expect(calls).toBe(1);
      expect(succeeding.status().state).toBe("saved");
      // Failing-save path (covers the error trap in particular).
      let failingCalls = 0;
      const failing = createAutosaver(() => { failingCalls += 1; return { ok: false, reason: "quota" }; }, { debounceMs: 5 });
      failing.subscribe((status) => { if (status.state === trapState) throw new Error(`${trapState} trap`); });
      failing.schedule();
      expect(failing.flush()).toBe(false);         // truthful failure despite the observer
      expect(failingCalls).toBe(1);
      expect(failing.status()).toMatchObject({ state: "error", detail: "quota" }); // committed status; never stranded "saving"
      // Pending retained: the next flush retries the same write.
      failing.flush();
      expect(failingCalls).toBe(2);
    }
  });

  it("a throwing observer can neither fabricate a false successful flush nor leak into settlement diagnostics", () => {
    const autosaver = createAutosaver(() => ({ ok: false, reason: "quota" }), { debounceMs: 5 });
    autosaver.subscribe(() => { throw new Error("apiKey=sk-live-0123456789abcdef0123456789abcdef"); });
    autosaver.schedule();
    const settlement = settleAutosaveForTransition(autosaver);
    expect(settlement.ok).toBe(false);           // the real failure decides — not the observer
    if (!settlement.ok) {
      expect(settlement.detail).toContain("quota");                 // the authoritative reason
      expect(settlement.detail).not.toContain("sk-live-");          // the observer's thrown value has NO output channel
      expect(settlement.detail).not.toContain("subscriber");
    }
    expect(autosaver.status().detail).toBe("quota");
  });
});

describe("B12.8 — delivery guarantees (items 7–10)", () => {
  it("recovered retry executes the retained write despite throwing observers throughout", () => {
    let healthy = false;
    let calls = 0;
    const autosaver = createAutosaver(() => { calls += 1; return healthy ? { ok: true } : { ok: false, reason: "quota" }; }, { debounceMs: 5 });
    autosaver.subscribe(() => { throw new Error("always trapping"); });
    autosaver.schedule();
    expect(settleAutosaveForTransition(autosaver).ok).toBe(false);
    expect(calls).toBe(1);
    healthy = true;
    expect(settleAutosaveForTransition(autosaver)).toEqual({ ok: true });
    expect(calls).toBe(2);                        // the RETAINED write ran
    expect(autosaver.status().state).toBe("saved");
  });

  it("one throwing listener does not block later listeners; each receives the committed snapshot", () => {
    const autosaver = createAutosaver(() => ({ ok: true }), { debounceMs: 5 });
    const seenByLater: string[] = [];
    autosaver.subscribe(() => { throw new Error("first listener trap"); });
    autosaver.subscribe((status) => { seenByLater.push(status.state); });
    autosaver.schedule();
    expect(autosaver.flush()).toBe(true);
    expect(seenByLater).toEqual(["dirty", "saving", "saved"]); // full delivery AFTER the thrower
  });

  it("a listener added reentrantly during a notification is not invoked in that same cycle — but is in later cycles", () => {
    const autosaver = createAutosaver(() => ({ ok: true }), { debounceMs: 5 });
    const lateSeen: string[] = [];
    let added = false;
    autosaver.subscribe(() => {
      if (!added) {
        added = true;
        autosaver.subscribe((status) => { lateSeen.push(status.state); });
      }
    });
    autosaver.schedule();                          // "dirty" cycle: late listener added but NOT invoked
    expect(lateSeen).toEqual([]);
    expect(autosaver.flush()).toBe(true);          // later cycles deliver to it
    expect(lateSeen).toEqual(["saving", "saved"]);
  });

  it("debounce-triggered notification with throwing observers produces no uncaught exception and the save still runs", async () => {
    let calls = 0;
    const autosaver = createAutosaver(() => { calls += 1; return { ok: true }; }, { debounceMs: 5 });
    autosaver.subscribe(() => { throw new Error("timer-path trap"); });
    autosaver.schedule();
    await new Promise((resolve) => setTimeout(resolve, 30)); // the TIMER runs save + notifications
    expect(calls).toBe(1);
    expect(autosaver.status().state).toBe("saved");
    // The suite-level afterAll asserts the uncaught/unhandled captures are EMPTY.
  });
});

describe("B12.8 — the real coordinator path (items 11–12)", () => {
  function harness() {
    let healthy = true;
    let calls = 0;
    const autosaver = createAutosaver(() => { calls += 1; return healthy ? { ok: true } : { ok: false, reason: "quota" }; }, { debounceMs: 5 });
    autosaver.subscribe((status) => { if (status.state === "saving") throw new Error("subscriber trap"); });
    autosaver.subscribe(() => { throw new Error("second trap"); });
    const transition = new ProjectTransitionCoordinator({
      beforeInstall: () => settleAutosaveForTransition(autosaver),
    });
    const events: string[] = [];
    const installFor = (id: string) => () => { events.push(id); return { ok: true as const }; };
    return { autosaver, transition, events, installFor, calls: () => calls, setHealthy: (value: boolean) => { healthy = value; } };
  }

  it("11. a throwing observer cannot prevent the outgoing save: the target installs only AFTER the save actually succeeded", () => {
    const h = harness();
    h.transition.request(h.installFor("A"));
    h.autosaver.schedule(); // dirty outgoing state; observers throw on "saving"
    const outcomes: ProjectTransitionOutcome[] = [];
    h.transition.request(h.installFor("B"), (outcome) => outcomes.push(outcome));
    expect(h.calls()).toBe(1);                     // the save EXECUTED (pre-B12.8: 0)
    expect(h.autosaver.status().state).toBe("saved");
    expect(outcomes).toEqual([{ status: "installed" }]);
    expect(h.events).toEqual(["A", "B"]);          // installed only after the real persist
    expect(h.transition.transitionPending).toBe(false);
    expect(h.transition.currentInterlock()!.retired).toBe(false);
  });

  it("12. a REAL save failure still blocks the target despite throwing observers; recovery retries the retained write before installing — one outcome per request, no leaks", () => {
    const h = harness();
    h.transition.request(h.installFor("A"));
    h.setHealthy(false);
    h.autosaver.schedule();
    const outcomes: ProjectTransitionOutcome[] = [];
    h.transition.request(h.installFor("B"), (outcome) => outcomes.push(outcome));
    expect(outcomes.length).toBe(1);
    expect(outcomes[0]!.status).toBe("transition-failed");
    expect(h.events).toEqual(["A"]);               // blocked by the REAL failure, not the observer
    expect(h.calls()).toBe(1);
    expect(h.autosaver.status()).toMatchObject({ state: "error", detail: "quota" });
    // No interlock/lease/transition/pending/status leak.
    expect(h.transition.transitionPending).toBe(false);
    const survivor = h.transition.currentInterlock()!;
    expect(survivor.retired).toBe(false);
    const lease = survivor.acquireCommitLease();
    expect(lease.ok).toBe(true);
    if (lease.ok) lease.lease.release();
    // Recovery: the retained write persists FIRST, then B installs.
    h.setHealthy(true);
    const retryOutcomes: ProjectTransitionOutcome[] = [];
    h.transition.request(h.installFor("B"), (outcome) => retryOutcomes.push(outcome));
    expect(retryOutcomes).toEqual([{ status: "installed" }]);
    expect(h.calls()).toBe(2);                     // the retained write ran
    expect(h.autosaver.status().state).toBe("saved");
    expect(h.events).toEqual(["A", "B"]);
    expect(h.transition.transitionPending).toBe(false);
    expect(h.transition.currentInterlock()!.retired).toBe(false);
  });
});
