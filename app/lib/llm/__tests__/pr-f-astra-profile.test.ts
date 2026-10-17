/**
 * [PR-F] Astra increment A (directive 2-4; CONTINUATION B): `gpt-6-astra` is a QUALIFIABLE OpenAI profile, never a default and never
 * admitted merely because its id parses. Pinned here, offline, against FAKE Responses clients (no SDK client is built, no network):
 *  - the profile (openai-config.ts: the documented id, label, context and output limits read 2026-10-17, the documented reasoning
 *    efforts and the pinned one, admission "server-env") and the two family rules extended by exactly that id; the gpt-5.6 profiles
 *    and DEFAULT_OPENAI_MODEL unchanged; a documented sibling id (gpt-6-luna, gpt-6-sol, gpt-6.1-sol) outside both rules;
 *  - the effort bound: an env effort outside the documented set is never sent (the pinned "high" is), the gpt-5.6 family keeps
 *    today's effort exactly, and the deployment configuration's mirror reports the same value the adapters send;
 *  - admission: qualifiedModel is FALSE with an empty env, TRUE only as the configured model or when the role map names it; a route
 *    resolves to Astra only through SIRKIT_ORCHESTRATION_ROLE_MODELS, every other role inherits gpt-5.6-sol;
 *  - the request the two adapters build for the profile: no temperature, the pinned effort, strict tools, manual continuation
 *    (store false, the reasoning items requested and round-tripped), and the result labelled with the model the PROVIDER reported -
 *    a fake answering as another model labels the step with THAT model, never as Astra; a breaker fallback's route names where it ran.
 * Fake-backed tests establish contracts, not Astra's engineering quality (directive 4): nothing here is live qualification.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAIAgentAdapter } from "@/app/lib/agent/adapters";
import type { ProviderToolDeclaration } from "@/app/lib/agent/contracts";
import { ROLE_MODELS_ENV, decideSpecialistRoute, qualifiedModel, resolveRoleRoute, type LlmProviderAdmissionPort } from "@/app/lib/agent/orchestration/provider-policy";
import { SPECIALIST_ROLES } from "@/app/lib/agent/orchestration/contracts";
import { buildDeploymentConfiguration } from "@/app/lib/deployment/configuration";
import { DEFAULT_ANTHROPIC_MODEL } from "@/app/lib/llm/anthropic-config";
import {
  DEFAULT_OPENAI_MODEL,
  OPENAI_NO_TEMPERATURE_MODEL_FAMILY,
  OPENAI_REASONING_MODEL_FAMILY,
  boundOpenAIReasoningEffort,
  configuredOpenAIModel,
  configuredOpenAIReasoningEffort,
  openAIModelProfile,
} from "@/app/lib/llm/openai-config";
import { OpenAIProvider } from "@/app/lib/llm/openai-provider";

const ROOT = process.cwd();
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${String.fromCharCode(13)}${String.fromCharCode(10)}`, String.fromCharCode(10));
const ASTRA = "gpt-6-astra";
/** The documented siblings (developers.openai.com, read 2026-10-17): real ids, no Sirkit profile, so outside both rules. */
const SIBLINGS = ["gpt-6-luna", "gpt-6-sol", "gpt-6.1-sol", "gpt-6", "gpt-6-astra-2026-04-30", "gpt-6-astral"];
const DOCUMENTED_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
const SPECIALISTS = SPECIALIST_ROLES.filter((role) => role !== "coordinator");
const roleMap = (map: Record<string, { provider: string; model: string }>): Record<string, string | undefined> => ({ [ROLE_MODELS_ENV]: JSON.stringify(map) });

/** A fake Responses client answering ONE text message as the model named: the params of every call are kept. */
function fakeResponses(answerModel: string): { client: { responses: { create: (params: Record<string, unknown>) => Promise<Record<string, unknown>> } }; calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  const client = {
    responses: {
      create: async (params: Record<string, unknown>): Promise<Record<string, unknown>> => {
        calls.push(params);
        return { id: "resp-fake", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "ok", annotations: [] }] }], output_text: "ok", status: "completed", model: answerModel, usage: { input_tokens: 3, output_tokens: 2 } };
      },
    },
  };
  return { client, calls };
}
const TOOLS: ProviderToolDeclaration[] = [
  { providerName: "sirkit_schematic_inspect", toolId: "sirkit.schematic.inspect", version: "1.1.0", description: "Inspect the verified schematic.", inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false } },
  { providerName: "sirkit_pcb_board_inspect", toolId: "sirkit.pcb.board-inspect", version: "1.1.0", description: "Inspect the board.", inputSchema: { type: "object", properties: { detail: { type: ["string", "null"] } }, required: ["detail"], additionalProperties: false } },
];

afterEach(() => vi.unstubAllEnvs());

describe("[PR-F] the gpt-6-astra profile: qualifiable, never the default, never admitted by its id alone", () => {
  it("1. the profile is the documented id with the documented limits and efforts, admission pinned to the server env; both family rules classify exactly it; the gpt-5.6 profiles, DEFAULT_OPENAI_MODEL and the two environment readers are unchanged; a documented sibling id is outside both rules and has no profile", () => {
    expect(openAIModelProfile(ASTRA)).toEqual({ id: ASTRA, label: "GPT-6 Astra", contextWindowTokens: 1_050_000, maxOutputTokens: 128_000, reasoningEfforts: [...DOCUMENTED_EFFORTS], reasoningEffort: "high", admission: "server-env" });
    for (const [id, label] of [["gpt-5.6", "GPT-5.6 Sol"], ["gpt-5.6-sol", "GPT-5.6 Sol"], ["gpt-5.6-terra", "GPT-5.6 Terra"], ["gpt-5.6-luna", "GPT-5.6 Luna"]] as const) {
      expect(openAIModelProfile(id), id).toEqual({ id, label, contextWindowTokens: 1_050_000, maxOutputTokens: 128_000 }); // no pin, no admission: today's profiles exactly
    }
    for (const sibling of SIBLINGS) {
      expect(openAIModelProfile(sibling), sibling).toEqual({ id: sibling, label: sibling });
      expect(OPENAI_REASONING_MODEL_FAMILY.test(sibling), sibling).toBe(false);
      expect(OPENAI_NO_TEMPERATURE_MODEL_FAMILY.test(sibling), sibling).toBe(false);
    }
    expect(OPENAI_REASONING_MODEL_FAMILY.test(ASTRA)).toBe(true);
    expect(OPENAI_NO_TEMPERATURE_MODEL_FAMILY.test(ASTRA)).toBe(true);
    for (const model of ["gpt-5.6", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) expect(OPENAI_REASONING_MODEL_FAMILY.test(model) && OPENAI_NO_TEMPERATURE_MODEL_FAMILY.test(model), model).toBe(true);
    expect(DEFAULT_OPENAI_MODEL).toBe("gpt-5.6-sol");
    expect(configuredOpenAIModel({})).toBe("gpt-5.6-sol");
    expect(configuredOpenAIModel({ SIRKIT_OPENAI_MODEL: ASTRA })).toBe(ASTRA); // the existing configured-model path, unchanged
    const source = read("app/lib/llm/openai-config.ts");
    expect(source.split(String.fromCharCode(10))[0]).toBe('export const DEFAULT_OPENAI_MODEL = "gpt-5.6-sol";');
    expect(source.match(/"gpt-6-astra": \{/g)).toHaveLength(1); // one profile entry
    expect(source.match(/SIRKIT_[A-Z_]+/g)).toEqual(["SIRKIT_OPENAI_MODEL", "SIRKIT_OPENAI_REASONING_EFFORT"]); // no new environment name (the B24-A2 census stays as it is)
    expect(read("app/lib/llm/anthropic-config.ts")).not.toContain("PR-F"); // the Anthropic configuration is untouched
  });

  it("2. the effort bound: with no configured effort the pinned 'high'; a documented effort is sent as configured; `none`, `minimal` or an unknown value is never sent to Astra (the pinned 'high' is); the gpt-5.6 family keeps today's effort exactly; a model outside the reasoning family has none; the deployment configuration reports what the adapters send", () => {
    const configured = (value: string | undefined, model: string): string | undefined => {
      if (value === undefined) vi.stubEnv("SIRKIT_OPENAI_REASONING_EFFORT", undefined);
      else vi.stubEnv("SIRKIT_OPENAI_REASONING_EFFORT", value);
      return configuredOpenAIReasoningEffort(model);
    };
    expect(configured(undefined, ASTRA)).toBe("high");
    expect(configured("", ASTRA)).toBe("high");
    for (const effort of DOCUMENTED_EFFORTS) expect(configured(effort, ASTRA), effort).toBe(effort);
    expect(configured(" XHIGH ", ASTRA)).toBe("xhigh");
    for (const outside of ["none", "minimal", "turbo", "highest"]) expect(configured(outside, ASTRA), outside).toBe("high"); // the reasoning guide (read 2026-10-17): `none` on Astra is HTTP 400 - never sent
    for (const effort of ["none", "minimal", "low", "medium", "high", "xhigh", "max"]) expect(configured(effort, "gpt-5.6-sol"), effort).toBe(effort); // today's behaviour, unchanged
    expect(configured("turbo", "gpt-5.6-sol")).toBe("high");
    expect(configured("low", "gpt-6-luna")).toBeUndefined();
    expect(boundOpenAIReasoningEffort(ASTRA, "none")).toBe("high");
    expect(boundOpenAIReasoningEffort(ASTRA, "max")).toBe("max");
    expect(boundOpenAIReasoningEffort("gpt-5.6-sol", "none")).toBe("none");
    expect(boundOpenAIReasoningEffort("gpt-6-luna", "minimal")).toBe("minimal");
    // the deployment configuration's mirror (configuration.ts) applies the same bound, so the record reports the value the adapters send
    for (const effort of [undefined, "none", "minimal", "low", "max", "turbo"]) {
      const env = { SIRKIT_OPENAI_MODEL: ASTRA, ...(effort === undefined ? {} : { SIRKIT_OPENAI_REASONING_EFFORT: effort }) };
      expect(buildDeploymentConfiguration(env).providers.openai.reasoningEffort, String(effort)).toBe(configured(effort, ASTRA) ?? null);
    }
    expect(buildDeploymentConfiguration({ SIRKIT_OPENAI_MODEL: ASTRA, SIRKIT_OPENAI_REASONING_EFFORT: "none" }).providers.openai.reasoningEffort).toBe("high");
  });

  it("3. admission: qualifiedModel is FALSE for Astra with an empty env and with a role map naming another model, TRUE only as the configured model or when the role map names Astra (its provider, or inherit); a refused map admits nothing; a sibling id is never admitted; resolveRoleRoute reaches Astra ONLY for the role the server env routes to it - every other role, and every role without the override, inherits gpt-5.6-sol", () => {
    expect(qualifiedModel("openai", ASTRA, {})).toBe(false);
    expect(qualifiedModel("openai", ASTRA, roleMap({ schematic: { provider: "openai", model: "gpt-5.6-luna" } }))).toBe(false);
    expect(qualifiedModel("openai", ASTRA, { SIRKIT_OPENAI_MODEL: ASTRA })).toBe(true); // the configured model: today's rule
    expect(qualifiedModel("openai", ASTRA, roleMap({ schematic: { provider: "openai", model: ASTRA } }))).toBe(true);
    expect(qualifiedModel("openai", ASTRA, roleMap({ "verification-critic": { provider: "inherit", model: ASTRA } }))).toBe(true);
    expect(qualifiedModel("openai", ASTRA, { [ROLE_MODELS_ENV]: "{not json" })).toBe(false); // a refused map names nothing
    expect(qualifiedModel("anthropic", ASTRA, roleMap({ schematic: { provider: "inherit", model: ASTRA } }))).toBe(false); // judged by the provider it lands on
    for (const sibling of SIBLINGS) expect(qualifiedModel("openai", sibling, roleMap({ schematic: { provider: "openai", model: sibling } })), sibling).toBe(false);
    for (const model of ["gpt-5.6", "gpt-5.6-terra", "gpt-5.6-luna"]) expect(qualifiedModel("openai", model, {}), model).toBe(true); // the family's admission, unchanged
    // the route
    for (const role of SPECIALISTS) expect(resolveRoleRoute(role, "openai", {}), role).toMatchObject({ ok: true, route: { provider: "openai", model: DEFAULT_OPENAI_MODEL, source: "inherit" } });
    const env = roleMap({ schematic: { provider: "openai", model: ASTRA } });
    expect(resolveRoleRoute("schematic", "openai", env)).toEqual({ ok: true, route: { role: "schematic", provider: "openai", model: ASTRA, source: "env", sdkMaxRetries: 0, fallbackFrom: null } });
    for (const role of SPECIALISTS.filter((candidate) => candidate !== "schematic")) expect(resolveRoleRoute(role, "openai", env), role).toMatchObject({ ok: true, route: { provider: "openai", model: DEFAULT_OPENAI_MODEL, source: "inherit" } });
    expect(resolveRoleRoute("coordinator", "openai", env)).toMatchObject({ ok: false, refusal: { code: "provider_policy_invalid" } }); // the coordinator is never routed
    const luna = resolveRoleRoute("schematic", "openai", roleMap({ schematic: { provider: "openai", model: "gpt-6-luna" } }));
    expect(luna).toMatchObject({ ok: false, refusal: { code: "model_unqualified", provider: "openai", model: "gpt-6-luna" } });
    if (!luna.ok) expect(luna.refusal.detail).toMatch(/until it is qualified live \(LB-9\)/);
    expect(resolveRoleRoute("schematic", "anthropic", roleMap({ schematic: { provider: "inherit", model: ASTRA } }))).toMatchObject({ ok: false, refusal: { code: "model_unqualified", provider: "anthropic", model: ASTRA } });
  });

  it("4. the request the agent adapter builds for the profile from a FAKE Responses client: the documented id, the pinned effort (an env `none` never sent), no temperature or top_p, every tool strict, manual continuation (store false, reasoning items requested and the output round-tripped), sequential tool calls; the step is labelled with the model the PROVIDER reported", async () => {
    vi.stubEnv("SIRKIT_OPENAI_REASONING_EFFORT", "none");
    const fake = fakeResponses(ASTRA);
    const adapter = new OpenAIAgentAdapter(fake.client as never, ASTRA, configuredOpenAIReasoningEffort(ASTRA), 0);
    const step = await adapter.start({ system: "sys", history: [], userMessage: "hello", tools: TOOLS });
    const params = fake.calls[0]!;
    expect(params).toMatchObject({ model: ASTRA, instructions: "sys", reasoning: { effort: "high" }, store: false, include: ["reasoning.encrypted_content"], parallel_tool_calls: false, tool_choice: "auto", max_output_tokens: 4096, stream: false });
    expect("temperature" in params).toBe(false);
    expect("top_p" in params).toBe(false);
    expect(params.tools).toEqual(TOOLS.map((tool) => ({ type: "function", name: tool.providerName, description: tool.description, parameters: tool.inputSchema, strict: true })));
    expect(step.model).toBe(ASTRA);
    expect(step.stop).toBe("end_turn");
    expect(step.usage).toEqual({ inputTokens: 3, outputTokens: 2 });
    // the continuation carries the response's output items verbatim, after the prior input (the reasoning items would ride the same list)
    await adapter.continueWith({ continuation: step.continuation, results: [], tools: TOOLS });
    const second = fake.calls[1]!;
    expect(second).toMatchObject({ model: ASTRA, reasoning: { effort: "high" }, store: false, include: ["reasoning.encrypted_content"] });
    expect((second.input as unknown[]).length).toBe(2);
    expect((second.input as Array<Record<string, unknown>>)[1]).toMatchObject({ type: "message", role: "assistant" });
  });

  it("5. the model label is the provider's own, never the requested one: a fake answering as gpt-5.6-sol to a request for Astra labels the step and the LLMResponse 'gpt-5.6-sol' (a fallback or alias is disclosed, never described as Astra-generated); the OpenAIProvider path sends no temperature for Astra even when the request asks for one and keeps its strict tools; a breaker fallback's route names the provider and model it ran on and where it came from", async () => {
    const agentFake = fakeResponses("gpt-5.6-sol");
    const agent = new OpenAIAgentAdapter(agentFake.client as never, ASTRA, "high", 0);
    const step = await agent.start({ system: "sys", history: [], userMessage: "hello", tools: [] });
    expect(agentFake.calls[0]).toMatchObject({ model: ASTRA });
    expect(step.model).toBe("gpt-5.6-sol");
    expect(step.model).not.toBe(ASTRA);
    const providerFake = fakeResponses("gpt-5.6-sol");
    const provider = new OpenAIProvider(providerFake.client as never, ASTRA, configuredOpenAIReasoningEffort(ASTRA));
    const response = await provider.generate({ provider: "openai", messages: [{ role: "user", content: "hello" }], temperature: 0, maxTokens: 512, tools: [{ name: "inspect_board", description: "Inspect", inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false }, strict: true }] });
    const params = providerFake.calls[0]!;
    expect(params).toMatchObject({ model: ASTRA, reasoning: { effort: "high" }, store: false, max_output_tokens: 512, tool_choice: "auto" });
    expect(params.temperature).toBeUndefined();
    expect((params.tools as Array<{ strict: boolean }>)[0]!.strict).toBe(true);
    expect(response).toMatchObject({ provider: "openai", model: "gpt-5.6-sol", text: "ok", toolCalls: [], usage: { inputTokens: 3, outputTokens: 2 } });
    // a specialist routed to Astra whose provider's breaker is OPEN falls back to the other provider's configured model: the route says so
    const message = "openai is paused: the llm-provider breaker is open until <ISO>.";
    const admission: LlmProviderAdmissionPort = {
      pause: (paused) => (paused === "openai" ? { reason: "breaker_open", message, retryAtMs: 1 } : null),
      request: () => { throw new Error("not admitted here"); },
      record: () => { throw new Error("not recorded here"); },
    };
    const decision = decideSpecialistRoute({ role: "schematic", coordinatorProvider: "anthropic", providers: { adapterFor: () => { throw new Error("no adapter here"); }, admission, environment: roleMap({ schematic: { provider: "openai", model: ASTRA } }) }, now: 0, compatibility: () => ({ compatible: true }) });
    expect(decision).toEqual({ kind: "run", route: { role: "schematic", provider: "anthropic", model: DEFAULT_ANTHROPIC_MODEL, source: "env", sdkMaxRetries: 0, fallbackFrom: { provider: "openai", model: ASTRA, pause: message } } });
  });
});
