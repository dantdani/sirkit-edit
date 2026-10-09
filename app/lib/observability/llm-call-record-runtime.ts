/**
 * [B24-C1] D24-21, OD-207: the binding of the LLM call record's sink over the durable-workflow repository. Its ONE production importer
 * is `instrumentation.ts`: Next.js calls `register()` once when the server starts, and under `NEXT_RUNTIME === "nodejs"` - after the
 * fixture clock is installed - it imports this module and calls `bindDurableLlmCallRecordSink()`. The seam's sink registry is on
 * `globalThis` (`llm-call-record.ts`), so the route bundles that record see the sink this bundle binds.
 *
 * The write is SCHEDULED, never awaited by a call: the seam hands each record to `write` on a microtask; the durable append sits in a
 * bounded process-local set (`LLM_CALL_PENDING_BOUND`; a write beyond it is `dropped`), and a failure is caught and counted by a closed
 * class - `store_unavailable`, `refused`, `write_failed`, `dropped` - never a message, a stack or a record fragment. Nothing about the
 * write can change a route's response. The repository is `getDurableWorkflowRepository()`, resolved lazily at write time, so binding the
 * sink builds no database client: PostgreSQL in production; the fixture runtime's in-memory repository under the fixture runtime. This
 * module constructs no repository of its own. Whether a serverless platform keeps a scheduled write alive after the response is
 * BLOCKED-LIVE-QUALIFICATION (LB-13, OD-190).
 *
 * [B24-C1 review, 2026-10-08] correctness-4: the appends run ONE at a time, in order. This module's one importer is the instrumentation
 * bundle, which need not share module instances with the route bundles (the reason the seam's registry is on `globalThis`), so its
 * `getDurableWorkflowRepository()` - and through it `db/client.ts` - may be a second instance with a pool of its own (INFERRED; no
 * `next start` ran here). Serial writes keep that pool to one session at a time, well under the session pooler's cap, instead of up
 * to its `max`. The pending bound counts queued writes; a write the store never settles holds the queue, and every later record is
 * then `dropped` and counted - never a response change.
 */
import { getDurableWorkflowRepository } from "../durable-workflow/runtime";
import { DurableLlmCallRecordStore, type LlmCallRecordStore } from "./llm-call-record-store";
import { bindLlmCallRecordSink, type LlmCallRecordEntry, type LlmCallRecordSink } from "./llm-call-record";

export const LLM_CALL_WRITE_FAILURES = Object.freeze(["store_unavailable", "refused", "write_failed", "dropped"] as const);
export type LlmCallWriteFailure = (typeof LLM_CALL_WRITE_FAILURES)[number];
export type LlmCallWriteCounts = Readonly<Record<LlmCallWriteFailure | "written" | "replayed", number>>;
/** At most this many call-record writes are pending at once in a process; the next is dropped and counted. */
export const LLM_CALL_PENDING_BOUND = 256;

type StoreFactory = () => LlmCallRecordStore;
const productionStoreFactory: StoreFactory = () => new DurableLlmCallRecordStore(getDurableWorkflowRepository());
let storeFactory: StoreFactory = productionStoreFactory;
const pending = new Set<Promise<void>>();
/** The tail of the one-at-a-time append queue. */
let queue: Promise<void> = Promise.resolve();
const zero =(): Record<LlmCallWriteFailure | "written" | "replayed", number> => ({ written: 0, replayed: 0, store_unavailable: 0, refused: 0, write_failed: 0, dropped: 0 });
let counts = zero();

async function writeLlmCallRecord(entry: LlmCallRecordEntry): Promise<void> {
  let store: LlmCallRecordStore;
  try {
    store = storeFactory();
  } catch {
    counts.store_unavailable += 1;
    return;
  }
  const result = await store.append({ scope: entry.scope, record: entry.record });
  if (result.ok) counts[result.replayed ? "replayed" : "written"] += 1;
  else counts.refused += 1;
}

/** [B24-C1] The durable sink: `write` returns at once and schedules one append; it never throws. */
export const durableLlmCallRecordSink: LlmCallRecordSink = Object.freeze({
  write(entry: LlmCallRecordEntry): void {
    try {
      if (pending.size >= LLM_CALL_PENDING_BOUND) {
        counts.dropped += 1;
        return;
      }
      const write: Promise<void> = queue
        .then(() => writeLlmCallRecord(entry))
        .catch(() => { counts.write_failed += 1; })
        .finally(() => { pending.delete(write); });
      queue = write; // [B24-C1 review, 2026-10-08] correctness-4: the next append starts after this one settles (`write` never rejects)
      pending.add(write);
    } catch {
      counts.write_failed += 1;
    }
  },
});

/** Bind the durable sink (instrumentation's `register()`, under the nodejs runtime). */
export function bindDurableLlmCallRecordSink(): void {
  bindLlmCallRecordSink(durableLlmCallRecordSink);
}

// ─── Test-only hooks (the `orchestration-runtime.ts` seam pattern) ────────────────────────────────────────────────────────────
export function setLlmCallRecordStoreFactory(factory: StoreFactory): void {
  storeFactory = factory;
}
export function resetLlmCallRecordStoreFactory(): void {
  storeFactory = productionStoreFactory;
}
/** Wait until every scheduled write has settled (a record handed over on a pending microtask included). */
export async function drainLlmCallRecordWrites(): Promise<void> {
  await new Promise<void>((resolve) => { queueMicrotask(resolve); });
  while (pending.size > 0) await Promise.allSettled([...pending]);
}
export function llmCallRecordWriteCounts(): LlmCallWriteCounts {
  return Object.freeze({ ...counts });
}
export function resetLlmCallRecordWriteCounts(): void {
  counts = zero();
}
