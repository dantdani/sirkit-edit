/**
 * [B20 A0] The MCP server registry: empty by decision (OD-48), deep-frozen and without any add/remove API, validated by
 * every rule a reviewed row must satisfy, admitting only an approved row and never without the feature flag, and rendered
 * to a committed artifact gated byte-for-byte.
 *
 * Regenerate the artifact after a reviewed registry change: npx tsx scripts/generate-b20-mcp-server-registry.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MCP_DISABLED_SERVERS_ENV, MCP_ENABLED_ENV } from "../rollout";
import {
  admittedMcpServer,
  frozenMcpServerEntries,
  MCP_PROTOCOL_VERSION_COMPATIBILITY,
  MCP_PROTOCOL_VERSION_CURRENT,
  MCP_SERVER_ID_PATTERN,
  MCP_SERVER_IDS,
  MCP_SERVER_LIMIT_BOUNDS,
  MCP_SERVER_REGISTRY,
  MCP_SERVER_REGISTRY_CSV_COLUMNS,
  MCP_SERVER_REGISTRY_VERSION,
  MCP_TOOL_NAME_PATTERN,
  mcpEndpointOfCanonicalUri,
  mcpServerEntry,
  renderMcpServerRegistryCsv,
  validateMcpServerRegistry,
  type McpServerRegistryEntry,
} from "../server-registry";
import { fixtureServer, mutated } from "./_fixtures";

const ARTIFACT = "artifacts/ai-control-plane-b20/mcp-server-registry.csv";
const ON = { SIRKIT_MCP_ENABLED: "1" };
const NEWLINE = String.fromCharCode(10);

const rulesOf = (entries: readonly McpServerRegistryEntry[]): string[] => validateMcpServerRegistry(entries).map((violation) => violation.rule);
const messagesOf = (entries: readonly McpServerRegistryEntry[]): string => validateMcpServerRegistry(entries).map((violation) => violation.message).join(NEWLINE);

/** The cells of one RFC 4180 line: a quoted cell may carry commas, doubled quotes and line breaks. */
function csvCells(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { cells.push(cell); cell = ""; }
    else cell += char;
  }
  cells.push(cell);
  return cells;
}

describe("[B20 A0] the committed registry", () => {
  it("is versioned 1.0.0, validates, and is EMPTY: every server is refused until a reviewed row with an owner decision id is added (OD-48)", () => {
    expect(MCP_SERVER_REGISTRY_VERSION).toBe("1.0.0");
    expect(validateMcpServerRegistry()).toEqual([]);
    expect([...MCP_SERVER_REGISTRY]).toEqual([]);
    expect([...MCP_SERVER_IDS]).toEqual([]);
    expect(mcpServerEntry("docs-example")).toBeNull();
  });

  it("names the protocol revisions it validates against: 2026-07-28 current, 2025-11-25 compatibility only", () => {
    expect(MCP_PROTOCOL_VERSION_CURRENT).toBe("2026-07-28");
    expect(MCP_PROTOCOL_VERSION_COMPATIBILITY).toBe("2025-11-25");
  });

  it("is deep-frozen at module load and cannot be grown at runtime", () => {
    expect(Object.isFrozen(MCP_SERVER_REGISTRY)).toBe(true);
    expect(Object.isFrozen(MCP_SERVER_IDS)).toBe(true);
    expect(() => (MCP_SERVER_REGISTRY as unknown as McpServerRegistryEntry[]).push(fixtureServer())).toThrow(TypeError);
    expect([...MCP_SERVER_REGISTRY]).toEqual([]);
  });

  it("the freezer the registry is built with freezes every nested object of a row, not the array alone (proven on a fixture: the registry has no row)", () => {
    const row = fixtureServer();
    const frozen = frozenMcpServerEntries([row]);
    expect(frozen[0]).toBe(row);
    const nested = [frozen, row, row.endpoint, row.supportedProtocolVersions, row.auth, row.auth.secrets, row.auth.scopes, row.descriptorPin, row.limits, row.limits.breaker, row.limits.perTool, row.limits.perTool!.search, row.terms, row.state];
    for (const inner of nested) expect(Object.isFrozen(inner)).toBe(true);
    expect(() => { (row.state as { status: string }).status = "blocked"; }).toThrow(TypeError);
    expect(() => { (row.limits.breaker as { failureThreshold: number }).failureThreshold = 99; }).toThrow(TypeError);
    expect(() => { (row.auth.secrets as Array<{ env: string; role: string }>).push({ env: "EXAMPLE_MCP_TOKEN", role: "access-token" }); }).toThrow(TypeError);
  });

  it("exports no add/remove/register/enable API: a row is added only by a reviewed change to the module", async () => {
    const exported = Object.keys(await import("../server-registry"));
    expect(exported.filter((name) => /^(add|remove|register|unregister|delete|set|put|enable|approve|insert|upsert)/i.test(name))).toEqual([]);
  });

  it("a fixture row passes every rule (so each refusal below is caused by the one change it makes)", () => {
    expect(validateMcpServerRegistry([fixtureServer()])).toEqual([]);
    expect(Object.isFrozen(fixtureServer()), "fixtures are ordinary objects; only the registry is frozen").toBe(false);
  });
});

describe("[B20 A0] the canonical URI (RFC 8707 form, mcp-reference-notes section 5)", () => {
  it.each([
    ["a host and a path", "https://mcp.example.com/mcp", { host: "mcp.example.com", port: null, path: "/mcp" }],
    ["a host alone (endpoint path /)", "https://mcp.example.com", { host: "mcp.example.com", port: null, path: "/" }],
    ["a non-default port (the port is part of the endpoint)", "https://mcp.example.com:8443/v1/mcp", { host: "mcp.example.com", port: 8443, path: "/v1/mcp" }],
    ["a mixed-case path (paths are case-sensitive)", "https://mcp.example.com/API/Mcp", { host: "mcp.example.com", port: null, path: "/API/Mcp" }],
    ["a host label carrying sk- inside a word (an identity, never a key)", "https://desk-lamp-tools.example.com/mcp", { host: "desk-lamp-tools.example.com", port: null, path: "/mcp" }],
  ])("accepts %s", (_label, uri, endpoint) => {
    expect(mcpEndpointOfCanonicalUri(uri)).toMatchObject({ ok: true, ...endpoint });
  });

  it.each([
    ["an http scheme", "http://mcp.example.com/mcp", /https/],
    ["an uppercase host", "https://MCP.example.com/mcp", /canonical form|lowercase/],
    ["an uppercase scheme", "HTTPS://mcp.example.com/mcp", /canonical form|lowercase/],
    ["an IPv4 literal", "https://93.184.216.34/mcp", /IP literal|public DNS name/],
    ["an IPv6 literal", "https://[2606:2800:220:1:248:1893:25c8:1946]/mcp", /IP literal|public DNS name/],
    ["localhost", "https://localhost/mcp", /loopback|single-label|public DNS name/],
    ["a .localhost name", "https://mcp.localhost/mcp", /loopback|public DNS name/],
    ["a .internal name", "https://mcp.internal/mcp", /private|public DNS name/],
    ["a single-label host", "https://intranet/mcp", /single-label|public DNS name/],
    ["userinfo", "https://user:pw@mcp.example.com/mcp", /userinfo/],
    ["a query", "https://mcp.example.com/mcp?x=1", /query/],
    ["an empty query", "https://mcp.example.com/mcp?", /query/],
    ["a fragment", "https://mcp.example.com/mcp#tools", /fragment/],
    ["a trailing slash", "https://mcp.example.com/mcp/", /trailing slash/],
    ["a trailing slash after the host", "https://mcp.example.com/", /trailing slash/],
    ["the default port spelled out", "https://mcp.example.com:443/mcp", /default port|canonical form/],
    ["a dot segment", "https://mcp.example.com/a/../mcp", /canonical form|path/],
    ["an empty path segment", "https://mcp.example.com//mcp", /path/],
    ["a percent-encoded path", "https://mcp.example.com/m%63p", /path/],
    ["whitespace", "https://mcp.example.com/mcp ", /canonical form|path|valid URL/],
    ["not a URL", "mcp.example.com/mcp", /valid URL|https/],
  ])("refuses %s", (_label, uri, message) => {
    const result = mcpEndpointOfCanonicalUri(uri);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.reason).toMatch(message);
    expect(rulesOf([mutated((entry) => { entry.canonicalUri = uri; })])).toContain("canonical-uri");
  });

  it("the stored endpoint must be exactly the one the canonical URI derives (host, port AND path, not host only)", () => {
    expect(rulesOf([mutated((entry) => { entry.endpoint.path = "/other"; })])).toContain("endpoint");
    expect(rulesOf([mutated((entry) => { entry.endpoint.host = "example.com"; })])).toContain("endpoint");
    expect(messagesOf([mutated((entry) => { entry.endpoint.path = "/"; })])).toMatch(/endpoint/);
  });

  it("a row on a non-default port stores the port in its endpoint; a port-less endpoint for a ported URI (or the reverse) is refused", () => {
    const ported = fixtureServer({ canonicalUri: "https://mcp.example.com:8443/v1/mcp", endpoint: { host: "mcp.example.com", port: 8443, path: "/v1/mcp" } });
    expect(validateMcpServerRegistry([ported])).toEqual([]);
    expect(fixtureServer().endpoint.port, "the default port is stored as null, never as 443").toBeNull();
    expect(rulesOf([mutated((entry) => { entry.canonicalUri = "https://mcp.example.com:8443/mcp"; })]), "a ported URI with a port-less endpoint").toContain("endpoint");
    expect(messagesOf([mutated((entry) => { entry.canonicalUri = "https://mcp.example.com:8443/mcp"; })])).toMatch(/port 8443/);
    expect(rulesOf([mutated((entry) => { entry.endpoint.port = 8443; })]), "a port-less URI with a ported endpoint").toContain("endpoint");
    expect(rulesOf([mutated((entry) => { entry.endpoint.port = 443; })]), "the default port spelled into the endpoint").toContain("endpoint");
  });
});

describe("[B20 A0] the validator refuses what a registry row must never contain", () => {
  /** the base fixture's canonical URI and endpoint, for a second row that claims the same server */
  const twin = { canonicalUri: "https://mcp.example.com/mcp", endpoint: { host: "mcp.example.com", port: null, path: "/mcp" } } as const;
  const withAuth = (id: string, host: string, env: string): McpServerRegistryEntry =>
    fixtureServer({ id, canonicalUri: `https://${host}/mcp`, endpoint: { host, port: null, path: "/mcp" }, auth: { mode: "pre-issued-token-env", secrets: [{ env, role: "access-token" }], scopes: [] } });

  it.each([
    ["a duplicate id", [fixtureServer(), fixtureServer()], "duplicate-id", /duplicate id/],
    ["a duplicate malformed id (still counted as a duplicate)", [mutated((entry) => { entry.id = "Docs"; }), mutated((entry) => { entry.id = "Docs"; })], "duplicate-id", /duplicate id/],
    ["a duplicate canonical URI across two ids (a disabled row and an approved twin split one decision)", [fixtureServer({ id: "docs-a", ...twin, state: { status: "disabled", ownerDecision: "OD-48", reason: "fixture; disabled by decision" } }), fixtureServer({ id: "docs-b", ...twin })], "duplicate-canonical-uri", /already registered by docs-a/],
    ["a secret reference shared by two rows (one credential would be sent to two servers)", [withAuth("docs-a", "a.example.com", "EXAMPLE_MCP_TOKEN"), withAuth("docs-b", "b.example.com", "EXAMPLE_MCP_TOKEN")], "shared-secret-reference", /EXAMPLE_MCP_TOKEN is already referenced by docs-a/],
    ["an uppercase id", [mutated((entry) => { entry.id = "Docs"; })], "id", /id/],
    ["a one-character id", [mutated((entry) => { entry.id = "a"; })], "id", /id/],
    ["an id starting with a hyphen", [mutated((entry) => { entry.id = "-docs"; })], "id", /id/],
    ["an id longer than 31 characters", [mutated((entry) => { entry.id = `a${"b".repeat(31)}`; })], "id", /id/],
    ["an empty title", [mutated((entry) => { entry.title = "  "; })], "title", /title/],
    ["a title over 120 characters", [mutated((entry) => { entry.title = "t".repeat(121); })], "title", /title/],
    ["no 2026-07-28 among the supported versions", [mutated((entry) => { entry.supportedProtocolVersions = ["2025-11-25"]; entry.compatibilityEra = true; })], "protocol-versions", /2026-07-28/],
    ["2025-11-25 without compatibilityEra", [mutated((entry) => { entry.supportedProtocolVersions = ["2026-07-28", "2025-11-25"]; })], "protocol-versions", /compatibilityEra/],
    ["compatibilityEra without 2025-11-25", [mutated((entry) => { entry.compatibilityEra = true; })], "protocol-versions", /compatibilityEra/],
    ["an unknown protocol version", [mutated((entry) => { entry.supportedProtocolVersions = ["2026-07-28", "2025-03-26"]; })], "protocol-versions", /unknown protocol version/],
    ["a duplicated protocol version", [mutated((entry) => { entry.supportedProtocolVersions = ["2026-07-28", "2026-07-28"]; })], "protocol-versions", /duplicate/],
    ["a secret-shaped string in the title", [mutated((entry) => { entry.title = `docs ghp_${"a".repeat(36)}`; })], "secret-shaped", /shaped like a secret/],
    ["a secret-shaped sk- key at the start of the title", [mutated((entry) => { entry.title = `sk-${"a".repeat(40)}`; })], "secret-shaped", /shaped like a secret/],
    ["a secret-shaped sk- key after a space in the reason", [mutated((entry) => { entry.state.reason = `rotated sk-${"b".repeat(40)}`; })], "secret-shaped", /shaped like a secret/],
    ["a secret-shaped string in the reason", [mutated((entry) => { entry.state.reason = `approved with Bearer ${"x".repeat(40)}`; })], "secret-shaped", /shaped like a secret/],
    ["a secret-shaped string in the documentation URL", [mutated((entry) => { entry.terms.documentationUrl = `https://example.com/docs/sk-${"a".repeat(40)}`; })], "secret-shaped", /shaped like a secret/],
    ["a secret-shaped string in the retention note", [mutated((entry) => { entry.terms.retentionNote = `AKIA${"A".repeat(16)} nothing kept`; })], "secret-shaped", /shaped like a secret/],
    ["a JWT-shaped string in a scope", [mutated((entry) => { entry.auth.scopes = [`eyJ${"a".repeat(24)}.${"b".repeat(24)}`]; })], "secret-shaped", /shaped like a secret/],
    ["an env name that looks like a value", [mutated((entry) => { entry.auth.mode = "pre-issued-token-env"; entry.auth.secrets = [{ env: "abcd-1234-real-key", role: "access-token" }]; })], "secret-reference", /environment variable name/],
    ["a lowercase env name", [mutated((entry) => { entry.auth.mode = "pre-issued-token-env"; entry.auth.secrets = [{ env: "mcp_token", role: "access-token" }]; })], "secret-reference", /environment variable name/],
    ["an env name over 64 characters", [mutated((entry) => { entry.auth.mode = "pre-issued-token-env"; entry.auth.secrets = [{ env: `A${"B".repeat(64)}`, role: "access-token" }]; })], "secret-reference", /environment variable name/],
    ["an unknown secret role", [mutated((entry) => { entry.auth.mode = "pre-issued-token-env"; entry.auth.secrets = [{ env: "EXAMPLE_MCP_TOKEN", role: "refresh-token" }]; })], "secret-reference", /role must be one of/],
    ["the same env name referenced twice in one row", [mutated((entry) => { entry.auth.mode = "client-credentials-env"; entry.auth.secrets = [{ env: "EXAMPLE_MCP_CLIENT", role: "client-id" }, { env: "EXAMPLE_MCP_CLIENT", role: "client-secret" }]; })], "secret-reference", /duplicate secret reference/],
    ["mode none with a secret reference", [mutated((entry) => { entry.auth.secrets = [{ env: "EXAMPLE_MCP_TOKEN", role: "access-token" }]; })], "auth-mode", /none/],
    ["mode pre-issued-token-env without its access-token reference", [mutated((entry) => { entry.auth.mode = "pre-issued-token-env"; })], "auth-mode", /access-token/],
    ["mode client-credentials-env without both references", [mutated((entry) => { entry.auth.mode = "client-credentials-env"; entry.auth.secrets = [{ env: "EXAMPLE_MCP_CLIENT_ID", role: "client-id" }]; })], "auth-mode", /client-secret/],
    ["an unknown auth mode", [mutated((entry) => { entry.auth.mode = "basic"; })], "auth-mode", /mode/],
    ["a scope with a space", [mutated((entry) => { entry.auth.scopes = ["read docs"]; })], "scopes", /scope/],
    ["a duplicated scope", [mutated((entry) => { entry.auth.scopes = ["docs:read", "docs:read"]; })], "scopes", /scope/],
    ["a missing descriptorPin", [mutated((entry) => { entry.descriptorPin = null; })], "descriptor-pin", /descriptorPin is missing/],
    ["a malformed descriptor digest", [mutated((entry) => { entry.descriptorPin = { toolsListDigest: "sha256:zz", pinnedAt: "2026-09-17" }; })], "descriptor-pin", /toolsListDigest/],
    ["a digest without pinnedAt", [mutated((entry) => { entry.descriptorPin = { toolsListDigest: `sha256:${"0".repeat(64)}`, pinnedAt: null }; })], "descriptor-pin", /pinnedAt/],
    ["pinnedAt without a digest", [mutated((entry) => { entry.descriptorPin = { toolsListDigest: null, pinnedAt: "2026-09-17" }; })], "descriptor-pin", /pinnedAt/],
    ["pinnedAt that is not a date", [mutated((entry) => { entry.descriptorPin = { toolsListDigest: `sha256:${"0".repeat(64)}`, pinnedAt: "yesterday" }; })], "descriptor-pin", /pinnedAt/],
    ["maxRedirects 1", [mutated((entry) => { entry.maxRedirects = 1; })], "redirects", /redirects must be refused/],
    ["requestsPerMinute 0", [mutated((entry) => { entry.limits.requestsPerMinute = 0; })], "limits", /requestsPerMinute/],
    ["requestsPerMinute 3 (the agent's 25% share, OD-40, would round to 0 and the server would be agent-unusable)", [mutated((entry) => { entry.limits.requestsPerMinute = 3; })], "limits", /requestsPerMinute must be an integer in 4/],
    ["requestsPerMinute above the bound", [mutated((entry) => { entry.limits.requestsPerMinute = MCP_SERVER_LIMIT_BOUNDS.requestsPerMinute[1] + 1; })], "limits", /requestsPerMinute/],
    ["a fractional requestsPerMinute", [mutated((entry) => { entry.limits.requestsPerMinute = 2.5; })], "limits", /requestsPerMinute/],
    ["maxConcurrent 0", [mutated((entry) => { entry.limits.maxConcurrent = 0; })], "limits", /maxConcurrent/],
    ["deadlineMs below 1 000", [mutated((entry) => { entry.limits.deadlineMs = 500; })], "limits", /deadlineMs/],
    ["deadlineMs above 30 000", [mutated((entry) => { entry.limits.deadlineMs = 60_000; })], "limits", /deadlineMs/],
    ["maxResponseBytes 0", [mutated((entry) => { entry.limits.maxResponseBytes = 0; })], "limits", /maxResponseBytes/],
    ["maxResponseBytes above the bound", [mutated((entry) => { entry.limits.maxResponseBytes = MCP_SERVER_LIMIT_BOUNDS.maxResponseBytes[1] + 1; })], "limits", /maxResponseBytes/],
    ["a breaker threshold of 0", [mutated((entry) => { entry.limits.breaker.failureThreshold = 0; })], "limits", /failureThreshold/],
    ["a breaker cooldown of 100 ms", [mutated((entry) => { entry.limits.breaker.cooldownMs = 100; })], "limits", /cooldownMs/],
    ["perTool given as an array", [mutated((entry) => { entry.limits.perTool = []; })], "per-tool", /record of tool name/],
    ["a per-tool window wider than the server's", [mutated((entry) => { entry.limits.perTool = { search: { requestsPerMinute: 11 } }; })], "per-tool", /exceeds the server/],
    ["a per-tool window of 0", [mutated((entry) => { entry.limits.perTool = { search: { requestsPerMinute: 0 } }; })], "per-tool", /requestsPerMinute/],
    ["a per-tool window of 3 (agent share 0)", [mutated((entry) => { entry.limits.perTool = { search: { requestsPerMinute: 3 } }; })], "per-tool", /at least 4/],
    ["a per-tool name with a space", [mutated((entry) => { entry.limits.perTool = { "search docs": { requestsPerMinute: 4 } }; })], "per-tool", /tool name/],
    ["a per-tool name with a slash", [mutated((entry) => { entry.limits.perTool = { "search/docs": { requestsPerMinute: 4 } }; })], "per-tool", /tool name/],
    ["a per-tool name of 129 characters", [mutated((entry) => { entry.limits.perTool = { ["t".repeat(129)]: { requestsPerMinute: 4 } }; })], "per-tool", /tool name/],
    ["an unknown agentDisclosure", [mutated((entry) => { entry.agentDisclosure = "maybe"; })], "agent-disclosure", /agentDisclosure/],
    ["agentDisclosure permitted on a disabled server", [mutated((entry) => { entry.agentDisclosure = "permitted"; entry.state.status = "disabled"; })], "agent-disclosure", /permitted/],
    ["a plain-HTTP documentation URL", [mutated((entry) => { entry.terms.documentationUrl = "http://example.com/docs"; })], "terms", /documentationUrl/],
    ["a documentation URL with a query", [mutated((entry) => { entry.terms.documentationUrl = "https://example.com/docs?x=1"; })], "terms", /documentationUrl/],
    ["checkedOn that is not a date", [mutated((entry) => { entry.terms.checkedOn = "last week"; })], "terms", /checkedOn/],
    ["a blank retention note", [mutated((entry) => { entry.terms.retentionNote = "  "; })], "terms", /retentionNote/],
    ["an approved server whose documentation was never checked", [mutated((entry) => { delete entry.terms.checkedOn; })], "terms", /approved/],
    ["an approved server without a documentation URL", [mutated((entry) => { delete entry.terms.documentationUrl; })], "terms", /approved/],
    ["an unknown status", [mutated((entry) => { entry.state.status = "enabled"; })], "state", /status/],
    ["no owner decision id", [mutated((entry) => { entry.state.ownerDecision = ""; })], "state", /owner decision/],
    ["a malformed owner decision id", [mutated((entry) => { entry.state.ownerDecision = "od-48"; })], "state", /owner decision/],
    ["an empty reason", [mutated((entry) => { entry.state.reason = " "; })], "state", /reason/],
    ["a blocked server that still declares secret references", [mutated((entry) => { entry.state.status = "blocked"; entry.auth.mode = "pre-issued-token-env"; entry.auth.secrets = [{ env: "EXAMPLE_MCP_TOKEN", role: "access-token" }]; })], "state", /blocked/],
    ["a control character in a string", [mutated((entry) => { entry.title = `docs${String.fromCharCode(27)}[2J`; })], "control-characters", /control/],
  ])("%s", (_label, revision, rule, message) => {
    const violations = validateMcpServerRegistry(revision);
    expect(violations.map((violation) => violation.rule), violations.map((violation) => violation.message).join(NEWLINE)).toContain(rule);
    expect(violations.map((violation) => violation.message).join(NEWLINE)).toMatch(message);
  });

  it("sk- inside a word is an identity, not a key: a title and a host label carrying it are accepted (the classifier is token-anchored)", () => {
    const row = fixtureServer({ title: "Flask-based-docs server", canonicalUri: "https://desk-lamp-tools.example.com/mcp", endpoint: { host: "desk-lamp-tools.example.com", port: null, path: "/mcp" } });
    expect(validateMcpServerRegistry([row])).toEqual([]);
    expect(rulesOf([fixtureServer({ title: `docs sk-${"c".repeat(40)}` })]), "a key after a word boundary is still refused").toContain("secret-shaped");
  });

  it("the lower bound of a minute window is 4, so the agent's 25% share (OD-40) is at least one request", () => {
    expect(MCP_SERVER_LIMIT_BOUNDS.requestsPerMinute[0]).toBe(4);
    expect(validateMcpServerRegistry([mutated((entry) => { entry.limits.requestsPerMinute = 4; entry.limits.perTool = { search: { requestsPerMinute: 4 } }; })])).toEqual([]);
  });

  it("the id and tool-name patterns are the ones the rules above enforce", () => {
    expect(MCP_SERVER_ID_PATTERN.source).toBe("^[a-z0-9][a-z0-9-]{1,30}$");
    expect(MCP_TOOL_NAME_PATTERN.source).toBe("^[A-Za-z0-9_.-]{1,128}$");
  });

  it("every violation names the row it belongs to", () => {
    for (const violation of validateMcpServerRegistry([mutated((entry) => { entry.maxRedirects = 2; })])) expect(violation.id).toBe("docs-example");
  });

  it("a malformed id is never echoed: a secret-shaped or control-character id appears in no violation id and no message", () => {
    const keyShaped = `sk-ant-${"k".repeat(40)}`;
    const controlled = `docs${String.fromCharCode(27)}[2J`;
    for (const hostile of [keyShaped, controlled]) {
      const violations = validateMcpServerRegistry([fixtureServer({ id: "docs-first" }), mutated((entry) => { entry.id = hostile; })]);
      expect(violations.map((violation) => violation.rule)).toContain("id");
      expect(violations.length).toBeGreaterThan(0);
      for (const violation of violations) {
        expect(violation.id).toBe("(malformed id, row 1)");
        expect(violation.message.startsWith("(malformed id, row 1): ")).toBe(true);
        expect(violation.message).not.toContain("sk-ant-");
        expect(violation.message).not.toContain(String.fromCharCode(27));
        expect(violation.message).not.toContain(hostile);
      }
    }
    const [noId] = validateMcpServerRegistry([mutated((entry) => { (entry as { id?: string }).id = undefined; })]);
    expect(noId).toMatchObject({ id: "(malformed id, row 0)", rule: "id" });
  });

  it("lets two rows share a client-id environment name (a public identifier), never a client-secret or an access-token", () => {
    // [B20 A0 review] one OAuth client registered at one authorization server may serve two resource servers; its id is
    // not a credential. The secret and the token stay one-server-only.
    const credentials = (id: string, clientId: string, clientSecret: string): McpServerRegistryEntry =>
      fixtureServer({
        id,
        canonicalUri: `https://${id}.example.com/mcp`,
        endpoint: { host: `${id}.example.com`, port: null, path: "/mcp" },
        auth: { mode: "client-credentials-env", secrets: [{ env: clientId, role: "client-id" }, { env: clientSecret, role: "client-secret" }], scopes: [] },
      });
    expect(validateMcpServerRegistry([credentials("docs-a", "EXAMPLE_MCP_CLIENT_ID", "EXAMPLE_MCP_SECRET_A"), credentials("docs-b", "EXAMPLE_MCP_CLIENT_ID", "EXAMPLE_MCP_SECRET_B")])).toEqual([]);
    const shared = validateMcpServerRegistry([credentials("docs-a", "EXAMPLE_MCP_CLIENT_A", "EXAMPLE_MCP_SECRET"), credentials("docs-b", "EXAMPLE_MCP_CLIENT_B", "EXAMPLE_MCP_SECRET")]);
    expect(shared.map((violation) => violation.rule)).toEqual(["shared-secret-reference"]);
    expect(shared[0]?.message).toContain("EXAMPLE_MCP_SECRET is already referenced by docs-a");
  });
});

describe("[B20 A0] admission returns only an approved row, never without the flag, and refuses everything else with a closed code", () => {
  const approved = fixtureServer();
  const disabled = fixtureServer({ id: "docs-disabled", state: { status: "disabled", ownerDecision: "OD-48", reason: "fixture; disabled by decision" } });
  const blocked = fixtureServer({ id: "docs-blocked", state: { status: "blocked", ownerDecision: "OD-48", reason: "fixture; blocked by decision" } });
  const rows = [approved, disabled, blocked];

  it("the fixture rows are a valid registry", () => {
    expect(validateMcpServerRegistry(rows)).toEqual([]);
  });

  it("an approved row is admitted with the flag on, and is feature_disabled with an empty environment", () => {
    expect(admittedMcpServer("docs-example", ON, rows)).toEqual({ admitted: true, entry: approved });
    expect(admittedMcpServer("docs-example", {}, rows)).toMatchObject({ admitted: false, refusal: "feature_disabled" });
  });

  it("an omitted environment never skips the flag: a JavaScript caller that passes none is read against process.env at call time", () => {
    const previous = { enabled: process.env[MCP_ENABLED_ENV], disabled: process.env[MCP_DISABLED_SERVERS_ENV] };
    const omitted = admittedMcpServer as unknown as (id: string, env: undefined, entries: readonly McpServerRegistryEntry[]) => ReturnType<typeof admittedMcpServer>;
    try {
      delete process.env[MCP_ENABLED_ENV];
      delete process.env[MCP_DISABLED_SERVERS_ENV];
      expect(omitted("docs-example", undefined, rows)).toMatchObject({ admitted: false, refusal: "feature_disabled" });
      process.env[MCP_ENABLED_ENV] = "1";
      process.env[MCP_DISABLED_SERVERS_ENV] = "docs-example";
      expect(omitted("docs-example", undefined, rows)).toMatchObject({ admitted: false, refusal: "operator_disabled" });
      delete process.env[MCP_DISABLED_SERVERS_ENV];
      expect(omitted("docs-example", undefined, rows)).toEqual({ admitted: true, entry: approved });
    } finally {
      if (previous.enabled === undefined) delete process.env[MCP_ENABLED_ENV];
      else process.env[MCP_ENABLED_ENV] = previous.enabled;
      if (previous.disabled === undefined) delete process.env[MCP_DISABLED_SERVERS_ENV];
      else process.env[MCP_DISABLED_SERVERS_ENV] = previous.disabled;
    }
  });

  it("a disabled row is refused with `disabled` and names its owner decision", () => {
    const admission = admittedMcpServer("docs-disabled", ON, rows);
    expect(admission).toMatchObject({ admitted: false, id: "docs-disabled", refusal: "disabled" });
    expect(admission.admitted ? "" : admission.message).toContain("OD-48");
  });

  it("a blocked row is refused with `blocked`", () => {
    expect(admittedMcpServer("docs-blocked", ON, rows)).toMatchObject({ admitted: false, refusal: "blocked" });
  });

  it("an unknown id is refused with `unknown_server`, and a hostile id is never echoed", () => {
    expect(admittedMcpServer("nobody", ON, rows)).toMatchObject({ admitted: false, id: "nobody", refusal: "unknown_server" });
    const hostile = `evil${NEWLINE}Bearer ${"x".repeat(30)}`;
    const admission = admittedMcpServer(hostile, ON, rows);
    expect(admission).toMatchObject({ admitted: false, refusal: "unknown_server" });
    expect(admission.admitted ? "" : admission.message).not.toContain("Bearer");
    expect(admission.admitted ? "" : admission.message).toMatch(/OD-48/);
  });

  it("against the committed registry every id is unknown (OD-48), flag or no flag", () => {
    expect(admittedMcpServer("docs-example", ON)).toMatchObject({ admitted: false, refusal: "unknown_server" });
    expect(admittedMcpServer("docs-example", {})).toMatchObject({ admitted: false, refusal: "unknown_server" });
  });

  it("the id lookup is exact and never reads the prototype", () => {
    expect(mcpServerEntry("constructor", rows)).toBeNull();
    expect(mcpServerEntry("__proto__", rows)).toBeNull();
    expect(mcpServerEntry("DOCS-EXAMPLE", rows)).toBeNull();
    expect(mcpServerEntry("docs-example", rows)).toBe(approved);
  });
});

describe("[B20 A0] the rendered artifact", () => {
  it("has exactly these columns in this order (a schema change is a reviewed diff in the constant, here and in mcp-server-registry.md)", () => {
    expect([...MCP_SERVER_REGISTRY_CSV_COLUMNS]).toEqual([
      "registry_version", "id", "status", "owner_decision", "title", "canonical_uri", "endpoint_host", "endpoint_port", "endpoint_path", "protocol_versions", "compatibility_era",
      "auth_mode", "secret_references", "scopes", "descriptor_pin", "pinned_at", "requests_per_minute", "max_concurrent", "deadline", "max_response_bytes", "breaker",
      "per_tool_limits", "redirects", "agent_disclosure", "documentation_url", "docs_checked_on", "retention_note", "reason",
    ]);
  });

  it("has a deterministic column order, one row per entry sorted by id, and only secret NAMES by construction", () => {
    const zeta = fixtureServer({ id: "zeta-server", auth: { mode: "pre-issued-token-env", secrets: [{ env: "EXAMPLE_ZETA_TOKEN", role: "access-token" }], scopes: ["docs:read"] } });
    const alpha = fixtureServer({ id: "alpha-server", descriptorPin: { toolsListDigest: `sha256:${"a".repeat(64)}`, pinnedAt: "2026-09-17" } });
    expect(validateMcpServerRegistry([zeta, alpha])).toEqual([]);
    const rendered = renderMcpServerRegistryCsv([zeta, alpha]);
    expect(rendered).toBe(renderMcpServerRegistryCsv([alpha, zeta]));
    const lines = rendered.split(NEWLINE);
    expect(lines[0]).toBe(MCP_SERVER_REGISTRY_CSV_COLUMNS.join(","));
    expect(lines[1]!.startsWith("1.0.0,alpha-server,approved,OD-48,")).toBe(true);
    expect(lines[2]!.startsWith("1.0.0,zeta-server,approved,OD-48,")).toBe(true);
    expect(lines).toHaveLength(4);
    expect(lines[3]).toBe("");
    expect(lines[2]).toContain("EXAMPLE_ZETA_TOKEN|access-token");
    expect(lines[2]).toContain(",zeta-server.example.com,,/mcp,"); // host, no port, path
    expect(lines[1]).toContain(`sha256:${"a".repeat(64)}`);
    expect(csvCells(lines[2]!)).toHaveLength(MCP_SERVER_REGISTRY_CSV_COLUMNS.length);
    expect(csvCells(lines[2]!)[MCP_SERVER_REGISTRY_CSV_COLUMNS.indexOf("redirects")]).toBe("0");
  });

  it("quotes a cell carrying a comma or a quote (RFC 4180), renders the port, and renders sub-second durations in ms", () => {
    const quoted = fixtureServer({
      id: "quoted-server",
      title: `Docs, "beta" server`,
      canonicalUri: "https://mcp.example.com:8443/v1/mcp",
      endpoint: { host: "mcp.example.com", port: 8443, path: "/v1/mcp" },
      limits: { ...fixtureServer().limits, deadlineMs: 1_500, breaker: { failureThreshold: 3, cooldownMs: 1_500 } },
      state: { status: "approved", ownerDecision: "OD-48", reason: "fixture, with a comma" },
    });
    expect(validateMcpServerRegistry([quoted])).toEqual([]);
    const [header, line] = renderMcpServerRegistryCsv([quoted]).split(NEWLINE);
    expect(header).toBe(MCP_SERVER_REGISTRY_CSV_COLUMNS.join(","));
    expect(line).toContain(`,"Docs, ""beta"" server",`);
    expect(line).toContain(",mcp.example.com,8443,/v1/mcp,");
    expect(line).toContain(",1500ms,");
    expect(line).toContain(",3 failures -> open 1500ms,");
    expect(line!.endsWith(`,"fixture, with a comma"`)).toBe(true);
    const cells = csvCells(line!);
    expect(cells).toHaveLength(MCP_SERVER_REGISTRY_CSV_COLUMNS.length);
    expect(cells[MCP_SERVER_REGISTRY_CSV_COLUMNS.indexOf("title")]).toBe(`Docs, "beta" server`);
    expect(cells[MCP_SERVER_REGISTRY_CSV_COLUMNS.indexOf("endpoint_port")]).toBe("8443");
    expect(cells[MCP_SERVER_REGISTRY_CSV_COLUMNS.indexOf("reason")]).toBe("fixture, with a comma");
  });

  it("a line break inside a cell is quoted as well (the validator refuses such a row by its control-character rule; the renderer is exercised on its own)", () => {
    const row = fixtureServer({ terms: { ...fixtureServer().terms, retentionNote: `line one${NEWLINE}line two` } });
    expect(rulesOf([row])).toContain("control-characters");
    expect(renderMcpServerRegistryCsv([row])).toContain(`,"line one${NEWLINE}line two",`);
  });

  it("mcp-server-registry.md states the renderer's column count wherever it counts columns (the page and the constant are reviewed together)", () => {
    const page = readFileSync(resolve(process.cwd(), "artifacts/ai-control-plane-b20/mcp-server-registry.md"), "utf8");
    const stated = [...page.matchAll(/(\d+) columns/g)].map((match) => Number(match[1]));
    expect(stated.length).toBeGreaterThan(0);
    expect(stated).toEqual(stated.map(() => MCP_SERVER_REGISTRY_CSV_COLUMNS.length));
  });

  it("the empty registry renders the header line only", () => {
    expect(renderMcpServerRegistryCsv()).toBe(`${MCP_SERVER_REGISTRY_CSV_COLUMNS.join(",")}${NEWLINE}`);
  });

  it(`${ARTIFACT} byte-matches the render`, () => {
    const path = resolve(process.cwd(), ARTIFACT);
    expect(existsSync(path), "run: npx tsx scripts/generate-b20-mcp-server-registry.ts").toBe(true);
    expect(readFileSync(path, "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE)).toBe(renderMcpServerRegistryCsv());
  });
});
