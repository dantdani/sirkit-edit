/**
 * [PR-L, 2026-10-17] Runbook L.4, increment 4 (task-worker-contract.md section 4; worker.md): the CLIENT side of the HTTP pump - the
 * worker PROCESS's loop that drives a server's generation-task store by POSTing `/api/generation-worker` (the route runs the slice:
 * `runPumpedSlice` in runtime.ts). It was the refusing seam `createPumpTransport` in runtime.ts; it is a module of its own so that no route's
 * import closure reaches a network client (the only importer is scripts/generation-worker.ts). Same-origin by intent: `--origin` names the
 * Sirkit server whose store the worker serves; the request carries only the worker secret (`Authorization: Bearer`), never a design.
 */
import { GENERATION_SLICE_POLICY } from "../contracts";
import { isoOf } from "../vocabulary";
import { GENERATION_WORKER_PUMP_ROUTE, GenerationWorkerSetupError, PUMP_HOLD_MAX_MS, type GenerationTransportTick, type GenerationWorkerTransport } from "./runtime";
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
  /** the wait after a request that found nothing to run (the first of a run of empty answers; the idle backoff doubles it from there) */
  idleTickMs?: number;
  /** [PR-L7, 2026-10-20] the idle backoff's ceiling: each further consecutive empty answer doubles the wait up to this (8 s by default);
   *  an answer that settled a slice resets it to `idleTickMs` (`pumpIdleWaitMs`) */
  idleMaxMs?: number;
  /** one pump request's own bound: the longest slice window plus the shutdown grace and a margin */
  requestTimeoutMs?: number;
  fetch?: typeof fetch;
  log?: (line: string) => void;
  clock?: () => number;
}

/** What the route answers: the claim outcomes of its tick and the slice it ran (or null: nothing was due); [PR-L7, 2026-10-20] `heldMs`
 *  when the server holds idle requests (the fixture's in-process work signal, `runHeldPumpedSlice`): how long this one waited. */
interface PumpResponse { ok?: unknown; tick?: GenerationTickReport; ran?: GenerationSliceReport | null; heldMs?: unknown; code?: unknown }

/** [PR-L7, 2026-10-20] The pump's default idle-backoff ceiling: an idle worker posts at most every 8 s (it posted every second; 812 of
 *  2,206 requests of one local fixture browser run were idle pump posts, all of them load on the dev server). */
export const PUMP_IDLE_MAX_MS = 8_000;

/** [PR-L7, 2026-10-20] The wait after the `emptyStreak`-th consecutive answer that found nothing to run (1, 2, 3, ...): `idleTickMs`, then
 *  doubling, never above `idleMaxMs` (and never below `idleTickMs`). Pure: the loop below and its unit test share it. */
export function pumpIdleWaitMs(emptyStreak: number, idleTickMs: number, idleMaxMs: number = PUMP_IDLE_MAX_MS): number {
  const ceiling = Math.max(idleTickMs, idleMaxMs);
  const doublings = Math.max(0, Math.min(30, Math.floor(emptyStreak) - 1));
  return Math.min(ceiling, idleTickMs * 2 ** doublings);
}

/**
 * The HTTP pump transport: the worker PROCESS drives a server's task store by POSTing `/api/generation-worker`; the route runs the
 * slice. A request that found nothing waits `idleTickMs`; [PR-L7, 2026-10-20] each further consecutive empty answer doubles that wait up
 * to `idleMaxMs` (the idle backoff, `pumpIdleWaitMs`), and an answer that settled a slice resets it, so an idle worker no longer loads the
 * server every second while a busy one still claims its next slice at once. A server that answers `heldMs` holds idle requests and
 * wakes them when work is committed (the fixture's in-process nudge): the wait is then asked of it (`?hold=<ms>`, the same doubling)
 * instead of slept here, so a Start or Resume is picked up at once. [PR-L7 verify, 2026-10-20] The hold asked is never more than a
 * server holds (`PUMP_HOLD_MAX_MS`), and any part of it the answer's `heldMs` says was not kept is slept here before the next request,
 * so a server that answers `heldMs` without holding (or a proxy that drops the query) degrades to the plain backoff, never to a tight
 * loop. A failure (the server not up yet, a refused secret, a store
 * outage) backs off up to 30 ticks and is logged once per streak (never a secret or a response body). `stop()` stops posting and aborts
 * the requests still in flight after the grace: the server treats that as a worker shutdown (the slices yield at a boundary or are released).
 * [PR-L7 verify, 2026-10-20] A held idle request is in flight, not asleep, so `stop()` cannot wake it: it ends with its hold (at most
 * `PUMP_HOLD_MAX_MS`, 8 s, inside the default 10 s grace, so nothing is aborted), and stopping an idle worker against a holding server
 * can take up to about 8 s (it was at once with the plain backoff). A grace shorter than the hold aborts it when the grace ends.
 */
export function createPumpTransport(options: PumpTransportOptions): GenerationWorkerTransport {
  const secret = (options.secret ?? "").trim();
  if (!secret) throw new GenerationWorkerSetupError("GENERATION_WORKER_SECRET_UNSET", `SIRKIT_WORKFLOW_WORKER_SECRET is not set, so ${options.origin}${GENERATION_WORKER_PUMP_ROUTE.path} would refuse every request (it fails closed without the secret). No slice was claimed.`);
  const fetchImpl = options.fetch ?? fetch;
  const clock = options.clock ?? (() => Date.now());
  const concurrency = Math.max(1, Math.min(GENERATION_SLICE_POLICY.workerConcurrency, Math.floor(options.concurrency ?? 1)));
  const idleTickMs = options.idleTickMs ?? 1_000;
  const idleMaxMs = options.idleMaxMs ?? PUMP_IDLE_MAX_MS; // [PR-L7, 2026-10-20] the idle backoff's ceiling
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

  async function post(holdMs = 0): Promise<GenerationTransportTick & { heldMs: number | null }> {
    const controller = new AbortController();
    inFlight.add(controller);
    const bound = setTimeout(() => controller.abort(new Error("GENERATION_WORKER_PUMP_TIMEOUT")), requestTimeoutMs + holdMs);
    lastTickAt = isoOf(clock());
    try {
      const response = await fetchImpl(holdMs >= 1 ? `${url}?hold=${Math.round(holdMs)}` : url, { method: GENERATION_WORKER_PUMP_ROUTE.method, headers: { authorization: `Bearer ${secret}` }, signal: controller.signal }); // [PR-L7, 2026-10-20] + the idle hold
      const body = (await response.json().catch(() => ({}))) as PumpResponse;
      if (!response.ok || body.ok !== true) {
        const code = typeof body.code === "string" && /^[A-Z][A-Z0-9_]{2,63}$/.test(body.code) ? body.code : `HTTP_${response.status}`;
        throw new GenerationPumpError(code, response.status);
      }
      const tick: GenerationTickReport = body.tick ?? { at: isoOf(clock()), claims: [], started: [] };
      const slices = body.ran ? [body.ran] : [];
      settled += slices.length;
      return { tick, slices, heldMs: typeof body.heldMs === "number" && Number.isFinite(body.heldMs) && body.heldMs >= 0 ? body.heldMs : null };
    } finally {
      clearTimeout(bound);
      inFlight.delete(controller);
    }
  }

  async function loop(index: number): Promise<void> {
    let failures = 0;
    let empty = 0; // [PR-L7, 2026-10-20] consecutive answers that found nothing to run (the idle backoff)
    let hold = 0; // [PR-L7, 2026-10-20] the wait the next request asks a holding server for (0: none)
    while (!stopping) {
      try {
        const { slices, heldMs } = await post(hold);
        if (failures > 0) log(`pump ${index + 1}: the server answers again`);
        failures = 0;
        for (const slice of slices) log(`settled ${slice.kind} slice ${slice.sliceId}: ${slice.outcome}${slice.state ? ` (task ${slice.state})` : ""} - ${slice.detail}`);
        if (slices.length > 0) { empty = 0; hold = 0; } // [PR-L7, 2026-10-20] a settled slice resets the backoff: the next request goes at once
        else if (!stopping) {
          if (heldMs !== null && heldMs < hold) await sleep(hold - heldMs); // [PR-L7 verify, 2026-10-20] the part of the asked hold the server did not keep
          empty += 1;
          const wait = pumpIdleWaitMs(empty, idleTickMs, idleMaxMs);
          if (heldMs !== null) hold = Math.min(Math.round(wait), PUMP_HOLD_MAX_MS); // a holding server waits for the next request instead, and wakes it when work is committed; [PR-L7 verify, 2026-10-20] never asked more than it holds
          else { hold = 0; await sleep(wait); }
        }
      } catch (error) {
        if (stopping) break;
        empty = 0; hold = 0; // [PR-L7, 2026-10-20] once the server answers again, the idle wait starts over from `idleTickMs`
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
    // [PR-L7 verify, 2026-10-20] wakes sleeping loops at once; a request still in flight - a running slice, or an idle request a holding
    // server keeps (at most PUMP_HOLD_MAX_MS) - is awaited and aborted only when the grace ends (the header)
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
