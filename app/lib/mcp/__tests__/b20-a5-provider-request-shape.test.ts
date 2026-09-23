/**
 * [B20 A5] The request-shape ratchet (OD-90, OD-45). It pins EXISTING behaviour and is green before any A5 code: both agent
 * adapters render FUNCTION TOOLS ONLY, their request key sets are closed, their options are `{ signal }` alone, and nothing
 * a connector needs — a connector field, a beta header or a provider host — is ever serialised. This, with the tripwire and
 * the importer, closure and constructor gates, is what proves "no provider-native connector is rendered".
 *
 * No network: both clients are in-process fakes and the global fetch is poisoned. Fixture credentials are assembled at run
 * time and are obvious fakes (S8).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnthropicAgentAdapter, OpenAIAgentAdapter } from "../../agent/adapters";
import { buildAgentToolDeclarations, strictCompatibility } from "../../agent/provider-tools";
import type { ProviderToolDeclaration } from "../../agent/contracts";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS } from "../../engineering/agent-exposure";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";

/** obvious fakes, assembled at run time so no file carries a key-shaped literal (S8) */
const TOKEN = ["fxA5", "7c2e", "91bd", "44f0"].join("-");

vi.stubGlobal("fetch", () => { throw new Error("no network"); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.stubGlobal("fetch", () => { throw new Error("no network"); }); });

/** the connector wire vocabulary (D6): no request either adapter builds may carry one */
const D6_TOKENS = [
  "mcp_servers", "mcp_toolset", "mcp_server_name", "mcp_tool_listing", "authorization_token", "server_url", "server_label",
  "server_description", "connector_id", "tunnel_id", "require_approval", "allowed_tools", "defer_loading", "default_config",
  "mcp_approval", "mcp_list_tools", "mcp_call", "mcp_tool_use", "mcp_tool_result",
];
const D6_FOLDED = ["anthropic-beta", "mcp-client-20", "api.openai.com", "api.anthropic.com"];
const D6_PATTERNS = [/["'`]?type["'`]?\s*:\s*["'`]mcp["'`]/, /\.beta\./, /\bbetas\b/];

function expectNoConnectorVocabulary(text: string, label: string): void {
  for (const token of D6_TOKENS) expect(text, `${label} carries ${token}`).not.toContain(token);
  const folded = text.toLowerCase();
  for (const token of D6_FOLDED) expect(folded, `${label} carries ${token}`).not.toContain(token);
  for (const pattern of D6_PATTERNS) expect(text, `${label} matches ${pattern.source}`).not.toMatch(pattern);
}

/** every agent-exposed descriptor the registry renders strictly, plus one FOREIGN-shaped declaration (an A2-accepted tool) */
const registry = sirkitToolRegistry();
const DECLARATIONS: readonly ProviderToolDeclaration[] = [
  ...buildAgentToolDeclarations(registry.list().filter((descriptor) => INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.includes(descriptor.toolId) && strictCompatibility(descriptor).ok)).declarations,
  {
    providerName: "mcp_docs-example__search",
    toolId: "mcp.docs-example.search",
    version: "1.0.0",
    description: "Search (fixture).",
    inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"], additionalProperties: false },
  },
];

const OPENAI_PARAM_KEYS = ["model", "instructions", "input", "tools", "tool_choice", "parallel_tool_calls", "max_output_tokens", "reasoning", "include", "store", "stream"];
const ANTHROPIC_PARAM_KEYS = ["model", "max_tokens", "system", "messages", "tools", "tool_choice"];

const openAIResponse = (output: unknown[], text = ""): never =>
  ({ output, output_text: text, status: "completed", model: "gpt-test", usage: { input_tokens: 1, output_tokens: 1 } }) as never;
const anthropicMessage = (content: unknown[]): never =>
  ({ content, stop_reason: "end_turn", model: "claude-test", usage: { input_tokens: 1, output_tokens: 1 } }) as never;
const START = { system: "sys", history: [] as never[], userMessage: "hi" };
/** what each fake client answers — a continuation round-trips these items verbatim into the NEXT request's input */
const OPENAI_FAKE_OUTPUT = [{ type: "message", role: "assistant", content: [] }];
const ANTHROPIC_FAKE_CONTENT = [{ type: "text", text: "done" }];

/** every string anywhere in a value: object KEYS and string values alike */
function stringsOf(value: unknown, into: Set<string> = new Set<string>()): Set<string> {
  if (typeof value === "string") { into.add(value); return into; }
  if (Array.isArray(value)) { for (const item of value) stringsOf(item, into); return into; }
  if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) { into.add(key); stringsOf(entry, into); }
  }
  return into;
}

/** the request shape both adapters write themselves: every one of these is a literal in `adapters.ts`, never an input */
const SHAPE_VOCABULARY = [
  "model", "instructions", "input", "tools", "tool_choice", "parallel_tool_calls", "max_output_tokens", "reasoning",
  "include", "store", "stream", "max_tokens", "system", "messages", "effort", "medium", "auto", "role", "content",
  "user", "assistant", "type", "function", "name", "description", "parameters", "strict", "input_schema",
  "disable_parallel_tool_use", "reasoning.encrypted_content", "function_call_output", "call_id", "output",
  "tool_result", "tool_use_id", "is_error",
];

type Call = [Record<string, unknown>, Record<string, unknown>];
const callsOf = (create: { mock: { calls: unknown[] } }): Call[] =>
  (create.mock.calls as unknown[][]).map((call) => [call[0] as Record<string, unknown>, call[1] as Record<string, unknown>]);

/** drive both calls of one adapter and return every (params, options) pair the fake client saw */
async function openAiCalls(tools: readonly ProviderToolDeclaration[]): Promise<Call[]> {
  const create = vi.fn(async () => openAIResponse(OPENAI_FAKE_OUTPUT, "done"));
  const adapter = new OpenAIAgentAdapter({ responses: { create } } as never, "gpt-test", "medium");
  const step = await adapter.start({ ...START, tools });
  await adapter.continueWith({ continuation: step.continuation, results: [{ callId: "call_1", outputText: "{}", isError: false }], tools });
  return callsOf(create);
}

async function anthropicCalls(tools: readonly ProviderToolDeclaration[]): Promise<Call[]> {
  const create = vi.fn(async () => anthropicMessage(ANTHROPIC_FAKE_CONTENT));
  // the adapter never reaches the SDK's beta surface: touching it fails the test where it happens
  const client = { messages: { create }, get beta(): never { throw new Error("beta touched"); } };
  const adapter = new AnthropicAgentAdapter(client as never, "claude-test");
  const step = await adapter.start({ ...START, tools });
  await adapter.continueWith({ continuation: step.continuation, results: [{ callId: "toolu_1", outputText: "{}", isError: false }], tools });
  return callsOf(create);
}

describe("[B20 A5] the agent adapters render function tools only, with closed request key sets (OD-90)", () => {
  it("OpenAI start and continueWith: the eleven request keys, a FLAT function tool per declaration, options { signal }, and no connector vocabulary", async () => {
    expect(DECLARATIONS.length).toBeGreaterThan(5);
    for (const [params, options] of await openAiCalls(DECLARATIONS)) {
      expect(Object.keys(params)).toEqual(OPENAI_PARAM_KEYS);
      const tools = params.tools as Array<Record<string, unknown>>;
      expect(tools).toHaveLength(DECLARATIONS.length);
      for (const tool of tools) {
        expect(Object.keys(tool).sort(), String(tool.name)).toEqual(["description", "name", "parameters", "strict", "type"]);
        expect(tool.type, String(tool.name)).toBe("function");
        expect(tool.strict, String(tool.name)).toBe(true);
      }
      expect(Object.keys(options)).toEqual(["signal"]);
      expectNoConnectorVocabulary(JSON.stringify(params), "the OpenAI request");
      expectNoConnectorVocabulary(Object.keys(params).join(" "), "the OpenAI request keys");
    }
  });

  it("Anthropic start and continueWith: the six request keys, {name, description, input_schema, strict} per tool, options { signal }, the SDK beta surface never touched", async () => {
    for (const [params, options] of await anthropicCalls(DECLARATIONS)) {
      expect(Object.keys(params)).toEqual(ANTHROPIC_PARAM_KEYS);
      const tools = params.tools as Array<Record<string, unknown>>;
      expect(tools).toHaveLength(DECLARATIONS.length);
      for (const tool of tools) {
        expect(Object.keys(tool).sort(), String(tool.name)).toEqual(["description", "input_schema", "name", "strict"]);
        expect(tool.strict, String(tool.name)).toBe(true);
      }
      expect(Object.keys(options)).toEqual(["signal"]);
      expectNoConnectorVocabulary(JSON.stringify(params), "the Anthropic request");
      expectNoConnectorVocabulary(Object.keys(params).join(" "), "the Anthropic request keys");
    }
  });

  it("with no declaration at all, `tools` and `tool_choice` are undefined in both adapters and neither key set changes", async () => {
    for (const [params] of await openAiCalls([])) {
      expect(Object.keys(params)).toEqual(OPENAI_PARAM_KEYS);
      expect(params.tools).toBeUndefined();
      expect(params.tool_choice).toBeUndefined();
      expect(params.parallel_tool_calls).toBeUndefined();
    }
    for (const [params] of await anthropicCalls([])) {
      expect(Object.keys(params)).toEqual(ANTHROPIC_PARAM_KEYS);
      expect(params.tools).toBeUndefined();
      expect(params.tool_choice).toBeUndefined();
    }
  });

  it("every string in either adapter's request comes from the declared tools or the conversation — no environment value, no credential (OD-45, S2)", async () => {
    vi.stubEnv("FIXTURE_MCP_ACCESS_TOKEN", TOKEN);
    vi.stubEnv("SIRKIT_MCP_ENABLED", "1");
    // [B20 A5 review] the absence checks below could not fail: TOKEN is assembled in this file and never handed to an
    // adapter, and both adapters are built with an injected fake client, so `getClient()` never runs and no `process.env`
    // read happens on this path. The case is made falsifiable by asserting PROVENANCE instead: every string in the
    // serialised request — object keys and values alike — must come from the declarations, the conversation or the fixed
    // shape vocabulary the adapters write themselves. Splicing any environment value into any field fails here.
    const allowed = stringsOf({
      declarations: DECLARATIONS,
      models: ["gpt-test", "claude-test"],
      conversation: [START.system, START.userMessage, "{}", "call_1", "toolu_1"],
      // the provider's own prior output, which a continuation appends verbatim (that is the whole continuation contract)
      priorOutput: [OPENAI_FAKE_OUTPUT, ANTHROPIC_FAKE_CONTENT],
    });
    for (const word of SHAPE_VOCABULARY) allowed.add(word);

    for (const calls of [await openAiCalls(DECLARATIONS), await anthropicCalls(DECLARATIONS)]) {
      for (const [params, options] of calls) {
        for (const text of stringsOf(params)) expect(allowed.has(text), `an unaccounted-for string in the request: ${text.slice(0, 60)}`).toBe(true);
        for (const text of [JSON.stringify(params), JSON.stringify(options ?? {}), Object.keys(params).join(" ")]) {
          expect(text).not.toContain(TOKEN);
          expect(text).not.toContain("FIXTURE_MCP_ACCESS_TOKEN");
        }
      }
    }
  });
});
