/**
 * [B22-B] The bounded engine host (OD-140; discovery D22-17, section 8 item 7): the ONE place Sirkit starts a `worker_threads`
 * Worker, to run a named in-process computation off the request's thread with a HARD stop at its budget. Read before writing it
 * (2026-10-01): https://nodejs.org/api/worker_threads.html (v26.10.0) and the v24 page (v24.21.0; this host runs v24.15.0) -
 * `worker.terminate()` "Stop[s] all JavaScript execution in the worker thread as soon as possible" and its Promise is fulfilled when
 * `'exit'` is emitted; `resourceLimits` bound the JS engine's heaps and stack ("Reaching these limits leads to termination of the
 * Worker instance"), but "only affect the JS engine, and no external data, including no `ArrayBuffer`s", and a command-line
 * `--max-old-space-size` (`--max-semi-space-size`) "overrides this setting" (the v24 page), so the host refuses to start a worker
 * while the server process carries a V8 heap-size flag; `env` defaults to `process.env`, so the host passes an empty one;
 * `execArgv` is inherited unless given, so the host passes none.
 *
 * A worker starts only from the host's closed entry table (a file URL; never source text, never `eval`), with an empty environment,
 * no execArgv, the budget's heap as `resourceLimits`, stdout and stderr not piped to the server, and the engine id and the input as
 * workerData. The wall clock (and an abort) call `terminate()`; a run is terminal once the worker's `'exit'` is observed, or as
 * `confirmed: false` after a bounded wait (its slot stays held until the exit). Nothing a worker posts after its budget fired, and
 * nothing after its first answer, becomes a result; an answer must be plain JSON within the budget's output bound.
 *
 * What it is NOT: a sandbox or an isolation boundary. A worker is a thread of the server process: it shares the process's file
 * system, network and OS limits, and its heap limit does not bound external memory. It bounds TIME and the JS heap of Sirkit's own
 * closed engines; it is never used for model-supplied code (OD-149 - no such input exists).
 */
import { Worker } from "node:worker_threads";

export const ENGINE_HOST_ENGINE_IDS = Object.freeze([
  "sirkit.engine.analytical-equations/1",
  "sirkit.engine.artifact-compare/1",
  "sirkit.engine.artifact-parse/1",
  "sirkit.engine.placement-experiment/1",
] as const);
export type EngineId = (typeof ENGINE_HOST_ENGINE_IDS)[number];

/** The one worker entry: Sirkit's closed engine table (plain JavaScript; it imports worker_threads and nothing else). */
export const ENGINE_WORKER_ENTRY = new URL("./engine-worker.mjs", import.meta.url);
/** At most this many engine workers run at once in one server process; one more is refused `ENGINE_HOST_BUSY` (no queue). */
export const ENGINE_HOST_MAX_RUNNING = 2;
/** [B22-B review] security-2: one holder (the server-derived tenant a caller passes) runs at most this many at once, so one tenant
 *  never holds every slot and another tenant's run always finds one that tenant cannot take (refused `ENGINE_HOST_BUSY`, no queue). */
export const ENGINE_HOST_MAX_RUNNING_PER_HOLDER = 1;
/** How long the host waits for a terminated worker's `'exit'` before it answers `confirmed: false`. */
export const ENGINE_TERMINATE_CONFIRM_MS = 5_000;

export interface EngineBudget { readonly wallClockMs: number; readonly heapMiB: number; readonly maxOutputBytes: number }
export interface EngineHostProfile {
  readonly engineId: EngineId;
  readonly profileId: string;
  /** The worker entry, or null: the engine has none in this build and is refused `ENGINE_UNAVAILABLE`. */
  readonly entry: URL | null;
  readonly unavailableReason: string | null;
  readonly ceiling: EngineBudget;
  readonly youngGenerationMiB: number;
  readonly codeRangeMiB: number;
  readonly stackMiB: number;
}
const profile = (engineId: EngineId, ceiling: EngineBudget, entry: URL | null, unavailableReason: string | null = null): EngineHostProfile =>
  Object.freeze({ engineId, profileId: `engine-host:${engineId.slice("sirkit.engine.".length)}`, entry, unavailableReason, ceiling: Object.freeze(ceiling), youngGenerationMiB: 8, codeRangeMiB: 16, stackMiB: 4 });
/** The experiment profile and the in-process engines' profiles: the ceiling each run's budget may not exceed. */
export const ENGINE_HOST_PROFILES: Readonly<Record<EngineId, EngineHostProfile>> = Object.freeze({
  "sirkit.engine.analytical-equations/1": profile("sirkit.engine.analytical-equations/1", { wallClockMs: 10_000, heapMiB: 64, maxOutputBytes: 16_384 }, ENGINE_WORKER_ENTRY),
  "sirkit.engine.artifact-compare/1": profile("sirkit.engine.artifact-compare/1", { wallClockMs: 10_000, heapMiB: 64, maxOutputBytes: 16_384 }, ENGINE_WORKER_ENTRY),
  "sirkit.engine.artifact-parse/1": profile("sirkit.engine.artifact-parse/1", { wallClockMs: 15_000, heapMiB: 256, maxOutputBytes: 16_384 }, ENGINE_WORKER_ENTRY),
  "sirkit.engine.placement-experiment/1": profile("sirkit.engine.placement-experiment/1", { wallClockMs: 60_000, heapMiB: 512, maxOutputBytes: 16_384 }, null,
    "the placement engine is TypeScript whose module graph a worker cannot load without a build step B22-B does not add, so this build has no worker entry for it; it is refused, never run on the request's thread"),
});

/** A V8 heap-size flag on the server process: the Node docs (read 2026-10-01) say `--max-old-space-size` overrides a worker's
 *  `maxOldGenerationSizeMb` and `--max-semi-space-size` its `maxYoungGenerationSizeMb` (V8 flags are process-wide). [B22-B review]
 *  security-1: the whole family - Node 24's `--max-old-space-size-percentage` sets the same V8 limit and "takes precedence over
 *  --max-old-space-size" (node --help, v24.15.0) - in either separator, with one or two dashes, any case (closed: a near miss refuses). */
const HEAP_SIZE_FLAG = /^--?max[-_](?:old[-_]space|semi[-_]space|young[-_]generation|heap)[-_]size(?:[-_]percentage)?(?:=|$)/i;
/** The heap-size flags in the process's own arguments and in NODE_OPTIONS (empty: the budget's heap limits hold). [B22-B review]
 *  security-1: NODE_OPTIONS is read conservatively - Node drops each double quote and an in-string backslash before it splits on
 *  spaces, so every quote and backslash is removed and any whitespace splits: no flag Node would apply is missed (a quoted value that
 *  merely contains such a flag's text is refused too - closed). */
export function heapLimitOverrideFlags(execArgv: readonly string[], nodeOptions: string | undefined): string[] {
  return [...execArgv, ...(nodeOptions ?? "").replace(/["\\]/g, "").split(/\s+/)].filter((flag) => HEAP_SIZE_FLAG.test(flag));
}
/** The server process's own heap-size flags (process.execArgv and NODE_OPTIONS, read at each call). */
export const processHeapLimitOverrideFlags = (): readonly string[] => heapLimitOverrideFlags(process.execArgv, process.env.NODE_OPTIONS);

export type EngineHostErrorCode = "ENGINE_UNKNOWN" | "ENGINE_UNAVAILABLE" | "ENGINE_BUDGET_INVALID" | "ENGINE_HEAP_LIMIT_OVERRIDDEN" | "ENGINE_HOST_BUSY";
/** A refusal before any worker starts: a closed code and a fixed text. */
export class EngineHostError extends Error {
  readonly code: EngineHostErrorCode;
  constructor(code: EngineHostErrorCode, text: string) {
    super(`${code}: ${text}`);
    this.name = "EngineHostError";
    this.code = code;
  }
}

export type EngineOutcome =
  | { readonly state: "completed"; readonly output: unknown; readonly elapsedMs: number }
  | { readonly state: "refused"; readonly code: string; readonly elapsedMs: number }
  | { readonly state: "terminated"; readonly reason: "budget" | "cancelled" | "resource-limit"; readonly confirmed: boolean; readonly started: boolean; readonly elapsedMs: number }
  | { readonly state: "failed"; readonly code: "ENGINE_START_FAILED" | "ENGINE_FAILED" | "ENGINE_EXITED_WITHOUT_RESULT" | "ENGINE_OUTPUT_INVALID" | "ENGINE_OUTPUT_OVER_LIMIT"; readonly elapsedMs: number };

export interface EngineRunRequest {
  readonly engineId: string;
  readonly input: unknown;
  readonly budget: EngineBudget;
  readonly signal?: AbortSignal;
  /** [B22-B review] security-2: the server-derived tenant the run belongs to (its share of the host); runs without one share "". */
  readonly holder?: string;
}
/** What the host needs of a worker (Node's Worker, or a test's fake). */
export interface EngineWorker {
  on(event: string, listener: (value: unknown) => void): unknown;
  terminate(): Promise<number>;
  readonly stdout?: { resume(): unknown } | null;
  readonly stderr?: { resume(): unknown } | null;
}
export interface EngineWorkerOptions {
  readonly env: Record<string, never>;
  readonly execArgv: string[];
  readonly argv: string[];
  readonly stdout: true;
  readonly stderr: true;
  readonly resourceLimits: { readonly maxOldGenerationSizeMb: number; readonly maxYoungGenerationSizeMb: number; readonly codeRangeSizeMb: number; readonly stackSizeMb: number };
  readonly workerData: { readonly engineId: string; readonly input: unknown };
  readonly name: string;
}
export interface EngineHost {
  run(request: EngineRunRequest): Promise<EngineOutcome>;
  /** Workers started and not yet exited (a slot is held until the exit is observed). */
  running(): number;
}
export interface EngineHostOptions {
  /** Test seam: replace a KNOWN engine id's entry with a fixture file (the id check stays closed). Production passes none. */
  readonly entries?: Readonly<Partial<Record<string, URL>>>;
  /** Test seam: a fake worker. Production starts Node's Worker. */
  readonly workerFactory?: (entry: URL, options: EngineWorkerOptions) => EngineWorker;
  readonly maxRunning?: number;
  readonly maxRunningPerHolder?: number;
  readonly confirmMs?: number;
  /** Test seam: the process's heap-size flags (production reads process.execArgv and NODE_OPTIONS). */
  readonly heapFlags?: () => readonly string[];
}

const startWorker = (entry: URL, options: EngineWorkerOptions): EngineWorker => new Worker(entry, options);
const ANSWER_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const positiveWithin = (value: unknown, ceiling: number): boolean => typeof value === "number" && Number.isInteger(value) && value > 0 && value <= ceiling;

/** Plain JSON only: null, booleans, finite numbers, strings, arrays and plain objects (no Date, Map, typed array or class instance). */
function isPlainJson(value: unknown, depth = 0): boolean {
  if (depth > 32) return false;
  if (value === null || typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isPlainJson(item, depth + 1));
  if (typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(value as Record<string, unknown>).every((item) => isPlainJson(item, depth + 1));
}

/** A host with its own running count. Production code uses `defaultEngineHost()` (one per server process). */
export function createEngineHost(options: EngineHostOptions = {}): EngineHost {
  const overrides = options.entries ?? {};
  const factory = options.workerFactory ?? startWorker;
  const maxRunning = options.maxRunning ?? ENGINE_HOST_MAX_RUNNING;
  const maxRunningPerHolder = options.maxRunningPerHolder ?? ENGINE_HOST_MAX_RUNNING_PER_HOLDER;
  const confirmMs = options.confirmMs ?? ENGINE_TERMINATE_CONFIRM_MS;
  const heapFlags = options.heapFlags ?? processHeapLimitOverrideFlags;
  let running = 0;
  // [B22-B review] security-2: each holder's running count; a slot and its holder's share are taken together and released together
  const runningBy = new Map<string, number>();
  const take = (holder: string): void => { running += 1; runningBy.set(holder, (runningBy.get(holder) ?? 0) + 1); };
  const release = (holder: string): void => {
    running -= 1;
    const held = (runningBy.get(holder) ?? 1) - 1;
    if (held > 0) runningBy.set(holder, held);
    else runningBy.delete(holder);
  };
  return {
    running: () => running,
    async run(request: EngineRunRequest): Promise<EngineOutcome> {
      const engineId = request.engineId;
      if (typeof engineId !== "string" || !(ENGINE_HOST_ENGINE_IDS as readonly string[]).includes(engineId)) throw new EngineHostError("ENGINE_UNKNOWN", "no engine of the closed table has this id");
      const engine = ENGINE_HOST_PROFILES[engineId as EngineId];
      const entry = (Object.hasOwn(overrides, engineId) ? overrides[engineId] : undefined) ?? engine.entry;
      if (!entry) throw new EngineHostError("ENGINE_UNAVAILABLE", engine.unavailableReason ?? "the engine has no worker entry in this build");
      const budget = request.budget;
      if (!budget || !positiveWithin(budget.wallClockMs, engine.ceiling.wallClockMs) || !positiveWithin(budget.heapMiB, engine.ceiling.heapMiB) || !positiveWithin(budget.maxOutputBytes, engine.ceiling.maxOutputBytes)) {
        throw new EngineHostError("ENGINE_BUDGET_INVALID", "a budget is positive integers within the engine's ceiling");
      }
      // fail closed: a process-wide V8 heap-size flag would silently replace the budget's heap limit (Node docs), so nothing starts
      if (heapFlags().length > 0) throw new EngineHostError("ENGINE_HEAP_LIMIT_OVERRIDDEN", "the server process sets a V8 heap-size flag, which overrides a worker's resourceLimits; the engine's heap bound would not hold");
      if (request.signal?.aborted) return { state: "terminated", reason: "cancelled", confirmed: true, started: false, elapsedMs: 0 };
      if (running >= maxRunning) throw new EngineHostError("ENGINE_HOST_BUSY", `at most ${maxRunning} engine workers run at once`);
      const holder = typeof request.holder === "string" ? request.holder : "";
      if ((runningBy.get(holder) ?? 0) >= maxRunningPerHolder) throw new EngineHostError("ENGINE_HOST_BUSY", `one tenant runs at most ${maxRunningPerHolder} engine worker(s) at once`);
      const workerOptions: EngineWorkerOptions = {
        env: {},
        execArgv: [],
        argv: [],
        stdout: true,
        stderr: true,
        resourceLimits: { maxOldGenerationSizeMb: budget.heapMiB, maxYoungGenerationSizeMb: engine.youngGenerationMiB, codeRangeSizeMb: engine.codeRangeMiB, stackSizeMb: engine.stackMiB },
        workerData: { engineId, input: request.input },
        name: engineId,
      };
      const startedAt = Date.now();
      const elapsed = (): number => Math.max(0, Date.now() - startedAt);
      take(holder);
      let worker: EngineWorker;
      try {
        worker = factory(entry, workerOptions);
      } catch {
        release(holder);
        return { state: "failed", code: "ENGINE_START_FAILED", elapsedMs: elapsed() };
      }
      worker.stdout?.resume();
      worker.stderr?.resume();
      return new Promise<EngineOutcome>((resolve) => {
        // The first decided outcome is kept (`decided`); the run is answered only once the worker's exit is observed (or, unconfirmed,
        // after the confirm wait), so its slot is free when the caller hears the outcome - unless the exit never came.
        let decided: EngineOutcome | null = null;
        let resolved = false;
        let exited = false;
        let confirmTimer: ReturnType<typeof setTimeout> | undefined;
        const onAbort = (): void => decide({ state: "terminated", reason: "cancelled", confirmed: true, started: true, elapsedMs: elapsed() });
        const finish = (confirmed: boolean): void => {
          if (resolved || decided === null) return;
          resolved = true;
          clearTimeout(confirmTimer);
          request.signal?.removeEventListener("abort", onAbort);
          resolve(decided.state === "terminated" ? { ...decided, confirmed } : decided);
        };
        const decide = (outcome: EngineOutcome): void => {
          if (decided !== null) return; // one outcome per run: nothing after the budget fired, nothing after the first answer
          decided = outcome;
          clearTimeout(budgetTimer);
          if (exited) { finish(true); return; }
          confirmTimer = setTimeout(() => finish(false), confirmMs);
          void worker.terminate().catch(() => undefined);
        };
        const budgetTimer = setTimeout(() => decide({ state: "terminated", reason: "budget", confirmed: true, started: true, elapsedMs: elapsed() }), budget.wallClockMs);
        request.signal?.addEventListener("abort", onAbort, { once: true });
        worker.on("message", (message: unknown) => {
          if (decided !== null) return;
          const record = message as { ok?: unknown; output?: unknown; code?: unknown } | null;
          if (record === null || typeof record !== "object" || typeof record.ok !== "boolean") decide({ state: "failed", code: "ENGINE_OUTPUT_INVALID", elapsedMs: elapsed() });
          else if (record.ok === false) decide(typeof record.code === "string" && ANSWER_CODE.test(record.code) ? { state: "refused", code: record.code, elapsedMs: elapsed() } : { state: "failed", code: "ENGINE_OUTPUT_INVALID", elapsedMs: elapsed() });
          else if (!isPlainJson(record.output)) decide({ state: "failed", code: "ENGINE_OUTPUT_INVALID", elapsedMs: elapsed() });
          else if (JSON.stringify(record.output).length > budget.maxOutputBytes) decide({ state: "failed", code: "ENGINE_OUTPUT_OVER_LIMIT", elapsedMs: elapsed() });
          else decide({ state: "completed", output: record.output, elapsedMs: elapsed() });
        });
        worker.on("messageerror", () => decide({ state: "failed", code: "ENGINE_OUTPUT_INVALID", elapsedMs: elapsed() }));
        worker.on("error", (error: unknown) => {
          const code = (error as { code?: unknown } | null)?.code;
          decide(code === "ERR_WORKER_OUT_OF_MEMORY" ? { state: "terminated", reason: "resource-limit", confirmed: true, started: true, elapsedMs: elapsed() } : { state: "failed", code: "ENGINE_FAILED", elapsedMs: elapsed() });
        });
        worker.on("exit", () => {
          if (exited) return;
          exited = true;
          release(holder);
          if (decided === null) decide({ state: "failed", code: "ENGINE_EXITED_WITHOUT_RESULT", elapsedMs: elapsed() });
          else finish(true);
        });
      });
    },
  };
}

const hostKey = Symbol.for("sirkit.computation.engine-host.v1");
const holder = globalThis as typeof globalThis & { [hostKey]?: EngineHost };
/** The server process's one engine host (its running count survives a dev module reload, as the runner's does). */
export function defaultEngineHost(): EngineHost {
  holder[hostKey] ??= createEngineHost();
  return holder[hostKey];
}
