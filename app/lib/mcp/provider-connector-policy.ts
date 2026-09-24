/**
 * [B20 A5] The provider-native MCP connector policy, as a closed STATEMENT (OD-90, OD-45).
 *
 * Sirkit renders NO provider-native MCP connector — no Anthropic MCP connector and no OpenAI Responses MCP tool — for any
 * server, row, role, provider or flag state, and no credential Sirkit holds for an MCP server ever reaches a provider
 * request. An external MCP server reaches a model only through Sirkit's own client and A4's Sirkit-mediated observation
 * read.
 *
 * This module ENFORCES NOTHING and has no production caller. What enforces the decision is structural: the agent adapters'
 * closed request shapes pinned at run time, the connector wire vocabulary absent from every production file, exactly five
 * modules importing a provider SDK and none of them reaching `app/lib/mcp/**` or the MCP bearer module at run time, and
 * every provider client constructed with only `apiKey`, `maxRetries` and `timeout`. What this module does is STATE the
 * refusal in closed codes for every input, so the reasons can be written down, reviewed and tested as one vocabulary.
 *
 * It is pure and browser-safe: no clock, no randomness, no network, no message field, and it never throws. It never echoes
 * an input — the only input it can repeat is the id of a registry row that was found AND validates with no violation
 * naming it (S1, S2).
 */
import { MCP_AGENT_TOOLS_MAX, MCP_SERVER_REGISTRY, MCP_TOOL_NAME_PATTERN, admittedMcpServer, mcpServerEntry, validateMcpServerRegistry, type McpServerRegistryEntry } from "./server-registry";

export const PROVIDER_CONNECTOR_POLICY_VERSION = "1.0.0";

/**
 * Every reason a connector is refused, in vocabulary order. Closed: a verdict's reasons are a subset of these, unique and
 * in this order. There is no code that admits anything.
 */
export const PROVIDER_CONNECTOR_REFUSALS = Object.freeze([
  "connectors_refused",
  "provider_unrecognised",
  "provider_reads_server_directly",
  "results_bypass_observation",
  "egress_bypasses_sirkit",
  "calls_not_traced",
  "handshake_era_only",
  "no_human_approval",
  "live_behaviour_unqualified",
  "server_not_admitted",
  "credential_required",
  "descriptors_unpinned",
  "disclosure_not_permitted",
  "no_agent_tools",
] as const);
export type ProviderConnectorRefusal = (typeof PROVIDER_CONNECTOR_REFUSALS)[number];

/** What each code is about: the decision itself, the caller's input, the mechanism, the provider, or the registry row. */
export const PROVIDER_CONNECTOR_REFUSAL_CLASSES: Readonly<Record<ProviderConnectorRefusal, "decision" | "input" | "mechanism" | "provider" | "row">> = Object.freeze({
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
});

/** One FIXED sentence per code. No interpolation, no input, no credential, no connector vocabulary. */
export const PROVIDER_CONNECTOR_SENTENCES: Readonly<Record<ProviderConnectorRefusal, string>> = Object.freeze({
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
});

export interface ProviderConnectorVerdict {
  readonly schema: "sirkit.provider-connector-verdict.v1";
  readonly policyVersion: "1.0.0";
  readonly verdict: "refused";
  readonly decision: "OD-90";
  readonly provider: "openai" | "anthropic" | null;
  /** only the id of a FOUND row that validates with no violation naming it; null otherwise */
  readonly serverId: string | null;
  readonly reasons: readonly ProviderConnectorRefusal[];
}

/** The mechanism codes every verdict carries: the decision holds whatever the provider, the row or the flag says. */
const MECHANISM: readonly ProviderConnectorRefusal[] = Object.freeze([
  "provider_reads_server_directly",
  "results_bypass_observation",
  "egress_bypasses_sirkit",
  "calls_not_traced",
  "handshake_era_only",
  "live_behaviour_unqualified",
]);

/** The longest id `MCP_SERVER_ID_PATTERN` admits. Judged before any pattern runs, so no unbounded string reaches one (S5). */
const SERVER_ID_MAX_CHARS = 31;

/** The longest name `MCP_TOOL_NAME_PATTERN` admits. Judged before the pattern, so no unbounded string reaches one (S5). */
const MCP_TOOL_NAME_MAX_CHARS = 128;

function verdictOf(provider: "openai" | "anthropic" | null, serverId: string | null, reasons: Iterable<ProviderConnectorRefusal>): ProviderConnectorVerdict {
  const unique = new Set(reasons);
  const ordered = PROVIDER_CONNECTOR_REFUSALS.filter((code) => unique.has(code));
  return Object.freeze({
    schema: "sirkit.provider-connector-verdict.v1",
    policyVersion: PROVIDER_CONNECTOR_POLICY_VERSION,
    verdict: "refused",
    decision: "OD-90",
    provider,
    serverId,
    reasons: Object.freeze(ordered),
  } as const);
}

/**
 * Why a provider-native connector is refused for this server and provider. Always `"refused"`. The row half is judged
 * whatever the admission says, so the answer names every reason at once rather than the first one found; the id is echoed
 * only when the row is found AND no validation violation names it (a pattern-valid id can still be shaped like a secret).
 * Anything thrown by a hostile environment, revision or row answers the decision, the mechanism, the provider code and
 * `server_not_admitted`, with no id.
 */
export function providerConnectorVerdict(
  serverId: unknown,
  provider: unknown,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  entries: readonly McpServerRegistryEntry[] = MCP_SERVER_REGISTRY,
): ProviderConnectorVerdict {
  let known: "openai" | "anthropic" | null = null;
  let providerCode: ProviderConnectorRefusal = "provider_unrecognised";
  try {
    // strict equality only: this step cannot throw, so the fallback below always carries a provider code
    if (provider === "openai" || provider === "anthropic") {
      known = provider;
      providerCode = "no_human_approval";
    }
    const reasons: ProviderConnectorRefusal[] = ["connectors_refused", providerCode, ...MECHANISM];
    const entry = typeof serverId === "string" && serverId.length <= SERVER_ID_MAX_CHARS ? mcpServerEntry(serverId, entries) : null;
    if (entry === null) return verdictOf(known, null, [...reasons, "server_not_admitted"]);
    const named = validateMcpServerRegistry(entries).some((violation) => violation.id === entry.id);
    if (named || admittedMcpServer(entry.id, environment, entries).admitted === false) reasons.push("server_not_admitted");
    if (entry.auth.mode !== "none" || entry.auth.secrets.length > 0) reasons.push("credential_required");
    if (typeof entry.descriptorPin?.toolsListDigest !== "string") reasons.push("descriptors_unpinned");
    if (entry.agentDisclosure !== "permitted") reasons.push("disclosure_not_permitted");
    // [B20 A5 review] A4L's per-tool allowlist, judged the way `mcpAgentToolAllowlist` judges it and inline, so this
    // module keeps its single runtime import: a row that names no usable tool is a row Sirkit's own agent roster drops
    // (`[]` means no tool of this row is agent-callable), and a connector for it could be allowed to call nothing.
    const approved: unknown = entry.agentTools;
    const approvesATool = Array.isArray(approved) && approved.length <= MCP_AGENT_TOOLS_MAX
      && approved.some((name) => typeof name === "string" && name.length <= MCP_TOOL_NAME_MAX_CHARS && MCP_TOOL_NAME_PATTERN.test(name));
    if (!approvesATool) reasons.push("no_agent_tools");
    return verdictOf(known, named ? null : entry.id, reasons);
  } catch {
    return verdictOf(known, null, ["connectors_refused", providerCode, ...MECHANISM, "server_not_admitted"]);
  }
}
