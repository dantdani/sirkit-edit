/**
 * [B20 B2] The MCP server's request trace `sirkit.mcp-server-request.v1` (D-10; OD-65): one closed record per request the
 * dispatch handled, per process. It names the principal by ids, role, live membership revision and a digest of the token
 * id — never the token, the token id, a header, a method or tool name the server does not serve, or anything else a peer
 * wrote. `AgentTraceIdentity` is untouched: [B20 B3] B3 does not widen its provider (OD-72) — a served read keeps its own closed
 * record, `sirkit.mcp-read-trace.v1` (read-trace.ts).
 *
 * Refusals of the wrapper, before the dispatch runs, are not traced (a recorded limit). A record outside the closed schema is
 * dropped; a sink that fails never changes the response. The default sink is a per-process ring of 1 000 records.
 */
import { ID_PATTERN } from "../../auth/trusted-request-context";
import type { ProjectRole } from "../../engineering/types";

export const MCP_SERVER_TRACE_SCHEMA = "sirkit.mcp-server-request.v1" as const;
export const MCP_SERVER_TRACE_RING_MAX = 1000;
export const MCP_SERVER_TRACE_METHODS = Object.freeze(["server/discover", "tools/list", "tools/call", "notification", "unknown", "invalid"] as const);
export type McpServerTraceMethod = (typeof MCP_SERVER_TRACE_METHODS)[number];
export const MCP_SERVER_TRACE_OUTCOMES = Object.freeze([
  "discovered",
  "listed",
  "not_served",
  // [B20 B3] a listed read served (a success or a replay) or refused with a closed tool-result code (the read trace has the code)
  "read_served",
  "read_refused",
  "unknown_tool",
  "arguments_invalid",
  "cursor_refused",
  "invalid_params",
  "invalid_request",
  "header_mismatch",
  "unsupported_protocol_version",
  "method_not_found",
  "notification_accepted",
  "internal_error",
] as const);
export type McpServerTraceOutcome = (typeof MCP_SERVER_TRACE_OUTCOMES)[number];

export interface McpServerTracePrincipal {
  readonly tenantId: string;
  readonly projectId: string;
  readonly branchId: string;
  readonly principalId: string;
  readonly role: ProjectRole;
  readonly membershipRevision: string;
  readonly authMethod: "mcp_bearer";
  readonly tokenIdDigest: string;
}

export interface McpServerRequestTrace {
  readonly schema: typeof MCP_SERVER_TRACE_SCHEMA;
  readonly requestId: string;
  readonly receivedAtMs: number;
  readonly elapsedMs: number;
  readonly method: McpServerTraceMethod;
  /** a served tool id, or null */
  readonly toolId: string | null;
  readonly outcome: McpServerTraceOutcome;
  readonly httpStatus: number;
  readonly protocolVersion: "2026-07-28" | "";
  readonly principal: McpServerTracePrincipal;
  readonly registryDigest: string;
  readonly listingDigest: string | null;
}

export interface McpServerTraceSink {
  record(trace: McpServerRequestTrace): void;
}

const PROJECT_ROLES: readonly string[] = Object.freeze(["viewer", "commenter", "pcb_editor", "automation", "reviewer", "project_admin", "migration_admin"]);
const REQUEST_ID = /^mcpreq-[0-9a-f]{16}$/;
const TOOL_ID = /^[A-Za-z0-9_.-]{1,128}$/;
const DIGEST = /^eng1-[0-9a-f]{16}$/;
const MEMBERSHIP_REVISION = /^mbr1-[0-9a-f]{16}$/;
const TOKEN_ID_DIGEST = /^[0-9a-f]{32}$/;
const nonNegativeInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const id = (value: unknown): value is string => typeof value === "string" && ID_PATTERN.test(value);

/** A closed, frozen copy of exactly the schema's fields, or null when any field is outside it. */
function closedCopy(input: unknown): McpServerRequestTrace | null {
  if (typeof input !== "object" || input === null) return null;
  const record = input as Record<string, unknown>;
  const { schema, requestId, receivedAtMs, elapsedMs, method, toolId, outcome, httpStatus, protocolVersion, principal, registryDigest, listingDigest } = record;
  if (schema !== MCP_SERVER_TRACE_SCHEMA || typeof requestId !== "string" || !REQUEST_ID.test(requestId)) return null;
  if (!nonNegativeInteger(receivedAtMs) || !nonNegativeInteger(elapsedMs)) return null;
  if (!(MCP_SERVER_TRACE_METHODS as readonly unknown[]).includes(method) || !(MCP_SERVER_TRACE_OUTCOMES as readonly unknown[]).includes(outcome)) return null;
  if (toolId !== null && (typeof toolId !== "string" || !TOOL_ID.test(toolId))) return null;
  if (typeof httpStatus !== "number" || !Number.isInteger(httpStatus) || httpStatus < 100 || httpStatus > 599) return null;
  if (protocolVersion !== "2026-07-28" && protocolVersion !== "") return null;
  if (typeof registryDigest !== "string" || (registryDigest !== "" && !DIGEST.test(registryDigest))) return null;
  if (listingDigest !== null && (typeof listingDigest !== "string" || !DIGEST.test(listingDigest))) return null;
  if (typeof principal !== "object" || principal === null) return null;
  const p = principal as Record<string, unknown>;
  if (!id(p.tenantId) || !id(p.projectId) || !id(p.branchId) || !id(p.principalId)) return null;
  if (typeof p.role !== "string" || !PROJECT_ROLES.includes(p.role)) return null;
  if (typeof p.membershipRevision !== "string" || !MEMBERSHIP_REVISION.test(p.membershipRevision)) return null;
  if (p.authMethod !== "mcp_bearer" || typeof p.tokenIdDigest !== "string" || !TOKEN_ID_DIGEST.test(p.tokenIdDigest)) return null;
  return Object.freeze({
    schema,
    requestId,
    receivedAtMs,
    elapsedMs,
    method: method as McpServerTraceMethod,
    toolId: toolId as string | null,
    outcome: outcome as McpServerTraceOutcome,
    httpStatus,
    protocolVersion,
    principal: Object.freeze({ tenantId: p.tenantId, projectId: p.projectId, branchId: p.branchId, principalId: p.principalId, role: p.role as ProjectRole, membershipRevision: p.membershipRevision, authMethod: "mcp_bearer", tokenIdDigest: p.tokenIdDigest }),
    registryDigest,
    listingDigest: listingDigest as string | null,
  });
}

const ring: McpServerRequestTrace[] = [];
const RING_SINK: McpServerTraceSink = {
  record(trace) {
    ring.push(trace);
    while (ring.length > MCP_SERVER_TRACE_RING_MAX) ring.shift();
  },
};
const DEFAULT_SINK_FACTORY = (): McpServerTraceSink | null => RING_SINK;
let sinkFactory: () => McpServerTraceSink | null = DEFAULT_SINK_FACTORY;

/** Seam (the `identity-runtime.ts` pattern): a durable sink can replace the per-process ring. */
export function setMcpServerTraceSinkFactory(factory: () => McpServerTraceSink | null): void {
  sinkFactory = factory;
}
/** Restores the ring sink and empties the ring. */
export function resetMcpServerTraceSinkFactory(): void {
  sinkFactory = DEFAULT_SINK_FACTORY;
  ring.length = 0;
}

/** Record one closed trace. Never throws: an invalid record is dropped, a failing factory or sink is contained. */
export function recordMcpServerRequest(trace: McpServerRequestTrace): void {
  try {
    const copy = closedCopy(trace);
    if (copy === null) return;
    sinkFactory()?.record(copy);
  } catch {
    // a trace sink never alters the response
  }
}

/** The ring's records, oldest first (a frozen copy). */
export function mcpServerTraceRing(): readonly McpServerRequestTrace[] {
  return Object.freeze([...ring]);
}
