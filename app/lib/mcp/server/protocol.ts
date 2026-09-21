/**
 * [B20 B2] The protocol half of Sirkit's MCP server (revision 2026-07-28, `mcp-reference-notes.md` sections 2, 3 and 7, and
 * the B2 re-read recorded in `mcp-server-endpoint.md`): the constants the client also uses, the `Mcp-Name` decoder, the
 * request validator with the pinned check order of D-7 steps 1 to 8, and the DiscoverResult.
 *
 * The validator's order is the contract:
 *   1. the JSON-RPC shape (-32600; the id is echoed only when it is valid);
 *   2. `MCP-Protocol-Version`: absent or over its bound is a missing required header (-32020, Server Validation), naming the
 *      supported versions (a modern-only server SHOULD name them to a legacy `initialize`); present but not supported is
 *      -32022 with the schema's two required fields, `data.supported` and `data.requested` (the header when it is
 *      date-shaped, else the empty string: nothing else a peer wrote is echoed);
 *   3. `Mcp-Method` present and equal to the method (-32020);
 *   4. no `Mcp-Param-*` header (no exposed tool declares x-mcp-header, so every one mismatches the body: -32020);
 *   5. a notification is accepted (202);
 *   6. a method other than server/discover, tools/list and tools/call is 404 -32601, before `_meta` and `Mcp-Name`;
 *   7. `params._meta` with the two required per-request fields (-32602, HTTP 400); its version equal to the header (-32020);
 *   8. `Mcp-Name`: on tools/call present and equal (after decoding) to a string `params.name`; absent otherwise (-32020).
 *
 * Every message is a fixed sentence: nothing a peer wrote is echoed except a valid id and a date-shaped requested version. An
 * error answer carries the request's id when it is readable and leaves `id` out otherwise (the 2026-07-28 schema's
 * `JSONRPCErrorResponse.id?: RequestId` is a string or a number, never null). Nothing here throws.
 */
import { MCP_NAME_HEADER_MAX_CHARS, type McpRequestHeaders } from "../../auth/mcp-bearer";

export { MCP_NAME_HEADER_MAX_CHARS };
export const MCP_SERVER_PROTOCOL_VERSION = "2026-07-28" as const;
export const MCP_SUPPORTED_PROTOCOL_VERSIONS = Object.freeze([MCP_SERVER_PROTOCOL_VERSION] as const);
export const MCP_META_KEY_PROTOCOL_VERSION = "io.modelcontextprotocol/protocolVersion" as const;
export const MCP_META_KEY_CLIENT_CAPABILITIES = "io.modelcontextprotocol/clientCapabilities" as const;
export const MCP_META_KEY_SERVER_INFO = "io.modelcontextprotocol/serverInfo" as const;
/** The server's own identity, mirroring package.json as the client's `clientInfo` does. */
export const MCP_SERVER_INFO: Readonly<{ name: string; version: string }> = Object.freeze({ name: "sirkit", version: "0.1.0" });
export const MCP_SERVED_METHODS = Object.freeze(["server/discover", "tools/list", "tools/call"] as const);
export type McpServedMethod = (typeof MCP_SERVED_METHODS)[number];
/** The JSON-RPC codes the server answers with (-32000..-32019 are never used; -32020..-32099 only as the spec defines them). */
export const MCP_JSON_RPC_ERROR_CODES = Object.freeze({
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  HEADER_MISMATCH: -32020,
  UNSUPPORTED_PROTOCOL_VERSION: -32022,
} as const);
export const MCP_JSON_RPC_MESSAGES = Object.freeze({
  PARSE_ERROR: "Parse error",
  INVALID_REQUEST: "Invalid Request",
  METHOD_NOT_FOUND: "Method not found",
  INVALID_META: "Invalid params: the required _meta fields are missing or malformed.",
  UNKNOWN_TOOL: "Unknown tool or invalid arguments",
  INVALID_CURSOR: "Invalid params: invalid cursor",
  INTERNAL_ERROR: "Internal error",
  HEADER_MISMATCH: "Header mismatch: a required MCP header is missing, malformed, or differs from the body.",
  UNSUPPORTED_PROTOCOL_VERSION: "Unsupported protocol version",
} as const);
/** A fixed sentence of at most 300 characters. */
export const MCP_DISCOVER_INSTRUCTIONS = "Sirkit serves read and inert proposal tools for one project, bound to the member whose access token you present. Nothing here approves, applies, publishes, qualifies, releases or orders anything: a person does that in Sirkit." as const;
export const MCP_CACHE_TTL_MS = 60_000;

export type JsonRpcId = string | number;
const JSON_RPC_ID_STRING = /^[A-Za-z0-9._:-]{1,128}$/;
const METHOD_PATTERN = /^[A-Za-z][A-Za-z0-9_./-]{0,127}$/;
const SENTINEL = /^=\?base64\?([\s\S]*)\?=$/;
const STANDARD_BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
/** The shape of a protocol version (the client's PROTOCOL_VERSION_PATTERN): the only peer text -32022 may echo. */
const PROTOCOL_VERSION_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
const validId = (value: unknown): value is JsonRpcId => (typeof value === "string" && JSON_RPC_ID_STRING.test(value)) || (typeof value === "number" && Number.isSafeInteger(value));

/** [B20 B2 review] The id of a message when it can be read (a plain object carrying a valid id), else null. An error answer
 *  echoes it, including one for an internal failure after the message was parsed (MCP base protocol). Never throws. */
export function readableMcpRequestId(message: unknown): JsonRpcId | null {
  try {
    if (!isPlainObject(message) || !Object.hasOwn(message, "id")) return null;
    const id: unknown = message.id;
    return validId(id) ? id : null;
  } catch {
    return null;
  }
}

// ── Mcp-Name ─────────────────────────────────────────────────────────────────

export type McpNameDecoding = { readonly ok: true; readonly value: string } | { readonly ok: false };
const NOT_DECODED: McpNameDecoding = Object.freeze({ ok: false });

/** The inverse of the client's `encodeMcpNameHeader`: the value itself, or the `=?base64?…?=` sentinel over UTF-8. The
 *  length is judged first; the base64 must be the standard alphabet and canonical; the UTF-8 is decoded fatally. */
export function decodeMcpNameHeader(value: unknown): McpNameDecoding {
  try {
    if (typeof value !== "string" || value.length === 0 || value.length > MCP_NAME_HEADER_MAX_CHARS) return NOT_DECODED;
    const sentinel = SENTINEL.exec(value);
    if (!sentinel) return Object.freeze({ ok: true, value });
    const payload = sentinel[1]!;
    if (payload.length === 0 || payload.length % 4 !== 0 || !STANDARD_BASE64.test(payload)) return NOT_DECODED;
    const bytes = Buffer.from(payload, "base64");
    if (bytes.toString("base64") !== payload) return NOT_DECODED;
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return text.length === 0 ? NOT_DECODED : Object.freeze({ ok: true, value: text });
  } catch {
    return NOT_DECODED;
  }
}

// ── The validator ─────────────────────────────────────────────────────────────

export type McpValidationError = {
  readonly kind: "error";
  readonly status: 200 | 400 | 404;
  readonly code: number;
  readonly message: string;
  readonly id: JsonRpcId | null;
  /** -32020 for a missing version header names the supported versions; -32022 carries both required fields */
  readonly data?: Readonly<{ supported: readonly string[]; requested?: string }>;
  /** the trace's closed view of the request */
  readonly traceMethod: "server/discover" | "tools/list" | "tools/call" | "notification" | "unknown" | "invalid";
  readonly outcome: "invalid_request" | "header_mismatch" | "unsupported_protocol_version" | "method_not_found" | "invalid_params" | "unknown_tool";
  readonly protocolVersion: typeof MCP_SERVER_PROTOCOL_VERSION | "";
};
export type McpValidation =
  | McpValidationError
  | { readonly kind: "notification"; readonly protocolVersion: typeof MCP_SERVER_PROTOCOL_VERSION }
  | {
      readonly kind: "request";
      readonly id: JsonRpcId;
      readonly method: McpServedMethod;
      readonly params: Readonly<Record<string, unknown>>;
      /** tools/call only: the tool name, equal to the decoded Mcp-Name */
      readonly name?: string;
      readonly protocolVersion: typeof MCP_SERVER_PROTOCOL_VERSION;
    };

const SUPPORTED_DATA = Object.freeze({ supported: MCP_SUPPORTED_PROTOCOL_VERSIONS });

function failure(status: 200 | 400 | 404, code: number, message: string, id: JsonRpcId | null, traceMethod: McpValidationError["traceMethod"], outcome: McpValidationError["outcome"], protocolVersion: McpValidationError["protocolVersion"], data?: McpValidationError["data"]): McpValidationError {
  return Object.freeze({ kind: "error", status, code, message, id, traceMethod, outcome, protocolVersion, ...(data ? { data } : {}) });
}

/** Steps 1 to 8 of D-7 over a parsed message and the bounded MCP headers. */
export function validateMcpRequest(message: unknown, headers: McpRequestHeaders): McpValidation {
  try {
    return validate(message, headers);
  } catch {
    return failure(400, MCP_JSON_RPC_ERROR_CODES.INVALID_REQUEST, MCP_JSON_RPC_MESSAGES.INVALID_REQUEST, null, "invalid", "invalid_request", "");
  }
}

function validate(message: unknown, headers: McpRequestHeaders): McpValidation {
  const C = MCP_JSON_RPC_ERROR_CODES;
  const M = MCP_JSON_RPC_MESSAGES;
  // 1. the shape: one JSON-RPC 2.0 request or notification, never a response or a batch
  if (!isPlainObject(message)) return failure(400, C.INVALID_REQUEST, M.INVALID_REQUEST, null, "invalid", "invalid_request", "");
  const hasId = Object.hasOwn(message, "id");
  const rawId: unknown = hasId ? message.id : undefined;
  const echoId: JsonRpcId | null = hasId && validId(rawId) ? rawId : null;
  const method: unknown = message.method;
  if (message.jsonrpc !== "2.0" || typeof method !== "string" || !METHOD_PATTERN.test(method) || Object.hasOwn(message, "result") || Object.hasOwn(message, "error") || (hasId && !validId(rawId))) {
    return failure(400, C.INVALID_REQUEST, M.INVALID_REQUEST, echoId, "invalid", "invalid_request", "");
  }
  const served = (MCP_SERVED_METHODS as readonly string[]).includes(method);
  const traceMethod: McpValidationError["traceMethod"] = !hasId ? "notification" : served ? (method as McpServedMethod) : "unknown";
  // 2. the protocol version header, before Mcp-Method (a legacy initialize carries neither)
  const version = headers.protocolVersion;
  if (version.state !== "present") return failure(400, C.HEADER_MISMATCH, M.HEADER_MISMATCH, echoId, traceMethod, "header_mismatch", "", SUPPORTED_DATA);
  if (!(MCP_SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(version.value)) {
    const requested = PROTOCOL_VERSION_SHAPE.test(version.value) ? version.value : "";
    return failure(400, C.UNSUPPORTED_PROTOCOL_VERSION, M.UNSUPPORTED_PROTOCOL_VERSION, echoId, traceMethod, "unsupported_protocol_version", "", Object.freeze({ supported: MCP_SUPPORTED_PROTOCOL_VERSIONS, requested }));
  }
  const protocolVersion = MCP_SERVER_PROTOCOL_VERSION;
  // 3. Mcp-Method; 4. Mcp-Param-*
  if (headers.method.state !== "present" || headers.method.value !== method) return failure(400, C.HEADER_MISMATCH, M.HEADER_MISMATCH, echoId, traceMethod, "header_mismatch", protocolVersion);
  if (headers.paramHeaderCount !== 0) return failure(400, C.HEADER_MISMATCH, M.HEADER_MISMATCH, echoId, traceMethod, "header_mismatch", protocolVersion);
  // 5. a notification is accepted and ignored
  if (!hasId) return Object.freeze({ kind: "notification", protocolVersion });
  const id = rawId as JsonRpcId;
  // 6. an unknown method, before _meta and Mcp-Name
  if (!served) return failure(404, C.METHOD_NOT_FOUND, M.METHOD_NOT_FOUND, id, "unknown", "method_not_found", protocolVersion);
  const served_ = method as McpServedMethod;
  // 7. the required per-request _meta fields (only the two are read; other keys are neither iterated nor kept)
  const params: unknown = message.params;
  const meta: unknown = isPlainObject(params) ? params._meta : undefined;
  const metaVersion: unknown = isPlainObject(meta) ? meta[MCP_META_KEY_PROTOCOL_VERSION] : undefined;
  const capabilities: unknown = isPlainObject(meta) ? meta[MCP_META_KEY_CLIENT_CAPABILITIES] : undefined;
  if (!isPlainObject(params) || !isPlainObject(meta) || typeof metaVersion !== "string" || !isPlainObject(capabilities)) {
    return failure(400, C.INVALID_PARAMS, M.INVALID_META, id, served_, "invalid_params", protocolVersion);
  }
  if (metaVersion !== version.value) return failure(400, C.HEADER_MISMATCH, M.HEADER_MISMATCH, id, served_, "header_mismatch", protocolVersion);
  // 8. Mcp-Name
  if (served_ === "tools/call") {
    const name: unknown = params.name;
    if (typeof name !== "string") return failure(200, C.INVALID_PARAMS, M.UNKNOWN_TOOL, id, served_, "unknown_tool", protocolVersion);
    if (headers.name.state !== "present") return failure(400, C.HEADER_MISMATCH, M.HEADER_MISMATCH, id, served_, "header_mismatch", protocolVersion);
    const decoded = decodeMcpNameHeader(headers.name.value);
    if (!decoded.ok || decoded.value !== name) return failure(400, C.HEADER_MISMATCH, M.HEADER_MISMATCH, id, served_, "header_mismatch", protocolVersion);
    return Object.freeze({ kind: "request", id, method: served_, params, name, protocolVersion });
  }
  if (headers.name.state !== "absent") return failure(400, C.HEADER_MISMATCH, M.HEADER_MISMATCH, id, served_, "header_mismatch", protocolVersion);
  return Object.freeze({ kind: "request", id, method: served_, params, protocolVersion });
}

// ── The DiscoverResult ────────────────────────────────────────────────────────

export interface McpDiscoverResult {
  readonly resultType: "complete";
  readonly supportedVersions: readonly string[];
  readonly capabilities: Readonly<{ tools: Readonly<{ listChanged: false }> }>;
  readonly instructions: string;
  readonly ttlMs: number;
  readonly cacheScope: "public";
  readonly _meta: Readonly<Record<typeof MCP_META_KEY_SERVER_INFO, Readonly<{ name: string; version: string }>>>;
}

const DISCOVER_RESULT: McpDiscoverResult = Object.freeze({
  resultType: "complete",
  supportedVersions: MCP_SUPPORTED_PROTOCOL_VERSIONS,
  capabilities: Object.freeze({ tools: Object.freeze({ listChanged: false as const }) }),
  instructions: MCP_DISCOVER_INSTRUCTIONS,
  ttlMs: MCP_CACHE_TTL_MS,
  cacheScope: "public",
  _meta: Object.freeze({ [MCP_META_KEY_SERVER_INFO]: MCP_SERVER_INFO }),
});

/** server/discover: the same frozen result for every caller (it depends on no principal). */
export function renderMcpDiscoverResult(): McpDiscoverResult {
  return DISCOVER_RESULT;
}

// ── Responses ─────────────────────────────────────────────────────────────────

const JSON_NO_STORE = { "Cache-Control": "no-store" } as const;

export function mcpResultResponse(id: JsonRpcId, result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id, result }, { status: 200, headers: JSON_NO_STORE });
}
/** A JSON-RPC error; `id` is left out when it could not be read (null here), never sent as null. */
export function mcpErrorResponse(status: number, id: JsonRpcId | null, code: number, message: string, data?: unknown): Response {
  return Response.json({ jsonrpc: "2.0", ...(id === null ? {} : { id }), error: { code, message, ...(data === undefined ? {} : { data }) } }, { status, headers: JSON_NO_STORE });
}
/** A notification accepted: 202 and no body (so no media type). */
export function mcpAcceptedResponse(): Response {
  return new Response(null, { status: 202, headers: JSON_NO_STORE });
}
