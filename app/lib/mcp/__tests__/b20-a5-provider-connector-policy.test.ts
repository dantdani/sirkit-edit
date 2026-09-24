/**
 * [B20 A5] The provider-native connector policy as a CLOSED STATEMENT (OD-90, OD-45): Sirkit renders no provider-native MCP
 * connector, for any server, row, role, provider or flag state. `providerConnectorVerdict` states that refusal in closed
 * codes for every input; it has no production caller and enforces nothing — what enforces "nothing is rendered" are the
 * request-shape pins, the lexical tripwire, the importer and closure gates and the constructor pins.
 *
 * No network: nothing here reaches a transport. Fixture credentials are assembled at run time and are obvious fakes (S8).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PROVIDER_CONNECTOR_POLICY_VERSION,
  PROVIDER_CONNECTOR_REFUSALS,
  PROVIDER_CONNECTOR_REFUSAL_CLASSES,
  PROVIDER_CONNECTOR_SENTENCES,
  providerConnectorVerdict,
  type ProviderConnectorRefusal,
  type ProviderConnectorVerdict,
} from "../provider-connector-policy";
import { frozenMcpServerEntries, validateMcpServerRegistry, type McpServerRegistryEntry } from "../server-registry";
import { mcpAgentToolAllowlist } from "../agent-port";
import { fixtureServer, type WritableServer } from "./_fixtures";
import { canonicalJson } from "../../atomic/stable";

/** obvious fakes, assembled at run time so no file carries a key-shaped literal (S8) */
const TOKEN = ["fxA5", "7c2e", "91bd", "44f0"].join("-");
const SENTINEL = ["A5", "SENTINEL", "q7"].join("_");

vi.stubGlobal("fetch", () => { throw new Error("no network"); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.stubGlobal("fetch", () => { throw new Error("no network"); }); });

const PIN = `sha256:${"ab".repeat(32)}`;
const ON = { SIRKIT_MCP_ENABLED: "1" } as const;
/**
 * The best possible row: approved, pinned, disclosure permitted, no credential, and an operator-approved per-tool
 * allowlist — and still refused. [B20 A5 review] `agentTools` was left at the fixture default `[]`, which A4L drops from
 * the agent roster outright (`mcpAgentToolAllowlist(row).size === 0` is no roster row), so the case that calls this the
 * best possible row was asserting against a row Sirkit's own agent path refuses.
 */
const BEST = frozenMcpServerEntries([fixtureServer({
  descriptorPin: { toolsListDigest: PIN, pinnedAt: "2026-09-21" },
  agentDisclosure: "permitted",
  agentTools: ["read", "search"],
  supportedProtocolVersions: ["2026-07-28", "2025-11-25"],
  compatibilityEra: true,
})]);

/** a revision of ONE row: a JSON copy of BEST's row with `change` applied (never `mutated()`, whose base is unpinned) */
function bestCopy(change: (entry: WritableServer) => void): readonly McpServerRegistryEntry[] {
  const copy = JSON.parse(JSON.stringify(BEST[0])) as WritableServer;
  change(copy);
  return frozenMcpServerEntries([copy as unknown as McpServerRegistryEntry]);
}

/** the decision, mechanism and provider codes every verdict for a KNOWN provider carries, in vocabulary order */
const DECISION8: readonly ProviderConnectorRefusal[] = [
  "connectors_refused",
  "provider_reads_server_directly",
  "results_bypass_observation",
  "egress_bypasses_sirkit",
  "calls_not_traced",
  "handshake_era_only",
  "no_human_approval",
  "live_behaviour_unqualified",
];
/** the same for a provider Sirkit's agent adapters do not serve: `provider_unrecognised` in place of `no_human_approval` */
const UNRECOGNISED8: readonly ProviderConnectorRefusal[] = [
  "connectors_refused",
  "provider_unrecognised",
  "provider_reads_server_directly",
  "results_bypass_observation",
  "egress_bypasses_sirkit",
  "calls_not_traced",
  "handshake_era_only",
  "live_behaviour_unqualified",
];
const withRow = (...codes: ProviderConnectorRefusal[]): ProviderConnectorRefusal[] => [...DECISION8, ...codes];

/** the sentences, written out here so the test never reads its expectation from the module under test */
const SENTENCES: Readonly<Record<ProviderConnectorRefusal, string>> = {
  connectors_refused: "Provider-native MCP connectors are not offered in B20 (OD-90): an external MCP server reaches a model only through Sirkit's own client.",
  provider_unrecognised: "The provider is not one Sirkit's agent adapters serve.",
  provider_reads_server_directly: "The provider would list and call the server itself, so Sirkit's descriptor gates and pin would judge a read the model never sees.",
  results_bypass_observation: "Results would reach the model inside the provider's turn, without Sirkit's observation record, withholding, disclosure projection, quarantine or budget.",
  egress_bypasses_sirkit: "Requests would leave from the provider, outside Sirkit's admission, quotas, breaker, endpoint and address checks and argument screen.",
  calls_not_traced: "Sirkit's run trace could not attribute the calls to a server, tool or version.",
  handshake_era_only: "Both connectors speak the previous protocol era (2025-11-25 and earlier); Sirkit's authority path is revision 2026-07-28 (OD-41).",
  no_human_approval: "No human can approve a provider-run call: Sirkit has no approval surface for it and never approves one itself.",
  live_behaviour_unqualified: "The connectors' live behaviour is unqualified (no provider credits; BLOCKED-LIVE-QUALIFICATION).",
  server_not_admitted: "The server is not an admitted registry row: unknown, invalid, blocked or disabled, MCP is off, or the operator switched it off.",
  credential_required: "The server needs a credential, and no credential is ever given to a model provider (OD-45).",
  descriptors_unpinned: "The server's tool descriptors are not pinned by a reviewed digest.",
  disclosure_not_permitted: "The server's results may not be disclosed to a model provider (agentDisclosure is not permitted).",
  no_agent_tools: "The server's row approves no tool for an agent at all, so there is nothing a connector could be allowed to call: an approval names the tools, never the server alone.",
};
const CLASSES: Readonly<Record<ProviderConnectorRefusal, string>> = {
  connectors_refused: "decision",
  provider_unrecognised: "input",
  provider_reads_server_directly: "mechanism",
  results_bypass_observation: "mechanism",
  egress_bypasses_sirkit: "mechanism",
  calls_not_traced: "mechanism",
  handshake_era_only: "mechanism",
  no_human_approval: "provider",
  live_behaviour_unqualified: "mechanism",
  server_not_admitted: "row",
  credential_required: "row",
  descriptors_unpinned: "row",
  disclosure_not_permitted: "row",
  no_agent_tools: "row",
};
/** the connector wire vocabulary (D6), so no fixed sentence of the policy can carry one */
const D6_TOKENS = [
  "mcp_servers", "mcp_toolset", "mcp_server_name", "mcp_tool_listing", "authorization_token", "server_url", "server_label",
  "server_description", "connector_id", "tunnel_id", "require_approval", "allowed_tools", "defer_loading", "default_config",
  "mcp_approval", "mcp_list_tools", "mcp_call", "mcp_tool_use", "mcp_tool_result",
];

/** every row variant of P3, each with the codes its own fact adds and the id the verdict may echo */
const VARIANTS: Array<{ label: string; entries: readonly McpServerRegistryEntry[]; env: Record<string, string>; adds: ProviderConnectorRefusal[]; echoes: string | null; violations: string[] }> = [
  { label: "the flag is absent", entries: BEST, env: {}, adds: ["server_not_admitted"], echoes: "docs-example", violations: [] },
  { label: "the flag is a padded 1", entries: BEST, env: { SIRKIT_MCP_ENABLED: " 1" }, adds: ["server_not_admitted"], echoes: "docs-example", violations: [] },
  { label: "the operator switched the id off", entries: BEST, env: { ...ON, SIRKIT_MCP_DISABLED_SERVERS: "docs-example" }, adds: ["server_not_admitted"], echoes: "docs-example", violations: [] },
  { label: "a disabled row", entries: bestCopy((entry) => { entry.state.status = "disabled"; entry.agentDisclosure = "unknown"; }), env: { ...ON }, adds: ["server_not_admitted", "disclosure_not_permitted"], echoes: "docs-example", violations: [] },
  { label: "a blocked row", entries: bestCopy((entry) => { entry.state.status = "blocked"; entry.agentDisclosure = "unknown"; }), env: { ...ON }, adds: ["server_not_admitted", "disclosure_not_permitted"], echoes: "docs-example", violations: [] },
  {
    label: "a pre-issued access token",
    entries: bestCopy((entry) => { entry.auth = { mode: "pre-issued-token-env", secrets: [{ env: "FIXTURE_MCP_ACCESS_TOKEN", role: "access-token" }], scopes: [] }; }),
    env: { ...ON }, adds: ["credential_required"], echoes: "docs-example", violations: [],
  },
  {
    label: "client credentials with A3's pinned authorization server",
    entries: bestCopy((entry) => {
      entry.auth = {
        mode: "client-credentials-env",
        secrets: [{ env: "FIXTURE_MCP_CLIENT_ID", role: "client-id" }, { env: "FIXTURE_MCP_CLIENT_SECRET", role: "client-secret" }],
        scopes: ["docs.read"],
        authorizationServer: { issuer: "https://auth.example.com", tokenEndpoint: "https://auth.example.com/oauth/token" },
      };
    }),
    env: { ...ON }, adds: ["credential_required"], echoes: "docs-example", violations: [],
  },
  { label: "nothing pinned", entries: bestCopy((entry) => { entry.descriptorPin = { toolsListDigest: null, pinnedAt: null }; }), env: { ...ON }, adds: ["descriptors_unpinned"], echoes: "docs-example", violations: [] },
  { label: "disclosure unknown", entries: bestCopy((entry) => { entry.agentDisclosure = "unknown"; }), env: { ...ON }, adds: ["disclosure_not_permitted"], echoes: "docs-example", violations: [] },
  { label: "disclosure prohibited", entries: bestCopy((entry) => { entry.agentDisclosure = "prohibited"; }), env: { ...ON }, adds: ["disclosure_not_permitted"], echoes: "docs-example", violations: [] },
  // [B20 A5 review] A4L's per-tool allowlist is a row-level obstacle of its own: an empty one is a row Sirkit's own
  // agent roster drops, so the closed vocabulary has to be able to say so
  { label: "the row approves no agent tool", entries: bestCopy((entry) => { entry.agentTools = []; }), env: { ...ON }, adds: ["no_agent_tools"], echoes: "docs-example", violations: [] },
  { label: "the row's only agent tool name is not a tool name", entries: bestCopy((entry) => { entry.agentTools = [" "]; }), env: { ...ON }, adds: ["server_not_admitted", "no_agent_tools"], echoes: null, violations: ["agent-tools"] },
  // an INVALID row: a violation naming the id refuses the row and keeps its id out of the verdict
  { label: "a row that admits a redirect", entries: bestCopy((entry) => { entry.maxRedirects = 1; }), env: { ...ON }, adds: ["server_not_admitted"], echoes: null, violations: ["redirects"] },
];

describe("[B20 A5] providerConnectorVerdict — the closed refusal (OD-90)", () => {
  it("the committed registry holds no server, so every connector question about one answers the decision codes and server_not_admitted", () => {
    const verdict = providerConnectorVerdict("docs-example", "openai", ON);
    expect(verdict.reasons).toEqual(withRow("server_not_admitted"));
    expect(verdict.serverId).toBeNull();
    expect(verdict.provider).toBe("openai");
    expect(verdict.verdict).toBe("refused");
    expect(verdict.decision).toBe("OD-90");
    expect(verdict.schema).toBe("sirkit.provider-connector-verdict.v1");
    expect(verdict.policyVersion).toBe(PROVIDER_CONNECTOR_POLICY_VERSION);
    expect(PROVIDER_CONNECTOR_POLICY_VERSION).toBe("1.0.0");
  });

  it("the BEST possible row — approved, admitted, pinned, disclosure permitted, no credential, tools approved for an agent — is still refused, for both providers", () => {
    expect(validateMcpServerRegistry(BEST)).toEqual([]);
    for (const provider of ["openai", "anthropic"] as const) {
      const verdict = providerConnectorVerdict("docs-example", provider, ON, BEST);
      expect(verdict.reasons, provider).toEqual(DECISION8);
      expect(verdict.serverId, provider).toBe("docs-example");
      expect(verdict.provider, provider).toBe(provider);
      expect(verdict.verdict, provider).toBe("refused");
    }
  });

  it("each row fact adds exactly its own code, whatever the admission says, and each variant validates to exactly the violations it is built to raise", () => {
    for (const variant of VARIANTS) {
      const violations = validateMcpServerRegistry(variant.entries);
      expect(violations.map((violation) => violation.rule), variant.label).toEqual(variant.violations);
      const verdict = providerConnectorVerdict("docs-example", "openai", variant.env, variant.entries);
      expect(verdict.reasons, variant.label).toEqual(withRow(...variant.adds));
      expect(verdict.serverId, variant.label).toBe(variant.echoes);
    }
  });

  it("a provider Sirkit's agent adapters do not serve is provider_unrecognised, never no_human_approval, and is never echoed", () => {
    const long = `${SENTINEL}${"z".repeat(100_000 - SENTINEL.length)}`;
    const inputs: unknown[] = ["OpenAI", "openai ", "gemini", "", null, undefined, 1, {}, ["openai"], long];
    const echoed = ["OpenAI", "openai ", "gemini", long];
    for (const provider of inputs) {
      const verdict = providerConnectorVerdict("docs-example", provider, ON, BEST);
      const label = typeof provider === "string" ? provider.slice(0, 20) : String(provider);
      expect(verdict.reasons, label).toEqual(UNRECOGNISED8);
      expect(verdict.provider, label).toBeNull();
      expect(verdict.reasons, label).not.toContain("no_human_approval");
      if (echoed.includes(provider as string)) {
        expect(JSON.stringify(verdict), label).not.toContain(provider as string);
        expect(JSON.stringify(verdict), label).not.toContain(SENTINEL);
      }
    }
  });

  it("a server id that is not an echoable found row answers server_not_admitted with no id: a non-string, a length past the pattern, a prototype name, and a found row with a secret-shaped id", () => {
    const inputs: unknown[] = [42, null, undefined, { toString(): string { throw new Error(SENTINEL); } }, "", "Docs-Example", "docs-example ", "constructor", "prototype", "__proto__", "toString", "a".repeat(32), "x".repeat(1_000_000), `sk-${"q".repeat(40)}`];
    for (const [index, serverId] of inputs.entries()) {
      // the label never renders the input: one of them throws from its own `toString`
      const label = typeof serverId === "string" ? `${serverId.slice(0, 20)} (${serverId.length})` : `input ${index} (${typeof serverId})`;
      const verdict = providerConnectorVerdict(serverId, "openai", ON, BEST);
      expect(verdict.reasons, label).toEqual(withRow("server_not_admitted"));
      expect(verdict.serverId, label).toBeNull();
      if (typeof serverId === "string" && serverId.length >= 4) {
        expect(JSON.stringify(verdict), label).not.toContain(serverId);
      }
    }
    // a FOUND row whose pattern-valid id is shaped like a secret: the validator names it, so the verdict never echoes it
    const secretShaped = `sk-${["abcdefgh", "1234"].join("")}`;
    const entries = bestCopy((entry) => { entry.id = secretShaped; });
    expect(validateMcpServerRegistry(entries).map((violation) => violation.rule)).toEqual(["secret-shaped"]);
    const verdict = providerConnectorVerdict(secretShaped, "openai", ON, entries);
    expect(verdict.reasons).toEqual(withRow("server_not_admitted"));
    expect(verdict.serverId).toBeNull();
    expect(JSON.stringify(verdict)).not.toContain(secretShaped);
  });

  it("it never throws: a hostile environment, hostile entries and a row whose own field throws all answer the fallback", () => {
    const trap = (): never => { throw new Error(SENTINEL); };
    const hostileEnvironment = new Proxy({}, new Proxy({}, { get: () => trap }));
    const throwingFlag = Object.defineProperty({}, "SIRKIT_MCP_ENABLED", { get: trap, enumerable: true });
    const hostileEntries = new Proxy([], new Proxy({}, { get: () => trap }));
    const throwingRow = [Object.defineProperty({ ...(JSON.parse(JSON.stringify(BEST[0])) as Record<string, unknown>) }, "auth", { get: trap, enumerable: true })];
    const cases: Array<[string, unknown, unknown]> = [
      ["a hostile environment proxy", hostileEnvironment, BEST],
      ["a throwing flag getter", throwingFlag, BEST],
      ["entries null", ON, null],
      ["entries 5", ON, 5],
      ["entries a string", ON, "x"],
      ["entries a hostile proxy", ON, hostileEntries],
      ["a row whose auth getter throws", ON, throwingRow],
    ];
    for (const [label, environment, entries] of cases) {
      const verdict = providerConnectorVerdict("docs-example", "openai", environment as Record<string, string>, entries as readonly McpServerRegistryEntry[]);
      expect(verdict.reasons, label).toEqual(withRow("server_not_admitted"));
      expect(verdict.serverId, label).toBeNull();
      expect(verdict.provider, label).toBe("openai");
      expect(JSON.stringify(verdict), label).not.toContain(SENTINEL);
    }
  });

  it("a verdict is frozen at every level and byte-deterministic: two calls, equal-valued environments, an equal row and a reversed revision all render the same bytes", () => {
    const verdict = providerConnectorVerdict("docs-example", "openai", ON, BEST);
    expect(Object.isFrozen(verdict)).toBe(true);
    expect(Object.isFrozen(verdict.reasons)).toBe(true);
    expect(new Set(verdict.reasons).size).toBe(verdict.reasons.length);
    const order = verdict.reasons.map((code) => PROVIDER_CONNECTOR_REFUSALS.indexOf(code));
    expect(order).toEqual([...order].sort((a, b) => a - b));

    const bytes = canonicalJson(verdict);
    expect(canonicalJson(providerConnectorVerdict("docs-example", "openai", ON, BEST))).toBe(bytes);
    expect(canonicalJson(providerConnectorVerdict("docs-example", "openai", { SIRKIT_MCP_ENABLED: ["1"].join("") }, BEST))).toBe(bytes);
    const equalRow = frozenMcpServerEntries([JSON.parse(JSON.stringify(BEST[0])) as McpServerRegistryEntry]);
    expect(canonicalJson(providerConnectorVerdict("docs-example", "openai", ON, equalRow))).toBe(bytes);
    const second = fixtureServer({ id: "other-docs", descriptorPin: { toolsListDigest: PIN, pinnedAt: "2026-09-21" }, agentDisclosure: "permitted" });
    const two = frozenMcpServerEntries([BEST[0]!, second]);
    const reversed = frozenMcpServerEntries([second, BEST[0]!]);
    expect(validateMcpServerRegistry(two)).toEqual([]);
    expect(canonicalJson(providerConnectorVerdict("docs-example", "openai", ON, two))).toBe(bytes);
    expect(canonicalJson(providerConnectorVerdict("docs-example", "openai", ON, reversed))).toBe(bytes);
  });

  it("the vocabulary is closed, its classes and sentences are exactly these, and a verdict can only ever refuse", () => {
    expect(Object.isFrozen(PROVIDER_CONNECTOR_REFUSALS)).toBe(true);
    expect([...PROVIDER_CONNECTOR_REFUSALS]).toEqual(Object.keys(SENTENCES));
    expect(PROVIDER_CONNECTOR_REFUSALS).toHaveLength(14);
    for (const code of PROVIDER_CONNECTOR_REFUSALS) expect(code, code).toMatch(/^[a-z][a-z_]{2,40}$/);
    expect(Object.keys(PROVIDER_CONNECTOR_SENTENCES).sort()).toEqual([...PROVIDER_CONNECTOR_REFUSALS].sort());
    expect(Object.keys(PROVIDER_CONNECTOR_REFUSAL_CLASSES).sort()).toEqual([...PROVIDER_CONNECTOR_REFUSALS].sort());
    for (const code of PROVIDER_CONNECTOR_REFUSALS) {
      const sentence = PROVIDER_CONNECTOR_SENTENCES[code];
      expect(sentence, code).toBe(SENTENCES[code]);
      expect(PROVIDER_CONNECTOR_REFUSAL_CLASSES[code], code).toBe(CLASSES[code]);
      expect(sentence.length, code).toBeLessThanOrEqual(240);
      expect(sentence, code).not.toContain("${");
      expect(sentence, code).not.toContain(SENTINEL);
      expect(sentence, code).not.toContain(TOKEN);
      for (const token of D6_TOKENS) expect(sentence, `${code} carries ${token}`).not.toContain(token);
    }
    for (const variant of [{ label: "best", entries: BEST, env: { ...ON } }, ...VARIANTS]) {
      for (const provider of ["openai", "anthropic", "x"]) {
        expect(providerConnectorVerdict("docs-example", provider, variant.env, variant.entries).verdict, `${variant.label} ${provider}`).toBe("refused");
      }
    }
    const verdict = providerConnectorVerdict("docs-example", "openai", ON, BEST);
    // @ts-expect-error a verdict can only ever be "refused" — the type admits no other value
    const allowed: ProviderConnectorVerdict = { ...verdict, verdict: "allowed" };
    expect(allowed.verdict).toBe("allowed");
  });

  it("no credential, environment name or row text ever reaches a verdict: the keys are exactly the seven of the schema", () => {
    const entries = bestCopy((entry) => { entry.auth = { mode: "pre-issued-token-env", secrets: [{ env: "FIXTURE_MCP_ACCESS_TOKEN", role: "access-token" }], scopes: [] }; });
    const verdict = providerConnectorVerdict("docs-example", "openai", { ...ON, FIXTURE_MCP_ACCESS_TOKEN: TOKEN }, entries);
    expect(verdict.reasons).toEqual(withRow("credential_required"));
    const json = JSON.stringify(verdict);
    const row = entries[0]!;
    for (const secret of [TOKEN, TOKEN.toUpperCase(), Buffer.from(TOKEN).toString("base64"), "FIXTURE_MCP_ACCESS_TOKEN", row.title, row.canonicalUri, row.terms.documentationUrl!, row.state.reason]) {
      expect(json, secret).not.toContain(secret);
    }
    expect(Object.keys(verdict).sort()).toEqual(["decision", "policyVersion", "provider", "reasons", "schema", "serverId", "verdict"]);
  });

  // [B20 A5 lead] the review's residual: the policy judges A4L's `agentTools` with a private copy of the rule (so the module
  // keeps its single runtime import), and nothing pinned that the copy agrees with the port's own `mcpAgentToolAllowlist`.
  // A row either approves a tool for Sirkit's agent or it does not; `no_agent_tools` must mirror that, row for row.
  it("the policy's own reading of agentTools agrees with mcpAgentToolAllowlist for every shape the registry can hold", () => {
    const shapes: ReadonlyArray<readonly [string, unknown]> = [
      ["one valid name", ["search"]],
      ["several valid names", ["search", "lookup", "titled"]],
      ["empty", []],
      ["absent", undefined],
      ["a string", "search"],
      ["an array-like object", { 0: "search", length: 1 }],
      ["33 names", Array.from({ length: 33 }, (_unused, index) => `t${String(index).padStart(2, "0")}`)],
      ["32 names", Array.from({ length: 32 }, (_unused, index) => `t${String(index).padStart(2, "0")}`)],
      ["a name outside the pattern", ["not a tool name"]],
      ["an over-long name", ["a".repeat(129)]],
      ["a duplicate", ["search", "search"]],
      ["unsorted", ["lookup", "search"]],
      ["a non-string entry", [7]],
      ["one valid name beside an invalid one", ["search", "not a tool name"]],
    ];
    const disagreements: string[] = [];
    for (const [label, agentTools] of shapes) {
      // the suite's own best row, admitted and flag-on, so the verdict reaches the row facts at all
      const entries = bestCopy((entry) => {
        const row = entry as unknown as Record<string, unknown>;
        if (agentTools === undefined) delete row.agentTools; else row.agentTools = agentTools;
      });
      const portAllows = mcpAgentToolAllowlist(entries[0]!).size > 0;
      const verdict = providerConnectorVerdict("docs-example", "anthropic", { ...ON }, entries);
      const policySaysNone = verdict.reasons.includes("no_agent_tools");
      if (portAllows === policySaysNone) disagreements.push(`${label}: the port allows ${String(portAllows)}, the policy says no_agent_tools ${String(policySaysNone)}`);
    }
    expect(disagreements).toEqual([]);
  });
});
