/**
 * [B20 A3] The JSON-RPC request ids of Sirkit's MCP client, in a leaf module: the negotiation (A2) and the authorization
 * client (A3) both mint ids here, and the authorization client must not import the negotiation (which imports it), so the
 * counter lives in neither. Moved unchanged from `negotiation.ts`, which re-exports it for its existing importers.
 */

let requestCounter = 0;

/** A JSON-RPC id unique among this process's in-flight requests (base protocol, reference notes section 7). */
export function nextMcpRequestId(): number {
  requestCounter = requestCounter >= Number.MAX_SAFE_INTEGER - 1 ? 1 : requestCounter + 1;
  return requestCounter;
}
