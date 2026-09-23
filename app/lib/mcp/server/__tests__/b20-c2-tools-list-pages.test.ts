/**
 * [B20 C2] G — the pagination, caching hints and listing identity of `tools/list` (D20-14 pagination half; OD-97, OD-98).
 * MCP 2026-07-28: an opaque cursor the client must not parse, a server-decided page size, an OPTIONAL `nextCursor`, an
 * invalid cursor answered `-32602`, and `ttlMs` plus one `cacheScope` on every page of a list request.
 *
 * The cursor carries no secret and no server state: the server recomputes the cursors it would mint for the caller's
 * current served listing and page size and accepts a presented value only by exact equality with one of them. Nothing a
 * peer wrote is hashed, normalized, traced or echoed, and a malformed cursor is decided on its SHAPE before the listing is
 * ever computed. Every dispatch assertion goes through `handleMcpRequest`; nothing here reaches a network or a database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpBearerJsonInput } from "@/app/lib/auth/route-handlers";
import type { McpBearerContext, McpRequestHeaders } from "@/app/lib/auth/mcp-bearer";
import type { MembershipRole } from "@/app/lib/auth/project-membership";
import { collectProductionFiles } from "@/app/lib/project/__tests__/_import-gate-helpers";
import { engineeringDigest } from "@/app/lib/engineering/stable";
import { SIRKIT_TOOL_CATALOG, sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { ToolRegistry, type ToolDescriptor } from "@/app/lib/engineering/tool-registry";
import { handleMcpRequest } from "../dispatch";
import { MCP_CACHE_TTL_MS, MCP_JSON_RPC_MESSAGES } from "../protocol";
import { mcpServerTraceRing, resetMcpServerTraceSinkFactory } from "../request-trace";
import { MCP_TOOL_LISTING_SCHEMA, renderMcpToolListing } from "../tool-definitions";
import {
  MCP_TOOLS_LIST_CURSOR_CHARS,
  MCP_TOOLS_LIST_CURSOR_PATTERN,
  MCP_TOOLS_LIST_CURSOR_SCHEMA,
  MCP_TOOLS_LIST_PAGE_SIZE,
  MCP_TOOLS_LIST_PAGE_SIZE_BOUNDS,
  __resetMcpToolsListPageSizeForTests,
  __setMcpToolsListPageSizeForTests,
  mcpToolsListCursor,
  mcpToolsListCursorWellFormed,
  mcpToolsListPage,
  mcpToolsListPageSize,
  validateMcpToolsListPageSize,
} from "../tool-pages";
import { ROLE_OF, harnessPrincipal, listingDigestFor, membershipRepo } from "./_read-harness";

const ROOT = process.cwd();
const V = "2026-07-28";
const META = { "io.modelcontextprotocol/protocolVersion": V, "io.modelcontextprotocol/clientCapabilities": {} };
const HOSTILE_SIZES = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 0, 1.5, 129, 2 ** 53, "8", null];
const registry = sirkitToolRegistry();
const EDITOR_ROLE = ROLE_OF.editor;

const headersFor = (method: string): McpRequestHeaders => ({
  protocolVersion: { state: "present", value: V },
  method: { state: "present", value: method },
  name: { state: "absent" },
  paramHeaderCount: 0,
});
async function principalFor(role: MembershipRole = "editor"): Promise<McpBearerContext> {
  return harnessPrincipal(membershipRepo(role));
}
/** One authenticated tools/list through the real dispatch; the raw body text is what a client would receive. */
async function list(principal: McpBearerContext, params: Record<string, unknown> = {}, deps: { registry?: ToolRegistry } = {}): Promise<{ status: number; text: string; body: Record<string, unknown> }> {
  const input = {
    principal, bytes: 0, meta: {}, signal: new AbortController().signal,
    mcp: headersFor("tools/list"),
    message: { jsonrpc: "2.0", id: 1, method: "tools/list", params: { ...params, _meta: META } },
  } as unknown as McpBearerJsonInput;
  const response = await handleMcpRequest(input, { registry: deps.registry ?? registry, reads: null });
  const text = await response.text();
  return { status: response.status, text, body: JSON.parse(text) as Record<string, unknown> };
}
const resultOf = (body: Record<string, unknown>): Record<string, unknown> => body.result as Record<string, unknown>;
const namesOf = (body: Record<string, unknown>): string[] => (resultOf(body).tools as Array<{ name: string }>).map((tool) => tool.name);
/** The served listing of a role, exactly as the dispatch computes it (B1's listing filtered by requiredRoles). */
const servedFor = (role: string, source: ToolRegistry = registry): Array<{ name: string }> =>
  renderMcpToolListing(source).tools.filter((tool) => source.get(tool.name, tool._meta["dev.sirkit/toolVersion"])!.requiredRoles.includes(role as never)) as Array<{ name: string }>;
/** Walk every page from no cursor, returning each page's parsed body. */
async function walk(principal: McpBearerContext, deps: { registry?: ToolRegistry } = {}): Promise<Array<Record<string, unknown>>> {
  const pages: Array<Record<string, unknown>> = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 64; guard += 1) {
    const { body } = await list(principal, cursor === undefined ? {} : { cursor }, deps);
    pages.push(body);
    const next = resultOf(body).nextCursor;
    if (typeof next !== "string") break;
    cursor = next;
  }
  return pages;
}
/** A registry double: only `list`, `digest` and `get` are read by the listing and the dispatch. */
const doubleOf = (list: () => ToolDescriptor[]): ToolRegistry => ({
  list, digest: () => registry.digest(), get: (toolId: string, version?: string) => registry.get(toolId, version),
} as unknown as ToolRegistry);
/** A registry whose MCP listing refuses (an agent-exposed read nobody reviewed: exposure_drift). */
const refusingRegistry = (): ToolRegistry =>
  new ToolRegistry([...SIRKIT_TOOL_CATALOG, { ...registry.get("sirkit.pcb.board-inspect")!, toolId: "sirkit.pcb.extra-inspect" } as ToolDescriptor]);

beforeEach(() => { __resetMcpToolsListPageSizeForTests(); resetMcpServerTraceSinkFactory(); });
afterEach(() => { __resetMcpToolsListPageSizeForTests(); resetMcpServerTraceSinkFactory(); vi.restoreAllMocks(); });

describe("[B20 C2] G — tools/list pages, caching hints and listing identity", () => {
  it("G1. the page size is 32, the reviewed bounds are [1, 128], and the test hook refuses every value outside them", () => {
    expect(MCP_TOOLS_LIST_PAGE_SIZE).toBe(32);
    expect([...MCP_TOOLS_LIST_PAGE_SIZE_BOUNDS]).toEqual([1, 128]);
    expect(mcpToolsListPageSize()).toBe(32);
    for (const size of [1, 32, 128]) {
      expect(validateMcpToolsListPageSize(size), String(size)).toEqual([]);
      expect(__setMcpToolsListPageSizeForTests(size), String(size)).toBe(true);
      expect(mcpToolsListPageSize(), String(size)).toBe(size);
    }
    __resetMcpToolsListPageSizeForTests();
    for (const size of HOSTILE_SIZES) {
      expect(validateMcpToolsListPageSize(size).length, String(size)).toBeGreaterThan(0);
      expect(__setMcpToolsListPageSizeForTests(size), String(size)).toBe(false);
      expect(mcpToolsListPageSize(), String(size)).toBe(32);
    }
  });

  it("G2. at every page size the pages partition the served listing exactly: no duplicate, no gap, no nextCursor on the last page", async () => {
    const principal = await principalFor("editor");
    const served = servedFor(EDITOR_ROLE).map((tool) => tool.name);
    const count = served.length;
    expect(count).toBe(9); // subset-derived (B4 withheld the five proposals)
    for (const size of [1, 3, 8, count - 1, count, count + 1, 32]) {
      expect(__setMcpToolsListPageSizeForTests(size), String(size)).toBe(true);
      const pages = await walk(principal);
      expect(pages.length, `size ${size}`).toBe(Math.ceil(count / size));
      for (const page of pages) expect(namesOf(page).length, `size ${size}`).toBeLessThanOrEqual(size);
      const reassembled = pages.flatMap(namesOf);
      expect(reassembled, `size ${size}`).toEqual(served);
      expect(new Set(reassembled).size, `size ${size}`).toBe(count);
      for (const page of pages.slice(0, -1)) expect(typeof resultOf(page).nextCursor, `size ${size}`).toBe("string");
      expect(Object.hasOwn(resultOf(pages.at(-1)!), "nextCursor"), `size ${size}`).toBe(false);
    }
  });

  it("G3. every minted cursor is 20 characters of the recomputed formula, deterministic and distinct per offset", async () => {
    const principal = await principalFor("editor");
    const digest = listingDigestFor(registry, EDITOR_ROLE);
    expect(String(MCP_TOOLS_LIST_CURSOR_PATTERN)).toBe(String(/^tl1-[0-9a-f]{16}$/));
    expect(MCP_TOOLS_LIST_CURSOR_CHARS).toBe(20);
    expect(MCP_TOOLS_LIST_CURSOR_SCHEMA).toBe("sirkit.mcp-tools-list-cursor.v1");
    __setMcpToolsListPageSizeForTests(2);
    const pages = await walk(principal);
    const cursors = pages.map((page) => resultOf(page).nextCursor).filter((value): value is string => typeof value === "string");
    expect(cursors.length).toBe(pages.length - 1);
    expect(new Set(cursors).size).toBe(cursors.length);
    cursors.forEach((cursor, index) => {
      expect(cursor.length).toBe(20);
      expect(cursor).toMatch(MCP_TOOLS_LIST_CURSOR_PATTERN);
      expect(mcpToolsListCursorWellFormed(cursor)).toBe(true);
      // the formula, recomputed independently in the test
      expect(cursor).toBe(`tl1-${engineeringDigest({ schema: "sirkit.mcp-tools-list-cursor.v1", listingDigest: digest, pageSize: 2, offset: 2 * (index + 1) }).slice(5)}`);
      expect(cursor).toBe(mcpToolsListCursor(digest, 2, 2 * (index + 1)));
    });
  });

  it("G4. every page carries resultType complete, ttlMs 60 000, cacheScope private and exactly the three _meta keys, with the WHOLE listing's digest", async () => {
    const principal = await principalFor("editor");
    const digest = listingDigestFor(registry, EDITOR_ROLE);
    __setMcpToolsListPageSizeForTests(2);
    const pages = await walk(principal);
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      const result = resultOf(page);
      expect(result.resultType).toBe("complete");
      expect(result.ttlMs).toBe(MCP_CACHE_TTL_MS);
      expect(MCP_CACHE_TTL_MS).toBe(60_000);
      expect(result.cacheScope).toBe("private");
      const meta = result._meta as Record<string, unknown>;
      expect(Object.keys(meta).sort()).toEqual(["dev.sirkit/listingDigest", "dev.sirkit/registryDigest", "io.modelcontextprotocol/serverInfo"]);
      expect(meta["dev.sirkit/registryDigest"]).toBe(registry.digest());
      expect(meta["dev.sirkit/listingDigest"]).toBe(digest);
    }
    // the identity is the WHOLE served listing's, not the page's (mutation: a per-page digest fails here)
    expect(new Set(pages.map((page) => (resultOf(page)._meta as Record<string, unknown>)["dev.sirkit/listingDigest"])).size).toBe(1);
    expect(digest).toBe(engineeringDigest({ schema: MCP_TOOL_LISTING_SCHEMA, registryDigest: registry.digest(), tools: servedFor(EDITOR_ROLE) }));
  });

  it("G5. a cursor this server would not mint is one identical 200 -32602 that echoes nothing, and an oversized value never reaches a regex", async () => {
    const principal = await principalFor("editor");
    const viewer = await principalFor("commenter");
    __setMcpToolsListPageSizeForTests(3);
    const minted = mcpToolsListCursor(listingDigestFor(registry, EDITOR_ROLE), 3, 3);
    const mintedAtEight = mcpToolsListCursor(listingDigestFor(registry, EDITOR_ROLE), 8, 8);
    const otherRegistry = new ToolRegistry(SIRKIT_TOOL_CATALOG.map((item) => (item.toolId === "sirkit.pcb.board-inspect" ? ({ ...item, description: `${item.description} (drifted)` } as ToolDescriptor) : item)));
    const otherRegistryCursor = mcpToolsListCursor(listingDigestFor(otherRegistry, EDITOR_ROLE), 3, 3);
    const otherRoleCursor = mcpToolsListCursor(listingDigestFor(registry, ROLE_OF.commenter), 3, 3);
    const bearer = ["mcp", "fixture", "access", "token", "0123456789abcdef"].join("-"); // an obvious runtime-assembled fake
    const long = "z".repeat(100_000);
    const hostile: ReadonlyArray<readonly [string, unknown]> = [
      ["the empty string", ""], ["a word", "next"], ["a number", 5], ["null", null], ["an object", {}], ["an array", []], ["true", true],
      ["a well-formed cursor nobody minted", `tl1-${"0123456789abcdef"}`],
      ["a cursor minted at another page size", mintedAtEight],
      ["a cursor for another registry", otherRegistryCursor],
      ["another role's cursor", otherRoleCursor],
      ["a bearer-token-shaped value", bearer], ["the same, upper-cased", bearer.toUpperCase()],
      ["a valid cursor upper-cased", minted.toUpperCase()], ["a valid cursor with a trailing space", `${minted} `],
      ["a 100 000-character string", long],
    ];
    expect(mcpToolsListCursorWellFormed(minted)).toBe(true);
    expect(otherRegistryCursor).not.toBe(minted);
    expect(otherRoleCursor).not.toBe(minted);
    for (const [label, cursor] of hostile) {
      const { status, text, body } = await list(principal, { cursor });
      expect(status, label).toBe(200);
      expect(body, label).toEqual({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: MCP_JSON_RPC_MESSAGES.INVALID_CURSOR } });
      expect(Object.hasOwn(body.error as object, "data"), label).toBe(false);
      const record = mcpServerTraceRing().at(-1)!;
      // a distinctive value is nowhere in the body or the ring; a short one (5, true, "") could not be told from the
      // record's own numbers, so the record's SHAPE carries the claim instead: it has no field for a peer's cursor
      if (typeof cursor === "string" && cursor.length >= 8) {
        expect(text.includes(cursor.slice(0, 24)), label).toBe(false);
        expect(JSON.stringify(record).includes(cursor.slice(0, 24)), label).toBe(false);
      }
      expect(Object.keys(record).some((key) => key.toLowerCase().includes("cursor")), label).toBe(false);
      expect(record.outcome, label).toBe("cursor_refused");
      expect(record.listingDigest, label).toBeNull();
    }
    // the minted one still works, for the same caller, at the same size
    expect(namesOf((await list(principal, { cursor: minted })).body)).toEqual(servedFor(EDITOR_ROLE).map((tool) => tool.name).slice(3, 6));
    // DIRECT: the oversized value never reaches a regex or a case fold — its LENGTH is judged first (S5). The listing and
    // its digest are computed BEFORE the spies, so only the paging call is observed.
    const source = { tools: servedFor(EDITOR_ROLE), listingDigest: listingDigestFor(registry, EDITOR_ROLE) };
    const testSpy = vi.spyOn(RegExp.prototype, "test");
    const execSpy = vi.spyOn(RegExp.prototype, "exec");
    const lowerSpy = vi.spyOn(String.prototype, "toLowerCase");
    let direct: unknown;
    let counts = { test: -1, exec: -1, lower: -1 };
    try {
      direct = mcpToolsListPage(source, { present: true, value: long }, 3);
      // the counts are read and the spies dropped BEFORE any assertion: the framework's own formatting uses regexes too
      counts = { test: testSpy.mock.calls.length, exec: execSpy.mock.calls.length, lower: lowerSpy.mock.calls.length };
    } finally {
      testSpy.mockRestore(); execSpy.mockRestore(); lowerSpy.mockRestore();
    }
    expect(direct).toEqual({ kind: "invalid_cursor" });
    expect(counts).toEqual({ test: 0, exec: 0, lower: 0 });
    // THROUGH DISPATCH: request validation legitimately runs regexes, but never over the peer's cursor
    const seen: unknown[] = [];
    const throughTest = vi.spyOn(RegExp.prototype, "test").mockImplementation(function (this: RegExp, value: string) {
      seen.push(value);
      return RegExp.prototype.exec.call(this, value) !== null;
    });
    try {
      await list(viewer, { cursor: long });
    } finally {
      throughTest.mockRestore();
    }
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.filter((value) => typeof value === "string" && value.length > 256)).toEqual([]);
    expect(seen).not.toContain(long);
  });

  it("G6. no cursor is ever minted for offset 0, a non-multiple offset or the count, and a crafted one for any of them is refused", async () => {
    const principal = await principalFor("editor");
    const digest = listingDigestFor(registry, EDITOR_ROLE);
    const count = servedFor(EDITOR_ROLE).length;
    __setMcpToolsListPageSizeForTests(3);
    const minted = new Set((await walk(principal)).map((page) => resultOf(page).nextCursor).filter((value): value is string => typeof value === "string"));
    for (const offset of [0, 1, count, count + 3]) {
      const crafted = mcpToolsListCursor(digest, 3, offset);
      expect(mcpToolsListCursorWellFormed(crafted), String(offset)).toBe(true);
      expect(minted.has(crafted), String(offset)).toBe(false);
      const { status, body } = await list(principal, { cursor: crafted });
      expect(status, String(offset)).toBe(200);
      expect((body.error as Record<string, unknown>).code, String(offset)).toBe(-32602);
    }
    expect([...minted]).toEqual([3, 6].map((offset) => mcpToolsListCursor(digest, 3, offset)));
  });

  it("G7. at the production page size the editor's listing is one page whose bytes are B2's pre-C2 answer, with no nextCursor key", async () => {
    const principal = await principalFor("editor");
    const { status, text, body } = await list(principal);
    expect(status).toBe(200);
    expect(Object.hasOwn(resultOf(body), "nextCursor")).toBe(false);
    expect(namesOf(body)).toHaveLength(9);
    // the pre-C2 body, written out in B2's key order: any inserted key, reordering or added nextCursor moves these bytes
    const expected = {
      jsonrpc: "2.0",
      id: 1,
      result: {
        resultType: "complete",
        tools: servedFor(EDITOR_ROLE),
        ttlMs: 60_000,
        cacheScope: "private",
        _meta: {
          "io.modelcontextprotocol/serverInfo": { name: "sirkit", version: "0.1.0" },
          "dev.sirkit/registryDigest": registry.digest(),
          "dev.sirkit/listingDigest": listingDigestFor(registry, EDITOR_ROLE),
        },
      },
    };
    expect(text).toBe(JSON.stringify(expected));
  });

  it("G8. roles whose served listings are equal share their cursors; a role whose listing differs gets disjoint ones", async () => {
    const editor = await principalFor("editor");
    const viewer = await principalFor("viewer");
    const commenter = await principalFor("commenter");
    __setMcpToolsListPageSizeForTests(3);
    expect(servedFor(ROLE_OF.viewer).map((tool) => tool.name)).toEqual(servedFor(EDITOR_ROLE).map((tool) => tool.name));
    expect(servedFor(ROLE_OF.commenter).map((tool) => tool.name)).not.toEqual(servedFor(EDITOR_ROLE).map((tool) => tool.name));
    const editorNext = resultOf((await list(editor)).body).nextCursor as string;
    const viewerNext = resultOf((await list(viewer)).body).nextCursor as string;
    const commenterNext = resultOf((await list(commenter)).body).nextCursor as string;
    // DOCUMENTED: the cursor binds the listing, not the principal — equal listings are interchangeable by construction
    expect(viewerNext).toBe(editorNext);
    expect(namesOf((await list(viewer, { cursor: editorNext })).body)).toEqual(namesOf((await list(editor, { cursor: editorNext })).body));
    expect(commenterNext).not.toBe(editorNext);
    expect((await list(commenter, { cursor: editorNext })).body.error).toMatchObject({ code: -32602 });
    expect((await list(editor, { cursor: commenterNext })).body.error).toMatchObject({ code: -32602 });
  });

  it("G9. an unreadable listing or an invalid size is internal, never a throw and never a partial page", async () => {
    const served = { tools: servedFor(EDITOR_ROLE), listingDigest: listingDigestFor(registry, EDITOR_ROLE) };
    const internals: ReadonlyArray<readonly [string, () => unknown]> = [
      ["a null listing", () => mcpToolsListPage(null as never, { present: false }, 3)],
      ["non-array tools", () => mcpToolsListPage({ tools: "nine" as never, listingDigest: served.listingDigest }, { present: false }, 3)],
      ["a missing digest", () => mcpToolsListPage({ tools: served.tools, listingDigest: null }, { present: false }, 3)],
      ["an empty digest", () => mcpToolsListPage({ tools: served.tools, listingDigest: "" }, { present: false }, 3)],
      ["an invalid size", () => mcpToolsListPage(served, { present: false }, 0)],
      ["a non-integer size", () => mcpToolsListPage(served, { present: false }, 1.5)],
      ["a throwing tools getter", () => mcpToolsListPage(Object.defineProperty({ listingDigest: served.listingDigest }, "tools", { get() { throw new Error("hostile"); } }) as never, { present: false }, 3)],
    ];
    for (const [label, call] of internals) {
      expect(call, label).not.toThrow();
      expect(call(), label).toEqual({ kind: "internal" });
    }
    // RECORDED [B20 C review]: through the dispatch the `internal` page is UNREACHABLE, and this is exactly what makes it
    // so — `mcpToolsListPage` is called from ONE production site, with three inputs that can only be well formed: the
    // served listing's `tools` (always an array, it comes from Array.prototype.filter), its `listingDigest` (always the
    // digest helper's non-empty `eng1-` string) and `mcpToolsListPageSize()` (always inside the reviewed bounds — the test
    // hook refuses everything else, G1). The branch stays as defence, and its THROW is mapped to the 500 -32603 that G12
    // proves with a real throw (a refusing listing), so nothing here is left unproven.
    const source = collectProductionFiles(ROOT);
    const callers = [...source].filter(([path, text]) => path !== "app/lib/mcp/server/tool-pages.ts" && /\bmcpToolsListPage\(/.test(text)).map(([path]) => path);
    expect(callers).toEqual(["app/lib/mcp/server/dispatch.ts"]);
    expect(source.get("app/lib/mcp/server/dispatch.ts")).toContain("const page = mcpToolsListPage(served, cursor, size);");
    expect(source.get("app/lib/mcp/server/dispatch.ts")).toContain(`if (page.kind === "internal") throw new Error("MCP_TOOLS_LIST_PAGE_INTERNAL");`);
    expect(source.get("app/lib/mcp/server/dispatch.ts")).toContain("const size = mcpToolsListPageSize();");
    for (const role of Object.values(ROLE_OF)) {
      const tools = servedFor(role);
      expect(Array.isArray(tools), role).toBe(true);
      expect(listingDigestFor(registry, role), role).toMatch(/^eng1-[0-9a-f]{16}$/);
      expect(mcpToolsListPage({ tools, listingDigest: listingDigestFor(registry, role) }, { present: false }, mcpToolsListPageSize()).kind, role).toBe("page");
    }
    expect(validateMcpToolsListPageSize(mcpToolsListPageSize())).toEqual([]);
    // the 500 -32603 the dispatch answers for a broken listing is the LISTING refusal, never this branch: it is answered
    // before `mcpToolsListPage` is ever called (G12 pins the same answer for a registry whose listing refuses)
    const principal = await principalFor("editor");
    const empty = doubleOf(() => []);
    expect(() => renderMcpToolListing(empty)).toThrow(); // the listing refuses first: exposure drift, nine ids missing
    const { status, body } = await list(principal, {}, { registry: empty });
    expect(status).toBe(500);
    expect((body.error as Record<string, unknown>).code).toBe(-32603);
    expect(mcpServerTraceRing().at(-1)?.outcome).toBe("internal_error");
  });

  it("G10. tool-pages.ts is pure: the digest helper and nothing else, no I/O, clock, randomness or environment", () => {
    const source = collectProductionFiles(ROOT).get("app/lib/mcp/server/tool-pages.ts");
    expect(source, "tool-pages.ts is a production file").toBeTruthy();
    const IMPORT_FORMS = [
      /^\s*(?:import|export)\s+(?:type\s+)?(?:[^;]*?\s+from\s+)?["']([^"']+)["']/gm,
      /\bimport\(\s*["']([^"']+)["']\s*\)/g,
      /\brequire\(\s*["']([^"']+)["']\s*\)/g,
    ];
    const specifiers = IMPORT_FORMS.flatMap((pattern) => [...source!.matchAll(pattern)].map((match) => match[1]!));
    expect(specifiers).toEqual(["../../engineering/stable"]);
    expect(source!).not.toMatch(/\bfetch\(|Date\.now\(|Math\.random\(|process\.env|new Date\(|node:/);
  });

  it("G11. the pages state C2's pagination where they used to deny it", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const read = (path: string): string => readFileSync(resolve(ROOT, path), "utf8").replaceAll(String.fromCharCode(13) + String.fromCharCode(10), String.fromCharCode(10));
    const endpoint = read("artifacts/ai-control-plane-b20/mcp-server-endpoint.md");
    expect(endpoint).not.toContain("no `nextCursor`");
    expect(endpoint).toContain("a cursor the server did not mint");
    expect(endpoint).toMatch(/OD-97/);
    expect(endpoint).toMatch(/OD-98/);
    const exposure = read("artifacts/ai-control-plane-b20/mcp-exposure.md");
    expect(exposure).not.toContain("No pagination, `ttlMs` or `cacheScope`");
    const parity = read("artifacts/ai-control-plane-b20/mcp-parity.md");
    expect(parity).toContain("## 6. Pagination (C2)");
    expect(parity).toContain(String(MCP_TOOLS_LIST_PAGE_SIZE));
  });

  it("G12. against a registry whose listing refuses, a malformed cursor is still B2's 200 -32602 while a well-formed one is the 500 -32603 a cursor-free request gets", async () => {
    const principal = await principalFor("editor");
    const refusing = refusingRegistry();
    expect(() => renderMcpToolListing(refusing)).toThrow();
    const malformed = await list(principal, { cursor: "" }, { registry: refusing });
    expect(malformed.status).toBe(200);
    expect(malformed.body).toEqual({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: MCP_JSON_RPC_MESSAGES.INVALID_CURSOR } });
    const wellFormed = await list(principal, { cursor: `tl1-${"0123456789abcdef"}` }, { registry: refusing });
    expect(wellFormed.status).toBe(500);
    expect((wellFormed.body.error as Record<string, unknown>).code).toBe(-32603);
    const none = await list(principal, {}, { registry: refusing });
    expect(none.status).toBe(500);
    expect((none.body.error as Record<string, unknown>).code).toBe(-32603);
  });

  it("G13. the page-size test hooks are called from test files only", () => {
    const production = collectProductionFiles(ROOT);
    expect(production.size).toBeGreaterThan(100);
    const HOOKS = ["__setMcpToolsListPageSizeForTests", "__resetMcpToolsListPageSizeForTests"];
    const callers = [...production]
      .filter(([path]) => path !== "app/lib/mcp/server/tool-pages.ts")
      .filter(([, source]) => HOOKS.some((hook) => source.includes(hook)))
      .map(([path]) => path);
    expect(callers).toEqual([]);
    // non-vacuity: a production module that called one would be caught
    const injected = new Map(production);
    injected.set("app/lib/mcp/server/evil-page-size.ts", `import { __setMcpToolsListPageSizeForTests } from "./tool-pages";\nexport const x = () => __setMcpToolsListPageSizeForTests(1);`);
    expect([...injected].filter(([path]) => path !== "app/lib/mcp/server/tool-pages.ts").filter(([, source]) => HOOKS.some((hook) => source.includes(hook))).map(([path]) => path)).toEqual(["app/lib/mcp/server/evil-page-size.ts"]);
  });
});
