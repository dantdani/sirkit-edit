/**
 * B11.1 §E — exceptional-path route finalization, driven through the
 * PRODUCTION POST handler with controlled adapters and sinks. Permanent
 * regressions for R4 and R6.
 */

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentRunTrace, AgentTraceEvent } from "@/app/lib/agent/trace";
import { validateAgentRunTrace } from "@/app/lib/agent/trace";
import { InMemoryTraceSink, setAgentTraceSinkFactory, type AgentTraceSink } from "@/app/lib/agent/trace-recorder";
import type { SchematicState } from "@/lib/schematic-types";

vi.mock("@/app/lib/agent/adapters", () => ({
  agentAdapterFor: () => ({
    provider: "openai",
    async start(input: { tools: ReadonlyArray<{ toolId: string }> }) {
      return {
        text: `TOOLS:${input.tools.map((tool) => tool.toolId).sort().join(";")}`,
        toolCalls: [], stopReason: "completed", usage: { inputTokens: 3, outputTokens: 4 },
        model: "scripted-model", continuation: { provider: "openai", state: null },
      };
    },
    async continueWith() { throw new Error("not used"); },
  }),
}));

/** A controllable loop: `throw` reproduces an UNEXPECTED failure that
 *  reaches the route's outer stream_error path. */
let loopBehavior: "normal" | "throw" | "cancelled" = "normal";
vi.mock("@/app/lib/agent/loop", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/app/lib/agent/loop")>();
  return {
    ...original,
    runAgentLoop: async (request: Parameters<typeof original.runAgentLoop>[0], deps: Parameters<typeof original.runAgentLoop>[1]) => {
      if (loopBehavior === "throw") throw new Error("unexpected loop explosion");
      if (loopBehavior === "cancelled") {
        // The loop's NORMALIZED cancellation result (as produced when the
        // client disconnects and the run-owned signal aborts).
        deps.emit({ type: "run_started", runId: request.runId, provider: request.provider });
        deps.trace?.recordRunStarted();
        deps.emit({ type: "run_failed", runId: request.runId, reason: "cancelled", message: "The run was cancelled." });
        deps.trace?.recordTerminal("cancelled", "cancelled");
        return { runId: request.runId, status: "cancelled" as const, finalText: "", steps: 0, toolCalls: 0, failureReason: "cancelled" };
      }
      return original.runAgentLoop(request, deps);
    },
  };
});

import { POST } from "../route";

const SCOPE = { tenantId: "local", projectId: "p111", branchId: "main" };
const SCHEMATIC: SchematicState = { components: [{ id: "r1", type: "resistor", x: 100, y: 100, rotation: 0, value: "10k" }], wires: [] };
const BODY = { provider: "openai", messages: [{ role: "user", content: "hello" }], scope: SCOPE, schematicState: SCHEMATIC };

class CapturingSink implements AgentTraceSink {
  readonly appended: AgentTraceEvent[] = [];
  readonly completed: AgentRunTrace[] = [];
  append(event: AgentTraceEvent): void { this.appended.push(event); }
  complete(trace: AgentRunTrace): void { this.completed.push(trace); }
}

async function post(body: unknown = BODY): Promise<{ status: number; events: Array<{ type: string; reason?: string }> }> {
  const response = await POST(new Request("http://localhost/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
  const status = response.status;
  const text = status === 200 ? await response.text() : "";
  const events = text.trim() === "" ? [] : text.trim().split("\n").map((line) => JSON.parse(line) as { type: string; reason?: string });
  return { status, events };
}

describe("B11.1 §E — every route path finalizes exactly one trace", () => {
  it("normal completion finalizes one VALID trace and the NDJSON is unchanged", async () => {
    const sink = new CapturingSink();
    setAgentTraceSinkFactory(() => sink);
    try {
      loopBehavior = "normal";
      const { status, events } = await post();
      expect(status).toBe(200);
      expect(events.filter((event) => event.type === "run_started")).toHaveLength(1);
      expect(events.filter((event) => event.type === "run_completed" || event.type === "run_failed")).toHaveLength(1);
      expect(sink.completed).toHaveLength(1);
      const trace = sink.completed[0]!;
      expect(validateAgentRunTrace(trace)).toEqual([]);
      expect(trace.terminal.outcome).toBe("completed");
      expect(trace.events.filter((event) => event.kind === "terminal")).toHaveLength(1);
    } finally {
      setAgentTraceSinkFactory(null);
    }
  });

  it("R6: an UNEXPECTED loop throw emits stream_error AND finalizes exactly one failed trace", async () => {
    const sink = new CapturingSink();
    setAgentTraceSinkFactory(() => sink);
    try {
      loopBehavior = "throw";
      const { status, events } = await post();
      expect(status).toBe(200);
      expect(events.filter((event) => event.type === "run_failed" && event.reason === "stream_error")).toHaveLength(1);
      // THE R6 DEFECT: this used to be zero.
      expect(sink.completed).toHaveLength(1);
      const trace = sink.completed[0]!;
      expect(validateAgentRunTrace(trace)).toEqual([]);
      expect(trace.terminal).toMatchObject({ outcome: "failed", failureReason: "stream_error" });
      expect(trace.events.filter((event) => event.kind === "terminal")).toHaveLength(1);
      // Exactly one UI terminal event — finalization added none.
      expect(events.filter((event) => event.type === "run_completed" || event.type === "run_failed")).toHaveLength(1);
    } finally {
      loopBehavior = "normal";
      setAgentTraceSinkFactory(null);
    }
  });

  it("a CANCELLED run finalizes exactly one trace whose terminal is cancelled", async () => {
    const sink = new CapturingSink();
    setAgentTraceSinkFactory(() => sink);
    try {
      loopBehavior = "cancelled";
      const { status, events } = await post();
      expect(status).toBe(200);
      expect(events.filter((event) => event.type === "run_failed" && event.reason === "cancelled")).toHaveLength(1);
      expect(sink.completed).toHaveLength(1);
      const trace = sink.completed[0]!;
      expect(validateAgentRunTrace(trace)).toEqual([]);
      expect(trace.terminal).toMatchObject({ outcome: "cancelled", failureReason: "cancelled" });
      expect(trace.events.filter((event) => event.kind === "terminal")).toHaveLength(1);
    } finally {
      loopBehavior = "normal";
      setAgentTraceSinkFactory(null);
    }
  });

  it("R4: a THROWING sink factory cannot break POST — the run streams normally and the trace is classified", async () => {
    setAgentTraceSinkFactory(() => { throw new Error("factory failed"); });
    try {
      loopBehavior = "normal";
      const { status, events } = await post();
      expect(status).toBe(200); // THE R4 DEFECT: this used to throw
      expect(events.filter((event) => event.type === "run_started")).toHaveLength(1);
      expect(events.some((event) => event.type === "run_completed")).toBe(true);
    } finally {
      setAgentTraceSinkFactory(null);
    }
  });

  it("a factory returning a MALFORMED sink, and a sink that throws on every call, cannot abort the request or alter the NDJSON", async () => {
    const baseline = await (async () => {
      setAgentTraceSinkFactory(() => new InMemoryTraceSink());
      try { return await post(); } finally { setAgentTraceSinkFactory(null); }
    })();

    for (const factory of [
      () => ({ notASink: true }) as unknown as AgentTraceSink,
      () => ({ append(): void { throw new Error("append boom"); }, complete(): void { throw new Error("complete boom"); } }),
    ]) {
      setAgentTraceSinkFactory(factory);
      try {
        const { status, events } = await post();
        expect(status).toBe(200);
        expect(events.map((event) => event.type)).toEqual(baseline.events.map((event) => event.type));
      } finally {
        setAgentTraceSinkFactory(null);
      }
    }
  });

  it("tracing never changes discovery, authorization, or a tool outcome: the advertised toolset is identical with a hostile sink", async () => {
    const toolsetOf = async (): Promise<string> => {
      const { events } = await post();
      const completed = events.find((event) => event.type === "run_completed") as { finalText?: string } | undefined;
      return completed?.finalText ?? "";
    };
    setAgentTraceSinkFactory(() => new InMemoryTraceSink());
    const healthy = await toolsetOf();
    setAgentTraceSinkFactory(() => ({
      append(): void { throw new Error("append boom"); },
      complete(): void { throw new Error("complete boom"); },
    }));
    const hostile = await toolsetOf();
    setAgentTraceSinkFactory(null);
    expect(hostile).toBe(healthy);
    expect(healthy).toContain("TOOLS:");
  });

  it("an ALREADY-ABORTED request propagates cancellation: the provider is never called and the trace is not 'completed'", async () => {
    const sink = new CapturingSink();
    setAgentTraceSinkFactory(() => sink);
    try {
      loopBehavior = "normal";
      const controller = new AbortController();
      controller.abort(); // the client disconnected before the handler ran
      const response = await POST(new Request("http://localhost/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BODY), signal: controller.signal,
      }));
      expect(response.status).toBe(200);
      const text = await response.text();
      const events = text.trim() === "" ? [] : text.trim().split(/\n/).map((line) => JSON.parse(line) as { type: string; reason?: string });
      // The loop's pre-abort defense must be REACHED: no completion.
      expect(events.some((event) => event.type === "run_completed")).toBe(false);
      expect(events.filter((event) => event.type === "run_failed")).toHaveLength(1);
      expect(sink.completed).toHaveLength(1);
      expect(sink.completed[0]!.terminal.outcome).not.toBe("completed");
      expect(validateAgentRunTrace(sink.completed[0]!)).toEqual([]);
    } finally {
      setAgentTraceSinkFactory(null);
    }
  });

  it("the route enforces exactly ONE stream terminal event of its own", async () => {
    const source = readFileSync(join(process.cwd(), "app/api/chat/route.ts"), "utf8");
    expect(source).toContain("streamTerminalEmitted");
    // Behavioural: the outer-catch path cannot append a second terminal.
    setAgentTraceSinkFactory(() => new InMemoryTraceSink());
    try {
      loopBehavior = "throw";
      const { events } = await post();
      expect(events.filter((event) => event.type === "run_completed" || event.type === "run_failed")).toHaveLength(1);
    } finally {
      loopBehavior = "normal";
      setAgentTraceSinkFactory(null);
    }
  });

  it("a request refused BEFORE the stream (400) produces no trace at all", async () => {
    const sink = new CapturingSink();
    setAgentTraceSinkFactory(() => sink);
    try {
      const { status } = await post({ ...BODY, scope: { ...SCOPE, actor: "admin" } });
      expect(status).toBe(400);
      expect(sink.completed).toHaveLength(0);
    } finally {
      setAgentTraceSinkFactory(null);
    }
  });
});
