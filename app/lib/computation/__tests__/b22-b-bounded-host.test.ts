/**
 * [B22-B] The bounded engine host (OD-140; discovery D22-17, section 8 item 7): in-process computations run in a `worker_threads`
 * Worker started only from the host's closed entry table, with an EMPTY environment, no inherited execArgv, JS-engine heap limits
 * (`resourceLimits`) and a hard `terminate()` at the budget. A computation that ignores its budget is stopped; nothing it posts
 * after the budget fired becomes a result; one outcome per run; the host's running count returns to zero on every path.
 * Real workers run the fixtures under `__tests__/fixtures` (test entries replace a closed engine id's entry; the host's id check
 * stays closed); a fake worker pins the race at the budget and the options passed. No process, network or model is started.
 * [B22-B review] Cases 6, 8 and 9 also pin the whole V8 heap-flag family (security-1, tests-3), the per-process cap of 2 shared by
 * every chat request with a share of 1 per tenant (coverage-2, security-2) and the unconfirmed exit (tests-6).
 */
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  ENGINE_HOST_ENGINE_IDS,
  ENGINE_HOST_MAX_RUNNING,
  ENGINE_HOST_MAX_RUNNING_PER_HOLDER,
  ENGINE_HOST_PROFILES,
  EngineHostError,
  createEngineHost,
  defaultEngineHost,
  heapLimitOverrideFlags,
  type EngineBudget,
  type EngineHost,
  type EngineRunRequest,
  type EngineWorker,
} from "@/app/lib/computation/engine-host";
import { createComputationPort } from "@/app/lib/computation/computation-port";
import { createComputationRequestExecutors } from "@/app/lib/computation/request-executors";
import { sealComputationRequest } from "@/app/lib/computation/requests";

const ANALYTICAL = "sirkit.engine.analytical-equations/1";
const COMPARE = "sirkit.engine.artifact-compare/1";
const PLACEMENT = "sirkit.engine.placement-experiment/1";
const fixture = (name: string): URL => new URL(`./fixtures/${name}`, import.meta.url);
const BUDGET: EngineBudget = { wallClockMs: 400, heapMiB: 32, maxOutputBytes: 8_192 };
const hostWith = (name: string, engineId = ANALYTICAL) => createEngineHost({ entries: { [engineId]: fixture(name) } });

class FakeWorker extends EventEmitter implements EngineWorker {
  terminations = 0;
  constructor(readonly entry: URL, readonly options: Record<string, unknown>) { super(); }
  terminate(): Promise<number> {
    this.terminations += 1;
    queueMicrotask(() => this.emit("exit", 1));
    return Promise.resolve(1);
  }
}
/** A worker whose exit arrives 150 ms after terminate is asked (the window in which a late answer can still arrive). */
class SlowExitWorker extends FakeWorker {
  override terminate(): Promise<number> {
    this.terminations += 1;
    return new Promise((resolve) => setTimeout(() => { this.emit("exit", 1); resolve(1); }, 150));
  }
}

describe("[B22-B] the bounded engine host (OD-140)", () => {
  it("1. the production entry runs a real engine to completion inside its budget: the closed analytical engine answers the divider's quantities; the worker sees an empty environment and no inherited execArgv; the running count returns to zero", { timeout: 30_000 }, async () => {
    // the suite's own process carries no V8 heap-size flag, so the default host starts workers whose resourceLimits hold
    expect(heapLimitOverrideFlags(process.execArgv, process.env.NODE_OPTIONS)).toEqual([]);
    const host = createEngineHost();
    const outcome = await host.run({ engineId: ANALYTICAL, input: { equation: "resistor-divider", vin: 5, r1: 1_000, r2: 2_000 }, budget: { ...BUDGET, wallClockMs: 10_000 } });
    expect(outcome.state).toBe("completed");
    if (outcome.state !== "completed") return;
    const quantities = (outcome.output as { quantities: Array<{ name: string; value: number; unit: string }> }).quantities;
    expect(quantities.find((quantity) => quantity.name === "vout")?.value).toBeCloseTo(10 / 3, 9);
    expect(quantities.find((quantity) => quantity.name === "current")?.value).toBeCloseTo(5 / 3_000, 12);
    expect(host.running()).toBe(0);
    const env = await hostWith("engine-env-report.mjs").run({ engineId: ANALYTICAL, input: {}, budget: { ...BUDGET, wallClockMs: 10_000 } });
    expect(env).toMatchObject({ state: "completed", output: { envKeys: 0, execArgv: 0 } });
  });

  it("2. terminate at budget: a computation that never yields is stopped at its wall clock - terminated, reason budget, the stop confirmed by the worker's exit - well before any outer timeout, and the host frees its slot", { timeout: 30_000 }, async () => {
    const host = hostWith("engine-busy-loop.mjs");
    const started = Date.now();
    const outcome = await host.run({ engineId: ANALYTICAL, input: {}, budget: BUDGET });
    const elapsed = Date.now() - started;
    expect(outcome).toMatchObject({ state: "terminated", reason: "budget", confirmed: true, started: true });
    expect(elapsed).toBeGreaterThanOrEqual(BUDGET.wallClockMs - 20);
    expect(elapsed).toBeLessThan(BUDGET.wallClockMs + 5_000);
    expect(host.running()).toBe(0);
    expect("output" in outcome).toBe(false);
  });

  it("3. no result after termination: a computation that blocks past its budget and then answers yields no output; with a fake worker, a message that arrives after the budget fired - before or after terminate settles - is dropped, and only the first answer of a run ever counts", { timeout: 30_000 }, async () => {
    const late = await hostWith("engine-late-result.mjs").run({ engineId: ANALYTICAL, input: { delayMs: 1_500 }, budget: BUDGET });
    expect(late).toMatchObject({ state: "terminated", reason: "budget" });
    expect(JSON.stringify(late)).not.toContain("late");
    const two = await hostWith("engine-two-messages.mjs").run({ engineId: ANALYTICAL, input: {}, budget: { ...BUDGET, wallClockMs: 10_000 } });
    expect(two).toMatchObject({ state: "completed", output: { answer: 1 } });

    let worker: FakeWorker | null = null;
    const host = createEngineHost({ workerFactory: (entry, options) => (worker = new FakeWorker(entry, options as unknown as Record<string, unknown>)) });
    const run = host.run({ engineId: ANALYTICAL, input: { equation: "resistor-divider", vin: 1, r1: 1, r2: 1 }, budget: { ...BUDGET, wallClockMs: 50 } });
    await new Promise((resolve) => setTimeout(resolve, 120));
    worker!.emit("message", { ok: true, output: { forged: true } });
    const outcome = await run;
    expect(outcome).toMatchObject({ state: "terminated", reason: "budget" });
    expect(JSON.stringify(outcome)).not.toContain("forged");
    expect(worker!.terminations).toBe(1);
    worker!.emit("message", { ok: true, output: { forged: true } });
    expect(host.running()).toBe(0);
    // terminate has not settled yet when the late answer arrives: still no result, and the outcome waits for the exit
    let slow: SlowExitWorker | null = null;
    const slowHost = createEngineHost({ workerFactory: (entry, options) => (slow = new SlowExitWorker(entry, options as unknown as Record<string, unknown>)) });
    const slowRun = slowHost.run({ engineId: ANALYTICAL, input: {}, budget: { ...BUDGET, wallClockMs: 50 } });
    await new Promise((resolve) => setTimeout(resolve, 90));
    expect(slow!.terminations).toBe(1);
    expect(slowHost.running()).toBe(1);
    slow!.emit("message", { ok: true, output: { forged: true } });
    const slowOutcome = await slowRun;
    expect(slowOutcome).toMatchObject({ state: "terminated", reason: "budget", confirmed: true });
    expect(JSON.stringify(slowOutcome)).not.toContain("forged");
    expect(slowHost.running()).toBe(0);
    // the first decided outcome wins on every path: an engine error and an abort that arrive after the answer, before the exit, change
    // nothing (terminate is asked once)
    let early: SlowExitWorker | null = null;
    const controller = new AbortController();
    const firstHost = createEngineHost({ workerFactory: (entry, options) => (early = new SlowExitWorker(entry, options as unknown as Record<string, unknown>)) });
    const firstRun = firstHost.run({ engineId: ANALYTICAL, input: {}, budget: { ...BUDGET, wallClockMs: 5_000 }, signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 10));
    early!.emit("message", { ok: true, output: { answer: 1 } });
    early!.emit("error", Object.assign(new Error("late"), { code: "ERR_WORKER_OUT_OF_MEMORY" }));
    controller.abort();
    expect(await firstRun).toMatchObject({ state: "completed", output: { answer: 1 } });
    expect(early!.terminations).toBe(1);
    expect(firstHost.running()).toBe(0);
  });

  it("4. an abort stops the run (reason cancelled, confirmed), and a signal already aborted starts no worker at all", { timeout: 30_000 }, async () => {
    const controller = new AbortController();
    const host = hostWith("engine-busy-loop.mjs");
    const run = host.run({ engineId: ANALYTICAL, input: {}, budget: { ...BUDGET, wallClockMs: 9_000 }, signal: controller.signal });
    setTimeout(() => controller.abort(), 150);
    expect(await run).toMatchObject({ state: "terminated", reason: "cancelled", confirmed: true, started: true });
    let created = 0;
    const counting = createEngineHost({ workerFactory: (entry, options) => { created += 1; return new FakeWorker(entry, options as unknown as Record<string, unknown>); } });
    const aborted = new AbortController();
    aborted.abort();
    expect(await counting.run({ engineId: ANALYTICAL, input: {}, budget: BUDGET, signal: aborted.signal })).toMatchObject({ state: "terminated", reason: "cancelled", started: false });
    expect(created).toBe(0);
  });

  it("5. the JS-engine heap limit holds: an allocation without bound ends as a resource-limit termination and the server process carries on; a thrown error, a silent exit, a non-JSON or an over-bound answer is a closed failure that names no host detail", { timeout: 60_000 }, async () => {
    const oom = await hostWith("engine-allocate.mjs").run({ engineId: ANALYTICAL, input: {}, budget: { ...BUDGET, heapMiB: 16, wallClockMs: 9_000 } });
    expect(oom).toMatchObject({ state: "terminated", reason: "resource-limit" });
    expect(process.memoryUsage().heapUsed).toBeGreaterThan(0);
    const thrown = await hostWith("engine-throws.mjs").run({ engineId: ANALYTICAL, input: {}, budget: { ...BUDGET, wallClockMs: 10_000 } });
    expect(thrown).toMatchObject({ state: "failed", code: "ENGINE_FAILED" });
    expect(JSON.stringify(thrown)).not.toMatch(/secret-folder|Users/);
    expect(await hostWith("engine-exit-silent.mjs").run({ engineId: ANALYTICAL, input: {}, budget: { ...BUDGET, wallClockMs: 10_000 } })).toMatchObject({ state: "failed", code: "ENGINE_EXITED_WITHOUT_RESULT" });
    expect(await hostWith("engine-huge-output.mjs").run({ engineId: ANALYTICAL, input: {}, budget: { ...BUDGET, wallClockMs: 10_000 } })).toMatchObject({ state: "failed", code: "ENGINE_OUTPUT_OVER_LIMIT" });
    let worker: FakeWorker | null = null;
    const host = createEngineHost({ workerFactory: (entry, options) => (worker = new FakeWorker(entry, options as unknown as Record<string, unknown>)) });
    const run = host.run({ engineId: ANALYTICAL, input: {}, budget: BUDGET });
    await new Promise((resolve) => setTimeout(resolve, 10));
    worker!.emit("message", { ok: true, output: { at: new Date(0) } });
    expect(await run).toMatchObject({ state: "failed", code: "ENGINE_OUTPUT_INVALID" });
  });

  it("6. refused before any worker: an unknown engine id (a lookalike, a prototype key), the placement experiment's engine (no worker entry in this build), a budget over the engine's ceiling or not a positive integer, a server process whose V8 heap-size flag would override the worker's heap limit, and a run over the host's running cap", { timeout: 30_000 }, async () => {
    let created = 0;
    const host = createEngineHost({ workerFactory: (entry, options) => { created += 1; return new FakeWorker(entry, options as unknown as Record<string, unknown>); }, maxRunning: 1 });
    const refusal = async (request: Parameters<typeof host.run>[0]): Promise<string> => {
      try {
        await host.run(request);
        return "ran";
      } catch (error) {
        return error instanceof EngineHostError ? error.code : "other";
      }
    };
    for (const engineId of ["sirkit.engine.shell/1", "__proto__", "constructor", `${ANALYTICAL} `]) expect(await refusal({ engineId, input: {}, budget: BUDGET }), engineId).toBe("ENGINE_UNKNOWN");
    expect(await refusal({ engineId: PLACEMENT, input: {}, budget: BUDGET })).toBe("ENGINE_UNAVAILABLE");
    expect(ENGINE_HOST_PROFILES[PLACEMENT]!.entry).toBeNull();
    expect(ENGINE_HOST_PROFILES[PLACEMENT]!.unavailableReason).toMatch(/worker entry/);
    for (const budget of [{ ...BUDGET, wallClockMs: 0 }, { ...BUDGET, wallClockMs: 1.5 }, { ...BUDGET, wallClockMs: ENGINE_HOST_PROFILES[ANALYTICAL]!.ceiling.wallClockMs + 1 }, { ...BUDGET, heapMiB: ENGINE_HOST_PROFILES[ANALYTICAL]!.ceiling.heapMiB + 1 }, { ...BUDGET, maxOutputBytes: -1 }]) {
      expect(await refusal({ engineId: ANALYTICAL, input: {}, budget }), JSON.stringify(budget)).toBe("ENGINE_BUDGET_INVALID");
    }
    expect(created).toBe(0);
    // a process-wide V8 heap-size flag overrides a worker's resourceLimits (the Node docs): the host refuses closed, nothing starts
    const flagged = createEngineHost({ workerFactory: (entry, options) => { created += 1; return new FakeWorker(entry, options as unknown as Record<string, unknown>); }, heapFlags: () => ["--max-old-space-size=4096"] });
    await expect(flagged.run({ engineId: ANALYTICAL, input: {}, budget: BUDGET })).rejects.toMatchObject({ code: "ENGINE_HEAP_LIMIT_OVERRIDDEN" });
    expect(created).toBe(0);
    expect(heapLimitOverrideFlags(["--max-old-space-size=4096", "--enable-source-maps"], undefined)).toEqual(["--max-old-space-size=4096"]);
    expect(heapLimitOverrideFlags([], "--inspect --max_semi_space_size=16  --max-heap-size=64")).toEqual(["--max_semi_space_size=16", "--max-heap-size=64"]);
    expect(heapLimitOverrideFlags(["--conditions=react-server"], "--enable-source-maps --max-old-space")).toEqual([]);
    // [B22-B review] security-1, tests-3: the whole flag family - Node 24's `--max-old-space-size-percentage` "takes precedence over
    // --max-old-space-size" (node --help) - and NODE_OPTIONS read the way Node reads it (a double quote is dropped, not a token start)
    for (const flag of ["--max-old-space-size-percentage=50", "--max_old_space_size_percentage=50", "--max-old-space-size-percentage", "-max-old-space-size=64"]) {
      expect(heapLimitOverrideFlags([flag], undefined), flag).toEqual([flag]);
      expect(heapLimitOverrideFlags([], `--enable-source-maps ${flag}`), flag).toEqual([flag]);
    }
    expect(heapLimitOverrideFlags([], "\"--max-old-space-size=2048\"")).toEqual(["--max-old-space-size=2048"]);
    expect(heapLimitOverrideFlags([], "--inspect \"--max-old-space-size-percentage=25\" --enable-source-maps")).toEqual(["--max-old-space-size-percentage=25"]);
    expect(heapLimitOverrideFlags([], "--max-old-space-size=\"4096\"")).toEqual(["--max-old-space-size=4096"]);
    const quoted = createEngineHost({ workerFactory: (entry, options) => { created += 1; return new FakeWorker(entry, options as unknown as Record<string, unknown>); }, heapFlags: () => heapLimitOverrideFlags([], "\"--max-old-space-size-percentage=25\"") });
    await expect(quoted.run({ engineId: ANALYTICAL, input: {}, budget: BUDGET })).rejects.toMatchObject({ code: "ENGINE_HEAP_LIMIT_OVERRIDDEN" });
    expect(created).toBe(0);
    const first = host.run({ engineId: COMPARE, input: {}, budget: { ...BUDGET, wallClockMs: 100 } });
    expect(await refusal({ engineId: ANALYTICAL, input: {}, budget: BUDGET })).toBe("ENGINE_HOST_BUSY");
    await first;
    expect(host.running()).toBe(0);
    expect(ENGINE_HOST_MAX_RUNNING).toBeGreaterThan(0);
    expect([...ENGINE_HOST_ENGINE_IDS].sort()).toEqual([ANALYTICAL, COMPARE, "sirkit.engine.artifact-parse/1", PLACEMENT].sort());
  });

  it("7. the worker is started only one way: the entry from the closed table (a file URL, never source text), an empty environment, no execArgv, the budget's heap as resourceLimits, stdout and stderr not piped to the server, the engine id and the input as workerData - never `eval`", async () => {
    let seen: FakeWorker | null = null;
    const host = createEngineHost({ workerFactory: (entry, options) => (seen = new FakeWorker(entry, options as unknown as Record<string, unknown>)) });
    const run = host.run({ engineId: ANALYTICAL, input: { equation: "rc-step", vin: 1, r: 1, c: 1, time: 1 }, budget: BUDGET });
    await new Promise((resolve) => setTimeout(resolve, 10));
    seen!.emit("message", { ok: true, output: { quantities: [] } });
    await run;
    expect(seen!.entry.protocol).toBe("file:");
    expect(seen!.entry.pathname.endsWith("/app/lib/computation/engine-worker.mjs")).toBe(true);
    expect(seen!.options).toEqual({
      env: {},
      execArgv: [],
      argv: [],
      stdout: true,
      stderr: true,
      resourceLimits: { maxOldGenerationSizeMb: BUDGET.heapMiB, maxYoungGenerationSizeMb: ENGINE_HOST_PROFILES[ANALYTICAL]!.youngGenerationMiB, codeRangeSizeMb: ENGINE_HOST_PROFILES[ANALYTICAL]!.codeRangeMiB, stackSizeMb: ENGINE_HOST_PROFILES[ANALYTICAL]!.stackMiB },
      workerData: { engineId: ANALYTICAL, input: { equation: "rc-step", vin: 1, r: 1, c: 1, time: 1 } },
      name: ANALYTICAL,
    });
    expect("eval" in seen!.options).toBe(false);
  });

  it("8. [B22-B review] the caps and the unconfirmed exit: at most 2 engine workers per host and 1 per tenant (holder), so one tenant never holds every slot; a worker whose exit never comes answers `confirmed: false` after the confirm wait and keeps its slot (and its tenant's share) until the exit is observed", { timeout: 30_000 }, async () => {
    expect(ENGINE_HOST_MAX_RUNNING).toBe(2);
    expect(ENGINE_HOST_MAX_RUNNING_PER_HOLDER).toBe(1);
    const workers: FakeWorker[] = [];
    const host = createEngineHost({ workerFactory: (entry, options) => { const worker = new FakeWorker(entry, options as unknown as Record<string, unknown>); workers.push(worker); return worker; } });
    const code = async (run: Promise<unknown>): Promise<string> => {
      try {
        await run;
        return "ran";
      } catch (error) {
        return error instanceof EngineHostError ? error.code : "other";
      }
    };
    const runFor = (holder: string) => host.run({ engineId: ANALYTICAL, input: {}, budget: { ...BUDGET, wallClockMs: 5_000 }, holder });
    const a = runFor("tenant-a");
    expect(host.running()).toBe(1);
    // security-2: tenant a's second run is refused although a slot is free; tenant b takes it; tenant c finds the host full
    expect(await code(runFor("tenant-a"))).toBe("ENGINE_HOST_BUSY");
    expect(host.running()).toBe(1);
    const b = runFor("tenant-b");
    expect(host.running()).toBe(2);
    expect(await code(runFor("tenant-c"))).toBe("ENGINE_HOST_BUSY");
    expect(workers).toHaveLength(2);
    workers[0]!.emit("message", { ok: true, output: { answer: "a" } });
    expect(await a).toMatchObject({ state: "completed", output: { answer: "a" } });
    expect(host.running()).toBe(1);
    const again = runFor("tenant-a");
    expect(host.running()).toBe(2);
    workers[1]!.emit("message", { ok: true, output: { answer: "b" } });
    workers[2]!.emit("message", { ok: true, output: { answer: "again" } });
    expect(await b).toMatchObject({ state: "completed", output: { answer: "b" } });
    expect(await again).toMatchObject({ state: "completed", output: { answer: "again" } });
    expect(host.running()).toBe(0);

    // coverage-2, tests-6: an exit that never comes - `confirmed: false` after the confirm wait, the slot and the share held until the exit
    class HangingWorker extends FakeWorker {
      override terminate(): Promise<number> {
        this.terminations += 1;
        return new Promise<number>(() => undefined);
      }
    }
    let hanging: HangingWorker | null = null;
    const held = createEngineHost({ workerFactory: (entry, options) => (hanging = new HangingWorker(entry, options as unknown as Record<string, unknown>)), confirmMs: 60 });
    const started = Date.now();
    const stuck = await held.run({ engineId: ANALYTICAL, input: {}, budget: { ...BUDGET, wallClockMs: 40 }, holder: "tenant-a" });
    expect(stuck).toMatchObject({ state: "terminated", reason: "budget", confirmed: false, started: true });
    expect(Date.now() - started).toBeGreaterThanOrEqual(90);
    expect(hanging!.terminations).toBe(1);
    expect(held.running()).toBe(1);
    expect(await code(held.run({ engineId: ANALYTICAL, input: {}, budget: BUDGET, holder: "tenant-a" }))).toBe("ENGINE_HOST_BUSY");
    hanging!.emit("exit", 1);
    expect(held.running()).toBe(0);
    const after = held.run({ engineId: ANALYTICAL, input: {}, budget: BUDGET, holder: "tenant-a" });
    expect(held.running()).toBe(1);
    hanging!.emit("message", { ok: true, output: { answer: 2 } });
    hanging!.emit("exit", 0);
    expect(await after).toMatchObject({ state: "completed", output: { answer: 2 } });
  });

  it("9. [B22-B review] coverage-2, security-2: the server process has ONE engine host - every chat request's port and the request executors use it by default, so N chats share its cap of 2 - and both name the request's server-derived tenant as the holder", { timeout: 30_000 }, async () => {
    const key = Symbol.for("sirkit.computation.engine-host.v1");
    const global = globalThis as unknown as Record<symbol, EngineHost | undefined>;
    const previous = global[key];
    try {
      const asked: EngineRunRequest[] = [];
      const recording: EngineHost = { running: () => 0, run: async (request) => { asked.push(request); return { state: "refused", code: "RECORDED_HERE", elapsedMs: 0 }; } };
      global[key] = recording;
      expect(defaultEngineHost()).toBe(recording);
      expect(defaultEngineHost()).toBe(defaultEngineHost());
      const scope = { tenantId: "tenant-b22b", projectId: "p-b22b", branchId: "main" };
      const request = (port: ReturnType<typeof createComputationPort>, tenantId: string) => port.evaluate({ kindId: "sirkit.computation.analytical-equation", kindVersion: "1.0.0", input: { equation: "resistor-divider", vin: 5, r1: 1_000, r2: 2_000 }, scope: { ...scope, tenantId }, runId: `run-${tenantId}`, canonicalBoard: null, deadlineMs: 2_000, signal: new AbortController().signal });
      expect(await request(createComputationPort(), scope.tenantId)).toEqual({ state: "refused", code: "RECORDED_HERE" });
      const sealed = sealComputationRequest({ kindId: "sirkit.computation.layout-experiment", args: { experiment: "placement", seed: 3, budgetSeconds: 20 }, scope, requestedBy: { actorId: "agent-run-1", actorKind: "agent" }, now: Date.parse("2026-10-01T12:00:00.000Z"), nonce: "9".repeat(32) });
      if (!sealed.ok) throw new Error(sealed.errors.join("; "));
      const evidence = await createComputationRequestExecutors()["sirkit.computation.layout-experiment"]!(sealed.request);
      expect(evidence).toMatchObject({ outcome: "refused", refusal: "RECORDED_HERE" });
      expect(asked.map((entry) => [entry.engineId, entry.holder])).toEqual([["sirkit.engine.analytical-equations/1", scope.tenantId], [PLACEMENT, scope.tenantId]]);
      // the default host's cap spans ports: two chat requests (two tenants) hold both slots, a third request's port is refused busy
      const workers: FakeWorker[] = [];
      global[key] = createEngineHost({ workerFactory: (entry, options) => { const worker = new FakeWorker(entry, options as unknown as Record<string, unknown>); workers.push(worker); return worker; } });
      const one = request(createComputationPort(), "tenant-1");
      const two = request(createComputationPort(), "tenant-2");
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(defaultEngineHost().running()).toBe(2);
      expect(await request(createComputationPort(), "tenant-3")).toEqual({ state: "refused", code: "ENGINE_HOST_BUSY" });
      for (const worker of workers) worker.emit("message", { ok: false, code: "TEST_DONE" });
      expect(await one).toEqual({ state: "refused", code: "TEST_DONE" });
      expect(await two).toEqual({ state: "refused", code: "TEST_DONE" });
      expect(defaultEngineHost().running()).toBe(0);
    } finally {
      if (previous === undefined) delete global[key];
      else global[key] = previous;
    }
  });
});
