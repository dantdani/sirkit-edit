/**
 * [B21 F] In-process FAKE SDK clients for the B21-F evaluations (not a test file; no vitest import). Each client answers the REAL
 * provider adapter's wire request (`OpenAIAgentAdapter`'s Responses call, `AnthropicAgentAdapter`'s Messages call) from ONE instance
 * of the scripted fixture agent (`FixtureAgentAdapter` - the browser harness's own script table, so the route cases and a browser run
 * share one scripted vocabulary): the request's instructions, conversation and rendered tools are read back into what the fixture
 * reads (the system text, the user's message, the offered declarations, the tool results), and the fixture's step is written out in
 * the provider's own response shape (Responses output items; Messages content blocks) - so the REAL adapters normalize it, the OD-91
 * output guard judges it and the stop is derived as in production. No network, no model, no credential: the model a response names is
 * the one the adapter requested. The provider faults the evaluations need are the client's, as a provider would answer them: a
 * `429 insufficient_quota` for every specialist call (E1's shape) or for the coordinator's first turn (D21-42), and an overloaded
 * `529` for the coordinator's follow-up turn. Every call records the tools it OFFERED, so a case can prove what a turn could reach.
 */
import type { AgentStep, ProviderAgentAdapter, ProviderToolDeclaration } from "@/app/lib/agent/contracts";
import { agentProviderName } from "@/app/lib/agent/provider-tools";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { FIXTURE_FOLLOW_UP_HEAD } from "@/app/lib/agent/fixture-agent-adapter";
import { SPECIALIST_RESULT_TOOL_ID, SPECIALIST_RESULT_TOOL_NAME } from "../result-tool";

type Json = Record<string, unknown>;
/** The switches a case sets and the calls the clients saw (per call: provider, role, turn kind, the model requested). */
export interface FixtureClientLog {
  quotaForSpecialists: boolean;
  /** [B21 F fix: coverage-2] a `429 insufficient_quota` for the coordinator's FIRST turn only (D21-42's no-credits account) */
  quotaForCoordinator: boolean;
  followUpFails: boolean;
  /** [B21 F fix: security-3, tests-02] `tools`: the registry ids of the declarations the call OFFERED (the result tool's id included) */
  calls: Array<{ provider: "openai" | "anthropic"; role: string; turn: "start" | "continue"; model: string; followUp: boolean; tools: string[] }>;
  /** every follow-up turn's user message: the merged envelope the coordinator was handed */
  envelopes: string[];
}
export function fixtureClientLog(): FixtureClientLog {
  return { quotaForSpecialists: false, quotaForCoordinator: false, followUpFails: false, calls: [], envelopes: [] };
}

const ROLE_LINE = /^Role: ([a-z-]+)$/m;
let toolIds: Map<string, string> | null = null;
/** Every registry tool's provider name back to its id (the renderer's own naming, `agentProviderName`), plus the result tool. */
function toolIdOf(providerName: string): string {
  toolIds ??= new Map([...sirkitToolRegistry().list().map((descriptor) => [agentProviderName(descriptor.toolId), descriptor.toolId] as const), [SPECIALIST_RESULT_TOOL_NAME, SPECIALIST_RESULT_TOOL_ID]]);
  return toolIds.get(providerName) ?? providerName;
}
const declarations = (tools: ReadonlyArray<{ name: string; description?: string; parameters?: unknown; input_schema?: unknown }> | undefined): ProviderToolDeclaration[] =>
  (tools ?? []).map((tool) => ({ providerName: tool.name, toolId: toolIdOf(tool.name), version: "1.0.0", description: tool.description ?? "", inputSchema: (tool.parameters ?? tool.input_schema ?? {}) as ProviderToolDeclaration["inputSchema"] }));
const usage = { input_tokens: 11, output_tokens: 13 };
const quotaError = (): Error => Object.assign(new Error("You exceeded your current quota, please check your plan and billing details."), { status: 429, code: "insufficient_quota" });
const overloadedError = (): Error => Object.assign(new Error("Overloaded"), { status: 529 });

/** The fault a case switched on for this call, thrown the way the SDK would. */
function fault(log: FixtureClientLog, role: string, followUp: boolean): void {
  if (log.quotaForSpecialists && role !== "coordinator") throw quotaError();
  if (log.quotaForCoordinator && role === "coordinator" && !followUp) throw quotaError();
  if (log.followUpFails && followUp) throw overloadedError();
}

/** An OpenAI client (`responses.create` only) over one fixture agent. */
export function fixtureOpenAIClient(fixture: ProviderAgentAdapter, log: FixtureClientLog): { responses: { create(params: Json, options?: { signal?: AbortSignal }): Promise<Json> } } {
  return {
    responses: {
      async create(params, options) {
        const system = String(params.instructions ?? "");
        const role = ROLE_LINE.exec(system)?.[1] ?? "coordinator";
        const input = (params.input ?? []) as Json[];
        const tools = declarations(params.tools as never);
        const outputs: Json[] = [];
        for (let index = input.length - 1; index >= 0 && input[index]!.type === "function_call_output"; index -= 1) outputs.unshift(input[index]!);
        const last = input.at(-1);
        const followUp = outputs.length === 0 && typeof last?.content === "string" && last.content.startsWith(FIXTURE_FOLLOW_UP_HEAD);
        log.calls.push({ provider: "openai", role, turn: outputs.length > 0 ? "continue" : "start", model: String(params.model), followUp, tools: tools.map((tool) => tool.toolId) });
        if (followUp) log.envelopes.push(String(last!.content));
        fault(log, role, followUp);
        let step: AgentStep;
        if (outputs.length > 0) {
          step = await fixture.continueWith({ continuation: { provider: "openai", state: null }, results: outputs.map((output) => ({ callId: String(output.call_id), outputText: String(output.output), isError: false })), tools, signal: options?.signal });
        } else {
          const history = input.slice(0, -1).flatMap((item) => ((item.role === "user" || item.role === "assistant") && typeof item.content === "string" ? [{ role: item.role as "user" | "assistant", text: item.content }] : []));
          step = await fixture.start({ system, history, userMessage: String(last?.content ?? ""), tools, signal: options?.signal });
        }
        const message = step.text.length > 0 ? [{ type: "message", id: "msg_fixture", role: "assistant", status: "completed", content: [{ type: "output_text", text: step.text, annotations: [] }] }] : [];
        const calls = step.toolCalls.map((call) => ({ type: "function_call", id: `fc_${call.callId}`, call_id: call.callId, name: call.providerName, arguments: call.argumentsText, status: "completed" }));
        return { id: "resp_fixture", object: "response", output: [...message, ...calls], output_text: step.text, status: "completed", model: String(params.model), usage };
      },
    },
  };
}

/** An Anthropic client (`messages.create` only) over one fixture agent. */
export function fixtureAnthropicClient(fixture: ProviderAgentAdapter, log: FixtureClientLog): { messages: { create(params: Json, options?: { signal?: AbortSignal }): Promise<Json> } } {
  return {
    messages: {
      async create(params, options) {
        const system = String(params.system ?? "");
        const role = ROLE_LINE.exec(system)?.[1] ?? "coordinator";
        const messages = (params.messages ?? []) as Json[];
        const tools = declarations(params.tools as never);
        const last = messages.at(-1);
        const results = Array.isArray(last?.content) ? (last.content as Json[]).filter((block) => block.type === "tool_result") : [];
        const followUp = results.length === 0 && typeof last?.content === "string" && last.content.startsWith(FIXTURE_FOLLOW_UP_HEAD);
        log.calls.push({ provider: "anthropic", role, turn: results.length > 0 ? "continue" : "start", model: String(params.model), followUp, tools: tools.map((tool) => tool.toolId) });
        if (followUp) log.envelopes.push(String(last!.content));
        fault(log, role, followUp);
        let step: AgentStep;
        if (results.length > 0) {
          step = await fixture.continueWith({ continuation: { provider: "anthropic", state: null }, results: results.map((block) => ({ callId: String(block.tool_use_id), outputText: String(block.content), isError: block.is_error === true })), tools, signal: options?.signal });
        } else {
          const history = messages.slice(0, -1).flatMap((item) => ((item.role === "user" || item.role === "assistant") && typeof item.content === "string" ? [{ role: item.role as "user" | "assistant", text: item.content }] : []));
          step = await fixture.start({ system, history, userMessage: String(last?.content ?? ""), tools, signal: options?.signal });
        }
        const text = step.text.length > 0 ? [{ type: "text", text: step.text }] : [];
        const calls = step.toolCalls.map((call) => ({ type: "tool_use", id: call.callId, name: call.providerName, input: JSON.parse(call.argumentsText || "{}") as Json }));
        return { id: "msg_fixture", type: "message", role: "assistant", content: [...text, ...calls], stop_reason: calls.length > 0 ? "tool_use" : "end_turn", stop_sequence: null, model: String(params.model), usage };
      },
    },
  };
}
