import { createId, nowIso } from "../identity";
import { estimateRunPlan } from "../run-plan";
import type { RunBatchRecord, RunEvent, RunPoint, RunRecord, RunStatus, SimulationPartSnapshot, SimulationProject } from "../types";
import { executeRunPoint } from "./worker";

interface JobState {
  record: RunRecord;
  abort: AbortController;
  runPoint: RunPoint;
}

interface StoreState {
  jobs: Map<string, JobState>;
  batches: Map<string, RunBatchRecord>;
  listeners: Map<string, Set<(record: RunRecord) => void>>;
}

const globalKey = Symbol.for("sirkit.spice.job-store.v1");
const globalObject = globalThis as typeof globalThis & { [globalKey]?: StoreState };
const state: StoreState = globalObject[globalKey] ?? {
  jobs: new Map(),
  batches: new Map(),
  listeners: new Map(),
};
globalObject[globalKey] = state;

const TERMINAL = new Set<RunStatus>(["completed", "failed", "cancelled"]);

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
  const batch = state.batches.get(batchId);
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
    Object.assign(job.record, result, { finishedAt: nowIso() });
    if (result.status === "failed") job.record.progress = Math.max(job.record.progress, 100);
  } catch (error) {
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

export function startRunPlan(input: {
  project: SimulationProject;
  runPlanId: string;
  parts?: SimulationPartSnapshot[];
  maxRuns?: number;
}): RunBatchRecord {
  const estimate = estimateRunPlan(input.project, input.runPlanId);
  const maxRuns = input.maxRuns ?? 500;
  if (estimate.totalRuns === 0) throw new Error("Run plan expands to zero runs");
  if (estimate.totalRuns > maxRuns) throw new Error(`Run plan expands to ${estimate.totalRuns} runs; API limit is ${maxRuns}`);
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
    };
    state.jobs.set(runId, { record, abort: new AbortController(), runPoint: point });
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
  };
  state.batches.set(batchId, batch);
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
          for (const pendingId of runIds.slice(cursor)) cancelRun(pendingId);
          cursor = runIds.length;
        }
      }
    });
    await Promise.all(workers);
    updateBatch(batchId);
  })();
  return structuredClone(batch);
}

export function getRun(runId: string): RunRecord | null {
  const record = state.jobs.get(runId)?.record;
  if (!record) return null;
  return structuredClone(record);
}

export function getRuns(runIds?: string[]): RunRecord[] {
  const ids = runIds ?? [...state.jobs.keys()];
  return ids.map(getRun).filter((record): record is RunRecord => Boolean(record)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getBatch(batchId: string): RunBatchRecord | null {
  const batch = state.batches.get(batchId);
  if (!batch) return null;
  updateBatch(batchId);
  return structuredClone(batch);
}

export function cancelRun(runId: string): boolean {
  const job = state.jobs.get(runId);
  if (!job || TERMINAL.has(job.record.status)) return false;
  job.abort.abort();
  job.record.status = "cancelled";
  job.record.progress = 100;
  job.record.finishedAt = nowIso();
  addEvent(runId, { status: "cancelled", progress: 100, message: "Cancellation requested" });
  return true;
}

export function subscribeRun(runId: string, listener: (record: RunRecord) => void): () => void {
  let listeners = state.listeners.get(runId);
  if (!listeners) {
    listeners = new Set();
    state.listeners.set(runId, listeners);
  }
  listeners.add(listener);
  const initial = getRun(runId);
  if (initial) listener(initial);
  return () => {
    listeners?.delete(listener);
    if (listeners?.size === 0) state.listeners.delete(runId);
  };
}
