/**
 * [B20 A2] `tools/list` as Sirkit's client pages, digests, pins and caches it: the cursor rules and the page and tool
 * caps, a listing digest over the server's own definitions that changes with any of them and echoes none of them, the
 * comparison against the registry's `descriptorPin` (the pin half of D20-20), and a bounded per-process cache that
 * honours `ttlMs` / `cacheScope` under an injected clock and never serves a private listing to another principal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAdmissionControl } from "../../acquisition/admission-control";
import { resetMcpInFlight } from "../http-transport";
import { discoverMcpServer, type McpNegotiatedServer } from "../negotiation";
import {
  invalidateMcpToolListing, listMcpTools, mcpToolCacheSize, mcpToolsListDigest, MCP_TOOL_CACHE_MAX, MCP_TOOL_CURSOR_MAX_CHARS,
  MCP_TOOL_PAGES_MAX, resetMcpToolCache,
} from "../tool-discovery";
import { MCP_TOOLS_PER_SERVER_MAX } from "../foreign-tools";
import type { McpServerRegistryEntry } from "../server-registry";
import { byMethod, depsOf, ESC, fakeMcpServer, KELVIN_SIGN, rpcResult, survivor, tool, TOKENS, tokenServer, wideServer, type FakeCall, type FakeScript } from "./_fake-mcp-server";

const server = wideServer("docs-list");
const PIN = `sha256:${"a".repeat(64)}`;

async function negotiate(entry: McpServerRegistryEntry = server): Promise<McpNegotiatedServer> {
  const fake = fakeMcpServer(byMethod({}));
  const outcome = await discoverMcpServer(entry, { purpose: "interactive", deps: depsOf(fake) });
  if (!outcome.ok) throw new Error(`the fixture negotiation failed: ${JSON.stringify(outcome)}`);
  return outcome;
}

const page = (call: FakeCall, tools: unknown[], extra: Record<string, unknown> = {}) => rpcResult(call, { tools, ttlMs: 0, cacheScope: "private", ...extra });
const listing = (tools: unknown[], extra: Record<string, unknown> = {}): FakeScript => byMethod({ list: (call) => page(call, tools, extra) });

let clock = 1_000_000;
const clocked = (fake: { transport: typeof fetch }) => depsOf(fake, TOKENS[0]!, { clock: () => clock });

beforeEach(() => {
  clock = 1_000_000;
  resetMcpToolCache();
  vi.stubGlobal("fetch", () => { throw new Error("the MCP client bypassed the egress boundary and called the global fetch"); });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetAdmissionControl();
  resetMcpInFlight();
  resetMcpToolCache();
});

describe("[B20 A2] one page on the wire", () => {
  it("tools/list is sent with the NEGOTIATED version and no cursor; the listing is frozen, pinned false and carries the accepted descriptors", async () => {
    const negotiated = await negotiate();
    const fake = fakeMcpServer(listing([tool("part.search"), tool("part.read")]));
    const result = await listMcpTools(server, negotiated, { purpose: "interactive", deps: clocked(fake) });
    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0]!;
    expect(call.body.method).toBe("tools/list");
    expect(call.headers["Mcp-Method"]).toBe("tools/list");
    expect(call.headers["MCP-Protocol-Version"]).toBe("2026-07-28");
    expect(call.headers["Mcp-Name"]).toBeUndefined();
    expect(call.body.params?.cursor).toBeUndefined();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result).toMatchObject({ kind: "tools", serverId: "docs-list", negotiatedVersion: "2026-07-28", pinned: false, pages: 1, considered: 2, notRead: 0, truncated: false, cached: false, ttlMs: 0, cacheScope: "private" });
    expect(result.tools.map((entry) => entry.toolId)).toEqual(["mcp.docs-list.part.search", "mcp.docs-list.part.read"]);
    expect(result.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.tools)).toBe(true);
  });

  it("a page whose tools are not an array, and an input_required answer, are closed outcomes; every other transport outcome is passed through", async () => {
    const negotiated = await negotiate();
    const rows: ReadonlyArray<readonly [string, FakeScript, string]> = [
      ["tools absent", byMethod({ list: (call) => rpcResult(call, { ttlMs: 0 }) }), "list_invalid"],
      ["tools: an object", listing({} as never), "list_invalid"],
      ["tools: a string", listing("all" as never), "list_invalid"],
      ["input_required", byMethod({ list: (call) => rpcResult(call, { resultType: "input_required", inputRequests: {}, requestState: "s" }) }), "unexpected_input_required"],
    ];
    for (const [label, script, code] of rows) {
      const fake = fakeMcpServer(script);
      const result = await listMcpTools(server, negotiated, { purpose: "interactive", deps: clocked(fake) });
      expect(result, label).toMatchObject({ ok: false, kind: "closed", code });
      resetAdmissionControl();
    }
    const errored = await listMcpTools(server, negotiated, { purpose: "interactive", deps: clocked(fakeMcpServer(byMethod({ list: () => new Response(null, { status: 503 }) }))) });
    expect(errored).toMatchObject({ ok: false, kind: "closed", code: "server_error", status: 503 });
  });

  it("a negotiation this client did not produce, or one for another row, sends nothing", async () => {
    const negotiated = await negotiate();
    const fake = fakeMcpServer(listing([tool("x")]));
    const forged = { ...negotiated };
    expect(await listMcpTools(server, forged, { purpose: "interactive", deps: clocked(fake) })).toMatchObject({ ok: false, kind: "closed", code: "not_negotiated" });
    expect(await listMcpTools(wideServer("docs-other"), negotiated, { purpose: "interactive", deps: clocked(fake) })).toMatchObject({ ok: false, kind: "closed", code: "not_negotiated" });
    expect(fake.calls).toHaveLength(0);
  });
});

describe("[B20 A2] paging, cursors and the caps", () => {
  it("every page's cursor is sent back and the tools are merged in listing order", async () => {
    const negotiated = await negotiate();
    const fake = fakeMcpServer(byMethod({
      list: (call) => {
        const cursor = call.body.params?.cursor;
        if (cursor === undefined) return page(call, [tool("a")], { nextCursor: "c1" });
        if (cursor === "c1") return page(call, [tool("b")], { nextCursor: "c2" });
        return page(call, [tool("c")]);
      },
    }));
    const result = await listMcpTools(server, negotiated, { purpose: "interactive", deps: clocked(fake) });
    expect(fake.calls.map((call) => call.body.params?.cursor)).toEqual([undefined, "c1", "c2"]);
    expect(result.ok && result.tools.map((entry) => entry.name)).toEqual(["a", "b", "c"]);
    expect(result.ok && result.pages).toBe(3);
  });

  it("the cursor rules: a malformed cursor is refused, a repeated one is a loop, and the page cap stops the walk", async () => {
    const negotiated = await negotiate();
    const rows: ReadonlyArray<readonly [string, unknown, string]> = [
      ["not a string", 5, "cursor_invalid"],
      ["empty", "", "cursor_invalid"],
      ["1 025 characters", "c".repeat(MCP_TOOL_CURSOR_MAX_CHARS + 1), "cursor_invalid"],
      ["a control character", `c${ESC}1`, "cursor_invalid"],
      ["a bidi override", `c${String.fromCharCode(8238)}1`, "cursor_invalid"],
      ["an object", { cursor: "c1" }, "cursor_invalid"],
    ];
    for (const [label, nextCursor, code] of rows) {
      const fake = fakeMcpServer(listing([tool("a")], { nextCursor }));
      const result = await listMcpTools(server, negotiated, { purpose: "interactive", deps: clocked(fake) });
      expect(result, label).toMatchObject({ ok: false, kind: "closed", code });
      expect(JSON.stringify(result).length, label).toBeLessThan(2_000);
      resetAdmissionControl();
    }
    const looping = fakeMcpServer(listing([tool("a")], { nextCursor: "same" }));
    expect(await listMcpTools(server, negotiated, { purpose: "interactive", deps: clocked(looping) })).toMatchObject({ ok: false, kind: "closed", code: "cursor_loop" });
    expect(looping.calls, "the repeated cursor is followed once, then refused").toHaveLength(2);
    resetAdmissionControl();
    let counter = 0;
    const endless = fakeMcpServer(byMethod({ list: (call) => page(call, [tool(`t${counter}`)], { nextCursor: `c${(counter += 1)}` }) }));
    const capped = await listMcpTools(server, negotiated, { purpose: "interactive", deps: clocked(endless) });
    expect(endless.calls).toHaveLength(MCP_TOOL_PAGES_MAX);
    expect(capped.ok && capped.truncated).toBe(true);
    expect(capped.ok && capped.pages).toBe(MCP_TOOL_PAGES_MAX);
  });

  it("a cursor that carries the sent token is refused, and no cursor reaches the outcome", async () => {
    const negotiated = await negotiate(tokenServer);
    const fake = fakeMcpServer(listing([tool("a")], { nextCursor: `page-${TOKENS[0]!.toUpperCase()}` }));
    const result = await listMcpTools(tokenServer, negotiated, { purpose: "interactive", deps: depsOf(fake, TOKENS[0]!, { clock: () => clock }) });
    expect(result).toMatchObject({ ok: false, kind: "closed", code: "cursor_invalid" });
    expect(JSON.stringify(result).toLowerCase()).not.toContain(TOKENS[0]!.slice(0, 12).toLowerCase());
  });

  it("at most 500 tools are read across the pages; the rest are counted and the walk stops", async () => {
    const negotiated = await negotiate();
    const fake = fakeMcpServer(byMethod({
      list: (call, index) => page(call, Array.from({ length: 300 }, (_unused, entry) => tool(`p${index}n${entry}`)), { nextCursor: `c${index}` }),
    }));
    const result = await listMcpTools(server, negotiated, { purpose: "interactive", deps: clocked(fake) });
    expect(fake.calls).toHaveLength(2);
    expect(result.ok && result.considered).toBe(MCP_TOOLS_PER_SERVER_MAX);
    expect(result.ok && result.notRead).toBe(100);
    expect(result.ok && result.tools).toHaveLength(MCP_TOOLS_PER_SERVER_MAX);
  });

  // [B20 A2 review] coverage-truncated-missed-on-tool-cap: the cap set `truncated` only when a valid next cursor followed
  it("one page over the 500-tool cap is truncated even without a next cursor; exactly 500 is complete", async () => {
    const negotiated = await negotiate();
    const over = fakeMcpServer(listing(Array.from({ length: MCP_TOOLS_PER_SERVER_MAX + 100 }, (_unused, index) => tool(`t${index}`))));
    expect(await listMcpTools(server, negotiated, { purpose: "interactive", deps: clocked(over) })).toMatchObject({ ok: true, pages: 1, considered: MCP_TOOLS_PER_SERVER_MAX, notRead: 100, truncated: true });
    resetAdmissionControl();
    const exact = fakeMcpServer(listing(Array.from({ length: MCP_TOOLS_PER_SERVER_MAX }, (_unused, index) => tool(`t${index}`))));
    expect(await listMcpTools(server, negotiated, { purpose: "interactive", deps: clocked(exact) })).toMatchObject({ ok: true, pages: 1, considered: MCP_TOOLS_PER_SERVER_MAX, notRead: 0, truncated: false });
  });

  it("the smallest ttl and the most private scope across the pages win", async () => {
    const negotiated = await negotiate();
    const fake = fakeMcpServer(byMethod({
      list: (call) => (call.body.params?.cursor === undefined
        ? page(call, [tool("a")], { ttlMs: 60_000, cacheScope: "public", nextCursor: "c1" })
        : page(call, [tool("b")], { ttlMs: 1_000, cacheScope: "private" })),
    }));
    const result = await listMcpTools(server, negotiated, { purpose: "interactive", deps: clocked(fake) });
    expect(result).toMatchObject({ ok: true, ttlMs: 1_000, cacheScope: "private" });
    resetAdmissionControl();
    const publicOnly = fakeMcpServer(listing([tool("a")], { ttlMs: 60_000, cacheScope: "public" }));
    expect(await listMcpTools(server, negotiated, { purpose: "interactive", deps: clocked(publicOnly) })).toMatchObject({ ok: true, ttlMs: 60_000, cacheScope: "public" });
  });
});

describe("[B20 A2] the listing digest", () => {
  const definitions = [tool("b", { outputSchema: { type: "object", properties: {}, required: [], additionalProperties: false }, annotations: { readOnlyHint: true } }), tool("a")];

  it("is stable under key order and tool order, and is never the server's text", () => {
    const reordered = definitions.map((definition) => Object.fromEntries(Object.entries(definition).reverse()));
    expect(mcpToolsListDigest([...definitions].reverse())).toBe(mcpToolsListDigest(definitions));
    expect(mcpToolsListDigest(reordered)).toBe(mcpToolsListDigest(definitions));
    expect(mcpToolsListDigest(definitions)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("changes when any reduced field changes and ignores every field it does not cover", () => {
    const base = mcpToolsListDigest(definitions);
    const changes: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
      ["name", { name: "b2" }],
      ["title", { title: "Another" }],
      ["description", { description: "Another description." }],
      ["inputSchema", { inputSchema: { type: "object", properties: { other: { type: "string" } }, required: [], additionalProperties: false } }],
      ["outputSchema", { outputSchema: { type: "object", properties: { hits: { type: "integer" } }, required: [], additionalProperties: false } }],
      ["annotations", { annotations: { readOnlyHint: false } }],
    ];
    for (const [label, change] of changes) {
      expect(mcpToolsListDigest([{ ...definitions[0], ...change }, definitions[1]]), label).not.toBe(base);
    }
    for (const [label, ignored] of [["icons", { icons: [{ src: "https://x.example.com/i.png" }] }], ["_meta", { _meta: { x: 1 } }], ["unknown", { whatever: 1 }]] as const) {
      expect(mcpToolsListDigest([{ ...definitions[0], ...ignored }, definitions[1]]), label).toBe(base);
    }
  });

  it("is bounded: a deep or enormous definition is digested without a stack overflow", () => {
    let deep: Record<string, unknown> = { type: "string" };
    for (let level = 0; level < 5_000; level += 1) deep = { type: "object", properties: { a: deep } };
    const started = Date.now();
    const digest = mcpToolsListDigest([tool("x", { inputSchema: deep }), tool("y", { description: "d".repeat(2_000_000) })]);
    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});

describe("[B20 A2] the descriptor pin (D20-20)", () => {
  it("a pin that differs refuses the whole listing; a pin that matches marks it pinned; a null pin is unpinned", async () => {
    const definitions = [tool("part.search")];
    const digest = mcpToolsListDigest(definitions);
    const pinned = { ...server, descriptorPin: { toolsListDigest: digest, pinnedAt: "2026-09-20" } } as McpServerRegistryEntry;
    const mismatched = { ...server, descriptorPin: { toolsListDigest: PIN, pinnedAt: "2026-09-20" } } as McpServerRegistryEntry;

    const negotiated = await negotiate(pinned);
    const match = await listMcpTools(pinned, negotiated, { purpose: "interactive", deps: clocked(fakeMcpServer(listing(definitions))) });
    expect(match).toMatchObject({ ok: true, pinned: true, digest });
    resetAdmissionControl();

    const negotiatedMismatch = await negotiate(mismatched);
    const refused = await listMcpTools(mismatched, negotiatedMismatch, { purpose: "interactive", deps: clocked(fakeMcpServer(listing(definitions))) });
    expect(refused).toMatchObject({ ok: false, kind: "closed", code: "descriptor_pin_mismatch" });
    expect(JSON.stringify(refused)).not.toContain("part.search");
    resetAdmissionControl();

    const unpinned = await listMcpTools(server, await negotiate(), { purpose: "interactive", deps: clocked(fakeMcpServer(listing(definitions))) });
    expect(unpinned).toMatchObject({ ok: true, pinned: false, digest });
  });

  it("a listing refused by the pin is never cached", async () => {
    const mismatched = { ...server, descriptorPin: { toolsListDigest: PIN, pinnedAt: "2026-09-20" } } as McpServerRegistryEntry;
    const negotiated = await negotiate(mismatched);
    // a public listing with a ttl WOULD be cached: nothing of a refused one is
    await listMcpTools(mismatched, negotiated, { purpose: "interactive", deps: clocked(fakeMcpServer(listing([tool("x")], { ttlMs: 60_000, cacheScope: "public" }))) });
    expect(mcpToolCacheSize()).toBe(0);
  });
});

describe("[B20 A2] the bounded per-process cache", () => {
  const withTtl = (ttlMs: number, cacheScope = "private", tools = [tool("a")]) => listing(tools, { ttlMs, cacheScope });

  it("a listing within its ttl is served from the cache and nothing is sent; after it expires the server is asked again", async () => {
    const negotiated = await negotiate();
    const fake = fakeMcpServer(withTtl(60_000));
    const first = await listMcpTools(server, negotiated, { purpose: "interactive", deps: clocked(fake), principalScopeKey: "member-1" });
    expect(first).toMatchObject({ ok: true, cached: false });
    expect(mcpToolCacheSize()).toBe(1);
    clock += 59_999;
    const second = await listMcpTools(server, negotiated, { purpose: "interactive", deps: clocked(fake), principalScopeKey: "member-1" });
    expect(second).toMatchObject({ ok: true, cached: true });
    expect(fake.calls).toHaveLength(1);
    expect(second.ok && second.tools[0]).toBe(first.ok ? first.tools[0] : null);
    clock += 2;
    const third = await listMcpTools(server, negotiated, { purpose: "interactive", deps: clocked(fake), principalScopeKey: "member-1" });
    expect(third).toMatchObject({ ok: true, cached: false });
    expect(fake.calls).toHaveLength(2);
  });

  it("ttl 0 is never cached, and a hostile ttl falls back to 0", async () => {
    const negotiated = await negotiate();
    for (const ttlMs of [0, -1, 1.5, 3_600_001, "60000", null, [60_000]] as unknown[]) {
      const fake = fakeMcpServer(withTtl(ttlMs as number));
      await listMcpTools(server, negotiated, { purpose: "interactive", deps: clocked(fake), principalScopeKey: "member-1" });
      expect(mcpToolCacheSize(), `ttlMs ${String(ttlMs)}`).toBe(0);
      resetAdmissionControl();
    }
  });

  it("a PRIVATE listing is never served to another principal; a public one is served to any", async () => {
    const negotiated = await negotiate();
    const privateFake = fakeMcpServer(withTtl(60_000, "private"));
    await listMcpTools(server, negotiated, { purpose: "interactive", deps: clocked(privateFake), principalScopeKey: "member-1" });
    const other = await listMcpTools(server, negotiated, { purpose: "interactive", deps: clocked(privateFake), principalScopeKey: "member-2" });
    expect(other).toMatchObject({ ok: true, cached: false });
    expect(privateFake.calls).toHaveLength(2);
    const same = await listMcpTools(server, negotiated, { purpose: "interactive", deps: clocked(privateFake), principalScopeKey: "member-1" });
    expect(same).toMatchObject({ ok: true, cached: true });
    resetMcpToolCache();
    resetAdmissionControl();

    const publicFake = fakeMcpServer(withTtl(60_000, "public"));
    await listMcpTools(server, negotiated, { purpose: "interactive", deps: clocked(publicFake), principalScopeKey: "member-1" });
    const anyone = await listMcpTools(server, negotiated, { purpose: "interactive", deps: clocked(publicFake), principalScopeKey: "member-9" });
    expect(anyone).toMatchObject({ ok: true, cached: true });
    expect(publicFake.calls).toHaveLength(1);
  });

  it("a private listing without a usable principal key is not cached", async () => {
    const negotiated = await negotiate();
    for (const key of [undefined, "", "x".repeat(300), `a${ESC}b`] as unknown[]) {
      const fake = fakeMcpServer(withTtl(60_000, "private"));
      await listMcpTools(server, negotiated, { purpose: "interactive", deps: clocked(fake), principalScopeKey: key as string });
      expect(mcpToolCacheSize(), String(key)).toBe(0);
      resetAdmissionControl();
    }
  });

  it("the cache holds 64 entries, evicting the least recently used, and one server's listing is invalidated on demand", async () => {
    const fake = fakeMcpServer(withTtl(600_000, "public"));
    for (let index = 0; index < MCP_TOOL_CACHE_MAX + 4; index += 1) {
      const row = wideServer(`docs-c${index}`);
      await listMcpTools(row, await negotiate(row), { purpose: "interactive", deps: clocked(fake) });
    }
    expect(mcpToolCacheSize()).toBe(MCP_TOOL_CACHE_MAX);
    const kept = wideServer("docs-c67");
    const negotiatedKept = await negotiate(kept);
    expect(await listMcpTools(kept, negotiatedKept, { purpose: "interactive", deps: clocked(fake) })).toMatchObject({ cached: true });
    invalidateMcpToolListing("docs-c67");
    expect(await listMcpTools(kept, negotiatedKept, { purpose: "interactive", deps: clocked(fake) })).toMatchObject({ cached: false });
    expect(mcpToolCacheSize()).toBe(MCP_TOOL_CACHE_MAX);
  });

  // [B20 A2 review] tests-cache-lru-recency-unpinned: every earlier write missed before it wrote, so FIFO passed too
  it("eviction is by RECENCY: an entry read since it was stored outlives an older one that was not", async () => {
    const fake = fakeMcpServer(withTtl(600_000, "public"));
    const rows = Array.from({ length: MCP_TOOL_CACHE_MAX + 1 }, (_unused, index) => wideServer(`docs-l${index}`));
    const negotiations = new Map<string, McpNegotiatedServer>();
    for (const row of rows) negotiations.set(row.id, await negotiate(row));
    const list = (row: McpServerRegistryEntry) => listMcpTools(row, negotiations.get(row.id)!, { purpose: "interactive", deps: clocked(fake) });
    for (const row of rows.slice(0, MCP_TOOL_CACHE_MAX)) await list(row);
    expect(mcpToolCacheSize()).toBe(MCP_TOOL_CACHE_MAX);
    expect(await list(rows[0]!), "the oldest entry, read").toMatchObject({ ok: true, cached: true });
    await list(rows[MCP_TOOL_CACHE_MAX]!);
    expect(mcpToolCacheSize()).toBe(MCP_TOOL_CACHE_MAX);
    expect(await list(rows[0]!), "read since it was stored: kept").toMatchObject({ ok: true, cached: true });
    expect(await list(rows[1]!), "the least recently used: evicted").toMatchObject({ ok: true, cached: false });
  });

  // [B20 A2 review] security-4 / correctness-06: the shared slot was keyed by the in-band literal "public", a legal principal key
  it("a principal scope key spelled \"public\" never names the shared slot: its private listing reaches neither another principal nor a caller without a key", async () => {
    const negotiated = await negotiate();
    const fake = fakeMcpServer(withTtl(60_000, "private"));
    await listMcpTools(server, negotiated, { purpose: "interactive", deps: clocked(fake), principalScopeKey: "public" });
    expect(mcpToolCacheSize()).toBe(1);
    expect(await listMcpTools(server, negotiated, { purpose: "interactive", deps: clocked(fake), principalScopeKey: "alice" })).toMatchObject({ ok: true, cached: false });
    expect(await listMcpTools(server, negotiated, { purpose: "interactive", deps: clocked(fake) })).toMatchObject({ ok: true, cached: false });
    expect(await listMcpTools(server, negotiated, { purpose: "interactive", deps: clocked(fake), principalScopeKey: "public" })).toMatchObject({ ok: true, cached: true });
    expect(fake.calls).toHaveLength(3);
  });

  // [B20 A2 review] security-5 / correctness-08 / coverage-cache-key-omits-reserved-provider-names: acceptance and the pin
  // depend on the CALLER's reserved names and the ROW's pin, and a hit returned a listing judged under neither
  it("a cache hit never skips the caller's context: another reserved set or another pin is never served a listing judged without it", async () => {
    const negotiated = await negotiate();
    const fake = fakeMcpServer(withTtl(60_000, "public", [tool("part.search")]));
    const first = await listMcpTools(server, negotiated, { purpose: "interactive", deps: clocked(fake) });
    expect(first.ok && first.tools.map((entry) => entry.name)).toEqual(["part.search"]);
    const reserved = await listMcpTools(server, negotiated, { purpose: "interactive", deps: clocked(fake), reservedProviderNames: ["mcp_docs-list__part_search"] });
    expect(reserved.ok && reserved.tools, "the collision gate ran for this caller").toEqual([]);
    expect(reserved.ok && reserved.excluded.map((entry) => entry.reason)).toEqual(["name_collision"]);
    // and the reverse: a listing judged under a reserved set is never served to a caller that holds none
    const plain = await listMcpTools(server, negotiated, { purpose: "interactive", deps: clocked(fake) });
    expect(plain.ok && plain.tools.map((entry) => entry.name)).toEqual(["part.search"]);
    // a row with this id and a pin that differs is refused, never served the unpinned listing as it was cached
    const pinned = { ...server, descriptorPin: { toolsListDigest: PIN, pinnedAt: "2026-09-20" } } as McpServerRegistryEntry;
    expect(await listMcpTools(pinned, negotiated, { purpose: "interactive", deps: clocked(fake) })).toMatchObject({ ok: false, kind: "closed", code: "descriptor_pin_mismatch" });
  });

  // [B20 A2 review] correctness-10: NaN became 0 and expiry read `expiresAt <= now`, so a stepped-back or non-numeric clock
  // kept an entry past its ttl (and past the stated one-hour ceiling) — the class A1 review-2 closed for SSE reads
  it("a clock that steps backwards, or answers no number, never lengthens a cached listing's life", async () => {
    const negotiated = await negotiate();
    // the cache reads the clock FIRST in a listing; the transport then reads a sane one — how the transport and admission
    // take a stepped or non-numeric clock is A1's (pinned there), and this case isolates the cache
    const firstReads = (value: number): (() => number) => { let first = true; return () => { if (first) { first = false; return value; } return clock; }; };
    const fake = fakeMcpServer(withTtl(60_000, "public"));
    await listMcpTools(server, negotiated, { purpose: "interactive", deps: clocked(fake) });
    expect(mcpToolCacheSize()).toBe(1);
    const earlier = await listMcpTools(server, negotiated, { purpose: "interactive", deps: depsOf(fake, TOKENS[0]!, { clock: firstReads(clock - 86_400_000) }) });
    expect(earlier, "a day earlier than it was stored").toMatchObject({ ok: true, cached: false });
    expect(fake.calls).toHaveLength(2);
    resetMcpToolCache();
    resetAdmissionControl();
    const unclocked = fakeMcpServer(withTtl(60_000, "public"));
    await listMcpTools(server, negotiated, { purpose: "interactive", deps: depsOf(unclocked, TOKENS[0]!, { clock: firstReads(Number.NaN) }) });
    expect(await listMcpTools(server, negotiated, { purpose: "interactive", deps: depsOf(unclocked, TOKENS[0]!, { clock: firstReads(Number.NaN) }) })).toMatchObject({ ok: true, cached: false });
    expect(unclocked.calls, "nothing is served from the cache without a clock").toHaveLength(2);
    expect(mcpToolCacheSize(), "and nothing is stored").toBe(0);
  });

  // [B20 A2 review] security-1 on the listing path: the transport redacts a RESULT case-sensitively (it is data), so an
  // upper-cased or KELVIN-SIGN echo inside a listed schema reached the listing; the schema gates now compare case-folded
  it("a case-folded or compatibility echo of the sent token inside a listed schema never reaches the listing", async () => {
    const negotiated = await negotiate(tokenServer);
    const object = (properties: Record<string, unknown>) => ({ type: "object", properties, required: [], additionalProperties: false });
    for (const echo of [TOKENS[0]!.toUpperCase(), TOKENS[0]!.replace("k", KELVIN_SIGN)]) {
      const hostile = [
        tool("a", { inputSchema: object({ mpn: { type: "string", description: `use ${echo}` } }) }),
        tool("b", { inputSchema: object({ [echo]: { type: "string" } }) }),
        tool("c", { inputSchema: object({ m: { type: "string", enum: ["x", echo] } }) }),
        tool("d", { outputSchema: object({ hits: { type: "integer", title: echo } }) }),
      ];
      const fake = fakeMcpServer(listing(hostile));
      const result = await listMcpTools(tokenServer, negotiated, { purpose: "interactive", deps: depsOf(fake, TOKENS[0]!, { clock: () => clock }) });
      expect(result.ok).toBe(true);
      expect(survivor(result, TOKENS[0]!), echo.slice(0, 4)).toBeNull();
      resetAdmissionControl();
    }
  });

  it("the cache holds the accepted descriptors and the digest, never the raw definitions or a credential", async () => {
    const negotiated = await negotiate(tokenServer);
    const hostile = [tool("a", { title: `use ${TOKENS[0]!}`, description: "Search the catalogue.", icons: [{ src: "https://x.example.com/i.png" }], _meta: { secret: TOKENS[0]! } })];
    const fake = fakeMcpServer(listing(hostile, { ttlMs: 60_000, cacheScope: "public" }));
    const result = await listMcpTools(tokenServer, negotiated, { purpose: "interactive", deps: depsOf(fake, TOKENS[0]!, { clock: () => clock }) });
    const serialized = JSON.stringify(result).toLowerCase();
    expect(serialized).not.toContain(TOKENS[0]!.slice(0, 12).toLowerCase());
    expect(serialized).not.toContain("icons");
  });
});

describe("[B20 A2] listMcpTools never throws (S4)", () => {
  it("junk rows, junk options and a hostile transport are closed outcomes with fixed sentences", async () => {
    const negotiated = await negotiate();
    const fake = fakeMcpServer(listing([tool("a")]));
    const junk: ReadonlyArray<readonly [string, unknown, unknown, unknown]> = [
      ["a null row", null, negotiated, { purpose: "interactive", deps: clocked(fake) }],
      ["a null negotiation", server, null, { purpose: "interactive", deps: clocked(fake) }],
      ["undefined options", server, negotiated, undefined],
      ["options whose deps throw", server, negotiated, Object.defineProperty({ purpose: "interactive" }, "deps", { get() { throw new Error("secret-thrown-text"); } })],
    ];
    for (const [label, row, negotiation, options] of junk) {
      const result = await listMcpTools(row as McpServerRegistryEntry, negotiation as McpNegotiatedServer, options as Parameters<typeof listMcpTools>[2]);
      expect(result.ok, label).toBe(false);
      expect(JSON.stringify(result), label).not.toContain("secret-thrown-text");
      expect(JSON.stringify(result).length, label).toBeLessThan(2_000);
    }
  });
});
