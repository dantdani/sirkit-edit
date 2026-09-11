/**
 * [B18-D I2] Rule 2 at the protocol boundary (chat-execution-ux.md §2, R2-1 and R2-2) and the tier on tool events.
 *
 * Before: a step's model text was emitted BEFORE its tool calls were resolved (loop.ts), so "Done, R3 moved." written
 * beside a move call reached the page before any grant, preview or transaction existed. Now a step that calls a
 * side-effecting tool — operationClass `mutate` (an execution grant) or `propose` (a sealed proposal or layout
 * candidate) — emits its text only AFTER its calls resolved (after the grant's settlement, the preview or the proposal),
 * and never after a boundary failure; every other step emits in place (the B09 page-gate pin keeps "early"). Every
 * text_delta says whether it was written beside a tool call ("interim") or is the closing answer ("final"); every tool
 * event carries the tool's permission tier (display data — the server decides everything).
 */
import { describe, expect, it } from "vitest";
import { assembleAgentRunContext } from "../context";
import { DEFAULT_AGENT_BUDGET, type AgentRunEvent, type AgentStep, type ProviderAgentAdapter } from "../contracts";
import { createAgentToolGateway } from "../gateway";
import { buildRunToolset, runAgentLoop } from "../loop";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";
import { createEmptyBoard } from "../../pcb/types";
import { call, composition, movesBy, runScenario } from "../../engineering/__tests__/b18c-harness";
import type { SchematicState } from "@/lib/schematic-types";

const order = (events: readonly AgentRunEvent[]): string[] => events.map((event) => (event.type === "text_delta" ? `text:${event.text}` : event.type));
const texts = (events: readonly AgentRunEvent[]) => events.filter((event) => event.type === "text_delta");

// ── a B09-style run (real loop, gateway and registry; a scripted provider) for the read and proposal cases ──
const SCHEMATIC: SchematicState = { components: [{ id: "r1", type: "resistor", x: 100, y: 100, rotation: 0, value: "10k" }], wires: [] };
function schematicContext() {
  const assembly = assembleAgentRunContext({
    tenantId: "local", projectId: "p1", branchId: "main", schematic: SCHEMATIC, board: createEmptyBoard(),
    schematicHeadMark: { lineageId: "lin1-1234567890abcdef", headSequence: 1, canonicalStateDigest: "eng1-1234567890abcdef" },
  });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly.context;
}
type StepScript = () => Partial<AgentStep>;
class ScriptedAdapter implements ProviderAgentAdapter {
  readonly provider = "openai" as const;
  private index = 0;
  constructor(private readonly script: StepScript[]) {}
  private step(partial: Partial<AgentStep>): AgentStep {
    return { text: "", toolCalls: [], stopReason: "completed", usage: { inputTokens: 1, outputTokens: 1 }, model: "fake", continuation: { provider: "openai", state: null }, ...partial };
  }
  async start(): Promise<AgentStep> { return this.step(this.script[this.index++]!()); }
  async continueWith(): Promise<AgentStep> { return this.step(this.script[this.index++]!()); }
}
async function runPlain(script: StepScript[], options: { signal?: AbortSignal; abortAfterInvoke?: AbortController } = {}) {
  const events: AgentRunEvent[] = [];
  const registry = sirkitToolRegistry();
  const real = createAgentToolGateway(registry);
  const gateway = options.abortAfterInvoke
    ? { ...real, invoke: async (input: Parameters<typeof real.invoke>[0]) => { const outcome = await real.invoke(input); options.abortAfterInvoke!.abort(); return outcome; } }
    : real;
  const result = await runAgentLoop(
    { runId: "run-d2", provider: "openai", history: [], userMessage: "go", budget: DEFAULT_AGENT_BUDGET, signal: options.signal },
    { adapter: new ScriptedAdapter(script), gateway, registry, context: schematicContext(), system: "sys", emit: (event) => events.push(event) },
  );
  return { result, events };
}
function proposalTool(): string {
  const registry = sirkitToolRegistry();
  const declaration = buildRunToolset(registry, schematicContext(), () => undefined).declarations.find((candidate) => registry.get(candidate.toolId)?.operationClass === "propose");
  if (!declaration) throw new Error("a proposal tool must be advertised to this run");
  return declaration.providerName;
}

describe("B18-D I2 — model text never announces a change before it exists", () => {
  it("an explicit move: the text written beside the call arrives only AFTER the durable settlement, as interim; the closing answer is final; the move's tool events carry tier 1", async () => {
    const c = await composition("execute_explicit_tier1");
    const { events } = await runScenario(c, (move) => [() => ({ text: "Done, R3 moved.", toolCalls: [call("c1", move, movesBy(c, 2))] }), () => ({ text: "R3 is 2 mm to the right." })]);
    const sequence = order(events);
    expect(sequence.indexOf("execution_settled")).toBeGreaterThan(-1);
    expect(sequence.indexOf("text:Done, R3 moved.")).toBeGreaterThan(sequence.indexOf("execution_settled"));
    expect(texts(events)).toEqual([expect.objectContaining({ text: "Done, R3 moved.", phase: "interim" }), expect.objectContaining({ text: "R3 is 2 mm to the right.", phase: "final" })]);
    expect(events.filter((event) => event.type === "tool_started" || event.type === "tool_finished")).toEqual([expect.objectContaining({ type: "tool_started", tier: 1 }), expect.objectContaining({ type: "tool_finished", tier: 1 })]);
  }, 30_000);

  it("a previewed move: the text arrives only after the grant is issued (the card), never before", async () => {
    const c = await composition("execute_explicit_tier1");
    const { events } = await runScenario(c, (move) => [() => ({ text: "Moved it!", toolCalls: [call("c1", move, movesBy(c, 2))] }), () => ({ text: "done" })], { message: "Could you move R3 2 mm to the right?" });
    const sequence = order(events);
    expect(sequence.indexOf("execution_grant_ready")).toBeGreaterThan(-1);
    expect(sequence.indexOf("text:Moved it!")).toBeGreaterThan(sequence.indexOf("execution_grant_ready"));
  }, 30_000);

  it("a proposal-class call: the text arrives after that call's result, as interim", async () => {
    const { events } = await runPlain([() => ({ text: "Proposed.", toolCalls: [call("c1", proposalTool(), "{}")] }), () => ({ text: "done" })]);
    const sequence = order(events);
    expect(sequence.indexOf("tool_finished")).toBeGreaterThan(-1);
    expect(sequence.indexOf("text:Proposed.")).toBeGreaterThan(sequence.indexOf("tool_finished"));
    expect(texts(events)[0]).toMatchObject({ text: "Proposed.", phase: "interim" });
  });

  it("a read step's text is emitted IN PLACE (before its tool starts; the B09 page-gate pin), and read events carry tier 0", async () => {
    const { events } = await runPlain([() => ({ text: "early", toolCalls: [call("c1", "sirkit_schematic_inspect", "{}")] }), () => ({ text: "late" })]);
    const sequence = order(events);
    expect(sequence.indexOf("text:early")).toBeLessThan(sequence.indexOf("tool_started"));
    expect(texts(events)).toEqual([expect.objectContaining({ text: "early", phase: "interim" }), expect.objectContaining({ text: "late", phase: "final" })]);
    expect(events.filter((event) => event.type === "tool_started")).toEqual([expect.objectContaining({ tier: 0 })]);
  });

  it("a run that fails at its boundary right after a side-effecting step never emits that step's text", async () => {
    const controller = new AbortController();
    const { result, events } = await runPlain([() => ({ text: "Proposed and applied.", toolCalls: [call("c1", proposalTool(), "{}")] }), () => ({ text: "never reached" })], { signal: controller.signal, abortAfterInvoke: controller });
    expect(result.status).toBe("cancelled");
    expect(texts(events)).toEqual([]);
  });
});
