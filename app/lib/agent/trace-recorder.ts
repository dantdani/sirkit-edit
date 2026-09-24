/**
 * B11 / B11.1 — the injectable trace-recorder boundary shared by the
 * production loop and chat route.
 *
 * Ownership contract:
 *  - Run/trace/provider/scope identity is FROZEN at construction — no
 *    record method accepts identity fields, so a caller cannot re-scope a
 *    recorder after creation and concurrent runs (one recorder per run)
 *    can never mix events.
 *  - Trace order follows the normalized run-event order; exactly one
 *    run_started and exactly one terminal record; NOTHING appends after
 *    the terminal (late provider/tool completions are refused and counted
 *    as a recorder diagnostic, never an error).
 *  - [B11.1] HOSTILE-SINK ISOLATION: a sink never receives a reference the
 *    recorder owns. Every `append`/`complete` payload is an independent
 *    deep-frozen `structuredClone`, and the recorder's internal events and
 *    returned documents are deep-frozen too. A sink that mutates whatever
 *    it is handed cannot change internal events, identity, totals,
 *    diagnostics, the cached finalization, or the returned trace.
 *    SCOPE (stated precisely): `inSinkCall` refuses SYNCHRONOUS
 *    re-entrancy. It cannot stop a sink that DEFERS a call (microtask or
 *    timer) — a boolean cannot express "this caller may never write".
 *    That path grants no extra authority: nothing in production ever hands
 *    a sink a recorder reference (the route builds the sink first and
 *    never passes the recorder to it), so an attacker able to make the
 *    deferred call already has in-process code execution and could invoke
 *    the recorder directly. A writer-capability split is the structural
 *    answer and is recorded as PROPOSED, not silently assumed.
 *  - [B11.1] The sink contract is SYNCHRONOUS. An `async` sink type-checks
 *    (void-return bivariance) but its rejection would escape unhandled, so
 *    a returned thenable's rejection is captured and classified.
 *  - [B11.1] Recording is TOTAL: no recorder method throws — every input
 *    is normalized or refused, and every internal failure (clock, digest,
 *    sink factory, append, complete, validation) is classified into the
 *    closed diagnostic vocabulary. Trace recording can therefore never
 *    change tool authorization, execution outcomes, or terminal semantics.
 *  - [B11.1] VALIDATE BEFORE PERSIST: `complete` receives only a VALID,
 *    independent snapshot. An invalid document is classified
 *    (`trace_validation_failure`) and never handed to a storage sink.
 *
 * Storage: `AgentTraceSink` is the interface; `InMemoryTraceSink` is the
 * reference implementation (it also stores snapshots, never caller-owned
 * references). Durable retention, retention duration, and operator access
 * are EXPLICIT FUTURE OWNER DECISIONS — nothing here introduces database
 * persistence.
 */

import { engineeringDigest } from "../engineering/stable";
import type { SealedTier1Proposal } from "../engineering/schematic-proposals";
import {
  AGENT_RUN_TRACE_SCHEMA,
  CANCELLED_FAILURE_REASON,
  TRACE_OUTCOME_CLASSES, TRACE_EXTERNAL_KEYS, TRACE_EXTERNAL_PATTERNS, TRACE_EXTERNAL_RESULT_CLASSES, externalAttributionIssue, // [B20 A4] one line: no cited line moves
  isValidFailureReason,
  sanitizeTraceText,
  TRACE_BOUNDS,
  validateAgentRunTrace,
  type AgentRunTrace,
  type AgentTraceEvent,
  type DistributiveOmit,
  type TraceContextDigests, type TraceExternalAttribution, // [B20 A4]
  type TraceOutcomeClass,
  type TraceRecorderDiagnostic,
  type TraceScope,
  type TraceTerminalOutcome,
} from "./trace";

// ─── Isolation helpers ───────────────────────────────────────────────────────

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

/** An independent, deep-frozen snapshot. Never shares a reference with the
 *  recorder's own state; unclonable input yields null (classified upstream). */
function snapshot<T>(value: T): T | null {
  try { return deepFreeze(structuredClone(value)); } catch { return null; }
}

// ─── Sink boundary ───────────────────────────────────────────────────────────

export interface AgentTraceSink {
  /** Append one trace event. Receives an INDEPENDENT deep-frozen snapshot;
   *  may throw — the recorder classifies and continues. */
  append(event: AgentTraceEvent): void;
  /** Receive the finalized VALIDATED trace as an independent deep-frozen
   *  snapshot. May throw — same classification contract. */
  complete(trace: AgentRunTrace): void;
}

export class InMemoryTraceSink implements AgentTraceSink {
  readonly appended: AgentTraceEvent[] = [];
  completed: AgentRunTrace | null = null;
  append(event: AgentTraceEvent): void {
    // Store a snapshot: a later caller mutation cannot rewrite history here.
    const stored = snapshot(event);
    if (stored !== null) this.appended.push(stored);
  }
  complete(trace: AgentRunTrace): void {
    this.completed = snapshot(trace);
  }
}

/** Injectable sink factory (tests/future storage owners). Production
 *  default: run-local in-memory (no retention decision is made here). */
let sinkFactory: () => AgentTraceSink = () => new InMemoryTraceSink();
export function setAgentTraceSinkFactory(factory: (() => AgentTraceSink) | null): void {
  sinkFactory = factory ?? (() => new InMemoryTraceSink());
}

/**
 * [B11.1] NEVER throws. A failing configured factory falls back to an
 * isolated in-memory sink and reports the classification so the recorder
 * can record `trace_sink_factory_failure`.
 */
export function createAgentTraceSink(): { sink: AgentTraceSink; factoryFailed: boolean } {
  try {
    const sink = sinkFactory();
    if (!sink || typeof sink.append !== "function" || typeof sink.complete !== "function") {
      return { sink: new InMemoryTraceSink(), factoryFailed: true };
    }
    return { sink, factoryFailed: false };
  } catch {
    return { sink: new InMemoryTraceSink(), factoryFailed: true };
  }
}

// ─── Recorder ────────────────────────────────────────────────────────────────

export interface AgentTraceIdentity {
  runId: string;
  traceId: string;
  provider: "openai" | "anthropic";
  promptVersion: string;
  promptDigest: string;
  registryDigest: string;
  scope: TraceScope;
  contextDigests: TraceContextDigests;
}

const UNKNOWN_FIELD = "unknown";
/** [B20 A4] the registry version an external block keeps when the one it was handed is outside its pattern */
const UNKNOWN_REGISTRY_VERSION = "0.0.0";

export class AgentTraceRecorder {
  private readonly identity: Readonly<AgentTraceIdentity>;
  private readonly sink: AgentTraceSink;
  private readonly rawClock: () => number;
  private readonly events: AgentTraceEvent[] = [];
  private readonly warnings: string[] = [];
  private readonly diagnostics = new Set<TraceRecorderDiagnostic>();
  private readonly startedAt: number;
  private lastClock = 0;
  private seq = 0;
  private model = "";
  private terminalRecorded = false;
  private finalized: AgentRunTrace | null = null;
  /** [B11.1] true while control is inside a sink callback. A hostile sink
   *  that calls recorder methods RE-ENTRANTLY must not be able to inject,
   *  truncate, or recursively finalize the ledger. */
  private inSinkCall = false;

  constructor(
    identity: AgentTraceIdentity,
    sink: AgentTraceSink,
    clock: () => number = () => Date.now(),
    options?: { initialDiagnostics?: readonly TraceRecorderDiagnostic[] },
  ) {
    this.identity = deepFreeze({
      ...identity,
      scope: { ...identity.scope },
      contextDigests: { ...identity.contextDigests },
    });
    this.sink = sink;
    this.rawClock = clock;
    for (const diagnostic of options?.initialDiagnostics ?? []) this.diagnostics.add(diagnostic);
    this.startedAt = this.now();
  }

  /**
   * [B11.2] TOTAL BOUNDARY. Every public recording/finalization method runs
   * inside this wrapper, so ARBITRARY JavaScript runtime input — malformed
   * outer values, hostile getters/proxies/coercion, cyclic payloads,
   * invalid numerics, oversized or secret-shaped strings, unexpected
   * terminal values, throwing clocks and sinks — can never throw into the
   * run. The failure is classified into the closed vocabulary and NOTHING
   * about the exception (message, stack, raw value, provider content) is
   * retained.
   */
  private total(work: () => void): void {
    try { work(); } catch { this.diagnostics.add("trace_input_normalized"); }
  }

  /**
   * [B11.2] Last-resort document, built ONLY from frozen construction-time
   * identity so it has no throwing path. It is returned to the caller and
   * NEVER handed to a sink (it is not a valid persisted trace).
   */
  private emergencyTrace(): AgentRunTrace {
    return deepFreeze({
      schema: AGENT_RUN_TRACE_SCHEMA,
      runId: this.identity.runId,
      traceId: this.identity.traceId,
      provider: this.identity.provider,
      model: "",
      promptVersion: this.identity.promptVersion,
      promptDigest: this.identity.promptDigest,
      registryDigest: this.identity.registryDigest,
      scope: { ...this.identity.scope },
      contextDigests: { ...this.identity.contextDigests },
      startedAt: this.startedAt,
      endedAt: this.startedAt,
      events: [],
      terminal: { outcome: "failed", failureReason: "internal_error", steps: 0, toolCalls: 0, usage: { inputTokens: 0, outputTokens: 0 } },
      warnings: [],
      recorderDiagnostics: ["trace_input_normalized"],
    }) as AgentRunTrace;
  }

  /** Read a property that may be a hostile accessor. Never throws. */
  private safeRead(source: unknown, key: string): unknown {
    if (source === null || typeof source !== "object") return undefined;
    try { return (source as Record<string, unknown>)[key]; } catch { this.diagnostics.add("trace_input_normalized"); return undefined; }
  }

  /** [B11.1] a throwing, nonfinite, or nonmonotonic clock is classified and
   *  normalized — it can never corrupt the timeline or throw to the run. */
  private now(): number {
    let value: unknown;
    try { value = this.rawClock(); } catch { this.diagnostics.add("trace_clock_failure"); return this.lastClock; }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      this.diagnostics.add("trace_clock_failure");
      return this.lastClock;
    }
    if (value < this.lastClock) {
      this.diagnostics.add("trace_clock_failure");
      return this.lastClock;
    }
    this.lastClock = value;
    return value;
  }

  /** Digest a payload; an unserializable (cyclic) payload is classified and
   *  digested as a stable sentinel instead of throwing. */
  private digestOf(envelope: Record<string, unknown>, fallback: Record<string, unknown>): string {
    try {
      return engineeringDigest(envelope);
    } catch {
      this.diagnostics.add("trace_digest_failure");
      return engineeringDigest(fallback);
    }
  }

  private boundedIdentifier(value: unknown, max: number): string {
    if (typeof value !== "string") { this.diagnostics.add("trace_input_normalized"); return UNKNOWN_FIELD; }
    const sanitized = sanitizeTraceText(value, max);
    if (sanitized !== value) this.diagnostics.add("trace_input_normalized");
    return sanitized.length === 0 ? UNKNOWN_FIELD : sanitized;
  }

  private boundedNullable(value: unknown, max: number): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== "string") { this.diagnostics.add("trace_input_normalized"); return null; }
    const sanitized = sanitizeTraceText(value, max);
    if (sanitized !== value) this.diagnostics.add("trace_input_normalized");
    return sanitized.length === 0 ? null : sanitized;
  }

  private count(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      if (value !== undefined) this.diagnostics.add("trace_input_normalized");
      return 0;
    }
    const floored = Math.floor(value);
    if (floored !== value) this.diagnostics.add("trace_input_normalized");
    return Math.min(floored, Number.MAX_SAFE_INTEGER);
  }

  private append(event: DistributiveOmit<AgentTraceEvent, "seq">): void {
    // A sink cannot inject or truncate events from inside its own callback.
    if (this.inSinkCall) { this.diagnostics.add("trace_reentrant_call_refused"); return; }
    if (this.terminalRecorded) { this.diagnostics.add("trace_post_terminal_append_refused"); return; }
    if (this.events.length >= TRACE_BOUNDS.maxEvents - 1 && event.kind !== "terminal") {
      this.diagnostics.add("trace_event_capacity_reached");
      return;
    }
    this.seq += 1;
    // The recorder's own copy is frozen; the sink gets a separate snapshot.
    const sequenced = deepFreeze({ ...event, seq: this.seq }) as AgentTraceEvent;
    this.events.push(sequenced);
    if (event.kind === "terminal") this.terminalRecorded = true;
    const forSink = snapshot(sequenced);
    if (forSink === null) { this.diagnostics.add("trace_digest_failure"); return; }
    this.callSink(() => this.sink.append(forSink));
  }

  /** Invoke a sink callback with the re-entrancy guard raised. A throwing
   *  sink is classified; a re-entrant sink call is refused. */
  private callSink(invoke: () => unknown): void {
    if (this.inSinkCall) { this.diagnostics.add("trace_reentrant_call_refused"); return; }
    this.inSinkCall = true;
    try {
      const returned = invoke();
      // [B11.1] the sink contract is SYNCHRONOUS, but TypeScript's
      // void-return bivariance lets an `async append()` type-check. A
      // returned rejected promise would otherwise escape as an UNHANDLED
      // REJECTION and never be classified — capture and classify it.
      if (returned !== null && typeof returned === "object" && typeof (returned as { then?: unknown }).then === "function") {
        // Returning a thenable is itself observable SYNCHRONOUSLY, so the
        // contract violation is classified now (and therefore appears in
        // the returned/persisted trace). A later rejection is additionally
        // captured, though it may arrive after finalization — an async
        // sink cannot have its outcome reflected in the document it is
        // being handed, which is precisely why the contract is sync.
        this.diagnostics.add("trace_sink_contract_violation");
        void (returned as Promise<unknown>).catch(() => { this.diagnostics.add("trace_sink_failure"); });
      }
    } catch {
      this.diagnostics.add("trace_sink_failure");
    } finally {
      this.inSinkCall = false;
    }
  }

  recordRunStarted(): void {
    this.total(() => {
      if (this.events.length > 0) return; // exactly one, always first
      this.append({ kind: "run_started" });
    });
  }

  recordWarning(message: string): void {
    this.total(() => {
      if (this.inSinkCall) { this.diagnostics.add("trace_reentrant_call_refused"); return; }
      if (this.terminalRecorded) { this.diagnostics.add("trace_post_terminal_append_refused"); return; }
      if (this.warnings.length >= TRACE_BOUNDS.maxWarnings) { this.diagnostics.add("trace_event_capacity_reached"); return; }
      // [B11.2] a non-string message is REFUSED, never coerced: `String(x)`
      // invokes a hostile `toString`/`valueOf`, and the coerced text could
      // carry provider content.
      if (typeof message !== "string") { this.diagnostics.add("trace_input_normalized"); return; }
      this.warnings.push(sanitizeTraceText(message));
    });
  }

  recordStep(step: { model: string; usage: { inputTokens?: number; outputTokens?: number }; toolCallCount: number }): void {
    this.total(() => {
      // Every read goes through safeRead: a hostile accessor cannot throw.
      const rawModel = this.safeRead(step, "model");
      const model = typeof rawModel === "string" ? sanitizeTraceText(rawModel, TRACE_BOUNDS.maxModelChars) : "";
      if (model !== rawModel) this.diagnostics.add("trace_input_normalized");
      const usage = this.safeRead(step, "usage");
      const inputTokens = this.count(this.safeRead(usage, "inputTokens"));
      const outputTokens = this.count(this.safeRead(usage, "outputTokens"));
      const toolCallCount = this.count(this.safeRead(step, "toolCallCount"));
      const before = this.events.length;
      this.append({ kind: "step", model, inputTokens, outputTokens, toolCallCount });
      if (this.events.length > before) this.model = model; // only when actually recorded
    });
  }

  /**
   * [B20 A4] The external block of a tool event, normalised so the recorder never records an invalid event (the cascade): a field
   * is kept only when it matches its pattern AND passes the redactor unchanged; otherwise the tool name, protocol version and
   * listing digest become null, the registry version "0.0.0", and a bad hash, id or time nulls all three. A block that then breaks
   * a validator rule becomes `result_invalid` (its three nulled) on a `refused` event; one that still breaks one (a server id that
   * cannot be recorded) is dropped and the event is `refused`. A block on a class that forbids it is dropped. Each normalisation
   * adds `trace_input_normalized`.
   */
  private normalizeExternal(outcomeClass: TraceOutcomeClass, raw: unknown): { outcomeClass: TraceOutcomeClass; external?: TraceExternalAttribution } {
    const normalized = (): void => { this.diagnostics.add("trace_input_normalized"); };
    if (raw === undefined) {
      if (outcomeClass !== "external_observation") return { outcomeClass };
      normalized();
      return { outcomeClass: "refused" };
    }
    if (outcomeClass !== "external_observation" && outcomeClass !== "refused") {
      normalized();
      return { outcomeClass };
    }
    const read = (key: string): unknown => this.safeRead(raw, key);
    const kept = (value: unknown, pattern: RegExp): value is string => typeof value === "string" && pattern.test(value) && sanitizeTraceText(value, 200) === value;
    try {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw) || Reflect.ownKeys(raw).some((key) => !(TRACE_EXTERNAL_KEYS as readonly unknown[]).includes(key))) normalized();
    } catch {
      normalized();
    }
    const serverId = read("serverId");
    if (!kept(serverId, TRACE_EXTERNAL_PATTERNS.serverId)) {
      normalized();
      return { outcomeClass: "refused" };
    }
    const nullable = (key: "toolName" | "protocolVersion" | "listingDigest"): string | null => {
      const value = read(key);
      if (value === null) return null;
      if (kept(value, TRACE_EXTERNAL_PATTERNS[key])) return value;
      normalized();
      return null;
    };
    const registryRaw = read("registryVersion");
    const registryVersion = kept(registryRaw, TRACE_EXTERNAL_PATTERNS.registryVersion) ? registryRaw : (normalized(), UNKNOWN_REGISTRY_VERSION);
    const rawClass = read("resultClass");
    const knownClass = (TRACE_EXTERNAL_RESULT_CLASSES as readonly unknown[]).includes(rawClass);
    if (!knownClass) normalized();
    const trio = (["contentHash", "observationId", "retrievedAt"] as const).map((key) => read(key));
    const trioKept = trio.every((value, index) => value === null || kept(value, TRACE_EXTERNAL_PATTERNS[(["contentHash", "observationId", "retrievedAt"] as const)[index]!]));
    if (!trioKept) normalized();
    const block: TraceExternalAttribution = {
      serverId,
      toolName: nullable("toolName"),
      registryVersion,
      protocolVersion: nullable("protocolVersion"),
      listingDigest: nullable("listingDigest"),
      resultClass: knownClass ? (rawClass as TraceExternalAttribution["resultClass"]) : "result_invalid",
      contentHash: trioKept ? (trio[0] as string | null) : null,
      observationId: trioKept ? (trio[1] as string | null) : null,
      retrievedAt: trioKept ? (trio[2] as string | null) : null,
    };
    if (!knownClass) return this.demoted(block);
    if (externalAttributionIssue(outcomeClass, block) === null) return { outcomeClass, external: block };
    normalized();
    return this.demoted(block);
  }

  /** [B20 A4] The cascade's last two steps: `result_invalid` on a refused event, or no block at all. */
  private demoted(block: TraceExternalAttribution): { outcomeClass: TraceOutcomeClass; external?: TraceExternalAttribution } {
    const invalid: TraceExternalAttribution = { ...block, resultClass: "result_invalid", contentHash: null, observationId: null, retrievedAt: null };
    if (externalAttributionIssue("refused", invalid) === null) return { outcomeClass: "refused", external: invalid };
    this.diagnostics.add("trace_input_normalized");
    return { outcomeClass: "refused" };
  }

  recordTool(input: {
    callId: string; toolId: string; version: string; operationClass: string;
    args: Record<string, unknown>;
    outcomeClass: TraceOutcomeClass; status: string;
    verification?: string | null;
    output?: Record<string, unknown> | null;
    proposal?: Pick<SealedTier1Proposal, "proposalId" | "operationsDigest"> | null;
    /** [B20 A4] an external tool call's attribution (normalised by `normalizeExternal`) */
    external?: unknown;
  }): void {
    this.total(() => {
      const proposal = this.safeRead(input, "proposal");
      const output = this.safeRead(input, "output");
      const rawOutcomeClass = this.safeRead(input, "outcomeClass");
      const declaredClass = (TRACE_OUTCOME_CLASSES as readonly string[]).includes(rawOutcomeClass as string)
        ? (rawOutcomeClass as TraceOutcomeClass)
        : (this.diagnostics.add("trace_input_normalized"), "refused" as TraceOutcomeClass);
      const { outcomeClass, external } = this.normalizeExternal(declaredClass, this.safeRead(input, "external"));
      this.append({
        kind: "tool_invocation",
        callId: this.boundedIdentifier(this.safeRead(input, "callId"), TRACE_BOUNDS.maxIdChars),
        toolId: this.boundedIdentifier(this.safeRead(input, "toolId"), TRACE_BOUNDS.maxIdChars),
        version: this.boundedIdentifier(this.safeRead(input, "version"), 32),
        operationClass: this.boundedIdentifier(this.safeRead(input, "operationClass"), 32),
        // Payloads enter the trace ONLY as digests.
        argsDigest: this.digestOf({ schema: "sirkit.agent-trace-args.v1", args: this.safeRead(input, "args") }, { schema: "sirkit.agent-trace-args.v1", args: "[undigestible]" }),
        outcomeClass,
        status: this.boundedIdentifier(this.safeRead(input, "status"), TRACE_BOUNDS.maxStatusChars),
        verification: this.boundedNullable(this.safeRead(input, "verification"), TRACE_BOUNDS.maxDigestChars),
        outputDigest: output ? this.digestOf({ schema: "sirkit.agent-trace-output.v1", output }, { schema: "sirkit.agent-trace-output.v1", output: "[undigestible]" }) : null,
        proposalId: this.boundedNullable(this.safeRead(proposal, "proposalId"), TRACE_BOUNDS.maxDigestChars),
        proposalDigest: this.boundedNullable(this.safeRead(proposal, "operationsDigest"), TRACE_BOUNDS.maxDigestChars),
        ...(external === undefined ? {} : { external }),
      });
    });
  }

  /** Normalize an (outcome, reason) pair into the closed vocabulary. */
  private normalizeTerminal(outcome: TraceTerminalOutcome, failureReason: string | null): { outcome: TraceTerminalOutcome; failureReason: string | null } {
    const safeOutcome: TraceTerminalOutcome = outcome === "completed" || outcome === "failed" || outcome === "cancelled" ? outcome : "failed";
    if (safeOutcome !== outcome) this.diagnostics.add("trace_input_normalized");
    if (safeOutcome === "completed") {
      if (failureReason !== null) this.diagnostics.add("trace_input_normalized");
      return { outcome: safeOutcome, failureReason: null };
    }
    if (safeOutcome === "cancelled") {
      if (failureReason !== CANCELLED_FAILURE_REASON) this.diagnostics.add("trace_input_normalized");
      return { outcome: safeOutcome, failureReason: CANCELLED_FAILURE_REASON };
    }
    const candidate = typeof failureReason === "string" ? failureReason.slice(0, TRACE_BOUNDS.maxFailureReasonChars) : "";
    // (a non-string reason falls through to the normalized default below)
    if (isValidFailureReason(candidate)) return { outcome: safeOutcome, failureReason: candidate };
    this.diagnostics.add("trace_input_normalized");
    return { outcome: safeOutcome, failureReason: "internal_error" };
  }

  recordTerminal(outcome: TraceTerminalOutcome, failureReason: string | null): void {
    this.total(() => {
      const normalized = this.normalizeTerminal(outcome, failureReason);
      this.append({ kind: "terminal", outcome: normalized.outcome, failureReason: normalized.failureReason });
    });
  }

  get hasTerminal(): boolean { return this.terminalRecorded; }
  get isFinalized(): boolean { return this.finalized !== null; }

  private compose(): AgentRunTrace {
    const stepEvents = this.events.filter((event): event is Extract<AgentTraceEvent, { kind: "step" }> => event.kind === "step");
    const toolEvents = this.events.filter((event) => event.kind === "tool_invocation");
    const terminalEvent = this.events.find((event): event is Extract<AgentTraceEvent, { kind: "terminal" }> => event.kind === "terminal");
    return {
      schema: AGENT_RUN_TRACE_SCHEMA,
      runId: this.identity.runId,
      traceId: this.identity.traceId,
      provider: this.identity.provider,
      model: this.model,
      promptVersion: this.identity.promptVersion,
      promptDigest: this.identity.promptDigest,
      registryDigest: this.identity.registryDigest,
      scope: { ...this.identity.scope },
      contextDigests: { ...this.identity.contextDigests },
      startedAt: this.startedAt,
      endedAt: this.now(),
      events: this.events.map((event) => ({ ...event })) as AgentTraceEvent[],
      terminal: {
        // The summary is DERIVED from the terminal event and the ledger —
        // it can never disagree with them.
        // NOTE: `??` must NOT be used here — a completed terminal carries a
        // legitimately null failureReason that nullish-coalescing would
        // rewrite into a failure reason.
        outcome: terminalEvent ? terminalEvent.outcome : "failed",
        failureReason: terminalEvent ? terminalEvent.failureReason : "internal_error",
        steps: stepEvents.length,
        toolCalls: toolEvents.length,
        usage: {
          inputTokens: stepEvents.reduce((total, event) => total + event.inputTokens, 0),
          outputTokens: stepEvents.reduce((total, event) => total + event.outputTokens, 0),
        },
      },
      warnings: [...this.warnings],
      recorderDiagnostics: [...this.diagnostics].sort(),
    };
  }

  /**
   * Assemble, VALIDATE, and (only if valid) hand an independent snapshot to
   * the sink. Idempotent: repeated calls return equivalent immutable
   * content. Never throws.
   */
  finalize(summary: { outcome: TraceTerminalOutcome; failureReason: string | null }): AgentRunTrace {
    try {
      return this.finalizeInternal(summary);
    } catch {
      // [B11.2] finalize is TOTAL. A hostile summary or an internal failure
      // yields a classified, deep-frozen document instead of a throw. The
      // fallback is itself guarded, so this method has NO throwing path.
      this.diagnostics.add("trace_input_normalized");
      try {
        this.finalized ??= deepFreeze({ ...this.compose(), recorderDiagnostics: [...this.diagnostics].sort() });
        return this.finalized;
      } catch {
        return this.emergencyTrace();
      }
    }
  }

  private finalizeInternal(summary: { outcome: TraceTerminalOutcome; failureReason: string | null }): AgentRunTrace {
    if (this.finalized) return this.finalized;
    // A sink calling finalize() from inside complete() must not recurse or
    // persist again: it receives a composed snapshot and nothing else.
    if (this.inSinkCall) {
      this.diagnostics.add("trace_reentrant_call_refused");
      return deepFreeze(this.compose());
    }
    if (!this.terminalRecorded) {
      // [B11.2] `summary` is arbitrary runtime input — read both fields
      // through the hostile-accessor-safe reader before normalizing.
      this.recordTerminal(
        this.safeRead(summary, "outcome") as TraceTerminalOutcome,
        (this.safeRead(summary, "failureReason") ?? null) as string | null,
      );
    }
    // A hostile `summary` may have prevented the terminal from recording.
    if (!this.terminalRecorded) this.recordTerminal("failed", "internal_error");

    // 1. Construct the candidate document.
    const candidate = this.compose();
    // 2. Validate BEFORE persistence.
    let issues: string[];
    try { issues = validateAgentRunTrace(candidate); } catch { issues = ["validator failed"]; }
    if (issues.length > 0) {
      // 3. Classify without raw details; NEVER hand an invalid trace to a sink.
      this.diagnostics.add("trace_validation_failure");
    } else {
      // 4. Only a VALID, independent snapshot reaches the sink.
      const forSink = snapshot(candidate);
      if (forSink === null) this.diagnostics.add("trace_digest_failure");
      else this.callSink(() => this.sink.complete(forSink));
    }
    // 5. The RETURNED document carries the final diagnostics (including a
    //    complete-only sink failure) and is an immutable snapshot. Adding a
    //    closed-vocabulary diagnostic cannot invalidate a valid document.
    const finalDocument = deepFreeze({
      ...candidate,
      scope: { ...candidate.scope },
      contextDigests: { ...candidate.contextDigests },
      events: candidate.events.map((event) => ({ ...event })) as AgentTraceEvent[],
      terminal: { ...candidate.terminal, usage: { ...candidate.terminal.usage } },
      warnings: [...candidate.warnings],
      recorderDiagnostics: [...this.diagnostics].sort(),
    });
    this.finalized = finalDocument;
    return finalDocument;
  }
}
