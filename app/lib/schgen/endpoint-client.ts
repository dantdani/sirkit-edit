/**
 * [B19-B I2b] The cross-verify second opinion's ONE outbound call, through the bounded egress path.
 *
 * `/api/schematic/cross-verify` sends the user's prompt, with a bearer, to the operator-configured SchGen endpoint. Before
 * B19 it used a plain `fetch`. Measured on Node 24.15 with two loopback servers, that call followed a redirect to any
 * address (loopback included), re-sent the prompt there, and kept the bearer on a same-origin hop (Node drops it on a
 * cross-origin one); the answer was buffered whole; and a failure answered the caller with the final hop's status plus
 * the first 200 bytes of its body, or with the transport's own error text.
 *
 * Now:
 *  - the configured URL is operator configuration, not user input, so its exact host is this source's allowlist — and
 *    every other rule of `outboundFetch` applies to it: HTTPS, no URL credentials, no loopback / link-local / private
 *    name or resolved address, one deadline per attempt, a bounded body;
 *  - a redirect is refused outright: this request carries a bearer, and a hop is exactly where it, or the prompt, would
 *    go somewhere else;
 *  - a 503 while the endpoint wakes from zero is retried, bounded in attempts and in total time;
 *  - a failure is a closed reason with a fixed sentence for the caller, and a redacted line (never a body, never the
 *    token) for the server log.
 *
 * Limit, as in I1: addresses are checked at admission and the transport resolves again at connect.
 */
import { outboundFetch, parseOutboundJson, type OutboundDeps, type OutboundFailureCode, type OutboundPolicy } from "../net/outbound-fetch";

/** gpt-oss-20b is slow (~20 tok/s); one attempt may take minutes. */
export const SCHGEN_ATTEMPT_DEADLINE_MS = 240_000;
/** All attempts and back-offs together. */
export const SCHGEN_TOTAL_BUDGET_MS = 300_000;
/** A 4096-token DSL answer is tens of kilobytes; a megabyte is generous. */
export const SCHGEN_MAX_RESPONSE_BYTES = 1_000_000;
export const SCHGEN_MAX_ATTEMPTS = 3;
export const SCHGEN_MAX_NEW_TOKENS = 4096;

export interface SchGenEndpointConfig {
  url: string;
  token?: string;
}

/** Read at request time, so configuration is never frozen into a module. */
export function schgenEndpointFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): SchGenEndpointConfig | null {
  const url = env.SCHGEN_ENDPOINT_URL?.trim();
  if (!url) return null;
  // HF Inference Endpoints are protected by default — send a bearer token.
  const token = env.SCHGEN_ENDPOINT_TOKEN ?? env.HF_TOKEN;
  return token ? { url, token } : { url };
}

export type SchGenFailure =
  | "endpoint_not_permitted"
  | "unreachable"
  | "timeout"
  | "redirect_refused"
  | "unusable_answer"
  | "http_error"
  | "no_code"
  | "still_starting";

/** What the caller is told. Fixed text: no body, no host, no transport message. */
export const SCHGEN_FAILURE_SENTENCES: Readonly<Record<SchGenFailure, string>> = Object.freeze({
  endpoint_not_permitted: "the configured endpoint is not permitted: it must be an HTTPS address on the public internet.",
  unreachable: "the endpoint could not be reached.",
  timeout: "the endpoint did not answer in time.",
  redirect_refused: "the endpoint answered with a redirect, and redirects are refused.",
  unusable_answer: "the endpoint's answer was not usable.",
  http_error: "the endpoint answered with an error.",
  no_code: "the endpoint returned no usable code.",
  still_starting: "the endpoint is still starting after retries; try again shortly.",
});

const FAILURE_BY_CODE: Readonly<Record<OutboundFailureCode, SchGenFailure>> = Object.freeze({
  url_invalid: "endpoint_not_permitted",
  scheme_not_https: "endpoint_not_permitted",
  url_credentials: "endpoint_not_permitted",
  host_not_allowed: "endpoint_not_permitted",
  address_blocked: "endpoint_not_permitted",
  dns_failed: "unreachable",
  network_error: "unreachable",
  timeout: "timeout",
  aborted: "timeout",
  redirect_refused: "redirect_refused",
  too_many_redirects: "redirect_refused",
  response_too_large: "unusable_answer",
  unexpected_content_type: "unusable_answer",
});

export type SchGenOutcome =
  | { ok: true; code: string }
  | { ok: false; failure: SchGenFailure; status?: number; /** redacted; for the server log only */ logLine: string };

export interface SchGenDeps extends OutboundDeps {
  sleep?: (ms: number) => Promise<void>;
  attemptDeadlineMs?: number;
  totalBudgetMs?: number;
}

export function schgenPolicy(config: SchGenEndpointConfig, attemptDeadlineMs = SCHGEN_ATTEMPT_DEADLINE_MS): OutboundPolicy {
  let host = "";
  try {
    host = new URL(config.url).hostname;
  } catch {
    // an invalid URL is refused by the boundary itself (url_invalid)
  }
  return {
    source: "schgen",
    allowedHosts: host ? [host] : [],
    deadlineMs: attemptDeadlineMs,
    maxResponseBytes: SCHGEN_MAX_RESPONSE_BYTES,
    maxRedirects: 0,
    // checked after the status, so a 503 page in HTML is still "retry", not "wrong media type"
    acceptContentTypes: [],
  };
}

/**
 * Pull the generated code out of the endpoint response. Accepts a custom handler that returns `{ code }` (preferred
 * contract) OR a raw HF text-generation response (`{ generated_text }` / `[{ generated_text }]`).
 */
export function extractSchGenCode(data: unknown): string {
  if (Array.isArray(data)) {
    const first = data[0] as Record<string, unknown> | undefined;
    if (first && typeof first.generated_text === "string") return first.generated_text;
    return "";
  }
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (typeof o.code === "string") return o.code;
    if (typeof o.generated_text === "string") return o.generated_text;
  }
  return "";
}

/** POST the prompt to the SchGen endpoint, retrying a bounded number of times while it wakes from zero. Never throws. */
export async function callSchGenEndpoint(prompt: string, config: SchGenEndpointConfig, deps: SchGenDeps = {}): Promise<SchGenOutcome> {
  const policy = schgenPolicy(config, deps.attemptDeadlineMs);
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (config.token) headers.Authorization = `Bearer ${config.token}`;
  // HF's endpoint router requires an `inputs` key; our handler also reads `prompt`. Send both, plus a bounded token budget.
  const body = JSON.stringify({ inputs: prompt, prompt, parameters: { max_new_tokens: SCHGEN_MAX_NEW_TOKENS } });
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const budget = AbortSignal.timeout(deps.totalBudgetMs ?? SCHGEN_TOTAL_BUDGET_MS);

  for (let attempt = 1; attempt <= SCHGEN_MAX_ATTEMPTS; attempt++) {
    const exchange = await outboundFetch({ url: config.url, method: "POST", headers, body, signal: budget }, policy, { fetch: deps.fetch, resolve: deps.resolve });
    if (!exchange.ok) {
      return { ok: false, failure: FAILURE_BY_CODE[exchange.code], logLine: exchange.message, ...(exchange.status === undefined ? {} : { status: exchange.status }) };
    }
    // 503 = endpoint scaling from zero / model still loading — back off and retry, within the budget.
    if (exchange.status === 503) {
      if (attempt === SCHGEN_MAX_ATTEMPTS) {
        return { ok: false, failure: "still_starting", status: 503, logLine: `schgen: HTTP 503 after ${SCHGEN_MAX_ATTEMPTS} attempts.` };
      }
      await sleep(5000 * attempt);
      if (budget.aborted) return { ok: false, failure: "timeout", logLine: "schgen: the total budget ran out while the endpoint was starting." };
      continue;
    }
    if (exchange.status < 200 || exchange.status >= 300) {
      return { ok: false, failure: "http_error", status: exchange.status, logLine: `schgen: the endpoint answered HTTP ${exchange.status}.` };
    }
    if (!exchange.contentType.startsWith("application/json")) {
      return { ok: false, failure: "unusable_answer", status: exchange.status, logLine: `schgen: expected JSON, received ${exchange.contentType || "no content type"}.` };
    }
    const parsed = parseOutboundJson(exchange, "schgen");
    if (!parsed.ok) return { ok: false, failure: "unusable_answer", status: exchange.status, logLine: parsed.message };
    const code = extractSchGenCode(parsed.value).trim();
    if (!code) return { ok: false, failure: "no_code", status: exchange.status, logLine: "schgen: the answer carried no code." };
    return { ok: true, code };
  }
  return { ok: false, failure: "still_starting", logLine: "schgen: no attempt completed." };
}
