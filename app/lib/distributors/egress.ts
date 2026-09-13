/**
 * [B19-B I1] How a distributor client talks to its vendor: through the bounded, validated egress path, and nothing else.
 *
 * Before B19 each client called the global `fetch` directly — no timeout, no size bound, no redirect control — and logged
 * the raw error object on failure. Each source now has ONE policy (its exact host, its deadline, its body ceiling, which
 * of its query parameters carry a secret) and one call shape that returns parsed JSON or a redacted sentence. A client
 * cannot reach any other host, and cannot log what the transport said.
 */
import { outboundFetch, parseOutboundJson, type OutboundPolicy, type OutboundRequest } from "../net/outbound-fetch";

export type DistributorSource = "digikey" | "mouser" | "octopart";

/** Injection for tests; production passes nothing and gets the real transport, the real resolver and the policy deadline. */
export interface DistributorEgress {
  fetch?: typeof fetch;
  resolve?: (hostname: string) => Promise<string[]>;
  deadlineMs?: number;
}

/**
 * Per-source boundary policy. Hosts are the exact API hosts each client already used; nothing is widened. Redirects are
 * refused outright (0): none of these JSON APIs redirects in normal operation, and a redirect is exactly where a credential
 * would leave its host.
 */
export const DISTRIBUTOR_EGRESS_POLICIES: Readonly<Record<DistributorSource, OutboundPolicy>> = Object.freeze({
  digikey: Object.freeze({
    source: "digikey",
    allowedHosts: Object.freeze(["api.digikey.com"]),
    deadlineMs: 15_000,
    maxResponseBytes: 2_000_000,
    maxRedirects: 0,
    acceptContentTypes: Object.freeze(["application/json"]),
  }),
  mouser: Object.freeze({
    source: "mouser",
    allowedHosts: Object.freeze(["api.mouser.com"]),
    deadlineMs: 15_000,
    maxResponseBytes: 2_000_000,
    maxRedirects: 0,
    acceptContentTypes: Object.freeze(["application/json"]),
    // Mouser's documented Search API authenticates with this query parameter; the boundary treats it as a secret.
    secretQueryParams: Object.freeze(["apiKey"]),
  }),
  octopart: Object.freeze({
    source: "octopart",
    allowedHosts: Object.freeze(["api.nexar.com"]),
    deadlineMs: 20_000,
    maxResponseBytes: 4_000_000,
    maxRedirects: 0,
    acceptContentTypes: Object.freeze(["application/json"]),
  }),
});

export type DistributorJsonResult = { ok: true; status: number; value: unknown } | { ok: false; status?: number; message: string };

/**
 * One request to a vendor. Never throws. A non-2xx status is a failure carrying only the status — never the vendor's body.
 */
export async function distributorJson(source: DistributorSource, request: OutboundRequest, egress: DistributorEgress = {}): Promise<DistributorJsonResult> {
  const base = DISTRIBUTOR_EGRESS_POLICIES[source];
  const policy: OutboundPolicy = egress.deadlineMs === undefined ? base : { ...base, deadlineMs: egress.deadlineMs };
  // A non-2xx body is never read into a message, so accept any content type on the wire and judge JSON only on success.
  const exchange = await outboundFetch(request, { ...policy, acceptContentTypes: [] }, { fetch: egress.fetch, resolve: egress.resolve });
  if (!exchange.ok) return { ok: false, message: exchange.message, ...(exchange.status === undefined ? {} : { status: exchange.status }) };
  if (exchange.status < 200 || exchange.status >= 300) return { ok: false, status: exchange.status, message: `${source}: the vendor answered HTTP ${exchange.status}.` };
  if (!policy.acceptContentTypes.some((accepted) => exchange.contentType.startsWith(accepted))) {
    return { ok: false, status: exchange.status, message: `${source}: expected JSON, received ${exchange.contentType || "no content type"}.` };
  }
  const parsed = parseOutboundJson(exchange, source);
  return parsed.ok ? { ok: true, status: exchange.status, value: parsed.value } : { ok: false, status: exchange.status, message: parsed.message };
}
