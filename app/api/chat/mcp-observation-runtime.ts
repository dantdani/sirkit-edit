/**
 * [B20 A4] The chat route's ONE approved boundary to the MCP client: the server resolver for the port behind the agent's one
 * external tool read, `sirkit.mcp.observation-read` (OD-74).
 *
 * Mirrors external-acquisition-runtime.ts: the default is the REAL production port (`resolveMcpAgentPort`: null for a principal
 * that is not a human, in the fixture runtime, off the flag, and while the committed registry holds no approved pinned row —
 * empty today, OD-48), constructed lazily per run with the server's policy, failing CLOSED to null. A test setter exists with a
 * deterministic reset; it is never a production path.
 *
 * It imports the agent port and nothing else: the chat import-closure ratchet
 * (app/api/chat/__tests__/b19-d-external-text-injection-route.test.ts) stops its walk here and pins that only the chat route
 * imports this file and that this file imports only `app/lib/mcp/agent-port.ts`.
 */
import { resolveMcpAgentPort, type McpAgentPortPolicy, type McpObservationPort } from "@/app/lib/mcp/agent-port";

export type McpObservationPortFactory = (policy: McpAgentPortPolicy) => McpObservationPort | null;

const DEFAULT_FACTORY: McpObservationPortFactory = (policy) => resolveMcpAgentPort(policy);
let portFactory: McpObservationPortFactory = DEFAULT_FACTORY;

/** Test-only override; restore via `resetMcpObservationPortFactory`. */
export function setMcpObservationPortFactory(factory: McpObservationPortFactory): void {
  portFactory = factory;
}

/** Restore the production default (deterministic test isolation). */
export function resetMcpObservationPortFactory(): void {
  portFactory = DEFAULT_FACTORY;
}

/** Resolve the port for one run, or null to withhold the tool. Never throws. */
export function resolveMcpObservationPort(policy: McpAgentPortPolicy): McpObservationPort | null {
  try {
    return portFactory({ humanPrincipal: policy.humanPrincipal === true, tenantId: policy.tenantId, projectId: policy.projectId, principalId: policy.principalId });
  } catch {
    return null;
  }
}
