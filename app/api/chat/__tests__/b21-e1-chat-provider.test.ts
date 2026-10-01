/**
 * [B21 E1] The provider layer through the PRODUCTION POST (flag on). The request body can never route a role: any key that would
 * carry a role, a provider or a model per role is refused before any provider call; the route binds the production provider layer
 * (`productionSpecialistProviders`), so every specialist's adapter comes from `agentAdapterForRole` - the server env's route for its
 * role, never the coordinator's adapter - while the coordinator's stays `agentAdapterFor`'s. A provider out of credits opens the
 * breaker at once: its request stands down on the coordinator's answer with no second paid specialist call and no follow-up turn,
 * and the NEXT request's specialists make no call at all (the coordinator's own first turn is not gated in E1). The adapters module
 * is the ORIGINAL one with its two factories wrapped: the REAL adapter classes answer through in-process fake clients - no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import { replacementHeadDigestFor } from "@/app/lib/engineering/replacement-proposal-assembler";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { DurableOrchestrationRunStore } from "@/app/lib/agent/orchestration/store";
import { currentLlmProviderPause, resetAdmissionControl } from "@/app/lib/acquisition/admission-control";

type Params = Record<string, unknown>;
const state = vi.hoisted(() => ({
  /** every agentAdapterForRole / agentAdapterFor call: [factory, role, provider, model] */
  factories: [] as Array<[string, string, string, string | undefined]>,
  openai: [] as Params[],
  anthropic: [] as Params[],
  /** whether a specialist's OpenAI call answers `insufficient_quota` */
  quota: false,
}));
const roleOf = (params: Params): string => /^Role: ([a-z-]+)$/m.exec(String(params.instructions ?? params.system ?? ""))?.[1] ?? "coordinator";

vi.mock("@/app/lib/agent/adapters", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/app/lib/agent/adapters")>();
  const usage = { input_tokens: 5, output_tokens: 7 };
  const result = (role: string): Record<string, unknown> => ({ role, summary: `(fake ${role}) nothing found; nothing changed.`, assumptions: [], evidence: [], requiredTools: [], risks: [], unresolvedQuestions: [], validationRequests: [], confidence: "low" });
  const openai = {
    responses: {
      create: async (params: Params) => {
        state.openai.push(params);
        const role = /^Role: ([a-z-]+)$/m.exec(String(params.instructions))?.[1] ?? "coordinator";
        if (role === "coordinator") return { output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "(fake) the coordinator's answer.", annotations: [] }] }], output_text: "(fake) the coordinator's answer.", status: "completed", model: "gpt-fake", usage };
        if (state.quota) throw Object.assign(new Error("You exceeded your current quota"), { status: 429, code: "insufficient_quota" });
        return { output: [{ type: "function_call", call_id: `call-${role}`, name: "sirkit_specialist_result", arguments: JSON.stringify(result(role)) }], output_text: "", status: "completed", model: "gpt-fake", usage };
      },
    },
  };
  const anthropic = {
    messages: {
      create: async (params: Params) => {
        state.anthropic.push(params);
        const role = /^Role: ([a-z-]+)$/m.exec(String(params.system))?.[1] ?? "coordinator";
        return { content: [{ type: "tool_use", id: `toolu_${role.replaceAll("-", "_")}`, name: "sirkit_specialist_result", input: result(role) }], stop_reason: "tool_use", model: "claude-fake", usage };
      },
    },
  };
  return {
    ...original,
    agentAdapterFor: (provider: "openai" | "anthropic") => {
      state.factories.push(["agentAdapterFor", "coordinator", provider, undefined]);
      return provider === "openai" ? new original.OpenAIAgentAdapter(openai as never, "gpt-fake", undefined) : new original.AnthropicAgentAdapter(anthropic as never, "claude-fake");
    },
    agentAdapterForRole: (role: string, provider: "openai" | "anthropic", model?: string) => {
      state.factories.push(["agentAdapterForRole", role, provider, model]);
      return provider === "openai" ? new original.OpenAIAgentAdapter(openai as never, model, undefined, 0) : new original.AnthropicAgentAdapter(anthropic as never, model, 0);
    },
  };
});

import { POST, EDITOR_CONTEXT_SCHEMA } from "../route";
import { ORCHESTRATION_ENABLED_ENV, resetOrchestrationStoreFactory, setOrchestrationStoreFactory } from "../orchestration-runtime";

const SCOPE = { tenantId: "tenant-1", projectId: "project-1", branchId: "main" };
const SCHEMATIC: SchematicState = {
  components: [], wires: [], netLabels: [],
  kicadComponents: [{ id: "u1-id", partId: "lib:part-a", x: 300, y: 100, rotation: 0, refDes: "U1", value: "MCU", atomicPartRevisionId: "rev-current", symbolAssetVersionId: "sym-current" }],
};
const REPLACEMENT = "Delete U1 and replace it with the approved lower-power part while preserving compatible nets.";
function chatBody(sentence: string): Record<string, unknown> {
  const board = createEmptyBoard();
  return {
    provider: "openai", messages: [{ role: "user", content: sentence }], scope: SCOPE, schematicState: SCHEMATIC,
    schematicHeadMark: { lineageId: "lin1-a9e2470c11bd8833", headSequence: 3, canonicalStateDigest: replacementHeadDigestFor(SCHEMATIC, SCOPE) },
    editorContext: { schema: EDITOR_CONTEXT_SCHEMA, scope: SCOPE, board, pcbRevisionId: pcbRevisionId(board), selection: { refs: [], primary: null }, netlist: null, schematicDigest: schematicStateDigest(SCHEMATIC), authoritySource: "local-working-copy" },
  };
}
const postBody = (body: Record<string, unknown>): Promise<Response> => POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
async function post(sentence: string): Promise<Array<Record<string, unknown>>> {
  const response = await postBody(chatBody(sentence));
  expect(response.status).toBe(200);
  return (await response.text()).trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}
const warningsOf = (events: Array<Record<string, unknown>>): string[] => events.filter((event) => (event.type === "warning" || event.type === "plan" || event.type === "specialist_finished" || event.type === "degraded")).map((event) => String(event.message)); // [B21 E2] pin move (OD-126): B's plan, status and stand-down lines are now the plan / specialist_finished / degraded events carrying the same sentence
const terminals = (events: Array<Record<string, unknown>>): Array<Record<string, unknown>> => events.filter((event) => event.type === "run_completed" || event.type === "run_failed");

vi.stubGlobal("fetch", () => { throw new Error("no network"); });
beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
  vi.stubEnv("SIRKIT_ORCHESTRATION_ROLE_MODELS", "");
  vi.stubEnv("SIRKIT_OPENAI_MODEL", "");
  vi.stubEnv("SIRKIT_ANTHROPIC_MODEL", "claude-opus-4-7");
  resetAdmissionControl();
  const store = new DurableOrchestrationRunStore(new InMemoryDurableWorkflowRepository());
  setOrchestrationStoreFactory(() => store);
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetOrchestrationStoreFactory();
  resetAdmissionControl();
  state.factories = [];
  state.openai = [];
  state.anthropic = [];
  state.quota = false;
});

describe("[B21 E1] the provider layer through the production POST", () => {
  it("1. the BODY can never route a role: a key that would carry a role, a provider or a model per role - top level or nested in a control object - is refused 400 before any adapter is built or any provider called", async () => {
    const base = chatBody(REPLACEMENT);
    const bodies: Array<[string, Record<string, unknown>]> = [
      ["roleModels", { ...base, roleModels: { "verification-critic": { provider: "anthropic", model: "claude-opus-5-5" } } }],
      ["specialists", { ...base, specialists: [{ role: "verification-critic", provider: "anthropic" }] }],
      ["model", { ...base, model: "gpt-6-astra" }],
      ["scope.provider", { ...base, scope: { ...SCOPE, provider: "anthropic" } }],
      ["editorContext.roleModels", { ...base, editorContext: { ...(base.editorContext as Record<string, unknown>), roleModels: {} } }],
      ["messages[0].model", { ...base, messages: [{ role: "user", content: REPLACEMENT, model: "claude-opus-5-5" }] }],
    ];
    for (const [label, body] of bodies) {
      const response = await postBody(body);
      expect(response.status, label).toBe(400);
    }
    expect(state.factories).toEqual([]);
    expect([...state.openai, ...state.anthropic]).toEqual([]);
  });

  it("2. the route binds the PRODUCTION provider layer: the coordinator's adapter from agentAdapterFor, every specialist's from agentAdapterForRole with its route - the server env's override (the critic on anthropic) and every other role on the coordinator's provider and configured model; each specialist request carries the result tool", async () => {
    vi.stubEnv("SIRKIT_ORCHESTRATION_ROLE_MODELS", JSON.stringify({ "verification-critic": { provider: "anthropic", model: "claude-sonnet-4-5" } }));
    const events = await post(REPLACEMENT);
    expect(terminals(events)).toHaveLength(1);
    expect(terminals(events)[0]).toMatchObject({ type: "run_completed" });
    expect(state.factories[0]).toEqual(["agentAdapterFor", "coordinator", "openai", undefined]);
    const roles = state.factories.slice(1);
    expect(roles.every(([factory]) => factory === "agentAdapterForRole")).toBe(true);
    expect(roles).toContainEqual(["agentAdapterForRole", "verification-critic", "anthropic", "claude-sonnet-4-5"]);
    expect(roles).toContainEqual(["agentAdapterForRole", "circuit-topology", "openai", "gpt-5.6-sol"]);
    expect(state.anthropic.map(roleOf)).toEqual(["verification-critic"]);
    for (const params of [...state.openai.filter((entry) => roleOf(entry) !== "coordinator"), ...state.anthropic]) {
      expect((params.tools as Array<{ name: string }>).map((tool) => tool.name), roleOf(params)).toContain("sirkit_specialist_result");
    }
    for (const params of state.openai.filter((entry) => roleOf(entry) === "coordinator")) {
      expect(((params.tools as Array<{ name: string }> | undefined) ?? []).map((tool) => tool.name)).not.toContain("sirkit_specialist_result");
    }
  });

  it("3. a provider out of credits: the first specialist's 429 opens the breaker at once and its request stands down on the coordinator's answer - ONE paid specialist call, no follow-up turn; the NEXT request makes no call at all - since B21-E4 not even the coordinator's first turn (D21-39) - and answers ONE run_failed `provider_breaker_open` with no orchestration line; one terminal per stream", async () => { // [B21 closeout, 2026-09-29] retitled (D21-27, OD-113): the first turn gated since B21-E4 (D21-39); assertions unchanged
    state.quota = true;
    const first = await post(REPLACEMENT);
    expect(terminals(first)).toEqual([expect.objectContaining({ type: "run_completed", finalText: "(fake) the coordinator's answer." })]);
    expect(warningsOf(first).some((line) => line.startsWith("Orchestration: the provider failed during the specialists (provider_outage)"))).toBe(true);
    expect(state.openai.map(roleOf)).toEqual(["coordinator", "circuit-topology"]);
    expect(currentLlmProviderPause({ kind: "llm-provider", provider: "openai" }, Date.now(), "agent")).toMatchObject({ reason: "breaker_open" });
    const second = await post(REPLACEMENT);
    // [B21 E4] reviewed pin move (D21-39 closed): the route gates the coordinator's FIRST turn behind the same pause, so the next request
    // makes no call at all - not even the coordinator's - and answers ONE run_failed `provider_breaker_open` (the card withholds its Retry)
    // carrying the meters' pause sentence, with no orchestration line; the runtime's `provider_paused` stand-down is still reached when the
    // breaker opens DURING a request (b21-e2-chat-events case 5)
    expect(terminals(second)).toEqual([expect.objectContaining({ type: "run_failed", reason: "provider_breaker_open", message: expect.stringMatching(/^No model call was made for this message: LLM provider "openai" is paused \(insufficient_quota\)/) })]);
    expect(state.openai.map(roleOf)).toEqual(["coordinator", "circuit-topology"]); // no call at all: no coordinator turn, no specialist, no follow-up
    expect(second.map((event) => event.type)).toEqual(["run_started", "run_failed"]);
    expect(warningsOf(second)).toEqual([]);
    expect(state.anthropic).toEqual([]);
  });
});
