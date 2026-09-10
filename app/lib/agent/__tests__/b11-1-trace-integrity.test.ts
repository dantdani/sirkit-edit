/**
 * B11.1 — trace-integrity, hostile-sink isolation, recorder normalization,
 * and exact replay-capsule validation. Permanent regressions for R1, R2,
 * R3 and R5 plus the required coverage areas.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  containsSecretShapedText, TRACE_BOUNDS, TRACE_RECORDER_DIAGNOSTICS,
  validateAgentRunTrace, type AgentRunTrace, type AgentTraceEvent,
} from "../trace";
import {
  AgentTraceRecorder, InMemoryTraceSink, createAgentTraceSink,
  setAgentTraceSinkFactory, type AgentTraceSink,
} from "../trace-recorder";
import {
  AGENT_REPLAY_CAPSULE_SCHEMA, replayCapsule, ReplayCapsuleInvalidError,
  validateReplayCapsule, REPLAY_CAPSULE_BOUNDS, type ReplayCapsule,
} from "../replay-capsule";
import { buildEvaluationCases } from "../evaluation-cases";
import { AGENT_SYSTEM_PROMPT, AGENT_SYSTEM_PROMPT_VERSION } from "../../prompts";
import { engineeringDigest } from "../../engineering/stable";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";
import { AGENT_EXPOSABLE_OPERATION_CLASSES, INTENTIONAL_AGENT_EXPOSED_TOOL_IDS } from "@/app/lib/engineering/agent-exposure"; // [B17-F] the ONE reviewed exposure set — never a hard-coded count

const SCOPE = { tenantId: "local", projectId: "p111", branchId: "main" };
const pins = (JSON.parse(readFileSync(join(process.cwd(), "artifacts", "ai-control-plane-b11", "replay-trace-pins.json"), "utf8")) as { pins: Record<string, string> }).pins;

function makeRecorder(sink: AgentTraceSink = new InMemoryTraceSink(), clock?: () => number): AgentTraceRecorder {
  let tick = 0;
  return new AgentTraceRecorder({
    runId: "run-1", traceId: "trace-1", provider: "openai",
    promptVersion: AGENT_SYSTEM_PROMPT_VERSION, promptDigest: "eng1-prompt", registryDigest: "eng1-registry",
    scope: SCOPE,
    contextDigests: { canonicalRevisionDigest: null, schematicDigest: null, selectionDigest: null, netlistDigest: null, resourceManifestDigest: null },
  }, sink, clock ?? (() => { tick += 1; return tick; }));
}

function completedTrace(): AgentRunTrace {
  const recorder = makeRecorder();
  recorder.recordRunStarted();
  recorder.recordStep({ model: "m", usage: { inputTokens: 5, outputTokens: 7 }, toolCallCount: 0 });
  return recorder.finalize({ outcome: "completed", failureReason: null });
}

// ─── §A — complete trace validation (R1) ────────────────────────────────────

describe("B11.1 §A — complete trace validation (R1)", () => {
  it("R1: every terminal/timestamp/totals forgery is REFUSED", () => {
    const base = completedTrace();
    expect(validateAgentRunTrace(base)).toEqual([]);
    const forgeries: Array<[string, unknown]> = [
      ["endedAt < startedAt", { ...base, startedAt: 100, endedAt: 1 }],
      ["nonfinite startedAt", { ...base, startedAt: Number.NaN }],
      ["terminal outcome != terminal event", { ...base, terminal: { ...base.terminal, outcome: "failed", failureReason: "deadline" } }],
      ["invalid top-level failureReason", { ...base, terminal: { ...base.terminal, failureReason: "because-i-said-so" } }],
      ["completed with a failure reason", { ...base, terminal: { ...base.terminal, failureReason: "deadline" } }],
      ["negative steps", { ...base, terminal: { ...base.terminal, steps: -5 } }],
      ["negative toolCalls", { ...base, terminal: { ...base.terminal, toolCalls: -3 } }],
      ["string usage", { ...base, terminal: { ...base.terminal, usage: { inputTokens: "many", outputTokens: -2 } } }],
      ["extra keys in usage", { ...base, terminal: { ...base.terminal, usage: { ...base.terminal.usage, secretTokens: 1 } } }],
      ["usage != summed steps", { ...base, terminal: { ...base.terminal, usage: { inputTokens: 999, outputTokens: 7 } } }],
      ["totals disagree with the ledger", { ...base, terminal: { ...base.terminal, steps: 99, toolCalls: 42 } }],
      ["model != last step model", { ...base, model: "some-other-model" }],
      ["fractional steps", { ...base, terminal: { ...base.terminal, steps: 1.5 } }],
      ["duplicate diagnostics", { ...base, recorderDiagnostics: ["trace_sink_failure", "trace_sink_failure"] }],
    ];
    for (const [label, candidate] of forgeries) {
      expect(validateAgentRunTrace(candidate).length, label).toBeGreaterThan(0);
    }
  });

  it("R1: a missing run_started, a duplicate run_started, and a non-final terminal all REFUSE", () => {
    const base = completedTrace();
    const withoutStart = { ...base, events: base.events.filter((event) => event.kind !== "run_started").map((event, index) => ({ ...event, seq: index + 1 })) };
    expect(validateAgentRunTrace(withoutStart).some((issue) => issue.includes("exactly one run_started"))).toBe(true);

    const duplicateStart = {
      ...base,
      events: [base.events[0]!, { seq: 2, kind: "run_started" }, ...base.events.slice(1).map((event, index) => ({ ...event, seq: index + 3 }))],
    };
    expect(validateAgentRunTrace(duplicateStart).length).toBeGreaterThan(0);

    const terminalNotLast = {
      ...base,
      events: [...base.events, { seq: 99, kind: "step", model: "m", inputTokens: 0, outputTokens: 0, toolCallCount: 0 }],
    };
    expect(validateAgentRunTrace(terminalNotLast).length).toBeGreaterThan(0);
  });

  it("cancelled must carry the normalized reason; failed must carry a closed-vocabulary reason", () => {
    const recorder = makeRecorder();
    recorder.recordRunStarted();
    const cancelled = recorder.finalize({ outcome: "cancelled", failureReason: "cancelled" });
    expect(validateAgentRunTrace(cancelled)).toEqual([]);
    expect(validateAgentRunTrace({ ...cancelled, terminal: { ...cancelled.terminal, failureReason: "deadline" } }).length).toBeGreaterThan(0);

    const failedRecorder = makeRecorder();
    failedRecorder.recordRunStarted();
    const failed = failedRecorder.finalize({ outcome: "failed", failureReason: "provider_rate_limit" });
    expect(validateAgentRunTrace(failed)).toEqual([]);
    expect(validateAgentRunTrace({ ...failed, terminal: { ...failed.terminal, failureReason: null } }).length).toBeGreaterThan(0);
  });

  it("PROTOTYPE-supplied fields are refused: a required value reachable only through the prototype chain is MISSING", () => {
    // Object.keys and JSON.stringify see only OWN properties, so a
    // prototype-supplied field would evade both the exact-key check and
    // the secret denylist while still being readable by consumers.
    const base = completedTrace();
    const { runId, ...rest } = base as unknown as Record<string, unknown>;
    void runId;
    const prototyped = Object.assign(Object.create({ runId: "Bearer sk-ant-api03-TRACELEAK" }), rest);
    const issues = validateAgentRunTrace(prototyped);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((issue) => issue.includes("plain object") || issue.includes("trace.runId: missing"))).toBe(true);
    expect(JSON.stringify(issues)).not.toContain("TRACELEAK");
    // Symbol keys and non-enumerable own properties are equally refused.
    const symbolKeyed = { ...completedTrace(), [Symbol.for("apiKey")]: "sk-ant-api03-SYMBOL" };
    expect(validateAgentRunTrace(symbolKeyed).length).toBeGreaterThan(0);
    const hidden = { ...completedTrace() };
    Object.defineProperty(hidden, "rawProviderBody", { enumerable: false, value: { choices: [] } });
    expect(validateAgentRunTrace(hidden).length).toBeGreaterThan(0);
  });

  it("SEQ must be contiguous: an event deleted from the ledger (with totals adjusted) is REFUSED", () => {
    const base = completedTrace();
    // The honest recorder always assigns seq = 1..N with no gaps, so a gap
    // means an event was excised. Totals adjusted to stay self-consistent.
    const scrubbed = {
      ...base,
      events: [base.events[0]!, { ...base.events[base.events.length - 1]!, seq: 3 }],
      model: "",
      terminal: { ...base.terminal, steps: 0, usage: { inputTokens: 0, outputTokens: 0 } },
    };
    expect(validateAgentRunTrace(scrubbed).some((issue) => issue.includes("contiguous"))).toBe(true);
  });

  it("ACCESSOR properties are refused: a getter cannot pass validation and then yield different content", () => {
    const base = completedTrace();
    const toctou: Record<string, unknown> = { ...base };
    let reads = 0;
    Object.defineProperty(toctou, "runId", {
      enumerable: true, configurable: true,
      get() { reads += 1; return reads > 2 ? "Bearer sk-ant-api03-TOCTOU" : "run-1"; },
    });
    const issues = validateAgentRunTrace(toctou);
    expect(issues.some((issue) => issue.includes("data property"))).toBe(true);
    expect(JSON.stringify(issues)).not.toContain("TOCTOU");
  });

  it("a secret embedded in a KEY NAME is redacted in the diagnostics, never echoed", () => {
    const base = completedTrace();
    const keyLeak = { ...base, ["x-api-key=sk-ant-api03-REPORTLEAK9999"]: 1 };
    const issues = validateAgentRunTrace(keyLeak);
    expect(issues.length).toBeGreaterThan(0);
    expect(JSON.stringify(issues)).not.toContain("REPORTLEAK");
    // [B11.5 §B] a credential-shaped key NAME collapses to a stable
    // classification — no fragment of it survives into a diagnostic.
    expect(JSON.stringify(issues)).toContain("[redacted-key]");
    expect(JSON.stringify(issues)).not.toContain("x-api-key");
  });

  it("validator output is BOUNDED — a hostile document cannot flood diagnostics", () => {
    const hostile = {
      ...completedTrace(),
      events: Array.from({ length: 60 }, (_ignored, index) => ({ seq: index + 1, kind: "nonsense", junk: index })),
    };
    const issues = validateAgentRunTrace(hostile);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.length).toBeLessThanOrEqual(TRACE_BOUNDS.maxValidationIssues);
  });
});

// ─── §B — hostile-sink isolation (R2) ───────────────────────────────────────

describe("B11.1 §B — hostile-sink isolation (R2)", () => {
  class MutatingSink implements AgentTraceSink {
    appendCalls = 0;
    completeCalls = 0;
    append(event: AgentTraceEvent): void {
      this.appendCalls += 1;
      try { (event as { kind: string }).kind = "hijacked"; (event as { seq: number }).seq = -1; } catch { /* frozen */ }
    }
    complete(trace: AgentRunTrace): void {
      this.completeCalls += 1;
      try {
        (trace as { provider: string }).provider = "anthropic";
        (trace.scope as { projectId: string }).projectId = "attacker";
        (trace.terminal as { steps: number }).steps = 999;
        trace.events.length = 0;
        trace.recorderDiagnostics.push("trace_sink_failure");
      } catch { /* frozen */ }
    }
  }

  it("R2: an append-mutating and complete-mutating sink cannot change internal events, identity, totals, or diagnostics", () => {
    const sink = new MutatingSink();
    const recorder = makeRecorder(sink);
    recorder.recordRunStarted();
    recorder.recordStep({ model: "m", usage: { inputTokens: 3, outputTokens: 4 }, toolCallCount: 0 });
    const trace = recorder.finalize({ outcome: "completed", failureReason: null });
    expect(sink.appendCalls).toBeGreaterThan(0);
    expect(sink.completeCalls).toBe(1);
    // Identity, ledger, and events survive untouched.
    expect(trace.provider).toBe("openai");
    expect(trace.scope.projectId).toBe("p111");
    expect(trace.terminal.steps).toBe(1);
    expect(trace.events.map((event) => event.kind)).toEqual(["run_started", "step", "terminal"]);
    expect(trace.recorderDiagnostics).toEqual([]);
    expect(validateAgentRunTrace(trace)).toEqual([]);
  });

  it("recorder-owned events and returned documents are immutable snapshots; repeated finalize returns equivalent content", () => {
    const recorder = makeRecorder();
    recorder.recordRunStarted();
    recorder.recordStep({ model: "m", usage: { inputTokens: 1, outputTokens: 1 }, toolCallCount: 0 });
    const first = recorder.finalize({ outcome: "completed", failureReason: null });
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.events)).toBe(true);
    expect(Object.isFrozen(first.terminal)).toBe(true);
    expect(() => { (first as { provider: string }).provider = "anthropic"; }).toThrow();
    const second = recorder.finalize({ outcome: "failed", failureReason: "deadline" });
    expect(second).toEqual(first); // idempotent, equivalent immutable content
  });

  it("a RE-ENTRANT sink cannot inject, truncate, or recursively finalize the ledger", () => {
    // A sink that calls recordTerminal() from inside append() would
    // otherwise terminate the trace early and silently drop later events.
    const injectingSink: AgentTraceSink = {
      append(): void { injector.recordTerminal("failed", "deadline"); },
      complete(): void { /* ok */ },
    };
    const injector = makeRecorder(injectingSink);
    injector.recordRunStarted();
    injector.recordStep({ model: "m", usage: { inputTokens: 1, outputTokens: 1 }, toolCallCount: 0 });
    const injected = injector.finalize({ outcome: "completed", failureReason: null });
    expect(injected.events.map((event) => event.kind)).toEqual(["run_started", "step", "terminal"]);
    expect(injected.terminal).toMatchObject({ outcome: "completed", failureReason: null, steps: 1 });
    expect(injected.recorderDiagnostics).toContain("trace_reentrant_call_refused");
    expect(validateAgentRunTrace(injected)).toEqual([]);

    // A sink that calls finalize() from inside complete() must not recurse.
    const recursingSink: AgentTraceSink = {
      append(): void { /* ok */ },
      complete(): void { recurser.finalize({ outcome: "completed", failureReason: null }); },
    };
    const recurser = makeRecorder(recursingSink);
    recurser.recordRunStarted();
    const recursed = recurser.finalize({ outcome: "completed", failureReason: null });
    expect(recursed.recorderDiagnostics).toContain("trace_reentrant_call_refused");
    expect(recursed.events.filter((event) => event.kind === "terminal")).toHaveLength(1);
    expect(validateAgentRunTrace(recursed)).toEqual([]);
  });

  it("InMemoryTraceSink stores SNAPSHOTS, not caller-owned references", () => {
    const sink = new InMemoryTraceSink();
    const event = { seq: 1, kind: "run_started" } as AgentTraceEvent;
    sink.append(event);
    (event as { kind: string }).kind = "mutated-after-append";
    expect(sink.appended[0]!.kind).toBe("run_started");
  });
});

// ─── §C — complete failure classification (R3) ──────────────────────────────

describe("B11.1 §C — sink/clock/digest failure classification (R3)", () => {
  it("R3: an append-only failure, a complete-only failure, and a factory failure are each classified", () => {
    class AppendOnlyFailing implements AgentTraceSink {
      append(): void { throw new Error("append failed"); }
      complete(): void { /* ok */ }
    }
    class CompleteOnlyFailing implements AgentTraceSink {
      appended = 0;
      append(): void { this.appended += 1; }
      complete(): void { throw new Error("complete failed"); }
    }
    const appendFailing = makeRecorder(new AppendOnlyFailing());
    appendFailing.recordRunStarted();
    expect(appendFailing.finalize({ outcome: "completed", failureReason: null }).recorderDiagnostics).toContain("trace_sink_failure");

    const completeSink = new CompleteOnlyFailing();
    const completeFailing = makeRecorder(completeSink);
    completeFailing.recordRunStarted();
    const trace = completeFailing.finalize({ outcome: "completed", failureReason: null });
    expect(completeSink.appended).toBeGreaterThan(0);
    // THE R3 DEFECT: this used to be an empty diagnostics array.
    expect(trace.recorderDiagnostics).toContain("trace_sink_failure");
    expect(validateAgentRunTrace(trace)).toEqual([]);

    // Factory failure: createAgentTraceSink never throws and reports it.
    setAgentTraceSinkFactory(() => { throw new Error("factory failed"); });
    try {
      const created = createAgentTraceSink();
      expect(created.factoryFailed).toBe(true);
      expect(typeof created.sink.append).toBe("function");
      const recorder = new AgentTraceRecorder({
        runId: "run-f", traceId: "trace-f", provider: "openai",
        promptVersion: AGENT_SYSTEM_PROMPT_VERSION, promptDigest: "eng1-p", registryDigest: "eng1-r",
        scope: SCOPE,
        contextDigests: { canonicalRevisionDigest: null, schematicDigest: null, selectionDigest: null, netlistDigest: null, resourceManifestDigest: null },
      }, created.sink, () => 1, { initialDiagnostics: ["trace_sink_factory_failure"] });
      recorder.recordRunStarted();
      const factoryTrace = recorder.finalize({ outcome: "completed", failureReason: null });
      expect(factoryTrace.recorderDiagnostics).toContain("trace_sink_factory_failure");
      expect(validateAgentRunTrace(factoryTrace)).toEqual([]);
    } finally {
      setAgentTraceSinkFactory(null);
    }
  });

  it("an ASYNC sink cannot leak an unhandled rejection: the contract violation is classified synchronously", async () => {
    class AsyncSink implements AgentTraceSink {
      // `async` type-checks against the sync interface (void-return
      // bivariance) but its rejection would otherwise escape unhandled.
      async append(): Promise<void> { throw new Error("async append failed"); }
      async complete(): Promise<void> { throw new Error("async complete failed"); }
    }
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown): void => { rejections.push(reason); };
    process.on("unhandledRejection", onRejection);
    try {
      const recorder = makeRecorder(new AsyncSink());
      recorder.recordRunStarted();
      const trace = recorder.finalize({ outcome: "completed", failureReason: null });
      expect(trace.recorderDiagnostics).toContain("trace_sink_contract_violation");
      expect(validateAgentRunTrace(trace)).toEqual([]);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onRejection);
    }
  });

  it("every classified diagnostic belongs to the closed vocabulary and no raw failure detail leaks", () => {
    class NastySink implements AgentTraceSink {
      append(): void { throw new Error("sk-live-AAAABBBBCCCCDDDD leaked in the sink error"); }
      complete(): void { throw new Error("Authorization: Bearer abcdefghijklmnop"); }
    }
    const recorder = makeRecorder(new NastySink());
    recorder.recordRunStarted();
    const trace = recorder.finalize({ outcome: "completed", failureReason: null });
    for (const diagnostic of trace.recorderDiagnostics) {
      expect(TRACE_RECORDER_DIAGNOSTICS as readonly string[]).toContain(diagnostic);
    }
    expect(JSON.stringify(trace)).not.toContain("sk-live");
    expect(JSON.stringify(trace)).not.toContain("Bearer");
    expect(validateAgentRunTrace(trace)).toEqual([]);
  });

  it("D: an INVALID trace is never handed to sink.complete — it is classified instead", () => {
    class CountingSink implements AgentTraceSink {
      completed: AgentRunTrace[] = [];
      append(): void { /* ok */ }
      complete(trace: AgentRunTrace): void { this.completed.push(trace); }
    }
    const sink = new CountingSink();
    // A recorder with NO run_started produces an invalid document.
    const recorder = makeRecorder(sink);
    recorder.recordStep({ model: "m", usage: { inputTokens: 1, outputTokens: 1 }, toolCallCount: 0 });
    const trace = recorder.finalize({ outcome: "completed", failureReason: null });
    expect(validateAgentRunTrace(trace).length).toBeGreaterThan(0); // genuinely invalid
    expect(sink.completed).toHaveLength(0); // never persisted
    expect(trace.recorderDiagnostics).toContain("trace_validation_failure");
  });
});

// ─── §F — recorder input normalization ──────────────────────────────────────

describe("B11.1 §F — recorder input normalization", () => {
  it("cyclic arguments/output are digested as a sentinel and classified; the recorder never throws", () => {
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic.self = cyclic;
    const recorder = makeRecorder();
    recorder.recordRunStarted();
    expect(() => {
      recorder.recordTool({
        callId: "c1", toolId: "sirkit.pcb.board-inspect", version: "1.0.0", operationClass: "read",
        args: cyclic, outcomeClass: "read", status: "succeeded", output: cyclic,
      });
    }).not.toThrow();
    const trace = recorder.finalize({ outcome: "completed", failureReason: null });
    expect(trace.recorderDiagnostics).toContain("trace_digest_failure");
    expect(validateAgentRunTrace(trace)).toEqual([]);
  });

  it("invalid usage values, oversized identifiers, and secret-shaped fields normalize into a VALID trace", () => {
    const recorder = makeRecorder();
    recorder.recordRunStarted();
    recorder.recordStep({ model: "x".repeat(500), usage: { inputTokens: -5, outputTokens: Number.NaN }, toolCallCount: -1 });
    recorder.recordStep({ model: "m", usage: { inputTokens: 2.7, outputTokens: Number.POSITIVE_INFINITY }, toolCallCount: 1 });
    recorder.recordTool({
      callId: "sk-live-AAAABBBBCCCCDDDD", toolId: "x".repeat(400), version: "1.0.0",
      operationClass: "read", args: {}, outcomeClass: "read", status: "y".repeat(400),
      verification: "", output: null, proposal: null,
    });
    const trace = recorder.finalize({ outcome: "completed", failureReason: null });
    expect(validateAgentRunTrace(trace)).toEqual([]);
    expect(trace.recorderDiagnostics).toContain("trace_input_normalized");
    expect(JSON.stringify(trace)).not.toContain("sk-live");
    expect(trace.terminal.usage.inputTokens).toBe(2); // -5→0, 2.7→2
    expect(trace.terminal.usage.outputTokens).toBe(0); // NaN→0, Infinity→0
    expect(trace.model).toBe("m");
  });

  it("a throwing, nonfinite, or backwards clock is classified and cannot invalidate the timeline", () => {
    const throwing = makeRecorder(new InMemoryTraceSink(), () => { throw new Error("clock exploded"); });
    throwing.recordRunStarted();
    const throwingTrace = throwing.finalize({ outcome: "completed", failureReason: null });
    expect(throwingTrace.recorderDiagnostics).toContain("trace_clock_failure");
    expect(validateAgentRunTrace(throwingTrace)).toEqual([]);

    const values = [50, 10, Number.NaN, 80];
    let index = 0;
    const erratic = makeRecorder(new InMemoryTraceSink(), () => values[Math.min(index++, values.length - 1)]!);
    erratic.recordRunStarted();
    const erraticTrace = erratic.finalize({ outcome: "completed", failureReason: null });
    expect(erraticTrace.endedAt).toBeGreaterThanOrEqual(erraticTrace.startedAt);
    expect(erraticTrace.recorderDiagnostics).toContain("trace_clock_failure");
    expect(validateAgentRunTrace(erraticTrace)).toEqual([]);
  });

  it("an invalid terminal reason normalizes into the closed vocabulary", () => {
    const recorder = makeRecorder();
    recorder.recordRunStarted();
    recorder.recordTerminal("failed", "totally-made-up-reason");
    const trace = recorder.finalize({ outcome: "failed", failureReason: "totally-made-up-reason" });
    expect(trace.terminal.failureReason).toBe("internal_error");
    expect(validateAgentRunTrace(trace)).toEqual([]);
  });
});

// ─── §G — exact replay-capsule validation (R5) ──────────────────────────────

describe("B11.1 §G — exact replay-capsule validation (R5)", () => {
  const validCapsule = (): ReplayCapsule => buildEvaluationCases(pins).find((item) => item.caseId === "e01-no-canonical-state")!.capsule;

  function baseCapsule(extra: Record<string, unknown>): unknown {
    return { ...validCapsule(), ...extra };
  }

  it("R5: every forbidden field is refused BY NAME before any execution", async () => {
    const forbidden: Array<[string, unknown]> = [
      ["opaqueProviderContinuation", { reasoning: [{ encrypted_content: "AAAA" }] }],
      ["rawProviderBody", { choices: [] }],
      ["thinking", "hidden chain of thought"],
      ["reasoning", ["step one"]],
      ["authorization", "Bearer token-value-here"],
      ["apiKey", "abcdefghijklmnop"],
      ["client", {}],
      ["continuation", { state: {} }],
      ["unknownExtra", 1],
    ];
    for (const [key, value] of forbidden) {
      const capsule = baseCapsule({ [key]: value });
      const issues = validateReplayCapsule(capsule);
      expect(issues.length, key).toBeGreaterThan(0);
      await expect(replayCapsule(capsule as ReplayCapsule, { computeOnly: true })).rejects.toThrow(/REPLAY_CAPSULE_INVALID/);
    }
  });

  it("R5: forbidden field names nested inside context fixtures are refused", async () => {
    const capsule = validCapsule();
    // [B11.2] the refusal now comes from the VERSIONED replay context (the
    // key is unknown to `PcbBoard`) and/or the recursive credential scan.
    // The proven property is unchanged and strictly stronger: the fixture is
    // refused before execution and the offending path is named, redacted.
    const nested = { ...capsule, context: { ...capsule.context, board: { formatVersion: 1, rawResponse: { body: "…" } } } };
    const issues = validateReplayCapsule(nested);
    expect(issues.length).toBeGreaterThan(0);
    // [B11.5 §B] `rawResponse` is a provider-body key NAME, so it is no longer
    // echoed — the refusal names the redacted segment instead. The proven
    // property is strictly stronger: refused AND not leaked.
    expect(issues.some((issue) => issue.includes("[redacted-key]"))).toBe(true);
    expect(JSON.stringify(issues)).not.toContain("rawResponse");
    await expect(replayCapsule(nested as unknown as ReplayCapsule, { computeOnly: true })).rejects.toThrow(ReplayCapsuleInvalidError);
  });

  it("secret-shaped capsule content is refused, and the refusal never echoes the secret", async () => {
    const capsule = validCapsule();
    const secretBearing = { ...capsule, userMessage: "use key sk-live-AAAABBBBCCCCDDDD please" };
    const issues = validateReplayCapsule(secretBearing);
    expect(issues.some((issue) => issue.includes("secret-shaped"))).toBe(true);
    expect(JSON.stringify(issues)).not.toContain("sk-live");
    try {
      await replayCapsule(secretBearing, { computeOnly: true });
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(ReplayCapsuleInvalidError);
      expect((error as ReplayCapsuleInvalidError).code).toBe("REPLAY_CAPSULE_INVALID");
      expect((error as Error).message).not.toContain("sk-live");
    }
  });

  it("PROTOTYPE-supplied capsule fields are refused BEFORE execution, and secret-bearing KEY NAMES are redacted", async () => {
    const capsule = validCapsule();
    const { userMessage, ...rest } = capsule as unknown as Record<string, unknown>;
    void userMessage;
    // The secret lives on the PROTOTYPE: invisible to Object.keys and to
    // JSON.stringify, but readable by the replay engine.
    const prototyped = Object.assign(Object.create({ userMessage: "Bearer sk-ant-api03-AAAABBBBCCCCDDDD" }), rest);
    const protoIssues = validateReplayCapsule(prototyped);
    expect(protoIssues.length).toBeGreaterThan(0);
    expect(protoIssues.some((issue) => issue.includes("plain object") || issue.includes("userMessage: missing"))).toBe(true);
    expect(JSON.stringify(protoIssues)).not.toContain("sk-ant");
    await expect(replayCapsule(prototyped as ReplayCapsule, { computeOnly: true })).rejects.toThrow(ReplayCapsuleInvalidError);

    // The degenerate form (ZERO own keys) is refused too.
    const emptyOwn = Object.create(capsule) as ReplayCapsule;
    expect(validateReplayCapsule(emptyOwn).length).toBeGreaterThan(0);
    await expect(replayCapsule(emptyOwn, { computeOnly: true })).rejects.toThrow(ReplayCapsuleInvalidError);

    // Forbidden names hidden on a FIXTURE prototype or as non-enumerable
    // own properties are refused as well.
    const hiddenProto = { ...capsule, context: { ...capsule.context, board: Object.assign(Object.create({ rawProviderBody: { choices: [] }, apiKey: "sk-ant-api03-HIDDEN" }), { formatVersion: 1 }) } };
    expect(validateReplayCapsule(hiddenProto as unknown as ReplayCapsule).length).toBeGreaterThan(0);
    const boardHidden: Record<string, unknown> = { formatVersion: 1 };
    Object.defineProperty(boardHidden, "rawProviderBody", { enumerable: false, value: { choices: [] } });
    const hiddenNonEnumerable = { ...capsule, context: { ...capsule.context, board: boardHidden } };
    expect(validateReplayCapsule(hiddenNonEnumerable as unknown as ReplayCapsule).length).toBeGreaterThan(0);

    const keyLeak = { ...capsule, ["x-api-key=sk-ant-api03-REPORTLEAK9999"]: 1 };
    const issues = validateReplayCapsule(keyLeak);
    expect(issues.length).toBeGreaterThan(0);
    expect(JSON.stringify(issues)).not.toContain("REPORTLEAK");
    // [B11.5 §B] a credential-shaped key NAME collapses to a stable
    // classification — no fragment of it survives into a diagnostic.
    expect(JSON.stringify(issues)).toContain("[redacted-key]");
    expect(JSON.stringify(issues)).not.toContain("x-api-key");
  });

  it("bounds are enforced: oversized steps, tool calls, argument text, and messages refuse", () => {
    const capsule = validCapsule();
    const oversizedSteps = { ...capsule, steps: Array.from({ length: REPLAY_CAPSULE_BOUNDS.maxSteps + 1 }, () => capsule.steps[0]!) };
    expect(validateReplayCapsule(oversizedSteps).length).toBeGreaterThan(0);
    const oversizedArgs = {
      ...capsule,
      steps: [{ ...capsule.steps[0]!, toolCalls: [{ callId: "c", providerName: "p", argumentsText: "x".repeat(REPLAY_CAPSULE_BOUNDS.maxArgumentChars + 1) }] }],
    };
    expect(validateReplayCapsule(oversizedArgs).length).toBeGreaterThan(0);
    const oversizedMessage = { ...capsule, userMessage: "x".repeat(REPLAY_CAPSULE_BOUNDS.maxMessageChars + 1) };
    expect(validateReplayCapsule(oversizedMessage).length).toBeGreaterThan(0);
    const badUsage = { ...capsule, steps: [{ ...capsule.steps[0]!, usage: { inputTokens: -1, outputTokens: 0 } }] };
    expect(validateReplayCapsule(badUsage).length).toBeGreaterThan(0);
  });

  it("NEAR-MISS forbidden names are refused (case and separators folded), and JSON-quoted credentials are detected", () => {
    const capsule = validCapsule();
    for (const name of ["apikey", "Authorization", "reasoningContent", "continuationState", "providerRawBody", "openaiClient", "API_KEY", "x-Api-Key"]) {
      const board: Record<string, unknown> = { formatVersion: 1, [name]: "payload" };
      const hostile = { ...capsule, context: { ...capsule.context, board } };
      expect(validateReplayCapsule(hostile as unknown as ReplayCapsule).length, name).toBeGreaterThan(0);
    }
    // JSON-quoted credential fields are secret-shaped; legitimate digests
    // and tool ids are NOT (no false positives).
    for (const probe of ['{"apiKey":"AKIAIOSFODNN7EXAMPLE"}', '{"api_key":"abcdefghijkl"}', '{"authorization":"Basic QWxhZGRpbjpvcGVu"}', '{"password":"hunter2hunter2"}']) {
      expect(containsSecretShapedText(probe), probe).toBe(true);
    }
    for (const probe of ['{"toolId":"sirkit.pcb.board-inspect"}', '{"argsDigest":"eng1-0cbbe78e7b980149"}', '{"verification":"canonical-revision-verified"}']) {
      expect(containsSecretShapedText(probe), probe).toBe(false);
    }
  });

  it("an invalid capsule executes NOTHING: no context assembly, discovery, gateway, loop, or tool call", async () => {
    const capsule = validCapsule();
    const hostile = { ...capsule, thinking: "hidden" };
    // A sink that would observe any recorder activity at all.
    let sinkTouched = false;
    setAgentTraceSinkFactory(() => {
      sinkTouched = true;
      return new InMemoryTraceSink();
    });
    try {
      await expect(replayCapsule(hostile as ReplayCapsule, { computeOnly: true })).rejects.toThrow(ReplayCapsuleInvalidError);
      expect(sinkTouched).toBe(false);
    } finally {
      setAgentTraceSinkFactory(null);
    }
  });

  it("the VALID committed capsules still validate and replay to their pinned digests", async () => {
    for (const evaluationCase of buildEvaluationCases(pins).slice(0, 5)) {
      expect(validateReplayCapsule(evaluationCase.capsule), evaluationCase.caseId).toEqual([]);
      const outcome = await replayCapsule(evaluationCase.capsule, evaluationCase.options);
      expect(outcome.traceDigest, evaluationCase.caseId).toBe(pins[evaluationCase.caseId]);
    }
  });
});

// ─── §H — exposure invariants ───────────────────────────────────────────────

describe("B11.1 §H — exposure invariants unchanged", () => {
  it("static exposure is exactly ELEVEN ids; no mutation, release, MCP, or multi-agent surface", () => {
    const exposed = sirkitToolRegistry().list().filter((descriptor) => descriptor.agentExposed);
    expect(new Set(exposed.map((descriptor) => descriptor.toolId)).size).toBe(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length); // B15.3: + sirkit.pcb.propose-bounded-edit
    for (const descriptor of exposed) expect(AGENT_EXPOSABLE_OPERATION_CLASSES).toContain(descriptor.operationClass);
    for (const file of ["trace.ts", "trace-recorder.ts", "replay-capsule.ts", "evaluation.ts", "evaluation-cases.ts"]) {
      const source = readFileSync(join(process.cwd(), "app/lib/agent", file), "utf8");
      expect(source, file).not.toMatch(/modelcontextprotocol|mcpServer|spawnAgent|multiAgent/i);
    }
  });

  it("the capsule contract and prompt/registry pins are unchanged by B11.1", () => {
    const capsule = buildEvaluationCases(pins)[0]!.capsule;
    expect(capsule.schema).toBe(AGENT_REPLAY_CAPSULE_SCHEMA);
    expect(capsule.promptDigest).toBe(engineeringDigest({ schema: "sirkit.agent-prompt.v1", prompt: AGENT_SYSTEM_PROMPT }));
    expect(capsule.registryDigest).toBe(sirkitToolRegistry().digest());
  });
});
