/**
 * [B20 A2] The in-process scripted fake MCP server of the A2 suites, injected through the egress seam (`OutboundDeps`): no
 * network, no DNS, no real server, no real credential. It records every request exactly as the transport put it on the
 * wire and answers by JSON-RPC METHOD from a script. Every credential here is an obvious fake assembled at run time.
 */
import type { McpTransportDeps } from "../http-transport";
import type { McpServerRegistryEntry } from "../server-registry";
import { fixtureServer, T0 } from "./_fixtures";

export const PUBLIC = async (): Promise<string[]> => ["93.184.216.34"];
export const TOKEN_ENV = "MCP_DOCS_TOKEN";
const TOKEN_STEM = ["fake", "mcp", "token"].join("-");
/** S8: the same obvious fake ending in a letter, in a digit and in '=' in turn (RFC 6750 b64token characters only). */
export const TOKENS: readonly string[] = Object.freeze([`${TOKEN_STEM}-a1b2c3d4e5fe`, `${TOKEN_STEM}-a1b2c3d4e5f6`, `${TOKEN_STEM}-a1b2c3d4e5f6=`]);

const base = fixtureServer();
/**
 * A wide server window, so a suite of many calls under the frozen clock is not refused by admission, and the registry's
 * LARGEST body ceiling (8 MB), so a hostile answer reaches the A2 gates instead of the transport's row ceiling — which
 * is the first bound in production and is pinned by the A1 suite, not here.
 */
export const WIDE = { limits: { ...base.limits, requestsPerMinute: 600, maxConcurrent: 4, maxResponseBytes: 8_000_000 } };
export const server = fixtureServer(WIDE);
export const tokenServer = fixtureServer({ id: "docs-token", ...WIDE, auth: { mode: "pre-issued-token-env", secrets: [{ env: TOKEN_ENV, role: "access-token" }], scopes: [] } });
export const compatServer = fixtureServer({ id: "docs-compat", ...WIDE, supportedProtocolVersions: ["2026-07-28", "2025-11-25"], compatibilityEra: true });
/** A row that lists a revision NEWER than the current one: only a crafted row can (the registry validator knows two). */
export const futureServer = fixtureServer({ id: "docs-future", ...WIDE, supportedProtocolVersions: ["2027-01-15", "2026-07-28"] });
export const wideServer = (id: string, overrides: Partial<McpServerRegistryEntry> = {}): McpServerRegistryEntry => fixtureServer({ id, ...WIDE, ...overrides });

export interface FakeCall {
  url: string;
  httpMethod: string | undefined;
  headers: Record<string, string>;
  body: { jsonrpc?: string; id?: string | number; method?: string; params?: Record<string, unknown> };
  raw: string;
}
export type FakeScript = (call: FakeCall, index: number) => Response | Promise<Response>;

export function fakeMcpServer(script: FakeScript): { calls: FakeCall[]; transport: typeof fetch } {
  const calls: FakeCall[] = [];
  const transport: typeof fetch = async (input, init) => {
    const raw = typeof init?.body === "string" ? init.body : "";
    let body: FakeCall["body"] = {};
    try { body = JSON.parse(raw) as FakeCall["body"]; } catch { body = {}; }
    const call: FakeCall = { url: String(input), httpMethod: init?.method, headers: { ...((init?.headers ?? {}) as Record<string, string>) }, body, raw };
    calls.push(call);
    return script(call, calls.length - 1);
  };
  return { calls, transport };
}

export const json = (value: unknown, status = 200, headers: Record<string, string> = {}): Response => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
export const text = (body: string | null, status: number, headers: Record<string, string> = {}): Response => new Response(body, { status, headers });
export const rpcResult = (call: FakeCall, result: Record<string, unknown>): Response => json({ jsonrpc: "2.0", id: call.body.id, result: { resultType: "complete", ...result } });
export const rpcRaw = (call: FakeCall, result: unknown): Response => json({ jsonrpc: "2.0", id: call.body.id, result });
export const rpcError = (call: FakeCall, code: number, message: string, data?: unknown, status = 400): Response => json({ jsonrpc: "2.0", id: call.body.id, error: { code, message, ...(data === undefined ? {} : { data }) } }, status);

export const SERVER_INFO_META = "io.modelcontextprotocol/serverInfo";
/** A well-formed DiscoverResult; `overrides` replace whole fields (undefined removes one). */
export function discoverResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const result: Record<string, unknown> = {
    supportedVersions: ["2026-07-28"],
    capabilities: { tools: { listChanged: false } },
    instructions: "Look up parts by manufacturer part number.",
    ttlMs: 0,
    cacheScope: "private",
    _meta: { [SERVER_INFO_META]: { name: "docs-fixture", version: "1.2.3" } },
    ...overrides,
  };
  for (const key of Object.keys(result)) if (result[key] === undefined) delete result[key];
  return result;
}

export interface MethodScript {
  discover?: (call: FakeCall, index: number) => Response | Promise<Response>;
  list?: (call: FakeCall, index: number) => Response | Promise<Response>;
  call?: (call: FakeCall, index: number) => Response | Promise<Response>;
}
/** Answer by JSON-RPC method; `server/discover` defaults to a well-formed DiscoverResult. */
export function byMethod(script: MethodScript): FakeScript {
  return (call, index) => {
    switch (call.body.method) {
      case "server/discover": return script.discover ? script.discover(call, index) : rpcResult(call, discoverResult());
      case "tools/list": return script.list ? script.list(call, index) : rpcResult(call, { tools: [], ttlMs: 0, cacheScope: "private" });
      case "tools/call": return script.call ? script.call(call, index) : rpcResult(call, { content: [] });
      default: return rpcError(call, -32601, "method not found", undefined, 404);
    }
  };
}

export function depsOf(fake: { transport: typeof fetch }, token: string = TOKENS[0]!, extra: Partial<McpTransportDeps> = {}): McpTransportDeps {
  return { fetch: fake.transport, resolve: PUBLIC, clock: () => T0, environment: { [TOKEN_ENV]: token }, ...extra };
}

/** The skeleton an outcome is read by: NFKD without combining marks and format characters; a disguised survivor is the token again. */
export const skeleton = (value: string): string => value.normalize("NFKD").replace(/[\p{M}\p{Cf}]/gu, "");
/** The first 8-character window of `token` found in the skeleton of the serialised value (case-folded), or null. */
export function survivor(value: unknown, token: string): string | null {
  const serialized = skeleton(JSON.stringify(value) ?? "").toLowerCase();
  const subject = token.toLowerCase();
  for (let start = 0; start + 8 <= subject.length; start += 1) if (serialized.includes(subject.slice(start, start + 8))) return subject.slice(start, start + 8);
  return null;
}

/** A plain valid tool definition as a server would list it. */
export function tool(name: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const definition: Record<string, unknown> = {
    name,
    title: "Part search",
    description: "Search the component catalogue by manufacturer part number and return up to ten matches.",
    inputSchema: { type: "object", properties: { mpn: { type: "string", description: "Manufacturer part number" } }, required: ["mpn"], additionalProperties: false },
    ...overrides,
  };
  for (const key of Object.keys(definition)) if (definition[key] === undefined) delete definition[key];
  return definition;
}

/**
 * [B20 A2 review] Every string of a value — each leaf AND each object key, at every depth — as it IS, never serialised:
 * `JSON.stringify` writes a C0 control as an escape, so a regex over the serialised text can never see ESC or NUL.
 */
export function stringsOf(value: unknown): string[] {
  const found: string[] = [];
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const next = stack.pop();
    if (typeof next === "string") found.push(next);
    else if (Array.isArray(next)) stack.push(...next);
    else if (typeof next === "object" && next !== null) {
      for (const key of Object.keys(next)) {
        found.push(key);
        stack.push((next as Record<string, unknown>)[key]);
      }
    }
  }
  return found;
}
/** [B20 A2 review] The strings of a value that carry a control or format character, read raw (see `stringsOf`). */
export const nonInert = (value: unknown): string[] => stringsOf(value).filter((entry) => /[\p{Cc}\p{Cf}]/u.test(entry));

export const ESC = String.fromCharCode(27);
export const NUL = String.fromCharCode(0);
export const BIDI_OVERRIDE = String.fromCharCode(8238);
export const ZERO_WIDTH_SPACE = String.fromCharCode(8203);
export const ZERO_WIDTH_JOINER = String.fromCharCode(8205);
export const COMBINING_ACUTE = String.fromCharCode(769);
export const KELVIN_SIGN = String.fromCharCode(8490);
/** ASCII letters as FULLWIDTH forms (NFKD folds them back). */
export const fullwidth = (value: string): string => Array.from(value, (char) => { const code = char.charCodeAt(0); return code >= 33 && code <= 126 ? String.fromCharCode(code + 65248) : char; }).join("");
