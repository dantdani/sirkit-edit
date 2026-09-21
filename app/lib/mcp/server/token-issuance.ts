/**
 * [B20 B2] POST /api/mcp/token — Sirkit issues the MCP access token (D-8; OD-43).
 *
 * The canonical `authenticatedJsonRoute` runs first: the exact policy (an authenticated read for every member), the
 * production blocker, same-origin CSRF in production, the cookie identity WITH the server-confirmed session liveness
 * (B16.1B section E), the ACTIVE membership, media and the bounded body. So an anonymous, cross-origin, non-member,
 * wrong-media or oversized request is refused (401, 403, 415, 413) even while the MCP flag is off — the recorded order.
 * Then, here: the flag (404), the configuration (503), a human cookie principal (403), an empty JSON object body (400), the
 * per-member mint limit (429), and the mint. The token is bound to the member's selected tenant, project and branch and to
 * the LIVE membership revision the wrapper resolved; it appears only in this 200 body, never in a log, a header or a trace.
 */
import type { TrustedRequestContext } from "../../auth/types";
import { MCP_TOKEN_LIFETIME_S, MCP_TOKEN_SCOPE, mcpServerNowMs, mintMcpAccessToken, resolveMcpResourceConfiguration } from "../../auth/mcp-bearer";
import { mcpFeatureState } from "../rollout";
import { mcpTokenRouteLimiter } from "./inbound-limits";

/** The closed refusal codes of the token route's own steps (the wrapper's are the canonical ones). */
export const MCP_TOKEN_ROUTE_CODES = Object.freeze([
  "MCP_NOT_ENABLED",
  "MCP_NOT_CONFIGURED",
  "MCP_TOKEN_PRINCIPAL_REFUSED",
  "MCP_TOKEN_BODY_INVALID",
  "MCP_RATE_LIMITED",
  "MCP_TOKEN_MINT_FAILED",
] as const);

const NO_STORE = { "Cache-Control": "no-store" } as const;

function refusal(status: number, code: (typeof MCP_TOKEN_ROUTE_CODES)[number], error: string, headers: Record<string, string> = {}): Response {
  return Response.json({ ok: false, code, error }, { status, headers: { ...NO_STORE, ...headers } });
}

export interface McpTokenIssuanceInput {
  readonly context: TrustedRequestContext;
  /** the bounded, parsed JSON object body (the wrapper already refused a non-object) */
  readonly body: Record<string, unknown>;
}

/** The token route's callback. Never throws: a failure is a closed refusal with a fixed sentence. */
export function issueMcpAccessToken(input: McpTokenIssuanceInput, options: { readonly environment?: Record<string, string | undefined> } = {}): Response {
  try {
    const environment = options.environment ?? process.env;
    const { context, body } = input;
    // 1. the flag (after the wrapper, so an anonymous caller is still 401 while it is off)
    if (!mcpFeatureState(environment).enabled) return refusal(404, "MCP_NOT_ENABLED", "The MCP endpoint is not enabled.");
    // 2. the configuration
    const config = resolveMcpResourceConfiguration(environment);
    if (!config.ok) return refusal(503, "MCP_NOT_CONFIGURED", "The MCP endpoint is not configured.");
    // 3. a human cookie (or local development) principal only: a worker never mints, and neither does a token
    if (context.actor.actorKind !== "human" || (context.authMethod !== "supabase_cookie" && context.authMethod !== "local_dev")) {
      return refusal(403, "MCP_TOKEN_PRINCIPAL_REFUSED", "Only a signed-in project member may obtain an MCP access token.");
    }
    // 4. exactly {}: nothing about the token (lifetime, audience, scope) is the caller's to choose
    if (Object.keys(body).length !== 0) return refusal(400, "MCP_TOKEN_BODY_INVALID", "The request body must be an empty JSON object.");
    // 5. the per-member mint limit
    const nowMs = mcpServerNowMs();
    const admitted = mcpTokenRouteLimiter.take([context.tenantId, context.projectId, context.principalId], nowMs);
    if (!admitted.ok) return refusal(429, "MCP_RATE_LIMITED", "Too many MCP access tokens requested; retry later.", { "Retry-After": String(admitted.retryAfterS) });
    // 6. the mint, bound to the selected scope and the LIVE membership revision
    const minted = mintMcpAccessToken({ subject: context.principalId, tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId, membershipRevision: context.membershipRevision }, { environment, nowMs });
    if (!minted.ok) return refusal(503, "MCP_TOKEN_MINT_FAILED", "The MCP access token could not be issued.");
    return Response.json(
      {
        ok: true,
        access_token: minted.token,
        token_type: "Bearer",
        expires_in: MCP_TOKEN_LIFETIME_S,
        scope: MCP_TOKEN_SCOPE,
        resource: config.resourceUri,
        project: { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId },
      },
      { status: 200, headers: { ...NO_STORE, Pragma: "no-cache" } },
    );
  } catch {
    return refusal(503, "MCP_TOKEN_MINT_FAILED", "The MCP access token could not be issued.");
  }
}
