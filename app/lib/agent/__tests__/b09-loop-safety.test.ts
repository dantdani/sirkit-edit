/**
 * B09 — loop safety tests (areas 11–26): the REAL loop + REAL gateway +
 * REAL registry/read-service, driven by a scripted fake provider adapter.
 */

import { describe, expect, it } from "vitest";
import { assembleAgentRunContext } from "../context";
import { DEFAULT_AGENT_BUDGET, type AgentRunEvent, type AgentStep, type AgentToolResult, type ProviderAgentAdapter } from "../contracts";
import { createAgentToolGateway } from "../gateway";
import { buildRunToolset, runAgentLoop } from "../loop";
import { agentProviderName, buildAgentToolDeclarations } from "../provider-tools";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";
import { LLMProviderError } from "../../llm/errors";
import { createEmptyBoard } from "../../pcb/types";
import type { SchematicState } from "@/lib/schematic-types";

const SCHEMATIC: SchematicState = {
  components: [{ id: "r1", type: "resistor", x: 100, y: 100, rotation: 0, value: "10k" }],
  wires: [],
};

function context(overrides?: { schematic?: unknown; board?: unknown; projectId?: string }) {
  const assembly = assembleAgentRunContext({
    tenantId: "local",
    projectId: overrides?.projectId ?? "p1",
    branchId: "main",
    schematic: overrides && "schematic" in overrides ? overrides.schematic : SCHEMATIC,
    board: overrides && "board" in overrides ? overrides.board : createEmptyBoard(),
    // [B09.1] proposals require a canonical head mark (scope label).
    schematicHeadMark: { lineageId: "lin1-1234567890abcdef", headSequence: 1, canonicalStateDigest: "eng1-1234567890abcdef" },
  });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly.context;
}

type StepScript = (input: { results?: readonly AgentToolResult[] }) => Partial<AgentStep> | Promise<Partial<AgentStep>>;

class FakeAdapter implements ProviderAgentAdapter {
  readonly provider = "openai" as const;
  readonly continueInputs: Array<readonly AgentToolResult[]> = [];
  private index = 0;
  constructor(private readonly script: StepScript[]) {}
  private step(partial: Partial<AgentStep>): AgentStep {
    return {
      text: "",
      toolCalls: [],
      stopReason: "completed",
      usage: { inputTokens: 1, outputTokens: 1 },
      model: "fake",
      continuation: { provider: "openai", state: null },
      ...partial,
    };
  }
  async start(): Promise<AgentStep> {
    return this.step(await this.script[this.index++]!({}));
  }
  async continueWith(input: { results: readonly AgentToolResult[] }): Promise<AgentStep> {
    this.continueInputs.push(input.results);
    return this.step(await this.script[this.index++]!({ results: input.results }));
  }
}

async function run(script: StepScript[], options?: {
  context?: ReturnType<typeof context>;
  budget?: Partial<typeof DEFAULT_AGENT_BUDGET>;
  signal?: AbortSignal;
}) {
  const events: AgentRunEvent[] = [];
  const adapter = new FakeAdapter(script);
  const registry = sirkitToolRegistry();
  const result = await runAgentLoop(
    { runId: "run-t", provider: "openai", history: [], userMessage: "go", budget: { ...DEFAULT_AGENT_BUDGET, ...options?.budget }, signal: options?.signal },
    { adapter, gateway: createAgentToolGateway(registry), registry, context: options?.context ?? context(), system: "sys", emit: (event) => events.push(event) },
  );
  return { result, events, adapter };
}

const call = (callId: string, providerName: string, args = "{}"): AgentStep["toolCalls"][number] => ({ callId, providerName, argumentsText: args });
const resultsOf = (adapter: FakeAdapter, index = 0) => adapter.continueInputs[index]!.map((item) => JSON.parse(item.outputText) as Record<string, unknown>);

describe("B09 §3 — loop safety", () => {
  it("OD-236: alternating omitted and strict-null arguments cannot evade cycle limits", async () => {
    const { adapter } = await run([
      () => ({ toolCalls: [call("c1", agentProviderName("sirkit.pcb.via-inspect"), "{}"), call("c2", agentProviderName("sirkit.pcb.via-inspect"), '{"netName":null}')] }),
      () => ({ text: "done" }),
    ], { budget: { maxIdenticalCalls: 1 } });
    const results = resultsOf(adapter);
    expect(results[0]).toMatchObject({ ok: true });
    expect(results[1]).toMatchObject({ ok: false, status: "repeated_call" });
  });

  it("11+13. unknown, unregistered, and non-exposed provider names are refused; the exposed toolset omits every unbound/internal/forbidden tool", async () => {
    const toolset = buildRunToolset(sirkitToolRegistry(), context(), () => undefined);
    const names = toolset.declarations.map((declaration) => declaration.toolId);
    expect(names).toContain("sirkit.schematic.inspect");
    expect(names).toContain("sirkit.schematic.propose-tier1-edit");
    // [B17-F] placement/routing proposals are exposed (the shared layout candidate); they left this list.
    for (const forbidden of ["sirkit.parts.search", "sirkit.selection.inspect", "sirkit.component-authority.inspect", "sirkit.pcb.delete-item", "sirkit.pcb.move-footprint", "sirkit.manufacturing.release", "sirkit.pcb.undo-redo-canonical", "sirkit.pcb.repair-plan"]) {
      expect(names, forbidden).not.toContain(forbidden);
    }
    const { result, adapter } = await run([
      () => ({ toolCalls: [call("c1", "totally_unknown_tool"), call("c2", "sirkit_pcb_delete_item")] }),
      () => ({ text: "done" }),
    ]);
    expect(result.status).toBe("completed");
    const results = resultsOf(adapter);
    expect(results[0]!.status).toBe("unknown_tool");
    expect(results[1]!.status).toBe("unknown_tool"); // non-exposed = unknown to the model
  });

  it("12. colliding provider names are rejected at declaration time", () => {
    const base = sirkitToolRegistry().get("sirkit.schematic.inspect")!;
    const twin = { ...base, toolId: "sirkit.schematic_inspect" };
    expect(() => buildAgentToolDeclarations([base, twin as never])).toThrow(/AGENT_TOOL_NAME_COLLISION/);
  });

  it("14+15. reads travel through the REAL ReadToolInvocationService with fresh discovery at invocation time", async () => {
    const { result, adapter, events } = await run([
      () => ({ toolCalls: [call("c1", "sirkit_schematic_inspect")] }),
      () => ({ text: "grounded answer" }),
    ]);
    expect(result.status).toBe("completed");
    const output = resultsOf(adapter)[0]!;
    expect(output.ok).toBe(true);
    expect(output.verification).toBe("canonical-revision-verified"); // B05.1 truthful verification
    expect(typeof output.revision).toBe("string");
    expect((output.output as { report: { counts: { components: number } } }).report.counts.components).toBe(1);
    expect(events.some((event) => event.type === "tool_started" && event.toolId === "sirkit.schematic.inspect")).toBe(true);
    // Fresh discovery: a context WITHOUT a board excludes board tools NOW.
    const { adapter: adapter2 } = await run([
      () => ({ toolCalls: [call("c1", "sirkit_pcb_board_inspect")] }),
      () => ({ text: "done" }),
    ], { context: context({ board: undefined }) });
    const refused = resultsOf(adapter2)[0]!;
    expect(refused.ok).toBe(false);
    expect(["unknown_tool", "not_discoverable"]).toContain(refused.status);
  });

  it("16. a stale revision fails closed with zero output", async () => {
    const staleContext = context();
    // The board mutates AFTER assembly — the pinned digest no longer matches.
    staleContext.canonicalState!.pcb.nets.push({ id: 99, name: "SNEAKY" });
    const { adapter } = await run([
      () => ({ toolCalls: [call("c1", "sirkit_schematic_inspect")] }),
      () => ({ text: "done" }),
    ], { context: staleContext });
    const output = resultsOf(adapter)[0]!;
    expect(output.ok).toBe(false);
    // The B05.1 boundary classifies the drift precisely: the assembled
    // envelope pins the assembly-time revision, which no longer matches the
    // mutated content — a structured fail-closed staleness refusal.
    expect(["stale_revision", "incompatible_resource_revision", "context_integrity"]).toContain(output.status);
  });

  it("17. the model cannot spoof actor/role/capability/revision through tool arguments (strict schemas refuse unknown fields)", async () => {
    const { adapter } = await run([
      () => ({ toolCalls: [call("c1", "sirkit_schematic_inspect", JSON.stringify({ actorRole: "project_admin", actorId: "root", expectedRevision: "forged" }))] }),
      () => ({ text: "done" }),
    ]);
    const output = resultsOf(adapter)[0]!;
    expect(output.ok).toBe(false);
    expect(output.status).toBe("invalid_input");
  });

  it("18. malformed and oversized arguments fail closed", async () => {
    const { adapter } = await run([
      () => ({ toolCalls: [call("c1", "sirkit_schematic_inspect", "{not json"), call("c2", "sirkit_schematic_inspect", JSON.stringify({ pad: "x".repeat(30_000) }))] }),
      () => ({ text: "done" }),
    ]);
    const results = resultsOf(adapter);
    expect(results[0]!.status).toBe("invalid_input");
    expect(results[1]!.status).toBe("invalid_input");
  });

  it("19+22+23. cancellation during provider wait AND during tool execution fails the run as cancelled; no completion events follow", async () => {
    const abortDuringProvider = new AbortController();
    const { result } = await run([
      async () => { abortDuringProvider.abort(); throw new LLMProviderError("openai", "cancelled"); },
    ], { signal: abortDuringProvider.signal });
    expect(result.status).toBe("cancelled");

    const abortDuringTool = new AbortController();
    const { result: result2, events } = await run([
      () => { abortDuringTool.abort(); return { toolCalls: [call("c1", "sirkit_schematic_inspect")] }; },
      () => ({ text: "never reached" }),
    ], { signal: abortDuringTool.signal });
    expect(result2.status).toBe("cancelled");
    expect(events.some((event) => event.type === "run_completed")).toBe(false);
  });

  it("24. a stale consumer generation applies NOTHING from late events (the page-gate contract)", async () => {
    // The UI applies events only while its captured scope is current; model
    // the gate exactly as page.tsx does and replace the generation mid-run.
    let generation = 1;
    const captured = 1;
    const transcript: string[] = [];
    const apply = (event: AgentRunEvent): void => {
      if (generation !== captured) return; // scope.isCurrent() === false
      if (event.type === "text_delta") transcript.push(event.text);
      if (event.type === "proposal_ready") transcript.push("PROPOSAL");
    };
    const { events } = await run([
      () => ({ text: "early", toolCalls: [call("c1", "sirkit_schematic_inspect")] }),
      () => ({ text: "late text after replacement" }),
    ]);
    for (const event of events) {
      apply(event);
      if (event.type === "tool_started") generation = 2; // project replaced mid-run
    }
    expect(transcript).toEqual(["early"]); // nothing late leaked
  });

  it("20. max steps and max tool calls are hard budgets", async () => {
    const loopingScript: StepScript[] = Array.from({ length: 10 }, (_, index) => () => ({ toolCalls: [call(`c${index}`, "sirkit_schematic_inspect")] }));
    const { result } = await run(loopingScript, { budget: { maxModelSteps: 3 } });
    expect(result.status).toBe("failed");
    expect(result.failureReason).toBe("max_steps");

    const { adapter } = await run([
      () => ({ toolCalls: [call("c1", "sirkit_schematic_inspect"), call("c2", "sirkit_pcb_revision-inspect")] }),
      () => ({ text: "done" }),
    ], { budget: { maxToolCalls: 1 } });
    const results = resultsOf(adapter);
    expect(results[0]!.ok).toBe(true);
    expect(results[1]!.status).toBe("budget_exhausted");
  });

  it("21. repeated identical calls (tool id/version + canonical argument digest) are cycle-detected", async () => {
    const { adapter } = await run([
      () => ({ toolCalls: [call("c1", "sirkit_schematic_inspect"), call("c2", "sirkit_schematic_inspect"), call("c3", "sirkit_schematic_inspect")] }),
      () => ({ text: "done" }),
    ]);
    const results = resultsOf(adapter);
    expect(results[0]!.ok).toBe(true);
    expect(results[1]!.ok).toBe(true);
    expect(results[2]!.status).toBe("repeated_call");
  });

  it("25. no automatic provider fallback after a tool executed: the provider failure surfaces classified, on the SAME run", async () => {
    const { result, events, adapter } = await run([
      () => ({ toolCalls: [call("c1", "sirkit_schematic_inspect")] }),
      () => { throw new LLMProviderError("openai", "rate_limit"); },
    ]);
    expect(resultsOf(adapter)[0]!.ok).toBe(true); // the tool DID execute
    expect(result.status).toBe("failed");
    expect(result.failureReason).toBe("provider_rate_limit"); // distinguishable + actionable
    expect(events.filter((event) => event.type === "run_started")).toHaveLength(1); // never restarted
  });

  it("26. events and tool results never carry secrets, provider bodies, or stack traces", async () => {
    const secretError = new LLMProviderError("openai", "authentication");
    const { events } = await run([
      () => ({ toolCalls: [call("c1", "sirkit_schematic_inspect")] }),
      () => { throw secretError; },
    ]);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toMatch(/sk-[A-Za-z0-9]/);
    expect(serialized).not.toMatch(/at .*\.ts:\d+/); // no stack frames
    expect(serialized).not.toContain("OPENAI_API_KEY");
  });
});
