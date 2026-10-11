/**
 * [B21 E1] Normalized stop reasons (D21-21): a closed `StepStop` vocabulary derived INSIDE each real adapter from the provider's
 * own field (the dated facts in provider-reference-notes.md: Anthropic `stop_reason`, OpenAI `status` with `incomplete_details` and a
 * `refusal` content part), carried on `AgentStep` as ONE new optional field, and read on a SPECIALIST's run path only: a turn that
 * stops at the output limit or the context window is escalated with that reason and never parsed as a result, and a refusal is
 * escalated and never retried, on either provider. The coordinator's loop does not read it: its behaviour is unchanged.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnthropicAgentAdapter, OpenAIAgentAdapter } from "@/app/lib/agent/adapters";
import { STEP_STOPS, type AgentRunEvent } from "@/app/lib/agent/contracts";
import { createAgentToolGateway } from "@/app/lib/agent/gateway";
import { runAgentLoop } from "@/app/lib/agent/loop";
import { DEFAULT_AGENT_BUDGET } from "@/app/lib/agent/contracts";
import { AGENT_SYSTEM_PROMPT } from "@/app/lib/prompts";
import { resetAdmissionControl } from "@/app/lib/acquisition/admission-control";
import { SPECIALIST_STOP_REASONS } from "../result-tool";
import { anthropicResultMessage, anthropicTextMessage, fakeAnthropic, fakeOpenAI, fakeProviders, openAIResultResponse, openAITextResponse, roleOf, runE1Dag } from "./_e1-fixtures";
import { REGISTRY, coordinatorContext } from "./_merge-fixtures";

const ROOT = process.cwd();
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");
const START = { system: "sys", history: [], userMessage: "hi", tools: [] };

vi.stubGlobal("fetch", () => { throw new Error("no network"); });
beforeEach(() => resetAdmissionControl());
afterEach(() => resetAdmissionControl());

describe("[B21 E1] normalized stop reasons (D21-21)", () => {
  it("1. the closed vocabulary is pinned, and AgentStep gains exactly ONE optional field for it (a pinned addition to the contracts); the coordinator's loop never reads it", () => {
    expect(STEP_STOPS).toEqual(["end_turn", "max_tokens", "refusal", "pause_turn", "context_exceeded", "incomplete", "unknown"]);
    expect(Object.isFrozen(STEP_STOPS)).toBe(true);
    const contracts = read("app/lib/agent/contracts.ts");
    const start = contracts.indexOf("export interface AgentStep {");
    const body = contracts.slice(start, contracts.indexOf(`${String.fromCharCode(10)}}`, start));
    // a field is a line's leading name, or a name folded onto a line after a doc comment (`*/ name:`) - never a nested type's key
    const fields = body.split(String.fromCharCode(10)).slice(1).flatMap((line) => {
      const own = /^\s+([a-zA-Z]+)(\?)?: /.exec(line);
      return [...(own ? [`${own[1]}${own[2] ?? ""}`] : []), ...[...line.matchAll(/\*\/ ([a-zA-Z]+)(\?)?: /g)].map((match) => `${match[1]}${match[2] ?? ""}`)];
    });
    expect(fields).toEqual(["text", "toolCalls", "stopReason", "stop?", "usage", "model", "providerRequestId?", "continuation"]); // [B24-C2, 2026-10-08] reviewed pin move: + `providerRequestId?` (OD-208, D24-22), the SDK's `_request_id` set by the adapters only when a response carries one, folded onto the `model` line after a doc comment so no cited line of contracts.ts moves; E1's `stop?` stays the one field E1 added, and the coordinator's loop reads neither
    expect(body).toContain("stop?: StepStop;");
    const loop = read("app/lib/agent/loop.ts");
    expect(loop).not.toMatch(/\.stop\b(?!Reason)/);
    expect(loop).not.toMatch(/stopReason/);
    expect(Object.keys(SPECIALIST_STOP_REASONS)).toEqual(STEP_STOPS.filter((stop) => stop !== "end_turn"));
  });

  it("2. Anthropic: every `stop_reason` of the dated page mapped inside the REAL adapter - end_turn and tool_use end the turn normally, max_tokens, refusal, pause_turn and model_context_window_exceeded map to their closed values, stop_sequence (Sirkit sets none), null and anything new are `unknown`", async () => {
    const cases: Array<[unknown, string]> = [["end_turn", "end_turn"], ["tool_use", "end_turn"], ["max_tokens", "max_tokens"], ["refusal", "refusal"], ["pause_turn", "pause_turn"], ["model_context_window_exceeded", "context_exceeded"], ["stop_sequence", "unknown"], [null, "unknown"], ["something_new", "unknown"]];
    for (const [stopReason, stop] of cases) {
      const client = fakeAnthropic(() => anthropicTextMessage("ok", { stop_reason: stopReason }));
      const step = await new AnthropicAgentAdapter(client.client as never, "claude-test").start(START);
      expect(step.stop, String(stopReason)).toBe(stop);
      expect(step.stopReason, String(stopReason)).toBe(stopReason); // the raw value still passes through, untouched
    }
  });

  it("3. OpenAI: `status` mapped inside the REAL adapter - completed ends the turn normally unless an output message carries a `refusal` part; incomplete for `max_output_tokens` is max_tokens, any other incomplete is incomplete; failed, cancelled, queued, in progress and a missing status are `unknown`", async () => {
    const refusal = { output: [{ type: "message", role: "assistant", content: [{ type: "refusal", refusal: "I can't help with that." }] }], output_text: "" };
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ status: "completed" }, "end_turn"],
      [{ status: "completed", ...refusal }, "refusal"],
      [{ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }, "max_tokens"],
      [{ status: "incomplete", incomplete_details: { reason: "content_filter" } }, "incomplete"],
      [{ status: "incomplete", incomplete_details: null }, "incomplete"],
      [{ status: "failed" }, "unknown"],
      [{ status: "cancelled" }, "unknown"],
      [{ status: "queued" }, "unknown"],
      [{ status: "in_progress" }, "unknown"],
      [{ status: undefined }, "unknown"],
    ];
    for (const [extra, stop] of cases) {
      const client = fakeOpenAI(() => openAITextResponse("ok", extra));
      const step = await new OpenAIAgentAdapter(client.client as never, "gpt-test", undefined).start(START);
      expect(step.stop, JSON.stringify(extra)).toBe(stop);
    }
  });

  it("4. a SPECIALIST's turn that stops at the output limit or the context window is escalated with that reason and NEVER parsed - even with a complete-looking result call in the same response - on both providers; the DAG goes on", async () => {
    const openai = fakeOpenAI((params) => (roleOf(params) === "requirements-analyst" ? openAIResultResponse("requirements-analyst", {}, { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }) : openAIResultResponse(roleOf(params))));
    const anthropic = fakeAnthropic((params) => (roleOf(params) === "verification-critic" ? anthropicResultMessage("verification-critic", {}, { stop_reason: "model_context_window_exceeded" }) : anthropicResultMessage(roleOf(params))));
    const env = { SIRKIT_ORCHESTRATION_ROLE_MODELS: JSON.stringify({ "verification-critic": { provider: "anthropic", model: "inherit" } }) };
    const { providers } = fakeProviders(openai, anthropic, { env });
    const run = await runE1Dag(["requirements-analyst", "verification-critic", "component-sourcing-evidence"], providers);
    expect(run.ran!.stop).toBe("completed");
    expect(run.ran!.tasks.map((task) => [task.role, task.status, task.provider, task.result])).toEqual([["requirements-analyst", "escalated", "openai", null], ["verification-critic", "escalated", "anthropic", null], ["component-sourcing-evidence", "accepted", "openai", expect.anything()]]);
    expect(run.ran!.tasks[0]!.reason).toBe(SPECIALIST_STOP_REASONS.max_tokens);
    expect(run.ran!.tasks[1]!.reason).toBe(SPECIALIST_STOP_REASONS.context_exceeded);
    const dissent = (await run.store.history(run.scope)).filter((entry) => entry.record.kind === "dissent");
    expect(dissent.map((entry) => [entry.taskId, (entry.record as { decision: string; reason: string }).decision, (entry.record as { reason: string }).reason])).toEqual([["task-1-requirements-analyst", "escalated", SPECIALIST_STOP_REASONS.max_tokens], ["task-2-verification-critic", "escalated", SPECIALIST_STOP_REASONS.context_exceeded]]);
    expect(run.warnings).toContain(`Orchestration: specialist requirements-analyst escalated (task task-1-requirements-analyst, attempt 0): ${SPECIALIST_STOP_REASONS.max_tokens}.`);
  });

  it("5. a refusal is escalated and never retried - not on the same model, not on another (the dated page: not retryable on another model) - on both providers; one call each", async () => {
    const refusal = { output: [{ type: "message", role: "assistant", content: [{ type: "refusal", refusal: "I can't help with that." }] }], output_text: "", status: "completed" };
    const openai = fakeOpenAI((params) => (roleOf(params) === "requirements-analyst" ? openAITextResponse("", refusal) : openAIResultResponse(roleOf(params))));
    const anthropic = fakeAnthropic((params) => (roleOf(params) === "verification-critic" ? anthropicTextMessage("", { stop_reason: "refusal" }) : anthropicResultMessage(roleOf(params))));
    const env = { SIRKIT_ORCHESTRATION_ROLE_MODELS: JSON.stringify({ "verification-critic": { provider: "anthropic", model: "inherit" } }) };
    const { providers } = fakeProviders(openai, anthropic, { env });
    const run = await runE1Dag(["requirements-analyst", "verification-critic"], providers);
    expect(run.ran!.tasks.map((task) => [task.role, task.attempt, task.status, task.reason])).toEqual([["requirements-analyst", 0, "escalated", SPECIALIST_STOP_REASONS.refusal], ["verification-critic", 0, "escalated", SPECIALIST_STOP_REASONS.refusal]]);
    expect(openai.create).toHaveBeenCalledTimes(1);
    expect(anthropic.create).toHaveBeenCalledTimes(1);
    expect(SPECIALIST_STOP_REASONS.refusal).toMatch(/never retried/);
  });

  it("6. the coordinator's loop is unchanged: a coordinator run whose provider stops at the output limit completes exactly as before E1 (its text is the answer; the stop is carried, not read)", async () => {
    const openai = fakeOpenAI(() => openAITextResponse("(partial) the board looks", { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }));
    const events: AgentRunEvent[] = [];
    const result = await runAgentLoop({ runId: "run-b21e1-coordinator", provider: "openai", history: [], userMessage: "How does the board look?", budget: DEFAULT_AGENT_BUDGET }, { adapter: new OpenAIAgentAdapter(openai.client as never, "gpt-fake", undefined), gateway: createAgentToolGateway(REGISTRY), registry: REGISTRY, context: coordinatorContext(), system: AGENT_SYSTEM_PROMPT, emit: (event) => events.push(event) });
    expect(result).toMatchObject({ status: "completed", finalText: "(partial) the board looks", steps: 1 });
    expect(events.at(-1)).toMatchObject({ type: "run_completed", finalText: "(partial) the board looks" });
    // the coordinator is never offered the result tool (it is a specialist's synthetic declaration only)
    expect((openai.calls[0]!.tools as Array<{ name: string }>).map((tool) => tool.name)).not.toContain("sirkit_specialist_result");
  });
});
