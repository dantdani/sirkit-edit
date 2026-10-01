/**
 * SPICE run job store — [B16.0.2 §B] EVERY run and batch is bound internally
 * to a SERVER-DERIVED project scope `{ tenantId, projectId, branchId }`
 * (the trusted request context of the caller that started it), and EVERY
 * read / list / cancel / subscribe operation requires the EXACT same scope.
 *
 * R2 (B16.0.1 gap): the store carried only the client-asserted
 * `SimulationProject.id` and no trusted ownership, so a member of project B
 * could enumerate, inspect, subscribe to, download, and cancel project A's
 * runs by id. Closed here:
 *  - `startRunPlan` REQUIRES a trusted scope; the client's `project.id` stays
 *    a display-only assertion (`record.projectId`), never an ownership key;
 *  - a foreign-scope caller learns NOTHING: `getRun`/`getBatch` return null,
 *    `getRuns` lists nothing, `cancelRun` is a no-op returning false,
 *    `subscribeRun` adds NO listener (returns an inert unsubscribe) — so the
 *    route layer can answer a uniform bounded 404 (no existence oracle);
 *  - there is NO unscoped public accessor — the internal helpers that need
 *    one are module-private.
 */

import { createId, nowIso } from "../identity";
import { compileCanonicalIr, type CompileIrResult } from "../ir";
import { assertModelSafeForExecution } from "../models";
import { assertRunPointSafe, compileNgspiceNetlist, SpiceDeckSafetyError } from "../netlist";
import { estimateRunPlan } from "../run-plan";
import type { RunBatchRecord, RunEvent, RunPoint, RunRecord, RunStatus, SimulationPartSnapshot, SimulationProject } from "../types";
import { executeRunPoint } from "./worker";

/** The server-derived ownership scope a run/batch is bound to. */
export interface RunScope {
  tenantId: string;
  projectId: string;
  branchId: string;
}

interface JobState {
  record: RunRecord;
  scope: RunScope;
  abort: AbortController;
  runPoint: RunPoint;
}

interface BatchState {
  record: RunBatchRecord;
  scope: RunScope;
}

interface StoreState {
  jobs: Map<string, JobState>;
  batches: Map<string, BatchState>;
  listeners: Map<string, Set<(record: RunRecord) => void>>;
}

const globalKey = Symbol.for("sirkit.spice.job-store.v2");
const globalObject = globalThis as typeof globalThis & { [globalKey]?: StoreState };
const state: StoreState = globalObject[globalKey] ?? {
  jobs: new Map(),
  batches: new Map(),
  listeners: new Map(),
};
globalObject[globalKey] = state;

const TERMINAL = new Set<RunStatus>(["completed", "failed", "cancelled"]);

function sameScope(a: RunScope, b: RunScope): boolean {
  return a.tenantId === b.tenantId && a.projectId === b.projectId && a.branchId === b.branchId;
}

function wellFormedScope(scope: unknown): scope is RunScope {
  if (typeof scope !== "object" || scope === null) return false;
  const s = scope as Record<string, unknown>;
  return ["tenantId", "projectId", "branchId"].every((key) => typeof s[key] === "string" && (s[key] as string).trim().length > 0);
}

/** Module-private: the job for a run id ONLY when the scope matches. */
function ownedJob(runId: string, scope: RunScope): JobState | null {
  const job = state.jobs.get(runId);
  if (!job || !sameScope(job.scope, scope)) return null;
  return job;
}

function emit(runId: string): void {
  const record = state.jobs.get(runId)?.record;
  if (!record) return;
  for (const listener of state.listeners.get(runId) ?? []) listener(structuredClone(record));
}

function addEvent(runId: string, event: Omit<RunEvent, "sequence" | "timestamp">): void {
  const job = state.jobs.get(runId);
  if (!job) return;
  const timestamp = nowIso();
  job.record.status = event.status;
  job.record.progress = event.progress;
  if (!job.record.startedAt && event.status !== "queued") job.record.startedAt = timestamp;
  job.record.events.push({ ...event, sequence: job.record.events.length + 1, timestamp });
  emit(runId);
}

function updateBatch(batchId: string): void {
  const batch = state.batches.get(batchId)?.record;
  if (!batch) return;
  const runs = batch.runIds.map((id) => state.jobs.get(id)?.record).filter((record): record is RunRecord => Boolean(record));
  batch.completed = runs.filter((run) => run.status === "completed").length;
  batch.failed = runs.filter((run) => run.status === "failed").length;
  batch.cancelled = runs.filter((run) => run.status === "cancelled").length;
  if (runs.every((run) => TERMINAL.has(run.status))) {
    batch.status = batch.failed > 0 ? "failed" : batch.cancelled === batch.total ? "cancelled" : "completed";
    batch.finishedAt = nowIso();
  } else if (runs.some((run) => run.status === "running" || run.status === "post-processing")) batch.status = "running";
  else batch.status = "queued";
}

function cancelInternal(runId: string): boolean {
  const job = state.jobs.get(runId);
  if (!job || TERMINAL.has(job.record.status)) return false;
  job.abort.abort();
  job.record.status = "cancelled";
  job.record.progress = 100;
  job.record.finishedAt = nowIso();
  addEvent(runId, { status: "cancelled", progress: 100, message: "Cancellation requested" });
  return true;
}

async function executeQueuedRun(
  batchId: string,
  runId: string,
  project: SimulationProject,
  runPlanId: string,
  parts: SimulationPartSnapshot[],
): Promise<void> {
  const job = state.jobs.get(runId);
  if (!job) return;
  try {
    const result = await executeRunPoint({
      runId,
      project,
      runPlanId,
      runPoint: job.runPoint,
      parts,
      signal: job.abort.signal,
      onEvent: (event) => addEvent(runId, event),
    });
    // [B16.0.23 §E/§F] a TERMINAL record is authoritative: a late worker
    // settlement (a runner that ignored the abort signal) can NEVER overwrite
    // a cancelled/failed/completed run after the fact. Reproduced verbatim
    // pre-edit through the worker seam; the real worker settles "cancelled"
    // on abort, so this is defense-in-depth at the store boundary.
    if (TERMINAL.has(job.record.status)) return;
    Object.assign(job.record, result, { finishedAt: nowIso() });
    if (result.status === "failed") job.record.progress = Math.max(job.record.progress, 100);
  } catch (error) {
    if (TERMINAL.has(job.record.status)) return; // same guard on the throw path
    const message = error instanceof Error ? error.message : String(error);
    job.record.status = job.abort.signal.aborted ? "cancelled" : "failed";
    job.record.error = message;
    job.record.finishedAt = nowIso();
    addEvent(runId, { status: job.record.status, progress: 100, message });
  } finally {
    updateBatch(batchId);
    emit(runId);
  }
}

/**
 * Start a run plan. `scope` is the TRUSTED server-derived ownership scope and
 * is REQUIRED (a malformed/missing scope throws before anything is created);
 * `project.id` is a client assertion kept for display only.
 */
export function startRunPlan(input: {
  scope: RunScope;
  project: SimulationProject;
  runPlanId: string;
  parts?: SimulationPartSnapshot[];
  maxRuns?: number;
}): RunBatchRecord {
  if (!wellFormedScope(input.scope)) throw new Error("A trusted project scope is required to start a run plan");
  const scope: RunScope = { tenantId: input.scope.tenantId, projectId: input.scope.projectId, branchId: input.scope.branchId };
  const estimate = estimateRunPlan(input.project, input.runPlanId);
  const maxRuns = input.maxRuns ?? 500;
  if (estimate.totalRuns === 0) throw new Error("Run plan expands to zero runs");
  if (estimate.totalRuns > maxRuns) throw new Error(`Run plan expands to ${estimate.totalRuns} runs; API limit is ${maxRuns}`);
  assertRunPlanDecksSafe(input.project, estimate.runPoints, input.parts ?? []); // [SEC-1] before any job exists
  const plan = input.project.runPlans.find((candidate) => candidate.id === input.runPlanId)!;
  const batchId = createId("batch");
  const runIds: string[] = [];
  for (const point of estimate.runPoints) {
    const runId = createId("run");
    runIds.push(runId);
    const createdAt = nowIso();
    const record: RunRecord = {
      id: runId,
      projectId: input.project.id,
      runPlanId: input.runPlanId,
      testId: point.testId,
      status: "queued",
      progress: 0,
      label: point.label,
      waveforms: [],
      scalars: [],
      diagnostics: [],
      events: [{ sequence: 1, timestamp: createdAt, status: "queued", progress: 0, message: "Queued" }],
      stdout: "",
      stderr: "",
      createdAt,
      scope: { ...scope },
    };
    state.jobs.set(runId, { record, scope: { ...scope }, abort: new AbortController(), runPoint: point });
  }
  const batch: RunBatchRecord = {
    id: batchId,
    projectId: input.project.id,
    runPlanId: input.runPlanId,
    status: "queued",
    runIds,
    total: runIds.length,
    completed: 0,
    failed: 0,
    cancelled: 0,
    createdAt: nowIso(),
    scope: { ...scope },
  };
  state.batches.set(batchId, { record: batch, scope: { ...scope } });
  const concurrency = Math.max(1, Math.min(8, Math.round(plan.concurrency)));
  void (async () => {
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, runIds.length) }, async () => {
      while (cursor < runIds.length) {
        const index = cursor++;
        const runId = runIds[index];
        const job = state.jobs.get(runId);
        if (!job || job.abort.signal.aborted) continue;
        await executeQueuedRun(batchId, runId, input.project, input.runPlanId, input.parts ?? []);
        if (plan.stopOnFailure && state.jobs.get(runId)?.record.status === "failed") {
          for (const pendingId of runIds.slice(cursor)) cancelInternal(pendingId);
          cursor = runIds.length;
        }
      }
    });
    await Promise.all(workers);
    updateBatch(batchId);
  })();
  return structuredClone(batch);
}

/** The run ONLY when `scope` is its exact owner; otherwise null (no oracle). */
export function getRun(runId: string, scope: RunScope): RunRecord | null {
  const job = ownedJob(runId, scope);
  if (!job) return null;
  return structuredClone(job.record);
}

/** The runs owned by `scope` (optionally filtered to `runIds`). Foreign ids are
 *  silently absent — a foreign-scope caller can never enumerate. */
export function getRuns(scope: RunScope, runIds?: string[]): RunRecord[] {
  const ids = runIds ?? [...state.jobs.keys()];
  return ids
    .map((id) => getRun(id, scope))
    .filter((record): record is RunRecord => Boolean(record))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The batch ONLY when `scope` is its exact owner; otherwise null. */
export function getBatch(batchId: string, scope: RunScope): RunBatchRecord | null {
  const batch = state.batches.get(batchId);
  if (!batch || !sameScope(batch.scope, scope)) return null;
  updateBatch(batchId);
  return structuredClone(batch.record);
}

/** Cancel ONLY when `scope` owns the run; a foreign scope is a no-op (false)
 *  and the execution/cancellation authority is never touched. */
export function cancelRun(runId: string, scope: RunScope): boolean {
  if (!ownedJob(runId, scope)) return false;
  return cancelInternal(runId);
}

/**
 * Subscribe ONLY when `scope` owns the run. A foreign scope adds NO listener
 * and receives NO initial record — the returned unsubscribe is inert. The
 * second return value reports whether a subscription was actually created so
 * a route can authorize BEFORE opening a stream.
 */
export function subscribeRun(runId: string, scope: RunScope, listener: (record: RunRecord) => void): () => void {
  const job = ownedJob(runId, scope);
  if (!job) return () => undefined;
  let listeners = state.listeners.get(runId);
  if (!listeners) {
    listeners = new Set();
    state.listeners.set(runId, listeners);
  }
  listeners.add(listener);
  listener(structuredClone(job.record));
  return () => {
    listeners?.delete(listener);
    if (listeners?.size === 0) state.listeners.delete(runId);
  };
}

/** Diagnostics/tests: the number of live listeners on a run (unscoped COUNT
 *  only — never a record, never contents). */
export function runListenerCount(runId: string): number {
  return state.listeners.get(runId)?.size ?? 0;
}

/** Tests only: clear every job/batch/listener (abort in-flight runs). */
export function __resetJobStoreForTests(): void {
  for (const job of state.jobs.values()) job.abort.abort();
  state.jobs.clear();
  state.batches.clear();
  state.listeners.clear();
}

/**
 * [SEC-1] Refuse a run plan whose deck would carry caller or model text as a live ngspice line BEFORE any job exists, so
 * POST /api/spice/runs answers a closed 4xx and no deck is written or run. The deck is compiled exactly as the worker
 * compiles it, and only the deck-safety refusal is raised: a test whose model the existing model screen refuses is skipped
 * (the worker refuses it first, before any deck, with that screen's message), and every other compile error stays the
 * per-run failure the worker reports, as before. [SEC-1 review] One deck per test and analysis: its run points differ only
 * in their label, variable values and temperature, screened per point by `assertRunPointSafe`, so a large plan never holds
 * the request for one compile per point; the worker still screens each point's own deck before writing it.
 */
function assertRunPlanDecksSafe(project: SimulationProject, runPoints: RunPoint[], parts: SimulationPartSnapshot[]): void {
  const compiled = new Map<string, CompileIrResult | null>();
  const screened = new Set<string>();
  for (const point of runPoints) {
    if (!compiled.has(point.testId)) compiled.set(point.testId, screenableIr(project, point.testId, parts));
    const entry = compiled.get(point.testId);
    if (!entry) continue;
    assertRunPointSafe(point);
    const key = JSON.stringify([point.testId, point.analysisId]);
    if (screened.has(key)) continue;
    screened.add(key);
    try {
      compileNgspiceNetlist(entry.ir, { analysisId: point.analysisId, runPoint: point, rawOutputPath: "result.raw", pinNodes: entry.pointNodes });
    } catch (error) {
      if (error instanceof SpiceDeckSafetyError) throw error;
    }
  }
}

/** The IR the worker would compile for a test, or null when the worker refuses it before any deck is written. */
function screenableIr(project: SimulationProject, testId: string, parts: SimulationPartSnapshot[]): CompileIrResult | null {
  try {
    const compiled = compileCanonicalIr({ project, testId, parts });
    for (const model of compiled.ir.models) assertModelSafeForExecution(model);
    return compiled;
  } catch {
    return null;
  }
}
