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
import type { RunBatchRecord, RunEvent, RunEvidence, RunPoint, RunRecord, RunStatus, SimulationPartSnapshot, SimulationProject } from "../types";
import { executeRunPoint } from "./worker";
import { buildSpiceRunEvidence, COMPUTATION_EVIDENCE_AGGREGATE_TYPE, submittedSnapshotDigest, type ComputationEvidenceStore } from "@/app/lib/computation/evidence-store"; // [B22-C] D22-7, D22-12

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
  /** [B22-C] OD-142: the server's SHA-256 of the submitted, validated snapshot and its server-derived scope, which the run's evidence is bound to. */
  snapshotSha256: string;
  /** [B22-C] OD-141: the durable evidence aggregate, when a composition root binds one (no route does in B22-C). */
  evidenceStore?: Pick<ComputationEvidenceStore, "append">;
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
  if (TERMINAL.has(job.record.status) && !TERMINAL.has(event.status)) return; // [B22-A3 review] security-3: a terminal record is never reopened by a later progress event
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
  // [B22-C] D22-7: a run counts completed only with its evidence (its result, finishedAt and the server-built evidence document); a
  // completion without them is not a completion and counts failed
  batch.completed = runs.filter(completedWithEvidence).length;
  batch.failed = runs.filter((run) => run.status === "failed" || (run.status === "completed" && !completedWithEvidence(run))).length;
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
  // [B22-C] D22-7: the worker's own terminal event (sent before its result) is held until the result and its evidence are attached
  const held: { event?: Omit<RunEvent, "sequence" | "timestamp"> } = {};
  try {
    const result = await executeRunPoint({
      runId,
      project,
      runPlanId,
      runPoint: job.runPoint,
      parts,
      signal: job.abort.signal,
      holder: job.scope.tenantId, // [B22-A3 review] security-2: the run's tenant shares the diagnostic runner's cap
      onEvent: (event) => {
        if (TERMINAL.has(event.status)) held.event = event;
        else addEvent(runId, event);
      },
    });
    const staged = TERMINAL.has(job.record.status) ? null : stageRunResult(job, runId, result, held.event); // [B22-C review] the result staged; the record stays non-terminal
    if (staged?.evidence && job.evidenceStore) await recordRunEvidence(job, runId, staged.evidence); // appended before any terminal status; a cancel meanwhile is the guard's
    // [B16.0.23 §E/§F] a TERMINAL record is authoritative: a late worker
    // settlement (a runner that ignored the abort signal) can NEVER overwrite
    // a cancelled/failed/completed run after the fact. Reproduced verbatim
    // pre-edit through the worker seam; the real worker settles "cancelled"
    // on abort, so this is defense-in-depth at the store boundary.
    if (TERMINAL.has(job.record.status)) return;
    // [B22-C review] coverage-6, tests-1: the staged result, its terminal status and the held event land together, after the
    // evidence settled (and, with a store bound, was appended), so no reader - getRun, a late subscriber, the batch - sees it earlier
    Object.assign(job.record, staged!.fields);
    if (job.record.status === "failed") job.record.progress = Math.max(job.record.progress, 100);
    if (staged!.event) addEvent(runId, staged!.event); // [B22-C] D22-7: now the terminal status
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
  /** [B22-C] OD-141: the durable evidence aggregate a composition root binds; without it a run's evidence stays on its record. */
  evidenceStore?: Pick<ComputationEvidenceStore, "append">;
}): RunBatchRecord {
  if (!wellFormedScope(input.scope)) throw new Error("A trusted project scope is required to start a run plan");
  const scope: RunScope = { tenantId: input.scope.tenantId, projectId: input.scope.projectId, branchId: input.scope.branchId };
  const estimate = estimateRunPlan(input.project, input.runPlanId);
  const maxRuns = input.maxRuns ?? 500;
  if (estimate.totalRuns === 0) throw new Error("Run plan expands to zero runs");
  if (estimate.totalRuns > maxRuns) throw new Error(`Run plan expands to ${estimate.totalRuns} runs; API limit is ${maxRuns}`);
  assertRunPlanDecksSafe(input.project, estimate.runPoints, input.parts ?? []); // [SEC-1] before any job exists
  const snapshotSha256 = submittedSnapshotDigest({ scope, project: input.project, runPlanId: input.runPlanId, parts: input.parts ?? [] }); // [B22-C] OD-142: the validated snapshot; [B22-C review] coverage-7: with the server-derived scope
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
    state.jobs.set(runId, { record, scope: { ...scope }, abort: new AbortController(), runPoint: point, snapshotSha256, ...(input.evidenceStore ? { evidenceStore: input.evidenceStore } : {}) });
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

/** The IR the worker would compile for a test, or null when the worker refuses it before any deck is written. [B22-A1] The model
 *  screen's CLOSED refusals (a file read, an include, a blank transformedContent hiding a refused original: D22-4) are raised, so
 *  the route answers 422 before any job, as SEC-1's final deck screen answered that text; its own messages stay the worker's. */
function screenableIr(project: SimulationProject, testId: string, parts: SimulationPartSnapshot[]): CompileIrResult | null {
  try {
    const compiled = compileCanonicalIr({ project, testId, parts });
    for (const model of compiled.ir.models) assertModelSafeForExecution(model);
    return compiled;
  } catch (error) {
    if (error instanceof SpiceDeckSafetyError) throw error;
    return null;
  }
}

// ─── [B22-C] evidence (D22-7, D22-12; OD-141, OD-142) ─────────────────────────────────────────────────────────────────

/** A run the batch counts completed: its result attached (finishedAt) with the server-built evidence document. [B22-C review] A
 *  completed run always carries one now (a document the rules refuse fails the run itself); the evidence clause stays as the guard. */
function completedWithEvidence(run: RunRecord): boolean {
  return run.status === "completed" && Boolean(run.finishedAt) && Boolean(run.evidence);
}

type HeldEvent = Omit<RunEvent, "sequence" | "timestamp">;
/**
 * [B22-C review] The record a worker result settles to, staged WITHOUT touching the record, which stays non-terminal until the
 * evidence settles (coverage-6, tests-1). A completed result carries the server-built evidence document (labelled not yet durable).
 * One truth for a run and its batch (regressions-4, security-4, coverage-5, tests-2): a completed result whose document the closed
 * evidence rules refuse settles FAILED with the closed reason `EVIDENCE_DOCUMENT_REFUSED`, and its own failed event replaces the
 * worker's held completed one, so the record, its stream, the batch and stopOnFailure agree. Its validated waveforms, scalars, logs,
 * manifest and netlist stay on the record for inspection (what failed is the evidence, not the output); it is not a completion. The
 * reason names the document's failing JSON paths, never the refused text. Any other held terminal event is published only when it
 * names the settled status.
 */
function stageRunResult(job: JobState, runId: string, result: Partial<RunRecord>, held: HeldEvent | undefined): { fields: Partial<RunRecord>; event: HeldEvent | null; evidence: RunEvidence | null } {
  const fields: Partial<RunRecord> = { ...result, finishedAt: nowIso() };
  if (fields.status !== "completed") return { fields, event: held && held.status === fields.status ? held : null, evidence: null };
  const built = buildSpiceRunEvidence({ run: { ...job.record, ...fields } as RunRecord, snapshotSha256: job.snapshotSha256 });
  if (!built.ok) {
    const error = `EVIDENCE_DOCUMENT_REFUSED: the run's evidence document was refused at ${built.problems.join(", ")}, so its result is not kept as a completion`;
    return { fields: { ...fields, status: "failed", progress: 100, error }, event: { status: "failed", progress: 100, message: error }, evidence: null };
  }
  const evidence: RunEvidence = { aggregateType: COMPUTATION_EVIDENCE_AGGREGATE_TYPE, evidenceId: runId, documentDigest: built.documentDigest, document: built.document, durable: { state: "not_recorded", reason: job.evidenceStore ? "EVIDENCE_APPEND_PENDING" : "EVIDENCE_STORE_UNBOUND" } };
  return { fields: { ...fields, evidence }, event: held && held.status === "completed" ? held : null, evidence };
}

/** Append the document to the durable aggregate before the terminal status is published; never throws (a refusal or an unavailable
 *  store is recorded on the run, which keeps its evidence document). [B22-C review] A cancel that lands while the append is pending
 *  leaves the run cancelled (the B16.0.23 guard) and the appended document in the aggregate: evidence of a run whose record says
 *  cancelled, labelled diagnostic and evidence-only like any other (recorded on the page). */
async function recordRunEvidence(job: JobState, runId: string, evidence: RunEvidence): Promise<void> {
  try {
    const appended = await job.evidenceStore!.append({ scope: job.scope, evidenceId: runId, expectedRevision: 0, document: evidence.document, at: nowIso() });
    evidence.durable = appended.ok ? { state: "recorded", revision: appended.revision, recordDigest: appended.recordDigest } : { state: "not_recorded", reason: appended.code === "stale_revision" ? "EVIDENCE_STALE_REVISION" : "EVIDENCE_DOCUMENT_REFUSED" };
  } catch {
    evidence.durable = { state: "not_recorded", reason: "EVIDENCE_STORE_UNAVAILABLE" };
  }
}
