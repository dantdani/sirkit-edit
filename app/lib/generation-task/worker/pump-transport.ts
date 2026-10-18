/**
 * [PR-L, 2026-10-17] Runbook L.4, increment 4 (task-worker-contract.md section 4; worker.md): the CLIENT side of the HTTP pump - the
 * worker PROCESS's loop that drives a server's generation-task store by POSTing `/api/generation-worker` (the route runs the slice:
 * `runPumpedSlice` in runtime.ts). It was the refusing seam `createPumpTransport` in runtime.ts; it is a module of its own so that no route's
 * import closure reaches a network client (the only importer is scripts/generation-worker.ts). Same-origin by intent: `--origin` names the
 * Sirkit server whose store the worker serves; the request carries only the worker secret (`Authorization: Bearer`), never a design.
 */
import { GENERATION_SLICE_POLICY } from "../contracts";
import { isoOf } from "../vocabulary";
import { GENERATION_WORKER_PUMP_ROUTE, GenerationWorkerSetupError, type GenerationTransportTick, type GenerationWorkerTransport } from "./runtime";
import type { GenerationSliceReport } from "./slices";
import type { GenerationTickReport } from "./worker";

/** The environment name of the worker secret the pump route verifies (`WORKER_SECRET_ENV` of `app/lib/auth/worker-principal.ts`, which a
 *  worker process may not import - the B16.0.1 auth import boundary; `l4-routes` case 6 pins the two equal). Its value is never printed. */
export const GENERATION_WORKER_SECRET_ENV = "SIRKIT_WORKFLOW_WORKER_SECRET";

export interface PumpTransportOptions {
  /** the server's origin (`--origin`) */
  origin: string;
  workerId: string;
  /** the worker secret the route verifies (`SIRKIT_WORKFLOW_WORKER_SECRET`); never printed */
  secret: string | undefined;
  /** pump requests in flight at once (1..3): each claims at most one slice */
  concurrency?: number;
  /** the wait after a request that found nothing to run */
  idleTickMs?: number;
  /** one pump request's own bound: the longest slice window plus the shutdown grace and a margin */
  requestTimeoutMs?: number;
  fetch?: typeof fetch;
  log?: (line: string) => void;
  clock?: () => number;
}

/** What the route answers: the claim outcomes of its tick and the slice it ran (or null: nothing was due). */
interface PumpResponse { ok?: unknown; tick?: GenerationTickReport; ran?: GenerationSliceReport | null; code?: unknown }

/**
 * The HTTP pump transport: the worker PROCESS drives a server's task store by POSTing `/api/generation-worker`; the route runs the
 * slice. A request that found nothing waits `idleTickMs`; a failure (the server not up yet, a refused secret, a store outage) backs off
 * up to 30 ticks and is logged once per streak (never a secret or a response body). `stop()` stops posting and aborts the requests
 * still in flight after the grace: the server treats that as a worker shutdown (the slices yield at a boundary or are released).
 */
export function createPumpTransport(options: PumpTransportOptions): GenerationWorkerTransport {
  const secret = (options.secret ?? "").trim();
  if (!secret) throw new GenerationWorkerSetupError("GENERATION_WORKER_SECRET_UNSET", `SIRKIT_WORKFLOW_WORKER_SECRET is not set, so ${options.origin}${GENERATION_WORKER_PUMP_ROUTE.path} would refuse every request (it fails closed without the secret). No slice was claimed.`);
  const fetchImpl = options.fetch ?? fetch;
  const clock = options.clock ?? (() => Date.now());
  const concurrency = Math.max(1, Math.min(GENERATION_SLICE_POLICY.workerConcurrency, Math.floor(options.concurrency ?? 1)));
  const idleTickMs = options.idleTickMs ?? 1_000;
  const requestTimeoutMs = options.requestTimeoutMs ?? GENERATION_SLICE_POLICY.blockWindowMs + 60_000;
  const log = (line: string): void => { try { options.log?.(line); } catch { /* a log sink never stops the worker */ } };
  const url = `${options.origin}${GENERATION_WORKER_PUMP_ROUTE.path}`;
  const startedAt = isoOf(clock());
  const inFlight = new Set<AbortController>();
  let lastTickAt: string | null = null, settled = 0, stopping = false;
  let loops: Promise<void>[] = [];
  const sleepers = new Set<() => void>();
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => {
    const handle = setTimeout(() => { sleepers.delete(wake); resolve(); }, ms);
    const wake = (): void => { clearTimeout(handle); sleepers.delete(wake); resolve(); };
    sleepers.add(wake);
  });

  async function post(): Promise<GenerationTransportTick> {
    const controller = new AbortController();
    inFlight.add(controller);
    const bound = setTimeout(() => controller.abort(new Error("GENERATION_WORKER_PUMP_TIMEOUT")), requestTimeoutMs);
    lastTickAt = isoOf(clock());
    try {
      const response = await fetchImpl(url, { method: GENERATION_WORKER_PUMP_ROUTE.method, headers: { authorization: `Bearer ${secret}` }, signal: controller.signal });
      const body = (await response.json().catch(() => ({}))) as PumpResponse;
      if (!response.ok || body.ok !== true) {
        const code = typeof body.code === "string" && /^[A-Z][A-Z0-9_]{2,63}$/.test(body.code) ? body.code : `HTTP_${response.status}`;
        throw new GenerationPumpError(code, response.status);
      }
      const tick: GenerationTickReport = body.tick ?? { at: isoOf(clock()), claims: [], started: [] };
      const slices = body.ran ? [body.ran] : [];
      settled += slices.length;
      return { tick, slices };
    } finally {
      clearTimeout(bound);
      inFlight.delete(controller);
    }
  }

  async function loop(index: number): Promise<void> {
    let failures = 0;
    while (!stopping) {
      try {
        const { slices } = await post();
        if (failures > 0) log(`pump ${index + 1}: the server answers again`);
        failures = 0;
        for (const slice of slices) log(`settled ${slice.kind} slice ${slice.sliceId}: ${slice.outcome}${slice.state ? ` (task ${slice.state})` : ""} - ${slice.detail}`);
        if (slices.length === 0 && !stopping) await sleep(idleTickMs);
      } catch (error) {
        if (stopping) break;
        failures += 1;
        if (failures === 1) log(`pump ${index + 1}: the request failed (${error instanceof GenerationPumpError ? error.code : error instanceof Error ? error.name : "error"}); retrying with backoff`);
        await sleep(idleTickMs * Math.min(30, 2 ** Math.min(5, failures)));
      }
    }
  }

  return {
    mode: "pump",
    async runOnce() {
      const answers = await Promise.all(Array.from({ length: concurrency }, () => post()));
      return { tick: { at: answers[0]!.tick.at, claims: answers.flatMap((answer) => answer.tick.claims), started: answers.flatMap((answer) => answer.tick.started) }, slices: answers.flatMap((answer) => answer.slices) };
    },
    start() {
      if (loops.length) return;
      stopping = false;
      loops = Array.from({ length: concurrency }, (_, index) => loop(index));
    },
    async stop(stopOptions) {
      stopping = true;
      for (const wake of [...sleepers]) wake();
      const all = Promise.allSettled(loops);
      let handle: ReturnType<typeof setTimeout> | null = null;
      const grace = new Promise<"grace">((resolve) => { handle = setTimeout(() => resolve("grace"), stopOptions?.graceMs ?? 10_000); });
      const first = await Promise.race([all, grace]);
      if (handle !== null) clearTimeout(handle);
      if (first === "grace") for (const controller of [...inFlight]) controller.abort(new Error("GENERATION_WORKER_SHUTDOWN"));
      await all;
      loops = [];
    },
    health() {
      return { mode: "pump", workerId: options.workerId, startedAt, running: inFlight.size, lastTickAt, stopping, slicesSettled: settled };
    },
  };
}

/** A pump request the server refused or could not answer (the route's closed code, or the HTTP status). */
export class GenerationPumpError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(`GENERATION_WORKER_PUMP_REFUSED: ${code}`);
    this.name = "GenerationPumpError";
  }
}
