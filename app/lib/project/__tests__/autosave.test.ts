import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutosaver } from "../autosave";

describe("createAutosaver (R06 Section 5)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounces: many schedules produce one write; 'saved' only after success", () => {
    const writes: number[] = [];
    const saver = createAutosaver(() => { writes.push(Date.now()); return { ok: true }; }, { debounceMs: 100 });
    const states: string[] = [];
    saver.subscribe((status) => states.push(status.state));
    saver.schedule();
    saver.schedule();
    saver.schedule();
    expect(writes).toHaveLength(0);
    vi.advanceTimersByTime(150);
    expect(writes).toHaveLength(1);
    expect(states.at(-1)).toBe("saved");
    expect(states).toContain("saving");
  });

  it("never reports saved on failure; the pending change is retained for retry", () => {
    let fail = true;
    const saver = createAutosaver(() => fail ? { ok: false, reason: "quota exceeded" } : { ok: true }, { debounceMs: 50 });
    saver.schedule();
    vi.advanceTimersByTime(80);
    expect(saver.status().state).toBe("error");
    expect(saver.status().detail).toBe("quota exceeded");
    // The failed write stays pending: a later flush retries and succeeds.
    fail = false;
    expect(saver.flush()).toBe(true);
    expect(saver.status().state).toBe("saved");
  });

  it("flush runs the pending write immediately (pagehide path)", () => {
    const writes: number[] = [];
    const saver = createAutosaver(() => { writes.push(1); return { ok: true }; }, { debounceMs: 5_000 });
    saver.schedule();
    expect(saver.flush()).toBe(true);
    expect(writes).toHaveLength(1);
    vi.advanceTimersByTime(10_000);
    expect(writes).toHaveLength(1); // timer was cancelled; no double write
  });

  it("a thrown save function is reported as an error, not swallowed", () => {
    const saver = createAutosaver(() => { throw new Error("serialization failed"); }, { debounceMs: 10 });
    saver.schedule();
    vi.advanceTimersByTime(20);
    expect(saver.status().state).toBe("error");
    expect(saver.status().detail).toBe("serialization failed");
  });

  it("destroy flushes pending work before tearing down", () => {
    const writes: number[] = [];
    const saver = createAutosaver(() => { writes.push(1); return { ok: true }; }, { debounceMs: 5_000 });
    saver.schedule();
    saver.destroy();
    expect(writes).toHaveLength(1);
  });
});
