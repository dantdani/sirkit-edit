/**
 * B11 — run-trace, deterministic-replay, and evaluation CI gates.
 * Everything runs provider-free through the real control plane.
 */

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AGENT_RUN_TRACE_SCHEMA, agentRunTraceDigest, containsSecretShapedText,
  sanitizeTraceText, TRACE_BOUNDS, validateAgentRunTrace, type AgentRunTrace,
} from "../trace";
import { AgentTraceRecorder, InMemoryTraceSink } from "../trace-recorder";
import { replayCapsule } from "../replay-capsule";
import { buildEvaluationCases, ThrowingTraceSink } from "../evaluation-cases";
import { normalizeTraceForParity, runEvaluationSuite } from "../evaluation";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";
import { AGENT_SYSTEM_PROMPT_VERSION } from "../../prompts";

const ARTIFACTS = join(process.cwd(), "artifacts", "ai-control-plane-b11");
const pins = (JSON.parse(readFileSync(join(ARTIFACTS, "replay-trace-pins.json"), "utf8")) as { pins: Record<string, string> }).pins;

function recorder(sink = new InMemoryTraceSink()): { recorder: AgentTraceRecorder; sink: InMemoryTraceSink } {
  let tick = 0;
  return {
    recorder: new AgentTraceRecorder({
      runId: "run-1", traceId: "trace-1", provider: "openai",
      promptVersion: AGENT_SYSTEM_PROMPT_VERSION, promptDigest: "eng1-prompt", registryDigest: "eng1-registry",
      scope: { tenantId: "local", projectId: "p11", branchId: "main" },
      contextDigests: { canonicalRevisionDigest: null, schematicDigest: null, selectionDigest: null, netlistDigest: null, resourceManifestDigest: null },
    }, sink, () => { tick += 1; return tick; }),
    sink,
  };
}

describe("B11 §A — trace schema exactness, bounds, and redaction", () => {
  it("a well-formed trace validates; unknown keys, unknown vocabulary, and unbounded fields refuse", () => {
    const { recorder: rec } = recorder();
    rec.recordRunStarted();
    rec.recordStep({ model: "m", usage: { inputTokens: 1, outputTokens: 2 }, toolCallCount: 0 });
    const trace = rec.finalize({ outcome: "completed", failureReason: null });
    expect(validateAgentRunTrace(trace)).toEqual([]);
    expect(trace.schema).toBe(AGENT_RUN_TRACE_SCHEMA);

    const hostile: Array<[string, unknown]> = [
      ["unknown top-level key", { ...trace, extra: 1 }],
      ["missing key", (() => { const copy = { ...trace } as Record<string, unknown>; delete copy.terminal; return copy; })()],
      ["unknown outcome vocabulary", { ...trace, terminal: { ...trace.terminal, outcome: "partially-done" } }],
      ["unknown failure reason", { ...trace, events: trace.events.map((event) => event.kind === "terminal" ? { ...event, failureReason: "because" } : event) }],
      ["oversized warning", { ...trace, warnings: ["x".repeat(TRACE_BOUNDS.maxWarningChars + 1)] }],
      ["unknown recorder diagnostic", { ...trace, recorderDiagnostics: ["went-wrong"] }],
      ["unknown event kind", { ...trace, events: [{ seq: 1, kind: "raw_provider_body" }] }],
    ];
    for (const [label, candidate] of hostile) {
      expect(validateAgentRunTrace(candidate).length, label).toBeGreaterThan(0);
    }
  });

  it("secret-shaped values are redacted at record time and refused by the denylist", () => {
    const secrets = [
      "leaked sk-live-AAAABBBBCCCCDDDD here",
      "Authorization: Bearer abcdefghijklmnop",
      "api_key=SUPERSECRETVALUE123",
      "sk-ant-api03-QQQQWWWWEEEERRRR",
    ];
    for (const secret of secrets) {
      expect(containsSecretShapedText(secret), secret).toBe(true);
      expect(sanitizeTraceText(secret)).toContain("[redacted]");
      expect(containsSecretShapedText(sanitizeTraceText(secret)), `sanitized: ${secret}`).toBe(false);
    }
    const { recorder: rec } = recorder();
    rec.recordRunStarted();
    rec.recordWarning(secrets[0]!);
    const trace = rec.finalize({ outcome: "completed", failureReason: null });
    expect(trace.warnings[0]).toContain("[redacted]");
    expect(validateAgentRunTrace(trace)).toEqual([]);
    // A trace carrying a raw secret is refused outright.
    expect(validateAgentRunTrace({ ...trace, warnings: [secrets[0]!] }).length).toBeGreaterThan(0);
  });

  it("the recorder never receives provider continuation state, raw bodies, or reasoning: the API is metadata-only", () => {
    // CODE (comments stripped) carries no continuation/reasoning identifier —
    // the record surface takes identities, digests, and classifications only.
    const code = (relative: string): string =>
      readFileSync(join(process.cwd(), relative), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const recorderCode = code("app/lib/agent/trace-recorder.ts");
    for (const identifier of ["ProviderContinuation", "continuation", "encrypted_content", "thinking", "rawBody"]) {
      expect(recorderCode, identifier).not.toContain(identifier);
    }
    expect(code("app/lib/agent/trace.ts")).not.toContain("encrypted_content");
  });
});

describe("B11 §B — recorder ordering, single terminal, and sink-failure policy", () => {
  it("exactly one run_started and one terminal; nothing appends after the terminal", () => {
    const { recorder: rec, sink } = recorder();
    rec.recordRunStarted();
    rec.recordRunStarted(); // duplicate ignored
    rec.recordStep({ model: "m", usage: {}, toolCallCount: 1 });
    rec.recordTerminal("completed", null);
    // Late provider/tool completions after the terminal cannot append.
    rec.recordStep({ model: "late", usage: {}, toolCallCount: 0 });
    rec.recordTool({ callId: "c", toolId: "t", version: "1.0.0", operationClass: "read", args: {}, outcomeClass: "read", status: "succeeded" });
    rec.recordTerminal("failed", "deadline");
    rec.recordWarning("late warning");
    const trace = rec.finalize({ outcome: "completed", failureReason: null });
    expect(trace.events.filter((event) => event.kind === "run_started")).toHaveLength(1);
    expect(trace.events.filter((event) => event.kind === "terminal")).toHaveLength(1);
    expect(trace.events[trace.events.length - 1]!.kind).toBe("terminal");
    expect(trace.recorderDiagnostics).toContain("trace_post_terminal_append_refused");
    expect(sink.appended.filter((event) => event.kind === "terminal")).toHaveLength(1);
    expect(validateAgentRunTrace(trace)).toEqual([]);
  });

  it("a throwing sink is classified, never thrown to the caller, and never produces a second terminal", () => {
    const { recorder: rec } = recorder(new ThrowingTraceSink() as unknown as InMemoryTraceSink);
    expect(() => {
      rec.recordRunStarted();
      rec.recordStep({ model: "m", usage: {}, toolCallCount: 0 });
      rec.recordTerminal("completed", null);
    }).not.toThrow();
    const trace = rec.finalize({ outcome: "completed", failureReason: null });
    expect(trace.recorderDiagnostics).toEqual(["trace_sink_failure"]);
    expect(trace.events.filter((event) => event.kind === "terminal")).toHaveLength(1);
    expect(validateAgentRunTrace(trace)).toEqual([]);
  });

  it("identity is frozen at construction: no record method can re-scope run/provider/project, and concurrent recorders never mix", () => {
    const first = recorder().recorder;
    const second = new AgentTraceRecorder({
      runId: "run-2", traceId: "trace-2", provider: "anthropic",
      promptVersion: AGENT_SYSTEM_PROMPT_VERSION, promptDigest: "eng1-prompt", registryDigest: "eng1-registry",
      scope: { tenantId: "local", projectId: "other", branchId: "main" },
      contextDigests: { canonicalRevisionDigest: null, schematicDigest: null, selectionDigest: null, netlistDigest: null, resourceManifestDigest: null },
    }, new InMemoryTraceSink(), () => 1);
    first.recordRunStarted(); second.recordRunStarted();
    first.recordStep({ model: "a", usage: {}, toolCallCount: 0 });
    second.recordStep({ model: "b", usage: {}, toolCallCount: 0 });
    const traceA = first.finalize({ outcome: "completed", failureReason: null });
    const traceB = second.finalize({ outcome: "completed", failureReason: null });
    expect(traceA.runId).toBe("run-1");
    expect(traceA.provider).toBe("openai");
    expect(traceA.scope.projectId).toBe("p11");
    expect(traceB.runId).toBe("run-2");
    expect(traceB.provider).toBe("anthropic");
    expect(traceB.scope.projectId).toBe("other");
    expect(traceA.events.some((event) => event.kind === "step" && event.model === "b")).toBe(false);
  });

  it("totals come from the recorder's OWN ledger — a caller cannot inject divergent counts", () => {
    const { recorder: rec } = recorder();
    rec.recordRunStarted();
    rec.recordStep({ model: "m", usage: { inputTokens: 3, outputTokens: 4 }, toolCallCount: 1 });
    rec.recordTool({ callId: "c1", toolId: "t1", version: "1.0.0", operationClass: "read", args: { a: 1 }, outcomeClass: "read", status: "succeeded", output: { ok: true } });
    const trace = rec.finalize({ outcome: "completed", failureReason: null });
    expect(trace.terminal).toMatchObject({ steps: 1, toolCalls: 1, usage: { inputTokens: 3, outputTokens: 4 } });
  });
});

describe("B11 §C — deterministic replay", () => {
  it("replay is deterministic and byte-stable: identical digests across repeated runs, matching the COMMITTED pins", async () => {
    const cases = buildEvaluationCases(pins);
    for (const evaluationCase of cases.slice(0, 6)) {
      const first = await replayCapsule(evaluationCase.capsule, evaluationCase.options);
      const second = await replayCapsule(evaluationCase.capsule, evaluationCase.options);
      expect(first.traceDigest, evaluationCase.caseId).toBe(second.traceDigest);
      expect(first.traceDigest, `${evaluationCase.caseId} vs committed pin`).toBe(pins[evaluationCase.caseId]);
    }
  });

  it("fixture drift fails EXPLICITLY: prompt, registry, discovery, tool arguments, outcomes, terminal and trace digest", async () => {
    const base = buildEvaluationCases(pins).find((item) => item.caseId === "e03-valid-board")!;
    const drifts: Array<[string, typeof base.capsule]> = [
      ["prompt version", { ...base.capsule, promptVersion: "9.9.9" }],
      ["prompt digest", { ...base.capsule, promptDigest: "eng1-someotherprompt" }],
      ["registry digest", { ...base.capsule, registryDigest: "eng1-driftedregistry" }],
      ["discovered tools", { ...base.capsule, expected: { ...base.capsule.expected, discoveredTools: ["sirkit.pcb.board-inspect"] } }],
      ["tool outcomes", { ...base.capsule, expected: { ...base.capsule.expected, toolOutcomes: [{ toolId: "sirkit.pcb.board-inspect", outcomeClass: "read", status: "refused" }] } }],
      ["terminal", { ...base.capsule, expected: { ...base.capsule.expected, terminal: { outcome: "failed" as const, failureReason: "deadline" } } }],
      ["trace digest", { ...base.capsule, expected: { ...base.capsule.expected, traceDigest: "eng1-nothingliketherealone" } }],
      ["altered tool arguments", { ...base.capsule, steps: base.capsule.steps.map((step) => step.toolCalls.length > 0 ? { ...step, toolCalls: [{ ...step.toolCalls[0]!, argumentsText: JSON.stringify({ injected: true }) }] } : step) }],
    ];
    for (const [label, capsule] of drifts) {
      const outcome = await replayCapsule(capsule);
      expect(outcome.ok, label).toBe(false);
      expect(outcome.failures.length, label).toBeGreaterThan(0);
    }
  });

  it("foreign scope and stale resources change the trace and fail the pinned expectations", async () => {
    const base = buildEvaluationCases(pins).find((item) => item.caseId === "e03-valid-board")!;
    const foreign = await replayCapsule({ ...base.capsule, scope: { tenantId: "local", projectId: "someone-else", branchId: "main" } });
    expect(foreign.ok).toBe(false);
    const stale = await replayCapsule({ ...base.capsule, context: { ...base.capsule.context, board: null } });
    expect(stale.ok).toBe(false);
  });

  it("replay never calls a provider SDK, a database, or the network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch" as never).mockImplementation((() => { throw new Error("NETWORK_CALL_IN_REPLAY"); }) as never);
    try {
      const cases = buildEvaluationCases(pins);
      const report = await runEvaluationSuite(cases);
      expect(report.totals.failed).toBe(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
    // The replay/evaluation modules import no provider SDK.
    for (const file of ["replay-capsule.ts", "evaluation.ts", "evaluation-cases.ts"]) {
      const source = readFileSync(join(process.cwd(), "app/lib/agent", file), "utf8");
      expect(source, file).not.toMatch(/from "(openai|@anthropic-ai\/sdk)"/);
      expect(source, file).not.toContain("adapters");
    }
  });
});

describe("B11 §D — evaluation matrix and provider parity", () => {
  it("every permanent case passes and the committed report matches a fresh deterministic run", async () => {
    const report = await runEvaluationSuite(buildEvaluationCases(pins));
    expect(report.totals.failed).toBe(0);
    expect(report.totals.cases).toBeGreaterThanOrEqual(16);
    const committed = JSON.parse(readFileSync(join(ARTIFACTS, "evaluation-results.json"), "utf8")) as { reportDigest: string; totals: { cases: number } };
    expect(report.reportDigest).toBe(committed.reportDigest);
    expect(report.totals.cases).toBe(committed.totals.cases);
  });

  it("equivalent scripted OpenAI and Anthropic turns produce semantically equivalent normalized traces", async () => {
    const cases = buildEvaluationCases(pins);
    const openai = await replayCapsule(cases.find((item) => item.caseId === "e03-valid-board")!.capsule);
    const anthropic = await replayCapsule(cases.find((item) => item.caseId === "e14-parity-anthropic")!.capsule);
    expect(normalizeTraceForParity(anthropic.trace)).toEqual(normalizeTraceForParity(openai.trace));
    // …while the provider labels themselves stay distinct and truthful.
    expect(openai.trace.provider).toBe("openai");
    expect(anthropic.trace.provider).toBe("anthropic");
    expect(openai.traceDigest).not.toBe(anthropic.traceDigest);
  });

  it("the committed case matrix agrees with the live evaluation run", async () => {
    const csv = readFileSync(join(ARTIFACTS, "evaluation-case-matrix.csv"), "utf8").trim().split("\n");
    const report = await runEvaluationSuite(buildEvaluationCases(pins));
    expect(csv).toHaveLength(report.results.length + 1);
    for (const result of report.results) {
      const row = csv.find((line) => line.startsWith(`${result.caseId},`));
      expect(row, result.caseId).toBeDefined();
      expect(row, result.caseId).toContain(result.terminal.outcome);
    }
  });
});

describe("B11 §E — exposure invariants unchanged", () => {
  it("static exposure is exactly ELEVEN tool ids; no mutation, release, MCP, or multi-agent surface exists", () => {
    const exposed = sirkitToolRegistry().list().filter((descriptor) => descriptor.agentExposed);
    expect(new Set(exposed.map((descriptor) => descriptor.toolId)).size).toBe(12); // B15.3: + sirkit.pcb.propose-bounded-edit
    for (const descriptor of exposed) expect(["read", "propose"]).toContain(descriptor.operationClass);
    // B11 adds observability only — no new tool, no MCP, no orchestration.
    for (const file of ["trace.ts", "trace-recorder.ts", "replay-capsule.ts", "evaluation.ts", "evaluation-cases.ts"]) {
      const source = readFileSync(join(process.cwd(), "app/lib/agent", file), "utf8");
      expect(source, file).not.toMatch(/modelcontextprotocol|mcpServer|spawnAgent|multiAgent/i);
    }
  });

  it("the run trace is metadata-only: no board, schematic, tool output, or user prompt content appears", async () => {
    const cases = buildEvaluationCases(pins);
    const outcome = await replayCapsule(cases.find((item) => item.caseId === "e03-valid-board")!.capsule);
    const serialized = JSON.stringify(outcome.trace);
    expect(serialized).not.toContain("copperTop"); // board content
    expect(serialized).not.toContain("resistor"); // schematic content
    expect(serialized).not.toContain("inspect the project"); // user prompt
    expect(serialized).not.toContain("scripted-model-output");
    const trace: AgentRunTrace = outcome.trace;
    expect(agentRunTraceDigest(trace)).toBe(outcome.traceDigest);
  });
});
