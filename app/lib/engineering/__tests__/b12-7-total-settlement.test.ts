/**
 * B12.7 — total autosave failure settlement and retained-pending closure.
 *
 * Closes four reproduced edges: (R1) a hostile thrown save value escaped
 * `run()`'s own diagnostic conversion BEFORE the failure path restored
 * `pending`, losing the write and stranding status at "saving"; (R2/R3)
 * `settleAutosaveForTransition`'s catch could itself throw while
 * rendering unstringifiable values or Errors with hostile message
 * getters; (R4) a truthy non-Boolean flush result settled as success.
 *
 * The closure is ONE total, bounded unknown-error renderer
 * (`renderUnknownError`, app/lib/agent/redaction.ts) used by BOTH
 * `createAutosaver`'s save-catch and the settlement's flush-catch, plus
 * strict `=== true` settlement. These tests import the SAME
 * `createAutosaver` and `settleAutosaveForTransition` that page.tsx
 * imports.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAutosaver, settleAutosaveForTransition, type Autosaver } from "../../project/autosave";
import { renderUnknownError, UNRENDERABLE_THROWN_VALUE } from "../../agent/redaction";
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
  expect(escaped).toEqual([]); // item 12's guarantee holds suite-wide
});

/** A thrown value that traps every conversion path. */
function unstringifiable(): object {
  return {
    [Symbol.toPrimitive]() { throw new Error("conversion trap"); },
    toString() { throw new Error("conversion trap"); },
    valueOf() { throw new Error("conversion trap"); },
  };
}

function foreignFlush(behavior: () => unknown): Autosaver {
  return {
    schedule() {}, flush: behavior as () => boolean,
    status: () => ({ state: "idle", at: 0 }), subscribe: () => () => {}, destroy() {},
  };
}

describe("B12.7 — the total unknown-error renderer", () => {
  it("never throws and stays bounded for every hostile shape", () => {
    const hostileMessage = new Error("x");
    Object.defineProperty(hostileMessage, "message", { get() { throw new Error("message trap"); } });
    const hostileProxy = new Proxy({}, {
      get() { throw new Error("get trap"); },
      getPrototypeOf() { throw new Error("proto trap"); },
    });
    const { proxy: revoked, revoke } = Proxy.revocable({}, {});
    revoke();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const cases: Array<[unknown, string]> = [
      [new Error("plain failure"), "plain failure"],
      [hostileMessage, "Error"],                       // getter never invoked-unguarded; falls to name
      ["a string reason", "a string reason"],
      ["", UNRENDERABLE_THROWN_VALUE],
      [42, "42"], [NaN, "NaN"], [BigInt(12), "12"],
      [Symbol("why"), "Symbol(why)"],
      [null, "null"], [undefined, "undefined"],
      [unstringifiable(), UNRENDERABLE_THROWN_VALUE],
      [hostileProxy, UNRENDERABLE_THROWN_VALUE],
      [revoked, UNRENDERABLE_THROWN_VALUE],
      [cyclic, UNRENDERABLE_THROWN_VALUE],
      [() => "never invoked", UNRENDERABLE_THROWN_VALUE],
    ];
    for (const [value, expected] of cases) {
      expect(renderUnknownError(value)).toBe(expected);
    }
    // Bounded + credential-redacted.
    const rendered = renderUnknownError(new Error(`apiKey=sk-live-0123456789abcdef0123456789abcdef ${"x".repeat(5000)}`));
    expect(rendered.length).toBeLessThanOrEqual(300);
    expect(rendered).not.toContain("sk-live-0123456789abcdef");
  });
});

describe("B12.7 — createAutosaver totality (items 1, 8, 9, 12)", () => {
  it("R1 closure: an unstringifiable thrown save value RETAINS the pending write, reports error (never 'saving'), and retries the same save", () => {
    let calls = 0;
    let healthy = false;
    const autosaver = createAutosaver(() => {
      calls += 1;
      if (!healthy) throw unstringifiable();
      return { ok: true };
    }, { debounceMs: 5 });
    autosaver.schedule();
    const first = settleAutosaveForTransition(autosaver);
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.detail).toContain(UNRENDERABLE_THROWN_VALUE);
    // Status is ERROR (not stranded "saving"); the write stayed pending.
    expect(autosaver.status()).toMatchObject({ state: "error", detail: UNRENDERABLE_THROWN_VALUE });
    // The second settlement RETRIES (pre-B12.7 it reported ok with the
    // work lost) — still failing, still pending, still error.
    const second = settleAutosaveForTransition(autosaver);
    expect(second.ok).toBe(false);
    expect(calls).toBe(2);
    expect(autosaver.status().state).toBe("error");
    // After the callback heals, the SAME pending write persists.
    healthy = true;
    expect(settleAutosaveForTransition(autosaver)).toEqual({ ok: true });
    expect(calls).toBe(3);
    expect(autosaver.status().state).toBe("saved");
  });

  it("hostile Error-message getters, Symbols, and null thrown from save all settle as retained error states", () => {
    const trapped = new Error("x");
    Object.defineProperty(trapped, "message", { get() { throw new Error("message trap"); } });
    for (const [thrown, expectedDetail] of [
      [trapped, "Error"],
      [Symbol("boom"), "Symbol(boom)"],
      [null, "null"],
    ] as Array<[unknown, string]>) {
      let calls = 0;
      const autosaver = createAutosaver(() => { calls += 1; throw thrown; }, { debounceMs: 5 });
      autosaver.schedule();
      const settlement = settleAutosaveForTransition(autosaver);
      expect(settlement.ok).toBe(false);
      expect(autosaver.status()).toMatchObject({ state: "error", detail: expectedDetail });
      // Pending retained: the next settlement re-runs the same save.
      settleAutosaveForTransition(autosaver);
      expect(calls).toBe(2);
    }
  });

  it("saved is reported ONLY for an explicit { ok: true } return — foreign truthy results fail closed with pending retained", () => {
    let calls = 0;
    const autosaver = createAutosaver((() => { calls += 1; return { ok: "yes" }; }) as unknown as () => { ok: true }, { debounceMs: 5 });
    autosaver.schedule();
    expect(autosaver.flush()).toBe(false);
    expect(autosaver.status()).toMatchObject({ state: "error", detail: "save failed without a usable reason" });
    autosaver.flush();
    expect(calls).toBe(2); // retained pending — retried
  });

  it("a debounce-triggered hostile save creates no uncaught exception and lands on a retained error state", async () => {
    const autosaver = createAutosaver(() => { throw unstringifiable(); }, { debounceMs: 5 });
    autosaver.schedule();
    await new Promise((resolve) => setTimeout(resolve, 30)); // the TIMER runs the save
    expect(autosaver.status()).toMatchObject({ state: "error", detail: UNRENDERABLE_THROWN_VALUE });
    // Pending retained through the timer path too.
    const probe = settleAutosaveForTransition(autosaver);
    expect(probe.ok).toBe(false);
    // The suite-level afterAll asserts the uncaught/unhandled captures are EMPTY.
  });
});

describe("B12.7 — settlement strictness (items 5, 6, 7, 11)", () => {
  it("a throwing foreign flush of ANY shape returns a typed failure — the settlement itself never throws", () => {
    const trapped = new Error("x");
    Object.defineProperty(trapped, "message", { get() { throw new Error("message trap"); } });
    const shapes: Array<[unknown, string]> = [
      [unstringifiable(), UNRENDERABLE_THROWN_VALUE],  // R2 closure
      [trapped, "Error"],                              // R3 closure
      [Symbol("thrown"), "Symbol(thrown)"],
      [null, "null"],
      ["plain-string throw", "plain-string throw"],
    ];
    for (const [thrown, expected] of shapes) {
      const settlement = settleAutosaveForTransition(foreignFlush(() => { throw thrown; }));
      expect(settlement.ok).toBe(false);
      if (!settlement.ok) {
        expect(settlement.detail).toContain("autosave flush threw");
        expect(settlement.detail).toContain(expected);
      }
    }
  });

  it("R4 closure: every non-Boolean flush result — truthy or falsy — fails closed; only the literal true settles ok", () => {
    for (const foreign of ["yes", 1, {}, [], () => true] as unknown[]) {
      const settlement = settleAutosaveForTransition(foreignFlush(() => foreign));
      expect(settlement.ok).toBe(false);
      if (!settlement.ok) expect(settlement.detail).toContain("non-boolean");
    }
    for (const falsy of [0, "", null, undefined, NaN] as unknown[]) {
      const settlement = settleAutosaveForTransition(foreignFlush(() => falsy));
      expect(settlement.ok).toBe(false);
    }
    expect(settleAutosaveForTransition(foreignFlush(() => true))).toEqual({ ok: true });
    expect(settleAutosaveForTransition(foreignFlush(() => false)).ok).toBe(false);
  });

  it("diagnostics stay bounded and credential-redacted through the hostile paths", () => {
    const secretError = new Error(`persist rejected: apiKey=sk-live-0123456789abcdef0123456789abcdef ${"x".repeat(5000)}`);
    const settlement = settleAutosaveForTransition(foreignFlush(() => { throw secretError; }));
    expect(settlement.ok).toBe(false);
    if (!settlement.ok) {
      expect(settlement.detail.length).toBeLessThanOrEqual(260);
      expect(settlement.detail).not.toContain("sk-live-0123456789abcdef");
    }
  });
});

describe("B12.7 — the real coordinator path (item 10)", () => {
  it("hostile first failure refuses the install; after the save heals, retry persists A's work BEFORE the target installs — no leaks", async () => {
    let calls = 0;
    let healthy = false;
    const autosaver = createAutosaver(() => {
      calls += 1;
      if (!healthy) throw unstringifiable();
      return { ok: true };
    }, { debounceMs: 5 });
    const transition = new ProjectTransitionCoordinator({
      beforeInstall: () => settleAutosaveForTransition(autosaver),
    });
    const events: string[] = [];
    let visible = "";
    let pointer = "";
    const installFor = (id: string) => () => { events.push(id); pointer = id; visible = id; return { ok: true as const }; };
    transition.request(installFor("A"));
    expect(visible).toBe("A");

    autosaver.schedule(); // dirty outgoing state; its save THROWS hostilely
    const outcomes: ProjectTransitionOutcome[] = [];
    transition.request(installFor("B"), (outcome) => outcomes.push(outcome));

    // The hostile first failure refuses: no install, no pointer move,
    // exactly one typed outcome, outgoing save retained pending.
    expect(events).toEqual(["A"]);
    expect(visible).toBe("A");
    expect(pointer).toBe("A");
    expect(outcomes.length).toBe(1);
    expect(outcomes[0]!.status).toBe("transition-failed");
    expect(autosaver.status()).toMatchObject({ state: "error", detail: UNRENDERABLE_THROWN_VALUE });
    const callsAfterFailure = calls;
    expect(callsAfterFailure).toBe(1);
    // No transition/interlock/lease/status leak.
    expect(transition.transitionPending).toBe(false);
    const survivor = transition.currentInterlock()!;
    expect(survivor.retired).toBe(false);
    const lease = survivor.acquireCommitLease();
    expect(lease.ok).toBe(true);
    if (lease.ok) lease.lease.release();

    // Recovery: the healed save runs AGAIN (same pending write) before B installs.
    healthy = true;
    const retryOutcomes: ProjectTransitionOutcome[] = [];
    transition.request(installFor("B"), (outcome) => retryOutcomes.push(outcome));
    await Promise.resolve();
    expect(retryOutcomes).toEqual([{ status: "installed" }]);
    expect(calls).toBe(callsAfterFailure + 1);
    expect(autosaver.status().state).toBe("saved");
    expect(events).toEqual(["A", "B"]);
    expect(visible).toBe("B");
    expect(transition.transitionPending).toBe(false);
    expect(transition.currentInterlock()!.retired).toBe(false);
  });
});
