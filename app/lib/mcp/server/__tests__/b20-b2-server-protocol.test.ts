/**
 * [B20 B2] The server side's pure pieces: the protocol constants (equal to the client's), the `Mcp-Name` decoder (the
 * client encoder's inverse, bounded first), the request validator with the pinned check order of D-7 steps 1 to 8, the
 * inbound fixed-window limiter (S3 constants, fail closed), the per-process request trace (bounded, closed, contained) and
 * the deterministic discover and metadata renderers.
 */
import { describe, expect, it } from "vitest";
import { JSON_RPC_METHOD_NOT_FOUND, MCP_CLIENT_INFO, MCP_ERROR_HEADER_MISMATCH, MCP_ERROR_UNSUPPORTED_PROTOCOL_VERSION, MCP_META_CLIENT_CAPABILITIES, MCP_META_PROTOCOL_VERSION, MCP_NAME_MAX_CHARS, encodeMcpNameHeader } from "../../http-transport";
import { MCP_PROTOCOL_VERSION_CURRENT } from "../../server-registry";
import { MCP_ENDPOINT_LIMIT, MCP_LIMITER_MAX_KEYS, MCP_TOKEN_ROUTE_LIMIT, createFixedWindowLimiter, validateFixedWindowLimit } from "../inbound-limits";
import {
  MCP_JSON_RPC_ERROR_CODES,
  MCP_META_KEY_CLIENT_CAPABILITIES,
  MCP_META_KEY_PROTOCOL_VERSION,
  MCP_NAME_HEADER_MAX_CHARS,
  MCP_SERVER_INFO,
  MCP_SERVER_PROTOCOL_VERSION,
  MCP_SUPPORTED_PROTOCOL_VERSIONS,
  decodeMcpNameHeader,
  renderMcpDiscoverResult,
  validateMcpRequest,
} from "../protocol";
import { MCP_SERVER_TRACE_RING_MAX, MCP_SERVER_TRACE_SCHEMA, mcpServerTraceRing, recordMcpServerRequest, resetMcpServerTraceSinkFactory, setMcpServerTraceSinkFactory, type McpServerRequestTrace } from "../request-trace";
import { renderMcpResourceMetadata } from "../resource-metadata";
import type { McpRequestHeaders } from "@/app/lib/auth/mcp-bearer";

const V = "2026-07-28";
const META = { [MCP_META_PROTOCOL_VERSION]: V, [MCP_META_CLIENT_CAPABILITIES]: {} };
const present = (value: string) => ({ state: "present" as const, value });
const ABSENT = { state: "absent" as const };
function headersFor(method: string | null, extra: Partial<McpRequestHeaders> = {}): McpRequestHeaders {
  return { protocolVersion: present(V), method: method === null ? ABSENT : present(method), name: ABSENT, paramHeaderCount: 0, ...extra };
}
const rpc = (method: string, params: Record<string, unknown> = {}, id: unknown = 1): Record<string, unknown> => ({ jsonrpc: "2.0", id, method, params: { ...params, _meta: META } });
/** The validator's verdict reduced to what the wire shows: the status, the JSON-RPC code (or the dispatch kind), the echoed id. */
function verdict(message: unknown, headers: McpRequestHeaders): string {
  const outcome = validateMcpRequest(message, headers);
  if (outcome.kind === "error") return `${outcome.status} ${outcome.code} id=${JSON.stringify(outcome.id)}`;
  if (outcome.kind === "notification") return "202 notification";
  return `dispatch ${outcome.method}${outcome.name === undefined ? "" : ` ${outcome.name}`}`;
}
const trace = (overrides: Partial<McpServerRequestTrace> = {}): McpServerRequestTrace => ({
  schema: MCP_SERVER_TRACE_SCHEMA,
  requestId: "mcpreq-0000000000000000",
  receivedAtMs: 1,
  elapsedMs: 0,
  method: "tools/list",
  toolId: null,
  outcome: "listed",
  httpStatus: 200,
  protocolVersion: V,
  principal: { tenantId: "local", projectId: "proj-mcp", branchId: "main", principalId: "user-mcp-0001", role: "viewer", membershipRevision: "mbr1-0123456789abcdef", authMethod: "mcp_bearer", tokenIdDigest: "0".repeat(32) },
  registryDigest: "eng1-0123456789abcdef",
  listingDigest: null,
  ...overrides,
});

describe("[B20 B2] I — protocol constants and the Mcp-Name decoder", () => {
  it("1. the server constants equal the client's", () => {
    expect(MCP_SERVER_PROTOCOL_VERSION).toBe(MCP_PROTOCOL_VERSION_CURRENT);
    expect([...MCP_SUPPORTED_PROTOCOL_VERSIONS]).toEqual([MCP_PROTOCOL_VERSION_CURRENT]);
    expect(MCP_META_KEY_PROTOCOL_VERSION).toBe(MCP_META_PROTOCOL_VERSION);
    expect(MCP_META_KEY_CLIENT_CAPABILITIES).toBe(MCP_META_CLIENT_CAPABILITIES);
    expect(MCP_JSON_RPC_ERROR_CODES.HEADER_MISMATCH).toBe(MCP_ERROR_HEADER_MISMATCH);
    expect(MCP_JSON_RPC_ERROR_CODES.UNSUPPORTED_PROTOCOL_VERSION).toBe(MCP_ERROR_UNSUPPORTED_PROTOCOL_VERSION);
    expect(MCP_JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND).toBe(JSON_RPC_METHOD_NOT_FOUND);
    expect(MCP_NAME_HEADER_MAX_CHARS).toBe(MCP_NAME_MAX_CHARS);
    expect(MCP_SERVER_INFO).toEqual(MCP_CLIENT_INFO);
    expect(MCP_JSON_RPC_ERROR_CODES).toEqual({ PARSE_ERROR: -32700, INVALID_REQUEST: -32600, METHOD_NOT_FOUND: -32601, INVALID_PARAMS: -32602, INTERNAL_ERROR: -32603, HEADER_MISMATCH: -32020, UNSUPPORTED_PROTOCOL_VERSION: -32022 });
  });

  it("2. decodeMcpNameHeader round-trips the client's encoder; malformed, bad base64 and non-UTF-8 are closed; over 2 048 characters is judged first", () => {
    const names = ["sirkit.pcb.board-inspect", "a", " padded ", "héllo wörld", "=?base64?literal?=", "tab\tinside", "x".repeat(1500), String.fromCharCode(0x202e) + "rtl"];
    for (const name of names) expect(decodeMcpNameHeader(encodeMcpNameHeader(name)), name.slice(0, 20)).toEqual({ ok: true, value: name });
    const nonUtf8 = `=?base64?${Buffer.from([0xff, 0xfe]).toString("base64")}?=`;
    for (const bad of ["=?base64?###?=", "=?base64?abc?=", "=?base64?YQ?=", "=?base64?YR==?=", "=?base64??=", nonUtf8, "", 5, null, {}]) {
      expect(decodeMcpNameHeader(bad as never), String(bad)).toEqual({ ok: false });
    }
    expect(decodeMcpNameHeader("y".repeat(2049))).toEqual({ ok: false });
    expect(decodeMcpNameHeader(`=?base64?${Buffer.from("z".repeat(1600)).toString("base64")}?=`)).toEqual({ ok: false });
    expect(decodeMcpNameHeader("y".repeat(2048))).toEqual({ ok: true, value: "y".repeat(2048) });
  });
});

describe("[B20 B2] I — the request validator", () => {
  it("3. the pinned order of D-7 steps 1 to 8, and thirty hostile values that never throw", () => {
    // 1. shape first, whatever the headers say
    expect(verdict({ jsonrpc: "1.0", id: 1, method: "tools/list" }, headersFor(null, { protocolVersion: ABSENT }))).toBe("400 -32600 id=1");
    expect(verdict({ jsonrpc: "2.0", id: null, method: "tools/list" }, headersFor("tools/list"))).toBe("400 -32600 id=null");
    // 2. the version header before Mcp-Method: absent or invalid is -32020, unsupported is -32022
    expect(verdict(rpc("tools/list"), headersFor(null, { protocolVersion: ABSENT }))).toBe("400 -32020 id=1");
    expect(verdict(rpc("tools/list"), headersFor(null, { protocolVersion: { state: "invalid" } }))).toBe("400 -32020 id=1");
    expect(verdict(rpc("tools/list"), headersFor("x/y", { protocolVersion: present("2025-11-25") }))).toBe("400 -32022 id=1");
    expect((validateMcpRequest(rpc("tools/list"), headersFor(null, { protocolVersion: ABSENT })) as { data?: unknown }).data).toEqual({ supported: [V] });
    // -32022 carries both required fields of the 2026-07-28 UnsupportedProtocolVersionError: supported and requested (a
    // date-shaped value is echoed; anything else is the empty string, so nothing a peer wrote is repeated)
    expect((validateMcpRequest(rpc("tools/list"), headersFor(null, { protocolVersion: present("1900-01-01") })) as { data?: unknown }).data).toEqual({ supported: [V], requested: "1900-01-01" });
    for (const unshaped of ["not-a-version", "2026-7-28", ["sk", "live", "0123456789abcdefghij"].join("_"), " 2026-07-28"]) {
      expect((validateMcpRequest(rpc("tools/list"), headersFor(null, { protocolVersion: present(unshaped) })) as { data?: unknown }).data, unshaped).toEqual({ supported: [V], requested: "" });
    }
    // 3. Mcp-Method present and equal; 4. no Mcp-Param-* at all
    expect(verdict(rpc("tools/list"), headersFor(null))).toBe("400 -32020 id=1");
    expect(verdict(rpc("tools/list"), headersFor("tools/call"))).toBe("400 -32020 id=1");
    expect(verdict(rpc("tools/list"), headersFor("tools/list", { paramHeaderCount: 1 }))).toBe("400 -32020 id=1");
    // 5. notifications after the header checks
    expect(verdict({ jsonrpc: "2.0", method: "notifications/x" }, headersFor("notifications/x"))).toBe("202 notification");
    expect(verdict({ jsonrpc: "2.0", method: "notifications/x" }, headersFor("notifications/x", { paramHeaderCount: 2 }))).toBe("400 -32020 id=null");
    // 6. an unknown method before _meta and Mcp-Name
    expect(verdict({ jsonrpc: "2.0", id: 1, method: "resources/read", params: {} }, headersFor("resources/read", { name: present("file:///x") }))).toBe("404 -32601 id=1");
    expect(verdict({ jsonrpc: "2.0", id: 2, method: "initialize" }, headersFor("initialize"))).toBe("404 -32601 id=2");
    // 7. _meta before Mcp-Name; the _meta version must equal the header
    expect(verdict({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "t" } }, headersFor("tools/call"))).toBe("400 -32602 id=1");
    expect(verdict({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: { ...META, [MCP_META_PROTOCOL_VERSION]: "2025-11-25" } } }, headersFor("tools/list"))).toBe("400 -32020 id=1");
    // 8. Mcp-Name: a string name that equals the decoded header on tools/call, none on discover and list
    expect(verdict(rpc("tools/call", { name: 5 }), headersFor("tools/call", { name: present("5") }))).toBe("200 -32602 id=1");
    expect(verdict(rpc("tools/call", { name: "t" }), headersFor("tools/call"))).toBe("400 -32020 id=1");
    expect(verdict(rpc("tools/call", { name: "t" }), headersFor("tools/call", { name: present("u") }))).toBe("400 -32020 id=1");
    expect(verdict(rpc("tools/call", { name: "t" }), headersFor("tools/call", { name: { state: "invalid" } }))).toBe("400 -32020 id=1");
    expect(verdict(rpc("tools/list"), headersFor("tools/list", { name: present("t") }))).toBe("400 -32020 id=1");
    expect(verdict(rpc("tools/call", { name: "t" }), headersFor("tools/call", { name: present("t") }))).toBe("dispatch tools/call t");
    expect(verdict(rpc("server/discover", {}, "s-1"), headersFor("server/discover"))).toBe("dispatch server/discover");
    // thirty hostile values, each with its exact verdict under the tools/list headers; every one is also a closed error under
    // the tools/call headers and without a version header, and nothing throws
    const shapeError = "400 -32600 id=null";
    const hostile: Array<[unknown, string]> = [
      [undefined, shapeError], [null, shapeError], [0, shapeError], ["x", shapeError], [[], shapeError], [[rpc("tools/list")], shapeError], [{}, shapeError], [{ jsonrpc: "2.0" }, shapeError],
      [{ jsonrpc: "2.0", method: 5 }, shapeError], [{ jsonrpc: "2.0", method: "" }, shapeError], [{ jsonrpc: "2.0", method: "m".repeat(129) }, shapeError], [{ jsonrpc: "2.0", method: "a b" }, shapeError],
      [{ jsonrpc: "2.0", id: true, method: "x" }, shapeError], [{ jsonrpc: "2.0", id: -0.5, method: "x" }, shapeError], [{ jsonrpc: "2.0", id: 2 ** 60, method: "x" }, shapeError],
      [{ jsonrpc: "2.0", id: "", method: "x" }, shapeError], [{ jsonrpc: "2.0", id: "a b", method: "x" }, shapeError],
      // a response-shaped message carrying a method is still refused for its result or error key (never read as a request)
      [{ jsonrpc: "2.0", id: 1, method: "x", result: 1 }, "400 -32600 id=1"], [{ jsonrpc: "2.0", id: 1, method: "tools/list", result: {}, params: { _meta: META } }, "400 -32600 id=1"],
      [{ jsonrpc: "2.0", id: 1, method: "x", error: null }, "400 -32600 id=1"], [Object.create(null), shapeError],
      [new Proxy({}, { get() { throw new Error("hostile"); }, has() { throw new Error("hostile"); }, ownKeys() { throw new Error("hostile"); } }), shapeError],
      // _meta hostile values built without the rpc helper (which would overwrite them with a valid _meta)
      [{ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: null } }, "400 -32602 id=1"], [{ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: "m" } }, "400 -32602 id=1"],
      [{ jsonrpc: "2.0", id: 1, method: "tools/list", params: "p" }, "400 -32602 id=1"], [{ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: { [MCP_META_PROTOCOL_VERSION]: 5, [MCP_META_CLIENT_CAPABILITIES]: {} } } }, "400 -32602 id=1"],
      [{ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: { [MCP_META_PROTOCOL_VERSION]: V, [MCP_META_CLIENT_CAPABILITIES]: null } } }, "400 -32602 id=1"],
      [rpc("tools/call", { name: {} }), "400 -32020 id=1"], [new Date(), shapeError], [Symbol("s"), shapeError],
    ];
    expect(hostile).toHaveLength(30);
    for (const [value, expected] of hostile) {
      const label = String(expected);
      expect(() => validateMcpRequest(value, headersFor("tools/list"))).not.toThrow();
      expect(verdict(value, headersFor("tools/list")), label).toBe(expected);
      for (const headers of [headersFor("tools/call", { name: present("n") }), headersFor(null, { protocolVersion: ABSENT })]) {
        expect(() => validateMcpRequest(value, headers)).not.toThrow();
        expect(validateMcpRequest(value, headers).kind, label).toBe("error");
      }
    }
    expect(verdict(rpc("tools/call", { name: "n".repeat(3000) }), headersFor("tools/call", { name: present("n") }))).toBe("400 -32020 id=1");
    expect(verdict(new Proxy({}, { get() { throw new Error("hostile"); } }), headersFor("tools/list"))).toBe("400 -32600 id=null");
  });
});

describe("[B20 B2] I — the inbound limits", () => {
  it("4. constants validated; counts consistent; a refusal does not consume; Retry-After in [1, 60]; the 10 000-key bound with a sweep; a bad clock refuses; never throws", () => {
    expect(validateFixedWindowLimit(MCP_TOKEN_ROUTE_LIMIT)).toEqual([]);
    expect(validateFixedWindowLimit(MCP_ENDPOINT_LIMIT)).toEqual([]);
    expect(MCP_TOKEN_ROUTE_LIMIT).toEqual({ limit: 10, windowMs: 60_000, maxKeys: MCP_LIMITER_MAX_KEYS });
    expect(MCP_ENDPOINT_LIMIT).toEqual({ limit: 120, windowMs: 60_000, maxKeys: MCP_LIMITER_MAX_KEYS });
    expect(MCP_LIMITER_MAX_KEYS).toBe(10_000);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0, 1.5, 2 ** 53]) {
      expect(validateFixedWindowLimit({ ...MCP_ENDPOINT_LIMIT, limit: bad }).length, `limit ${bad}`).toBeGreaterThan(0);
      expect(validateFixedWindowLimit({ ...MCP_ENDPOINT_LIMIT, windowMs: bad }).length, `window ${bad}`).toBeGreaterThan(0);
      expect(validateFixedWindowLimit({ ...MCP_ENDPOINT_LIMIT, maxKeys: bad }).length, `keys ${bad}`).toBeGreaterThan(0);
    }
    expect(validateFixedWindowLimit(null as never).length).toBeGreaterThan(0);
    const misconfigured = createFixedWindowLimiter({ limit: 0, windowMs: 60_000, maxKeys: 10 });
    expect(misconfigured.take(["local", "p", "u"], 0)).toMatchObject({ ok: false, reason: "misconfigured" });
    const limiter = createFixedWindowLimiter({ limit: 3, windowMs: 60_000, maxKeys: 4 });
    const key = ["local", "proj", "user"];
    expect([1, 2, 3].map(() => limiter.take(key, 1_000).ok)).toEqual([true, true, true]);
    const refused = limiter.take(key, 1_500);
    expect(refused).toEqual({ ok: false, reason: "limited", retryAfterS: 60 });
    expect(limiter.take(key, 60_000)).toEqual({ ok: false, reason: "limited", retryAfterS: 1 });
    expect(limiter.take(key, 40_000)).toMatchObject({ retryAfterS: 21 });
    expect(limiter.take(key, 61_000).ok).toBe(true);
    expect(limiter.take(key, 61_000).ok).toBe(true);
    expect(limiter.take(key, 61_000).ok).toBe(true);
    expect(limiter.take(key, 61_000).ok).toBe(false);
    // a refused request does not consume: the next window allows the full limit again
    for (let index = 0; index < 5; index += 1) expect(limiter.take(["local", "proj", "other"], 61_000 + index).ok).toBe(index < 3);
    expect(limiter.size()).toBe(2);
    // bounded keys: full refuses a new key (fail closed) until expired entries are swept
    limiter.take(["local", "proj", "k3"], 61_000);
    limiter.take(["local", "proj", "k4"], 61_000);
    expect(limiter.size()).toBe(4);
    expect(limiter.take(["local", "proj", "k5"], 61_001)).toMatchObject({ ok: false, reason: "full" });
    expect(limiter.take(["local", "proj", "k5"], 121_000).ok).toBe(true);
    expect(limiter.size()).toBe(1);
    for (const nowMs of [Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY]) expect(limiter.take(key, nowMs)).toMatchObject({ ok: false, reason: "clock_invalid" });
    for (const parts of [[], ["bad key!", "p", "u"], ["a", "b"], [5, "b", "c"], null]) expect(limiter.take(parts as never, 200_000)).toMatchObject({ ok: false, reason: "key_invalid" });
    const big = createFixedWindowLimiter(MCP_ENDPOINT_LIMIT);
    for (let index = 0; index < MCP_LIMITER_MAX_KEYS; index += 1) big.take(["local", "proj", `u${index}`], 0);
    expect(big.size()).toBe(MCP_LIMITER_MAX_KEYS);
    expect(big.take(["local", "proj", "late"], 1)).toMatchObject({ ok: false, reason: "full", retryAfterS: 60 });
    expect(big.take(["local", "proj", "late"], 60_000).ok).toBe(true);
    expect(big.size()).toBe(1);
    expect(() => limiter.take(new Proxy([], { get() { throw new Error("hostile"); } }) as never, 1)).not.toThrow();
  });
});

describe("[B20 B2] I — the request trace and the renderers", () => {
  it("5. the ring holds at most 1 000 closed records; a failing sink or factory is contained; a record outside the schema is dropped", () => {
    resetMcpServerTraceSinkFactory();
    for (let index = 0; index < MCP_SERVER_TRACE_RING_MAX + 5; index += 1) recordMcpServerRequest(trace({ receivedAtMs: index }));
    const ring = mcpServerTraceRing();
    expect(MCP_SERVER_TRACE_RING_MAX).toBe(1000);
    expect(ring).toHaveLength(1000);
    expect(ring[0]!.receivedAtMs).toBe(5);
    recordMcpServerRequest({ ...trace(), authorization: "Bearer x" } as never);
    expect(Object.keys(mcpServerTraceRing().at(-1)!)).not.toContain("authorization");
    recordMcpServerRequest(trace({ receivedAtMs: 7_777_777, method: "evil/method" as never }));
    recordMcpServerRequest(trace({ receivedAtMs: 7_777_777, outcome: "anything" as never }));
    recordMcpServerRequest(trace({ receivedAtMs: 7_777_777, toolId: "not a tool id" }));
    recordMcpServerRequest(trace({ receivedAtMs: 7_777_777, httpStatus: 99 }));
    recordMcpServerRequest(trace({ receivedAtMs: 7_777_777, principal: { ...trace().principal, authMethod: "supabase_cookie" as never } }));
    recordMcpServerRequest(null as never);
    expect(mcpServerTraceRing().filter((record) => record.receivedAtMs === 7_777_777)).toEqual([]);
    expect(mcpServerTraceRing()).toHaveLength(1000);
    setMcpServerTraceSinkFactory(() => ({ record: () => { throw new Error("sink down"); } }));
    expect(() => recordMcpServerRequest(trace())).not.toThrow();
    setMcpServerTraceSinkFactory(() => { throw new Error("factory down"); });
    expect(() => recordMcpServerRequest(trace())).not.toThrow();
    resetMcpServerTraceSinkFactory();
    expect(mcpServerTraceRing()).toHaveLength(0);
  });

  it("6. the discover and metadata renderers are deterministic and frozen", () => {
    const first = renderMcpDiscoverResult();
    expect(renderMcpDiscoverResult()).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(first).toEqual({ resultType: "complete", supportedVersions: [V], capabilities: { tools: { listChanged: false } }, instructions: expect.any(String), ttlMs: 60_000, cacheScope: "public", _meta: { "io.modelcontextprotocol/serverInfo": { name: "sirkit", version: "0.1.0" } } });
    expect(first.instructions.length).toBeLessThanOrEqual(300);
    const config = { ok: true as const, issuer: "https://mcp.example.com", resourceUri: "https://mcp.example.com/api/mcp", resourceMetadataUrl: "https://mcp.example.com/.well-known/oauth-protected-resource/api/mcp" };
    expect(JSON.stringify(renderMcpResourceMetadata(config))).toBe(JSON.stringify(renderMcpResourceMetadata(config)));
    expect(Object.isFrozen(renderMcpResourceMetadata(config))).toBe(true);
  });
});
