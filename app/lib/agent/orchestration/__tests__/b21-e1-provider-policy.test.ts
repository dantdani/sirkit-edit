/**
 * [B21 E1] The per-role provider/model policy (OD-117, D21-19) and the specialist's adapter (OD-115): the role table is DATA with
 * every role inheriting (the user's provider, that provider's one configured model - today's behaviour); overrides come ONLY from
 * the server environment through a closed, bounded schema, and a map the schema refuses approves nothing; the model-family rules are
 * READ from the modules that apply them (never copied) and a model outside them is refused for a role until qualified live (LB-9);
 * `agentAdapterForRole` builds a specialist's adapter like `agentAdapterFor` builds the coordinator's, with `maxRetries: 0` - the
 * SDK modules are mocked here so the constructed clients' options are observed without any network.
 */
import { readFileSync } from "node:fs";
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

import { AnthropicAgentAdapter, OpenAIAgentAdapter, SPECIALIST_SDK_MAX_RETRIES, agentAdapterFor, agentAdapterForRole } from "@/app/lib/agent/adapters";
import { FixtureAgentAdapter } from "@/app/lib/agent/fixture-agent-adapter";
import { DEFAULT_OPENAI_MODEL, OPENAI_NO_TEMPERATURE_MODEL_FAMILY, OPENAI_REASONING_MODEL_FAMILY } from "@/app/lib/llm/openai-config";
import { ANTHROPIC_TEMPERATURE_MODEL_FAMILY, DEFAULT_ANTHROPIC_MODEL } from "@/app/lib/llm/anthropic-config";
import { SPECIALIST_ROLES } from "../contracts";
import { collectProductionFiles, moduleReferences, resolveSpecifier } from "@/app/lib/project/__tests__/_import-gate-helpers";
import { importClosure, runtimeDeclarationSpecifiers } from "@/app/lib/mcp/server/__tests__/_import-closure";
import { MODEL_FAMILY_RULES, PROVIDER_ROUTE_REFUSALS, ROLE_MODELS_BOUNDS, ROLE_MODELS_ENV, ROLE_PROVIDER_POLICY, parseRoleModelOverrides, qualifiedModel, resolveRoleRoute } from "../provider-policy";

const ROOT = process.cwd();
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");
const SPECIALISTS = SPECIALIST_ROLES.filter((role) => role !== "coordinator");
/** an obvious fake, assembled at run time: no file carries a key-shaped literal */
const FAKE_KEY = ["fx", "e1", "0000", "fake"].join("-");
const env = (map: unknown, extra: Record<string, string> = {}): Record<string, string | undefined> => ({ [ROLE_MODELS_ENV]: typeof map === "string" ? map : JSON.stringify(map), ...extra });

afterEach(() => {
  vi.unstubAllEnvs();
  sdk.openai.length = 0;
  sdk.anthropic.length = 0;
  sdk.requests.length = 0;
});

describe("[B21 E1] the per-role provider/model policy (OD-117)", () => {
  it("1. the role table is data and every role inherits: with no server override each specialist resolves to the coordinator's provider and that provider's ONE configured model (source `inherit`, SDK retries 0), on both providers; the coordinator is never routed by the table", () => {
    expect(ROLE_MODELS_ENV).toBe("SIRKIT_ORCHESTRATION_ROLE_MODELS");
    expect(Object.keys(ROLE_PROVIDER_POLICY)).toEqual([...SPECIALIST_ROLES]);
    for (const role of SPECIALIST_ROLES) expect(ROLE_PROVIDER_POLICY[role], role).toEqual({ provider: "inherit", model: "inherit" });
    expect(Object.isFrozen(ROLE_PROVIDER_POLICY)).toBe(true);
    for (const role of SPECIALISTS) {
      expect(resolveRoleRoute(role, "openai", {}), role).toEqual({ ok: true, route: { role, provider: "openai", model: DEFAULT_OPENAI_MODEL, source: "inherit", sdkMaxRetries: 0, fallbackFrom: null } });
      expect(resolveRoleRoute(role, "anthropic", {}), role).toEqual({ ok: true, route: { role, provider: "anthropic", model: DEFAULT_ANTHROPIC_MODEL, source: "inherit", sdkMaxRetries: 0, fallbackFrom: null } });
    }
    // the configured model is the server's one model per provider (the same variables the coordinator's adapters read)
    expect(resolveRoleRoute("verification-critic", "openai", { SIRKIT_OPENAI_MODEL: "gpt-5.6-terra" })).toMatchObject({ ok: true, route: { model: "gpt-5.6-terra" } });
    expect(resolveRoleRoute("verification-critic", "anthropic", { SIRKIT_ANTHROPIC_MODEL: "claude-sonnet-4-5" })).toMatchObject({ ok: true, route: { model: "claude-sonnet-4-5" } });
    expect(resolveRoleRoute("coordinator", "openai", {})).toMatchObject({ ok: false, refusal: { code: "provider_policy_invalid" } });
    expect(PROVIDER_ROUTE_REFUSALS).toEqual(["provider_policy_invalid", "model_unqualified", "provider_unavailable"]);
    expect(SPECIALIST_SDK_MAX_RETRIES).toBe(0);
  });

  it("2. a SERVER-ENV override is applied through a closed, bounded schema - a role routed to a provider and a qualified model, a provider-only override taking that provider's configured model; a map the schema refuses approves NOTHING: every specialist is refused `provider_policy_invalid` with a visible detail, never a partial map", () => {
    const overrides = { "verification-critic": { provider: "anthropic", model: "claude-sonnet-4-5" }, "requirements-analyst": { provider: "anthropic", model: "inherit" }, schematic: { provider: "inherit", model: "gpt-5.6-luna" } };
    const environment = env(overrides);
    expect(resolveRoleRoute("verification-critic", "openai", environment)).toEqual({ ok: true, route: { role: "verification-critic", provider: "anthropic", model: "claude-sonnet-4-5", source: "env", sdkMaxRetries: 0, fallbackFrom: null } });
    expect(resolveRoleRoute("requirements-analyst", "openai", environment)).toMatchObject({ ok: true, route: { provider: "anthropic", model: DEFAULT_ANTHROPIC_MODEL, source: "env" } });
    expect(resolveRoleRoute("schematic", "openai", environment)).toMatchObject({ ok: true, route: { provider: "openai", model: "gpt-5.6-luna", source: "env" } });
    expect(resolveRoleRoute("circuit-topology", "openai", environment)).toMatchObject({ ok: true, route: { provider: "openai", model: DEFAULT_OPENAI_MODEL, source: "inherit" } });
    expect(parseRoleModelOverrides(undefined)).toEqual({ ok: true, overrides: {} });
    expect(parseRoleModelOverrides("  ")).toEqual({ ok: true, overrides: {} });
    expect(ROLE_MODELS_BOUNDS).toEqual({ maxChars: 2_048, maxEntries: 8 });
    const refused: Array<[string, unknown]> = [
      ["not JSON", "{verification-critic: anthropic}"],
      ["an array", [{ provider: "anthropic", model: "inherit" }]],
      ["null", "null"],
      ["over the character bound", JSON.stringify({ schematic: { provider: "openai", model: "inherit" } }).padEnd(ROLE_MODELS_BOUNDS.maxChars + 1, " ")],
      ["over the entry bound", Object.fromEntries([...SPECIALISTS, "coordinator"].map((role) => [role, { provider: "inherit", model: "inherit" }]))],
      ["an unknown role", { "release-manager": { provider: "openai", model: "inherit" } }],
      ["the coordinator", { coordinator: { provider: "anthropic", model: "inherit" } }],
      ["an unknown key", { schematic: { provider: "openai", model: "inherit", temperature: 1 } }],
      ["a missing key", { schematic: { provider: "openai" } }],
      ["a bad provider", { schematic: { provider: "gemini", model: "inherit" } }],
      ["a model outside the id grammar", { schematic: { provider: "openai", model: "GPT 5.6; drop" } }],
      ["a non-object entry", { schematic: "openai" }],
      ["a prototype key", '{"__proto__":{"provider":"openai","model":"inherit"}}'],
    ];
    for (const [label, map] of refused) {
      const parsed = parseRoleModelOverrides(typeof map === "string" ? map : JSON.stringify(map));
      expect(parsed.ok, label).toBe(false);
      for (const role of SPECIALISTS) {
        const route = resolveRoleRoute(role, "openai", env(map));
        expect(route, `${label}: ${role}`).toMatchObject({ ok: false, refusal: { code: "provider_policy_invalid", role, provider: "openai", model: null } });
        if (!route.ok) expect(route.refusal.detail, label).toMatch(new RegExp(`^${ROLE_MODELS_ENV} is refused: `));
      }
    }
  });

  it("3. the family rules are READ, never copied: the policy's rules ARE the objects openai-config and anthropic-config export, and the three modules that apply them use those objects with no inline copy of a rule literal; a model outside the rules is refused `model_unqualified` for a role with a visible reason naming LB-9, a model inside them and each provider's configured model are qualified", () => {
    expect(MODEL_FAMILY_RULES.openai[0]).toBe(OPENAI_REASONING_MODEL_FAMILY);
    expect(MODEL_FAMILY_RULES.openai[1]).toBe(OPENAI_NO_TEMPERATURE_MODEL_FAMILY);
    expect(MODEL_FAMILY_RULES.anthropic).toEqual([ANTHROPIC_TEMPERATURE_MODEL_FAMILY]);
    expect(MODEL_FAMILY_RULES.anthropic[0]).toBe(ANTHROPIC_TEMPERATURE_MODEL_FAMILY);
    expect(OPENAI_REASONING_MODEL_FAMILY.source).toBe("^gpt-5\\.6(?:-|$)");
    expect(OPENAI_NO_TEMPERATURE_MODEL_FAMILY.source).toBe("^(?:gpt-5|o\\d)");
    expect(ANTHROPIC_TEMPERATURE_MODEL_FAMILY.source).toBe("^claude-3-|^claude-(?:sonnet|opus)-4-[0-5]");
    // one literal of each rule in the tree, in its config module; the providers and the policy name the constants
    const literals = [OPENAI_REASONING_MODEL_FAMILY.source, OPENAI_NO_TEMPERATURE_MODEL_FAMILY.source, ANTHROPIC_TEMPERATURE_MODEL_FAMILY.source];
    for (const file of ["app/lib/llm/openai-provider.ts", "app/lib/llm/anthropic-provider.ts", "app/lib/agent/orchestration/provider-policy.ts", "app/lib/agent/adapters.ts"]) {
      for (const literal of literals) expect(read(file).includes(literal), `${file} copies ${literal}`).toBe(false);
    }
    expect(read("app/lib/llm/openai-config.ts")).toContain("if (!OPENAI_REASONING_MODEL_FAMILY.test(model)) return undefined;");
    expect(read("app/lib/llm/openai-provider.ts")).toContain("const supportsTemperature = !OPENAI_NO_TEMPERATURE_MODEL_FAMILY.test(this.model);");
    expect(read("app/lib/llm/anthropic-provider.ts")).toContain("const supportsTemperature = ANTHROPIC_TEMPERATURE_MODEL_FAMILY.test(this.model);");
    // qualification: every rule of the provider classifies the model, or it is the provider's configured model
    for (const model of ["gpt-5.6", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) expect(qualifiedModel("openai", model, {}), model).toBe(true);
    for (const model of ["claude-3-5-haiku", "claude-sonnet-4-5", "claude-opus-4-1"]) expect(qualifiedModel("anthropic", model, {}), model).toBe(true);
    for (const model of ["gpt-6-astra", "gpt-5.2", "o3", "gpt-4o"]) expect(qualifiedModel("openai", model, {}), model).toBe(false);
    for (const model of ["claude-opus-5-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"]) expect(qualifiedModel("anthropic", model, {}), model).toBe(false);
    expect(ANTHROPIC_TEMPERATURE_MODEL_FAMILY.test(DEFAULT_ANTHROPIC_MODEL)).toBe(false); // the default model is outside the rule...
    expect(qualifiedModel("anthropic", DEFAULT_ANTHROPIC_MODEL, {})).toBe(true); // ...and qualified as the configured model: today's behaviour
    expect(qualifiedModel("anthropic", DEFAULT_ANTHROPIC_MODEL, { SIRKIT_ANTHROPIC_MODEL: "claude-sonnet-4-5" })).toBe(false); // named as an override while another is configured: refused
    expect(resolveRoleRoute("verification-critic", "anthropic", {})).toMatchObject({ ok: true, route: { model: DEFAULT_ANTHROPIC_MODEL } }); // inherit is always today's model
    expect(qualifiedModel("openai", "gpt-6-astra", { SIRKIT_OPENAI_MODEL: "gpt-6-astra" })).toBe(true);
    for (const [provider, model] of [["openai", "gpt-6-astra"], ["anthropic", "claude-opus-5-5"]] as const) {
      const route = resolveRoleRoute("schematic", "openai", env({ schematic: { provider, model } }));
      expect(route, model).toMatchObject({ ok: false, refusal: { code: "model_unqualified", role: "schematic", provider, model } });
      if (!route.ok) expect(route.refusal.detail).toMatch(/outside the pinned family rules[\s\S]*until it is qualified live \(LB-9\)/);
    }
    // an inherited provider with an overridden model is judged against the provider it lands on
    expect(resolveRoleRoute("schematic", "anthropic", env({ schematic: { provider: "inherit", model: "gpt-5.6-luna" } }))).toMatchObject({ ok: false, refusal: { code: "model_unqualified", provider: "anthropic" } });
  });

  it("4. the body can never route a role: the resolver reads only the server environment it is handed, the production provider layer hands it `process.env` (never a request field), and the chat route's body contract has no key that could carry a role, provider or model per role", () => {
    expect(resolveRoleRoute.length).toBe(3);
    const runtime = read("app/api/chat/orchestration-runtime.ts");
    expect(runtime).toMatch(/export function productionSpecialistProviders\(\): SpecialistProviders \{[\s\S]{0,600}environment: process\.env/);
    const route = read("app/api/chat/route.ts");
    expect(route).toContain('const ALLOWED_BODY_KEYS = new Set(["provider", "messages", "scope", "schematicState", "schematicHeadMark", "editorContext", "viewContext"]);');
    expect(route).toContain("providers: productionSpecialistProviders()");
    expect(route).not.toMatch(/ROLE_MODELS|roleModels|SIRKIT_ORCHESTRATION_ROLE_MODELS/);
  });

  it("5. `agentAdapterForRole` constructs a specialist's adapter like `agentAdapterFor` - the SDK client built lazily, with `maxRetries: 0` (OD-115) and the route's model; the coordinator's stays agentAdapterFor's (OpenAI 2, Anthropic the SDK default); under the fixture runtime's opt-in the scripted agent, never a model", async () => {
    vi.stubEnv("OPENAI_API_KEY", FAKE_KEY);
    vi.stubEnv("ANTHROPIC_API_KEY", FAKE_KEY);
    vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "");
    vi.stubEnv("SIRKIT_OPENAI_MODEL", "");
    vi.stubEnv("SIRKIT_OPENAI_REASONING_EFFORT", "");
    const start ={ system: "sys", history: [], userMessage: "hi", tools: [] };
    const openai = agentAdapterForRole("verification-critic", "openai", "gpt-5.6-terra");
    expect(openai).toBeInstanceOf(OpenAIAgentAdapter);
    expect(sdk.openai).toEqual([]); // lazy: no client before the first call
    await openai.start(start);
    expect(sdk.openai).toHaveLength(1);
    expect(Object.keys(sdk.openai[0]!).sort()).toEqual(["apiKey", "maxRetries", "timeout"]);
    expect(sdk.openai[0]).toMatchObject({ maxRetries: 0, timeout: 120_000 });
    expect(sdk.openai[0]!.apiKey === FAKE_KEY).toBe(true);
    expect(sdk.requests[0]).toMatchObject({ model: "gpt-5.6-terra", reasoning: { effort: "high" } });
    const anthropic = agentAdapterForRole("schematic", "anthropic", "claude-sonnet-4-5");
    expect(anthropic).toBeInstanceOf(AnthropicAgentAdapter);
    await anthropic.start(start);
    expect(Object.keys(sdk.anthropic[0]!).sort()).toEqual(["apiKey", "maxRetries"]);
    expect(sdk.anthropic[0]!.maxRetries).toBe(0);
    expect(sdk.requests[1]).toMatchObject({ model: "claude-sonnet-4-5" });
    // the configured model when the route names none
    await agentAdapterForRole("schematic", "openai").start(start);
    expect(sdk.requests[2]).toMatchObject({ model: DEFAULT_OPENAI_MODEL });
    // the coordinator's adapter is unchanged: agentAdapterFor's own client options
    await agentAdapterFor("openai").start(start);
    expect(sdk.openai.at(-1)).toMatchObject({ maxRetries: 2, timeout: 120_000 });
    await agentAdapterFor("anthropic").start(start);
    expect(sdk.anthropic.at(-1)!.maxRetries).toBeUndefined(); // the SDK's own default (2), exactly as before E1
    await agentAdapterForRole("coordinator", "openai").start(start);
    expect(sdk.openai.at(-1)).toMatchObject({ maxRetries: 2 });
    // the scripted fixture agent under the fixture runtime's opt-in: one class for every run, never a model
    vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "blinker");
    vi.stubEnv("SIRKIT_AUTH_MODE", "local_dev");
    vi.stubEnv("SIRKIT_FIXTURE_AGENT", "scripted");
    const scripted = agentAdapterForRole("verification-critic", "anthropic", "claude-sonnet-4-5");
    expect(scripted).toBeInstanceOf(FixtureAgentAdapter);
    expect(scripted.provider).toBe("anthropic");
  });

  it("6. the two E1 modules join the orchestration import gate (A's case 1, a pin move): their whole runtime closures reach no provider SDK and no forbidden family (A's case 2 walks them); the policy reaches the meters, the two model-config modules, the renderers and the error classifier - never an adapter, a provider module, the loop, the gateway, the tool catalog or an MCP transport; the result tool reaches the renderers and A's contracts only; the meters' B19-D exemption bridges to nothing (their one runtime import is the source registry, their one importer in the runtime's closure the policy)", { timeout: 180_000 }, () => {
    const production = collectProductionFiles(ROOT);
    const policy = importClosure(production, ["app/lib/agent/orchestration/provider-policy.ts"]);
    for (const member of ["app/lib/acquisition/admission-control.ts", "app/lib/llm/openai-config.ts", "app/lib/llm/anthropic-config.ts", "app/lib/agent/provider-tools.ts", "app/lib/llm/errors.ts", "app/lib/agent/orchestration/contracts.ts"]) expect(policy.has(member), member).toBe(true);
    const result = importClosure(production, ["app/lib/agent/orchestration/result-tool.ts"]);
    for (const member of ["app/lib/agent/provider-tools.ts", "app/lib/agent/orchestration/contracts.ts"]) expect(result.has(member), member).toBe(true);
    for (const closure of [policy, result]) {
      for (const never of ["app/lib/agent/adapters.ts", "app/lib/llm/openai-provider.ts", "app/lib/llm/anthropic-provider.ts", "app/lib/agent/loop.ts", "app/lib/agent/gateway.ts", "app/lib/engineering/tool-catalog.ts", "app/lib/mcp/http-transport.ts", "app/lib/agent/orchestration/scheduler.ts"]) expect(closure.has(never), never).toBe(false);
    }
    for (const member of ["app/lib/acquisition/admission-control.ts", "app/lib/llm/errors.ts"]) expect(result.has(member), member).toBe(false);
    // the B19-D closure gate's reviewed exemption (the meters are policy, not vendor data) can never become a bridge to vendor code: the
    // meters' only runtime import is the source registry, and in the orchestration runtime's closure provider-policy.ts is their ONE importer
    const runtimeImportsOf = (file: string): string[] => {
      const source = production.get(file)!;
      const runtime = runtimeDeclarationSpecifiers(file, source);
      return moduleReferences(file, source).filter((reference) => reference.kind !== "import-type" && ((reference.kind !== "static-import" && reference.kind !== "re-export") || runtime.has(reference.specifier))).map((reference) => reference.specifier);
    };
    expect(runtimeImportsOf("app/lib/acquisition/admission-control.ts")).toEqual(["./source-registry"]);
    const importsMeters = (file: string): boolean => runtimeImportsOf(file).some((specifier) => { const resolved = resolveSpecifier(file, specifier); return resolved.kind === "module" && resolved.module === "app/lib/acquisition/admission-control"; });
    expect([...importClosure(production, ["app/api/chat/orchestration-runtime.ts"]).keys()].filter(importsMeters)).toEqual(["app/lib/agent/orchestration/provider-policy.ts"]);
  });

  it("7. [B21 E1 fix: coverage-override-duplicate-keys] a key named TWICE in the override map - a role, or an entry's own key, however it is spelled - refuses the WHOLE map (JSON.parse would keep the last one silently): every specialist `provider_policy_invalid`, nothing applied; distinct keys, and a value that merely repeats a key's text, are still read", () => {
    const entry = (provider: string): string => `{"provider":"${provider}","model":"inherit"}`;
    const twice = `{"schematic":${entry("anthropic")},"schematic":${entry("openai")}}`;
    expect(parseRoleModelOverrides(twice)).toEqual({ ok: false, detail: 'the key "schematic" is named twice in one object (a duplicate would be resolved silently, last one wins)' });
    expect(parseRoleModelOverrides(`{"schematic":{"provider":"anthropic","provider":"openai","model":"inherit"}}`)).toMatchObject({ ok: false, detail: expect.stringMatching(/the key "provider" is named twice/) });
    const escaped = `{"schematic":${entry("anthropic")},"sch${String.fromCharCode(92)}u0065matic":${entry("openai")}}`; // the same key, spelled with a JSON escape
    expect(JSON.parse(escaped)).toEqual({ schematic: { provider: "openai", model: "inherit" } });
    expect(parseRoleModelOverrides(escaped)).toMatchObject({ ok: false, detail: expect.stringMatching(/the key "schematic" is named twice/) });
    for (const role of SPECIALISTS) {
      const route = resolveRoleRoute(role, "openai", env(twice));
      expect(route, role).toMatchObject({ ok: false, refusal: { code: "provider_policy_invalid", detail: expect.stringMatching(/named twice.*approves nothing/) } });
    }
    const distinct = `{"schematic":${entry("anthropic")},"verification-critic":{"provider":"inherit","model":"schematic"}}`;
    expect(parseRoleModelOverrides(distinct)).toEqual({ ok: true, overrides: { schematic: { provider: "anthropic", model: "inherit" }, "verification-critic": { provider: "inherit", model: "schematic" } } });
  });
});
