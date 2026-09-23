/**
 * [B20 C2] I — Sirkit's own MCP client (the A1 Streamable HTTP transport, `mcpPost`) walking Sirkit's own paged
 * `tools/list` through an in-process transport, exactly as `b20-b2-own-client-interop` does: the real route, the real
 * dispatch, a hand-minted token, the in-memory membership repository, the read-dependency seam, a frozen clock and a
 * global `fetch` that would throw if anything reached it. Nothing here touches a network or a database.
 *
 * At the merge with the client track the lead adds A2's `listMcpTools` walk over the same endpoint (at most 20 pages,
 * cursors of at most 1 024 characters, `cursor_invalid` never raised), as B2 noted at `b20-b2-own-client-interop.ts:8-10`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MCP_TOKEN_SECRET_ENV, __setMcpServerClockForTests, mintMcpAccessToken } from "@/app/lib/auth/mcp-bearer";
import { membershipRevisionOf } from "@/app/lib/auth/project-membership";
import { injectMembership, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { resolveMembershipRepository } from "@/app/lib/auth/identity-runtime";
import { resetAdmissionControl } from "@/app/lib/acquisition/admission-control";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { createDurableBoardReader, readOnlyDurableWorkflow } from "@/app/lib/engineering/durable-read-bundle";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { mcpPost, resetMcpInFlight, type McpPostResult } from "@/app/lib/mcp/http-transport";
import type { McpServerRegistryEntry } from "@/app/lib/mcp/server-registry";
import { fixtureServer } from "@/app/lib/mcp/__tests__/_fixtures";
import { resetMcpInboundLimitsForTests } from "@/app/lib/mcp/server/inbound-limits";
import { membershipReverifier, resetMcpReadStateForTests } from "@/app/lib/mcp/server/read-call";
import { mcpServerTraceRing, resetMcpServerTraceSinkFactory } from "@/app/lib/mcp/server/request-trace";
import { renderMcpToolListing } from "@/app/lib/mcp/server/tool-definitions";
import { __resetMcpToolsListPageSizeForTests, __setMcpToolsListPageSizeForTests, mcpToolsListCursor } from "@/app/lib/mcp/server/tool-pages";
import { resetMcpReadDependenciesFactory, setMcpReadDependenciesFactory } from "../read-runtime";
import { POST } from "../route";

const ORIGIN = "https://mcp.example.com";
const SECRET = ["c2", "fixture", "mcp", "token", "secret", "0123456789abcdef"].join("-");
const T0 = Date.UTC(2026, 8, 22, 12, 0, 0);
const TOKEN_ENV = "SIRKIT_C2_FIXTURE_MCP_ACCESS_TOKEN";
const MAX_RESPONSE_BYTES = 1_000_000; // the fixture row's bound (app/lib/mcp/__tests__/_fixtures.ts)
const PUBLIC = async (): Promise<string[]> => ["93.184.216.34"];
const inProcess: typeof fetch = async (input, init) => POST(new Request(String(input), init));

const row = (): McpServerRegistryEntry => fixtureServer({
  id: "sirkit-self",
  canonicalUri: `${ORIGIN}/api/mcp`,
  endpoint: { host: "mcp.example.com", port: null, path: "/api/mcp" },
  auth: { mode: "pre-issued-token-env", secrets: [{ env: TOKEN_ENV, role: "access-token" }], scopes: ["sirkit.mcp"] },
} as Partial<McpServerRegistryEntry>);

async function mintedToken(): Promise<string> {
  const repo = injectMembership([{ projectId: "proj-mcp", userId: "user-mcp-0001", role: "editor" }]);
  const record = (await repo.loadActiveMembership({ tenantId: "local", projectId: "proj-mcp", userId: "user-mcp-0001" }))!;
  const minted = mintMcpAccessToken({ subject: "user-mcp-0001", tenantId: "local", projectId: "proj-mcp", branchId: "main", membershipRevision: membershipRevisionOf(record) }, { environment: process.env, nowMs: T0 });
  if (!minted.ok) throw new Error(`fixture: ${minted.reason}`);
  return minted.token;
}
function post(method: string, params: Record<string, unknown>, id: number, token: string): Promise<McpPostResult> {
  return mcpPost(row(), { jsonrpc: "2.0", id, method, params }, { purpose: "interactive", deps: { fetch: inProcess, resolve: PUBLIC, clock: () => T0, environment: { [TOKEN_ENV]: token } } });
}
const resultOf = (outcome: McpPostResult): Record<string, unknown> => {
  if (!(outcome.ok && outcome.kind === "complete")) throw new Error(`expected a complete result, got ${outcome.kind}`);
  return outcome.result as unknown as Record<string, unknown>;
};
const editorListing = (): string[] => {
  const registry = sirkitToolRegistry();
  return renderMcpToolListing(registry).tools
    .filter((tool) => registry.get(tool.name, tool._meta["dev.sirkit/toolVersion"])!.requiredRoles.includes("pcb_editor"))
    .map((tool) => tool.name);
};
/** Walk the listing the way a client must: no cursor, then each `nextCursor` until there is none. */
async function clientWalk(token: string, startId = 100): Promise<{ outcomes: McpPostResult[]; names: string[] }> {
  const outcomes: McpPostResult[] = [];
  const names: string[] = [];
  let cursor: string | undefined;
  for (let request = 0; request < 32; request += 1) {
    const outcome = await post("tools/list", cursor === undefined ? {} : { cursor }, startId + request, token);
    outcomes.push(outcome);
    if (!(outcome.ok && outcome.kind === "complete")) break;
    const result = resultOf(outcome);
    names.push(...(result.tools as Array<{ name: string }>).map((tool) => tool.name));
    const next = result.nextCursor;
    if (typeof next !== "string") break;
    cursor = next;
  }
  return { outcomes, names };
}

beforeEach(() => {
  vi.stubEnv("SIRKIT_MCP_ENABLED", "1");
  vi.stubEnv("SIRKIT_EXPECTED_ORIGIN", ORIGIN);
  vi.stubEnv(MCP_TOKEN_SECRET_ENV, SECRET);
  vi.stubEnv("SIRKIT_WORKFLOW_WORKER_SECRET", undefined);
  vi.stubEnv("KICAD_HTTP_LIBRARY_TOKEN", undefined);
  vi.stubEnv("SIRKIT_AUTH_MODE", undefined);
  __setMcpServerClockForTests(() => T0);
  __resetMcpToolsListPageSizeForTests();
  resetMcpInboundLimitsForTests();
  resetAdmissionControl();
  resetMcpInFlight();
  resetMcpServerTraceSinkFactory();
  resetMcpReadStateForTests();
  setMcpReadDependenciesFactory(() => ({ boardReader: createDurableBoardReader(readOnlyDurableWorkflow(new InMemoryDurableWorkflowRepository())), componentAuthority: () => null, membership: membershipReverifier(resolveMembershipRepository), now: () => T0, randomBytes: (size) => new Uint8Array(size) }));
  // S8: no test may reach the real network — the client is handed the in-process transport, and the global would throw
  vi.stubGlobal("fetch", () => { throw new Error("the global fetch was reached in a test"); });
});
afterEach(() => {
  vi.unstubAllGlobals();
  __resetMcpToolsListPageSizeForTests();
  resetMcpReadDependenciesFactory();
  resetMcpReadStateForTests();
  resetMcpServerTraceSinkFactory();
  __setMcpServerClockForTests(null);
  resetInjectedIdentity();
  vi.unstubAllEnvs();
});

describe("[B20 C2] I — Sirkit's own client walks Sirkit's own paged tools/list", () => {
  it("I1. at a page size of 5 the client reassembles the editor's whole listing in ceil(N/5) requests, none refused", async () => {
    const token = await mintedToken();
    expect(__setMcpToolsListPageSizeForTests(5)).toBe(true);
    const expected = editorListing();
    expect(expected).toHaveLength(9); // subset-derived (B4 withheld the five proposals)
    const { outcomes, names } = await clientWalk(token);
    expect(outcomes).toHaveLength(Math.ceil(expected.length / 5));
    expect(outcomes).toHaveLength(2);
    for (const outcome of outcomes) {
      expect(outcome.ok, JSON.stringify(outcome).slice(0, 200)).toBe(true);
      expect(outcome.kind).toBe("complete");
      const result = resultOf(outcome);
      expect(result).toMatchObject({ resultType: "complete", ttlMs: 60_000, cacheScope: "private" });
      expect(JSON.stringify(result).length).toBeLessThanOrEqual(MAX_RESPONSE_BYTES);
    }
    expect(outcomes.filter((outcome) => !outcome.ok && outcome.kind === "error")).toEqual([]);
    expect(names).toEqual(expected);
    // the first page carries a cursor, the last none
    expect(typeof resultOf(outcomes[0]!).nextCursor).toBe("string");
    expect(Object.hasOwn(resultOf(outcomes.at(-1)!), "nextCursor")).toBe(false);
  });

  it("I2. at the production page size the whole listing is one page with no nextCursor", async () => {
    const token = await mintedToken();
    const { outcomes, names } = await clientWalk(token, 200);
    expect(outcomes).toHaveLength(1);
    expect(names).toEqual(editorListing());
    expect(Object.hasOwn(resultOf(outcomes[0]!), "nextCursor")).toBe(false);
  });

  it("I3. a cursor replayed after the page size changed is refused over the wire, and a fresh walk then succeeds", async () => {
    const token = await mintedToken();
    expect(__setMcpToolsListPageSizeForTests(5)).toBe(true);
    const first = resultOf(await post("tools/list", {}, 300, token));
    const cursor = first.nextCursor as string;
    expect(typeof cursor).toBe("string");
    expect(__setMcpToolsListPageSizeForTests(3)).toBe(true);
    const replayed = await post("tools/list", { cursor }, 301, token);
    expect(replayed.ok).toBe(false);
    expect(replayed).toMatchObject({ kind: "error", code: -32602, httpStatus: 200 });
    const { outcomes, names } = await clientWalk(token, 310);
    expect(outcomes).toHaveLength(3);
    expect(names).toEqual(editorListing());
  });

  it("I4. a hostile cursor value never appears in the response or in the trace ring", async () => {
    const token = await mintedToken();
    const bidi = String.fromCharCode(0x202e);
    const secretShaped = ["sk", "live", "0123456789abcdefghijklmn"].join("_");
    const hostile = [
      `tl1-${"f".repeat(16)}`,
      `${bidi}cursor-with-a-bidirectional-override`,
      secretShaped,
      token,
      mcpToolsListCursor("eng1-0000000000000000", 32, 32),
      "x".repeat(8_192), // well under the route's 65 536-byte body cap
    ];
    for (const cursor of hostile) {
      const outcome = await post("tools/list", { cursor }, 400, token);
      expect(outcome.ok, cursor.slice(0, 24)).toBe(false);
      expect(outcome, cursor.slice(0, 24)).toMatchObject({ kind: "error", code: -32602, httpStatus: 200 });
      const rendered = JSON.stringify(outcome);
      expect(rendered.includes(cursor.slice(0, 24)), cursor.slice(0, 24)).toBe(false);
      expect(JSON.stringify(mcpServerTraceRing()).includes(cursor.slice(0, 24)), cursor.slice(0, 24)).toBe(false);
      expect(mcpServerTraceRing().at(-1)?.outcome, cursor.slice(0, 24)).toBe("cursor_refused");
      expect(mcpServerTraceRing().at(-1)?.listingDigest, cursor.slice(0, 24)).toBeNull();
    }
  });
});
