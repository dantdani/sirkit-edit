/**
 * [B18-D I10] A tool call refused BEFORE it runs is shown to the user. The REAL loop (the b09 harness: the real gateway,
 * registry and read service, a scripted provider) emits one `tool_refused` event per refused call — the code, the call
 * id, and the tool's id, title and tier when the tool is known (null for an unknown tool) — and never a `tool_started`
 * for it. The model still receives the same error results, and nothing about a refused call reaches the run trace (the
 * event is untraced; the evaluation capsules run unchanged).
 */
import { describe, expect, it } from "vitest";
import { assembleAgentRunContext } from "../context";
import { DEFAULT_AGENT_BUDGET, type AgentRunEvent, type AgentStep, type AgentToolResult, type ProviderAgentAdapter } from "../contracts";
import { createAgentToolGateway } from "../gateway";
import { runAgentLoop } from "../loop";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";
import { createEmptyBoard } from "../../pcb/types";
import type { SchematicState } from "@/lib/schematic-types";

const SCHEMATIC: SchematicState = {
  components: [{ id: "r1", type: "resistor", x: 100, y: 100, rotation: 0, value: "10k" }],
  wires: [],
};

function context() {
  const assembly = assembleAgentRunContext({
    tenantId: "local",
    projectId: "p1",
    branchId: "main",
    schematic: SCHEMATIC,
    board: createEmptyBoard(),
    schematicHeadMark: { lineageId: "lin1-1234567890abcdef", headSequence: 1, canonicalStateDigest: "eng1-1234567890abcdef" },
  });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly.context;
}

type StepScript = () => Partial<AgentStep>;

class FakeAdapter implements ProviderAgentAdapter {
  readonly provider = "openai" as const;
  readonly continueInputs: Array<readonly AgentToolResult[]> = [];
  private index = 0;
  constructor(private readonly script: StepScript[]) {}
  private step(partial: Partial<AgentStep>): AgentStep {
    return { text: "", toolCalls: [], stopReason: "completed", usage: { inputTokens: 1, outputTokens: 1 }, model: "fake", continuation: { provider: "openai", state: null }, ...partial };
  }
  async start(): Promise<AgentStep> {
    return this.step(this.script[this.index++]!());
  }
  async continueWith(input: { results: readonly AgentToolResult[] }): Promise<AgentStep> {
    this.continueInputs.push(input.results);
    return this.step(this.script[this.index++]!());
  }
}

const call = (callId: string, providerName: string, args = "{}"): AgentStep["toolCalls"][number] => ({ callId, providerName, argumentsText: args });

describe("B18-D I10 — calls refused before they run are shown, untraced", () => {
  it("each pre-run refusal emits one tool_refused (never a tool_started); the model's error results are unchanged; the trace sees none of it", async () => {
    const events: AgentRunEvent[] = [];
    const traceCalls: string[] = [];
    const trace = new Proxy({}, { get: (_target, name) => (name === "then" ? undefined : (...args: unknown[]) => { traceCalls.push(`${String(name)}:${JSON.stringify(args)}`); }) });
    const adapter = new FakeAdapter([
      () => ({ toolCalls: [
        call("c1", "totally_unknown_tool"),
        call("c2", "sirkit_schematic_inspect", "{not json"),
        call("c3", "sirkit_schematic_inspect"),
        call("c4", "sirkit_schematic_inspect"),
        call("c5", "sirkit_schematic_inspect"),
      ] }),
      () => ({ text: "done" }),
    ]);
    const registry = sirkitToolRegistry();
    const result = await runAgentLoop(
      { runId: "run-r", provider: "openai", history: [], userMessage: "go", budget: { ...DEFAULT_AGENT_BUDGET, maxIdenticalCalls: 2 } },
      { adapter, gateway: createAgentToolGateway(registry), registry, context: context(), system: "sys", emit: (event) => events.push(event), trace: trace as never },
    );
    expect(result.status).toBe("completed");

    const refused = events.filter((event): event is Extract<AgentRunEvent, { type: "tool_refused" }> => event.type === "tool_refused");
    expect(refused.map((event) => [event.callId, event.status])).toEqual([["c1", "unknown_tool"], ["c2", "invalid_input"], ["c5", "repeated_call"]]);
    expect(refused[0]).toMatchObject({ runId: "run-r", toolId: null, title: null, tier: null });
    expect(refused[1]).toMatchObject({ toolId: "sirkit.schematic.inspect", title: expect.any(String) });
    expect(refused[2]).toMatchObject({ toolId: "sirkit.schematic.inspect", title: refused[1]!.title, tier: refused[1]!.tier });
    const started = events.filter((event): event is Extract<AgentRunEvent, { type: "tool_started" }> => event.type === "tool_started").map((event) => event.callId);
    expect(started).toEqual(["c3", "c4"]);

    // The model receives exactly the error results it always did.
    const statuses = adapter.continueInputs[0]!.map((item) => (JSON.parse(item.outputText) as { status: string }).status);
    expect([statuses[0], statuses[1], statuses[4]]).toEqual(["unknown_tool", "invalid_input", "repeated_call"]);
    // Nothing about the refused calls reaches the trace (the unknown tool's existing warning is the only trace line about it).
    expect(traceCalls.filter((entry) => /"c[125]"|tool_refused/.test(entry))).toEqual([]);
  });
});
