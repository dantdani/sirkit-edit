/**
 * [B24-B3] The model-in-loop command, offline (D24-18 offline; OD-216, OD-209, OD-125): `scripts/run-b21-live-orchestration-evaluation.ts`
 * edited in place, the money bound `app/lib/evaluation/live-spend.ts` (the program's one price table, `sirkit.live-price-table.v1`, lead
 * decision D1), the `maxRetries: 0` SDK clients `app/lib/evaluation/live-contract-clients.ts` and the two-provider capsule
 * `_b24-b3-two-provider-capsule.ts`.
 *
 *  1. the refusals, in order, each before any adapter or SDK client exists (`unbuilt` factories): the flag (exit 2), the fixture
 *     runtime's scripted agent (exit 3), an absent key name (exit 3), no price table, no cap or a table the validator refuses (exit 2);
 *  2. the spend gate: decimal text only; the request that could pass the cap is refused before it is sent; a reserve overrun refuses
 *     every later request; the validator refuses each malformed table on its own copy;
 *  3. the two-provider capsule: valid, deterministic, both providers in its task traces, and absent from B21's category;
 *  4. the per-provider contract turns, against fake clients: the forced choice and the exact strict schema; a valid answer records
 *     `valid`, an invalid one `invalid`; the turns count against the request bound and the spend bound; no text is recorded;
 *  5. B21's pins hold (the facts of `b21-f-replay-capsule` cases 7-9, the anchors on their lines) and the dated notes exist;
 *  6. scenario-map.md section 4 states the refusals, the bound, the capsule's DAG and what it can show, and the turns;
 *  7. [B24-B3 review] the accepted path through `main`, over the real adapter factories and faked SDK modules: the table is validated
 *     against the models the run calls, each request is metered at the model it is sent with, and the printed record's calls and money
 *     fields equal a recomputation from the requests the fakes received;
 *  8. [B24-B3 review] the spend wrapper's failure branches and the in-flight reservation;
 *  9. [B24-B3 review] a contract turn's output ceiling and its `incomplete` verdict.
 *
 * Failing first on 4738aa3 (scenario-map.md section 5): with the flag "1" and no key the command builds adapters, and the money bound,
 * the clients module and the capsule do not exist. Nothing is written to disk, no network is reached (fetch throws; every client is a
 * fake) and the command never runs with a key: every environment is a literal, every key value an obvious fake assembled here.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/** [B24-B3 review] The two SDK modules, faked for the command's accepted path (case 7): every client the real adapter factories and the
 *  clients module build is this fake. It keeps its options and each request in memory and answers at once with a fixed usage: an agent
 *  turn with text, a forced contract turn with its tool call. No other case builds an SDK client. */
const sdk = vi.hoisted(() => ({
  options: [] as Array<{ provider: "openai" | "anthropic"; options: Record<string, unknown> }>,
  requests: [] as Array<{ provider: "openai" | "anthropic"; params: Record<string, unknown> }>,
  usage: { input_tokens: 1000, output_tokens: 50 },
  turnArguments: { refdes: "R1", resistanceOhms: 1000 },
}));
vi.mock("openai", () => ({
  default: class {
    readonly responses = {
      create: async (params: Record<string, unknown>) => {
        sdk.requests.push({ provider: "openai", params });
        const choice = params.tool_choice as { name?: unknown } | string | undefined;
        if (typeof choice === "object" && choice !== null && typeof choice.name === "string") return { id: "r-turn", model: String(params.model), status: "completed", output_text: "", output: [{ type: "function_call", call_id: "c1", name: choice.name, arguments: JSON.stringify(sdk.turnArguments) }], usage: sdk.usage };
        return { id: "r-agent", model: String(params.model), status: "completed", output_text: "ok", output: [{ type: "message", role: "assistant", content: [] }], usage: sdk.usage };
      },
    };
    constructor(options: Record<string, unknown>) { sdk.options.push({ provider: "openai", options }); }
  },
}));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    readonly messages = {
      create: async (params: Record<string, unknown>) => {
        sdk.requests.push({ provider: "anthropic", params });
        const choice = params.tool_choice as { type?: unknown; name?: unknown } | undefined;
        if (choice?.type === "tool" && typeof choice.name === "string") return { id: "m-turn", model: String(params.model), stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: choice.name, input: sdk.turnArguments }], usage: sdk.usage };
        return { id: "m-agent", model: String(params.model), stop_reason: "end_turn", content: [{ type: "text", text: "ok" }], usage: sdk.usage };
      },
    };
    constructor(options: Record<string, unknown>) { sdk.options.push({ provider: "anthropic", options }); }
  },
}));

import { TWO_PROVIDER_CASE_ID, TWO_PROVIDER_DAG_RULE, twoProviderCase } from "./_b24-b3-two-provider-capsule";
import { buildOrchestrationEvaluationCases, runOrchestrationCase } from "@/app/lib/agent/orchestration/__tests__/_f-capsules";
import { parseReplayCapsule } from "@/app/lib/agent/replay-capsule";
import { MAX_OUTPUT_TOKENS } from "@/app/lib/agent/adapters";
import type { AgentStep, ProviderAgentAdapter } from "@/app/lib/agent/contracts";
import { LIVE_INPUT_TOKEN_RESERVE, LIVE_PRICE_TABLE_PROBLEM_CODES, LIVE_PRICE_TABLE_SCHEMA, LiveSpendRefusal, livePriceTableProblems, liveSpendBound, type LivePriceTable } from "@/app/lib/evaluation/live-spend";
import { OpenAIProvider } from "@/app/lib/llm/openai-provider";
import { AnthropicProvider } from "@/app/lib/llm/anthropic-provider";
import { resetOrchestrationStoreFactory } from "@/app/api/chat/orchestration-runtime";
import { LLMProviderError } from "@/app/lib/llm/errors";
import { DEFAULT_OPENAI_MODEL } from "@/app/lib/llm/openai-config";
import { DEFAULT_ANTHROPIC_MODEL } from "@/app/lib/llm/anthropic-config";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE);
const SCRIPT_PATH = "scripts/run-b21-live-orchestration-evaluation.ts";
const SCRIPT = "../../../../scripts/run-b21-live-orchestration-evaluation";
const MATRIX = "artifacts/ai-control-plane-b21/evaluation-matrix.md";
const PAGE = "artifacts/ai-control-plane-b24/scenario-map.md";
const FAKE_TABLE = "app/lib/qualification/__tests__/fixtures/b24-b3-price-table.fake.json";
const MALFORMED_TABLE = "app/lib/qualification/__tests__/fixtures/b24-b3-price-table.malformed.json";
/** [B24-B3 review] A table pricing only the operator's configured models, and one pricing those and the replay-pinned defaults. */
const OPERATOR_TABLE = "app/lib/qualification/__tests__/fixtures/b24-b3-price-table.operator.fake.json";
const CONTRACT_TABLE = "app/lib/qualification/__tests__/fixtures/b24-b3-price-table.contract.fake.json";
/** The models an operator's shell configures, which the orchestration's replay pin overrides (B21 header `:13`). */
const OPERATOR_MODELS = Object.freeze({ openai: "gpt-fake-operator-b24", anthropic: "claude-fake-operator-b24" });
const NOTE = "[B24-B3, 2026-10-08]";
/** Factories a refused run may never call: a regression fails here, before any adapter or client exists. */
const unbuilt = (): never => { throw new Error("B24_B3_LIVE_ADAPTER_BUILT: the refused command built a live adapter"); };
const fakeKey = (provider: string): string => ["fake", provider, "key", "b24-b3"].join("-");
const answer = (usage: { inputTokens: number; outputTokens: number }): AgentStep => ({ text: "", toolCalls: [], stopReason: "completed", usage, model: "stub", continuation: { provider: "openai", state: null } });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetOrchestrationStoreFactory();
  sdk.options.length = 0;
  sdk.requests.length = 0;
});

/** A price table in the program's one schema, priced for two fake models of each provider (currency XTS: ISO 4217's testing code). */
function table(): LivePriceTable {
  return {
    schema: LIVE_PRICE_TABLE_SCHEMA,
    version: "1.0.0",
    currency: "XTS",
    prices: [
      { provider: "openai", model: "model-a", inputPerMillion: "2", outputPerMillion: "8" },
      { provider: "anthropic", model: "model-b", inputPerMillion: "3", outputPerMillion: "15" },
    ],
  };
}

describe("[B24-B3] the model-in-loop command, offline (D24-18; OD-216, OD-209, OD-125)", () => {
  it("1. the refusals, in order, each before any adapter or SDK client exists: the flag not exactly \"1\" (exit 2); the fixture runtime's scripted agent (exit 3); an absent key name, both for both (exit 3); no --price-table, no --spend-cap, a cap that is no decimal or a table the validator refuses (exit 2)", async () => {
    const live = await import(SCRIPT);
    const printed: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => { printed.push(String(line)); });
    vi.stubGlobal("fetch", () => { throw new Error("no network"); });
    const argv = process.argv;
    const run = async (environment: Record<string, string | undefined>, args: readonly string[] = []): Promise<number> => {
      process.argv = [argv[0]!, SCRIPT_PATH, ...args];
      try {
        return await live.main(environment, { coordinator: unbuilt, specialist: unbuilt });
      } finally {
        process.argv = argv;
      }
    };
    const FLAG = live.LIVE_FLAG as string;
    const PROVIDER = live.LIVE_PROVIDER_FLAG as string;
    const keys = { OPENAI_API_KEY: fakeKey("openai"), ANTHROPIC_API_KEY: fakeKey("anthropic") };
    const last = (): string => printed.at(-1) ?? "";
    expect(await run({ [FLAG]: "true" })).toBe(2);
    expect(last()).toMatch(new RegExp(`^refused: ${FLAG} is not "1"`));
    expect(await run({ [FLAG]: "1", SIRKIT_FIXTURE_RUNTIME: "blinker", SIRKIT_FIXTURE_AGENT: "scripted", ...keys })).toBe(3);
    expect(last()).toBe("not exercised: the fixture runtime's scripted agent is selected");
    expect(await run({ [FLAG]: "1" })).toBe(3);
    expect(last()).toBe("not exercised: OPENAI_API_KEY absent");
    expect(await run({ [FLAG]: "1", [PROVIDER]: "anthropic", OPENAI_API_KEY: keys.OPENAI_API_KEY })).toBe(3);
    expect(last()).toBe("not exercised: ANTHROPIC_API_KEY absent");
    expect(await run({ [FLAG]: "1", [PROVIDER]: "both" })).toBe(3);
    expect(last()).toBe("not exercised: OPENAI_API_KEY, ANTHROPIC_API_KEY absent");
    expect(await run({ [FLAG]: "1", [PROVIDER]: "both", ANTHROPIC_API_KEY: keys.ANTHROPIC_API_KEY })).toBe(3);
    expect(last()).toBe("not exercised: OPENAI_API_KEY absent");
    expect(await run({ [FLAG]: "1", ...keys })).toBe(2);
    expect(last()).toMatch(/^refused: --price-table <path> and --spend-cap <decimal> are required/);
    expect(await run({ [FLAG]: "1", ...keys }, ["--price-table", FAKE_TABLE])).toBe(2);
    expect(last()).toMatch(/^refused: --price-table <path> and --spend-cap <decimal> are required/);
    expect(await run({ [FLAG]: "1", ...keys }, ["--price-table", FAKE_TABLE, "--spend-cap", "1e3"])).toBe(2);
    expect(last()).toMatch(/^refused: --spend-cap is not decimal text/);
    expect(await run({ [FLAG]: "1", ...keys }, ["--price-table", MALFORMED_TABLE, "--spend-cap", "5"])).toBe(2);
    expect(last()).toMatch(/^refused: the price table fails sirkit\.live-price-table\.v1: PRICE_TABLE_CURRENCY, PRICE_NOT_DECIMAL, PRICE_ENTRY_REPEATED/);
    expect(await run({ [FLAG]: "1", ...keys }, ["--price-table", "app/lib/qualification/__tests__/fixtures/absent.json", "--spend-cap", "5"])).toBe(2);
    expect(last()).toMatch(/^refused: the price table cannot be read/);
    expect(await run({ [FLAG]: "1", ...keys }, ["--price-table", FAKE_TABLE, "--spend-cap", "5", "--contract-turns", "--unknown"])).toBe(2);
    expect(last()).toMatch(/^refused: unknown argument --unknown/);
    // nothing printed carries a key value, and the scripted-agent refusal also reads the process environment the adapters read
    for (const line of printed) for (const value of Object.values(keys)) expect(line.includes(value)).toBe(false);
    vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "blinker");
    vi.stubEnv("SIRKIT_FIXTURE_AGENT", "scripted");
    expect(await run({ [FLAG]: "1", ...keys })).toBe(3);
    // the order in the source: every refusal before the one place adapters are built
    const source = read(SCRIPT_PATH);
    const built = source.indexOf("boundedLiveAdapters(LIVE_CALL_BOUND, factories)");
    for (const refusal of ["if (environment[LIVE_FLAG] !== \"1\")", "if (await scriptedAgentSelected(environment))", "if (missingKeys.length > 0)", "if (spend === null)"]) {
      expect(source.indexOf(refusal), refusal).toBeGreaterThan(0);
      expect(source.indexOf(refusal), refusal).toBeLessThan(built);
    }
  });

  it("2. the spend gate: money is decimal text only; the request that could pass the cap is refused before it is sent; a response past the input reserve refuses every later request; an unknown usage counts its worst case; the validator refuses each malformed table on its own copy", async () => {
    // decimal text only: the module never turns money into a number
    const spendSource = read("app/lib/evaluation/live-spend.ts");
    expect(spendSource).not.toMatch(/\bNumber\(|parseFloat|parseInt/);
    expect(spendSource).toContain("from \"../release-engineering/procurement\"");
    expect(LIVE_INPUT_TOKEN_RESERVE).toBe(100_000);
    expect(MAX_OUTPUT_TOKENS).toBe(4096);
    // the worst case of one request on model-a: 2 x 100 000 + 8 x 4096 = 232 768 per-million units (0.232768 XTS)
    const spend = liveSpendBound(table(), "0.24", MAX_OUTPUT_TOKENS);
    expect(spend.worstCase("openai", "model-a")).toBe("0.232768");
    spend.admit("openai", "model-a");
    spend.settle("openai", "model-a", { inputTokens: 5000, outputTokens: 100 });
    expect(spend.record()).toEqual({ currency: "XTS", cap: "0.24", spentUpperBound: "0.0108", priceTableVersion: "1.0.0" });
    expect(() => spend.admit("openai", "model-a")).toThrow(LiveSpendRefusal);
    expect(() => spend.admit("openai", "model-a")).toThrow(/^LIVE_SPEND_CAP: /);
    expect(() => spend.admit("openai", "model-unpriced")).toThrow(/^LIVE_SPEND_MODEL_UNPRICED: /);
    // through the command's wrapper over stub adapters: the refused call never reaches the adapter it wraps, and is not counted
    const live = await import(SCRIPT);
    const invoked: string[] = [];
    const stub = (name: string, usage: { inputTokens: number; outputTokens: number }): ProviderAgentAdapter => ({ provider: "openai", start: async () => { invoked.push(`${name}:start`); return answer(usage); }, continueWith: async () => { invoked.push(`${name}:continue`); return answer(usage); } });
    const bounded = live.boundedLiveAdapters(5, { coordinator: () => stub("coordinator", { inputTokens: 5000, outputTokens: 100 }), specialist: (role: string) => stub(role, { inputTokens: LIVE_INPUT_TOKEN_RESERVE + 1, outputTokens: 10 }) });
    const metered = live.spendMeteredAdapters(bounded, liveSpendBound(table(), "0.24", MAX_OUTPUT_TOKENS), () => "model-a");
    const start = { system: "s", history: [], userMessage: "u", tools: [] };
    await metered.adapters.coordinator("openai").start(start);
    await expect(metered.adapters.coordinator("openai").start(start)).rejects.toThrow(/^LIVE_SPEND_CAP: /);
    expect(invoked).toEqual(["coordinator:start"]);
    expect(bounded.calls()).toBe(1);
    // a reserve overrun: the response reports more input tokens than were priced, and every later request is refused
    const roomy = live.spendMeteredAdapters(live.boundedLiveAdapters(5, { coordinator: () => stub("coordinator", { inputTokens: 1, outputTokens: 1 }), specialist: (role: string) => stub(role, { inputTokens: LIVE_INPUT_TOKEN_RESERVE + 1, outputTokens: 10 }) }), liveSpendBound(table(), "100", MAX_OUTPUT_TOKENS), () => "model-a");
    await roomy.adapters.specialist("schematic", "openai", "model-a").start(start);
    await expect(roomy.adapters.coordinator("openai").start(start)).rejects.toThrow(/^LIVE_SPEND_RESERVE_OVERRUN: /);
    await expect(roomy.adapters.specialist("schematic", "openai", "model-a").continueWith({ continuation: { provider: "openai", state: null }, results: [], tools: [] })).rejects.toThrow(/^LIVE_SPEND_RESERVE_OVERRUN: /);
    // an unknown usage (a failed request) counts its worst case: the bound is an upper bound
    const unknown = liveSpendBound(table(), "1", MAX_OUTPUT_TOKENS);
    unknown.admit("anthropic", "model-b");
    unknown.settle("anthropic", "model-b", null);
    expect(unknown.record().spentUpperBound).toBe("0.36144");
    // the validator: one code per refusal, each on its own mutated copy; a valid table and its required models pass
    expect(livePriceTableProblems(table(), [{ provider: "openai", model: "model-a" }, { provider: "anthropic", model: "model-b" }])).toEqual([]);
    const fires = (code: string, mutate: (copy: Record<string, unknown>) => void, required: ReadonlyArray<{ provider: "openai" | "anthropic"; model: string }> = []): void => {
      const copy = structuredClone(table()) as unknown as Record<string, unknown>;
      mutate(copy);
      expect(livePriceTableProblems(copy, required), code).toEqual([code]);
    };
    const prices = (copy: Record<string, unknown>): Array<Record<string, unknown>> => copy.prices as Array<Record<string, unknown>>;
    fires("PRICE_TABLE_SHAPE", (copy) => { copy.extra = 1; });
    fires("PRICE_TABLE_SHAPE", (copy) => { prices(copy)[0]!.note = "x"; });
    fires("PRICE_TABLE_SCHEMA", (copy) => { copy.schema = "sirkit.live-price-table.v2"; });
    fires("PRICE_TABLE_VERSION", (copy) => { copy.version = "one"; });
    fires("PRICE_TABLE_CURRENCY", (copy) => { delete copy.currency; });
    fires("PRICE_TABLE_CURRENCY", (copy) => { copy.currency = "usd"; });
    fires("PRICE_NOT_DECIMAL", (copy) => { prices(copy)[0]!.inputPerMillion = 2; });
    fires("PRICE_NOT_DECIMAL", (copy) => { prices(copy)[0]!.outputPerMillion = "-1"; });
    fires("PRICE_NOT_DECIMAL", (copy) => { prices(copy)[1]!.inputPerMillion = "1e3"; });
    fires("PRICE_ENTRY_MISSING", (copy) => { prices(copy)[1]!.model = ""; });
    fires("PRICE_ENTRY_MISSING", (copy) => { prices(copy)[1]!.provider = "mistral"; });
    fires("PRICE_ENTRY_MISSING", () => undefined, [{ provider: "anthropic", model: "model-c" }]);
    fires("PRICE_ENTRY_REPEATED", (copy) => { prices(copy).push({ ...prices(copy)[0]! }); });
    expect([...LIVE_PRICE_TABLE_PROBLEM_CODES]).toEqual(["PRICE_TABLE_SHAPE", "PRICE_TABLE_SCHEMA", "PRICE_TABLE_VERSION", "PRICE_TABLE_CURRENCY", "PRICE_NOT_DECIMAL", "PRICE_ENTRY_MISSING", "PRICE_ENTRY_REPEATED"]);
    // the committed fixtures: the fake table is valid, the malformed one carries three refusals
    expect(livePriceTableProblems(JSON.parse(read(FAKE_TABLE)) as unknown)).toEqual([]);
    expect(livePriceTableProblems(JSON.parse(read(MALFORMED_TABLE)) as unknown)).toEqual(["PRICE_TABLE_CURRENCY", "PRICE_NOT_DECIMAL", "PRICE_ENTRY_REPEATED"]);
  });

  it("3. the two-provider capsule (full-circuit-creation DAG, one role per provider): it validates, replays twice to the same digest with scripted adapters, shows both providers in its task traces, and is absent from B21's orchestration category, whose seven cases and four task graphs stay", { timeout: 30_000 }, async () => {
    const entry = twoProviderCase();
    expect(entry.caseId).toBe(TWO_PROVIDER_CASE_ID);
    expect(parseReplayCapsule(entry.capsule).ok).toBe(true);
    const first = await runOrchestrationCase(entry);
    const second = await runOrchestrationCase(entry);
    expect(first.failures).toEqual([]);
    expect(first.route).toEqual({ kind: "dag", rule: TWO_PROVIDER_DAG_RULE });
    expect(TWO_PROVIDER_DAG_RULE).toBe("D-full-circuit-creation");
    expect(second.replayDigest).toBe(first.replayDigest);
    expect([...new Set(first.taskTraces.map((trace) => trace.provider))].sort()).toEqual(["anthropic", "openai"]);
    expect(first.events.at(-1)?.type).toBe("run_completed");
    for (const check of entry.checks) expect(check.evaluate(first).pass, check.id).toBe(true);
    const category = buildOrchestrationEvaluationCases();
    expect(category).toHaveLength(7);
    expect(category.map((item) => item.caseId)).not.toContain(TWO_PROVIDER_CASE_ID);
    expect(category.filter((item) => (item.capsule.tasks ?? []).length > 0).map((item) => item.caseId)).toEqual(["f05-compact-dag", "f09-timeout-dag", "f10-quota-dag", "f11-malicious-dag"]);
    // the command reaches it only through liveTwoProviderCases(), and records the closed vocabulary only
    const live = await import(SCRIPT);
    const cases = await live.liveTwoProviderCases();
    expect(cases.map((item: { caseId: string }) => item.caseId)).toEqual([TWO_PROVIDER_CASE_ID]);
    for (const provider of ["openai", "anthropic"] as const) expect(live.liveEvaluationCases(provider).map((item: { caseId: string }) => item.caseId)).not.toContain(TWO_PROVIDER_CASE_ID);
    const recorded = live.recordCase(entry, first) as Record<string, unknown>;
    expect(Object.keys(recorded).sort()).toEqual(["caseId", "decisions", "degraded", "events", "faultReproduced", "offlineChecks", "runbookLine", "scriptedFault", "specialists", "terminal"]);
    expect(JSON.stringify(recorded)).not.toMatch(/\(scripted\)/);
  });

  it("4. the per-provider contract turns, against fake clients: one forced-tool request per provider through the router's provider classes, the exact strict schema; a valid answer records valid, an invalid or absent call invalid; a turn past the bound is refused before it is sent; nothing but four yes/no facts and a verdict is recorded", async () => {
    const live = await import(SCRIPT);
    const tool = live.CONTRACT_TOOL as { name: string; inputSchema: Record<string, unknown>; strict: boolean };
    expect(tool.strict).toBe(true);
    expect(tool.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
    const valid = live.CONTRACT_TURN_VALID_ARGUMENTS as Record<string, unknown>;
    const openaiCreate = vi.fn(async (params: unknown): Promise<unknown> => (void params, { id: "r1", model: "fake", status: "completed", output_text: "", output: [{ type: "function_call", call_id: "c1", name: tool.name, arguments: JSON.stringify(valid) }], usage: { input_tokens: 40, output_tokens: 12 } }));
    const anthropicCreate = vi.fn(async (params: unknown): Promise<unknown> => (void params, { id: "m1", model: "fake", stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: tool.name, input: { ...valid, extra: "x" } }], usage: { input_tokens: 40, output_tokens: 12 } }));
    const providers = [
      { provider: "openai" as const, model: "model-a", llm: new OpenAIProvider({ responses: { create: openaiCreate } } as never, "model-a") },
      { provider: "anthropic" as const, model: "model-b", llm: new AnthropicProvider({ messages: { create: anthropicCreate } } as never, "model-b") },
    ];
    const spend = liveSpendBound(table(), "5", MAX_OUTPUT_TOKENS);
    const meter = live.contractTurnMeter({ calls: () => 0 }, 40, spend);
    const records = await live.runContractTurns(providers, meter);
    expect(records).toEqual([
      { provider: "openai", toolCalled: true, nameMatched: true, argumentsValid: true, verdict: "valid" },
      { provider: "anthropic", toolCalled: true, nameMatched: true, argumentsValid: false, verdict: "invalid" },
    ]);
    const openaiParams = openaiCreate.mock.calls[0]![0] as { tools: Array<{ name: string; parameters: unknown; strict: boolean }>; tool_choice: unknown };
    expect(openaiParams.tools).toHaveLength(1);
    expect(openaiParams.tools[0]!.parameters).toBe(tool.inputSchema);
    expect(openaiParams.tools[0]!.strict).toBe(true);
    expect(openaiParams.tool_choice).toEqual({ type: "function", name: tool.name });
    const anthropicParams = anthropicCreate.mock.calls[0]![0] as { tools: Array<{ name: string; input_schema: unknown; strict?: boolean }>; tool_choice: unknown };
    expect(anthropicParams.tools[0]!.input_schema).toBe(tool.inputSchema);
    expect(anthropicParams.tools[0]!.strict).toBe(true);
    expect(anthropicParams.tool_choice).toEqual({ type: "tool", name: tool.name });
    expect(meter.calls()).toBe(2);
    expect(spend.record().spentUpperBound).toBe("0.000476");
    // an absent tool call and a wrong name are invalid; the record holds no text, no arguments and no model
    openaiCreate.mockResolvedValueOnce({ id: "r2", model: "fake", status: "completed", output_text: "a model's words", output: [], usage: { input_tokens: 1, output_tokens: 1 } });
    anthropicCreate.mockResolvedValueOnce({ id: "m2", model: "fake", stop_reason: "tool_use", content: [{ type: "tool_use", id: "t2", name: "another_tool", input: valid }], usage: { input_tokens: 1, output_tokens: 1 } });
    const second = await live.runContractTurns(providers, live.contractTurnMeter({ calls: () => 0 }, 40, liveSpendBound(table(), "5", MAX_OUTPUT_TOKENS)));
    expect(second).toEqual([
      { provider: "openai", toolCalled: false, nameMatched: false, argumentsValid: false, verdict: "invalid" },
      { provider: "anthropic", toolCalled: true, nameMatched: false, argumentsValid: false, verdict: "invalid" },
    ]);
    expect(JSON.stringify(second)).not.toContain("a model's words");
    // the shared request bound: with the orchestration's calls at the bound, no turn is sent
    const before = openaiCreate.mock.calls.length;
    const refused = await live.runContractTurns(providers, live.contractTurnMeter({ calls: () => 40 }, 40, liveSpendBound(table(), "5", MAX_OUTPUT_TOKENS)));
    expect(refused.map((item: { verdict: string }) => item.verdict)).toEqual(["refused", "refused"]);
    expect(openaiCreate.mock.calls.length).toBe(before);
    // the shared spend bound: a cap below one turn's worst case refuses it before it is sent
    const poor = await live.runContractTurns(providers, live.contractTurnMeter({ calls: () => 0 }, 40, liveSpendBound(table(), "0.01", MAX_OUTPUT_TOKENS)));
    expect(poor.map((item: { verdict: string }) => item.verdict)).toEqual(["refused", "refused"]);
    expect(openaiCreate.mock.calls.length).toBe(before);
  });

  it("5. B21's pins hold - the flag refusal first, the call bound's literal after it, boundedLiveAdapters' signature, main's two parameters, liveEvaluationCases on one provider, each B21 anchor once and on its line - and the dated notes stand where B21's one-provider statements are; the clients module is the sixth SDK importer with two maxRetries 0 constructions", () => {
    const source = read(SCRIPT_PATH);
    const lines = source.split(NEWLINE);
    const anchors: ReadonlyArray<readonly [number, string]> = [
      [35, "export const LIVE_CALL_BOUND = 40;"],
      [43, "export const LIVE_ADAPTER_FACTORIES: LiveOrchestrationAdapters = Object.freeze<LiveOrchestrationAdapters>({"],
      [46, "if (adapter instanceof OpenAIAgentAdapter) return new OpenAIAgentAdapter(undefined, undefined, undefined, LIVE_SDK_MAX_RETRIES);"],
      [54, "export function boundedLiveAdapters("],
      [58, "if (calls >= bound) throw new LLMProviderError(adapter.provider, \"unknown\");"],
      [71, "export function liveEvaluationCases(provider: \"openai\" | \"anthropic\"): OrchestrationEvaluationCase[] {"],
      [75, "export async function main(environment: Record<string, string | undefined> = process.env, factories: LiveOrchestrationAdapters = LIVE_ADAPTER_FACTORIES)"],
      [76, "if (environment[LIVE_FLAG] !== \"1\") {"],
    ];
    for (const [line, anchor] of anchors) {
      expect(lines[line - 1], `:${line}`).toContain(anchor);
      expect(source.split(anchor).length - 1, anchor).toBe(1);
    }
    expect(source).toContain("export function boundedLiveAdapters(bound: number = LIVE_CALL_BOUND, factories: LiveOrchestrationAdapters = LIVE_ADAPTER_FACTORIES)");
    expect(source.indexOf("if (environment[LIVE_FLAG] !== \"1\")")).toBeLessThan(source.indexOf("boundedLiveAdapters(LIVE_CALL_BOUND, factories)"));
    expect(lines.slice(14, 18).join(" ")).toContain(NOTE);
    // the B21 one-provider statements carry the dated note on their own lines
    const matrix = read(MATRIX).split(NEWLINE);
    for (const [from, to] of [[64, 68], [671, 680], [772, 778]] as const) expect(matrix.slice(from - 1, to).join(" "), `evaluation-matrix.md:${from}-${to}`).toContain(NOTE);
    const three = read(MATRIX).slice(read(MATRIX).indexOf(`${NEWLINE}## 3. `), read(MATRIX).indexOf(`${NEWLINE}## 4. `));
    expect(three).toContain(NOTE);
    expect(three.replace(/\s+/g, " ")).toContain("no provider disagreement and no provider fallback");
    const capsuleSuite = read("app/lib/agent/orchestration/__tests__/b21-f-replay-capsule.test.ts");
    expect(capsuleSuite.split(NEWLINE)[172]).toMatch(/^ {2}it\("9\. [^\n]*\/\/ \[B24-B3, 2026-10-08\] /);
    expect((capsuleSuite.match(/^\s*it\(/gm) ?? []).length).toBe(10);
    // the clients module: two constructions, one object literal each, apiKey / maxRetries 0 / timeout only
    const clients = read("app/lib/evaluation/live-contract-clients.ts");
    const constructions = [...clients.matchAll(/new (OpenAI|Anthropic)\(\{([^}]*)\}\)/g)];
    expect(constructions.map((match) => match[1])).toEqual(["OpenAI", "Anthropic"]);
    for (const match of constructions) expect(match[2]!.split(",").map((part) => part.trim().split(":")[0]!.trim()).filter(Boolean).sort()).toEqual(["apiKey", "maxRetries", "timeout"]);
    expect(clients.match(/maxRetries: 0, /g)).toHaveLength(2);
    expect(clients).not.toMatch(/process\.env/);
    // [B24-B3 review] moved here from b24-a1-configuration case 14 (B24-A1's test logic is not B24-B3's to extend): no production module
    // but the record-only command reaches the clients module, so a server never builds its clients and the deployment record states none
    const productionSources = (dir: string): string[] => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return entry.name === "__tests__" || entry.name === "node_modules" || entry.name.startsWith(".") ? [] : productionSources(path);
      return /\.(?:tsx?|mts|mjs|cjs|js)$/.test(entry.name) && !/\.(?:test|spec)\.[a-z]+$/.test(entry.name) ? [path] : [];
    });
    const contractClients = "app/lib/evaluation/live-contract-clients.ts";
    expect(["app", "lib", "components", "scripts"].flatMap((dir) => productionSources(dir)).filter((path) => path !== contractClients && read(path).includes("evaluation/live-contract-clients"))).toEqual([SCRIPT_PATH]);
  });

  it("6. scenario-map.md section 4 states the refusals with their exits, the money bound and the one price table, the capsule's DAG and what a live run can and cannot show, the contract turns, and every live run BLOCKED-LIVE-QUALIFICATION", () => {
    const page = read(PAGE);
    const start = page.indexOf(`${NEWLINE}## 4. `);
    const four = page.slice(start, page.indexOf(`${NEWLINE}## `, start + 1));
    for (const fact of [
      "exit 2", "exit 3", "not exercised: the fixture runtime's scripted agent is selected", "--price-table", "--spend-cap", "--contract-turns",
      LIVE_PRICE_TABLE_SCHEMA, "`LIVE_INPUT_TOKEN_RESERVE`", "100000", "4096", "`addDecimal`", "`multiplyDecimalByInteger`", "`compareDecimal`",
      "`spentUpperBound`", "`priceTableVersion`", "`currency`", "`cap`", "D-full-circuit-creation", TWO_PROVIDER_CASE_ID,
      "cannot force a disagreement or a fallback", "`both`", "maxRetries: 0", "valid", "invalid", "refused",
      "LB-2", "LB-9", "OD-216", "OD-125", "**BLOCKED-LIVE-QUALIFICATION**", "B24-C2",
      // [B24-B3 review] the models the run calls and prices, the record's `models`, the turns' output ceiling and their `incomplete` verdict
      "the model it is sent with", "replay-pinned", "`models`", "`incomplete`", "`MAX_OUTPUT_TOKENS`",
    ]) expect(four, fact).toContain(fact);
  });

  it("7. [B24-B3 review] the accepted path through main, over the real adapter factories and faked SDK modules: the table is validated against the models the run calls - the orchestration's replay-pinned models, never the operator's configured one, which the pin overrides - each request is metered at the model it is sent with, and the printed sirkit.b21-model-in-loop-record.v2 holds calls and money fields equal to a recomputation from the requests the fakes received; a table pricing only the operator's models refuses (exit 2) before any adapter exists; --contract-turns prices the operator's models too; a cap below one worst case sends nothing", { timeout: 120_000 }, async () => {
    const live = await import(SCRIPT);
    const printed: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => { printed.push(String(line)); });
    vi.stubGlobal("fetch", () => { throw new Error("no network"); });
    const FLAG = live.LIVE_FLAG as string;
    const PROVIDER = live.LIVE_PROVIDER_FLAG as string;
    const keys = { OPENAI_API_KEY: fakeKey("openai"), ANTHROPIC_API_KEY: fakeKey("anthropic") };
    // the operator's shell: fake keys, its own configured models; the adapters read the process environment, so it holds the same
    const shell = { ...keys, SIRKIT_OPENAI_MODEL: OPERATOR_MODELS.openai, SIRKIT_ANTHROPIC_MODEL: OPERATOR_MODELS.anthropic, SIRKIT_FIXTURE_RUNTIME: "" };
    for (const [name, value] of Object.entries(shell)) vi.stubEnv(name, value);
    const argv = process.argv;
    const run = async (args: readonly string[], environment: Record<string, string | undefined>, factories?: unknown): Promise<number> => {
      process.argv = [argv[0]!, SCRIPT_PATH, ...args];
      sdk.requests.length = 0;
      sdk.options.length = 0;
      try {
        return factories === undefined ? await live.main(environment) : await live.main(environment, factories);
      } finally {
        process.argv = argv;
      }
    };
    const recordOf = (): Record<string, unknown> => {
      const text = [...printed].reverse().find((line) => line.startsWith("{"));
      expect(text, "the record was printed").toBeDefined();
      return JSON.parse(text!) as Record<string, unknown>;
    };
    /** The money the requests the fakes received cost, each priced at the model it was SENT with (a fresh bound over the same table). */
    const recomputed = (path: string): string => {
      const bound = liveSpendBound(JSON.parse(read(path)) as LivePriceTable, "1000", MAX_OUTPUT_TOKENS);
      for (const request of sdk.requests) {
        const model = String(request.params.model);
        bound.admit(request.provider, model);
        bound.settle(request.provider, model, { inputTokens: sdk.usage.input_tokens, outputTokens: sdk.usage.output_tokens });
      }
      return bound.record().spentUpperBound;
    };
    const forced = (request: { params: Record<string, unknown> }): boolean => typeof request.params.tool_choice === "object" && request.params.tool_choice !== null && "name" in request.params.tool_choice;
    const pinned = { openai: DEFAULT_OPENAI_MODEL, anthropic: DEFAULT_ANTHROPIC_MODEL };
    const environment = { [FLAG]: "1", ...shell };

    // (a) one provider, the table pricing the replay-pinned models only: the run is admitted and every request is priced at its sent model
    expect(await run(["--price-table", FAKE_TABLE, "--spend-cap", "5"], { ...environment, [PROVIDER]: "anthropic" })).toBe(0);
    const one = recordOf();
    expect(sdk.requests.length).toBeGreaterThan(0);
    expect([...new Set(sdk.requests.map((request) => `${request.provider} ${String(request.params.model)}`))]).toEqual([`anthropic ${pinned.anthropic}`]);
    expect(one).toMatchObject({ schema: "sirkit.b21-model-in-loop-record.v2", provider: "anthropic", callBound: 40, sdkMaxRetries: 0, currency: "XTS", cap: "5", priceTableVersion: "1.0.0", contractTurns: [] });
    expect(one.models).toEqual({ orchestration: { anthropic: pinned.anthropic }, contractTurns: null });
    expect(one.calls).toBe(sdk.requests.length);
    expect(one.spentUpperBound).toBe(recomputed(FAKE_TABLE));
    expect(one.spentUpperBound).not.toBe("0");
    expect(sdk.options.length).toBeGreaterThan(0);
    for (const built of sdk.options) expect(built.options.maxRetries, built.provider).toBe(0);
    // (b) a table pricing only the operator's configured models: refused before any adapter or client exists
    expect(await run(["--price-table", OPERATOR_TABLE, "--spend-cap", "5"], { ...environment, [PROVIDER]: "anthropic" }, { coordinator: unbuilt, specialist: unbuilt })).toBe(2);
    expect(printed.at(-1)).toMatch(/^refused: the price table fails sirkit\.live-price-table\.v1: PRICE_ENTRY_MISSING/);
    expect(sdk.requests).toEqual([]);
    // (c) both providers with the contract turns: the orchestration on the pinned models, the turns on the operator's, each priced at its own
    expect(await run(["--price-table", FAKE_TABLE, "--spend-cap", "5", "--contract-turns"], { ...environment, [PROVIDER]: "both" }, { coordinator: unbuilt, specialist: unbuilt })).toBe(2);
    expect(printed.at(-1)).toMatch(/^refused: the price table fails sirkit\.live-price-table\.v1: PRICE_ENTRY_MISSING/);
    expect(await run(["--price-table", CONTRACT_TABLE, "--spend-cap", "5", "--contract-turns"], { ...environment, [PROVIDER]: "both" })).toBe(0);
    const both = recordOf();
    expect([...new Set(sdk.requests.filter((request) => !forced(request)).map((request) => `${request.provider} ${String(request.params.model)}`))].sort()).toEqual([`anthropic ${pinned.anthropic}`, `openai ${pinned.openai}`]);
    expect(sdk.requests.filter(forced).map((request) => `${request.provider} ${String(request.params.model)}`)).toEqual([`openai ${OPERATOR_MODELS.openai}`, `anthropic ${OPERATOR_MODELS.anthropic}`]);
    expect(both.models).toEqual({ orchestration: pinned, contractTurns: OPERATOR_MODELS });
    expect(both.contractTurns).toEqual([
      { provider: "openai", toolCalled: true, nameMatched: true, argumentsValid: true, verdict: "valid" },
      { provider: "anthropic", toolCalled: true, nameMatched: true, argumentsValid: true, verdict: "valid" },
    ]);
    expect(both.calls).toBe(sdk.requests.length);
    expect(both.spentUpperBound).toBe(recomputed(CONTRACT_TABLE));
    // (d) a cap below one request's worst case: the run is admitted, and no request reaches a client
    expect(await run(["--price-table", FAKE_TABLE, "--spend-cap", "0.000001"], { ...environment, [PROVIDER]: "anthropic" })).toBe(0);
    const poor = recordOf();
    expect(sdk.requests).toEqual([]);
    expect(poor).toMatchObject({ calls: 0, spentUpperBound: "0", cap: "0.000001" });
    // nothing printed carries a key value
    for (const line of printed) for (const value of Object.values(keys)) expect(line.includes(value)).toBe(false);
  });

  it("8. [B24-B3 review] the spend wrapper's failure branches and the in-flight reservation, through spendMeteredAdapters: a request the call bound refuses was never sent and returns its reservation; a request that fails after the call bound counted it keeps its worst case; a request admitted while another is in flight is priced beside that one's worst case, so the one that would pass the cap with it is refused before it is sent", async () => {
    const live = await import(SCRIPT);
    const start = { system: "s", history: [], userMessage: "u", tools: [] };
    const worst = liveSpendBound(table(), "1", MAX_OUTPUT_TOKENS).worstCase("openai", "model-a");
    expect(worst).toBe("0.232768");
    const sent: string[] = [];
    const adapter = (name: string, reply: () => Promise<AgentStep>): ProviderAgentAdapter => ({ provider: "openai", start: async () => { sent.push(`${name}:start`); return reply(); }, continueWith: async () => { sent.push(`${name}:continue`); return reply(); } });
    // (1) a call bound of one: the second request is refused by the bound, never sent, and its worst case is returned
    const small = adapter("small", async () => answer({ inputTokens: 5000, outputTokens: 100 }));
    const oneCall = live.boundedLiveAdapters(1, { coordinator: () => small, specialist: () => small });
    const capped = liveSpendBound(table(), "1", MAX_OUTPUT_TOKENS);
    const metered = live.spendMeteredAdapters(oneCall, capped, () => "model-a");
    await metered.adapters.coordinator("openai").start(start);
    await expect(metered.adapters.coordinator("openai").start(start)).rejects.toBeInstanceOf(LLMProviderError);
    expect(sent).toEqual(["small:start"]);
    expect(oneCall.calls()).toBe(1);
    expect(capped.record().spentUpperBound).toBe("0.0108");
    // (2) a request sent and then failed (a timeout or a 5xx after the provider took it): its usage is unknown, so its worst case stays
    const failing = adapter("failing", async () => { throw new LLMProviderError("openai", "unknown"); });
    const kept = liveSpendBound(table(), "1", MAX_OUTPUT_TOKENS);
    const afterSend = live.spendMeteredAdapters(live.boundedLiveAdapters(5, { coordinator: () => failing, specialist: () => failing }), kept, () => "model-a");
    await expect(afterSend.adapters.specialist("schematic", "openai", "model-a").start(start)).rejects.toBeInstanceOf(LLMProviderError);
    expect(sent).toEqual(["small:start", "failing:start"]);
    expect(kept.record().spentUpperBound).toBe(worst);
    // (3) two requests at once, as DAG specialists run: the first's worst case stays reserved while it is in flight, so the second -
    //     which fits the cap alone (0.232768 of 0.4) but not beside the first (0.465536) - is refused before it is sent
    let release: () => void = () => undefined;
    const gate = new Promise<void>((done) => { release = done; });
    const slow = adapter("slow", async () => { await gate; return answer({ inputTokens: 1, outputTokens: 1 }); });
    const pair = liveSpendBound(table(), "0.4", MAX_OUTPUT_TOKENS);
    const concurrent = live.spendMeteredAdapters(live.boundedLiveAdapters(5, { coordinator: () => slow, specialist: () => slow }), pair, () => "model-a");
    const first = concurrent.adapters.specialist("schematic", "openai", "model-a").start(start);
    const second = concurrent.adapters.specialist("circuit-topology", "openai", "model-a").start(start);
    const outcome = (request: Promise<unknown>): Promise<string> => request.then(() => "answered", (error: Error) => error.message);
    // a refusal settles at once; a request the bound let through would still be waiting on the gate: read either without hanging
    expect(await Promise.race([outcome(second), new Promise<string>((done) => setImmediate(() => done("in flight: admitted and sent")))])).toMatch(/^LIVE_SPEND_CAP: /);
    expect(pair.record().spentUpperBound).toBe(worst);
    release();
    await first;
    await outcome(second);
    expect(sent.filter((call) => call.startsWith("slow:"))).toEqual(["slow:start"]);
    expect(pair.record().spentUpperBound).toBe("0.00001");
  });

  it("9. [B24-B3 review] a contract turn is sent with the adapters' output ceiling (MAX_OUTPUT_TOKENS, the 4096 its worst case is priced at), so a reasoning model's thinking cannot starve the forced call; a response that stopped incomplete (OpenAI status incomplete, Anthropic max_tokens) without a valid call records verdict incomplete, never invalid; a complete answer without the call stays invalid", async () => {
    const live = await import(SCRIPT);
    const tool = live.CONTRACT_TOOL as { name: string };
    const openaiCreate = vi.fn(async (params: unknown): Promise<unknown> => (void params, { id: "r1", model: "fake", status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output_text: "", output: [{ type: "reasoning", id: "rs1", summary: [] }], usage: { input_tokens: 40, output_tokens: 4096 } }));
    const anthropicCreate = vi.fn(async (params: unknown): Promise<unknown> => (void params, { id: "m1", model: "fake", stop_reason: "max_tokens", content: [], usage: { input_tokens: 40, output_tokens: 4096 } }));
    const providers = [
      { provider: "openai" as const, model: "model-a", llm: new OpenAIProvider({ responses: { create: openaiCreate } } as never, "model-a") },
      { provider: "anthropic" as const, model: "model-b", llm: new AnthropicProvider({ messages: { create: anthropicCreate } } as never, "model-b") },
    ];
    const meter = (): unknown => live.contractTurnMeter({ calls: () => 0 }, 40, liveSpendBound(table(), "5", MAX_OUTPUT_TOKENS));
    const cut = await live.runContractTurns(providers, meter());
    expect((openaiCreate.mock.calls[0]![0] as { max_output_tokens?: unknown }).max_output_tokens).toBe(MAX_OUTPUT_TOKENS);
    expect((anthropicCreate.mock.calls[0]![0] as { max_tokens?: unknown }).max_tokens).toBe(MAX_OUTPUT_TOKENS);
    expect(cut).toEqual([
      { provider: "openai", toolCalled: false, nameMatched: false, argumentsValid: false, verdict: "incomplete" },
      { provider: "anthropic", toolCalled: false, nameMatched: false, argumentsValid: false, verdict: "incomplete" },
    ]);
    // a complete answer without the call is the model's own answer: invalid
    openaiCreate.mockResolvedValueOnce({ id: "r2", model: "fake", status: "completed", output_text: "", output: [], usage: { input_tokens: 1, output_tokens: 1 } });
    anthropicCreate.mockResolvedValueOnce({ id: "m2", model: "fake", stop_reason: "end_turn", content: [], usage: { input_tokens: 1, output_tokens: 1 } });
    expect((await live.runContractTurns(providers, meter())).map((item: { verdict: string }) => item.verdict)).toEqual(["invalid", "invalid"]);
    expect(tool.name).toBe("sirkit_contract_component");
  });
});
