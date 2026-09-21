/**
 * [B20 A2] `tools/call` as Sirkit's client prepares and sends it: the arguments validated against the ACCEPTED input
 * schema with the repository's own validator, the `x-mcp-header` properties mirrored into `Mcp-Param-{Name}` headers
 * exactly as the specification's Value Encoding table defines, the transport's additive `paramHeaders` option refusing
 * a name or a value it would not put on the wire BEFORE anything is sent, a `header_mismatch` (-32020) invalidating the
 * cached listing, and `input_required` refused (this client declares no elicitation, sampling or roots capability).
 * The transport's typed outcome is returned unchanged: normalising a result into an observation is A4.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAdmissionControl } from "../../acquisition/admission-control";
import { acceptForeignTools, type McpAcceptedTool } from "../foreign-tools";
import { mcpPost, resetMcpInFlight } from "../http-transport";
import { discoverMcpServer, type McpNegotiatedServer } from "../negotiation";
import { listMcpTools, mcpToolCacheSize, resetMcpToolCache } from "../tool-discovery";
import { callMcpTool, MCP_TOOL_ARGUMENTS_MAX_BYTES, prepareMcpToolCall } from "../tool-call";
import type { McpServerRegistryEntry } from "../server-registry";
import { byMethod, depsOf, ESC, fakeMcpServer, json, KELVIN_SIGN, rpcError, rpcResult, survivor, tool, TOKENS, tokenServer, wideServer, type FakeScript } from "./_fake-mcp-server";

const server = wideServer("docs-call");
const SENTINEL_PREFIX = "=?base64?";

const schema = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({ type: "object", properties, required, additionalProperties: false });
const headerTool = (properties: Record<string, unknown>, required: string[] = []): McpAcceptedTool => {
  const set = acceptForeignTools(server, [tool("part.search", { inputSchema: schema(properties, required) })]);
  if (set.accepted.length !== 1) throw new Error(`the fixture tool was excluded: ${JSON.stringify(set.excluded)}`);
  return set.accepted[0]!;
};

async function negotiate(entry: McpServerRegistryEntry = server): Promise<McpNegotiatedServer> {
  const fake = fakeMcpServer(byMethod({}));
  const outcome = await discoverMcpServer(entry, { purpose: "interactive", deps: depsOf(fake) });
  if (!outcome.ok) throw new Error("the fixture negotiation failed");
  return outcome;
}

beforeEach(() => {
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

describe("[B20 A2] the call on the wire", () => {
  it("tools/call carries the server's own name, the arguments, the negotiated version and the mirrored headers; the outcome is the transport's, unchanged", async () => {
    const negotiated = await negotiate();
    const accepted = headerTool({ mpn: { type: "string" }, region: { type: "string", "x-mcp-header": "Region" } }, ["mpn"]);
    const fake = fakeMcpServer(byMethod({ call: (call) => rpcResult(call, { content: [{ type: "text", text: "one hit" }] }) }));
    const result = await callMcpTool(server, negotiated, accepted, { mpn: "NE555", region: "eu" }, { purpose: "agent", deps: depsOf(fake) });
    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0]!;
    expect(call.body.method).toBe("tools/call");
    expect(call.body.params?.name).toBe("part.search");
    expect(call.body.params?.arguments).toEqual({ mpn: "NE555", region: "eu" });
    expect(call.headers["Mcp-Name"]).toBe("part.search");
    expect(call.headers["Mcp-Method"]).toBe("tools/call");
    expect(call.headers["MCP-Protocol-Version"]).toBe("2026-07-28");
    expect(call.headers["Mcp-Param-Region"]).toBe("eu");
    expect(result).toMatchObject({ ok: true, kind: "complete", serverId: "docs-call", method: "tools/call", result: { resultType: "complete", content: [{ type: "text", text: "one hit" }] } });
  });

  it("input_required is refused as unsupported, and a header_mismatch invalidates this server's cached listing", async () => {
    const negotiated = await negotiate();
    const accepted = headerTool({ mpn: { type: "string" } }, ["mpn"]);
    const asked = fakeMcpServer(byMethod({ call: (call) => rpcResult(call, { resultType: "input_required", inputRequests: { a: { method: "elicitation/create" } }, requestState: "opaque-state" }) }));
    const refused = await callMcpTool(server, negotiated, accepted, { mpn: "NE555" }, { purpose: "agent", deps: depsOf(asked) });
    expect(refused).toMatchObject({ ok: false, kind: "closed", code: "input_required_unsupported" });
    expect(JSON.stringify(refused)).not.toContain("opaque-state");
    resetAdmissionControl();

    const listed = fakeMcpServer(byMethod({ list: (call) => rpcResult(call, { tools: [tool("part.search")], ttlMs: 60_000, cacheScope: "public" }) }));
    await listMcpTools(server, negotiated, { purpose: "agent", deps: depsOf(listed) });
    expect(mcpToolCacheSize()).toBe(1);
    const mismatch = fakeMcpServer(byMethod({ call: (call) => rpcError(call, -32020, "header mismatch", undefined, 400) }));
    const outcome = await callMcpTool(server, negotiated, accepted, { mpn: "NE555" }, { purpose: "agent", deps: depsOf(mismatch) });
    expect(outcome).toMatchObject({ ok: false, kind: "closed", code: "header_mismatch" });
    expect(mcpToolCacheSize(), "the listing this call was built from is forgotten").toBe(0);
    expect(mismatch.calls, "no automatic retry loop in A2").toHaveLength(1);
  });

  it("a descriptor these gates did not build, a negotiation this client did not produce, or a descriptor of another row sends nothing", async () => {
    const negotiated = await negotiate();
    const accepted = headerTool({ mpn: { type: "string" } }, ["mpn"]);
    const fake = fakeMcpServer(byMethod({}));
    const rows: ReadonlyArray<readonly [string, unknown, unknown]> = [
      ["a copied descriptor", negotiated, { ...accepted }],
      ["a forged descriptor", negotiated, { serverId: "docs-call", name: "part.search", inputSchema: {}, headerParameters: [] }],
      ["a copied negotiation", { ...negotiated }, accepted],
      ["null", null, accepted],
    ];
    for (const [label, negotiation, descriptor] of rows) {
      const result = await callMcpTool(server, negotiation as McpNegotiatedServer, descriptor as McpAcceptedTool, { mpn: "x" }, { purpose: "agent", deps: depsOf(fake) });
      expect(result, label).toMatchObject({ ok: false, kind: "closed" });
      expect(["not_accepted", "not_negotiated"], label).toContain((result as { code: string }).code);
    }
    expect(fake.calls).toHaveLength(0);
  });
});

describe("[B20 A2] the arguments are validated against the ACCEPTED schema", () => {
  const accepted = () => headerTool({ mpn: { type: "string" }, limit: { type: "integer" }, tags: { type: "array", items: { type: "string" } } }, ["mpn"]);

  it("one row per refusal, each before anything is sent", () => {
    const descriptor = accepted();
    const rows: ReadonlyArray<readonly [string, unknown, string]> = [
      ["not an object", "NE555", "arguments_invalid"],
      ["an array", ["NE555"], "arguments_invalid"],
      ["null", null, "arguments_invalid"],
      ["a missing required property", {}, "arguments_invalid"],
      ["a property of the wrong type", { mpn: 5 }, "arguments_invalid"],
      ["an unknown property", { mpn: "x", other: 1 }, "arguments_invalid"],
      ["a __proto__ key", JSON.parse('{"mpn":"x","__proto__":{"polluted":true}}'), "arguments_invalid"],
      ["a non-finite number", { mpn: "x", limit: Number.POSITIVE_INFINITY }, "arguments_invalid"],
      ["over the serialised bound", { mpn: "x".repeat(MCP_TOOL_ARGUMENTS_MAX_BYTES) }, "arguments_too_large"],
    ];
    const problems: string[] = [];
    for (const [label, args, code] of rows) {
      const prepared = prepareMcpToolCall(descriptor, args);
      if (prepared.ok || prepared.code !== code) problems.push(`${label}: ${prepared.ok ? "prepared" : prepared.code} instead of ${code}`);
      if (JSON.stringify(prepared).length > 2_000) problems.push(`${label}: an outcome of ${JSON.stringify(prepared).length} characters`);
    }
    expect(problems).toEqual([]);
    expect(prepareMcpToolCall(descriptor, { mpn: "NE555", limit: 3, tags: ["a"] })).toMatchObject({ ok: true });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("a refused preparation sends nothing", async () => {
    const negotiated = await negotiate();
    const fake = fakeMcpServer(byMethod({}));
    const result = await callMcpTool(server, negotiated, accepted(), { mpn: 5 }, { purpose: "agent", deps: depsOf(fake) });
    expect(result).toMatchObject({ ok: false, kind: "closed", code: "arguments_invalid" });
    expect(fake.calls).toHaveLength(0);
  });
});

describe("[B20 A2] the Value Encoding table of the specification", () => {
  it("every row the admitted types reach: a string as is, an integer in decimal, a boolean as true or false, an absent value omitted, an explicit null refused, and the Base64 sentinel otherwise", () => {
    const descriptor = headerTool({
      text: { type: "string", "x-mcp-header": "Text" },
      count: { type: "integer", "x-mcp-header": "Count" },
      flag: { type: "boolean", "x-mcp-header": "Flag" },
    });
    const header = (args: Record<string, unknown>, name: string): string | undefined => {
      const prepared = prepareMcpToolCall(descriptor, args);
      return prepared.ok ? prepared.paramHeaders[name] : `refused:${prepared.code}`;
    };
    expect(header({ text: "eu-west" }, "Mcp-Param-Text")).toBe("eu-west");
    expect(header({ text: "two words" }, "Mcp-Param-Text")).toBe("two words");
    expect(header({ count: 42 }, "Mcp-Param-Count")).toBe("42");
    expect(header({ count: -7 }, "Mcp-Param-Count")).toBe("-7");
    expect(header({ count: 0 }, "Mcp-Param-Count")).toBe("0");
    expect(header({ count: Number.MAX_SAFE_INTEGER }, "Mcp-Param-Count")).toBe(String(Number.MAX_SAFE_INTEGER));
    expect(header({ flag: true }, "Mcp-Param-Flag")).toBe("true");
    expect(header({ flag: false }, "Mcp-Param-Flag")).toBe("false");
    expect(header({}, "Mcp-Param-Text"), "absent: the header is omitted").toBeUndefined();
    // [B20 A2 review] relabelled (tests-null-header-value-contradiction): an annotated property is never nullable — a nullable
    // type is `x_mcp_header_invalid` at the gate, a stated limit — so the table's null row is unreachable by design and an
    // explicit null is refused like any value of the wrong type; the dead null branch of `headerValue` is gone
    expect(header({ text: null }, "Mcp-Param-Text"), "an explicit null is refused, never omitted").toBe("refused:arguments_invalid");
    // not header-safe, leading or trailing whitespace, or itself a sentinel: the Base64 sentinel over the UTF-8 value
    for (const value of ["eu west ", " eu", `eu${ESC}west`, `ohm-${String.fromCharCode(181)}`, "=?base64?ZXU=?=", "", "line\nbreak"]) {
      const encoded = header({ text: value }, "Mcp-Param-Text");
      expect(typeof encoded === "string" && encoded.startsWith(SENTINEL_PREFIX), `sentinel for ${JSON.stringify(value)}`).toBe(true);
    }
    expect(header({ count: 1.5 }, "Mcp-Param-Count")).toBe("refused:arguments_invalid");
    expect(header({ count: Number.MAX_SAFE_INTEGER + 2 }, "Mcp-Param-Count")).toBe("refused:arguments_invalid");
  });

  // [B20 A2 review] correctness-03: only the LEAF name was recorded and it was read at the top level, so a nested parameter
  // mirrored a same-named top-level value (or none at all) while the body carried its own
  it("a NESTED x-mcp-header mirrors the value at its own path: never a top-level property of the same leaf name, and nothing when the path is absent", async () => {
    const descriptor = headerTool({
      region: { type: "string", "x-mcp-header": "Region" },
      filter: schema({ region: { type: "string", "x-mcp-header": "Inner" } }),
      outer: schema({ inner: { type: "integer", "x-mcp-header": "Page" } }),
      inner: { type: "string" },
    });
    const headersOf = (args: Record<string, unknown>): Readonly<Record<string, string>> | string => {
      const prepared = prepareMcpToolCall(descriptor, args);
      return prepared.ok ? prepared.paramHeaders : `refused:${prepared.code}`;
    };
    expect(headersOf({ region: "eu", filter: { region: "us" }, outer: { inner: 7 }, inner: "text" })).toEqual({ "Mcp-Param-Region": "eu", "Mcp-Param-Inner": "us", "Mcp-Param-Page": "7" });
    expect(headersOf({ filter: { region: "us" } })).toEqual({ "Mcp-Param-Inner": "us" });
    expect(headersOf({ region: "eu", outer: {} }), "an absent nested value carries no header").toEqual({ "Mcp-Param-Region": "eu" });
    expect(headersOf({ inner: "text" }), "a top-level property of the leaf's name is never the nested value").toEqual({});
    const negotiated = await negotiate();
    const fake = fakeMcpServer(byMethod({ call: (call) => rpcResult(call, { content: [] }) }));
    await callMcpTool(server, negotiated, descriptor, { region: "eu", filter: { region: "us" }, outer: { inner: 7 } }, { purpose: "agent", deps: depsOf(fake) });
    const sent = fake.calls[0]!.headers;
    expect([sent["Mcp-Param-Region"], sent["Mcp-Param-Inner"], sent["Mcp-Param-Page"]]).toEqual(["eu", "us", "7"]);
  });

  // [B20 A2 review] correctness-05 (call side): every construct the input gate still accepts is one the call-time validator evaluates
  it("every construct an accepted input schema may hold is called with a valid value and refused with an invalid one", () => {
    const descriptor = headerTool({
      s: { type: "string", description: "a string" },
      i: { type: "integer" },
      n: { type: "number" },
      b: { type: "boolean" },
      e: { type: "string", enum: ["a", "b"] },
      u: { enum: ["x", 1] },
      list: { type: "array", items: { type: "integer" } },
      nested: schema({ inner: { type: "string" } }, ["inner"]),
      free: { type: "object" },
    }, ["s"]);
    const valid = { s: "x", i: 3, n: 1.5, b: true, e: "a", u: 1, list: [1, 2], nested: { inner: "y" }, free: { any: "thing" } };
    expect(prepareMcpToolCall(descriptor, valid)).toMatchObject({ ok: true });
    const invalid: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
      ["a string for an integer", { s: "x", i: "3" }],
      ["a fraction for an integer", { s: "x", i: 1.5 }],
      ["a string for a number", { s: "x", n: "1" }],
      ["a value outside an enum", { s: "x", e: "c" }],
      ["a value outside an untyped enum", { s: "x", u: "y" }],
      ["an array member of the wrong type", { s: "x", list: ["1"] }],
      ["a nested required property missing", { s: "x", nested: {} }],
      ["a nested unknown property", { s: "x", nested: { inner: "y", other: 1 } }],
    ];
    for (const [label, args] of invalid) expect(prepareMcpToolCall(descriptor, args), label).toMatchObject({ ok: false, code: "arguments_invalid" });
  });

  // [B20 A2 review] tests-param-header-value-bound-uncovered (call side): a value the transport would refuse is refused here,
  // before anything is built — the bound counts the value as it would be SENT (the sentinel spelling included)
  it("an annotated argument whose header value would exceed 2 048 characters is refused before anything is sent", async () => {
    const descriptor = headerTool({ region: { type: "string", "x-mcp-header": "Region" } });
    expect(prepareMcpToolCall(descriptor, { region: "v".repeat(2_048) })).toMatchObject({ ok: true, paramHeaders: { "Mcp-Param-Region": "v".repeat(2_048) } });
    expect(prepareMcpToolCall(descriptor, { region: "v".repeat(2_049) })).toMatchObject({ ok: false, code: "arguments_invalid" });
    // 1 600 characters that are not header-safe become a sentinel of more than 2 048
    expect(prepareMcpToolCall(descriptor, { region: ` ${"v".repeat(1_599)}` })).toMatchObject({ ok: false, code: "arguments_invalid" });
    const negotiated = await negotiate();
    const fake = fakeMcpServer(byMethod({}));
    expect(await callMcpTool(server, negotiated, descriptor, { region: "v".repeat(2_049) }, { purpose: "agent", deps: depsOf(fake) })).toMatchObject({ ok: false, kind: "closed", code: "arguments_invalid" });
    expect(fake.calls).toHaveLength(0);
  });

  // [B20 A2 review] security-1 (the side note): the refusal issues were scrubbed with no redaction subject at all
  it("refusal issues are compared with the sent token as well: an echo in an argument key never reaches the outcome", async () => {
    const descriptor = headerTool({ mpn: { type: "string" } }, ["mpn"]);
    const problems: string[] = [];
    for (const token of TOKENS) {
      for (const echo of [token, token.toUpperCase(), token.replace("k", KELVIN_SIGN)]) {
        const prepared = prepareMcpToolCall(descriptor, { mpn: "x", [echo]: 1 }, [token]);
        if (prepared.ok) problems.push(`${echo.slice(0, 4)}: prepared`);
        else if (prepared.issues.length === 0) problems.push(`${echo.slice(0, 4)}: no issue`);
        if (survivor(prepared, token) !== null) problems.push(`${echo.slice(0, 4)} / ${token.slice(-3)}: ${survivor(prepared, token)}`);
      }
    }
    expect(problems).toEqual([]);
    // callMcpTool resolves the token this row would send and hands it to the preparation itself
    const accepted = acceptForeignTools(tokenServer, [tool("part.search", { inputSchema: schema({ mpn: { type: "string" } }, ["mpn"]) })]).accepted[0]!;
    const negotiated = await negotiate(tokenServer);
    const fake = fakeMcpServer(byMethod({}));
    const result = await callMcpTool(tokenServer, negotiated, accepted, { mpn: "x", [TOKENS[0]!.toUpperCase()]: 1 }, { purpose: "agent", deps: depsOf(fake) });
    expect(result).toMatchObject({ ok: false, kind: "closed", code: "arguments_invalid" });
    expect(survivor(result, TOKENS[0]!)).toBeNull();
    expect(fake.calls).toHaveLength(0);
  });

  it("only the annotated properties become headers, and the arguments still travel in the body", async () => {
    const negotiated = await negotiate();
    const descriptor = headerTool({ mpn: { type: "string" }, region: { type: "string", "x-mcp-header": "Region" } }, ["mpn"]);
    const fake = fakeMcpServer(byMethod({ call: (call) => rpcResult(call, { content: [] }) }));
    await callMcpTool(server, negotiated, descriptor, { mpn: "NE555", region: "eu" }, { purpose: "agent", deps: depsOf(fake) });
    const sent = fake.calls[0]!.headers;
    expect(Object.keys(sent).filter((name) => name.startsWith("Mcp-Param-"))).toEqual(["Mcp-Param-Region"]);
    expect(fake.calls[0]!.body.params?.arguments).toEqual({ mpn: "NE555", region: "eu" });
  });
});

describe("[B20 A2] the transport's additive paramHeaders option", () => {
  const message = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "part.search", arguments: {} } } as const;

  it("a name that is not Mcp-Param-<token>, an unsafe value, more than sixteen, and a method that carries none are refused before anything is sent", async () => {
    const rows: ReadonlyArray<readonly [string, Record<string, string>, string]> = [
      ["a foreign header name", { Authorization: "Bearer x" }, "tools/call"],
      ["a name without the prefix", { "X-Region": "eu" }, "tools/call"],
      ["a lower-cased prefix that is not the one", { "mcp-param-region": "eu" }, "tools/call"],
      ["a name with a space", { "Mcp-Param-Two Words": "eu" }, "tools/call"],
      ["a name with a colon", { "Mcp-Param-a:b": "eu" }, "tools/call"],
      ["a token of 65 characters", { [`Mcp-Param-${"a".repeat(65)}`]: "eu" }, "tools/call"],
      ["a value with a control character", { "Mcp-Param-Region": `eu${ESC}` }, "tools/call"],
      ["a value with a newline", { "Mcp-Param-Region": "eu\r\nX-Injected: 1" }, "tools/call"],
      ["a value with a leading space", { "Mcp-Param-Region": " eu" }, "tools/call"],
      ["an empty value", { "Mcp-Param-Region": "" }, "tools/call"],
      ["a non-ASCII value", { "Mcp-Param-Region": String.fromCharCode(101, 117, 181) }, "tools/call"],
      ["seventeen headers", Object.fromEntries(Array.from({ length: 17 }, (_unused, index) => [`Mcp-Param-H${index}`, "v"])), "tools/call"],
      ["a method that carries no parameters", { "Mcp-Param-Region": "eu" }, "tools/list"],
      // [B20 A2 review] tests-param-header-value-bound-uncovered, tests-param-header-case-duplicate-unreached: the value bound,
      // the case-insensitive duplicate and a paramHeaders that is not an object were never reached
      ["a value of 2 049 characters", { "Mcp-Param-Region": "v".repeat(2_049) }, "tools/call"],
      ["two names differing only in case", { "Mcp-Param-Region": "a", "Mcp-Param-region": "b" }, "tools/call"],
      ["paramHeaders that are a string", "Mcp-Param-Region: eu" as unknown as Record<string, string>, "tools/call"],
      ["paramHeaders that are an array", [["Mcp-Param-Region", "eu"]] as unknown as Record<string, string>, "tools/call"],
    ];
    const problems: string[] = [];
    for (const [label, paramHeaders, method] of rows) {
      const fake = fakeMcpServer(() => json({ jsonrpc: "2.0", id: 1, result: { resultType: "complete" } }));
      const body = method === "tools/call" ? message : { jsonrpc: "2.0", id: 1, method, params: {} };
      const result = await mcpPost(server, body as typeof message, { purpose: "agent", paramHeaders, deps: depsOf(fake) });
      if (result.kind !== "closed" || result.code !== "invalid_request") problems.push(`${label}: ${result.kind}/${"code" in result ? result.code : ""}`);
      if (fake.calls.length !== 0) problems.push(`${label}: ${fake.calls.length} request(s) were sent`);
      if (JSON.stringify(result).includes("X-Injected")) problems.push(`${label}: the value reached the outcome`);
      resetAdmissionControl();
      resetMcpInFlight();
    }
    expect(problems).toEqual([]);
  });

  it("sixteen valid headers, the sentinel form and a tab inside a value are sent verbatim", async () => {
    // [B20 A2 review] a value of exactly 2 048 characters, the bound itself, is sent too
    const paramHeaders = {
      ...Object.fromEntries(Array.from({ length: 13 }, (_unused, index) => [`Mcp-Param-H${index}`, "v"])),
      "Mcp-Param-Region": "=?base64?ZXUtd2VzdA==?=",
      "Mcp-Param-Tab": "eu\twest",
      "Mcp-Param-Long": "v".repeat(2_048),
    };
    const fake = fakeMcpServer(() => json({ jsonrpc: "2.0", id: 1, result: { resultType: "complete" } }));
    const result = await mcpPost(server, message, { purpose: "agent", paramHeaders, deps: depsOf(fake) });
    expect(result.kind).toBe("complete");
    expect(fake.calls[0]!.headers["Mcp-Param-Region"]).toBe("=?base64?ZXUtd2VzdA==?=");
    expect(fake.calls[0]!.headers["Mcp-Param-Tab"]).toBe("eu\twest");
    expect(fake.calls[0]!.headers["Mcp-Param-Long"]).toBe("v".repeat(2_048));
    expect(Object.keys(fake.calls[0]!.headers).filter((name) => name.startsWith("Mcp-Param-"))).toHaveLength(16);
  });

  it("without the option nothing changes: no Mcp-Param header is ever added by the transport", async () => {
    const fake = fakeMcpServer(() => json({ jsonrpc: "2.0", id: 1, result: { resultType: "complete" } }));
    await mcpPost(server, message, { purpose: "agent", deps: depsOf(fake) });
    expect(Object.keys(fake.calls[0]!.headers).some((name) => name.toLowerCase().startsWith("mcp-param-"))).toBe(false);
  });
});

describe("[B20 A2] callMcpTool never throws (S4)", () => {
  it("junk rows, junk arguments and a hostile transport are closed outcomes with fixed sentences", async () => {
    const negotiated = await negotiate();
    const accepted = headerTool({ mpn: { type: "string" } }, ["mpn"]);
    const throwing: FakeScript = () => { throw new Error("secret-thrown-text"); };
    const junk: ReadonlyArray<readonly [string, unknown, unknown]> = [
      ["a null row", null, { purpose: "agent", deps: depsOf(fakeMcpServer(byMethod({}))) }],
      ["undefined options", server, undefined],
      ["options whose deps throw", server, Object.defineProperty({ purpose: "agent" }, "deps", { get() { throw new Error("secret-thrown-text"); } })],
      ["a transport that throws", server, { purpose: "agent", deps: depsOf(fakeMcpServer(throwing)) }],
    ];
    for (const [label, row, options] of junk) {
      // [B20 A2 review] the options are the FIFTH parameter (index 4): index 5 was a tsc error in the delivered A2 tree
      const result = await callMcpTool(row as McpServerRegistryEntry, negotiated, accepted, { mpn: "NE555" }, options as Parameters<typeof callMcpTool>[4]);
      expect(result.ok, label).toBe(false);
      expect(JSON.stringify(result), label).not.toContain("secret-thrown-text");
      resetAdmissionControl();
      resetMcpInFlight();
    }
    expect(prepareMcpToolCall(null as unknown as McpAcceptedTool, {})).toMatchObject({ ok: false, code: "not_accepted" });
  });
});
