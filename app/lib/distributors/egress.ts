/**
 * [B19-B I1] How a distributor client talks to its vendor: through the bounded, validated egress path, and nothing else.
 *
 * Before B19 each client called the global `fetch` directly — no timeout, no size bound, no redirect control — and logged
 * the raw error object on failure. Each source now has ONE policy (its exact host, its deadline, its body ceiling, which
 * of its query parameters carry a secret) and one call shape that returns parsed JSON or a redacted sentence. A client
 * cannot reach any other host, and cannot log what the transport said.
 */
import { outboundFetch, parseOutboundJson, type OutboundPolicy, type OutboundRequest } from "../net/outbound-fetch";
import { SOURCE_REGISTRY } from "../acquisition/source-registry";
import { recordOutcome, requestAdmission, type AdmissionPurpose, type RequestOutcome } from "../acquisition/admission-control";
import { sha256 } from "../atomic/stable";

export type DistributorSource = "digikey" | "mouser" | "octopart";

/** Injection for tests; production passes nothing and gets the real transport, the real resolver and the policy deadline. */
export interface DistributorEgress {
  fetch?: typeof fetch;
  resolve?: (hostname: string) => Promise<string[]>;
  deadlineMs?: number;
  /** [B19-B I3b] The clock the quota windows and the breaker read (tests). */
  clock?: () => number;
}

/**
 * Per-source boundary policy, taken from the source registry (`app/lib/acquisition/source-registry.ts`): each source's
 * exact hosts, deadline, body ceiling and secret query parameters. Redirects are refused outright (0): none of these JSON
 * APIs redirects in normal operation, and a redirect is exactly where a credential would leave its host.
 */
function policyFromRegistry(source: DistributorSource): OutboundPolicy {
  const entry = SOURCE_REGISTRY[source];
  return Object.freeze({
    source,
    allowedHosts: Object.freeze([...entry.endpoints.hosts]),
    deadlineMs: entry.resilience.deadlineMs,
    maxResponseBytes: entry.resilience.maxResponseBytes,
    maxRedirects: entry.resilience.maxRedirects,
    acceptContentTypes: Object.freeze(["application/json"]),
    ...(entry.auth.secretQueryParams.length > 0 ? { secretQueryParams: Object.freeze([...entry.auth.secretQueryParams]) } : {}),
  });
}

export const DISTRIBUTOR_EGRESS_POLICIES: Readonly<Record<DistributorSource, OutboundPolicy>> = Object.freeze({
  digikey: policyFromRegistry("digikey"),
  mouser: policyFromRegistry("mouser"),
  octopart: policyFromRegistry("octopart"),
});

export type DistributorJsonResult =
  /** [B19-C I4] `contentHash`: SHA-256 of the exact response bytes; `retrievedAt`: when they arrived (unix ms). */
  | { ok: true; status: number; value: unknown; contentHash: string; retrievedAt: number }
  | { ok: false; status?: number; message: string; paused?: "quota_exhausted" | "breaker_open"; /** [B19-E E2] when a paused source may be tried again */ retryAtMs?: number };

/**
 * One request to a vendor. Never throws. A non-2xx status is a failure carrying only the status — never the vendor's body.
 *
 * [B19-B I3b] Before anything is sent, the request's `cost` (1 request by default; the matched parts a Nexar batch can
 * return; 0 for an OAuth token request) is admitted against the source's registered quota and its circuit breaker, and
 * refused without a request when either says no. Every request that is sent reports its outcome to the breaker.
 * [B19-E E2] `purpose` meters the request against its purpose's share of the quota (an agent request: at most 25%, OD-40).
 * [B19-E E2 review] `isErrorAnswer` lets a connector say a 2xx JSON answer is the vendor's error (a GraphQL `errors` answer):
 * it is then a failure, counted by the breaker, and no value is returned. It can only turn a success into a failure.
 */
export async function distributorJson(source: DistributorSource, request: OutboundRequest, egress: DistributorEgress = {}, cost = 1, purpose: AdmissionPurpose = "interactive", isErrorAnswer?: (value: unknown) => boolean): Promise<DistributorJsonResult> {
  const clock = egress.clock ?? Date.now;
  const admission = requestAdmission(source, cost, clock(), purpose);
  if (!admission.allowed) return { ok: false, message: admission.message, paused: admission.reason, retryAtMs: admission.retryAtMs };
  const base = DISTRIBUTOR_EGRESS_POLICIES[source];
  const policy: OutboundPolicy = egress.deadlineMs === undefined ? base : { ...base, deadlineMs: egress.deadlineMs };
  // A non-2xx body is never read into a message, so accept any content type on the wire and judge JSON only on success.
  const exchange = await outboundFetch(request, { ...policy, acceptContentTypes: [] }, { fetch: egress.fetch, resolve: egress.resolve });
  const settle = (outcome: RequestOutcome): void => recordOutcome(source, outcome, clock());
  if (!exchange.ok) {
    settle(exchange.code === "aborted" ? "neutral" : "failure");
    return { ok: false, message: exchange.message, ...(exchange.status === undefined ? {} : { status: exchange.status }) };
  }
  if (exchange.status === 429) {
    settle("rate_limited");
    return { ok: false, status: 429, message: `${source}: the vendor answered HTTP 429 (rate limited); requests are paused.` };
  }
  if (exchange.status < 200 || exchange.status >= 300) {
    settle(exchange.status >= 500 ? "failure" : "neutral");
    return { ok: false, status: exchange.status, message: `${source}: the vendor answered HTTP ${exchange.status}.` };
  }
  if (!policy.acceptContentTypes.some((accepted) => exchange.contentType.startsWith(accepted))) {
    settle("failure");
    return { ok: false, status: exchange.status, message: `${source}: expected JSON, received ${exchange.contentType || "no content type"}.` };
  }
  const parsed = parseOutboundJson(exchange, source);
  const errorAnswer = parsed.ok && isErrorAnswer !== undefined && judgedError(isErrorAnswer, parsed.value);
  settle(parsed.ok && !errorAnswer ? "success" : "failure");
  if (!parsed.ok) return { ok: false, status: exchange.status, message: parsed.message };
  if (errorAnswer) return { ok: false, status: exchange.status, message: `${source}: the vendor answered with an error.` };
  return { ok: true, status: exchange.status, value: parsed.value, contentHash: sha256(exchange.bytes), retrievedAt: clock() };
}

/** [B19-E E2 review] a judge that throws has not shown the answer is sound */
function judgedError(isErrorAnswer: (value: unknown) => boolean, value: unknown): boolean {
  try {
    return isErrorAnswer(value);
  } catch {
    return true;
  }
}
