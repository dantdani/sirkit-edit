/**
 * [B20 B2] The JSON-RPC dispatch of Sirkit's MCP endpoint (D-7; OD-57). It runs only after `mcpBearerJsonRoute` has
 * authenticated the bearer principal against the LIVE membership, and it serves three methods:
 *
 *  - server/discover: the DiscoverResult (the same for every caller);
 *  - tools/list: B1's rendering of the MCP subset (`renderMcpToolListing`), filtered to the tools whose `requiredRoles`
 *    include the caller's mapped project role — never re-derived here. `ttlMs` 60 000, `cacheScope` private and the registry
 *    and listing digests of the caller's WHOLE served listing on every page; [B20 C2] pages of 32 in the listing's own order
 *    with a secretless recomputed cursor (`tool-pages.ts`, OD-97/OD-98) — a cursor this server would not mint, malformed or
 *    not, is one identical 200 -32602 that echoes nothing, and the last page carries no `nextCursor`;
 *  - tools/call: [B20 B3] a listed READ is served by the read pipeline (`read-call.ts`) from the project's durable server
 *    board; [B20 B4] no proposal is listed (OD-82, OD-87); any other name — withheld, role-filtered, never exposed or
 *    nonexistent — and non-object arguments answer one identical -32602 that echoes nothing.
 *
 * MCP is an adapter here: nothing this module reaches can approve, bind, withdraw, rebind, purchase, qualify or release
 * (b20-b2-import-gates J2), and none of its first-party modules starts a process or a thread through a process, thread or vm
 * module, a built-in loaded by name, an internal binding or string-compiled code, and the third-party packages it reaches are
 * a reviewed list ([B20 B4] b20-b4-process-gate, which does not walk inside those packages; J2 forbids only the fab runner).
 * [B20 B3 review] Since B3 its import closure also holds the B05 read service (through read-call.ts alone, b20-b3-import-gates
 * G1), the static fabrication preset data, and durable modules that CAN write - pcb-sync snapshot and board PUBLICATION and
 * board-lineage derivation, reached only through the durable read bundle, and the durable workflow runtime, reached only
 * through the read runtime (G7). [B20 B3 lead] Every one of those writes goes through `workflow.commit`. That a served read
 * writes no database is enforced at run time, not by the import gate: the read reaches the durable repository only through
 * `readOnlyDurableWorkflow`, which refuses every write without delegating (b20-b3-durable-read-bundle A12,
 * b20-b3-mcp-tools-call-reads H10 and H15). One closed trace record is kept per handled request; anything thrown is the
 * JSON-RPC internal error.
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
import { serveMcpReadCall, type McpReadDependencies } from "./read-call";
import { MCP_SERVER_TRACE_SCHEMA, recordMcpServerRequest, type McpServerTraceMethod, type McpServerTraceOutcome } from "./request-trace";
import { MCP_TOOL_LISTING_SCHEMA, renderMcpToolListing, type McpToolDefinition, type McpToolListing } from "./tool-definitions";
import { mcpToolsListCursorWellFormed, mcpToolsListPage, mcpToolsListPageSize, type McpToolsListCursorInput } from "./tool-pages"; // [B20 C2] OD-97

/** [B20 B4] The closed refusal of a listed tool with no serving path: none since B4 (every listed tool is a served read), kept as defence. */
export const MCP_NOT_SERVED_TEXT = "This tool is listed but not yet served; nothing was done." as const;

export interface McpDispatchDeps {
  /** the canonical registry (tests may inject another) */
  readonly registry?: ToolRegistry;
  /** [B20 B3] the served reads' dependencies, resolved by the route inside the authenticated callback; absent or null, a
   *  listed read refuses durable_board_unavailable after its call-level checks */
  readonly reads?: McpReadDependencies | null;
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

async function handle(input: McpBearerJsonInput, registry: ToolRegistry, reads: McpReadDependencies | null): Promise<Handled> {
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
    // [B20 C2] the SHAPE of a present cursor is judged before the listing is computed: a malformed one (the empty string
    // included) costs nothing and answers identically whatever the registry does — B2's byte-for-byte answer (OD-97)
    const cursor: McpToolsListCursorInput = Object.hasOwn(params, "cursor") ? { present: true, value: params.cursor } : { present: false };
    const cursorRefused = (): Handled => done(mcpErrorResponse(200, id, C.INVALID_PARAMS, M.INVALID_CURSOR), "cursor_refused", 200);
    if (cursor.present && !mcpToolsListCursorWellFormed(cursor.value)) return cursorRefused();
    const served = servedListing(registry, input.principal.role);
    const size = mcpToolsListPageSize();
    const page = mcpToolsListPage(served, cursor, size);
    if (page.kind === "invalid_cursor") return cursorRefused();
    // DEFENCE, unreachable from here: `served.tools` is always an array, its digest always the helper's non-empty string
    // and `size` always inside the reviewed bounds (b20-c2 G9 pins all three). A throw is the same 500 -32603 a refusing
    // listing answers — which is what a broken listing actually answers, before this line (G12).
    if (page.kind === "internal") throw new Error("MCP_TOOLS_LIST_PAGE_INTERNAL");
    // [B20 C2] OD-98: every page carries the same identity — `ttlMs`, `cacheScope` and the digest of the caller's WHOLE
    // served listing. The key order is B2's, and a single page carries no `nextCursor` key, so a one-page body is
    // byte-identical to the pre-C2 answer.
    const result = {
      resultType: "complete",
      tools: page.tools,
      ttlMs: MCP_CACHE_TTL_MS,
      cacheScope: "private",
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      _meta: { ...SERVER_INFO_META, "dev.sirkit/registryDigest": served.registryDigest, "dev.sirkit/listingDigest": served.listingDigest },
    };
    return done(mcpResultResponse(id, result), "listed", 200, { listingDigest: served.listingDigest });
  }

  // tools/call: arguments first, then the served listing; one identical answer for every name that is not served
  const unknown = (outcome: McpServerTraceOutcome, listingDigest: string | null): Handled => done(mcpErrorResponse(200, id, C.INVALID_PARAMS, M.UNKNOWN_TOOL), outcome, 200, { listingDigest });
  if (Object.hasOwn(params, "arguments") && !isPlainObject(params.arguments)) return unknown("arguments_invalid", null);
  const served = servedListing(registry, input.principal.role);
  const name = verdict.name!;
  const listed = served.tools.find((tool) => tool.name === name);
  if (!listed) return unknown("unknown_tool", served.listingDigest);
  // [B20 B3] a listed read is served from the durable server board; a malformed _meta binding is -32602 with HTTP 400
  const toolVersion = listed._meta["dev.sirkit/toolVersion"];
  if (registry.get(name, toolVersion)?.operationClass === "read") {
    const answer = await serveMcpReadCall({ principal: input.principal, toolId: name, toolVersion, params, registry, registryDigest: served.registryDigest, listingDigest: served.listingDigest, signal: input.signal }, reads);
    if (answer.kind === "invalid_params") return done(mcpErrorResponse(400, id, C.INVALID_PARAMS, M.INVALID_META), "invalid_params", 400, { toolId: name, listingDigest: served.listingDigest });
    const outcome: McpServerTraceOutcome = answer.outcome === "succeeded" || answer.outcome === "replayed" ? "read_served" : "read_refused";
    return done(mcpResultResponse(id, answer.result), outcome, 200, { toolId: name, listingDigest: served.listingDigest });
  }
  // [B20 B4] defence only: a listed tool with no serving path (none since B4; the ratchet is b20-b4-withhold-proposals case 5)
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
    handled = await handle(input, registry, deps.reads ?? null);
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
