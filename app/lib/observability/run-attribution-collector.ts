/**
 * [B24-C2] D24-22, D24-23, OD-208, OD-209: the chat route's PASSIVE observer and the builder of the attribution document. The route
 * creates one collector per run before its recorder exists, then:
 *  - wraps C1's sink with it (`wrapSink`): every appended trace event is timed on an INJECTED monotonic clock, keyed by the event's
 *    `seq` (at most TRACE_BOUNDS.maxEvents offsets), the trace's terminal event gives `terminalOffsetMs`, and `complete` captures the
 *    VALIDATED document the recorder hands over together with its `agentRunTraceDigest` - never inside trace.ts or trace-recorder.ts;
 *  - decorates the coordinator's adapter (`observeAdapter`): each resolved step's `providerRequestId` is collected, at most
 *    2 x maxModelSteps of them, each matching REQUEST_ID_RULE and free of a secret shape, the rest counted in `requestIdsWithheld`;
 *  - sees every UI event the route emits (`observeEmit`): the first `text_delta`'s offset, the `tool_refused` statuses by closed class,
 *    and the first `run_completed`'s final text (kept in memory for its salted digest and character count, never stored).
 * Every observer is TOTAL: it never throws into the stream, the recorder or the adapter, and it changes no event, step or document.
 *
 * `buildRunTraceAttribution` turns the observations and the route's trusted inputs into the document: the salted digests (null, with
 * `salt_unavailable`, when the salt could not be resolved), the toolset digest over the run's provider declarations, at most 64 reads
 * of 64 resources each from the injected read service's traces, the budget snapshot, the cost the route priced and the deployment
 * configuration digest the instrumentation published (null, with `deployment_configuration_unavailable`, when none was). It answers null
 * when no validated trace was captured: a document is written only for a trace that validated.
 *
 * Pure: `../agent/trace` (the digest and the bounds), `../agent/redaction` (the secret shape rule, dependency-neutral),
 * `../engineering/stable` (the digest) and `./trace-salt` (the salted digest); no SDK, no durable runtime, no database.
 */
import type { AgentRunBudget, AgentRunEvent, AgentStep, ProviderAgentAdapter, ProviderToolDeclaration } from "../agent/contracts";
import { containsSecretShapedText } from "../agent/redaction";
import type { AgentTraceSink } from "../agent/trace-recorder";
import { TRACE_BOUNDS, agentRunTraceDigest, type AgentRunTrace, type AgentTraceEvent } from "../agent/trace";
import { engineeringDigest } from "../engineering/stable";
import { ATTRIBUTION_BOUNDS, REFUSED_CALL_CLASSES, REQUEST_ID_RULE, RUN_TRACE_ATTRIBUTION_SCHEMA, type AttributionDiagnostic, type AttributionPlanKind, type AttributionRead, type RefusedCallClass, type RunTraceAttribution } from "./run-trace-attribution";
import { saltedDigest } from "./trace-salt";

export interface RunAttributionCollectorOptions {
  readonly provider: "openai" | "anthropic";
  readonly budget: AgentRunBudget;
  /** a monotonic clock in milliseconds (default `performance.now`) */
  readonly clock?: () => number;
}
/** What one run's observers collected (a frozen copy). */
export interface RunAttributionObservations {
  readonly provider: "openai" | "anthropic";
  /** the validated trace the recorder handed to the sink, or null when none reached it */
  readonly trace: AgentRunTrace | null;
  readonly traceDigest: string | null;
  readonly eventOffsets: ReadonlyArray<{ seq: number; offsetMs: number }>;
  readonly terminalOffsetMs: number | null;
  readonly firstTextOffsetMs: number | null;
  readonly refusedCalls: Readonly<Record<RefusedCallClass, number>>;
  readonly requestIds: readonly string[];
  readonly requestIdsWithheld: number;
  /** the first run_completed's final text (in memory only; the document keeps its salted digest and its length) */
  readonly answerText: string | null;
}
export interface RunAttributionCollector {
  wrapSink<T extends { sink: AgentTraceSink }>(created: T): T;
  observeAdapter(adapter: ProviderAgentAdapter): ProviderAgentAdapter;
  observeEmit(event: AgentRunEvent): void;
  observations(): RunAttributionObservations;
}
/** The shape of a read trace the collector projects (engineering/tool-invocation.ts `ReadInvocationTrace`, the two fields it reads). */
export interface RunAttributionReadTrace {
  readonly sourceRevisionDigest: string;
  readonly consumedResources?: ReadonlyArray<{ readonly resourceId: string; readonly kind?: string; readonly sourceVersion: string; readonly contentDigest: string }>;
}
export interface BuildRunTraceAttributionInput {
  readonly observations: RunAttributionObservations;
  readonly scope: { tenantId: string; projectId: string; branchId: string };
  readonly trusted: { principalId: string; role: RunTraceAttribution["trustedContext"]["role"]; membershipRevision: string; authClass: RunTraceAttribution["trustedContext"]["authClass"]; correlationId: string | null | undefined };
  readonly userMessage: string;
  readonly planKind: AttributionPlanKind;
  /** the run's provider-exposed declarations (buildRunToolset), or null for a refused plan */
  readonly toolsetDeclarations: readonly ProviderToolDeclaration[] | null;
  readonly readTraces: readonly RunAttributionReadTrace[];
  readonly deploymentConfigurationDigest: string | null;
  readonly cost: RunTraceAttribution["cost"];
  /** the scope's salt, or null when it could not be resolved (then every salted digest is null) */
  readonly salt: Uint8Array | null;
  readonly budget: AgentRunBudget;
  readonly retryCeiling: RunTraceAttribution["provider"]["retryCeiling"];
}

const defaultClock = (): number => performance.now();
const zeroRefusals = (): Record<RefusedCallClass, number> => Object.fromEntries(REFUSED_CALL_CLASSES.map((status) => [status, 0])) as Record<RefusedCallClass, number>;
const isRefusalClass = (status: string): status is RefusedCallClass => (REFUSED_CALL_CLASSES as readonly string[]).includes(status) && status !== "other";
/** A finite, non-negative offset in whole milliseconds since the collector was created (never negative on a clock that moved back). */
const offsetMs = (now: number, start: number): number => {
  const elapsed = now - start;
  return Number.isFinite(elapsed) && elapsed > 0 ? Math.min(Math.floor(elapsed), ATTRIBUTION_BOUNDS.maxCount) : 0;
};

/** [B24-C2] One run's passive observer. */
export function createRunAttributionCollector(options: RunAttributionCollectorOptions): RunAttributionCollector {
  const clock = options.clock ?? defaultClock;
  const maxRequestIds = Math.min(ATTRIBUTION_BOUNDS.maxRequestIds, 2 * Math.max(0, Math.floor(options.budget.maxModelSteps)));
  const start = safeNow(clock, 0);
  const eventOffsets: Array<{ seq: number; offsetMs: number }> = [];
  let terminalOffsetMs: number | null = null;
  let firstTextOffsetMs: number | null = null;
  let trace: AgentRunTrace | null = null;
  let traceDigest: string | null = null;
  const refusedCalls = zeroRefusals();
  const requestIds: string[] = [];
  let requestIdsWithheld = 0;
  let answerText: string | null = null;
  let lastOffset = 0;
  const offsetNow = (): number => { const offset = Math.max(lastOffset, offsetMs(safeNow(clock, start), start)); lastOffset = offset; return offset; };

  const noteEvent = (event: AgentTraceEvent): void => {
    try {
      const offset = offsetNow();
      if (typeof event.seq === "number" && Number.isSafeInteger(event.seq) && event.seq > 0 && eventOffsets.length < TRACE_BOUNDS.maxEvents && (eventOffsets.length === 0 || event.seq > eventOffsets[eventOffsets.length - 1]!.seq)) eventOffsets.push({ seq: event.seq, offsetMs: offset });
      if (event.kind === "terminal" && terminalOffsetMs === null) terminalOffsetMs = offset;
    } catch { /* passive */ }
  };
  const noteComplete = (document: AgentRunTrace): void => {
    try {
      if (trace !== null) return; // the recorder completes once; a second hand-over is never a second document
      trace = document;
      traceDigest = agentRunTraceDigest(document);
    } catch { trace = null; traceDigest = null; }
  };
  const noteStep = (step: AgentStep): void => {
    try {
      if (!("providerRequestId" in step)) return;
      const id = (step as { providerRequestId?: unknown }).providerRequestId;
      if (typeof id !== "string") { requestIdsWithheld += 1; return; }
      if (requestIds.length >= maxRequestIds || !REQUEST_ID_RULE.test(id) || containsSecretShapedText(id)) { requestIdsWithheld += 1; return; }
      requestIds.push(id);
    } catch { /* passive */ }
  };

  return {
    wrapSink(created) {
      const inner = created.sink;
      const sink: AgentTraceSink = {
        append(event) {
          noteEvent(event); // before the inner sink: a throwing sink still gets its event timed, and the throw still reaches the recorder
          inner.append(event);
        },
        complete(document) {
          noteComplete(document);
          inner.complete(document);
        },
      };
      return { ...created, sink };
    },
    observeAdapter(adapter) {
      const observed: ProviderAgentAdapter = {
        provider: adapter.provider,
        async start(input) {
          const step = await adapter.start(input);
          noteStep(step);
          return step;
        },
        async continueWith(input) {
          const step = await adapter.continueWith(input);
          noteStep(step);
          return step;
        },
      };
      return observed;
    },
    observeEmit(event) {
      try {
        if (event.type === "text_delta") { if (firstTextOffsetMs === null) firstTextOffsetMs = offsetNow(); return; }
        if (event.type === "tool_refused") { const status = typeof event.status === "string" && isRefusalClass(event.status) ? event.status : "other"; refusedCalls[status] += 1; return; }
        if (event.type === "run_completed" && answerText === null) answerText = typeof event.finalText === "string" ? event.finalText : "";
      } catch { /* passive */ }
    },
    observations() {
      return Object.freeze({
        provider: options.provider, trace, traceDigest, eventOffsets: eventOffsets.map((entry) => ({ ...entry })), terminalOffsetMs, firstTextOffsetMs,
        refusedCalls: { ...refusedCalls }, requestIds: [...requestIds], requestIdsWithheld, answerText,
      });
    },
  };
}
function safeNow(clock: () => number, fallback: number): number {
  try { const now = clock(); return typeof now === "number" && Number.isFinite(now) ? now : fallback; } catch { return fallback; }
}

const ID_RULE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const idOrNull = (value: unknown): string | null => (typeof value === "string" && ID_RULE.test(value) ? value : null);

/** The run's read traces projected to digests and ids: at most 64 reads of 64 resources each, the rest counted. */
function projectReads(readTraces: readonly RunAttributionReadTrace[], canonicalRevisionDigest: unknown): RunTraceAttribution["reads"] {
  const entries: AttributionRead[] = [];
  let withheld = 0;
  for (const read of readTraces) {
    const sourceRevisionDigest = idOrNull(read.sourceRevisionDigest);
    if (entries.length >= ATTRIBUTION_BOUNDS.maxReads || sourceRevisionDigest === null) { withheld += 1; continue; }
    const resources: AttributionRead["resources"] = [];
    let resourcesWithheld = 0;
    for (const resource of read.consumedResources ?? []) {
      const resourceId = idOrNull(resource.resourceId), sourceVersion = idOrNull(resource.sourceVersion), contentDigest = idOrNull(resource.contentDigest);
      if (resources.length >= ATTRIBUTION_BOUNDS.maxResourcesPerRead || resourceId === null || sourceVersion === null || contentDigest === null) { resourcesWithheld += 1; continue; }
      resources.push({ resourceId, sourceVersion, contentDigest });
    }
    entries.push({ sourceRevisionDigest, resources, resourcesWithheld });
  }
  return { canonicalRevisionDigest: idOrNull(canonicalRevisionDigest), count: readTraces.length, withheld, entries };
}

/** [B24-C2] The attribution document of one run, or null when no validated trace was captured. */
export function buildRunTraceAttribution(input: BuildRunTraceAttributionInput): RunTraceAttribution | null {
  const { observations, salt } = input;
  if (observations.trace === null || observations.traceDigest === null) return null;
  const trace = observations.trace;
  const diagnostics: AttributionDiagnostic[] = [];
  if (salt === null) diagnostics.push("salt_unavailable");
  if (input.deploymentConfigurationDigest === null) diagnostics.push("deployment_configuration_unavailable");
  const digest = (domain: "principal" | "message" | "answer", text: string): string | null => (salt === null ? null : saltedDigest(salt, domain, text));
  const budget = input.budget;
  return {
    schema: RUN_TRACE_ATTRIBUTION_SCHEMA,
    runId: trace.runId,
    traceId: trace.traceId,
    traceDigest: observations.traceDigest,
    scope: { tenantId: input.scope.tenantId, projectId: input.scope.projectId, branchId: input.scope.branchId },
    trustedContext: { correlationId: idOrNull(input.trusted.correlationId), role: input.trusted.role, membershipRevision: input.trusted.membershipRevision, authClass: input.trusted.authClass, principalRef: digest("principal", input.trusted.principalId) },
    request: { messageDigest: digest("message", input.userMessage), messageChars: input.userMessage.length },
    plan: { kind: input.planKind },
    toolset: input.toolsetDeclarations === null ? null : { declarationsDigest: engineeringDigest({ schema: "sirkit.agent-toolset-declarations.v1", declarations: input.toolsetDeclarations }), toolCount: input.toolsetDeclarations.length },
    reads: projectReads(input.readTraces, trace.contextDigests.canonicalRevisionDigest),
    refusedCalls: { ...observations.refusedCalls },
    provider: { requestIds: [...observations.requestIds], requestIdsWithheld: observations.requestIdsWithheld, retryCeiling: input.retryCeiling, sdkRetriesObserved: "unknown" },
    answer: observations.answerText === null ? null : { digest: digest("answer", observations.answerText), chars: observations.answerText.length, outcome: trace.terminal.outcome },
    deploymentConfigurationDigest: input.deploymentConfigurationDigest,
    budget: { maxModelSteps: budget.maxModelSteps, maxToolCalls: budget.maxToolCalls, perToolTimeoutMs: budget.perToolTimeoutMs, runDeadlineMs: budget.runDeadlineMs, maxIdenticalCalls: budget.maxIdenticalCalls, executionSettlementTimeoutMs: budget.executionSettlementTimeoutMs },
    cost: input.cost.status === "priced" ? { status: "priced", priceTableVersion: input.cost.priceTableVersion, currency: input.cost.currency, costMicrounits: input.cost.costMicrounits } : { status: "unpriced", reason: input.cost.reason },
    latency: { clock: "monotonic", firstTextOffsetMs: observations.firstTextOffsetMs, terminalOffsetMs: observations.terminalOffsetMs, eventOffsets: observations.eventOffsets.map((entry) => ({ seq: entry.seq, offsetMs: entry.offsetMs })) },
    diagnostics,
  };
}
