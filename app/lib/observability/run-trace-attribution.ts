/**
 * [B24-C2] D24-22, D24-23, OD-208, OD-209: the attribution document beside the run trace, `agent.run-trace-attribution.v1`, and its
 * store. C1's `agent.run-trace.v1` keeps the recorder's validated `sirkit.agent-run-trace.v1` document; this sibling says, for the same
 * trace, who asked (the trusted context, by digest), what was asked (a salted message digest and the character count), what was
 * discovered (the toolset digest) and read (the per-read source revisions and consumed resources), what was refused before it ran (the
 * closed refusal classes), what the user saw (a salted answer digest), the provider's request ids, the budget, the cost through the one
 * price table and the latency on a monotonic clock - runbook :1076, :1080, :1084, :1085, :1086.
 *
 * The rules for every value: the key set is closed; every value is a digest, an id matching a pattern, a closed class, a count or a
 * bounded number; there is no text field of any kind; `findSecretShapedPath` (trace.ts) runs over the whole document as defence in
 * depth. A document is written only for a trace that validated (it binds that trace by `traceDigest`, `agentRunTraceDigest`); it sits
 * in the run's scope, keyed by trace id, written ONCE: a compare-and-set commit at revision 0 with no outbox effect under the idempotency
 * key `run-trace-attribution:<traceId>` (a replay writes nothing); validated before persist; digest re-verified on load, and any
 * disagreement is one closed error, AGENT_RUN_TRACE_ATTRIBUTION_MISMATCH, that echoes nothing of the row.
 *
 * Pure: the repository is INJECTED (the chat composition root binds the durable one, `app/api/chat/attribution-runtime.ts`); this module
 * imports no price table, no salt module and nothing of the durable runtime, the database client or the outbox - its runtime imports are
 * `../agent/trace`, `../durable-workflow/stable` and `../engineering/stable` (b24-c2-attribution 12 pins them), so B24-C3's read core
 * can verify through it. Never inside `trace.ts` or `trace-recorder.ts` (B11-scanned, hash-pinned; OD-113).
 */
import { canonicalDurableScope, durableAggregateIdentity, durableScopeKey, durableWorkflowId } from "../durable-workflow/stable";
import type { DurableAggregateIdentity, DurableAggregateRecord, DurableWorkflowRepository, DurableWorkflowScope } from "../durable-workflow/types";
import { TRACE_BOUNDS, TRACE_TERMINAL_OUTCOMES, findNonPlainJsonPath, findSecretShapedPath, type TraceTerminalOutcome } from "../agent/trace";
import { engineeringDigest } from "../engineering/stable";

export const RUN_TRACE_ATTRIBUTION_AGGREGATE_TYPE = "agent.run-trace-attribution.v1" as const;
export const RUN_TRACE_ATTRIBUTION_SCHEMA = "sirkit.agent-run-trace-attribution.v1" as const;
export const RUN_TRACE_ATTRIBUTION_RECORD_SCHEMA = "sirkit.agent-run-trace-attribution-record.v1" as const;
/** The document's closed top-level keys, in order. */
export const RUN_TRACE_ATTRIBUTION_KEYS = Object.freeze(["schema", "runId", "traceId", "traceDigest", "scope", "trustedContext", "request", "plan", "toolset", "reads", "refusedCalls", "provider", "answer", "deploymentConfigurationDigest", "budget", "cost", "latency", "diagnostics"] as const);
/** The record's closed keys, in order. */
export const RUN_TRACE_ATTRIBUTION_RECORD_KEYS = Object.freeze(["schema", "runId", "traceId", "revision", "at", "digest", "document"] as const);
/** The statuses a call refused before it runs carries on its `tool_refused` event (loop.ts), plus `other` for any status outside them. */
export const REFUSED_CALL_CLASSES = Object.freeze(["unknown_tool", "budget_exhausted", "invalid_input", "repeated_call", "proposal_exists", "execution_exists", "other"] as const);
export type RefusedCallClass = (typeof REFUSED_CALL_CLASSES)[number];
/** The closed diagnostics a document may carry (never a message). */
export const ATTRIBUTION_DIAGNOSTICS = Object.freeze(["salt_unavailable", "deployment_configuration_unavailable"] as const);
export type AttributionDiagnostic = (typeof ATTRIBUTION_DIAGNOSTICS)[number];
export const ATTRIBUTION_PLAN_KINDS = Object.freeze(["single", "dag", "refused"] as const);
export type AttributionPlanKind = (typeof ATTRIBUTION_PLAN_KINDS)[number];
/** The project roles (engineering/types.ts `ProjectRole`) and the trusted context's auth methods, as closed classes. */
export const ATTRIBUTION_ROLES = Object.freeze(["viewer", "commenter", "pcb_editor", "automation", "reviewer", "project_admin", "migration_admin"] as const);
export const ATTRIBUTION_AUTH_CLASSES = Object.freeze(["supabase_cookie", "local_dev", "worker_secret"] as const); // auth/types.ts `AuthMethod`, exactly
export const USAGE_PRICING_REASON_CLASSES = Object.freeze(["no_owner_price_table", "model_not_in_table", "usage_out_of_range"] as const);
/** The coordinator adapter's SDK retry ceilings (adapters.ts `COORDINATOR_SDK_RETRY_CEILING`: OpenAI 2, Anthropic the SDK default), a closed class. */
export const ATTRIBUTION_RETRY_CEILINGS = Object.freeze([2, "sdk_default"] as const);
export const ATTRIBUTION_BOUNDS = Object.freeze({
  maxReads: 64,
  maxResourcesPerRead: 64,
  /** one offset per appended trace event (TRACE_BOUNDS.maxEvents) */
  maxEventOffsets: TRACE_BOUNDS.maxEvents,
  /** the validator's ceiling on request ids; the collector keeps at most 2 x the run budget's maxModelSteps */
  maxRequestIds: 64,
  maxCount: 2_147_483_647,
  maxDecimalChars: 64,
});
export const RUN_TRACE_ATTRIBUTION_STORE_BOUNDS = Object.freeze({ listLimit: 1_000 });
export const RUN_TRACE_ATTRIBUTION_REFUSALS = Object.freeze(["invalid_document", "scope_mismatch", "invalid_time", "exists"] as const);
export type RunTraceAttributionRefusal = (typeof RUN_TRACE_ATTRIBUTION_REFUSALS)[number];
export const RUN_TRACE_ATTRIBUTION_MISMATCH = "AGENT_RUN_TRACE_ATTRIBUTION_MISMATCH" as const;

/** A salted digest (`trace-salt.ts`): `sd1-` + 64 hex characters. */
export const SALTED_DIGEST_RULE = /^sd1-[0-9a-f]{64}$/;
/** An engineering digest (`engineeringDigest`): `eng1-` + 16 hex characters. */
export const ENGINEERING_DIGEST_RULE = /^eng1-[0-9a-f]{16}$/;
/** A bounded id or digest of the identifier alphabet (C1's id rule, with `/` for resource ids). */
export const ID_RULE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
/** A provider request id (OD-208: a bounded string). */
export const REQUEST_ID_RULE = /^[A-Za-z0-9_-]{1,128}$/;
const VERSION_RULE = /^\d+\.\d+\.\d+$/;
const CURRENCY_RULE = /^[A-Z]{3}$/;
const DECIMAL_RULE = /^\d+(?:\.\d+)?$/;

export interface AttributionReadResource { resourceId: string; sourceVersion: string; contentDigest: string }
export interface AttributionRead { sourceRevisionDigest: string; resources: AttributionReadResource[]; resourcesWithheld: number }
export interface AttributionBudget { maxModelSteps: number; maxToolCalls: number; perToolTimeoutMs: number; runDeadlineMs: number; maxIdenticalCalls: number; executionSettlementTimeoutMs: number }
export type AttributionCost =
  | { status: "unpriced"; reason: (typeof USAGE_PRICING_REASON_CLASSES)[number] }
  | { status: "priced"; priceTableVersion: string; currency: string; costMicrounits: string };
export interface RunTraceAttribution {
  schema: typeof RUN_TRACE_ATTRIBUTION_SCHEMA;
  runId: string;
  traceId: string;
  /** `agentRunTraceDigest` of the validated trace this document attributes */
  traceDigest: string;
  scope: { tenantId: string; projectId: string; branchId: string };
  trustedContext: { correlationId: string | null; role: (typeof ATTRIBUTION_ROLES)[number]; membershipRevision: string; authClass: (typeof ATTRIBUTION_AUTH_CLASSES)[number]; principalRef: string | null };
  request: { messageDigest: string | null; messageChars: number };
  plan: { kind: AttributionPlanKind };
  toolset: { declarationsDigest: string; toolCount: number } | null;
  reads: { canonicalRevisionDigest: string | null; count: number; withheld: number; entries: AttributionRead[] };
  refusedCalls: Record<RefusedCallClass, number>;
  provider: { requestIds: string[]; requestIdsWithheld: number; retryCeiling: (typeof ATTRIBUTION_RETRY_CEILINGS)[number]; sdkRetriesObserved: "unknown" };
  answer: { digest: string | null; chars: number; outcome: TraceTerminalOutcome } | null;
  deploymentConfigurationDigest: string | null;
  budget: AttributionBudget;
  cost: AttributionCost;
  latency: { clock: "monotonic"; firstTextOffsetMs: number | null; terminalOffsetMs: number | null; eventOffsets: Array<{ seq: number; offsetMs: number }> };
  diagnostics: AttributionDiagnostic[];
}
export interface RunTraceAttributionRecord {
  schema: typeof RUN_TRACE_ATTRIBUTION_RECORD_SCHEMA;
  runId: string;
  traceId: string;
  revision: 1;
  at: string;
  /** `runTraceAttributionDigest(document)` */
  digest: string;
  document: RunTraceAttribution;
}
export interface RunTraceAttributionEntry { revision: number; recordDigest: string; record: RunTraceAttributionRecord }
export type RunTraceAttributionAppendResult =
  | { ok: true; revision: number; recordDigest: string; replayed: boolean }
  | { ok: false; code: RunTraceAttributionRefusal; message: string };
export interface RunTraceAttributionStore {
  append(input: { scope: DurableWorkflowScope; document: RunTraceAttribution; at: string }): Promise<RunTraceAttributionAppendResult>;
  /** One trace's attribution, re-verified; null when none was kept. */
  load(scope: DurableWorkflowScope, traceId: string): Promise<RunTraceAttributionEntry | null>;
  /** Every attribution of a scope (at most `limit`, by aggregate key), each re-verified. */
  list(scope: DurableWorkflowScope, options?: { limit?: number }): Promise<RunTraceAttributionEntry[]>;
}

/** A stored attribution that fails its digest, its validation or its identity: nothing is returned. */
export class RunTraceAttributionIntegrityError extends Error {
  readonly code = RUN_TRACE_ATTRIBUTION_MISMATCH;
  constructor() {
    super(`${RUN_TRACE_ATTRIBUTION_MISMATCH}: a stored run-trace attribution failed its digest, validation or identity check; nothing was returned`);
    this.name = "RunTraceAttributionIntegrityError";
  }
}

// ─── Validation ──────────────────────────────────────────────────────────────

const BUDGET_KEYS = ["maxModelSteps", "maxToolCalls", "perToolTimeoutMs", "runDeadlineMs", "maxIdenticalCalls", "executionSettlementTimeoutMs"] as const;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
const isCount = (value: unknown, max: number = ATTRIBUTION_BOUNDS.maxCount): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;
const isOffset = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= ATTRIBUTION_BOUNDS.maxCount;
const matches = (value: unknown, rule: RegExp): value is string => typeof value === "string" && rule.test(value);
const nullOr = (value: unknown, check: (value: unknown) => boolean): boolean => value === null || check(value);
const closed = (value: unknown, classes: readonly string[]): boolean => typeof value === "string" && classes.includes(value);

/** Every issue of a document (key names only, never a value); [] for a valid one. Total. */
export function validateRunTraceAttribution(untrusted: unknown): string[] {
  const issues: string[] = [];
  const issue = (text: string): void => { if (issues.length < 16) issues.push(text); };
  try {
    const plain = findNonPlainJsonPath(untrusted, "attribution");
    if (plain !== null) return [`${plain}: must be plain JSON data`];
    if (!isRecord(untrusted)) return ["attribution: must be an object"];
    const document = untrusted;
    if (!exactKeys(document, RUN_TRACE_ATTRIBUTION_KEYS)) issue("attribution: exact keys required");
    if (document.schema !== RUN_TRACE_ATTRIBUTION_SCHEMA) issue("attribution.schema: unsupported");
    if (!matches(document.runId, ID_RULE)) issue("attribution.runId: outside the id rule");
    if (!matches(document.traceId, ID_RULE)) issue("attribution.traceId: outside the id rule");
    if (!matches(document.traceDigest, ENGINEERING_DIGEST_RULE)) issue("attribution.traceDigest: not an engineering digest");
    const scope = document.scope;
    if (!isRecord(scope) || !exactKeys(scope, ["tenantId", "projectId", "branchId"]) || ![scope.tenantId, scope.projectId, scope.branchId].every((value) => typeof value === "string" && value.length > 0 && value.length <= TRACE_BOUNDS.maxIdChars)) issue("attribution.scope: exact bounded ids required");
    const trusted = document.trustedContext;
    if (!isRecord(trusted) || !exactKeys(trusted, ["correlationId", "role", "membershipRevision", "authClass", "principalRef"])) issue("attribution.trustedContext: exact keys required");
    else {
      if (!nullOr(trusted.correlationId, (value) => matches(value, ID_RULE))) issue("attribution.trustedContext.correlationId: outside the id rule");
      if (!closed(trusted.role, ATTRIBUTION_ROLES)) issue("attribution.trustedContext.role: outside the closed vocabulary");
      if (!matches(trusted.membershipRevision, ID_RULE)) issue("attribution.trustedContext.membershipRevision: outside the id rule");
      if (!closed(trusted.authClass, ATTRIBUTION_AUTH_CLASSES)) issue("attribution.trustedContext.authClass: outside the closed vocabulary");
      if (!nullOr(trusted.principalRef, (value) => matches(value, SALTED_DIGEST_RULE))) issue("attribution.trustedContext.principalRef: not a salted digest");
    }
    const request = document.request;
    if (!isRecord(request) || !exactKeys(request, ["messageDigest", "messageChars"])) issue("attribution.request: exact keys required");
    else {
      if (!nullOr(request.messageDigest, (value) => matches(value, SALTED_DIGEST_RULE))) issue("attribution.request.messageDigest: not a salted digest");
      if (!isCount(request.messageChars)) issue("attribution.request.messageChars: not a count");
    }
    const plan = document.plan;
    if (!isRecord(plan) || !exactKeys(plan, ["kind"]) || !closed(plan.kind, ATTRIBUTION_PLAN_KINDS)) issue("attribution.plan: a closed kind required");
    const toolset = document.toolset;
    if (toolset !== null && (!isRecord(toolset) || !exactKeys(toolset, ["declarationsDigest", "toolCount"]) || !matches(toolset.declarationsDigest, ENGINEERING_DIGEST_RULE) || !isCount(toolset.toolCount, 10_000))) issue("attribution.toolset: a digest and a count, or null");
    const reads = document.reads;
    if (!isRecord(reads) || !exactKeys(reads, ["canonicalRevisionDigest", "count", "withheld", "entries"])) issue("attribution.reads: exact keys required");
    else {
      if (!nullOr(reads.canonicalRevisionDigest, (value) => matches(value, ID_RULE))) issue("attribution.reads.canonicalRevisionDigest: outside the id rule");
      if (!isCount(reads.count) || !isCount(reads.withheld)) issue("attribution.reads.count: counts required");
      if (!Array.isArray(reads.entries) || reads.entries.length > ATTRIBUTION_BOUNDS.maxReads) issue(`attribution.reads.entries: at most ${ATTRIBUTION_BOUNDS.maxReads}`);
      else {
        for (const [index, entry] of reads.entries.entries()) {
          const label = `attribution.reads.entries[${index}]`;
          if (!isRecord(entry) || !exactKeys(entry, ["sourceRevisionDigest", "resources", "resourcesWithheld"]) || !matches(entry.sourceRevisionDigest, ID_RULE) || !isCount(entry.resourcesWithheld) || !Array.isArray(entry.resources) || entry.resources.length > ATTRIBUTION_BOUNDS.maxResourcesPerRead) { issue(`${label}: a bounded read required`); continue; }
          for (const [resourceIndex, resource] of entry.resources.entries()) {
            if (!isRecord(resource) || !exactKeys(resource, ["resourceId", "sourceVersion", "contentDigest"]) || !matches(resource.resourceId, ID_RULE) || !matches(resource.sourceVersion, ID_RULE) || !matches(resource.contentDigest, ID_RULE)) issue(`${label}.resources[${resourceIndex}]: ids and a digest required`);
          }
        }
      }
    }
    const refused = document.refusedCalls;
    if (!isRecord(refused) || !exactKeys(refused, REFUSED_CALL_CLASSES) || !REFUSED_CALL_CLASSES.every((status) => isCount(refused[status]))) issue("attribution.refusedCalls: the closed classes, each a count");
    const provider = document.provider;
    if (!isRecord(provider) || !exactKeys(provider, ["requestIds", "requestIdsWithheld", "retryCeiling", "sdkRetriesObserved"])) issue("attribution.provider: exact keys required");
    else {
      if (!Array.isArray(provider.requestIds) || provider.requestIds.length > ATTRIBUTION_BOUNDS.maxRequestIds || !provider.requestIds.every((id) => matches(id, REQUEST_ID_RULE))) issue("attribution.provider.requestIds: bounded ids required");
      if (!isCount(provider.requestIdsWithheld)) issue("attribution.provider.requestIdsWithheld: not a count");
      if (!(ATTRIBUTION_RETRY_CEILINGS as readonly unknown[]).includes(provider.retryCeiling)) issue("attribution.provider.retryCeiling: outside the closed vocabulary");
      if (provider.sdkRetriesObserved !== "unknown") issue("attribution.provider.sdkRetriesObserved: must be unknown");
    }
    const answer = document.answer;
    if (answer !== null && (!isRecord(answer) || !exactKeys(answer, ["digest", "chars", "outcome"]) || !nullOr(answer.digest, (value) => matches(value, SALTED_DIGEST_RULE)) || !isCount(answer.chars) || !closed(answer.outcome, TRACE_TERMINAL_OUTCOMES))) issue("attribution.answer: a salted digest, a count and a closed outcome, or null");
    if (!nullOr(document.deploymentConfigurationDigest, (value) => matches(value, ENGINEERING_DIGEST_RULE))) issue("attribution.deploymentConfigurationDigest: not an engineering digest");
    const budget = document.budget;
    if (!isRecord(budget) || !exactKeys(budget, BUDGET_KEYS) || !BUDGET_KEYS.every((key) => isCount(budget[key]))) issue("attribution.budget: the six budget fields, each a count");
    const cost = document.cost;
    if (!isRecord(cost)) issue("attribution.cost: an object required");
    else if (cost.status === "unpriced") { if (!exactKeys(cost, ["status", "reason"]) || !closed(cost.reason, USAGE_PRICING_REASON_CLASSES)) issue("attribution.cost: a closed unpriced reason required"); }
    else if (cost.status === "priced") { if (!exactKeys(cost, ["status", "priceTableVersion", "currency", "costMicrounits"]) || !matches(cost.priceTableVersion, VERSION_RULE) || !matches(cost.currency, CURRENCY_RULE) || !matches(cost.costMicrounits, DECIMAL_RULE) || (cost.costMicrounits as string).length > ATTRIBUTION_BOUNDS.maxDecimalChars) issue("attribution.cost: a version, a currency and decimal text required"); }
    else issue("attribution.cost.status: outside the closed vocabulary");
    const latency = document.latency;
    if (!isRecord(latency) || !exactKeys(latency, ["clock", "firstTextOffsetMs", "terminalOffsetMs", "eventOffsets"])) issue("attribution.latency: exact keys required");
    else {
      if (latency.clock !== "monotonic") issue("attribution.latency.clock: must be monotonic");
      if (!nullOr(latency.firstTextOffsetMs, isOffset) || !nullOr(latency.terminalOffsetMs, isOffset)) issue("attribution.latency: offsets must be bounded numbers or null");
      const offsets = latency.eventOffsets;
      if (!Array.isArray(offsets) || offsets.length > ATTRIBUTION_BOUNDS.maxEventOffsets) issue(`attribution.latency.eventOffsets: at most ${ATTRIBUTION_BOUNDS.maxEventOffsets}`);
      else {
        let lastSeq = 0;
        let lastOffset = 0;
        for (const [index, entry] of offsets.entries()) {
          if (!isRecord(entry) || !exactKeys(entry, ["seq", "offsetMs"]) || !isCount(entry.seq, ATTRIBUTION_BOUNDS.maxEventOffsets) || (entry.seq as number) <= lastSeq || !isOffset(entry.offsetMs) || (entry.offsetMs as number) < lastOffset) { issue(`attribution.latency.eventOffsets[${index}]: an increasing seq and a non-decreasing offset required`); break; }
          lastSeq = entry.seq as number;
          lastOffset = entry.offsetMs as number;
        }
      }
    }
    const diagnostics = document.diagnostics;
    if (!Array.isArray(diagnostics) || diagnostics.length > ATTRIBUTION_DIAGNOSTICS.length || !diagnostics.every((entry) => closed(entry, ATTRIBUTION_DIAGNOSTICS)) || new Set(diagnostics).size !== diagnostics.length) issue("attribution.diagnostics: closed classes, each at most once");
    // defence in depth: no key name or string value anywhere may be credential-shaped or carry a secret-shaped substring
    const secret = findSecretShapedPath(document, "attribution");
    if (secret !== null) issue(secret);
  } catch {
    return ["attribution: validator failed"];
  }
  return issues;
}

// ─── Digests and identity ─────────────────────────────────────────────────────

export function runTraceAttributionDigest(document: RunTraceAttribution): string {
  return engineeringDigest({ schema: "sirkit.agent-run-trace-attribution-digest.v1", document });
}
export function runTraceAttributionRecordDigest(record: RunTraceAttributionRecord): string {
  return engineeringDigest({ schema: RUN_TRACE_ATTRIBUTION_AGGREGATE_TYPE, record });
}
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const isInstant = (value: unknown): value is string => typeof value === "string" && INSTANT.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const sameScope = (a: DurableWorkflowScope, b: DurableWorkflowScope): boolean => a.tenantId === b.tenantId && a.projectId === b.projectId && a.branchId === b.branchId;
const scopeOf = (scope: DurableWorkflowScope): DurableWorkflowScope => ({ tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId });
function canonicalOrNull(scope: DurableWorkflowScope): DurableWorkflowScope | null {
  try { return canonicalDurableScope(scopeOf(scope)); } catch { return null; }
}
/** The aggregate key of one trace's attribution in its scope (the scope as the substrate stores it). */
export function runTraceAttributionAggregateKey(scope: DurableWorkflowScope, traceId: string): string {
  return durableWorkflowId("agent-run-trace-attribution", { ...canonicalDurableScope(scopeOf(scope)), traceId });
}
function attributionIdentity(scope: DurableWorkflowScope, traceId: string): DurableAggregateIdentity {
  return durableAggregateIdentity(scopeOf(scope), RUN_TRACE_ATTRIBUTION_AGGREGATE_TYPE, runTraceAttributionAggregateKey(scope, traceId));
}
function contended(error: unknown): boolean {
  const seen = new Set<unknown>();
  for (let current: unknown = error; current !== null && typeof current === "object" && !seen.has(current); current = (current as { cause?: unknown }).cause) {
    seen.add(current);
    const message = current instanceof Error ? current.message : "";
    if (message === "DW_OPTIMISTIC_REVISION_CONFLICT" || (current as { code?: unknown }).code === "23505" || message.includes("duplicate key value violates unique constraint")) return true;
  }
  return false;
}
const refuse = (code: RunTraceAttributionRefusal, message: string): RunTraceAttributionAppendResult => ({ ok: false, code, message });
type Committed = { revision: number; recordDigest: string };

/** [B24-C2] The durable attribution over an injected durable-workflow repository. */
export class DurableRunTraceAttributionStore implements RunTraceAttributionStore {
  constructor(private readonly workflow: DurableWorkflowRepository) {}

  async append(input: { scope: DurableWorkflowScope; document: RunTraceAttribution; at: string }): Promise<RunTraceAttributionAppendResult> {
    if (validateRunTraceAttribution(input.document).length > 0) return refuse("invalid_document", "The attribution failed its validator; nothing was written.");
    const document = input.document;
    const scope = canonicalOrNull(document.scope);
    if (scope === null) return refuse("invalid_document", "The attribution's scope is outside the substrate's scope rule; nothing was written.");
    const under = canonicalOrNull(input.scope);
    if (under === null || !sameScope(under, scope)) return refuse("scope_mismatch", "The attribution is appended under a scope other than its own; nothing was written.");
    if (!isInstant(input.at)) return refuse("invalid_time", "The record's time is not an ISO-8601 instant; nothing was written.");
    const { runId, traceId } = document;
    const identity = attributionIdentity(scope, traceId);
    const scopeKey = durableScopeKey(scope, "agent-run-trace-attribution");
    const idempotencyKey = `run-trace-attribution:${traceId}`;
    const replayed = async (): Promise<RunTraceAttributionAppendResult | null> => {
      const replay = await this.workflow.getReplay<Committed>(scope, scopeKey, idempotencyKey);
      return replay ? { ok: true, revision: replay.result.revision, recordDigest: replay.result.recordDigest, replayed: true } : null;
    };
    const head = await this.workflow.loadHead<RunTraceAttributionRecord>(identity);
    if (head !== null) return (await replayed()) ?? refuse("exists", "An attribution of this trace id already exists; nothing was written.");
    const record: RunTraceAttributionRecord = { schema: RUN_TRACE_ATTRIBUTION_RECORD_SCHEMA, runId, traceId, revision: 1, at: input.at, digest: runTraceAttributionDigest(document), document };
    const recordDigest = runTraceAttributionRecordDigest(record);
    try {
      const committed = await this.workflow.commit<Committed>({
        scope, scopeKey, idempotencyKey,
        operations: [{ aggregateType: RUN_TRACE_ATTRIBUTION_AGGREGATE_TYPE, aggregateKey: identity.aggregateKey, expectedRevision: 0, payload: record, recordDigest }],
        outbox: [], // silent: an attribution is never a command a handler could re-run
        result: { revision: 1, recordDigest }, committedAt: input.at,
      });
      return { ok: true, revision: committed.result.revision, recordDigest: committed.result.recordDigest, replayed: committed.idempotent };
    } catch (error) {
      if (!contended(error)) throw error;
      return (await replayed()) ?? refuse("exists", "An attribution of this trace id landed first; nothing was written.");
    }
  }

  async load(scope: DurableWorkflowScope, traceId: string): Promise<RunTraceAttributionEntry | null> {
    const canonical = canonicalOrNull(scope);
    if (canonical === null || !ID_RULE.test(traceId)) return null;
    const head = await this.workflow.loadHead<RunTraceAttributionRecord>(attributionIdentity(canonical, traceId));
    return head === null ? null : verifiedEntry(head, canonical);
  }

  async list(scope: DurableWorkflowScope, options?: { limit?: number }): Promise<RunTraceAttributionEntry[]> {
    const canonical = canonicalOrNull(scope);
    if (canonical === null) return [];
    const heads = await this.workflow.listHeads<RunTraceAttributionRecord>({ aggregateType: RUN_TRACE_ATTRIBUTION_AGGREGATE_TYPE, scope: canonical, limit: options?.limit ?? RUN_TRACE_ATTRIBUTION_STORE_BOUNDS.listLimit });
    return heads.map((head) => verifiedEntry(head, canonical));
  }
}

/** Re-verify one stored record, or throw AGENT_RUN_TRACE_ATTRIBUTION_MISMATCH (one closed error: nothing of the row is echoed). */
function verifiedEntry(raw: DurableAggregateRecord<RunTraceAttributionRecord>, scope: DurableWorkflowScope): RunTraceAttributionEntry {
  try {
    return checkedEntry(raw, scope);
  } catch {
    throw new RunTraceAttributionIntegrityError();
  }
}
function checkedEntry(raw: DurableAggregateRecord<RunTraceAttributionRecord>, scope: DurableWorkflowScope): RunTraceAttributionEntry {
  const mismatch = (): never => { throw new RunTraceAttributionIntegrityError(); };
  const record = raw.payload as unknown as Record<string, unknown>;
  if (record === null || typeof record !== "object" || Array.isArray(record) || !exactKeys(record, RUN_TRACE_ATTRIBUTION_RECORD_KEYS)) mismatch();
  const typed = raw.payload;
  if (typed.schema !== RUN_TRACE_ATTRIBUTION_RECORD_SCHEMA || typed.revision !== 1 || raw.revision !== 1 || !isInstant(typed.at) || !ID_RULE.test(typed.traceId) || !ID_RULE.test(typed.runId)) mismatch();
  if (raw.aggregateType !== RUN_TRACE_ATTRIBUTION_AGGREGATE_TYPE || raw.aggregateKey !== runTraceAttributionAggregateKey(scope, typed.traceId) || !sameScope(raw.scope, scope)) mismatch();
  if (runTraceAttributionRecordDigest(typed) !== raw.recordDigest) mismatch();
  if (validateRunTraceAttribution(typed.document).length > 0 || runTraceAttributionDigest(typed.document) !== typed.digest) mismatch();
  if (typed.document.traceId !== typed.traceId || typed.document.runId !== typed.runId || !sameScope(canonicalOrNull(typed.document.scope) ?? mismatch(), scope)) mismatch();
  return { revision: raw.revision, recordDigest: raw.recordDigest, record: structuredClone(typed) };
}
