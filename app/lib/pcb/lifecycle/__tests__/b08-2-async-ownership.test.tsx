// @vitest-environment jsdom
/**
 * B08.2 §2 — COMPLETE lifecycle ownership for the PCB async producers,
 * proven BEHAVIORALLY against the real production hooks (no source-string
 * satisfaction): useAutoroute, useAutoPlace, usePcbRepair, and AssistBox
 * run against a real PcbBoardLifecycleOwner while lifecycle replacements
 * race their awaits. Every claim observes actual state/toast/candidate
 * behavior.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import { createHistory } from "@/app/lib/pcb/history";
import { PcbBoardLifecycleOwner, type PcbBoardLifecycleIdentity } from "@/app/lib/pcb/lifecycle/board-lifecycle";
import { useAutoroute } from "@/app/components/pcb/hooks/useAutoroute";
import { useAutoPlace } from "@/app/components/pcb/hooks/useAutoPlace";
import { usePcbRepair } from "@/app/components/pcb/hooks/usePcbRepair";
import { AssistBox } from "@/app/components/pcb/AssistBox";
import { getPreset } from "@/app/lib/pcb/drc/presets";
import type { AutoPlaceResult } from "@/app/lib/pcb/autoplace/types";

const IDENTITY: PcbBoardLifecycleIdentity = { tenantId: "t", projectId: "p", branchId: "main", boardId: "board:p" };
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function newOwner(): PcbBoardLifecycleOwner {
  const owner = new PcbBoardLifecycleOwner();
  owner.adopt(IDENTITY);
  return owner;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("B08.2 §2 — autoroute ownership", () => {
  it("6. a lifecycle replacement mid-fetch ABORTS the request and publishes nothing; the fresh generation is immediately usable and gets its own side effects", async () => {
    const owner = newOwner();
    const toasts: string[] = [];
    const history = createHistory(createEmptyBoard());
    const fetchMock = vi.fn()
      .mockImplementationOnce((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }))
      .mockImplementationOnce(async () => new Response(JSON.stringify({ ok: false, error: "engine offline" }), { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAutoroute({
      getHistory: () => history,
      captureLifecycle: () => owner.capture(),
      toast: (message) => toasts.push(message),
    }));
    let firstRun: Promise<void> = Promise.resolve();
    await act(async () => { firstRun = result.current.run(); await sleep(15); });
    expect(result.current.state).toBe("running");
    // Checkpoint restore (same identity): the adoption aborts the scope's
    // signal; PcbEditor's generation effect then calls invalidate().
    await act(async () => {
      owner.adopt(IDENTITY);
      result.current.invalidate();
      await firstRun;
    });
    const init = (fetchMock.mock.calls[0] as [RequestInfo, RequestInit])[1];
    expect(init.signal?.aborted).toBe(true);
    expect(result.current.state).toBe("idle");
    expect(result.current.lastError).toBeUndefined();
    expect(toasts).toEqual([]); // the dead generation owns NO toast
    // Fresh generation: run again — not blocked, and ITS side effects flow.
    await act(async () => { await result.current.run(); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.state).toBe("failed");
    expect(toasts.some((message) => message.includes("Autoroute failed: engine offline"))).toBe(true);
  });

  it("7. request-keyed busy ownership: an in-flight run whose generation ended does NOT block a fresh-generation run even if its request ignores the abort", async () => {
    const owner = newOwner();
    const toasts: string[] = [];
    const history = createHistory(createEmptyBoard());
    const fetchMock = vi.fn()
      // First request: never settles and IGNORES the abort signal entirely.
      .mockImplementationOnce(() => new Promise<Response>(() => undefined))
      .mockImplementationOnce(async () => new Response(JSON.stringify({ ok: false, error: "still offline" }), { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAutoroute({
      getHistory: () => history,
      captureLifecycle: () => owner.capture(),
      toast: (message) => toasts.push(message),
    }));
    await act(async () => { void result.current.run(); await sleep(15); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // While the zombie request hangs, a second run in the SAME generation
    // is refused (single-flight)…
    await act(async () => { void result.current.run(); await sleep(5); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // …but after a lifecycle replacement the NEW generation is released
    // immediately: the zombie's busy flag no longer owns anything.
    await act(async () => { owner.adopt(IDENTITY); result.current.invalidate(); });
    await act(async () => { await result.current.run(); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(toasts.some((message) => message.includes("still offline"))).toBe(true);
  });
});

describe("B08.2 §2 — auto-place ownership", () => {
  class FakeWorker {
    static instances: FakeWorker[] = [];
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: ((event: { message?: string }) => void) | null = null;
    terminated = false;
    constructor() { FakeWorker.instances.push(this); }
    postMessage(): void { /* the test drives onmessage directly */ }
    terminate(): void { this.terminated = true; }
  }

  it("8. a lifecycle replacement mid-run TERMINATES the placement worker silently; invalidate() resets busy/progress for the fresh generation", async () => {
    FakeWorker.instances = [];
    vi.stubGlobal("Worker", FakeWorker);
    const owner = newOwner();
    const toasts: string[] = [];
    const history = createHistory(createEmptyBoard());
    const { result } = renderHook(() => useAutoPlace({
      getHistory: () => history,
      captureLifecycle: () => owner.capture(),
      toast: (message) => toasts.push(message),
    }));
    let running: Promise<void> = Promise.resolve();
    await act(async () => { running = result.current.run(); await sleep(10); });
    expect(FakeWorker.instances).toHaveLength(1);
    expect(result.current.state).toBe("running");
    await act(async () => {
      owner.adopt(IDENTITY); // aborts the scope signal → worker terminates
      result.current.invalidate();
      await running;
    });
    expect(FakeWorker.instances[0]!.terminated).toBe(true);
    expect(result.current.state).toBe("idle");
    expect(result.current.progress).toBeUndefined();
    expect(result.current.lastError).toBeUndefined();
    expect(toasts).toEqual([]); // silent — a replacement is not a user cancel
  });

  it("9. GENERATION beats digest: a same-digest lifecycle replacement invalidates the placement preview at apply() even without invalidate()", async () => {
    FakeWorker.instances = [];
    vi.stubGlobal("Worker", FakeWorker);
    const owner = newOwner();
    const toasts: string[] = [];
    const history = createHistory(createEmptyBoard());
    const { result } = renderHook(() => useAutoPlace({
      getHistory: () => history,
      captureLifecycle: () => owner.capture(),
      toast: (message) => toasts.push(message),
    }));
    let running: Promise<void> = Promise.resolve();
    await act(async () => { running = result.current.run(); await sleep(10); });
    const partial = { report: { success: false, blockedPadEscapes: 1, envelopeOverlaps: 2 } } as unknown as AutoPlaceResult;
    await act(async () => {
      FakeWorker.instances[0]!.onmessage?.({ data: { type: "complete", result: partial } });
      await running;
    });
    expect(result.current.state).toBe("done");
    expect(result.current.lastResult).toBe(partial);
    // Same identity, same board object — the digest pin alone would still
    // match. The GENERATION is authoritative: apply() must refuse.
    await act(async () => { owner.adopt(IDENTITY); });
    await act(async () => { result.current.apply(); });
    expect(result.current.state).toBe("idle");
    expect(result.current.lastResult).toBeUndefined();
    expect(history.entries.length).toBe(0);
    expect(toasts.some((message) => message.includes("replaced since the placement preview"))).toBe(true);
  });
});

describe("B08.2 §2 — repair ownership", () => {
  it("10. a lifecycle replacement mid-plan discards the request silently (abort honored); the fresh generation plans successfully via the native fallback", async () => {
    const owner = newOwner();
    const toasts: string[] = [];
    let history = createHistory(createEmptyBoard());
    const fetchMock = vi.fn()
      .mockImplementationOnce((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }))
      .mockImplementationOnce(async () => new Response(JSON.stringify({ ok: false, error: "planner offline" }), { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => usePcbRepair({
      getHistory: () => history,
      captureLifecycle: () => owner.capture(),
      getRules: () => getPreset("jlcpcb-2l").rules,
      toast: (message) => toasts.push(message),
    }));
    let planning: Promise<void> = Promise.resolve();
    await act(async () => { planning = result.current.createPlan(); await sleep(15); });
    expect(result.current.state).toBe("planning");
    await act(async () => {
      history = createHistory(createEmptyBoard()); // the replacement board
      owner.adopt(IDENTITY);
      result.current.invalidate();
      await planning;
    });
    expect(result.current.plan).toBeUndefined();
    expect(result.current.state).toBe("idle");
    expect(toasts).toEqual([]); // no stale cancel/error surfaced
    // Fresh generation: the AI endpoint fails → the NATIVE deterministic
    // planner still produces the plan (fresh-generation usability).
    await act(async () => { await result.current.createPlan(); });
    expect(result.current.state).toBe("ready");
    expect(result.current.plan).toBeDefined();
    expect(toasts.some((message) => message.includes("native deterministic repair plan prepared"))).toBe(true);
  });

  it("11. verify-after-EVERY-await: a plan response that lands AFTER the replacement (ignoring the abort) is discarded — never published to the new generation", async () => {
    const owner = newOwner();
    const toasts: string[] = [];
    const history = createHistory(createEmptyBoard());
    let releasePlan: (() => void) | null = null;
    const fetchMock = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => {
      // IGNORES the abort signal — resolves successfully when released.
      releasePlan = () => resolve(new Response(JSON.stringify({ ok: true, plan: { id: "late-plan", createdAt: new Date().toISOString(), mode: "safe_fixes_automatically", fixes: [], blockers: [], summary: "late" } }), { status: 200 }));
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => usePcbRepair({
      getHistory: () => history,
      captureLifecycle: () => owner.capture(),
      getRules: () => getPreset("jlcpcb-2l").rules,
      toast: (message) => toasts.push(message),
    }));
    let planning: Promise<void> = Promise.resolve();
    await act(async () => { planning = result.current.createPlan(); await sleep(10); });
    await act(async () => { owner.adopt(IDENTITY); result.current.invalidate(); });
    await act(async () => { releasePlan?.(); await planning; });
    expect(result.current.plan).toBeUndefined();
    expect(result.current.state).toBe("idle");
    expect(toasts).toEqual([]);
  });
});

describe("B08.2 §2 — AI PCB assistance ownership", () => {
  it("12. an assist response whose board lifecycle ended is discarded: no pending chip, no notice, nothing to apply", async () => {
    const owner = newOwner();
    const toasts: string[] = [];
    let releaseAssist: (() => void) | null = null;
    const fetchMock = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => {
      releaseAssist = () => resolve(new Response(JSON.stringify({ commands: [{ op: "set-track-width", ids: ["t1"], widthNm: 200_000 }], explanation: "late edit" }), { status: 200 }));
    }));
    vi.stubGlobal("fetch", fetchMock);
    const board = createEmptyBoard();
    render(<AssistBox
      board={board}
      getSelectionRefs={() => []}
      getHistory={() => null}
      rules={getPreset("jlcpcb-2l").rules}
      presetId="jlcpcb-2l"
      toast={(message) => toasts.push(message)}
      aiOwnership={() => { const scope = owner.capture(); return { isCurrent: () => scope.isCurrent() }; }}
    />);
    const input = screen.getByLabelText("Assist instruction");
    fireEvent.change(input, { target: { value: "widen the selected tracks" } });
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); await sleep(10); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Board replacement while the provider is thinking.
    await act(async () => { owner.adopt(IDENTITY); });
    await act(async () => { releaseAssist?.(); await sleep(10); });
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
    expect(screen.queryByText(/late edit/)).toBeNull();
    expect(toasts).toEqual([]);
  });
});
