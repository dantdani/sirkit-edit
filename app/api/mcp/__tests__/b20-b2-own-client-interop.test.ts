/**
 * [B20 B2] Sirkit's own MCP client (the A1 Streamable HTTP transport, `mcpPost`) talking to Sirkit's own MCP endpoint through
 * an in-process transport — `(input, init) => POST(new Request(String(input), init))` — and the public-address resolver. The
 * fixture row names `https://mcp.example.com/api/mcp`. The client's requests are what the server expects (integer ids, both
 * version headers, `Mcp-Method`, `Mcp-Name`, `clientCapabilities: {}`), so none is ever refused with -32020, -32022 or
 * -32602, and an `auth: none` row meets the Bearer challenge that names the metadata URL and the one scope.
 *
 * A2's `discoverMcpServer` / `listMcpTools` are not on this branch (chapter/b20-mcp-server is based on B1, 77125bd); these
 * cases therefore check the DiscoverResult and tools/list shapes those functions validate (supportedVersions, the tools
 * capability, ttlMs, cacheScope) over the transport directly, and the lead adds the two A2 calls when the branches meet.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MCP_TOKEN_SECRET_ENV, __setMcpServerClockForTests, mintMcpAccessToken } from "@/app/lib/auth/mcp-bearer";
import { membershipRevisionOf } from "@/app/lib/auth/project-membership";
import { injectMembership, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { resetAdmissionControl } from "@/app/lib/acquisition/admission-control";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { mcpPost, resetMcpInFlight, type McpPostResult } from "@/app/lib/mcp/http-transport";
import type { McpServerRegistryEntry } from "@/app/lib/mcp/server-registry";
import { fixtureServer } from "@/app/lib/mcp/__tests__/_fixtures";
import { resetMcpInboundLimitsForTests } from "@/app/lib/mcp/server/inbound-limits";
import { renderMcpToolListing } from "@/app/lib/mcp/server/tool-definitions";
import { resolveMembershipRepository } from "@/app/lib/auth/identity-runtime";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { createDurableBoardReader, readOnlyDurableWorkflow } from "@/app/lib/engineering/durable-read-bundle";
import { membershipReverifier, resetMcpReadStateForTests } from "@/app/lib/mcp/server/read-call";
import { resetMcpReadDependenciesFactory, setMcpReadDependenciesFactory } from "../read-runtime";
import { POST } from "../route";

const ORIGIN = "https://mcp.example.com";
const SECRET = ["b2", "fixture", "mcp", "token", "secret", "0123456789abcdef"].join("-");
const T0 = Date.UTC(2026, 8, 20, 12, 0, 0);
const TOKEN_ENV = "SIRKIT_B2_FIXTURE_MCP_ACCESS_TOKEN";
const PUBLIC = async (): Promise<string[]> => ["93.184.216.34"];
const inProcess: typeof fetch = async (input, init) => POST(new Request(String(input), init));

function row(auth: "none" | "pre-issued-token-env"): McpServerRegistryEntry {
  return fixtureServer({
    id: "sirkit-self",
    canonicalUri: `${ORIGIN}/api/mcp`,
    endpoint: { host: "mcp.example.com", port: null, path: "/api/mcp" },
    auth: auth === "none" ? { mode: "none", secrets: [], scopes: [] } : { mode: "pre-issued-token-env", secrets: [{ env: TOKEN_ENV, role: "access-token" }], scopes: ["sirkit.mcp"] },
  } as Partial<McpServerRegistryEntry>);
}
async function mintedToken(): Promise<string> {
  const repo = injectMembership([{ projectId: "proj-mcp", userId: "user-mcp-0001", role: "editor" }]);
  const record = (await repo.loadActiveMembership({ tenantId: "local", projectId: "proj-mcp", userId: "user-mcp-0001" }))!;
  const minted = mintMcpAccessToken({ subject: "user-mcp-0001", tenantId: "local", projectId: "proj-mcp", branchId: "main", membershipRevision: membershipRevisionOf(record) }, { environment: process.env, nowMs: T0 });
  if (!minted.ok) throw new Error(`fixture: ${minted.reason}`);
  return minted.token;
}
function post(server: McpServerRegistryEntry, method: string, params: Record<string, unknown>, id: number, token: string | null): Promise<McpPostResult> {
  return mcpPost(server, { jsonrpc: "2.0", id, method, params }, { purpose: "interactive", deps: { fetch: inProcess, resolve: PUBLIC, clock: () => T0, environment: token === null ? {} : { [TOKEN_ENV]: token } } });
}

beforeEach(() => {
  vi.stubEnv("SIRKIT_MCP_ENABLED", "1");
  vi.stubEnv("SIRKIT_EXPECTED_ORIGIN", ORIGIN);
  vi.stubEnv(MCP_TOKEN_SECRET_ENV, SECRET);
  vi.stubEnv("SIRKIT_WORKFLOW_WORKER_SECRET", undefined);
  vi.stubEnv("KICAD_HTTP_LIBRARY_TOKEN", undefined);
  vi.stubEnv("SIRKIT_AUTH_MODE", undefined);
  __setMcpServerClockForTests(() => T0);
  resetMcpInboundLimitsForTests();
  resetAdmissionControl();
  resetMcpInFlight();
  // [B20 B3] the read-dependency seam: a listed read is served from an empty in-memory durable repository (never a database)
  resetMcpReadStateForTests();
  setMcpReadDependenciesFactory(() => ({ boardReader: createDurableBoardReader(readOnlyDurableWorkflow(new InMemoryDurableWorkflowRepository())), componentAuthority: () => null, membership: membershipReverifier(resolveMembershipRepository), now: () => T0, randomBytes: (size) => new Uint8Array(size) }));
});
afterEach(() => { resetMcpReadDependenciesFactory(); resetMcpReadStateForTests(); __setMcpServerClockForTests(null); resetInjectedIdentity(); vi.unstubAllEnvs(); });

describe("[B20 B2] H — Sirkit's own client against Sirkit's own endpoint", () => {
  it("1. a pre-issued-token-env row whose referenced environment name holds a run-time token negotiates 2026-07-28 and sees the tools capability", async () => {
    const token = await mintedToken();
    const result = await post(row("pre-issued-token-env"), "server/discover", {}, 1, token);
    expect(result).toMatchObject({ ok: true, kind: "complete", protocolVersion: "2026-07-28", method: "server/discover" });
    if (!(result.ok && result.kind === "complete")) return;
    const body = result.result as Record<string, unknown>;
    expect(body.supportedVersions).toEqual(["2026-07-28"]);
    expect(body.capabilities).toEqual({ tools: { listChanged: false } });
    expect(body).toMatchObject({ resultType: "complete", ttlMs: 60_000, cacheScope: "public" });
  });

  it("2. an auth none row gets the client's unauthorized outcome, with the metadata URL and the scope sirkit.mcp", async () => {
    const result = await post(row("none"), "server/discover", {}, 1, null);
    expect(result).toMatchObject({ ok: false, kind: "unauthorized", httpStatus: 401 });
    if (result.kind !== "unauthorized") return;
    expect(result.challenge).toMatchObject({ scheme: "Bearer", resourceMetadata: `${ORIGIN}/.well-known/oauth-protected-resource/api/mcp`, scope: ["sirkit.mcp"] });
    expect(result.challenge?.error).toBeUndefined();
  });

  it("3. tools/list on the pre-issued row is complete; the tools are the editor's subset of B1's rendering, every name in the reserved sirkit. namespace", async () => {
    const token = await mintedToken();
    const result = await post(row("pre-issued-token-env"), "tools/list", {}, 2, token);
    expect(result).toMatchObject({ ok: true, kind: "complete" });
    if (!(result.ok && result.kind === "complete")) return;
    const listing = result.result as Record<string, unknown>;
    const registry = sirkitToolRegistry();
    const expected = renderMcpToolListing(registry).tools.filter((tool) => registry.get(tool.name, tool._meta["dev.sirkit/toolVersion"])!.requiredRoles.includes("pcb_editor"));
    expect((listing.tools as Array<{ name: string }>).map((tool) => tool.name)).toEqual(expected.map((tool) => tool.name));
    expect(listing).toMatchObject({ resultType: "complete", ttlMs: 60_000, cacheScope: "private" });
    // A2's acceptForeignTools refuses names prefixed sirkit. (reserved_namespace): Sirkit's own client would keep none of them
    expect((listing.tools as Array<{ name: string }>).every((tool) => tool.name.startsWith("sirkit."))).toBe(true);
  });

  it("4. the client's requests never trigger -32020, -32022 or -32602; a listed tools/call answers a closed tool refusal", async () => {
    const token = await mintedToken();
    const server = row("pre-issued-token-env");
    // [B20 B3] pin move: B3 serves the listed reads, so the not_served answer is a listed PROPOSAL's (B4 decides those)
    // [B20 B4] pin move (OD-82, OD-87): no proposal is listed since B4, so the listed call is the revision read, which needs no
    // pin and answers the closed refusal no_durable_board from the empty in-memory durable repository
    const listed = "sirkit.project.canonical-revision-inspect";
    expect(renderMcpToolListing(sirkitToolRegistry()).tools.map((tool) => tool.name)).toContain(listed);
    const results = [
      await post(server, "server/discover", {}, 11, token),
      await post(server, "tools/list", {}, 12, token),
      await post(server, "tools/call", { name: listed, arguments: {} }, 13, token),
    ];
    for (const result of results) {
      expect(result.ok, JSON.stringify(result).slice(0, 200)).toBe(true);
      expect(result.kind).toBe("complete");
    }
    const call = results[2]!;
    if (!(call.ok && call.kind === "complete")) return;
    const answer = call.result as Record<string, unknown>;
    expect(answer).toMatchObject({ resultType: "complete", isError: true, _meta: { "dev.sirkit/refusal": "no_durable_board" } });
  });
});
