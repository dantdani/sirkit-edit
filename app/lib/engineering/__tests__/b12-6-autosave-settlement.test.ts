/**
 * B12.6 — truthful autosave settlement at the project-transition boundary.
 *
 * The reproduced defect: page.tsx's `beforeInstall` called
 * `autosaverRef.current?.flush()` and discarded the boolean —
 * `Autosaver.flush()` reports failure by RETURN VALUE (false, save kept
 * pending, status `error`), never by throwing, so a failed
 * retiring-project save was classified successful and the replacement
 * installed over unpersisted state.
 *
 * The closure is `settleAutosaveForTransition` — the SAME production
 * helper page.tsx imports (source-gated below) — proven here with the
 * REAL `createAutosaver` and the REAL `ProjectTransitionCoordinator`.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createAutosaver, settleAutosaveForTransition, type Autosaver } from "../../project/autosave";
import { ProjectTransitionCoordinator, type ProjectTransitionOutcome } from "../project-transition-coordinator";

const backing = new Map<string, string>();
beforeEach(() => {
  backing.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => { backing.set(key, String(value)); },
    removeItem: (key: string) => { backing.delete(key); },
    key: (index: number) => [...backing.keys()][index] ?? null,
    get length() { return backing.size; },
    clear: () => backing.clear(),
  };
});
afterEach(() => { delete (globalThis as { localStorage?: unknown }).localStorage; });

describe("B12.6 — settleAutosaveForTransition (the production helper, real autosaver)", () => {
  it("1. no autosaver (bootstrap window) settles ok", () => {
    expect(settleAutosaveForTransition(null)).toEqual({ ok: true });
    expect(settleAutosaveForTransition(undefined)).toEqual({ ok: true });
  });

  it("2. no pending work settles ok without running a save", () => {
    let saveCalls = 0;
    const autosaver = createAutosaver(() => { saveCalls += 1; return { ok: true }; }, { debounceMs: 5 });
    expect(settleAutosaveForTransition(autosaver)).toEqual({ ok: true });
    expect(saveCalls).toBe(0); // nothing was pending — nothing ran
    expect(autosaver.status().state).toBe("idle");
  });

  it("3. a successful pending flush settles ok and reports saved", () => {
    let saveCalls = 0;
    const autosaver = createAutosaver(() => { saveCalls += 1; return { ok: true }; }, { debounceMs: 5 });
    autosaver.schedule();
    expect(settleAutosaveForTransition(autosaver)).toEqual({ ok: true });
    expect(saveCalls).toBe(1);
    expect(autosaver.status().state).toBe("saved");
  });

  it("4. a false-returning failed save settles as a typed failure carrying the autosaver's recorded detail", () => {
    const autosaver = createAutosaver(() => ({ ok: false, reason: "quota" }), { debounceMs: 5 });
    autosaver.schedule();
    const settlement = settleAutosaveForTransition(autosaver);
    expect(settlement.ok).toBe(false);
    if (!settlement.ok) {
      expect(settlement.detail).toContain("could not be saved");
      expect(settlement.detail).toContain("quota"); // the recorded status detail, safely surfaced
    }
    expect(autosaver.status()).toMatchObject({ state: "error", detail: "quota" });
  });

  it("5. a throwing save (via the real autosaver) and a throwing flush (hostile implementation) both settle as typed failures", () => {
    // The real autosaver CATCHES a throwing save() and reports it as a
    // false flush with the message as status detail.
    const throwingSave = createAutosaver(() => { throw new Error("disk detached"); }, { debounceMs: 5 });
    throwingSave.schedule();
    const viaFalse = settleAutosaveForTransition(throwingSave);
    expect(viaFalse.ok).toBe(false);
    if (!viaFalse.ok) expect(viaFalse.detail).toContain("disk detached");
    // A foreign/hostile Autosaver whose flush() itself throws is still a
    // typed failure — the helper's own guard, not the page's.
    const hostile: Autosaver = {
      schedule() {}, flush() { throw new Error("hostile flush"); },
      status: () => ({ state: "idle", at: 0 }), subscribe: () => () => {}, destroy() {},
    };
    const viaThrow = settleAutosaveForTransition(hostile);
    expect(viaThrow.ok).toBe(false);
    if (!viaThrow.ok) {
      expect(viaThrow.detail).toContain("autosave flush threw");
      expect(viaThrow.detail).toContain("hostile flush");
    }
  });

  it("10. a failed flush leaves the save PENDING for retry — the dirty state is never discarded", () => {
    let storageHealthy = false;
    let saveCalls = 0;
    const autosaver = createAutosaver(() => { saveCalls += 1; return storageHealthy ? { ok: true } : { ok: false, reason: "quota" }; }, { debounceMs: 5 });
    autosaver.schedule();
    expect(settleAutosaveForTransition(autosaver).ok).toBe(false);
    expect(saveCalls).toBe(1);
    // The pending write survived the refusal: a later healthy settlement
    // RE-RUNS the same save and succeeds.
    storageHealthy = true;
    expect(settleAutosaveForTransition(autosaver)).toEqual({ ok: true });
    expect(saveCalls).toBe(2);
    expect(autosaver.status().state).toBe("saved");
  });

  it("11. failure detail is bounded and safe: secret-shaped content is redacted and oversized text is capped", () => {
    const secret = "persist rejected: apiKey=sk-live-0123456789abcdef0123456789abcdef";
    const huge = "x".repeat(5_000);
    for (const reason of [secret, huge]) {
      const autosaver = createAutosaver(() => ({ ok: false, reason }), { debounceMs: 5 });
      autosaver.schedule();
      const settlement = settleAutosaveForTransition(autosaver);
      expect(settlement.ok).toBe(false);
      if (!settlement.ok) {
        expect(settlement.detail.length).toBeLessThanOrEqual(260); // prefix + capped reason
        expect(settlement.detail).not.toContain("sk-live-0123456789abcdef");
      }
    }
    // A hostile status() cannot break the refusal or smuggle content.
    const hostileStatus: Autosaver = {
      schedule() {}, flush: () => false,
      status() { throw new Error("hostile status"); }, subscribe: () => () => {}, destroy() {},
    };
    const settlement = settleAutosaveForTransition(hostileStatus);
    expect(settlement.ok).toBe(false);
    if (!settlement.ok) expect(settlement.detail).toBe("the outgoing project's pending changes could not be saved");
  });
});

describe("B12.6 — the real coordinator path with the production helper", () => {
  async function harness(options?: { debounceMs?: number }) {
    const current = await import("../../project/current");
    let storageHealthy = true;
    let saveCalls = 0;
    const autosaver = createAutosaver(() => {
      saveCalls += 1;
      return storageHealthy ? { ok: true } : { ok: false, reason: "quota" };
    }, { debounceMs: options?.debounceMs ?? 5 });
    // The page's exact composition: the shared production helper IS the hook.
    const transition = new ProjectTransitionCoordinator({
      beforeInstall: () => settleAutosaveForTransition(autosaver),
    });
    const events: string[] = [];
    let visible = "";
    const installFor = (id: string) => () => {
      events.push(id);
      const marked = current.markProjectCurrent(id);
      if (!marked.ok) return { ok: false as const, detail: marked.detail };
      visible = id;
      return { ok: true as const };
    };
    return {
      current, autosaver, transition, installFor, events,
      visible: () => visible,
      saveCalls: () => saveCalls,
      setStorageHealthy: (value: boolean) => { storageHealthy = value; },
    };
  }

  // Explicit timeout: carries the file's one-time production persistence
  // import — a declared allowance under full-suite contention (b12-4
  // precedent), never an assertion change.
  it("6+7+9. closure of the reproduction: the target never installs over a failed save; the survivor stays current, active and usable; exactly one terminal outcome", { timeout: 20_000 }, async () => {
    const h = await harness();
    const projectA = h.current.createProjectRecord("Project A");
    const projectB = h.current.createProjectRecord("Project B");
    h.transition.request(h.installFor(projectA.id));
    expect(h.current.currentProjectId()).toBe(projectA.id);

    h.setStorageHealthy(false);
    h.autosaver.schedule(); // dirty state on the RETIRING project
    const outcomes: ProjectTransitionOutcome[] = [];
    h.transition.request(h.installFor(projectB.id), (outcome) => outcomes.push(outcome));

    // Exactly one typed terminal failure; the installer never ran.
    expect(outcomes.length).toBe(1);
    const outcome = outcomes[0]!;
    expect(outcome.status).toBe("transition-failed");
    if (outcome.status === "transition-failed") {
      expect(outcome.detail).toContain("could not be saved");
      expect(outcome.detail).toContain("quota");
      expect(outcome.recovery).toBeUndefined(); // pre-install failure — nothing half-adopted
    }
    expect(h.events).toEqual([projectA.id]);                    // B's installer never invoked
    expect(h.visible()).toBe(projectA.id);                      // no UI adoption
    expect(h.current.currentProjectId()).toBe(projectA.id);     // pointer unchanged
    expect(h.autosaver.status()).toMatchObject({ state: "error", detail: "quota" });
    // No transition-pending leak, no null-interlock window, survivor usable.
    expect(h.transition.transitionPending).toBe(false);
    const survivor = h.transition.currentInterlock();
    expect(survivor).not.toBeNull();
    expect(survivor!.retired).toBe(false);
    const lease = survivor!.acquireCommitLease();
    expect(lease.ok).toBe(true);
    if (lease.ok) lease.lease.release();
  });

  it("8. after storage recovers, the retry flushes A's pending state BEFORE B installs", async () => {
    const h = await harness();
    const projectA = h.current.createProjectRecord("A");
    const projectB = h.current.createProjectRecord("B");
    h.transition.request(h.installFor(projectA.id));
    h.setStorageHealthy(false);
    h.autosaver.schedule();
    h.transition.request(h.installFor(projectB.id));
    expect(h.events).toEqual([projectA.id]);
    const callsAfterFailure = h.saveCalls();
    expect(callsAfterFailure).toBe(1);

    h.setStorageHealthy(true);
    const outcomes: ProjectTransitionOutcome[] = [];
    h.transition.request(h.installFor(projectB.id), (outcome) => outcomes.push(outcome));
    expect(outcomes).toEqual([{ status: "installed" }]);
    expect(h.saveCalls()).toBe(callsAfterFailure + 1); // A's pending write ran (and succeeded) FIRST
    expect(h.autosaver.status().state).toBe("saved");
    expect(h.events).toEqual([projectA.id, projectB.id]);
    expect(h.current.currentProjectId()).toBe(projectB.id);
    expect(h.transition.currentInterlock()!.retired).toBe(false);
  });

  it("12a. compatibility with the interlock barrier: a settlement failure behind a held lease still refuses AFTER the barrier, with the survivor reactivated", async () => {
    const h = await harness();
    const projectA = h.current.createProjectRecord("A");
    const projectB = h.current.createProjectRecord("B");
    h.transition.request(h.installFor(projectA.id));
    const interlockA = h.transition.currentInterlock()!;
    const lease = interlockA.acquireCommitLease();
    if (!lease.ok) throw new Error("lease refused");
    h.setStorageHealthy(false);
    h.autosaver.schedule();
    const outcomes: ProjectTransitionOutcome[] = [];
    h.transition.request(h.installFor(projectB.id), (outcome) => outcomes.push(outcome));
    // Suspended on A's barrier — the hook has not run yet.
    expect(h.transition.transitionPending).toBe(true);
    expect(outcomes).toEqual([]);
    expect(h.saveCalls()).toBe(0);
    lease.lease.release();
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    expect(outcomes.length).toBe(1);
    expect(outcomes[0]!.status).toBe("transition-failed");
    expect(h.events).toEqual([projectA.id]);
    expect(h.current.currentProjectId()).toBe(projectA.id);
    expect(h.transition.transitionPending).toBe(false);
    const survivor = h.transition.currentInterlock()!;
    expect(survivor).not.toBe(interlockA);
    expect(survivor.retired).toBe(false); // fresh ACTIVE reactivation — no lease/pending leak
  });

  it("12b. compatibility with reentrant failure callbacks: a retry requested INSIDE the transition-failed outcome installs once storage recovered", async () => {
    const h = await harness();
    const projectA = h.current.createProjectRecord("A");
    const projectB = h.current.createProjectRecord("B");
    h.transition.request(h.installFor(projectA.id));
    h.setStorageHealthy(false);
    h.autosaver.schedule();
    const outcomes: string[] = [];
    h.transition.request(
      h.installFor(projectB.id),
      (outcome) => {
        outcomes.push(`B1:${outcome.status}`);
        if (outcome.status === "transition-failed") {
          // Reentrant recovery: storage comes back, retry from the callback.
          h.setStorageHealthy(true);
          h.transition.request(h.installFor(projectB.id), (later) => outcomes.push(`B2:${later.status}`));
        }
      },
    );
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    expect(outcomes).toEqual(["B1:transition-failed", "B2:installed"]);
    expect(h.events).toEqual([projectA.id, projectB.id]);
    expect(h.autosaver.status().state).toBe("saved"); // A's work persisted before B installed
    expect(h.current.currentProjectId()).toBe(projectB.id);
    expect(h.transition.transitionPending).toBe(false);
  });
});

describe("B12.6 — page wiring (source gate)", () => {
  it("page.tsx's beforeInstall IS the shared production helper — no discarded flush boolean remains", () => {
    const source = readFileSync(join(process.cwd(), "app", "page.tsx"), "utf8");
    expect(source).toContain('import { createAutosaver, settleAutosaveForTransition');
    const hookAt = source.indexOf("beforeInstall: () => settleAutosaveForTransition(autosaverRef.current)");
    expect(hookAt).toBeGreaterThan(-1);
    // The defective composition is gone: no bare flush-and-return-ok hook.
    const coordinatorBody = source.slice(source.indexOf("new ProjectTransitionCoordinator"), source.indexOf("approvedJournalStoreRef"));
    expect(coordinatorBody).not.toContain("autosaverRef.current?.flush()");
    // The export handler's correct boolean check is untouched.
    expect(source).toContain("const flushed = autosaverRef.current?.flush() ?? true;");
  });
});
