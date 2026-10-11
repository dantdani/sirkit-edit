/**
 * [B24-C1] D24-21, OD-207: the LLM call record, `sirkit.llm-call-record.v1`, and the ONE seam every provider call of the model-egress
 * routes passes through. Twenty-two route paths besides `/api/chat` (B23-A2's derived `model_egress` column) call a model and kept no
 * durable record of it; each provider call made inside one of them now leaves one record - route, method, provider, model, call kind,
 * token counts, latency and a closed outcome class - and nothing of what was asked or answered.
 *
 * Pure: the runtime imports are `node:async_hooks`, `node:crypto`, `../llm/types` and `../llm/errors` only, so the call points
 * (`llm/router.ts`, `embeddings.ts`, `parts-search.ts`) and the route wrappers (`auth/route-handlers.ts`) gain no durable, database or
 * SDK reach through it (b24-c1-llm-call-record pins every closure).
 *
 *  - `withLlmCallScope({ routeId, method, scope }, fn)` runs `fn` on an `AsyncLocalStorage` anchored on `globalThis` (as the fixture
 *    container is): the three route wrappers enter it with the exact policy path, never the raw URL, and the trusted context's tenant,
 *    project and branch - or, on the two public paths, `PUBLIC_MODEL_EGRESS_SCOPE`, the reserved operator scope (no principal);
 *  - `recordModelCall(meta, invoke)` returns or throws exactly what `invoke` does and times it monotonically; inside a scope it hands
 *    ONE record to the bound sink (scheduled, never awaited; a sink failure is counted); outside a scope, or with no sink bound, it
 *    writes nothing and counts `unscoped` or `unbound`. One record per SDK call: the SDK's own retries are not visible here;
 *  - the record holds no prompt, answer, query or embedding text, no tool argument, no provider message or request id, no principal,
 *    no cost and no key; its validator bounds every number, pins every identifier to a closed rule and refuses a secret-shaped value.
 *
 * The sink registry is on `globalThis` too, because the instrumentation bundle that binds it (`instrumentation.ts`, through
 * `llm-call-record-runtime.ts`) and the route bundles that record need not share module instances.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { toProviderError, type LLMProviderFailureReason } from "../llm/errors";
import { LLM_PROVIDER_IDS, type LLMProviderId } from "../llm/types";

export const LLM_CALL_RECORD_SCHEMA = "sirkit.llm-call-record.v1" as const;
/** The record's closed keys, in order. */
export const LLM_CALL_RECORD_KEYS = Object.freeze(["schema", "callId", "requestRef", "seq", "routeId", "method", "provider", "model", "kind", "inputTokens", "outputTokens", "latencyMs", "outcome", "startedAt"] as const);
export const LLM_CALL_KINDS = Object.freeze(["generate", "stream", "embedding", "rerank"] as const);
export type LlmCallKind = (typeof LLM_CALL_KINDS)[number];
/** The twelve `LLMProviderFailureReason` values (`llm/errors.ts`), in their declared order. */
export const LLM_CALL_FAILURE_REASONS = Object.freeze(["missing_credentials", "authentication", "insufficient_quota", "model_access", "rate_limit", "overloaded", "bad_request", "timeout", "cancelled", "network", "unrequested_output", "unknown"] as const satisfies readonly LLMProviderFailureReason[]);
/** `completed`, or the failure reason `toProviderError` classified: thirteen classes. */
export const LLM_CALL_OUTCOMES = Object.freeze(["completed", ...LLM_CALL_FAILURE_REASONS] as const);
export type LlmCallOutcome = (typeof LLM_CALL_OUTCOMES)[number];
export const LLM_CALL_METHODS = Object.freeze(["GET", "POST", "PUT", "PATCH", "DELETE"] as const);
export const LLM_CALL_BOUNDS = Object.freeze({ maxSeq: 10_000, maxTokens: 100_000_000, maxLatencyMs: 86_400_000, maxModelChars: 128, maxRouteChars: 200, maxIssues: 16 });
/** [B24-C1] choice (a): the two public model-egress paths have no tenant or project; their records go under this reserved operator scope. [B24-C1 review 2] security-7: the tenant id's leading `~` lies outside the trusted context's selector alphabet (`ID_PATTERN`, `auth/trusted-request-context.ts`), so no authenticated selector can name it - the reservation is a property of the id space (b24-c1-llm-call-record 13). */
export const PUBLIC_MODEL_EGRESS_SCOPE = Object.freeze({ tenantId: "~sirkit-operator", projectId: "public-model-egress", branchId: "main" });

export interface LlmCallScope { readonly tenantId: string; readonly projectId: string; readonly branchId: string }
export interface LlmCallRecord {
  schema: typeof LLM_CALL_RECORD_SCHEMA;
  /** this call's own id, `llmc-<uuid>` */
  callId: string;
  /** the request's id, `llmr-<uuid>`, shared by every call one request makes */
  requestRef: string;
  /** 1..N in the order the request's calls started */
  seq: number;
  /** the exact policy path (`policyFor`), never the raw URL */
  routeId: string;
  method: string;
  provider: LLMProviderId;
  model: string;
  kind: LlmCallKind;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  outcome: LlmCallOutcome;
  startedAt: string;
}
export interface LlmCallRecordEntry { readonly scope: LlmCallScope; readonly record: LlmCallRecord }
/** The bound sink: synchronous, and it must never throw (a throw is counted `sink_failed`). */
export interface LlmCallRecordSink { write(entry: LlmCallRecordEntry): void }
/** What of an answer a record keeps: its model and its token counts, never its content. */
export interface ModelCallUsage { model?: unknown; inputTokens?: unknown; outputTokens?: unknown }
export interface ModelCallMeta<T> {
  provider: LLMProviderId;
  /** the configured model: recorded when the call fails (a success records the answer's own model) */
  model: string;
  kind: LlmCallKind;
  usage?: (result: T) => ModelCallUsage | null | undefined;
}
export const LLM_CALL_SEAM_COUNTS = Object.freeze(["recorded", "unscoped", "unbound", "invalid", "sink_failed"] as const);
export type LlmCallSeamCount = (typeof LLM_CALL_SEAM_COUNTS)[number];

interface ScopeState { readonly routeId: string; readonly method: string; readonly scope: LlmCallScope; requestRef: string | null; seq: number }
interface SeamState { readonly storage: AsyncLocalStorage<ScopeState>; sink: LlmCallRecordSink | null; counts: Record<LlmCallSeamCount, number> }
const SEAM_KEY = Symbol.for("sirkit.b24-c1.llm-call-record-seam");
const zeroCounts = (): Record<LlmCallSeamCount, number> => ({ recorded: 0, unscoped: 0, unbound: 0, invalid: 0, sink_failed: 0 });
function seam(): SeamState {
  const holder = globalThis as unknown as Record<symbol, SeamState | undefined>;
  let state = holder[SEAM_KEY];
  if (state === undefined) {
    state = { storage: new AsyncLocalStorage<ScopeState>(), sink: null, counts: zeroCounts() };
    holder[SEAM_KEY] = state;
  }
  return state;
}

/** Run `fn` inside one request's call scope (the three scope-entering route wrappers). Returns or throws exactly what `fn` does. */
export function withLlmCallScope<T>(input: { routeId: string; method: string; scope: LlmCallScope }, fn: () => T): T {
  const state: ScopeState = { routeId: input.routeId, method: input.method.toUpperCase(), scope: Object.freeze({ tenantId: input.scope.tenantId, projectId: input.scope.projectId, branchId: input.scope.branchId }), requestRef: null, seq: 0 };
  return seam().storage.run(state, fn);
}
/** The scope a call made now would be recorded under (a frozen copy; null outside a scope). */
export function currentLlmCallScope(): { routeId: string; method: string; scope: LlmCallScope } | null {
  const state = seam().storage.getStore();
  return state === undefined ? null : Object.freeze({ routeId: state.routeId, method: state.method, scope: state.scope });
}
export function bindLlmCallRecordSink(sink: LlmCallRecordSink | null): void {
  seam().sink = sink;
}
export function boundLlmCallRecordSink(): LlmCallRecordSink | null {
  return seam().sink;
}
export function llmCallSeamCounts(): Readonly<Record<LlmCallSeamCount, number>> {
  return Object.freeze({ ...seam().counts });
}
export function resetLlmCallSeamCounts(): void {
  seam().counts = zeroCounts();
}

const CALL_ID = /^llmc-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REQUEST_REF = /^llmr-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** An exact policy path: `/api` and static or bracketed dynamic segments - never a query, a host or an expanded id. */
const ROUTE_ID = /^\/api(?:\/(?:[a-z0-9][a-z0-9._-]{0,63}|\[(?:\.{3})?[A-Za-z][A-Za-z0-9]{0,31}\]))+$/;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** Key and token shapes (the secret scan's rules, restated so that this statement matches none of them). */
const SECRET_SHAPES: readonly RegExp[] = [/sk-ant-[A-Za-z0-9_-]{8,}/, /\bsk-[A-Za-z0-9_-]{16,}/, /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/, /gh[pousr]_[A-Za-z0-9]{20,}/, /AKIA[0-9A-Z]{16}/, /hf_[A-Za-z0-9]{20,}/, /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, /sb_secret_[A-Za-z0-9_-]{10,}/, /-{5}BEGIN [A-Z ]*PRIVATE/];
export const secretShaped = (value: string): boolean => SECRET_SHAPES.some((pattern) => pattern.test(value));
const isInstant = (value: unknown): boolean => typeof value === "string" && INSTANT.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const boundedInteger = (value: unknown, min: number, max: number): boolean => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;

/** Every violation of the record contract (bounded; empty: a valid record). Issues name keys only, never a value. */
export function validateLlmCallRecord(value: unknown): string[] {
  const issues: string[] = [];
  const push = (issue: string): void => { if (issues.length < LLM_CALL_BOUNDS.maxIssues) issues.push(issue); };
  if (value === null || typeof value !== "object" || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return ["record: not a plain object"];
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== LLM_CALL_RECORD_KEYS.length || !LLM_CALL_RECORD_KEYS.every((key) => Object.prototype.hasOwnProperty.call(record, key))) push("record: keys are not exactly the closed set");
  if (record.schema !== LLM_CALL_RECORD_SCHEMA) push("schema");
  if (typeof record.callId !== "string" || !CALL_ID.test(record.callId)) push("callId");
  if (typeof record.requestRef !== "string" || !REQUEST_REF.test(record.requestRef)) push("requestRef");
  if (!boundedInteger(record.seq, 1, LLM_CALL_BOUNDS.maxSeq)) push("seq");
  if (typeof record.routeId !== "string" || record.routeId.length > LLM_CALL_BOUNDS.maxRouteChars || !ROUTE_ID.test(record.routeId)) push("routeId");
  if (!(LLM_CALL_METHODS as readonly unknown[]).includes(record.method)) push("method");
  if (!(LLM_PROVIDER_IDS as readonly unknown[]).includes(record.provider)) push("provider");
  if (typeof record.model !== "string" || !MODEL_ID.test(record.model)) push("model");
  if (!(LLM_CALL_KINDS as readonly unknown[]).includes(record.kind)) push("kind");
  for (const key of ["inputTokens", "outputTokens"] as const) if (record[key] !== null && !boundedInteger(record[key], 0, LLM_CALL_BOUNDS.maxTokens)) push(key);
  if (!boundedInteger(record.latencyMs, 0, LLM_CALL_BOUNDS.maxLatencyMs)) push("latencyMs");
  if (!(LLM_CALL_OUTCOMES as readonly unknown[]).includes(record.outcome)) push("outcome");
  if (!isInstant(record.startedAt)) push("startedAt");
  for (const key of keys) {
    const field = record[key];
    if (typeof field === "string" && secretShaped(field)) push(`${LLM_CALL_RECORD_KEYS.includes(key as never) ? key : "record"}: secret-shaped`);
  }
  return issues;
}

const tokenOrNull = (value: unknown): number | null => (boundedInteger(value, 0, LLM_CALL_BOUNDS.maxTokens) ? (value as number) : null);
const modelOrNull = (value: unknown): string | null => (typeof value === "string" && MODEL_ID.test(value) && !secretShaped(value) ? value : null);
const outcomeOf = (provider: LLMProviderId, error: unknown): LlmCallOutcome => {
  try {
    const reason = toProviderError(provider, error).reason;
    return (LLM_CALL_OUTCOMES as readonly string[]).includes(reason) ? reason : "unknown";
  } catch {
    return "unknown";
  }
};

/** One call's record, built and handed to the sink (scheduled). Never throws. */
function settle<T>(state: ScopeState, meta: ModelCallMeta<T>, seq: number, startedAt: string, started: number, ended: { ok: true; result: T } | { ok: false; error: unknown } | { ok: true; usage: ModelCallUsage | null }): void {
  const counts = seam().counts;
  try {
    const sink = seam().sink;
    if (sink === null) { counts.unbound += 1; return; }
    let usage: ModelCallUsage | null = null;
    if (ended.ok && "usage" in ended) usage = ended.usage;
    else if (ended.ok && "result" in ended && meta.usage) { try { usage = meta.usage(ended.result) ?? null; } catch { usage = null; } }
    state.requestRef ??= `llmr-${randomUUID()}`;
    const record: LlmCallRecord = {
      schema: LLM_CALL_RECORD_SCHEMA,
      callId: `llmc-${randomUUID()}`,
      requestRef: state.requestRef,
      seq,
      routeId: state.routeId,
      method: state.method,
      provider: meta.provider,
      model: (ended.ok ? modelOrNull(usage?.model) : null) ?? modelOrNull(meta.model) ?? "unknown",
      kind: meta.kind,
      inputTokens: ended.ok ? tokenOrNull(usage?.inputTokens) : null,
      outputTokens: ended.ok ? tokenOrNull(usage?.outputTokens) : null,
      latencyMs: Math.max(0, Math.min(LLM_CALL_BOUNDS.maxLatencyMs, Math.round(performance.now() - started))),
      outcome: ended.ok ? "completed" : outcomeOf(meta.provider, ended.error),
      startedAt,
    };
    if (validateLlmCallRecord(record).length > 0) { counts.invalid += 1; return; }
    const entry: LlmCallRecordEntry = Object.freeze({ scope: state.scope, record: Object.freeze(record) });
    counts.recorded += 1;
    queueMicrotask(() => {
      try { sink.write(entry); } catch { seam().counts.sink_failed += 1; }
    });
  } catch {
    counts.invalid += 1;
  }
}
/** The next call's sequence number in its request (calls are numbered as they start). */
function nextSeq(state: ScopeState): number {
  state.seq = Math.min(state.seq + 1, LLM_CALL_BOUNDS.maxSeq + 1);
  return state.seq;
}
function startedNow(): string {
  try { return new Date().toISOString(); } catch { return "1970-01-01T00:00:00.000Z"; }
}

/**
 * [B24-C1] Make one provider call through the seam: `invoke` is called at once and its answer or its error is passed through
 * unchanged (a synchronous throw stays synchronous). Inside a scope one record is written for it; outside, nothing.
 */
export function recordModelCall<T>(meta: ModelCallMeta<T>, invoke: () => Promise<T>): Promise<T> {
  const state = seam().storage.getStore();
  if (state === undefined) {
    seam().counts.unscoped += 1;
    return invoke();
  }
  const seq = nextSeq(state);
  const startedAt = startedNow();
  const started = performance.now();
  let pending: Promise<T>;
  try {
    pending = invoke();
  } catch (error) {
    settle(state, meta, seq, startedAt, started, { ok: false, error });
    throw error;
  }
  return Promise.resolve(pending).then(
    (result) => { settle(state, meta, seq, startedAt, started, { ok: true, result }); return result; },
    (error: unknown) => { settle(state, meta, seq, startedAt, started, { ok: false, error }); throw error; },
  );
}

/**
 * [B24-C1] A streamed provider call through the seam: the chunks pass through unchanged; ONE record is written when the iteration
 * ends - `completed` with the usage `usageOf` reads from a chunk, the classified reason when it throws, `cancelled` when the consumer
 * stops before the end. [B24-C1 review, 2026-10-08] correctness-3: the end is the usage-bearing (done) chunk reaching the consumer - a
 * consumer that stops there or later stopped a completed call, and its record keeps that chunk's usage.
 */
export function recordModelStream<C>(meta: ModelCallMeta<never>, invoke: () => AsyncIterable<C>, usageOf: (chunk: C) => ModelCallUsage | null): AsyncIterable<C> {
  const state = seam().storage.getStore();
  if (state === undefined) {
    seam().counts.unscoped += 1;
    return invoke();
  }
  const seq = nextSeq(state);
  const startedAt = startedNow();
  const started = performance.now();
  let iterable: AsyncIterable<C>;
  try {
    iterable = invoke();
  } catch (error) {
    settle(state, meta, seq, startedAt, started, { ok: false, error });
    throw error;
  }
  let settled = false;
  let usage: ModelCallUsage | null = null;
  let delivered = false; // a usage-bearing (done) chunk has reached the consumer
  const finish =(ended: { ok: true; usage: ModelCallUsage | null } | { ok: false; error: unknown }): void => {
    if (settled) return;
    settled = true;
    settle(state, meta, seq, startedAt, started, ended);
  };
  return {
    [Symbol.asyncIterator](): AsyncIterator<C> {
      const iterator = iterable[Symbol.asyncIterator]();
      return {
        async next(): Promise<IteratorResult<C>> {
          try {
            const step = await iterator.next();
            if (step.done) finish({ ok: true, usage });
            else { try { const read = usageOf(step.value); if (read) { usage = read; delivered = true; } } catch { /* usage is optional */ } }
            return step;
          } catch (error) {
            finish({ ok: false, error });
            throw error;
          }
        },
        async return(value?: unknown): Promise<IteratorResult<C>> {
          finish(delivered ? { ok: true, usage } : { ok: false, error: Object.assign(new Error("The stream was stopped before it completed."), { name: "AbortError" }) });
          return iterator.return ? iterator.return(value) : { done: true, value: value as C };
        },
      };
    },
  };
}
