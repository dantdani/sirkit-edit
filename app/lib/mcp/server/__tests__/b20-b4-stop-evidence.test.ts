/**
 * [B20 B4] The evidence behind withholding sirkit.placement.propose from MCP (OD-87; D20-34's placement half; follow-up F1),
 * as deterministic cases: the placement engine's time budget and cancellation hook are checked only between candidate specs,
 * so neither bounds a spec once it has started; the first spec is the current-placement seed, which maxIterations never
 * reaches; and the public preview route forwards a caller's localRefinementPasses, gridNm and timeoutMs to the engine while its
 * deadlineMs bounds the body read alone. The engine's clock is faked (vi.setSystemTime); no network, no child process. The
 * seconds measured on the synthetic probe board are on mcp-server-proposals.md; these cases pin the mechanism, and the last
 * one the statements the record cites, by content (the page states their lines as of the base 4299067).
 * [B20 B4 second dispatch] These cases pin UNCHANGED base code: they passed on 4299067 (they did not fail first) [B24-A3, 2026-10-06] - case 6 no longer: the route clamps F1 since B24-A3 (OD-197), a reviewed pin move noted on the case -; five
 * mutations of the cited code, each restored by sha256, showed they are sensitive (M1 to M5 of the first dispatch's review).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { anchorOccurrences, pageCitations } from "./_citations";
import { EngineeringPlacementCancelledError, runEngineeringPlacement } from "@/app/lib/pcb/placement/engine";
import type { EngineeringPlacementOptions } from "@/app/lib/pcb/placement/types";
import { placementRunOptions } from "@/app/lib/pcb/candidates/layout-candidate";
import { makeBoard, makeIcDef, makeInstance, makeResistorDef } from "@/app/lib/pcb/__tests__/autoplace-fixture";
import type { PcbBoard } from "@/app/lib/pcb/types";

const engineCalls = vi.hoisted(() => [] as EngineeringPlacementOptions[]);
vi.mock("@/app/lib/pcb/placement/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/lib/pcb/placement/engine")>();
  return {
    ...actual,
    runEngineeringPlacement: (input: Parameters<typeof actual.runEngineeringPlacement>[0]) => {
      engineCalls.push({ ...(input.options ?? {}) });
      return actual.runEngineeringPlacement(input);
    },
  };
});
// [B20 B4 review] regressions-2: the preview route's cold import (the auth route-handlers graph with drizzle, postgres and
// openai) runs here, at collection, which has no timeout, and never inside case 6's 5 s budget, where a loaded machine
// outruns it (b11-4-no-execution's pattern). vi.mock above is hoisted, so the route still binds the mocked engine.
const { POST: previewPost } = await import("@/app/api/pcb/placement/preview/route");

const ROOT = process.cwd();
const T0 = new Date("2026-09-21T12:00:00.000Z");
const source = (path: string): string[] => readFileSync(join(ROOT, path), "utf8").split("\n");

function board(): PcbBoard {
  const ic = makeIcDef();
  const res = makeResistorDef();
  return makeBoard(70, 45, [
    makeInstance("u1", ic, { x: 12, y: 12 }, { "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 1, "8": 2 }),
    makeInstance("u2", ic, { x: 55, y: 30 }, { "1": 3, "2": 4, "3": 5, "4": 6, "5": 1, "6": 2, "7": 3, "8": 4 }),
    makeInstance("r1", res, { x: 8, y: 35 }, { "1": 1, "2": 5 }),
    makeInstance("r2", res, { x: 30, y: 8 }, { "1": 2, "2": 6 }),
    makeInstance("r3", res, { x: 35, y: 38 }, { "1": 3, "2": 4 }),
    makeInstance("r4", res, { x: 62, y: 8 }, { "1": 5, "2": 6 }),
  ], 6);
}
const options = (b: PcbBoard, extra: Partial<EngineeringPlacementOptions> = {}): EngineeringPlacementOptions => ({
  ...placementRunOptions(b, { producer: "agent", projectId: "b20-b4-stop", candidateCount: 8, maxIterations: 40, timeoutMs: 15_000 }),
  ...extra,
});
const label = (phase: string, candidate?: number): string => (candidate ? `${phase}#${candidate}` : phase);

beforeEach(() => { engineCalls.length = 0; });
afterEach(() => { vi.useRealTimers(); });

describe("[B20 B4] stop evidence — the placement engine's budget and cancellation, and the public preview route", () => {
  it("1. D20-34 abort half: an abort raised inside a spec is seen only at the next budget poll; the rest of that spec still runs", () => {
    const b = board();
    const events: string[] = [];
    let abort = false;
    let polls = 0;
    let caught: unknown = null;
    try {
      runEngineeringPlacement({ board: b, options: options(b), observer: {
        onProgress: (p) => { events.push(label(p.phase, p.candidate)); if (p.phase === "orientation" && p.candidate === 1) abort = true; },
        shouldCancel: () => { polls += 1; return abort; },
      } });
    } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(EngineeringPlacementCancelledError);
    const afterAbort = events.slice(events.indexOf("orientation#1") + 1);
    expect(afterAbort).toEqual(["legalize#1", "evaluate#1"]);
    expect(events).not.toContain("initialize#2");
    expect(polls).toBe(2);
  });

  it("2. D20-34 abort half: an abort delivered by a timer (an AbortSignal) is never seen while the engine runs synchronously", async () => {
    const b = board();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 0);
    const seen: boolean[] = [];
    const run = runEngineeringPlacement({ board: b, options: options(b), observer: { shouldCancel: () => { seen.push(controller.signal.aborted); return controller.signal.aborted; } } });
    expect(run.candidates.length).toBeGreaterThan(0);
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.every((value) => value === false)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(controller.signal.aborted).toBe(true);
  });

  it("3. OD-87 / F1: the time budget is checked only between specs — a spec that runs past even the 120 s clamp completes and is kept", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    const b = board();
    const run = runEngineeringPlacement({ board: b, options: options(b, { timeoutMs: 120_000 }), observer: {
      onProgress: (p) => { if (p.phase === "evaluate" && p.candidate === 1) vi.setSystemTime(new Date(Date.now() + 600_000)); },
    } });
    expect(run.candidates).toHaveLength(1);
    expect(run.candidates[0]!.initializer).toBe("current");
    expect(run.searchComplete).toBe(false);
    expect(["best_known_budget_exhausted", "timed_out"]).toContain(run.termination);
    expect(run.elapsedMs).toBeGreaterThanOrEqual(600_000);
  });

  it("4. OD-87: a budget shorter than the problem build runs no spec at all", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    const b = board();
    const run = runEngineeringPlacement({ board: b, options: options(b, { timeoutMs: 50 }), observer: {
      onProgress: (p) => { if (p.phase === "precheck") vi.setSystemTime(new Date(Date.now() + 1_000)); },
    } });
    expect(run.termination).toBe("timed_out");
    expect(run.candidates).toHaveLength(0);
  });

  it("5. OD-87: the first spec is the current-placement seed, which maxIterations never reaches — an iteration cap cannot shorten it", () => {
    const firstSpec = (maxIterations: number) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(T0);
      const b = board();
      const run = runEngineeringPlacement({ board: b, options: options(b, { maxIterations }), observer: {
        onProgress: (p) => { if (p.phase === "evaluate" && p.candidate === 1) vi.setSystemTime(new Date(Date.now() + 60_000)); },
      } });
      vi.useRealTimers();
      expect(run.candidates).toHaveLength(1);
      return run.candidates[0]!;
    };
    const low = firstSpec(1);
    const high = firstSpec(2_000);
    expect(low.initializer).toBe("current");
    expect(low.phaseStats.map((stat) => stat.phase)).not.toContain("hypergraph-force");
    expect(high.candidateHash).toBe(low.candidateHash);
  });

  it("6. F1: an anonymous POST to the public preview route forwards the caller's localRefinementPasses, gridNm and timeoutMs to the engine ([B24-A3, 2026-10-06] reviewed pin move, OD-197: F1 closed as a work bound - the route clamps them to the public ceilings: passes at most 1, the grid at least 100,000, the timeout at most 5,000; the values inside them pass unchanged; [B24-A3 review, 2026-10-08] passes at most 0, candidates at most 2)", async () => {
    const body = JSON.stringify({ board: board(), options: { candidateCount: 2, maxIterations: 1, localRefinementPasses: 3, gridNm: 10_000, timeoutMs: 1 } });
    const response = await previewPost(new Request("http://localhost/api/pcb/placement/preview", { method: "POST", headers: { "content-type": "application/json" }, body }));
    expect([200, 422]).toContain(response.status);
    expect(engineCalls).toHaveLength(1);
    expect(engineCalls[0]).toMatchObject({ localRefinementPasses: 0, gridNm: 100_000, timeoutMs: 1, candidateCount: 2, maxIterations: 1 }); // [B24-A3, 2026-10-06] was { localRefinementPasses: 3, gridNm: 10_000, ... } (F1 open, B20); clamped by the route since B24-A3 (OD-197). [B24-A3 review, 2026-10-08] reviewed pin move: passes 1 -> 0 (one pass is up to 64 more evaluations: 10.8 s at 30 footprints, abuse-controls.md section 9)
  });

  it("7. source: one budget poll per spec, none inside localRefine; the route's deadlineMs reaches only the body reader; runPlacementCandidate passes no observer (base)", () => {
    const engine = source("app/lib/pcb/placement/engine.ts");
    expect(engine.filter((line) => line.includes("checkBudget(startedAt, timeoutMs, input.observer)"))).toHaveLength(1);
    const refineStart = engine.findIndex((line) => line.startsWith("function localRefine("));
    const refineEnd = engine.findIndex((line, index) => index > refineStart && line === "}");
    const refine = engine.slice(refineStart, refineEnd).join("\n");
    expect(refine).not.toMatch(/checkBudget|shouldCancel|Date\.now|timeoutMs/);
    const handlers = source("app/lib/auth/route-handlers.ts");
    const pubStart = handlers.findIndex((line) => line.startsWith("export function publicJsonRoute"));
    const pubEnd = handlers.findIndex((line, index) => index > pubStart && line === "}");
    const deadlineLines = handlers.slice(pubStart, pubEnd).filter((line) => line.includes("deadlineMs"));
    expect(deadlineLines).toHaveLength(1);
    expect(deadlineLines[0]).toContain("const readOpts = { maxBytes: options.maxBytes, ...(options.deadlineMs");
    const candidate = source("app/lib/pcb/candidates/layout-candidate.ts").filter((line) => line.includes("runEngineeringPlacement({"));
    expect(candidate).toHaveLength(1);
    expect(candidate[0]).not.toContain("observer");
  });

  it("8. the stop record's citations resolve by content — each anchor once in its file, or in the body of the function it names — and mcp-server-proposals.md carries each one with its line as of the base 4299067", () => {
    // [B20 B4 second dispatch] pin move, deliberate: this case pinned ABSOLUTE line numbers of shared, often-edited files
    // (engine.ts, route-policy.ts, route-handlers.ts, ...), so an unrelated edit broke CI. Each citation is now anchored by
    // the statement it names, scoped to the named function where the text recurs in the file (evaluateCandidate in
    // localRefine; readOpts in publicJsonRoute); the dated lines are on the page, labelled as of 4299067.
    const ENGINE = "app/lib/pcb/placement/engine.ts";
    const HANDLERS = "app/lib/auth/route-handlers.ts";
    const PREVIEW = "app/api/pcb/placement/preview/route.ts";
    const citations: ReadonlyArray<readonly [string, string | null, string]> = [
      [ENGINE, null, "function checkBudget("],
      [ENGINE, "function checkBudget(", "observer?.shouldCancel?.()) throw new EngineeringPlacementCancelledError()"],
      [ENGINE, null, "function localRefine("],
      [ENGINE, "function localRefine(", ".slice(0, 16)"],
      [ENGINE, "function localRefine(", "structuredClone(best.placements)"],
      [ENGINE, "function localRefine(", "evaluateCandidate({ problem, placements"],
      [ENGINE, null, "Math.max(50, Math.min(120_000, Math.round(options.timeoutMs ?? 15_000)))"],
      [ENGINE, null, "Math.max(10_000, Math.round(options.gridNm ?? 100_000))"],
      [ENGINE, null, "{ initializer: \"current\", seed: problem.seedSet[0] }"],
      [ENGINE, null, "checkBudget(startedAt, timeoutMs, input.observer)"],
      [ENGINE, null, "forcePlacement(problem, spec.seed, maxIterations, gridNm)"],
      [ENGINE, null, "Math.max(0, Math.min(3, Math.round(options.localRefinementPasses ?? 1)))"],
      ["app/lib/pcb/candidates/layout-candidate.ts", null, "runEngineeringPlacement({ board: input.board, options: placementRunOptions(input.board, input.request) })"],
      ["app/lib/agent/layout-proposals.ts", null, "timeoutMs: Math.max(1_000, Math.min(input.timeoutMs, 110_000))"],
      [PREVIEW, null, "[\"candidateCount\", \"maxIterations\", \"localRefinementPasses\", \"gridNm\", \"timeoutMs\"]"],
      [PREVIEW, null, "publicJsonRoute({ maxBytes: 16_000_000, deadlineMs: 45_000 }"],
      [PREVIEW, null, "runPlacementCandidate({ board: input.board, request: request(input.options) })"],
      ["app/lib/auth/route-policy.ts", null, "pub(\"/api/pcb/placement/preview\", [\"POST\"], \"stateless compute\")"],
      [HANDLERS, "export function publicJsonRoute", "const readOpts = { maxBytes: options.maxBytes, ...(options.deadlineMs"],
      [HANDLERS, "export function publicJsonRoute", "readBoundedJsonObject(request, readOpts)"],
    ];
    const wrong = citations.filter(([path, within, anchor]) => anchorOccurrences(ROOT, { path, within, anchor }) !== 1).map(([path, within, anchor]) => `${path} ${within ?? ""} ${anchor}`);
    expect(wrong).toEqual([]);
    const page = pageCitations(readFileSync(join(ROOT, "artifacts", "ai-control-plane-b20", "mcp-server-proposals.md"), "utf8"));
    for (const [path, within, anchor] of citations) {
      const row = page.find((citation) => citation.path === path && citation.within === within && citation.anchor === anchor);
      expect(row, `${path} ${anchor}`).toBeDefined();
      expect(row!.line, `${path} ${anchor}`).toBeGreaterThan(0);
    }
  });
});
