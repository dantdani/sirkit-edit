/**
 * [B24-C2] D24-22, D24-23, OD-208, OD-209: the chat composition root's attribution of every run - beside C1's `trace-runtime.ts`, the
 * one module of the chat route that reaches the durable runtime for the attribution. The route calls `beginRunAttribution` once per run,
 * before its recorder exists, and gets back the run's PASSIVE observers (the collector, `app/lib/observability/run-attribution-collector.ts`),
 * the read service it injects into the gateway (so the run's read traces can be attributed) and ONE `record` call for its finalization:
 *
 *  - `record` schedules one write and returns at once (the recorder's sink contract is synchronous, and finalization is passive): resolve
 *    the scope's salt (`agent.trace-salt.v1`, created once by compare-and-set), price the trace's usage through the ONE price table
 *    (`MODEL_PRICE_TABLE`, null today: "unpriced", never zero), read the published deployment configuration digest, build the document,
 *    validate it and append it as `agent.run-trace-attribution.v1` (compare-and-set at revision 0, no outbox effect, a replay writes
 *    nothing);
 *  - a failure is caught and counted by a closed class - `trace_unavailable` (no validated trace reached the sink), `store_unavailable`
 *    (a store factory threw), `refused` (a closed store refusal), `write_failed` (the repository rejected), `dropped` (past the pending
 *    bound) - never a message, a stack or a fragment of the document; nothing about the write can change the stream, the terminal or
 *    the run: it starts after `record` has returned;
 *  - the repositories are `getDurableWorkflowRepository()`, resolved lazily at write time, so importing the route builds no database
 *    client: PostgreSQL in production, the fixture runtime's in-memory repository under the fixture runtime. This module constructs no
 *    repository of its own (D11: the one PostgreSQL repository construction site stays `durable-workflow/runtime.ts`).
 *
 * The toolset digest is taken over `buildRunToolset(...).declarations` on the run's registry and context (the loop's own derivation,
 * recomputed here at record time; a refused plan has none); the reads over the injected read service's traces; the request ids through
 * the observed coordinator adapter (a dag plan's follow-up turn runs on the same decorated adapter under the same budget); the retry
 * ceiling is the coordinator adapter's configured value (`COORDINATOR_SDK_RETRY_CEILING`). Specialist traces are attributed by
 * B21-E's per-task record and are not rebuilt here.
 */
import { getDurableWorkflowRepository } from "@/app/lib/durable-workflow/runtime";
import { buildRunToolset } from "@/app/lib/agent/loop";
import { COORDINATOR_SDK_RETRY_CEILING } from "@/app/lib/agent/adapters";
import type { AgentRunBudget, AgentRunContext, AgentRunEvent, ProviderAgentAdapter } from "@/app/lib/agent/contracts";
import type { AgentTraceSink } from "@/app/lib/agent/trace-recorder";
import type { ToolRegistry } from "@/app/lib/engineering/tool-registry";
import { ReadToolInvocationService } from "@/app/lib/engineering/tool-invocation";
import { MODEL_PRICE_TABLE, priceUsage } from "@/app/lib/evaluation/model-price-table";
import { publishedDeploymentConfigurationDigest } from "@/app/lib/observability/deployment-configuration-digest";
import { buildRunTraceAttribution, createRunAttributionCollector, type BuildRunTraceAttributionInput } from "@/app/lib/observability/run-attribution-collector";
import { DurableRunTraceAttributionStore, type RunTraceAttributionStore } from "@/app/lib/observability/run-trace-attribution";
import { DurableTraceSaltStore, type TraceSaltStore } from "@/app/lib/observability/trace-salt";

/** The closed classes a scheduled write that did not land is counted under. */
export const RUN_ATTRIBUTION_WRITE_FAILURES = Object.freeze(["trace_unavailable", "store_unavailable", "refused", "write_failed", "dropped"] as const);
export type RunAttributionWriteFailure = (typeof RUN_ATTRIBUTION_WRITE_FAILURES)[number];
export type RunAttributionWriteCounts = Readonly<Record<RunAttributionWriteFailure | "written" | "replayed", number>>;
/** At most this many attribution writes are pending at once in a process; the next is dropped and counted. */
export const RUN_ATTRIBUTION_PENDING_BOUND = 64;

export interface BeginRunAttributionInput {
  readonly registry: ToolRegistry;
  readonly context: AgentRunContext;
  readonly provider: "openai" | "anthropic";
  readonly budget: AgentRunBudget;
}
export interface RecordRunAttributionInput {
  readonly planKind: "single" | "dag" | "refused";
  readonly scope: { tenantId: string; projectId: string; branchId: string };
  readonly trusted: BuildRunTraceAttributionInput["trusted"];
  readonly userMessage: string;
}
export interface RunAttribution {
  /** the read service the route injects into its gateway: its traces are the run's reads */
  readonly readService: ReadToolInvocationService;
  wrapSink<T extends { sink: AgentTraceSink }>(created: T): T;
  observeAdapter(adapter: ProviderAgentAdapter): ProviderAgentAdapter;
  observeEmit(event: AgentRunEvent): void;
  /** Schedule the one write of this run's attribution; idempotent, total, returns at once. */
  record(input: RecordRunAttributionInput): void;
}

type AttributionStoreFactory = () => RunTraceAttributionStore;
type SaltStoreFactory = () => TraceSaltStore;
const productionAttributionStoreFactory: AttributionStoreFactory = () => new DurableRunTraceAttributionStore(getDurableWorkflowRepository());
const productionSaltStoreFactory: SaltStoreFactory = () => new DurableTraceSaltStore(getDurableWorkflowRepository());
let attributionStoreFactory: AttributionStoreFactory = productionAttributionStoreFactory;
let saltStoreFactory: SaltStoreFactory = productionSaltStoreFactory;
let clockFactory: (() => number) | null = null;
const pending = new Set<Promise<void>>();
const zero = (): Record<RunAttributionWriteFailure | "written" | "replayed", number> => ({ written: 0, replayed: 0, trace_unavailable: 0, store_unavailable: 0, refused: 0, write_failed: 0, dropped: 0 });
let counts = zero();

/** One durable append of a run's attribution; every outcome is counted, nothing is thrown. */
async function writeRunAttribution(build: Omit<BuildRunTraceAttributionInput, "salt" | "cost" | "deploymentConfigurationDigest">, at: string): Promise<void> {
  const trace = build.observations.trace;
  if (trace === null) { counts.trace_unavailable += 1; return; }
  let attributions: RunTraceAttributionStore;
  let salts: TraceSaltStore | null;
  try {
    attributions = attributionStoreFactory();
  } catch {
    counts.store_unavailable += 1;
    return;
  }
  try { salts = saltStoreFactory(); } catch { salts = null; } // no salt store: the document is written with null digests and `salt_unavailable`
  const resolved = salts === null ? null : await salts.resolve(build.scope, at);
  const salt = resolved !== null && resolved.ok ? resolved.salt : null;
  const cost = priceUsage({ provider: trace.provider, model: trace.model, usage: trace.terminal.usage }, MODEL_PRICE_TABLE);
  const document = buildRunTraceAttribution({ ...build, salt, cost, deploymentConfigurationDigest: publishedDeploymentConfigurationDigest() });
  if (document === null) { counts.trace_unavailable += 1; return; }
  const result = await attributions.append({ scope: build.scope, document, at });
  if (result.ok) counts[result.replayed ? "replayed" : "written"] += 1;
  else counts.refused += 1;
}

/** Schedule one write; returns at once. A write past the pending bound is dropped. */
function scheduleRunAttributionWrite(build: Omit<BuildRunTraceAttributionInput, "salt" | "cost" | "deploymentConfigurationDigest">): void {
  if (pending.size >= RUN_ATTRIBUTION_PENDING_BOUND) {
    counts.dropped += 1;
    return;
  }
  const at = new Date().toISOString(); // the server clock (frozen under the fixture runtime, as every durable time there)
  const write: Promise<void> = Promise.resolve()
    .then(() => writeRunAttribution(build, at))
    .catch(() => { counts.write_failed += 1; })
    .finally(() => { pending.delete(write); });
  pending.add(write);
}

/** [B24-C2] One run's attribution: its observers, its read service and its one record. */
export function beginRunAttribution(input: BeginRunAttributionInput): RunAttribution {
  const collector = createRunAttributionCollector({ provider: input.provider, budget: input.budget, ...(clockFactory ? { clock: clockFactory } : {}) });
  const readService = new ReadToolInvocationService(input.registry);
  let recorded = false;
  return {
    readService,
    wrapSink: (created) => collector.wrapSink(created),
    observeAdapter: (adapter) => collector.observeAdapter(adapter),
    observeEmit: (event) => collector.observeEmit(event),
    record(record) {
      try {
        if (recorded) return;
        recorded = true;
        const toolsetDeclarations = record.planKind === "refused" ? null : buildRunToolset(input.registry, input.context, () => { /* the loop's warnings were shown on the stream */ }).declarations;
        scheduleRunAttributionWrite({
          observations: collector.observations(), scope: { tenantId: record.scope.tenantId, projectId: record.scope.projectId, branchId: record.scope.branchId }, trusted: record.trusted, userMessage: record.userMessage,
          planKind: record.planKind, toolsetDeclarations, readTraces: readService.traces(), budget: input.budget, retryCeiling: COORDINATOR_SDK_RETRY_CEILING[input.provider],
        });
      } catch {
        counts.write_failed += 1;
      }
    },
  };
}

// ─── Test-only hooks (the `trace-runtime.ts` seam pattern) ───────────────────────────────────────────────────────────────────

export function setRunAttributionStoreFactory(factory: AttributionStoreFactory): void { attributionStoreFactory = factory; }
export function resetRunAttributionStoreFactory(): void { attributionStoreFactory = productionAttributionStoreFactory; }
export function setTraceSaltStoreFactory(factory: SaltStoreFactory): void { saltStoreFactory = factory; }
export function resetTraceSaltStoreFactory(): void { saltStoreFactory = productionSaltStoreFactory; }
/** Test-only: the monotonic clock every later collector of this process reads (default `performance.now`). */
export function setRunAttributionClock(clock: (() => number) | null): void { clockFactory = clock; }
/** Wait until every scheduled write has settled (writes scheduled while waiting included). */
export async function drainRunAttributionWrites(): Promise<void> {
  while (pending.size > 0) await Promise.allSettled([...pending]);
}
export function runAttributionWriteCounts(): RunAttributionWriteCounts { return Object.freeze({ ...counts }); }
export function resetRunAttributionWriteCounts(): void { counts = zero(); }
