/**
 * POST /api/mcp/token
 *
 * Body: {} (exactly; nothing about the token is the caller's to choose)
 * [B20 B2] Mints a one-hour, audience-bound Sirkit MCP access token for the signed-in member's selected project (OD-43).
 * The canonical wrapper authenticates the cookie session (confirmed live), enforces same-origin CSRF in production and loads
 * the ACTIVE membership before anything here runs; the token is bound to that scope and LIVE membership revision, nothing is
 * stored, and the token appears only in the 200 body.
 */
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";
import { issueMcpAccessToken } from "@/app/lib/mcp/server/token-issuance";

export const runtime = "nodejs";

const MCP_TOKEN_MAX_BYTES = 256;
const MCP_TOKEN_DEADLINE_MS = 5_000;

// [B20 B2] canonical wrapper: authorization (member + live session + same-origin CSRF) -> media -> bounded body (256 B / 5 s)
export const POST = authenticatedJsonRoute({ maxBytes: MCP_TOKEN_MAX_BYTES, deadlineMs: MCP_TOKEN_DEADLINE_MS }, ({ context, body }) => issueMcpAccessToken({ context, body }));
