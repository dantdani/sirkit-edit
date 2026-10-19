/**
 * [PR-L, 2026-10-17] Runbook L.3, increment 3 part 2 (task-worker-contract.md sections 3.2 and 4): the generation WORKER - the process
 * that consumes queued slices whether or not any browser is open, and keeps a logical task moving across finite slices, restarts and
 * days. `scripts/generation-worker.ts` runs it as its own process; nothing here is a React component, a tab interval, an instrumentation
 * loop or an unawaited route promise.
 *
 *  - Claims only FREE capacity (`concurrency - running`), each claimed slice under its OWN outbox lease, running CONCURRENTLY (never a
 *    batch claimed and then awaited one by one while the later leases expire, F4). The claim itself is the store's (`claimSlices`): the
 *    fenced head claim, the live membership and provider re-check, the allowance reservation, the lost-worker bound.
 *  - Each running slice has a supervisor: it renews the lease every `renewEveryMs` (S2; also at every turn boundary when due by the task
 *    clock) and polls control every `controlPollMs` (also at every boundary). A lost lease, a fence taken by another owner or the user's
 *    cancel aborts the slice's controller; a pause or a shutdown lets it yield at its next complete turn boundary with its checkpoint.
 *  - `stop({ graceMs })`: stop claiming, ask every running slice to yield at its next boundary, and after the grace abort the rest, whose
 *    leases are handed back for IMMEDIATE takeover (`releaseSlice`). A crash leaves the leases to lapse (<= leaseMs); any worker then
 *    resumes each slice from its last committed checkpoint.
 *  - Every slice runs inside the injected scope runner (the script binds `withLlmCallScope` with the route that admitted the task, so the
 *    provider calls are recorded under it).
 *  - [PR-M, 2026-10-18] Section M2 (m2-acquisition-design.md M2.3): the worker also consumes OTHER durable topics on the same repository
 *    and outbox through `FencedTopicRunner`s (the component-resolution task's `component-resolution-slice`): claimed only with the capacity
 *    the generation claim left free, each slice under the same kind of supervisor (renewal, control poll, yield on a stop, abort after the
 *    grace, release for immediate takeover). There is no second worker.
 */
import type { GenerationTaskScope } from "../contracts";
import { GENERATION_SLICE_POLICY } from "../contracts";
import type { GenerationClaimOutcome, GenerationSliceLease, GenerationSliceRevalidator, GenerationTaskStore } from "../store";
import { isoOf } from "../vocabulary";
import { DEFAULT_SLICE_WINDOWS, runGenerationSlice, type BoundaryVerdict, type GenerationSlicePorts, type GenerationSliceReport, type GenerationSliceWindows, type SliceStopReason, type SliceSupervisor } from "./slices";

export interface GenerationWorkerPolicy extends GenerationSliceWindows {
  /** slices in flight at once (1..3) */
  concurrency: number;
  /** the idle loop's tick interval */
  idleTickMs: number;
  renewEveryMs: number;
  controlPollMs: number;
  /** after a stop, how long running slices may take to reach a boundary before they are aborted and released */
  graceMs: number;
}
export const DEFAULT_WORKER_POLICY: Readonly<GenerationWorkerPolicy> = Object.freeze({
  ...DEFAULT_SLICE_WINDOWS,
  concurrency: GENERATION_SLICE_POLICY.workerConcurrency,
  idleTickMs: 1_000,
  renewEveryMs: GENERATION_SLICE_POLICY.renewEveryMs,
  controlPollMs: GENERATION_SLICE_POLICY.controlPollMs,
  graceMs: 10_000,
});
/** The timers the supervisors use (real ones by default; a test passes its own). */
export interface WorkerTimers {
  setInterval(run: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
const REAL_TIMERS: WorkerTimers = {
  setInterval: (run, ms) => { const handle = setInterval(run, ms); (handle as { unref?: () => void }).unref?.(); return handle; },
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
/** Runs one slice inside the request scope its provider calls are recorded under (identity by default). */
export type GenerationScopeRunner = <T>(scope: GenerationTaskScope, run: () => Promise<T>) => Promise<T>;

/** [PR-M, 2026-10-18] M2: one claimed slice of another durable topic (its own store does the fenced claim; the worker supervises it). */
export interface FencedTopicSlice {
  readonly topic: string;
  readonly sliceId: string;
  readonly taskId: string;
  readonly kind: string;
  readonly attempt: number;
  readonly leaseExpiresAt: string;
  /** S2: extend the lease; false when it was lost (the slice must stop) */
  renew(): Promise<boolean>;
  poll(): Promise<{ fenced: boolean; cancel: boolean }>;
  /** hand the slice back for immediate takeover (a shutdown) */
  release(): Promise<void>;
  run(supervisor: { readonly signal: AbortSignal; boundary(): Promise<BoundaryVerdict> }): Promise<TopicSliceReport>;
}
/** [PR-M, 2026-10-18] M2: what a topic slice reports (the generation report's fields, its kind the topic's own). */
export interface TopicSliceReport { topic: string; sliceId: string; taskId: string; kind: string; blockId: null; attempt: number; outcome: string; state: string | null; detail: string }
/** [PR-M, 2026-10-18] M2: another durable topic this worker consumes. */
export interface FencedTopicRunner {
  readonly topic: string;
  /** [PR-L6, 2026-10-19] `scope`: the worker's `--scope` - claim only that scope's slices */
  claim(input: { workerId: string; limit: number; scope?: GenerationTaskScope }): Promise<FencedTopicSlice[]>;
}
/** [PR-M, 2026-10-18] M2: a settled slice of either kind. */
export type WorkerSliceReport = GenerationSliceReport | TopicSliceReport;

export interface GenerationWorkerOptions {
  store: GenerationTaskStore;
  workerId: string;
  ports: GenerationSlicePorts;
  /** section 3.2 step 3: live membership and role, the provider still servable (runtime.ts binds the production one) */
  revalidate: GenerationSliceRevalidator;
  /** the task clock - the SAME clock the store uses (leases, timestamps, notBefore) */
  clock?: () => number;
  random?: () => number;
  policy?: Partial<GenerationWorkerPolicy>;
  timers?: WorkerTimers;
  runInScope?: GenerationScopeRunner;
  log?: (line: string) => void;
  /** [PR-M, 2026-10-18] M2: other durable topics on the same repository (the component-resolution slices) */
  topics?: readonly FencedTopicRunner[];
  /** [PR-L6, 2026-10-19] OD-253 item 6: claim only this scope's slices, of every topic (absent: every scope) */
  scope?: GenerationTaskScope;
}

export interface GenerationTickReport {
  at: string;
  /** every claim outcome of this tick (claimed, stale, not yet due, refused at the claim) */
  claims: Array<{ outcome: GenerationClaimOutcome["outcome"]; taskId: string | null; sliceId: string | null; code?: string }>;
  /** the slices this tick started */
  started: string[];
}
export interface GenerationWorkerHealth { workerId: string; startedAt: string; running: number; lastTickAt: string | null; stopping: boolean; slicesSettled: number }

/** The supervisor of one running slice (renewal, control, yield and abort). */
class RunningSlice implements SliceSupervisor {
  readonly controller = new AbortController();
  private reason: SliceStopReason | null = null;
  private yieldFor: "pause" | "shutdown" | null = null;
  private lastRenewAt: number;
  private readonly handles: unknown[] = [];
  promise!: Promise<GenerationSliceReport>;

  constructor(private readonly worker: GenerationWorker, readonly lease: GenerationSliceLease) {
    this.lastRenewAt = worker.clock();
    const policy = worker.policy, timers = worker.timers;
    this.handles.push(timers.setInterval(() => { void this.renewIfDue(true); }, policy.renewEveryMs));
    this.handles.push(timers.setInterval(() => { void this.pollControl(); }, policy.controlPollMs));
  }

  get signal(): AbortSignal { return this.controller.signal; }
  stopReason(): SliceStopReason | null { return this.reason; }
  stop(reason: SliceStopReason): void {
    if (this.reason !== null) return;
    this.reason = reason;
    this.controller.abort(new Error(`GENERATION_SLICE_STOPPED:${reason}`));
  }
  requestYield(reason: "pause" | "shutdown"): void { this.yieldFor ??= reason; }
  dispose(): void { for (const handle of this.handles.splice(0)) this.worker.timers.clearInterval(handle); }

  private async renewIfDue(timer = false): Promise<void> {
    if (this.reason !== null) return;
    const now = this.worker.clock();
    if (!timer && now - this.lastRenewAt < this.worker.policy.renewEveryMs) return;
    try {
      const renewed = await this.worker.store.renewSlice(this.lease);
      if (renewed.ok) this.lastRenewAt = now;
      else {
        this.worker.log(`slice ${this.lease.sliceId}: the lease could not be renewed (another worker may hold it); stopping`);
        this.stop("lease_lost");
      }
    } catch (error) {
      // the store did not answer: keep working while the lease still holds, stop before it lapses (never run unowned)
      const expires = Date.parse(this.lease.leaseExpiresAt);
      if (!Number.isFinite(expires) || this.worker.clock() >= expires - Math.min(5_000, this.worker.policy.renewEveryMs)) {
        this.worker.log(`slice ${this.lease.sliceId}: lease renewal failed and the lease is about to lapse; stopping (${error instanceof Error ? error.name : "error"})`);
        this.stop("lease_lost");
      }
    }
  }
  private async pollControl(): Promise<{ fenced: boolean; cancel: boolean; pause: boolean } | null> {
    if (this.reason !== null) return null;
    try {
      const control = await this.worker.store.pollControl(this.lease);
      if (control.fenced) this.stop("fenced");
      else if (control.cancel) this.stop("cancel");
      else if (control.pause) this.requestYield("pause");
      return control;
    } catch {
      return null; // a missed poll is retried by the next one or the next boundary
    }
  }

  async boundary(): Promise<BoundaryVerdict> {
    if (this.reason === "cancel") return "cancel";
    if (this.reason === "fenced") return "fenced";
    await this.renewIfDue();
    const control = await this.worker.store.pollControl(this.lease);
    if (control.fenced) { this.stop("fenced"); return "fenced"; }
    if (control.cancel) return "cancel";
    if (control.pause) this.requestYield("pause");
    return this.yieldFor !== null || this.reason !== null ? "yield" : "continue";
  }
}

/** [PR-M, 2026-10-18] M2: the supervisor of one running topic slice (the same renewal, control, yield and abort as a generation slice). */
class RunningTopicSlice {
  readonly controller = new AbortController();
  private reason: SliceStopReason | null = null;
  private yieldFor: "pause" | "shutdown" | null = null;
  private readonly handles: unknown[] = [];
  promise!: Promise<WorkerSliceReport>;

  constructor(private readonly worker: GenerationWorker, readonly slice: FencedTopicSlice) {
    const policy = worker.policy, timers = worker.timers;
    this.handles.push(timers.setInterval(() => { void this.renew(); }, policy.renewEveryMs));
    this.handles.push(timers.setInterval(() => { void this.poll(); }, policy.controlPollMs));
  }
  get signal(): AbortSignal { return this.controller.signal; }
  stop(reason: SliceStopReason): void {
    if (this.reason !== null) return;
    this.reason = reason;
    this.controller.abort(new Error(`TOPIC_SLICE_STOPPED:${reason}`));
  }
  requestYield(reason: "pause" | "shutdown"): void { this.yieldFor ??= reason; }
  dispose(): void { for (const handle of this.handles.splice(0)) this.worker.timers.clearInterval(handle); }
  private async renew(): Promise<void> {
    if (this.reason !== null) return;
    try { if (!(await this.slice.renew())) this.stop("lease_lost"); } catch {
      const expires = Date.parse(this.slice.leaseExpiresAt);
      if (!Number.isFinite(expires) || this.worker.clock() >= expires - Math.min(5_000, this.worker.policy.renewEveryMs)) this.stop("lease_lost");
    }
  }
  private async poll(): Promise<void> {
    if (this.reason !== null) return;
    try { const control = await this.slice.poll(); if (control.fenced) this.stop("fenced"); else if (control.cancel) this.stop("cancel"); } catch { /* the next poll or boundary retries */ }
  }
  async boundary(): Promise<BoundaryVerdict> {
    if (this.reason === "cancel") return "cancel";
    if (this.reason === "fenced" || this.reason === "lease_lost") return "fenced";
    const control = await this.slice.poll();
    if (control.fenced) { this.stop("fenced"); return "fenced"; }
    if (control.cancel) return "cancel";
    return this.yieldFor !== null || this.reason !== null ? "yield" : "continue";
  }
}

export class GenerationWorker {
  readonly workerId: string;
  readonly store: GenerationTaskStore;
  readonly policy: GenerationWorkerPolicy;
  readonly timers: WorkerTimers;
  readonly clock: () => number;
  private readonly random: () => number;
  private readonly ports: GenerationSlicePorts;
  private readonly revalidate: GenerationSliceRevalidator;
  private readonly runInScope: GenerationScopeRunner;
  private readonly logLine: (line: string) => void;
  private readonly running = new Map<string, RunningSlice>();
  /** [PR-M, 2026-10-18] M2: the running slices of other topics (they count against the same concurrency) */
  private readonly topicRunning = new Map<string, RunningTopicSlice>();
  private readonly topics: readonly FencedTopicRunner[];
  private readonly scope: GenerationTaskScope | null;
  private readonly startedAt: string;
  private lastTickAt: string | null = null;
  private stopping = false;
  private loop: Promise<void> | null = null;
  private wake: (() => void) | null = null;
  private settled = 0;

  constructor(options: GenerationWorkerOptions) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(options.workerId)) throw new Error("GENERATION_WORKER_ID_INVALID: a worker id is 1-128 characters of [A-Za-z0-9._:-]");
    this.workerId = options.workerId;
    this.store = options.store;
    const policy = { ...DEFAULT_WORKER_POLICY, ...(options.policy ?? {}) };
    policy.concurrency = Math.max(1, Math.min(GENERATION_SLICE_POLICY.workerConcurrency, Math.floor(policy.concurrency)));
    this.policy = policy;
    this.timers = options.timers ?? REAL_TIMERS;
    this.clock = options.clock ?? (() => Date.now());
    this.random = options.random ?? Math.random;
    this.ports = options.ports;
    this.revalidate = options.revalidate;
    this.runInScope = options.runInScope ?? ((_scope, run) => run());
    this.logLine = options.log ?? (() => undefined);
    this.topics = options.topics ?? [];
    this.scope = options.scope ? { ...options.scope } : null;
    this.startedAt = isoOf(this.clock());
  }

  log(line: string): void { try { this.logLine(line); } catch { /* a log sink never stops the worker */ } }

  health(): GenerationWorkerHealth {
    return { workerId: this.workerId, startedAt: this.startedAt, running: this.inFlight(), lastTickAt: this.lastTickAt, stopping: this.stopping, slicesSettled: this.settled };
  }
  /** The slices running now (their ids). */
  runningSlices(): string[] { return [...this.running.keys(), ...this.topicRunning.keys()]; }
  /** [PR-M, 2026-10-18] M2: generation and topic slices in flight. */
  private inFlight(): number { return this.running.size + this.topicRunning.size; }

  /** One tick: claim up to the free capacity and START each claimed slice (it runs concurrently; `idle()` awaits them). */
  async tick(): Promise<GenerationTickReport> {
    const at = isoOf(this.clock());
    this.lastTickAt = at;
    const free = this.policy.concurrency - this.inFlight();
    if (free <= 0 || this.stopping) return { at, claims: [], started: [] };
    const outcomes = await this.store.claimSlices({ workerId: this.workerId, limit: free, revalidate: this.revalidate, ...(this.scope ? { scope: this.scope } : {}) });
    const report: GenerationTickReport = { at, claims: [], started: [] };
    for (const outcome of outcomes) {
      if (outcome.outcome !== "claimed") {
        report.claims.push({ outcome: outcome.outcome, taskId: outcome.taskId, sliceId: null, ...(outcome.code ? { code: outcome.code } : {}) });
        if (outcome.outcome !== "stale-event" && outcome.outcome !== "not-before") this.log(`claim of event ${outcome.eventId}: ${outcome.outcome}${outcome.code ? ` (${outcome.code})` : ""}`);
        continue;
      }
      report.claims.push({ outcome: "claimed", taskId: outcome.lease.taskId, sliceId: outcome.lease.sliceId });
      report.started.push(outcome.lease.sliceId);
      this.startSlice(outcome.lease, outcome.task);
    }
    // [PR-M, 2026-10-18] M2: the other topics, with the capacity the generation claim left free
    for (const runner of this.topics) {
      const remaining = this.policy.concurrency - this.inFlight();
      if (remaining <= 0 || this.stopping) break;
      let slices: FencedTopicSlice[];
      try { slices = await runner.claim({ workerId: this.workerId, limit: remaining, ...(this.scope ? { scope: this.scope } : {}) }); } catch (error) { this.log(`claim on topic ${runner.topic} failed (${error instanceof Error ? error.name : "error"})`); continue; }
      for (const slice of slices) {
        report.claims.push({ outcome: "claimed", taskId: slice.taskId, sliceId: slice.sliceId });
        report.started.push(slice.sliceId);
        this.startTopicSlice(slice);
      }
    }
    return report;
  }

  /** [PR-M, 2026-10-18] M2: run one topic slice under its supervisor. */
  private startTopicSlice(slice: FencedTopicSlice): void {
    const supervisor = new RunningTopicSlice(this, slice);
    this.topicRunning.set(slice.sliceId, supervisor);
    this.log(`started ${slice.topic} ${slice.kind} slice ${slice.sliceId}, attempt ${slice.attempt}`);
    supervisor.promise = slice.run({ signal: supervisor.signal, boundary: () => supervisor.boundary() }).catch((error: unknown): TopicSliceReport => ({
      topic: slice.topic, sliceId: slice.sliceId, taskId: slice.taskId, kind: slice.kind, blockId: null, attempt: slice.attempt, outcome: "released", state: null,
      detail: `the topic slice failed outside its own handling (${error instanceof Error ? error.name : "error"}); the lease will lapse`,
    })).then((report) => {
      supervisor.dispose();
      this.topicRunning.delete(slice.sliceId);
      this.settled += 1;
      this.log(`settled ${slice.topic} slice ${slice.sliceId}: ${report.outcome}${report.state ? ` (task ${report.state})` : ""} - ${report.detail}`);
      this.wake?.();
      return report;
    });
  }

  private startSlice(lease: GenerationSliceLease, task: Parameters<typeof runGenerationSlice>[0]["task"]): void {
    const supervisor = new RunningSlice(this, lease);
    this.running.set(lease.sliceId, supervisor);
    this.log(`started ${lease.kind} slice ${lease.sliceId}${lease.blockId ? ` (block ${lease.blockId})` : ""}, attempt ${lease.attempt}, fence ${lease.fence}`);
    supervisor.promise = this.runInScope(lease.scope, () => runGenerationSlice({
      store: this.store, lease, task, ports: this.ports, supervisor, windows: this.policy, clock: this.clock, random: this.random, log: (line) => this.log(line),
    })).catch((error: unknown): GenerationSliceReport => ({
      sliceId: lease.sliceId, taskId: lease.taskId, kind: lease.kind, blockId: lease.blockId, attempt: lease.attempt, outcome: "released", state: null,
      detail: `the slice runner failed outside its own handling (${error instanceof Error ? error.name : "error"}); the lease will lapse`,
    })).then((report) => {
      supervisor.dispose();
      this.running.delete(lease.sliceId);
      this.settled += 1;
      this.log(`settled ${lease.kind} slice ${lease.sliceId}: ${report.outcome}${report.state ? ` (task ${report.state})` : ""} - ${report.detail}`);
      this.wake?.();
      return report;
    });
  }

  /** Wait for every running slice to settle. */
  async idle(): Promise<WorkerSliceReport[]> {
    return Promise.all([...[...this.running.values()].map((slice): Promise<WorkerSliceReport> => slice.promise), ...[...this.topicRunning.values()].map((slice) => slice.promise)]);
  }

  /** One tick and the settlement of the slices it started (the `--once` mode, and the tests' step). */
  async runOnce(): Promise<{ tick: GenerationTickReport; slices: WorkerSliceReport[] }> {
    const tick = await this.tick();
    const slices = await Promise.all(tick.started.map((sliceId): Promise<WorkerSliceReport> | undefined => this.running.get(sliceId)?.promise ?? this.topicRunning.get(sliceId)?.promise).filter((promise): promise is Promise<WorkerSliceReport> => promise !== undefined));
    return { tick, slices };
  }

  /** Run until `stop()`: tick every `idleTickMs` while idle and at once whenever a slot frees. */
  start(): void {
    if (this.loop) return;
    this.stopping = false;
    this.loop = (async () => {
      let failures = 0;
      while (!this.stopping) {
        try {
          if (this.inFlight() < this.policy.concurrency) await this.tick();
          failures = 0;
        } catch (error) {
          failures += 1;
          this.log(`tick failed (${error instanceof Error ? error.name : "error"}); retrying`);
        }
        if (this.stopping) break;
        const waitMs = this.policy.idleTickMs * Math.min(30, 2 ** Math.min(5, failures));
        await new Promise<void>((resolve) => {
          const handle = this.timers.setTimeout(() => { this.wake = null; resolve(); }, waitMs);
          this.wake = () => { this.timers.clearTimeout(handle); this.wake = null; resolve(); };
        });
      }
    })();
  }

  /** Stop claiming; running slices yield at their next boundary, and after `graceMs` the rest are aborted and released. */
  async stop(options: { graceMs?: number } = {}): Promise<WorkerSliceReport[]> {
    this.stopping = true;
    this.wake?.();
    const graceMs = options.graceMs ?? this.policy.graceMs;
    const slices = [...this.running.values()];
    const topicSlices = [...this.topicRunning.values()]; // [PR-M, 2026-10-18] M2
    for (const slice of slices) slice.requestYield("shutdown");
    for (const slice of topicSlices) slice.requestYield("shutdown");
    const all = Promise.all([...slices.map((slice): Promise<WorkerSliceReport> => slice.promise), ...topicSlices.map((slice) => slice.promise)]);
    let graceHandle: unknown = null;
    const graceOver = new Promise<"grace">((resolve) => { graceHandle = this.timers.setTimeout(() => resolve("grace"), graceMs); });
    const first = await Promise.race([all, graceOver]);
    if (graceHandle !== null) this.timers.clearTimeout(graceHandle);
    if (first === "grace") { for (const slice of [...this.running.values()]) slice.stop("shutdown"); for (const slice of [...this.topicRunning.values()]) slice.stop("shutdown"); }
    const reports = await all;
    await this.loop;
    this.loop = null;
    return reports;
  }
}
