/**
 * [B20 B2] The OAuth 2.0 Protected Resource Metadata (RFC 9728) of Sirkit's MCP endpoint (D-11; OD-43, OD-66), served at
 * the well-known URL derived by RFC 9728 section 3.1 path insertion: `<origin>/.well-known/oauth-protected-resource/api/mcp`
 * for the resource `<origin>/api/mcp`. `resource` is exactly the token audience (section 3.3).
 *
 * RECORDED DEVIATION (OD-43): the document names no `authorization_servers`. No OAuth authorization server exists in B20 —
 * Sirkit mints its own tokens at POST /api/mcp/token — and the MCP 2026-07-28 authorization specification makes the field
 * (with at least one server) a MUST for an MCP server's metadata. A client that discovers OAuth through this document cannot
 * obtain a token; only pre-issued Sirkit tokens work. The external authorization server is BLOCKED-LIVE (LB-1).
 */
import { MCP_TOKEN_SCOPE, resolveMcpResourceConfiguration, type McpResourceConfiguration } from "../../auth/mcp-bearer";
import { mcpFeatureState } from "../rollout";

export interface McpResourceMetadata {
  readonly resource: string;
  readonly scopes_supported: readonly string[];
  readonly bearer_methods_supported: readonly string[];
  readonly resource_name: string;
}

/** The metadata document for a configuration: exactly four keys, deterministic, frozen. */
export function renderMcpResourceMetadata(config: Extract<McpResourceConfiguration, { ok: true }>): McpResourceMetadata {
  return Object.freeze({
    resource: config.resourceUri,
    scopes_supported: Object.freeze([MCP_TOKEN_SCOPE]),
    bearer_methods_supported: Object.freeze(["header"]),
    resource_name: "Sirkit",
  });
}

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** GET: the flag off is 404, a missing configuration 503, otherwise 200 with the document. Never throws. */
export function mcpResourceMetadataResponse(environment: Record<string, string | undefined> = process.env): Response {
  try {
    if (!mcpFeatureState(environment).enabled) return Response.json({ ok: false, code: "MCP_NOT_ENABLED", error: "The MCP endpoint is not enabled." }, { status: 404, headers: NO_STORE });
    const config = resolveMcpResourceConfiguration(environment);
    if (!config.ok) return Response.json({ ok: false, code: "MCP_NOT_CONFIGURED", error: "The MCP endpoint is not configured." }, { status: 503, headers: NO_STORE });
    return Response.json(renderMcpResourceMetadata(config), { status: 200, headers: NO_STORE });
  } catch {
    return Response.json({ ok: false, code: "MCP_NOT_CONFIGURED", error: "The MCP endpoint is not configured." }, { status: 503, headers: NO_STORE });
  }
}
