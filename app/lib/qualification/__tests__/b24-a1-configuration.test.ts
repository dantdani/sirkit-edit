/**
 * [B24-A1] The versioned deployment configuration and the runtime report (D24-10, OD-199).
 *
 * `buildDeploymentConfiguration(env)` is one deep-frozen `sirkit.deployment-configuration.v1` record, digested by `engineeringDigest`:
 * the profile and auth mode, OpenAI's model, effort, timeout and retries, the Anthropic model setting, timeout and retries, the role
 * table, the three registry versions each beside a digest of its rows, the embedding and rerank models (copied, never imported), the
 * runtime profiles (referenced), the tool registry digest, key presence and every flag state. It holds names and closed states only.
 * The Anthropic model is a decision now: an empty or padded `SIRKIT_ANTHROPIC_MODEL` is refused - reported as no model by
 * `/api/ai/runtime` and never sent by either Anthropic client - and the coordinator's Anthropic client gains OpenAI's `timeout: 120_000`.
 *
 * Failing first on 8664964: the modules do not exist, the route reports `claude-opus-4-7` while the adapter sends "", and the
 * coordinator's Anthropic client carries no timeout (page section 8). The SDK modules are mocked: no client can reach a provider.
 * Nothing is written to disk; every credential is an obvious fake assembled at run time.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ openai: [] as Array<Record<string, unknown>>, anthropic: [] as Array<Record<string, unknown>>, requests: [] as Array<Record<string, unknown>> }));
vi.mock("openai", () => ({
  default: class {
    readonly responses = { create: async (params: Record<string, unknown>) => { sdk.requests.push(params); return { output: [{ type: "message", role: "assistant", content: [] }], output_text: "ok", status: "completed", model: String(params.model), usage: { input_tokens: 1, output_tokens: 1 } }; } };
    constructor(options: Record<string, unknown>) { sdk.openai.push(options); }
  },
}));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    readonly messages = { create: async (params: Record<string, unknown>) => { sdk.requests.push(params); return { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", model: String(params.model), usage: { input_tokens: 1, output_tokens: 1 } }; } };
    constructor(options: Record<string, unknown>) { sdk.anthropic.push(options); }
  },
}));

import { GET as runtimeRoute } from "@/app/api/ai/runtime/route";
import { SOURCE_REGISTRY, SOURCE_REGISTRY_VERSION } from "@/app/lib/acquisition/source-registry";
import { AnthropicAgentAdapter, SPECIALIST_SDK_MAX_RETRIES, agentAdapterFor, agentAdapterForRole } from "@/app/lib/agent/adapters";
import { ROLE_MODELS_ENV, ROLE_PROVIDER_POLICY, parseRoleModelOverrides } from "@/app/lib/agent/orchestration/provider-policy";
import { RUNTIME_PROFILE_IDS, runtimeProfiles } from "@/app/lib/computation/runtime-profile";
import {
  ANTHROPIC_CLIENTS,
  DEPLOYMENT_CONFIGURATION_SCHEMA,
  EMBEDDING_CONFIGURATION,
  OPENAI_CLIENTS,
  PARTS_SEARCH_RERANK_CONFIGURATION,
  __resetDeploymentConfigurationForTests,
  buildDeploymentConfiguration,
  deploymentConfiguration,
} from "@/app/lib/deployment/configuration";
import { FLAG_INVENTORY } from "@/app/lib/deployment/flag-inventory";
import { engineeringDigest } from "@/app/lib/engineering/stable";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { DEFAULT_ANTHROPIC_MODEL, anthropicModelSetting, configuredAnthropicModel } from "@/app/lib/llm/anthropic-config";
import { sendableAnthropicModel } from "@/app/lib/llm/anthropic-model-guard";
import { AnthropicProvider } from "@/app/lib/llm/anthropic-provider";
import { LLMProviderError } from "@/app/lib/llm/errors";
import { DEFAULT_OPENAI_MODEL, configuredOpenAIModel, configuredOpenAIReasoningEffort } from "@/app/lib/llm/openai-config";
import type { LLMRequest } from "@/app/lib/llm/types";
import { orderingEnablement } from "@/app/lib/manufacturing-providers/ordering-enablement";
import { PROVIDER_REGISTRY_VERSION, PROVIDER_ROWS } from "@/app/lib/manufacturing-providers/provider-registry";
import { MCP_SERVER_REGISTRY, MCP_SERVER_REGISTRY_VERSION } from "@/app/lib/mcp/server-registry";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE);
type Env = Record<string, string | undefined>;
/** obvious fakes, assembled at run time */
const FAKE_KEY = ["fx", "b24", "a1", "0000", "fake"].join("-");
const SENTINELS: Env = {
  OPENAI_API_KEY: ["b24", "openai", "sentinel"].join("-"),
  ANTHROPIC_API_KEY: ["b24", "anthropic", "sentinel"].join("-"),
  SIRKIT_WORKFLOW_WORKER_SECRET: ["b24", "worker", "sentinel"].join("-"),
  SIRKIT_MCP_TOKEN_SECRET: ["b24", "mcp", "sentinel", "0123456789abcdef0123456789abcdef"].join("-"),
  DATABASE_URL: ["postgres://b24", "dbpass-sentinel@db.invalid/sirkit"].join(":"),
  NEXT_PUBLIC_SUPABASE_URL: "https://b24-supabase-sentinel.example",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ["b24", "publishable", "sentinel"].join("-"),
  SIRKIT_EXPECTED_ORIGIN: "https://b24-origin-sentinel.example",
  SIRKIT_DB_QUALIFICATION_URL: ["postgres://b24", "qualpass-sentinel@db.invalid/q"].join(":"),
  KICAD_HTTP_LIBRARY_TOKEN: ["b24", "kicad", "sentinel"].join("-"),
  // [B24-A1 review] tests-1: a flag's value is never echoed either - a stage and two lists the owners would not admit
  SIRKIT_PCB_SYNC_STAGE3: ["b24", "stage", "sentinel"].join("-"),
  SIRKIT_MCP_DISABLED_SERVERS: ["b24", "mcp", "list", "sentinel"].join("-"),
  SIRKIT_ACQUISITION_DISABLED_SOURCES: ["b24", "source", "list", "sentinel"].join("-"),
};
const START = { system: "sys", history: [], userMessage: "hi", tools: [] };
const ANTHROPIC_MESSAGE = { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", model: "claude-test", usage: { input_tokens: 1, output_tokens: 1 } };
function fakeAnthropic(): { client: never; calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  const messages = {
    create: async (params: Record<string, unknown>) => { calls.push(params); return ANTHROPIC_MESSAGE; },
    stream: (params: Record<string, unknown>) => { calls.push(params); throw new Error("stream not expected"); },
  };
  return { client: { messages } as never, calls };
}
const without = (value: object, key: string): Record<string, unknown> => Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
/** [B24-A1 review] tests-5: a `const NAME = [...]` (or `Object.freeze([...])`) string-list literal, read from its file. */
const literalList = (path: string, name: string): string[] => {
  const body = new RegExp(`const ${name}(?::[^=]+)? = (?:Object\\.freeze\\()?\\[([^\\]]*)\\]`).exec(read(path))?.[1];
  if (body === undefined) throw new Error(`no ${name} list in ${path}`);
  return JSON.parse(`[${body}]`) as string[];
};
const isDeepFrozen = (value: unknown): boolean => value === null || typeof value !== "object" || (Object.isFrozen(value) && Object.values(value).every(isDeepFrozen));
async function runtimeBody(): Promise<{ status: number; body: { providers: { anthropic: { model: string | null; label: string }; openai: Record<string, unknown> }; embeddings: { provider: string; model: string } } }> {
  const response = await runtimeRoute(new Request("http://localhost:3100/api/ai/runtime"));
  return { status: response.status, body: await response.json() };
}

afterEach(() => {
  vi.unstubAllEnvs();
  sdk.openai.length = 0;
  sdk.anthropic.length = 0;
  sdk.requests.length = 0;
  __resetDeploymentConfigurationForTests();
});

describe("[B24-A1] the deployment configuration record (OD-199)", () => {
  it("1. one deep-frozen sirkit.deployment-configuration.v1 record whose digest is engineeringDigest of everything else; any field change moves it; the same environment gives the same digest", () => {
    const record = buildDeploymentConfiguration({});
    expect(record.schema).toBe(DEPLOYMENT_CONFIGURATION_SCHEMA);
    expect(DEPLOYMENT_CONFIGURATION_SCHEMA).toBe("sirkit.deployment-configuration.v1");
    expect(isDeepFrozen(record)).toBe(true);
    expect(Object.keys(record).sort()).toEqual(["authMode", "digest", "embeddings", "flags", "partsSearchRerank", "profile", "providers", "registries", "roleTable", "runtimeProfiles", "schema", "toolRegistryDigest"]);
    expect(record.digest).toBe(engineeringDigest(without(record, "digest")));
    expect(buildDeploymentConfiguration({}).digest).toBe(record.digest);
    const digests = new Set([record.digest]);
    for (const change of [{ SIRKIT_DEPLOYMENT_ENV: "ci" }, { NODE_ENV: "production" }, { SIRKIT_AUTH_MODE: "production" }, { SIRKIT_OPENAI_MODEL: "gpt-5.6-terra" }, { SIRKIT_OPENAI_REASONING_EFFORT: "low" }, { SIRKIT_ANTHROPIC_MODEL: "claude-sonnet-4-5" }, { SIRKIT_ANTHROPIC_MODEL: "" }, { [ROLE_MODELS_ENV]: JSON.stringify({ "circuit-topology": { provider: "anthropic", model: "inherit" } }) }, { OPENAI_API_KEY: FAKE_KEY }, { SIRKIT_MCP_ENABLED: "1" }, { SIRKIT_DIAGNOSTIC_RUNNER_DISABLED: "1" }, { SIRKIT_PCB_SYNC_STAGE3: "opt_in" }] as Env[]) {
      const changed = buildDeploymentConfiguration(change).digest;
      expect(digests.has(changed), JSON.stringify(change)).toBe(false);
      digests.add(changed);
    }
  });

  it("2. it holds names and closed states only: no secret, URL, origin, key or connection string the environment holds ever appears; a key is present or absent, never its value", () => {
    const text = JSON.stringify(buildDeploymentConfiguration({ ...SENTINELS, NODE_ENV: "production", SIRKIT_DEPLOYMENT_ENV: "production" }));
    for (const [name, value] of Object.entries(SENTINELS)) expect(text, name).not.toContain(value!);
    expect(text).not.toMatch(/sentinel/i);
    const keyed = buildDeploymentConfiguration({ OPENAI_API_KEY: FAKE_KEY, ANTHROPIC_API_KEY: "   " });
    expect(keyed.providers.openai.apiKey).toBe("present");
    expect(keyed.providers.anthropic.apiKey).toBe("absent");
    expect(buildDeploymentConfiguration({}).providers.openai.apiKey).toBe("absent");
    expect(buildDeploymentConfiguration({ ANTHROPIC_API_KEY: FAKE_KEY }).providers.anthropic.apiKey).toBe("present");
  });

  it("3. OpenAI: the model by configuredOpenAIModel's rule (trimmed, defaulted), the effort by openai-config.ts:47-50 - equal to configuredOpenAIReasoningEffort under a stubbed process.env for every value ([B24-A1 review] tests-5: over the source's own list, which the record's copy equals) - and the adapter's client, read from adapters.ts: timeout 120_000 on the new OpenAI( line, maxRetries: number = 2", () => {
    for (const model of [undefined, "", "  ", "gpt-5.6-terra", " gpt-5.6-luna ", "o3-mini"]) {
      const env: Env = model === undefined ? {} : { SIRKIT_OPENAI_MODEL: model };
      expect(buildDeploymentConfiguration(env).providers.openai.model, String(model)).toBe(configuredOpenAIModel(env));
    }
    expect(buildDeploymentConfiguration({}).providers.openai.model).toBe(DEFAULT_OPENAI_MODEL);
    // [B24-A1 review] tests-5: the efforts accepted, read from openai-config.ts (not exported there), equal the record's copy, read from
    // configuration.ts; the samples are the source's own list, its re-cased and padded spellings, and values outside it
    const sourceEfforts = literalList("app/lib/llm/openai-config.ts", "REASONING_EFFORTS");
    expect(sourceEfforts.length).toBeGreaterThanOrEqual(7);
    expect(literalList("app/lib/deployment/configuration.ts", "OPENAI_REASONING_EFFORTS")).toEqual(sourceEfforts);
    for (const model of ["gpt-5.6-sol", "gpt-5.6", "o3-mini"]) {
      for (const effort of [undefined, "", " ", ...sourceEfforts, ...sourceEfforts.map((name) => ` ${name.toUpperCase()} `), " LOW ", "Medium", "turbo", "highest", "ultra"]) {
        vi.stubEnv("SIRKIT_OPENAI_REASONING_EFFORT", effort);
        const env: Env = { SIRKIT_OPENAI_MODEL: model, ...(effort === undefined ? {} : { SIRKIT_OPENAI_REASONING_EFFORT: effort }) };
        expect(buildDeploymentConfiguration(env).providers.openai.reasoningEffort, `${model} ${String(effort)}`).toBe(configuredOpenAIReasoningEffort(model) ?? null);
      }
    }
    expect(OPENAI_CLIENTS.agentCoordinator).toEqual({ timeoutMs: 120_000, maxRetries: 2 });
    expect(buildDeploymentConfiguration({}).providers.openai.clients.agentCoordinator).toEqual({ timeoutMs: 120_000, maxRetries: 2 });
    const adapters = read("app/lib/agent/adapters.ts").split(NEWLINE);
    const openaiClient = adapters.filter((line) => line.includes("new OpenAI("));
    expect(openaiClient).toHaveLength(1);
    expect(openaiClient[0]).toContain("timeout: 120_000");
    expect(adapters.filter((line) => /private readonly maxRetries: number = 2\b/.test(line))).toHaveLength(1);
  });

  it("4. Anthropic: the model setting (below), its timeout 120_000 and the coordinator's retries `sdk-default`, read from adapters.ts: the new Anthropic( call carries timeout: 120_000 and the constructor's maxRetries?: number has no default", () => {
    expect(ANTHROPIC_CLIENTS.agentCoordinator).toEqual({ timeoutMs: 120_000, maxRetries: "sdk-default" });
    expect(buildDeploymentConfiguration({}).providers.anthropic).toMatchObject({ clients: { agentCoordinator: { timeoutMs: 120_000, maxRetries: "sdk-default" } }, model: { state: "default", model: DEFAULT_ANTHROPIC_MODEL } });
    expect(buildDeploymentConfiguration({ SIRKIT_ANTHROPIC_MODEL: "claude-sonnet-4-5" }).providers.anthropic.model).toEqual({ state: "configured", model: "claude-sonnet-4-5" });
    for (const [value, refusal] of [["", "SIRKIT_ANTHROPIC_MODEL_EMPTY"], ["   ", "SIRKIT_ANTHROPIC_MODEL_EMPTY"], [" claude-x", "SIRKIT_ANTHROPIC_MODEL_PADDED"], ["claude-x ", "SIRKIT_ANTHROPIC_MODEL_PADDED"]] as const) {
      const model = buildDeploymentConfiguration({ SIRKIT_ANTHROPIC_MODEL: value }).providers.anthropic.model;
      expect(model, JSON.stringify(value)).toEqual({ state: "refused", refusal });
    }
    const adapters = read("app/lib/agent/adapters.ts").split(NEWLINE);
    const anthropicClient = adapters.filter((line) => line.includes("new Anthropic("));
    expect(anthropicClient).toHaveLength(1);
    expect(anthropicClient[0]).toContain("timeout: 120_000");
    // B21-E1's C19 anchor stays unique to the OpenAI line (the Anthropic options are spelled in another order)
    expect(adapters.filter((line) => line.includes("maxRetries: this.maxRetries, timeout: 120_000"))).toHaveLength(1);
    const constructor = adapters.filter((line) => line.includes("constructor(client?: AnthropicClient,"));
    expect(constructor).toHaveLength(1);
    expect(constructor[0]).toContain("private readonly maxRetries?: number)");
  });

  it("5. counterexample (red on 8664964): the coordinator's Anthropic client is built with timeout 120_000 (its retries still the SDK default), and a specialist's with timeout 120_000 and retries 0", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", FAKE_KEY);
    vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "");
    vi.stubEnv("SIRKIT_ANTHROPIC_MODEL", undefined);
    await agentAdapterFor("anthropic").start(START);
    expect(sdk.anthropic).toHaveLength(1);
    expect(Object.keys(sdk.anthropic[0]!).sort()).toEqual(["apiKey", "maxRetries", "timeout"]);
    expect(sdk.anthropic[0]!.timeout).toBe(120_000);
    expect(sdk.anthropic[0]!.maxRetries).toBeUndefined();
    await agentAdapterForRole("schematic", "anthropic", "claude-sonnet-4-5").start(START);
    expect(sdk.anthropic[1]).toMatchObject({ timeout: 120_000, maxRetries: 0 });
    expect(sdk.anthropic.every((options) => options.apiKey === FAKE_KEY)).toBe(true);
  });

  it("6. anthropicModelSetting: unset is the default, a non-empty value equal to its trim is exactly configuredAnthropicModel's, an empty or padded value is refused by name and never echoed; anthropic-config.ts stays dependency-free and keeps B21's line", () => {
    expect(anthropicModelSetting({})).toEqual({ ok: true, model: DEFAULT_ANTHROPIC_MODEL, source: "default" });
    for (const value of ["claude-sonnet-4-5", "claude-opus-4-7", "x"]) {
      expect(anthropicModelSetting({ SIRKIT_ANTHROPIC_MODEL: value })).toEqual({ ok: true, model: configuredAnthropicModel({ SIRKIT_ANTHROPIC_MODEL: value }), source: "configured" });
    }
    const padded = [" claude-x", "claude-x ", `claude-x${NEWLINE}`, "\tclaude-x"];
    for (const value of ["", " ", "   "]) expect(anthropicModelSetting({ SIRKIT_ANTHROPIC_MODEL: value }), JSON.stringify(value)).toEqual({ ok: false, refusal: "SIRKIT_ANTHROPIC_MODEL_EMPTY" });
    for (const value of padded) expect(anthropicModelSetting({ SIRKIT_ANTHROPIC_MODEL: value }), JSON.stringify(value)).toEqual({ ok: false, refusal: "SIRKIT_ANTHROPIC_MODEL_PADDED" });
    expect(JSON.stringify(anthropicModelSetting({ SIRKIT_ANTHROPIC_MODEL: " sentinel-model " }))).not.toContain("sentinel");
    vi.stubEnv("SIRKIT_ANTHROPIC_MODEL", "claude-from-process");
    expect(anthropicModelSetting()).toEqual({ ok: true, model: "claude-from-process", source: "configured" });
    const config = read("app/lib/llm/anthropic-config.ts");
    expect(config).not.toMatch(/^\s*import\b/m);
    expect(config.split(NEWLINE)[10]).toContain("export const ANTHROPIC_TEMPERATURE_MODEL_FAMILY = ");
    expect(config.split(NEWLINE)[14]).toBe("  return environment.SIRKIT_ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL;");
  });

  it("7. counterexample (red on 8664964): with SIRKIT_ANTHROPIC_MODEL empty or padded, /api/ai/runtime reports no model and a label naming the variable (it stays 200, Playwright's start probe), and neither Anthropic client sends anything: both refuse bad_request before the SDK call", async () => {
    for (const value of ["", " claude-opus-4-7", "claude-opus-4-7 "]) {
      vi.stubEnv("SIRKIT_ANTHROPIC_MODEL", value);
      const { status, body } = await runtimeBody();
      expect(status, JSON.stringify(value)).toBe(200);
      expect(body.providers.anthropic.model).toBeNull();
      expect(body.providers.anthropic.label).toContain("SIRKIT_ANTHROPIC_MODEL");
      expect(Object.keys(body).sort()).toEqual(["embeddings", "providers"]);
      expect(Object.keys(body.providers).sort()).toEqual(["anthropic", "openai"]);
      const agent = fakeAnthropic();
      const refused = await new AnthropicAgentAdapter(agent.client).start(START).then(() => null, (error: unknown) => error);
      expect(refused, JSON.stringify(value)).toBeInstanceOf(LLMProviderError);
      expect((refused as LLMProviderError).reason).toBe("bad_request");
      expect((refused as LLMProviderError).provider).toBe("anthropic");
      expect(agent.calls).toEqual([]);
      const provider = fakeAnthropic();
      const request = { provider: "anthropic", messages: [{ role: "user", content: "hi" }] } as LLMRequest;
      const providerRefused = await new AnthropicProvider(provider.client).generate(request).then(() => null, (error: unknown) => error);
      expect((providerRefused as LLMProviderError).reason).toBe("bad_request");
      expect(provider.calls).toEqual([]);
      // [B24-A1 review] regressions-4: the message both clients surface says what happened - nothing sent, the server setting the cause
      for (const error of [refused, providerRefused] as LLMProviderError[]) {
        expect(error.message, JSON.stringify(value)).toMatch(/did not send/);
        expect(error.message).toContain("SIRKIT_ANTHROPIC_MODEL");
        expect(error.message).not.toMatch(/rejected the request|request construction/);
        if (value.trim() !== "") expect(error.message).not.toContain(value);
      }
    }
    // a well-formed setting is reported and sent unchanged
    vi.stubEnv("SIRKIT_ANTHROPIC_MODEL", "claude-sonnet-4-5");
    expect((await runtimeBody()).body.providers.anthropic).toEqual({ model: "claude-sonnet-4-5", label: "claude-sonnet-4-5" });
    const agent = fakeAnthropic();
    await new AnthropicAgentAdapter(agent.client).start(START);
    expect(agent.calls.map((call) => call.model)).toEqual(["claude-sonnet-4-5"]);
    vi.stubEnv("SIRKIT_ANTHROPIC_MODEL", undefined);
    expect((await runtimeBody()).body.providers.anthropic).toEqual({ model: DEFAULT_ANTHROPIC_MODEL, label: DEFAULT_ANTHROPIC_MODEL });
  });

  it("8. the guard: sendableAnthropicModel returns a well-formed model unchanged and throws LLMProviderError(anthropic, bad_request) for an empty or padded one; it is called in place at adapters.ts:219 and anthropic-provider.ts:107, its imports after each file's last line, and no provider SDK importer is added", () => {
    expect(sendableAnthropicModel("claude-sonnet-4-5")).toBe("claude-sonnet-4-5");
    for (const value of ["", " ", " claude", "claude ", `claude${NEWLINE}`]) {
      let thrown: unknown = null;
      try {
        sendableAnthropicModel(value);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, JSON.stringify(value)).toBeInstanceOf(LLMProviderError);
      expect((thrown as LLMProviderError).reason).toBe("bad_request");
      // [B24-A1 review] regressions-4: the reason stays bad_request (the task's text); the message is the local refusal's own
      expect((thrown as LLMProviderError).message).toMatch(/^Sirkit did not send this request to Anthropic: .*SIRKIT_ANTHROPIC_MODEL/);
    }
    const adapters = read("app/lib/agent/adapters.ts").split(NEWLINE);
    expect(adapters[218]).toMatch(/^ {6}model: sendableAnthropicModel\(this\.model\),/);
    expect(adapters[334]).toMatch(/^import \{ sendableAnthropicModel \} from "\.\.\/llm\/anthropic-model-guard";/);
    const provider = read("app/lib/llm/anthropic-provider.ts").split(NEWLINE);
    expect(provider[106]).toMatch(/^ {6}model: sendableAnthropicModel\(this\.model\),/);
    expect(provider[104]).toBe("    const supportsTemperature = ANTHROPIC_TEMPERATURE_MODEL_FAMILY.test(this.model);");
    expect(provider[195]).toMatch(/^import \{ sendableAnthropicModel \} from "\.\/anthropic-model-guard";/); // Generation cancellation adds SDK options and aborted-error handling above this footer (2026-10-17). [PR-L step 0, 2026-10-17] OD-251: the note is joined onto this line so no later line of this file moves (open-risks' superseded table cites `:368`)
    const guard = read("app/lib/llm/anthropic-model-guard.ts");
    expect(guard.match(/^import .*$/gm)).toEqual(['import { LLMProviderError } from "./errors";']);
    // B21-E1's cited lines keep their places (C16, C19, C20 re-anchored, C21-C24, C56, C57; C14 in anthropic-config.ts)
    for (const [line, anchor] of [[87, "stop: openAIStepStop(response, items)"], [112, "maxRetries: this.maxRetries, timeout: 120_000"], [122, 'tool_choice: tools.length > 0 ? "auto" : undefined,'], [189, "stop: anthropicStepStop(message.stop_reason)"], [213, "new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 120_000, maxRetries: this.maxRetries })"], [224, 'tool_choice: tools.length > 0 ? { type: "auto", disable_parallel_tool_use: true } : undefined,'], [278, "function openAIStepStop("], [291, "function anthropicStepStop("], [312, "export const SPECIALIST_SDK_MAX_RETRIES = 0;"], [321, "export function agentAdapterForRole("]] as const) {
      expect(adapters[line - 1], `adapters.ts:${line}`).toContain(anchor);
    }
  });

  it("9. the role table is ROLE_PROVIDER_POLICY with parseRoleModelOverrides' overrides; an override the schema refuses is recorded provider_policy_invalid and never echoed", () => {
    const base = buildDeploymentConfiguration({}).roleTable;
    expect(base).toEqual({ state: "default", roles: ROLE_PROVIDER_POLICY });
    const override = JSON.stringify({ "circuit-topology": { provider: "anthropic", model: "inherit" } });
    const parsed = parseRoleModelOverrides(override);
    expect(parsed.ok).toBe(true);
    const overridden = buildDeploymentConfiguration({ [ROLE_MODELS_ENV]: override }).roleTable;
    expect(overridden.state).toBe("overridden");
    expect(overridden.roles).toEqual({ ...ROLE_PROVIDER_POLICY, ...(parsed.ok ? parsed.overrides : {}) });
    for (const invalid of ["{", JSON.stringify({ "sentinel-role": { provider: "openai", model: "x" } }), JSON.stringify({ "circuit-topology": { provider: "sentinel", model: "x" } }), "x".repeat(3_000)]) {
      expect(parseRoleModelOverrides(invalid).ok).toBe(false);
      const table = buildDeploymentConfiguration({ [ROLE_MODELS_ENV]: invalid }).roleTable;
      expect(table).toEqual({ state: "provider_policy_invalid", roles: null });
      expect(JSON.stringify(buildDeploymentConfiguration({ [ROLE_MODELS_ENV]: invalid }))).not.toContain("sentinel");
    }
  });

  it("10. the registry versions, each beside an engineeringDigest of its rows (production's rows: PROVIDER_ROWS, D7); a row change without a version bump moves the digest; no A1 production file names a B23 test oracle or generator render, or imports a module the B23 closeout records as dormant", () => {
    const { registries } = buildDeploymentConfiguration({});
    expect(registries).toEqual({
      source: { version: SOURCE_REGISTRY_VERSION, digest: engineeringDigest(SOURCE_REGISTRY) },
      mcpServers: { version: MCP_SERVER_REGISTRY_VERSION, digest: engineeringDigest(MCP_SERVER_REGISTRY) },
      providers: { version: PROVIDER_REGISTRY_VERSION, digest: engineeringDigest(PROVIDER_ROWS) },
    });
    const edited = PROVIDER_ROWS.map((row, index) => (index === 0 ? { ...row, displayName: `${row.displayName} (edited)` } : row));
    expect(engineeringDigest(edited)).not.toBe(registries.providers.digest);
    const sources = { ...SOURCE_REGISTRY, digikey: { ...SOURCE_REGISTRY.digikey, displayName: "edited" } };
    expect(engineeringDigest(sources)).not.toBe(registries.source.digest);
    const A1_PRODUCTION = ["app/lib/auth/deployment-profile.ts", "app/lib/deployment/configuration.ts", "app/lib/deployment/flag-inventory.ts", "app/lib/deployment/readiness.ts", "app/lib/llm/anthropic-model-guard.ts", "app/api/health/route.ts", "app/api/ready/route.ts"];
    const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
    for (const path of A1_PRODUCTION) {
      const text = strip(read(path));
      for (const name of ["PROVIDER_REGISTRY", "renderProviderRegistryCsv", "PROVIDER_REGISTRY_CSV_COLUMNS", "RUNBOOK_FIELDS", "PROVIDER_REGISTRY_RULES"]) expect(new RegExp(`\\b${name}\\b`).test(text), `${path} names ${name}`).toBe(false);
      for (const dormant of ["cd12-projection", "order-contract", "purchase-authorization", "webhook-verification", "ordering-enablement", "physical-evidence"]) expect(new RegExp(`(?:from\\s+|import\\(\\s*)["'][^"']*\\/${dormant}["']`).test(text), `${path} imports ${dormant}`).toBe(false);
    }
  });

  it("11. the embedding and rerank models are COPIED, never imported (embeddings.ts and parts-search.ts import a provider SDK): each copy equals its source's constant, read from the file", () => {
    expect(EMBEDDING_CONFIGURATION).toEqual({ provider: "openai", model: "text-embedding-3-small" });
    expect(read("app/lib/embeddings.ts")).toContain(`export const EMBEDDING_MODEL = "${EMBEDDING_CONFIGURATION.model}";`);
    expect(read("app/lib/embeddings.ts")).toMatch(/^import OpenAI from "openai";$/m);
    expect(PARTS_SEARCH_RERANK_CONFIGURATION).toEqual({ provider: "anthropic", model: "claude-haiku-4-5" });
    expect(read("app/lib/parts-search.ts")).toContain(`const RERANK_MODEL = "${PARTS_SEARCH_RERANK_CONFIGURATION.model}";`);
    expect(read("app/lib/parts-search.ts")).toMatch(/^import Anthropic from "@anthropic-ai\/sdk";$/m);
    const record = buildDeploymentConfiguration({});
    expect(record.embeddings).toEqual(EMBEDDING_CONFIGURATION);
    expect(record.partsSearchRerank).toEqual(PARTS_SEARCH_RERANK_CONFIGURATION);
    const configuration = read("app/lib/deployment/configuration.ts");
    expect(configuration).not.toMatch(/from "[^"]*(?:\/embeddings|\/parts-search|openai|@anthropic-ai\/sdk)"/);
  });

  it("12. the runtime profiles are referenced through runtimeProfiles() (each id, deterministicDigest and pinned state), the tool registry digest is sirkitToolRegistry().digest(), and the record's flags are every flag of the inventory, the ordering switch by its owner's rule", () => {
    const pinned: Env = { SIRKIT_NGSPICE_INSTALL_SHA256: "a".repeat(64) };
    for (const env of [{}, pinned] as Env[]) {
      const record = buildDeploymentConfiguration(env);
      expect(record.runtimeProfiles).toEqual(runtimeProfiles((name) => env[name]).map((profile) => ({ id: profile.profileId, deterministicDigest: profile.deterministicDigest, pinned: profile.executable.expectedDigest.state === "pinned" })));
      expect(record.runtimeProfiles.map((profile) => profile.id)).toEqual([...RUNTIME_PROFILE_IDS]);
    }
    expect(buildDeploymentConfiguration(pinned).runtimeProfiles.find((profile) => profile.id === "ngspice-local-diagnostic")?.pinned).toBe(true);
    expect(read("app/lib/deployment/configuration.ts")).toMatch(/import \{[^}]*\bruntimeProfiles\b[^}]*\} from "@\/app\/lib\/computation\/runtime-profile";/);
    expect(buildDeploymentConfiguration({}).toolRegistryDigest).toBe(sirkitToolRegistry().digest());
    const flagKinds = new Set(["enable-flag", "disable-switch", "rollout-stage", "shadow"]);
    expect(buildDeploymentConfiguration({}).flags.map((flag) => flag.name)).toEqual(FLAG_INVENTORY.filter((entry) => flagKinds.has(entry.kind)).map((entry) => entry.name));
    // SIRKIT_ORDERING_DISABLED: any non-blank value, as orderingEnablement reads it (ordering-enablement.ts:104-105)
    for (const value of [undefined, "", "  ", "1", "0", "true", " x "]) {
      const env: Env = value === undefined ? {} : { SIRKIT_ORDERING_DISABLED: value };
      const state = buildDeploymentConfiguration(env).flags.find((flag) => flag.name === "SIRKIT_ORDERING_DISABLED")?.state;
      expect(state === "set", JSON.stringify(value)).toBe((orderingEnablement({ env }).reasons as readonly string[]).includes("operator_disabled"));
    }
  });

  it("13. deploymentConfiguration() is built once per process, at first use, over process.env; the test-only reset rebuilds it; /api/ai/runtime's embedding model is the record's", async () => {
    vi.stubEnv("SIRKIT_DEPLOYMENT_ENV", "ci");
    const first = deploymentConfiguration();
    expect(first.profile.declared).toBe("ci");
    vi.stubEnv("SIRKIT_DEPLOYMENT_ENV", "staging");
    expect(deploymentConfiguration()).toBe(first);
    __resetDeploymentConfigurationForTests();
    expect(deploymentConfiguration().profile.declared).toBe("staging");
    expect((await runtimeBody()).body.embeddings).toEqual(deploymentConfiguration().embeddings);
  });

  it("14. [B24-A1 review] coverage-4: every provider SDK client Sirkit builds is in the record by the code that builds it - the agent coordinator's and a specialist's, the llmRouter's, the embedding client and the parts-search reranker - each timeout and retries copied from its construction site and pinned here by reading that site (the agent clients also by the mocked SDK); these five server sites and the record-only command's contract-turn clients (outside the record) are the only ones in production code, and a change to any client's options moves the digest", async () => { // [B24-B3 STOP, 2026-10-08] the lead's reviewed pin move (OD-230 (n)): the sixth site, app/lib/evaluation/live-contract-clients.ts, builds the record-only command's two contract-turn clients (OD-125, OD-216), which no server builds, so the deployment record states none of them; their options and their one importer are checked by b24-b3-model-in-loop case 5; title made truthful in place
    const productionSources = (dir: string): string[] => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return entry.name === "__tests__" || entry.name === "node_modules" || entry.name.startsWith(".") ? [] : productionSources(path);
      return /\.(?:tsx?|mts|mjs|cjs|js)$/.test(entry.name) && !/\.(?:test|spec)\.[a-z]+$/.test(entry.name) ? [path] : [];
    });
    // the llmRouter's OpenAI client (behind the model-calling routes) is in the record - before the review only the agent's were
    const routerInRecord = (buildDeploymentConfiguration({}) as unknown as { providers: { openai: { clients?: { llmRouter?: unknown } } } }).providers.openai.clients?.llmRouter;
    expect(routerInRecord).toEqual({ timeoutMs: 600_000, maxRetries: 5 });
    const sites = ["app", "lib", "components", "scripts"].flatMap((dir) => productionSources(dir)).filter((path) => /new (?:OpenAI|Anthropic)\(/.test(read(path)));
    expect(sites.sort()).toEqual(["app/lib/agent/adapters.ts", "app/lib/embeddings.ts", "app/lib/evaluation/live-contract-clients.ts", "app/lib/llm/anthropic-provider.ts", "app/lib/llm/openai-provider.ts", "app/lib/parts-search.ts"]); // [B24-B3 STOP, 2026-10-08] + the record-only command's contract-turn clients (the lead's reviewed move, OD-230 (n))
    /** each `new <sdk>({ ... })` object literal at a site: its keys and their expressions */
    const built = (path: string, sdk: "OpenAI" | "Anthropic"): Array<Record<string, string>> => [...read(path).matchAll(new RegExp(`new ${sdk}\\(\\{([^}]*)\\}\\)`, "g"))].map((match) => Object.fromEntries(match[1]!.split(",").map((part) => part.trim()).filter(Boolean).map((part) => {
      const colon = part.indexOf(":");
      return colon < 0 ? [part, part] : [part.slice(0, colon).trim(), part.slice(colon + 1).trim()];
    })));
    /** an option's expression as the record states it: absent is the SDK's default; a product of numeric literals is its value */
    const setting = (expression: string | undefined): number | "sdk-default" => (expression === undefined ? "sdk-default" : expression.split("*").reduce((product, factor) => product * Number(factor.trim().replaceAll("_", "")), 1));
    const adapters = read("app/lib/agent/adapters.ts");
    // the agent adapters: one client each, its retries the constructor's (a specialist's SPECIALIST_SDK_MAX_RETRIES)
    const [agentOpenAI, ...moreOpenAI] = built("app/lib/agent/adapters.ts", "OpenAI");
    expect(moreOpenAI).toEqual([]);
    expect(Object.keys(agentOpenAI!).sort()).toEqual(["apiKey", "maxRetries", "timeout"]);
    expect(agentOpenAI!.maxRetries).toBe("this.maxRetries");
    const coordinatorRetries = /private readonly maxRetries: number = (\d+)/.exec(adapters)?.[1];
    expect(OPENAI_CLIENTS.agentCoordinator).toEqual({ timeoutMs: setting(agentOpenAI!.timeout), maxRetries: Number(coordinatorRetries) });
    expect(OPENAI_CLIENTS.agentSpecialist).toEqual({ timeoutMs: setting(agentOpenAI!.timeout), maxRetries: SPECIALIST_SDK_MAX_RETRIES });
    const [agentAnthropic, ...moreAnthropic] = built("app/lib/agent/adapters.ts", "Anthropic");
    expect(moreAnthropic).toEqual([]);
    expect(Object.keys(agentAnthropic!).sort()).toEqual(["apiKey", "maxRetries", "timeout"]);
    expect(agentAnthropic!.maxRetries).toBe("this.maxRetries");
    expect(adapters).toContain("constructor(client?: AnthropicClient, private readonly model = configuredAnthropicModel(), private readonly maxRetries?: number)");
    expect(ANTHROPIC_CLIENTS.agentCoordinator).toEqual({ timeoutMs: setting(agentAnthropic!.timeout), maxRetries: "sdk-default" });
    expect(ANTHROPIC_CLIENTS.agentSpecialist).toEqual({ timeoutMs: setting(agentAnthropic!.timeout), maxRetries: SPECIALIST_SDK_MAX_RETRIES });
    // the llmRouter's two providers, the embedding client and the parts-search reranker
    for (const [path, sdk, client] of [["app/lib/llm/openai-provider.ts", "OpenAI", OPENAI_CLIENTS.llmRouter], ["app/lib/embeddings.ts", "OpenAI", OPENAI_CLIENTS.embeddings], ["app/lib/llm/anthropic-provider.ts", "Anthropic", ANTHROPIC_CLIENTS.llmRouter], ["app/lib/parts-search.ts", "Anthropic", ANTHROPIC_CLIENTS.partsSearchRerank]] as const) {
      const sitesHere = built(path, sdk);
      expect(sitesHere, path).toHaveLength(1);
      expect(Object.keys(sitesHere[0]!).filter((key) => key !== "apiKey" && key !== "timeout" && key !== "maxRetries"), path).toEqual([]);
      expect(client, path).toEqual({ timeoutMs: setting(sitesHere[0]!.timeout), maxRetries: setting(sitesHere[0]!.maxRetries) });
    }
    expect(OPENAI_CLIENTS.llmRouter).toEqual({ timeoutMs: 600_000, maxRetries: 5 });
    // the agent clients by the mocked SDK: what each constructor received
    vi.stubEnv("OPENAI_API_KEY", FAKE_KEY);
    vi.stubEnv("ANTHROPIC_API_KEY", FAKE_KEY);
    vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "");
    vi.stubEnv("SIRKIT_ANTHROPIC_MODEL", undefined);
    vi.stubEnv("SIRKIT_OPENAI_MODEL", undefined);
    for (const [provider, constructed, clients, model] of [["openai", sdk.openai, OPENAI_CLIENTS, "gpt-5.6-terra"], ["anthropic", sdk.anthropic, ANTHROPIC_CLIENTS, "claude-sonnet-4-5"]] as const) {
      await agentAdapterFor(provider).start(START).catch(() => undefined);
      await agentAdapterForRole("schematic", provider, model).start(START).catch(() => undefined);
      expect(constructed.map((options) => ({ timeoutMs: options.timeout ?? "sdk-default", maxRetries: options.maxRetries ?? "sdk-default" })), provider).toEqual([clients.agentCoordinator, clients.agentSpecialist]);
    }
    // the record carries every client, deep-frozen; no field names one client as the provider's only one
    const record = buildDeploymentConfiguration({});
    expect(record.providers.openai.clients).toEqual(OPENAI_CLIENTS);
    expect(record.providers.anthropic.clients).toEqual(ANTHROPIC_CLIENTS);
    expect(Object.keys(record.providers.openai).sort()).toEqual(["apiKey", "clients", "model", "reasoningEffort"]);
    expect(Object.keys(record.providers.anthropic).sort()).toEqual(["apiKey", "clients", "model"]);
    expect(isDeepFrozen(OPENAI_CLIENTS) && isDeepFrozen(ANTHROPIC_CLIENTS)).toBe(true);
  });
});
