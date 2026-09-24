/**
 * [B20 A3] The registry half of the authorization client (OD-61): a client-credentials row PINS its authorization server
 * (`auth.authorizationServer = { issuer, tokenEndpoint }`, both https URLs on public DNS names, validated like the canonical
 * URI), no other auth mode may carry a pin, rows that share a client id pin the identical issuer, no row's token endpoint is
 * any row's MCP endpoint, and a row names at most 32 scopes. The version, the columns, the CSV bytes and the page's column
 * count are carried by the updated A0 suite and are not duplicated here.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MCP_AUTHORIZATION_URL_MAX_CHARS, MCP_SCOPES_MAX, MCP_SERVER_REGISTRY_CSV_COLUMNS, mcpAuthorizationUrlOf, renderMcpServerRegistryCsv, validateMcpServerRegistry, type McpServerRegistryEntry,
} from "../server-registry";
import { fixtureServer } from "./_fixtures";
import { ccRow, ccServer, CLIENT_ID_ENV, ISSUER, TOKEN_ENDPOINT } from "./_fake-authorization-server";

const NEWLINE = String.fromCharCode(10);
const rulesOf = (entries: readonly McpServerRegistryEntry[]): string[] => validateMcpServerRegistry(entries).map((violation) => violation.rule);
const messagesOf = (entries: readonly McpServerRegistryEntry[]): string => validateMcpServerRegistry(entries).map((violation) => violation.message).join(NEWLINE);
const withPin = (pin: unknown, base: McpServerRegistryEntry = ccServer): McpServerRegistryEntry => ({ ...base, auth: { ...base.auth, authorizationServer: pin as McpServerRegistryEntry["auth"]["authorizationServer"] } });
/** The cells of one RFC 4180 line (as the A0 suite reads them): a quoted cell may carry commas and doubled quotes. */
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

afterEach(() => {
  vi.unstubAllGlobals();
});

/** URLs neither pin field may hold, each with the reason it is refused */
const REFUSED: ReadonlyArray<[string, unknown]> = [
  ["http", "http://auth.example.com/oauth/token"],
  ["userinfo", "https://user:pw@auth.example.com/oauth/token"],
  ["a query", "https://auth.example.com/oauth/token?x=1"],
  ["an empty fragment", "https://auth.example.com/oauth/token#"],
  ["an IPv4 literal", "https://93.184.216.34/oauth/token"],
  ["an IPv6 literal", "https://[2606:2800:220:1:248:1893:25c8:1946]/oauth/token"],
  ["a single-label host", "https://auth/oauth/token"],
  ["localhost", "https://localhost/oauth/token"],
  ["a .local name", "https://auth.local/oauth/token"],
  ["a .internal name", "https://auth.internal/oauth/token"],
  ["the metadata name", "https://metadata/oauth/token"],
  ["an uppercase host", "https://AUTH.example.com/oauth/token"],
  ["the default port spelled out", "https://auth.example.com:443/oauth/token"],
  ["a percent-encoded segment", "https://auth.example.com/oauth/t%6Fken"],
  ["a dot segment", "https://auth.example.com/oauth/../token"],
  ["whitespace", "https://auth.example.com/oauth/token "],
  ["a control character", `https://auth.example.com/oauth/${String.fromCharCode(9)}token`],
  ["513 characters", `https://auth.example.com/${"t".repeat(MCP_AUTHORIZATION_URL_MAX_CHARS + 1 - "https://auth.example.com/".length)}`],
  ["not a string", 42],
];

describe("[B20 A3] a client-credentials row pins its authorization server (OD-61)", () => {
  it("a client-credentials row with a valid pin validates; a missing, null or malformed pin is refused as authorization-server", () => {
    expect(validateMcpServerRegistry([ccServer])).toEqual([]);
    for (const pin of [undefined, null, "https://auth.example.com", { issuer: ISSUER }, { tokenEndpoint: TOKEN_ENDPOINT }, []]) {
      expect(rulesOf([withPin(pin)]), JSON.stringify(pin) ?? "undefined").toContain("authorization-server");
    }
    expect(messagesOf([withPin(null)])).toMatch(/authorizationServer/);
  });

  it("a pin on a none or a pre-issued row is refused; an absent or null pin is accepted there", () => {
    const pin = { issuer: ISSUER, tokenEndpoint: TOKEN_ENDPOINT };
    const none = fixtureServer();
    const preIssued = fixtureServer({ id: "docs-token", canonicalUri: "https://docs-token.example.com/mcp", endpoint: { host: "docs-token.example.com", port: null, path: "/mcp" }, auth: { mode: "pre-issued-token-env", secrets: [{ env: "MCP_DOCS_TOKEN", role: "access-token" }], scopes: [] } });
    for (const row of [none, preIssued]) {
      expect(validateMcpServerRegistry([row])).toEqual([]);
      expect(validateMcpServerRegistry([withPin(null, row)])).toEqual([]);
      expect(rulesOf([withPin(pin, row)]), row.auth.mode).toContain("authorization-server");
    }
  });

  it("every refused URL is refused in both pin fields, by the URL rule and by the validator", () => {
    for (const [label, value] of REFUSED) {
      expect(mcpAuthorizationUrlOf(value).ok, label).toBe(false);
      expect(rulesOf([withPin({ issuer: value, tokenEndpoint: TOKEN_ENDPOINT })]), `issuer: ${label}`).toContain("authorization-server");
      expect(rulesOf([withPin({ issuer: ISSUER, tokenEndpoint: value })]), `tokenEndpoint: ${label}`).toContain("authorization-server");
    }
  });

  it("a token endpoint needs a non-root path; a secret-shaped pin is refused as secret-shaped", () => {
    for (const root of ["https://auth.example.com", "https://auth.example.com/"]) {
      expect(mcpAuthorizationUrlOf(root).ok, root).toBe(true);
      expect(rulesOf([withPin({ issuer: ISSUER, tokenEndpoint: root })]), root).toContain("authorization-server");
    }
    const keyShaped = `https://auth.example.com/sk-${"a".repeat(40)}`;
    expect(rulesOf([withPin({ issuer: ISSUER, tokenEndpoint: keyShaped })])).toContain("secret-shaped");
    expect(messagesOf([withPin({ issuer: ISSUER, tokenEndpoint: keyShaped })])).not.toContain(`sk-${"a".repeat(40)}`);
  });

  it("accepts an issuer with and without a trailing slash, with a path and with a port, and a token endpoint on another host", () => {
    for (const issuer of ["https://auth.example.com", "https://auth.example.com/", "https://auth.example.com/tenant1", "https://auth.example.com/tenant1/", "https://auth.example.com:8443/tenant1"]) {
      expect(mcpAuthorizationUrlOf(issuer).ok, issuer).toBe(true);
      expect(validateMcpServerRegistry([withPin({ issuer, tokenEndpoint: TOKEN_ENDPOINT })]), issuer).toEqual([]);
    }
    expect(validateMcpServerRegistry([withPin({ issuer: ISSUER, tokenEndpoint: "https://tokens.example.org/v2/token" })])).toEqual([]);
    expect(mcpAuthorizationUrlOf("https://auth.example.com:8443/tenant1")).toMatchObject({ ok: true, host: "auth.example.com", port: 8443, path: "/tenant1" });
  });

  // [B20 A3 review] tests-length-first-timing-assertion: a wall-clock bound could not see a length check moved after the parse
  // (a 1 MB parse takes milliseconds) and could fail under load. The parse is observed instead: an over-long URL never
  // reaches the URL parser, and every pattern after it is reached only through the parse.
  it("the URL rule judges the length first: an over-long URL is refused before it is ever parsed", () => {
    const Native = URL;
    let parsed = 0;
    vi.stubGlobal("URL", class extends Native { constructor(...args: ConstructorParameters<typeof URL>) { parsed += 1; super(...args); } });
    try {
      expect(mcpAuthorizationUrlOf(`https://auth.example.com/${"a".repeat(1_000_000)}`)).toMatchObject({ ok: false });
      expect(mcpAuthorizationUrlOf(`https://auth.example.com/${"a".repeat(MCP_AUTHORIZATION_URL_MAX_CHARS + 1 - "https://auth.example.com/".length)}`)).toMatchObject({ ok: false });
      expect(parsed, "neither was parsed").toBe(0);
      expect(mcpAuthorizationUrlOf(`https://auth.example.com/${"a".repeat(MCP_AUTHORIZATION_URL_MAX_CHARS - "https://auth.example.com/".length)}`)).toMatchObject({ ok: true });
      expect(parsed, "the counter sees a parse").toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // [B20 A3 review] tests-renderer-pin-cells-never-rendered: the two new cells were only ever rendered empty (none and
  // pre-issued rows, an empty registry), so swapping or blanking them passed
  it("the rendered CSV carries the pin in its two columns, in order, and leaves both empty for a row without one", () => {
    const [header, pinned, unpinned] = renderMcpServerRegistryCsv([ccServer, fixtureServer({ id: "docs-none" })]).split(NEWLINE).map(csvCells);
    expect(header).toEqual([...MCP_SERVER_REGISTRY_CSV_COLUMNS]);
    const issuerAt = header!.indexOf("authorization_issuer");
    const endpointAt = header!.indexOf("token_endpoint");
    expect(endpointAt, "the token endpoint follows the issuer").toBe(issuerAt + 1);
    expect(pinned).toHaveLength(MCP_SERVER_REGISTRY_CSV_COLUMNS.length);
    expect(pinned![issuerAt]).toBe(ISSUER);
    expect(pinned![endpointAt]).toBe(TOKEN_ENDPOINT);
    expect(unpinned![issuerAt]).toBe("");
    expect(unpinned![endpointAt]).toBe("");
  });
});

describe("[B20 A3] cross-row rules of the pin", () => {
  it("rows that share a client-id variable must pin the identical issuer (credentials are keyed by issuer); distinct issuers are refused", () => {
    const a = ccRow("docs-a", "a.example.com", {}, "/mcp", "MCP_DOCS_SECRET_A");
    const b = ccRow("docs-b", "b.example.com", {}, "/mcp", "MCP_DOCS_SECRET_B");
    expect(validateMcpServerRegistry([a, b])).toEqual([]);
    const other = withPin({ issuer: "https://login.example.org", tokenEndpoint: "https://login.example.org/token" }, b);
    expect(rulesOf([a, other])).toEqual(["authorization-server"]);
    expect(messagesOf([a, other])).toContain(CLIENT_ID_ENV);
    expect(messagesOf([a, other])).toContain("docs-a");
    // a trailing slash is another issuer: the comparison is exact
    expect(rulesOf([a, withPin({ issuer: `${ISSUER}/`, tokenEndpoint: TOKEN_ENDPOINT }, b)])).toEqual(["authorization-server"]);
  });

  it("no row's token endpoint may be any row's MCP endpoint (the secret never goes to an MCP server)", () => {
    const mcpOther = fixtureServer({ id: "docs-other", canonicalUri: "https://other.example.com/oauth/token", endpoint: { host: "other.example.com", port: null, path: "/oauth/token" } });
    const pointing = withPin({ issuer: ISSUER, tokenEndpoint: "https://other.example.com/oauth/token" });
    expect(rulesOf([mcpOther, pointing])).toContain("authorization-server");
    expect(rulesOf([pointing, mcpOther]), "whatever the row order").toContain("authorization-server");
    expect(rulesOf([withPin({ issuer: ISSUER, tokenEndpoint: ccServer.canonicalUri })]), "its own endpoint").toContain("authorization-server");
  });

  // [B20 A3 review] regressions-3: the rule compared the two strings exactly, so a terminating slash (or any path under the
  // endpoint, which a prefix router hands to the MCP handler) sent the client secret to an MCP endpoint
  it("nor any spelling at or under an MCP endpoint's path on its origin — a terminating slash, a sub-path — for the row itself or any other, in either order", () => {
    for (const tokenEndpoint of ["https://mcp.example.com/mcp/", "https://mcp.example.com/mcp/token", "https://mcp.example.com/mcp/oauth/token/"]) {
      expect(rulesOf([withPin({ issuer: ISSUER, tokenEndpoint })]), `its own endpoint: ${tokenEndpoint}`).toEqual(["authorization-server"]);
      expect(messagesOf([withPin({ issuer: ISSUER, tokenEndpoint })])).toMatch(/at or under an MCP endpoint/);
    }
    const mcpOther = fixtureServer({ id: "docs-other", canonicalUri: "https://other.example.com/oauth/token", endpoint: { host: "other.example.com", port: null, path: "/oauth/token" } });
    for (const tokenEndpoint of ["https://other.example.com/oauth/token/", "https://other.example.com/oauth/token/v2"]) {
      const pointing = withPin({ issuer: ISSUER, tokenEndpoint });
      expect(rulesOf([mcpOther, pointing]), tokenEndpoint).toEqual(["authorization-server"]);
      expect(rulesOf([pointing, mcpOther]), `${tokenEndpoint}, whatever the row order`).toEqual(["authorization-server"]);
    }
    // another path on an MCP host, a sibling that only shares a prefix, another port and a terminating slash elsewhere are
    // other resources: a server that is its own authorization server stays expressible
    for (const tokenEndpoint of ["https://mcp.example.com/oauth/token", "https://mcp.example.com/mcpx/token", "https://mcp.example.com:8443/mcp/token", "https://auth.example.com/oauth/token/"]) {
      expect(validateMcpServerRegistry([withPin({ issuer: ISSUER, tokenEndpoint })]), tokenEndpoint).toEqual([]);
    }
    // an MCP endpoint at the root: the root is refused as a token endpoint already; every other path is another resource
    const rooted = ccRow("docs-rooted", "rooted.example.com", {}, "/");
    expect(validateMcpServerRegistry([withPin({ issuer: ISSUER, tokenEndpoint: "https://rooted.example.com/oauth/token" }, rooted)])).toEqual([]);
    expect(rulesOf([withPin({ issuer: ISSUER, tokenEndpoint: "https://rooted.example.com/" }, rooted)])).toEqual(["authorization-server"]);
  });

  // [B20 A3 review] security-1: a client-id NAME was never compared with the credential NAMES of other rows, so a row could
  // read another server's access token or client secret as its client id and send it to its own token endpoint
  it("a client-id reference may never name another row's credential — an access token or a client secret — in either row order (shared-secret-reference)", () => {
    const tokenRow = fixtureServer({ id: "vendor-b", auth: { mode: "pre-issued-token-env", secrets: [{ env: "MCP_VENDOR_B_TOKEN", role: "access-token" }], scopes: [] } });
    const reading = (id: string, clientIdEnv: string): McpServerRegistryEntry => {
      const row = ccRow(id, `${id}.example.com`, {}, "/mcp", `MCP_${id.toUpperCase().replace(/-/g, "_")}_SECRET`);
      return { ...row, auth: { ...row.auth, secrets: [{ env: clientIdEnv, role: "client-id" }, row.auth.secrets[1]!] } };
    };
    const readsToken = reading("vendor-a", "MCP_VENDOR_B_TOKEN");
    for (const order of [[tokenRow, readsToken], [readsToken, tokenRow]]) {
      expect(rulesOf(order), order.map((row) => row.id).join(" then ")).toEqual(["shared-secret-reference"]);
      expect(messagesOf(order)).toContain("MCP_VENDOR_B_TOKEN");
      expect(messagesOf(order)).toContain("vendor-b");
    }
    const secretRow = ccRow("vendor-c", "vendor-c.example.com", {}, "/mcp", "MCP_VENDOR_C_SECRET");
    const readsSecret = reading("vendor-d", "MCP_VENDOR_C_SECRET");
    for (const order of [[secretRow, readsSecret], [readsSecret, secretRow]]) expect(rulesOf(order), order.map((row) => row.id).join(" then ")).toEqual(["shared-secret-reference"]);
    // a client id shared by two rows is still a public identifier (A0), and a row's own two NAMES are the duplicate rule's
    expect(validateMcpServerRegistry([ccRow("vendor-e", "vendor-e.example.com", {}, "/mcp", "MCP_VENDOR_E_SECRET"), ccRow("vendor-f", "vendor-f.example.com", {}, "/mcp", "MCP_VENDOR_F_SECRET")])).toEqual([]);
    const selfNaming = reading("vendor-g", "MCP_VENDOR_G_SECRET");
    expect(rulesOf([selfNaming])).toEqual(["secret-reference"]);
  });
});

describe("[B20 A3] the scope ceiling and the page", () => {
  it(`a row names at most ${MCP_SCOPES_MAX} scopes: 32 validate, 33 are refused as scopes`, () => {
    const scopes = (count: number): string[] => Array.from({ length: count }, (_, index) => `docs:s${index}`);
    expect(validateMcpServerRegistry([{ ...ccServer, auth: { ...ccServer.auth, scopes: scopes(32) } }])).toEqual([]);
    expect(rulesOf([{ ...ccServer, auth: { ...ccServer.auth, scopes: scopes(33) } }])).toContain("scopes");
    expect(messagesOf([{ ...ccServer, auth: { ...ccServer.auth, scopes: scopes(1_000_000) } }])).toMatch(/at most 32/);
  });

  it("mcp-server-registry.md names the authorization-server rule and the two cross-row rules", () => {
    const page = readFileSync(resolve(process.cwd(), "artifacts/ai-control-plane-b20/mcp-server-registry.md"), "utf8").replace(/\s+/g, " ");
    expect(page).toContain("`authorization-server`");
    expect(page).toContain("`auth.authorizationServer`");
    expect(page).toContain("rows that share a client-id reference pin the identical issuer");
    // [B20 A3 review] reviewed pin move: the rule is now "at or under an MCP endpoint" (regressions-3), and a client id may not
    // name a credential (security-1)
    expect(page).toContain("no row's `tokenEndpoint` lies at or under any row's MCP endpoint on its origin");
    expect(page).toContain("a client-id reference never names any row's access-token or client-secret reference");
    expect(page).toContain("b20-a3-registry-authorization-pin.test.ts");
  });
});
