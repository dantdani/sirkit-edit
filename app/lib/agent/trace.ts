/**
 * B11 / B11.1 — the provider-neutral, redacted, bounded run-trace contract
 * (`sirkit.agent-run-trace.v1`).
 *
 * A runtime trace is AUDIT METADATA: identities, digests, closed-vocabulary
 * classifications, and bounded sanitized warnings. It NEVER contains API
 * keys/credentials/environment values, raw provider request/response
 * bodies, hidden reasoning or thinking blocks, provider continuation
 * state, stack traces, complete board/schematic/context dumps,
 * unrestricted prompts or tool outputs, or browser-supplied authority
 * claims. Digest-only traces deliberately CANNOT reconstruct model output —
 * reconstruction lives only in the explicit sanitized replay capsule
 * (`replay-capsule.ts`), which is never persisted from live runs.
 *
 * [B11.1] validation is now COMPLETE and INTERNALLY CONSISTENT: a document
 * whose summary disagrees with its own event ledger — forged totals, a
 * forged terminal outcome/reason, an impossible timeline, a missing
 * `run_started`, or usage that does not equal the summed steps — is
 * refused. Validator output is bounded so a hostile document cannot
 * produce unbounded diagnostics.
 *
 * [B20 A4] An external tool call (an approved third-party tool server) is attributed on its `tool_invocation` event by an
 * optional `external` block — server and tool identity, the registry and protocol versions, the listing digest, a closed result
 * class, and the content hash, observation id and retrieval time of an observation — never content, arguments, URLs or
 * credentials. The block is required on the outcome class `external_observation`, allowed on `refused`, forbidden otherwise; a
 * trace without external calls keeps its shape, and the schema stays v1.
 */

import { engineeringDigest } from "../engineering/stable";
import { capturePlainJson, scanPlainJson } from "./plain-capture";
import {
  containsSecretShapedText, foldFieldName, isCredentialShapedName,
  redactPathSegment, sanitizeTraceText,
} from "./redaction";

export const AGENT_RUN_TRACE_SCHEMA = "sirkit.agent-run-trace.v1" as const;

// ─── Bounds and closed vocabularies ──────────────────────────────────────────

export const TRACE_BOUNDS = Object.freeze({
  maxIdChars: 128,
  maxModelChars: 100,
  maxDigestChars: 100,
  maxWarningChars: 300,
  maxWarnings: 32,
  maxEvents: 256,
  maxStatusChars: 64,
  maxFailureReasonChars: 64,
  /** [B11.1] hostile documents cannot produce unbounded validator output. */
  maxValidationIssues: 12,
  /** [B11.2] hard caps checked BEFORE any scanning or Set construction. */
  maxRecorderDiagnostics: 16,
  maxSerializedChars: 1_000_000,
  maxScanNodes: 20_000,
  maxScanDepth: 32,
});

export const TRACE_OUTCOME_CLASSES = ["read", "proposal", "proposal_blocked", "refused", "view_command", "layout_candidate", "execution_grant", "external_observation"] as const;
export type TraceOutcomeClass = (typeof TRACE_OUTCOME_CLASSES)[number];

/** [B20 A4] What became of one external tool call (closed). */
export const TRACE_EXTERNAL_RESULT_CLASSES = ["catalog", "complete", "tool_error", "not_sent", "authorization_failed", "upstream_error", "transport_failed", "result_invalid", "cancelled"] as const;
export type TraceExternalResultClass = (typeof TRACE_EXTERNAL_RESULT_CLASSES)[number];
/** [B20 A4] The classes an `external_observation` event may carry, and the ones that name an observation (hash, id and time). */
const OBSERVED_RESULT_CLASSES: readonly string[] = ["catalog", "complete", "tool_error"];
const HASHED_RESULT_CLASSES: readonly string[] = ["complete", "tool_error"];
/** [B20 A4] The closed pattern of every `external` field (each value must also pass the secret denylist). */
export const TRACE_EXTERNAL_PATTERNS = Object.freeze({
  serverId: /^[a-z0-9][a-z0-9-]{1,30}$/,
  toolName: /^[A-Za-z0-9_.-]{1,128}$/,
  registryVersion: /^\d{1,4}\.\d{1,4}\.\d{1,4}$/,
  protocolVersion: /^\d{4}-\d{2}-\d{2}$/,
  listingDigest: /^sha256:[0-9a-f]{64}$/,
  contentHash: /^sha256:[0-9a-f]{64}$/,
  observationId: /^external_tool_observation_[0-9a-f]{64}$/,
  retrievedAt: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
});
export const TRACE_EXTERNAL_KEYS = ["serverId", "toolName", "registryVersion", "protocolVersion", "listingDigest", "resultClass", "contentHash", "observationId", "retrievedAt"] as const;

export const TRACE_TERMINAL_OUTCOMES = ["completed", "failed", "cancelled"] as const;
export type TraceTerminalOutcome = (typeof TRACE_TERMINAL_OUTCOMES)[number];

/**
 * [B11.1] the COMPLETE closed diagnostic vocabulary. Every recorder-side
 * failure class is represented; nothing else may appear.
 */
export const TRACE_RECORDER_DIAGNOSTICS = [
  "trace_clock_failure",
  "trace_digest_failure",
  "trace_event_capacity_reached",
  "trace_input_normalized",
  "trace_post_terminal_append_refused",
  "trace_reentrant_call_refused",
  "trace_sink_contract_violation",
  "trace_sink_factory_failure",
  "trace_sink_failure",
  "trace_validation_failure",
] as const;
export type TraceRecorderDiagnostic = (typeof TRACE_RECORDER_DIAGNOSTICS)[number];

/** The normalized cancellation reason a cancelled run must carry. */
export const CANCELLED_FAILURE_REASON = "cancelled";

/** Known terminal failure reasons plus the normalized provider family. */
const KNOWN_FAILURE_REASONS = new Set([
  "cancelled", "deadline", "max_steps", "toolset_invalid", "internal_error", "stream_error",
]);
const PROVIDER_REASON_PATTERN = /^provider_[a-z0-9_]{1,40}$/;

export function isValidFailureReason(reason: string): boolean {
  return KNOWN_FAILURE_REASONS.has(reason) || PROVIDER_REASON_PATTERN.test(reason);
}

// ─── Redaction ───────────────────────────────────────────────────────────────

/**
 * [B11.5 §B] The redaction primitives moved to `./redaction`, a
 * dependency-neutral module, so `plain-capture.ts` can share the SAME
 * classifier instead of growing a second one that drifts. They are re-exported
 * here unchanged, so every existing import site keeps working and there is
 * still exactly one definition.
 */
export { containsSecretShapedText, foldFieldName, isCredentialShapedName, redactPathSegment, sanitizeTraceText };

export interface SecretScanBudget { nodes: number }

const EMPTY_NAME_SET: ReadonlySet<string> = new Set<string>();

/**
 * [B11.2] Walk a value and inspect EVERY key name and EVERY string value
 * DIRECTLY — before any JSON serialization. Serialization escapes nested
 * quotes (`{"apiKey":"…"}` becomes `{\"apiKey\":\"…\"}`), which defeats
 * quoted-credential patterns; scanning the original strings does not.
 * Returns a redacted path (never a value) or null. Traversal is bounded.
 */
export function findSecretShapedPath(
  value: unknown,
  label = "$",
  depth = 0,
  budget: SecretScanBudget = { nodes: 0 },
  /**
   * [B11.3] Field names an AUTHORITATIVE SCHEMA declares are exempt from the
   * NAME check — and only the name check; their VALUES are still scanned. A
   * declared name cannot be attacker-chosen: the key-exhaustive shape
   * validation refuses any key the schema does not declare, at its declared
   * position and type. Without this, a legitimate declared field
   * (`authorizationPolicyId` on a constraint waiver policy) is rejected as a
   * credential — a denylist that rejects honest data is a broken denylist.
   * The caller supplies the set; it is DERIVED from the generated descriptor,
   * never hand-typed, and pinned by a regression so a newly-declared
   * credential-shaped name fails CI instead of being silently exempted.
   */
  declaredNames: ReadonlySet<string> = EMPTY_NAME_SET,
): string | null {
  if (depth > TRACE_BOUNDS.maxScanDepth) return `${label}: exceeds maximum scan depth`;
  budget.nodes += 1;
  if (budget.nodes > TRACE_BOUNDS.maxScanNodes) return `${label}: exceeds the maximum scannable node count`;
  if (typeof value === "string") {
    return containsSecretShapedText(value) ? `${label}: contains secret-shaped content` : null;
  }
  if (value === null || typeof value !== "object") return null;
  // [B11.5 §C] TOTAL. This function is exported and accepts untrusted input, so
  // every reflective operation is guarded individually and every value comes
  // from a DESCRIPTOR rather than a property read — `Object.entries` and
  // `value[key]` would invoke `get` traps, and a STATEFUL proxy can fail on any
  // later call even after an earlier one succeeded (B11.5 R3).
  const isArray = reflect(() => Array.isArray(value));
  if (!isArray.ok) return `${label}: is not reflectable (revoked or hostile proxy)`;
  const ownKeys = reflect(() => Reflect.ownKeys(value));
  if (!ownKeys.ok) return `${label}: its own keys are not reflectable (hostile trap)`;

  for (const key of ownKeys.value) {
    if (typeof key === "symbol") return `${label}: must not carry symbol keys`;
    if (isArray.value && key === "length") continue;
    const isIndex = isArray.value && /^(0|[1-9][0-9]*)$/.test(key);
    // [B11.3] An array's OWN NON-INDEX property names are scanned too: a
    // credential parked on the array itself (`nets.apiKey = "…"`) is invisible
    // to index iteration and to `JSON.stringify`.
    const safeLabel = isIndex ? `${label}[${key}]` : `${label}.${redactPathSegment(key)}`;
    if (!isIndex && !declaredNames.has(key) && (isCredentialShapedName(key) || containsSecretShapedText(key))) {
      return `${safeLabel}: credential-shaped field name`;
    }
    const descriptor = reflect(() => Reflect.getOwnPropertyDescriptor(value, key));
    if (!descriptor.ok) return `${safeLabel}: is not reflectable (hostile trap)`;
    if (descriptor.value === undefined) continue;
    if (typeof descriptor.value.get === "function" || typeof descriptor.value.set === "function") {
      return `${safeLabel}: must be a data property, not an accessor`;
    }
    const issue = findSecretShapedPath(descriptor.value.value, safeLabel, depth + 1, budget, declaredNames);
    if (issue !== null) return issue;
    if (budget.nodes > TRACE_BOUNDS.maxScanNodes) return `${label}: exceeds the maximum scannable node count`;
  }
  return null;
}

// ─── Trace document ──────────────────────────────────────────────────────────

export interface TraceScope { tenantId: string; projectId: string; branchId: string }

export interface TraceContextDigests {
  canonicalRevisionDigest: string | null;
  schematicDigest: string | null;
  selectionDigest: string | null;
  netlistDigest: string | null;
  resourceManifestDigest: string | null;
}

/** Distributive omit so union members keep their own shapes. */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** [B20 A4] The attribution of one external tool call: identities and hashes, never content. */
export interface TraceExternalAttribution {
  serverId: string;
  toolName: string | null;
  registryVersion: string;
  protocolVersion: string | null;
  listingDigest: string | null;
  resultClass: TraceExternalResultClass;
  contentHash: string | null;
  observationId: string | null;
  retrievedAt: string | null;
}

export type AgentTraceEvent =
  | { seq: number; kind: "run_started" }
  | { seq: number; kind: "step"; model: string; inputTokens: number; outputTokens: number; toolCallCount: number }
  | {
      seq: number; kind: "tool_invocation";
      callId: string; toolId: string; version: string; operationClass: string;
      argsDigest: string;
      outcomeClass: TraceOutcomeClass; status: string;
      verification: string | null; outputDigest: string | null;
      proposalId: string | null; proposalDigest: string | null;
      /** [B20 A4] required on external_observation, allowed on refused, absent otherwise */
      external?: TraceExternalAttribution;
    }
  | { seq: number; kind: "terminal"; outcome: TraceTerminalOutcome; failureReason: string | null };

export interface AgentRunTrace {
  schema: typeof AGENT_RUN_TRACE_SCHEMA;
  runId: string;
  traceId: string;
  provider: "openai" | "anthropic";
  /** Normalized model identifier reported by the adapter ("" until known). */
  model: string;
  promptVersion: string;
  promptDigest: string;
  registryDigest: string;
  scope: TraceScope;
  contextDigests: TraceContextDigests;
  startedAt: number;
  endedAt: number;
  events: AgentTraceEvent[];
  terminal: {
    outcome: TraceTerminalOutcome;
    failureReason: string | null;
    steps: number;
    toolCalls: number;
    usage: { inputTokens: number; outputTokens: number };
  };
  warnings: string[];
  recorderDiagnostics: TraceRecorderDiagnostic[];
}

export function agentRunTraceDigest(trace: AgentRunTrace): string {
  return engineeringDigest({ schema: "sirkit.agent-run-trace-digest.v1", trace });
}

// ─── Validation ──────────────────────────────────────────────────────────────

const TOP_KEYS = ["schema", "runId", "traceId", "provider", "model", "promptVersion", "promptDigest", "registryDigest", "scope", "contextDigests", "startedAt", "endedAt", "events", "terminal", "warnings", "recorderDiagnostics"] as const;
const SCOPE_KEYS = ["tenantId", "projectId", "branchId"] as const;
const CONTEXT_DIGEST_KEYS = ["canonicalRevisionDigest", "schematicDigest", "selectionDigest", "netlistDigest", "resourceManifestDigest"] as const;
const TERMINAL_KEYS = ["outcome", "failureReason", "steps", "toolCalls", "usage"] as const;
const USAGE_KEYS = ["inputTokens", "outputTokens"] as const;
const EVENT_KEYS = {
  run_started: ["seq", "kind"],
  step: ["seq", "kind", "model", "inputTokens", "outputTokens", "toolCallCount"],
  tool_invocation: ["seq", "kind", "callId", "toolId", "version", "operationClass", "argsDigest", "outcomeClass", "status", "verification", "outputDigest", "proposalId", "proposalDigest"],
  terminal: ["seq", "kind", "outcome", "failureReason"],
} as const;

/**
 * [B11.1] Every object in an audit document must be PLAIN JSON DATA:
 * a null/Object.prototype prototype, no symbol keys, and no non-enumerable
 * own properties. Anything else can hide values from `Object.keys` and
 * `JSON.stringify` — and therefore from exact-key validation AND the
 * secret denylist — while remaining readable by consumers.
 */
export function findNonPlainJsonPath(value: unknown, label = "$", depth = 0): string | null {
  // [B11.6 R5] the retained `depth` parameter is a SECURITY BOUND, not
  // decoration: a caller-supplied starting depth counts against the same
  // budget the recursion uses, so `depth > 32` at entry reports exhaustion
  // exactly as the pre-B11.5 contract did. It is threaded into the shared
  // walk rather than silently ignored.
  // [B11.5 §C] TOTAL by SHARING, not by re-implementation. The previous body
  // guarded one preliminary `Reflect.ownKeys` and then re-enumerated with
  // `Object.getOwnPropertyNames` / `Object.getOwnPropertySymbols` and read
  // values through `Object.entries` — all unguarded, and all capable of
  // invoking further proxy traps. B11.5 R3 reproduced five STATEFUL proxies
  // that threw straight out of this function. `scanPlainJson` runs the exact
  // walk `capturePlainJson` uses: every reflective operation is guarded
  // individually, values come from descriptors rather than property reads, and
  // no trap result is trusted to hold for a later call.
  return scanPlainJson(value, label, depth);
}

/** [B11.4] Guard for a reflective operation a hostile Proxy may make throw. */
function reflect<T>(run: () => T): { ok: true; value: T } | { ok: false } {
  try { return { ok: true, value: run() }; } catch { return { ok: false }; }
}

/** Bounded issue collector — a hostile document cannot flood the output. */
class Issues {
  private readonly list: string[] = [];
  push(issue: string): void {
    if (this.list.length < TRACE_BOUNDS.maxValidationIssues) this.list.push(issue);
  }
  get full(): boolean { return this.list.length >= TRACE_BOUNDS.maxValidationIssues; }
  get length(): number { return this.list.length; }
  value(): string[] { return [...this.list]; }
}

/** [B11.1] a key name is ECHOED into diagnostics, so it is sanitized and
 *  bounded — a hostile document cannot leak a secret through a key name. */
function safeKey(key: string): string {
  // [B11.5 §B] ONE authority for every diagnostic path segment.
  return redactPathSegment(key, 60);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string, issues: Issues): boolean {
  let ok = true;
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) { issues.push(`${label}.${safeKey(key)}: unknown key`); ok = false; }
  }
  for (const key of keys) {
    // [B11.1] OWN properties only: a value supplied through the prototype
    // chain is invisible to Object.keys AND to JSON.stringify (so it would
    // also escape the secret denylist) while still being readable by the
    // consumer. Such a document is REFUSED as missing the key.
    if (!Object.prototype.hasOwnProperty.call(value, key) || value[key] === undefined) {
      issues.push(`${label}.${key}: missing`);
      ok = false;
    }
  }
  return ok;
}

function boundedString(value: unknown, label: string, issues: Issues, max: number): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    issues.push(`${label}: must be a non-empty string of at most ${max} chars`);
    return false;
  }
  return true;
}

function nullableDigest(value: unknown, label: string, issues: Issues): boolean {
  if (value === null) return true;
  if (typeof value !== "string" || value.length === 0 || value.length > TRACE_BOUNDS.maxDigestChars) {
    issues.push(`${label}: must be null or a bounded digest string`);
    return false;
  }
  return true;
}

function nonNegativeInteger(value: unknown, label: string, issues: Issues): value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    issues.push(`${label}: must be a nonnegative safe integer`);
    return false;
  }
  return true;
}

/**
 * [B20 A4] The rule an `external` block breaks on an event of `outcomeClass` (`undefined`: no block), or null. The validator and the
 * recorder's normalisation cascade share it, so the recorder never records a block the validator refuses.
 */
export function externalAttributionIssue(outcomeClass: unknown, external: unknown): string | null {
  if (external === undefined) return outcomeClass === "external_observation" ? "external: required on external_observation" : null;
  if (outcomeClass !== "external_observation" && outcomeClass !== "refused") return "external: allowed only on external_observation and refused";
  if (typeof external !== "object" || external === null || Array.isArray(external)) return "external: must be an object";
  const block = external as Record<string, unknown>;
  const keys = Object.keys(block);
  if (keys.length !== TRACE_EXTERNAL_KEYS.length || !TRACE_EXTERNAL_KEYS.every((key) => Object.prototype.hasOwnProperty.call(block, key))) return "external: exact keys required";
  const field = (key: keyof typeof TRACE_EXTERNAL_PATTERNS, nullable: boolean): boolean => {
    const value = block[key];
    if (value === null) return nullable;
    return typeof value === "string" && TRACE_EXTERNAL_PATTERNS[key].test(value) && !containsSecretShapedText(value);
  };
  if (!field("serverId", false) || !field("toolName", true) || !field("registryVersion", false) || !field("protocolVersion", true) || !field("listingDigest", true)) return "external: an identity field is outside its pattern";
  if (!field("contentHash", true) || !field("observationId", true) || !field("retrievedAt", true)) return "external: a hash, id or time is outside its pattern";
  const resultClass = block.resultClass;
  if (!(TRACE_EXTERNAL_RESULT_CLASSES as readonly unknown[]).includes(resultClass)) return "external.resultClass: outside the closed vocabulary";
  const observed = OBSERVED_RESULT_CLASSES.includes(resultClass as string);
  if (outcomeClass === "external_observation" ? !observed : observed) return "external.resultClass: not a result class of this outcome";
  const hashed = HASHED_RESULT_CLASSES.includes(resultClass as string);
  if ((block.contentHash !== null) !== hashed || (block.observationId !== null) !== hashed || (block.retrievedAt !== null) !== hashed) return "external: the hash, id and time are present exactly for complete and tool_error";
  if (resultClass === "catalog" && (block.toolName !== null || block.listingDigest === null)) return "external: a catalog names no tool and a listing digest";
  return null;
}

/**
 * Returns every violation (bounded); empty ⇔ the document is a complete,
 * internally consistent, redacted trace.
 */
export function validateAgentRunTrace(untrusted: unknown): string[] {
  // [B11.4 §A/§C] CAPTURE FIRST. The document is untrusted: reading it through
  // ordinary property access would invoke accessors, `JSON.stringify` would
  // invoke `toJSON`, and a revoked/trap-hostile Proxy would throw. Capture
  // takes one hook-free, descriptor-only, deep-frozen snapshot; everything
  // below inspects THAT.
  const captured = capturePlainJson(untrusted, "trace", TRACE_BOUNDS.maxSerializedChars);
  if (!captured.ok) return captured.issues.slice(0, TRACE_BOUNDS.maxValidationIssues);
  return validateCapturedTrace(captured.value);
}

function validateCapturedTrace(raw: unknown): string[] {
  const issues = new Issues();
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return ["trace is not an object"];
  const trace = raw as Record<string, unknown>;
  // [B11.1] plain-JSON shape FIRST: a prototype-carried, symbol-keyed, or
  // non-enumerable field would otherwise be invisible to both exact-key
  // validation and the secret denylist.
  const nonPlain = findNonPlainJsonPath(trace, "trace");
  if (nonPlain !== null) return [nonPlain];
  if (!exactKeys(trace, TOP_KEYS, "trace", issues)) return issues.value();
  if (trace.schema !== AGENT_RUN_TRACE_SCHEMA) return [`trace.schema: expected ${AGENT_RUN_TRACE_SCHEMA}`];

  // ── Identity, provider, prompt/registry pins ──
  boundedString(trace.runId, "trace.runId", issues, TRACE_BOUNDS.maxIdChars);
  boundedString(trace.traceId, "trace.traceId", issues, TRACE_BOUNDS.maxIdChars);
  if (trace.provider !== "openai" && trace.provider !== "anthropic") issues.push("trace.provider: unknown provider");
  if (typeof trace.model !== "string" || trace.model.length > TRACE_BOUNDS.maxModelChars) issues.push("trace.model: must be a bounded string");
  boundedString(trace.promptVersion, "trace.promptVersion", issues, 64);
  boundedString(trace.promptDigest, "trace.promptDigest", issues, TRACE_BOUNDS.maxDigestChars);
  boundedString(trace.registryDigest, "trace.registryDigest", issues, TRACE_BOUNDS.maxDigestChars);

  // ── Scope + context digests (exact keys) ──
  const scope = trace.scope;
  if (typeof scope !== "object" || scope === null || Array.isArray(scope)) issues.push("trace.scope: must be an object");
  else if (exactKeys(scope as Record<string, unknown>, SCOPE_KEYS, "trace.scope", issues)) {
    for (const key of SCOPE_KEYS) boundedString((scope as Record<string, unknown>)[key], `trace.scope.${key}`, issues, TRACE_BOUNDS.maxIdChars);
  }
  const digests = trace.contextDigests;
  if (typeof digests !== "object" || digests === null || Array.isArray(digests)) issues.push("trace.contextDigests: must be an object");
  else if (exactKeys(digests as Record<string, unknown>, CONTEXT_DIGEST_KEYS, "trace.contextDigests", issues)) {
    for (const key of CONTEXT_DIGEST_KEYS) nullableDigest((digests as Record<string, unknown>)[key], `trace.contextDigests.${key}`, issues);
  }

  // ── Timeline ──
  const startedAt = trace.startedAt;
  const endedAt = trace.endedAt;
  if (typeof startedAt !== "number" || !Number.isFinite(startedAt)) issues.push("trace.startedAt: must be a finite number");
  if (typeof endedAt !== "number" || !Number.isFinite(endedAt)) issues.push("trace.endedAt: must be a finite number");
  if (typeof startedAt === "number" && typeof endedAt === "number" && Number.isFinite(startedAt) && Number.isFinite(endedAt) && endedAt < startedAt) {
    issues.push("trace.endedAt: must be greater than or equal to trace.startedAt");
  }

  // ── Events: shape, ordering, and the single-terminal law ──
  const events = trace.events;
  if (!Array.isArray(events) || events.length === 0 || events.length > TRACE_BOUNDS.maxEvents) {
    issues.push(`trace.events: must be a non-empty array of at most ${TRACE_BOUNDS.maxEvents}`);
    return issues.value();
  }
  let runStartedCount = 0;
  let terminalCount = 0;
  let terminalIndex = -1;
  let lastSeq = 0;
  let stepCount = 0;
  let toolCount = 0;
  let summedInput = 0;
  let summedOutput = 0;
  let lastStepModel: string | null = null;
  let terminalEvent: { outcome: unknown; failureReason: unknown } | null = null;

  for (const [index, item] of events.entries()) {
    if (issues.full) break;
    const label = `trace.events[${index}]`;
    if (typeof item !== "object" || item === null || Array.isArray(item)) { issues.push(`${label}: not an object`); continue; }
    const event = item as Record<string, unknown>;
    // [B11.1] `seq` must be CONTIGUOUS from 1, exactly as the recorder
    // assigns it. Monotonicity alone would let an attacker DELETE an event
    // (and decrement the matching total) leaving a self-consistent lie.
    if (typeof event.seq !== "number" || !Number.isSafeInteger(event.seq) || event.seq !== lastSeq + 1) {
      issues.push(`${label}.seq: must be contiguous from 1 (expected ${lastSeq + 1})`);
      continue;
    }
    lastSeq = event.seq;
    if (terminalCount > 0) { issues.push(`${label}: appears AFTER the terminal event`); continue; }
    const kind = event.kind;
    // [B11.1] `in` walks the PROTOTYPE chain, so a pure-JSON event with
    // kind "constructor"/"toString"/"valueOf" would resolve to an
    // Object.prototype member and be fed to exactKeys as a "key list",
    // throwing a TypeError instead of returning bounded issues.
    if (typeof kind !== "string" || !Object.prototype.hasOwnProperty.call(EVENT_KEYS, kind)) { issues.push(`${label}.kind: unknown event kind`); continue; }
    // [B20 A4] a tool_invocation may carry the optional `external` block (judged below): its key is exact too
    const eventKeys: readonly string[] = kind === "tool_invocation" && Object.prototype.hasOwnProperty.call(event, "external") ? [...EVENT_KEYS.tool_invocation, "external"] : EVENT_KEYS[kind as keyof typeof EVENT_KEYS];
    if (!exactKeys(event, eventKeys, label, issues)) continue;

    switch (kind) {
      case "run_started":
        runStartedCount += 1;
        if (index !== 0) issues.push(`${label}: run_started must be the FIRST event`);
        break;
      case "step": {
        stepCount += 1;
        if (typeof event.model !== "string" || event.model.length > TRACE_BOUNDS.maxModelChars) issues.push(`${label}.model: bounded string required`);
        else lastStepModel = event.model;
        if (nonNegativeInteger(event.inputTokens, `${label}.inputTokens`, issues)) summedInput += event.inputTokens as number;
        if (nonNegativeInteger(event.outputTokens, `${label}.outputTokens`, issues)) summedOutput += event.outputTokens as number;
        nonNegativeInteger(event.toolCallCount, `${label}.toolCallCount`, issues);
        break;
      }
      case "tool_invocation": {
        toolCount += 1;
        boundedString(event.callId, `${label}.callId`, issues, TRACE_BOUNDS.maxIdChars);
        boundedString(event.toolId, `${label}.toolId`, issues, TRACE_BOUNDS.maxIdChars);
        boundedString(event.version, `${label}.version`, issues, 32);
        boundedString(event.operationClass, `${label}.operationClass`, issues, 32);
        boundedString(event.argsDigest, `${label}.argsDigest`, issues, TRACE_BOUNDS.maxDigestChars);
        if (!(TRACE_OUTCOME_CLASSES as readonly string[]).includes(event.outcomeClass as string)) issues.push(`${label}.outcomeClass: outside the closed vocabulary`);
        boundedString(event.status, `${label}.status`, issues, TRACE_BOUNDS.maxStatusChars);
        nullableDigest(event.verification, `${label}.verification`, issues);
        nullableDigest(event.outputDigest, `${label}.outputDigest`, issues);
        nullableDigest(event.proposalId, `${label}.proposalId`, issues);
        nullableDigest(event.proposalDigest, `${label}.proposalDigest`, issues);
        const externalIssue = externalAttributionIssue(event.outcomeClass, Object.prototype.hasOwnProperty.call(event, "external") ? event.external : undefined); // [B20 A4]
        if (externalIssue !== null) issues.push(`${label}.${externalIssue}`);
        break;
      }
      case "terminal": {
        terminalCount += 1;
        terminalIndex = index;
        terminalEvent = { outcome: event.outcome, failureReason: event.failureReason };
        if (!(TRACE_TERMINAL_OUTCOMES as readonly string[]).includes(event.outcome as string)) issues.push(`${label}.outcome: outside the closed vocabulary`);
        if (event.failureReason !== null && (typeof event.failureReason !== "string" || event.failureReason.length > TRACE_BOUNDS.maxFailureReasonChars || !isValidFailureReason(event.failureReason))) {
          issues.push(`${label}.failureReason: outside the closed vocabulary`);
        }
        break;
      }
    }
  }
  if (runStartedCount !== 1) issues.push(`trace.events: exactly one run_started event required (found ${runStartedCount})`);
  if (terminalCount !== 1) issues.push(`trace.events: exactly one terminal event required (found ${terminalCount})`);
  else if (terminalIndex !== events.length - 1) issues.push("trace.events: the terminal event must be LAST");

  // ── Terminal summary: exact keys AND agreement with the event ledger ──
  const terminal = trace.terminal;
  if (typeof terminal !== "object" || terminal === null || Array.isArray(terminal)) {
    issues.push("trace.terminal: must be an object");
    return issues.value();
  }
  const terminalRecord = terminal as Record<string, unknown>;
  if (exactKeys(terminalRecord, TERMINAL_KEYS, "trace.terminal", issues)) {
    const outcome = terminalRecord.outcome;
    const failureReason = terminalRecord.failureReason;
    if (!(TRACE_TERMINAL_OUTCOMES as readonly string[]).includes(outcome as string)) issues.push("trace.terminal.outcome: outside the closed vocabulary");
    if (failureReason !== null && (typeof failureReason !== "string" || failureReason.length > TRACE_BOUNDS.maxFailureReasonChars || !isValidFailureReason(failureReason))) {
      issues.push("trace.terminal.failureReason: outside the closed vocabulary");
    }
    // Outcome/reason semantics.
    if (outcome === "completed" && failureReason !== null) issues.push("trace.terminal: a completed run must carry a null failureReason");
    if (outcome === "cancelled" && failureReason !== CANCELLED_FAILURE_REASON) issues.push(`trace.terminal: a cancelled run must carry the normalized "${CANCELLED_FAILURE_REASON}" reason`);
    if (outcome === "failed" && (typeof failureReason !== "string" || !isValidFailureReason(failureReason))) issues.push("trace.terminal: a failed run must carry a closed-vocabulary failure reason");
    // The summary must equal the terminal EVENT.
    if (terminalEvent !== null) {
      if (terminalEvent.outcome !== outcome) issues.push("trace.terminal.outcome: disagrees with the terminal event");
      if (terminalEvent.failureReason !== failureReason) issues.push("trace.terminal.failureReason: disagrees with the terminal event");
    }
    // Totals must equal the event ledger.
    if (nonNegativeInteger(terminalRecord.steps, "trace.terminal.steps", issues) && terminalRecord.steps !== stepCount) {
      issues.push(`trace.terminal.steps: disagrees with the event ledger (${String(terminalRecord.steps)} vs ${stepCount})`);
    }
    if (nonNegativeInteger(terminalRecord.toolCalls, "trace.terminal.toolCalls", issues) && terminalRecord.toolCalls !== toolCount) {
      issues.push(`trace.terminal.toolCalls: disagrees with the event ledger (${String(terminalRecord.toolCalls)} vs ${toolCount})`);
    }
    const usage = terminalRecord.usage;
    if (typeof usage !== "object" || usage === null || Array.isArray(usage)) issues.push("trace.terminal.usage: must be an object");
    else if (exactKeys(usage as Record<string, unknown>, USAGE_KEYS, "trace.terminal.usage", issues)) {
      const usageRecord = usage as Record<string, unknown>;
      if (nonNegativeInteger(usageRecord.inputTokens, "trace.terminal.usage.inputTokens", issues) && usageRecord.inputTokens !== summedInput) {
        issues.push("trace.terminal.usage.inputTokens: does not equal the summed step usage");
      }
      if (nonNegativeInteger(usageRecord.outputTokens, "trace.terminal.usage.outputTokens", issues) && usageRecord.outputTokens !== summedOutput) {
        issues.push("trace.terminal.usage.outputTokens: does not equal the summed step usage");
      }
    }
  }

  // ── Model must equal the last recorded step model (or "" with no steps) ──
  if (typeof trace.model === "string") {
    const expectedModel = lastStepModel ?? "";
    if (trace.model !== expectedModel) issues.push("trace.model: must equal the last recorded step model (empty when no step exists)");
  }

  // ── Warnings + diagnostics ──
  const warnings = trace.warnings;
  if (!Array.isArray(warnings) || warnings.length > TRACE_BOUNDS.maxWarnings) issues.push(`trace.warnings: at most ${TRACE_BOUNDS.maxWarnings} entries`);
  else {
    for (const [index, warning] of warnings.entries()) {
      if (issues.full) break;
      if (typeof warning !== "string" || warning.length > TRACE_BOUNDS.maxWarningChars) { issues.push(`trace.warnings[${index}]: bounded string required`); break; }
      if (containsSecretShapedText(warning)) { issues.push(`trace.warnings[${index}]: contains secret-shaped content`); break; }
    }
  }
  const diagnostics = trace.recorderDiagnostics;
  if (!Array.isArray(diagnostics)) issues.push("trace.recorderDiagnostics: must be an array");
  else if (diagnostics.length > TRACE_BOUNDS.maxRecorderDiagnostics) {
    // [B11.2] the LENGTH bound is checked BEFORE any scanning or Set
    // construction, so an oversized array cannot buy unbounded work.
    issues.push(`trace.recorderDiagnostics: at most ${TRACE_BOUNDS.maxRecorderDiagnostics} entries`);
  } else {
    if (diagnostics.some((entry) => !(TRACE_RECORDER_DIAGNOSTICS as readonly string[]).includes(entry as string))) {
      issues.push("trace.recorderDiagnostics: outside the closed vocabulary");
    }
    if (new Set(diagnostics).size !== diagnostics.length) issues.push("trace.recorderDiagnostics: entries must be unique");
  }

  // ── [B11.2] COMPLETE redaction validation ──
  // The direct recursive scan inspects every key name and every ORIGINAL
  // string value (model, identities, statuses, verification, proposal ids,
  // event fields, warnings, diagnostics) before serialization, so nested
  // credential-shaped JSON inside a string cannot hide behind escaping.
  // The serialized scan is retained as a second, independent net.
  if (issues.length === 0) {
    const secretPath = findSecretShapedPath(trace, "trace");
    if (secretPath !== null) issues.push(secretPath);
  }
  if (issues.length === 0) {
    let serialized: string;
    try { serialized = JSON.stringify(trace); } catch { serialized = ""; issues.push("trace: is not serializable"); }
    if (serialized.length > TRACE_BOUNDS.maxSerializedChars) issues.push(`trace: exceeds the ${TRACE_BOUNDS.maxSerializedChars}-character serialized bound`);
    else if (serialized !== "" && containsSecretShapedText(serialized)) issues.push("trace: contains secret-shaped content");
  }
  return issues.value();
}
