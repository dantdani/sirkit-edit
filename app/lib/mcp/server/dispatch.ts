/**
 * [B20 B2] The JSON-RPC dispatch of Sirkit's MCP endpoint (D-7; OD-57). It runs only after `mcpBearerJsonRoute` has
 * authenticated the bearer principal against the LIVE membership, and it serves three methods:
 *
 *  - server/discover: the DiscoverResult (the same for every caller);
 *  - tools/list: B1's rendering of the MCP subset (`renderMcpToolListing`), filtered to the tools whose `requiredRoles`
 *    include the caller's mapped project role — never re-derived here. `ttlMs` 60 000, `cacheScope` private, the registry
 *    and listing digests in `_meta`, no pagination (a cursor is -32602);
 *  - tools/call: a listed tool answers a closed refusal (`not_served`: B3 serves reads, B4 proposals); any other name —
 *    role-filtered, never exposed or nonexistent — and non-object arguments answer one identical -32602 that echoes nothing.
 *
 * MCP is an adapter here: nothing this module reaches can publish, approve, bind, withdraw, rebind, purchase, qualify or
 * release, run a process, replace state or write a database or file (b20-b2-import-gates). One closed trace record is kept
 * per handled request; anything thrown is the JSON-RPC internal error.
 */
import type { McpBearerJsonInput } from "../../auth/route-handlers";
import { mcpServerNowMs } from "../../auth/mcp-bearer";
import { engineeringDigest } from "../../engineering/stable";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";
import type { ToolRegistry } from "../../engineering/tool-registry";
import {
  MCP_CACHE_TTL_MS,
  MCP_JSON_RPC_ERROR_CODES,
  MCP_JSON_RPC_MESSAGES,
  MCP_META_KEY_SERVER_INFO,
  MCP_SERVER_INFO,
  isPlainObject,
  mcpAcceptedResponse,
  mcpErrorResponse,
  mcpResultResponse,
  readableMcpRequestId,
  renderMcpDiscoverResult,
  validateMcpRequest,
  type JsonRpcId,
} from "./protocol";
import { MCP_SERVER_TRACE_SCHEMA, recordMcpServerRequest, type McpServerTraceMethod, type McpServerTraceOutcome } from "./request-trace";
import { MCP_TOOL_LISTING_SCHEMA, renderMcpToolListing, type McpToolDefinition, type McpToolListing } from "./tool-definitions";

/** The text of the closed refusal a listed tool answers until B3/B4 serve it. */
export const MCP_NOT_SERVED_TEXT = "This tool is listed but not yet served; nothing was done." as const;

export interface McpDispatchDeps {
  /** the canonical registry (tests may inject another) */
  readonly registry?: ToolRegistry;
}

interface ServedListing {
  readonly tools: readonly McpToolDefinition[];
  readonly registryDigest: string;
  readonly listingDigest: string;
}

const listings = new WeakMap<ToolRegistry, McpToolListing>();
const registryDigests = new WeakMap<ToolRegistry, string>();

/** B1's listing of the registry (a typed refusal propagates: never a partial list), memoised per immutable registry. */
function listingOf(registry: ToolRegistry): McpToolListing {
  let listing = listings.get(registry);
  if (listing === undefined) {
    listing = renderMcpToolListing(registry);
    listings.set(registry, listing);
  }
  return listing;
}
function registryDigestOf(registry: ToolRegistry): string {
  try {
    let digest = registryDigests.get(registry);
    if (digest === undefined) {
      digest = registry.digest();
      registryDigests.set(registry, digest);
    }
    return digest;
  } catch {
    return "";
  }
}

/** OD-57: the subset whose requiredRoles include the caller's mapped project role (the role predicate discoverTools applies). */
function servedListing(registry: ToolRegistry, role: string): ServedListing {
  const listing = listingOf(registry);
  const tools = listing.tools.filter((tool) => registry.get(tool.name, tool._meta["dev.sirkit/toolVersion"])?.requiredRoles.includes(role as never) === true);
  return { tools, registryDigest: listing.registryDigest, listingDigest: engineeringDigest({ schema: MCP_TOOL_LISTING_SCHEMA, registryDigest: listing.registryDigest, tools }) };
}

const SERVER_INFO_META = Object.freeze({ [MCP_META_KEY_SERVER_INFO]: MCP_SERVER_INFO });

interface Handled {
  response: Response;
  method: McpServerTraceMethod;
  outcome: McpServerTraceOutcome;
  httpStatus: number;
  toolId: string | null;
  protocolVersion: "2026-07-28" | "";
  listingDigest: string | null;
}

function handle(input: McpBearerJsonInput, registry: ToolRegistry): Handled {
  const C = MCP_JSON_RPC_ERROR_CODES;
  const M = MCP_JSON_RPC_MESSAGES;
  const verdict = validateMcpRequest(input.message, input.mcp);
  if (verdict.kind === "error") {
    return { response: mcpErrorResponse(verdict.status, verdict.id, verdict.code, verdict.message, verdict.data), method: verdict.traceMethod, outcome: verdict.outcome, httpStatus: verdict.status, toolId: null, protocolVersion: verdict.protocolVersion, listingDigest: null };
  }
  if (verdict.kind === "notification") {
    return { response: mcpAcceptedResponse(), method: "notification", outcome: "notification_accepted", httpStatus: 202, toolId: null, protocolVersion: verdict.protocolVersion, listingDigest: null };
  }
  const { id, params, protocolVersion } = verdict;
  const done = (response: Response, outcome: McpServerTraceOutcome, httpStatus: number, extra: { toolId?: string | null; listingDigest?: string | null } = {}): Handled =>
    ({ response, method: verdict.method, outcome, httpStatus, toolId: extra.toolId ?? null, protocolVersion, listingDigest: extra.listingDigest ?? null });

  if (verdict.method === "server/discover") return done(mcpResultResponse(id, renderMcpDiscoverResult()), "discovered", 200);

  if (verdict.method === "tools/list") {
    // no pagination in B2: every cursor (the empty string included) is invalid
    if (Object.hasOwn(params, "cursor")) return done(mcpErrorResponse(200, id, C.INVALID_PARAMS, M.INVALID_CURSOR), "cursor_refused", 200);
    const served = servedListing(registry, input.principal.role);
    const result = {
      resultType: "complete",
      tools: served.tools,
      ttlMs: MCP_CACHE_TTL_MS,
      cacheScope: "private",
      _meta: { ...SERVER_INFO_META, "dev.sirkit/registryDigest": served.registryDigest, "dev.sirkit/listingDigest": served.listingDigest },
    };
    return done(mcpResultResponse(id, result), "listed", 200, { listingDigest: served.listingDigest });
  }

  // tools/call: arguments first, then the served listing; one identical answer for every name that is not served
  const unknown = (outcome: McpServerTraceOutcome, listingDigest: string | null): Handled => done(mcpErrorResponse(200, id, C.INVALID_PARAMS, M.UNKNOWN_TOOL), outcome, 200, { listingDigest });
  if (Object.hasOwn(params, "arguments") && !isPlainObject(params.arguments)) return unknown("arguments_invalid", null);
  const served = servedListing(registry, input.principal.role);
  const name = verdict.name!;
  if (!served.tools.some((tool) => tool.name === name)) return unknown("unknown_tool", served.listingDigest);
  const refusal = {
    resultType: "complete",
    content: [{ type: "text", text: MCP_NOT_SERVED_TEXT }],
    isError: true,
    _meta: { ...SERVER_INFO_META, "dev.sirkit/refusal": "not_served" },
  };
  return done(mcpResultResponse(id, refusal), "not_served", 200, { toolId: name, listingDigest: served.listingDigest });
}

const traceMethodOf = (message: unknown): McpServerTraceMethod => {
  try {
    if (!isPlainObject(message)) return "invalid";
    const method = message.method;
    if (method === "server/discover" || method === "tools/list" || method === "tools/call") return Object.hasOwn(message, "id") ? method : "notification";
    return "unknown";
  } catch {
    return "invalid";
  }
};

/** Handle one authenticated JSON-RPC message. Never throws: anything thrown is 500 -32603, echoing the id when it is readable. */
export async function handleMcpRequest(input: McpBearerJsonInput, deps: McpDispatchDeps = {}): Promise<Response> {
  const receivedAtMs = mcpServerNowMs();
  let registry: ToolRegistry | null = null;
  let handled: Handled;
  try {
    registry = deps.registry ?? sirkitToolRegistry();
    handled = handle(input, registry);
  } catch {
    const response = mcpErrorResponse(500, readableMcpRequestId(input?.message), MCP_JSON_RPC_ERROR_CODES.INTERNAL_ERROR, MCP_JSON_RPC_MESSAGES.INTERNAL_ERROR);
    handled = { response, method: traceMethodOf(input?.message), outcome: "internal_error", httpStatus: 500, toolId: null, protocolVersion: "", listingDigest: null };
  }
  const finishedAtMs = mcpServerNowMs();
  const principal = input?.principal;
  recordMcpServerRequest({
    schema: MCP_SERVER_TRACE_SCHEMA,
    requestId: principal?.requestId,
    receivedAtMs,
    elapsedMs: Number.isSafeInteger(finishedAtMs - receivedAtMs) && finishedAtMs >= receivedAtMs ? finishedAtMs - receivedAtMs : 0,
    method: handled.method,
    toolId: handled.toolId,
    outcome: handled.outcome,
    httpStatus: handled.httpStatus,
    protocolVersion: handled.protocolVersion,
    principal: {
      tenantId: principal?.tenantId,
      projectId: principal?.projectId,
      branchId: principal?.branchId,
      principalId: principal?.principalId,
      role: principal?.role,
      membershipRevision: principal?.membershipRevision,
      authMethod: "mcp_bearer",
      tokenIdDigest: principal?.tokenIdDigest,
    },
    registryDigest: registry ? registryDigestOf(registry) : "",
    listingDigest: handled.listingDigest,
  } as Parameters<typeof recordMcpServerRequest>[0]);
  return handled.response;
}

export type { JsonRpcId };
