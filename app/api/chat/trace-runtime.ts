/**
 * [B24-C1] D24-20, OD-207: the chat composition root's durable run-trace sink. It sits beside `orchestration-runtime.ts` because it
 * binds the durable runtime, which no pure module may (the agent loop, the gateway, the trace contract and recorder, and the store
 * itself stay out of the durable runtime's reach; b24-c1-durable-trace's import gate pins it).
 *
 * The binding: when this module is evaluated it calls `setAgentTraceSinkFactory` ONCE (the recorder's injection point,
 * `trace-recorder.ts`; binding it is no edit to a B11 file). The chat route imports this module (route.ts, appended in place on its
 * line 40), so every run that reaches the route's recorder hands its finalized, VALIDATED trace to `DurableRunTraceSink.complete`.
 *
 * The sink contract is synchronous (`trace-recorder.ts`: a returned thenable is a `trace_sink_contract_violation`), so the durable
 * write is SCHEDULED, never returned:
 *  - `append` keeps nothing - the finalized document carries every event;
 *  - `complete` returns `undefined`, never throws, and schedules ONE append of the document it was handed (the candidate the recorder
 *    validated; the document the route gets back may carry one more diagnostic), under the document's own scope, at the server clock;
 *  - the pending write sits in a bounded process-local set (`RUN_TRACE_PENDING_BOUND`); a write beyond the bound is `dropped`;
 *  - a failure is caught and counted by a closed class - `store_unavailable` (the store factory threw), `refused` (a closed store
 *    refusal), `stale_exhausted` (the run's head kept moving past `casAttempts`), `write_failed` (the repository rejected), `dropped` -
 *    never a message, a stack or a document fragment;
 *  - nothing about the write can change the stream, the terminal event or the run: it starts after `complete` has returned.
 *
 * The production store is `getDurableWorkflowRepository()`, resolved lazily at write time, so importing the route builds no database
 * client: PostgreSQL in production; the fixture runtime's in-memory repository under the fixture runtime. This module constructs no
 * repository of its own. A replay persists nothing: `replayCapsule` hands its recorder `options.sink ?? new InMemoryTraceSink()`,
 * never this factory (runbook :1088). Whether a serverless platform keeps a scheduled write alive after the response is
 * BLOCKED-LIVE-QUALIFICATION (LB-13, OD-190).
 */
import { getDurableWorkflowRepository } from "@/app/lib/durable-workflow/runtime";
import { DurableRunTraceStore, type RunTraceStore } from "@/app/lib/observability/run-trace-store";
import { setAgentTraceSinkFactory, type AgentTraceSink } from "@/app/lib/agent/trace-recorder";
import type { AgentRunTrace, AgentTraceEvent } from "@/app/lib/agent/trace";

/** The closed classes a scheduled write that did not land is counted under. */
export const RUN_TRACE_WRITE_FAILURES = Object.freeze(["store_unavailable", "refused", "stale_exhausted", "write_failed", "dropped"] as const);
export type RunTraceWriteFailure = (typeof RUN_TRACE_WRITE_FAILURES)[number];
export type RunTraceWriteCounts = Readonly<Record<RunTraceWriteFailure | "written" | "replayed", number>>;
/** At most this many writes are pending at once in a process; the next is dropped and counted. */
export const RUN_TRACE_PENDING_BOUND = 64;

type StoreFactory = () => RunTraceStore;
/** PostgreSQL in production; the fixture runtime's in-memory repository under `SIRKIT_FIXTURE_RUNTIME=blinker` (local_dev only). */
const productionStoreFactory: StoreFactory = () => new DurableRunTraceStore(getDurableWorkflowRepository());
let storeFactory: StoreFactory = productionStoreFactory;
const pending = new Set<Promise<void>>();
const zero = (): Record<RunTraceWriteFailure | "written" | "replayed", number> => ({ written: 0, replayed: 0, store_unavailable: 0, refused: 0, stale_exhausted: 0, write_failed: 0, dropped: 0 });
let counts = zero();

/** One durable append of a validated trace, under the trace's own scope; every outcome is counted, nothing is thrown. */
async function writeRunTrace(trace: AgentRunTrace, at: string): Promise<void> {
  let store: RunTraceStore;
  try {
    store = storeFactory();
  } catch {
    counts.store_unavailable += 1;
    return;
  }
  const result = await store.append({ scope: trace.scope, document: trace, at });
  if (result.ok) counts[result.replayed ? "replayed" : "written"] += 1;
  else counts[result.code === "stale_exhausted" ? "stale_exhausted" : "refused"] += 1;
}

/** Schedule one write; returns at once. A write past the pending bound is dropped. */
function scheduleRunTraceWrite(trace: AgentRunTrace): void {
  if (pending.size >= RUN_TRACE_PENDING_BOUND) {
    counts.dropped += 1;
    return;
  }
  const at = new Date().toISOString(); // the server clock (frozen under the fixture runtime, as every durable time there)
  const write: Promise<void> = Promise.resolve()
    .then(() => writeRunTrace(trace, at))
    .catch(() => { counts.write_failed += 1; })
    .finally(() => { pending.delete(write); });
  pending.add(write);
}

/** [B24-C1] The durable sink: synchronous, total, and it keeps nothing but the one scheduled write per finalized trace. */
export class DurableRunTraceSink implements AgentTraceSink {
  append(event: AgentTraceEvent): void {
    void event; // the finalized document carries every event; nothing is kept per event
  }
  complete(trace: AgentRunTrace): void {
    try {
      scheduleRunTraceWrite(trace);
    } catch {
      counts.write_failed += 1;
    }
  }
}

/** The factory bound at evaluation (and by a test that reset the recorder's factory). */
export function durableRunTraceSinkFactory(): AgentTraceSink {
  return new DurableRunTraceSink();
}

// ─── Test-only hooks (the `orchestration-runtime.ts` seam pattern) ────────────────────────────────────────────────────────────

/** Test-only override; restore via `resetRunTraceStoreFactory`. */
export function setRunTraceStoreFactory(factory: StoreFactory): void {
  storeFactory = factory;
}
export function resetRunTraceStoreFactory(): void {
  storeFactory = productionStoreFactory;
}
/** Wait until every scheduled write has settled (writes scheduled while waiting included). */
export async function drainRunTraceWrites(): Promise<void> {
  while (pending.size > 0) await Promise.allSettled([...pending]);
}
export function runTraceWriteCounts(): RunTraceWriteCounts {
  return Object.freeze({ ...counts });
}
export function resetRunTraceWriteCounts(): void {
  counts = zero();
}

// The one binding: evaluated once, when the chat route first loads this module.
setAgentTraceSinkFactory(durableRunTraceSinkFactory);
