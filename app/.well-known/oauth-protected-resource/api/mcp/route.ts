/**
 * GET /.well-known/oauth-protected-resource/api/mcp
 *
 * [B20 B2] The RFC 9728 protected-resource metadata of the MCP endpoint (OD-66): the resource, its one scope and the header
 * bearer method; static configuration only. It names no authorization server (OD-43, the recorded deviation).
 */
import { publicRoute } from "@/app/lib/auth/route-handlers";
import { mcpResourceMetadataResponse } from "@/app/lib/mcp/server/resource-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = publicRoute(undefined, () => mcpResourceMetadataResponse());
