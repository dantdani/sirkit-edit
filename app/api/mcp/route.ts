/**
 * POST /api/mcp
 *
 * [B20 B2] The Sirkit MCP endpoint: MCP revision 2026-07-28 over Streamable HTTP, one JSON-RPC request or notification per
 * POST, answered with application/json only (no stream in B2). A Sirkit-issued bearer token (POST /api/mcp/token) is
 * verified on every call and the member's LIVE membership is re-read; the dispatch serves server/discover, tools/list (the
 * member's role subset of the MCP exposure) and tools/call. [B20 B3] A listed read is served from the project's durable
 * server board; its dependencies are resolved inside the authenticated callback only, never at module scope. [B20 B4] No
 * proposal is listed: MCP exposure is read-only in B20 (OD-82, OD-87).
 * GET, DELETE and OPTIONS are not exported (a legacy GET stream or session DELETE answers 405; OPTIONS is Next's own 204 - both measured on the wire by e2e/mcp-endpoint.spec.ts, B20-D3).
 */
import { mcpBearerJsonRoute } from "@/app/lib/auth/route-handlers";
import { handleMcpRequest } from "@/app/lib/mcp/server/dispatch";
import { resolveMcpReadDependencies } from "./read-runtime";

export const runtime = "nodejs";

const MCP_ENDPOINT_MAX_BYTES = 65_536;
const MCP_ENDPOINT_DEADLINE_MS = 10_000;

// [B20 B2] canonical wrapper: flag -> options -> policy -> blocker -> configuration -> Origin -> bearer token -> LIVE membership -> role -> media -> bounded body (64 KiB / 10 s)
export const POST = mcpBearerJsonRoute({ maxBytes: MCP_ENDPOINT_MAX_BYTES, deadlineMs: MCP_ENDPOINT_DEADLINE_MS }, (input) => handleMcpRequest(input, { reads: resolveMcpReadDependencies() }));
