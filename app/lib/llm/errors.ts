import type { LLMProviderId } from "./types";

export type LLMProviderFailureReason =
  | "missing_credentials"
  | "authentication"
  | "insufficient_quota"
  | "model_access"
  | "rate_limit"
  | "overloaded"
  | "bad_request"
  | "timeout"
  | "cancelled"
  | "network"
  | "unknown";

function providerName(provider: LLMProviderId): string {
  return provider === "openai" ? "OpenAI" : "Anthropic";
}

function friendlyMessage(provider: LLMProviderId, reason: LLMProviderFailureReason): string {
  const name = providerName(provider);
  switch (reason) {
    case "missing_credentials":
      return `No ${name} API key is configured on the Sirkit server. Set the server-side environment variable and restart.`;
    case "authentication":
      return `${name} rejected the configured API key as invalid or revoked. Replace the server-side key.`;
    case "insufficient_quota":
      return `The ${name} account is out of credits or over its billing quota. Add credits or raise the limit in the provider console — retrying will not help until then.`;
    case "model_access":
      return `${name} denied access to the configured model. Check the model name and account permissions.`;
    case "rate_limit":
      return `${name} rate limit reached. This is temporary — retry shortly.`;
    case "overloaded":
      return `${name} is temporarily overloaded. Retry shortly.`;
    case "bad_request":
      return `${name} rejected the request as malformed. This is a Sirkit-side request construction problem, not an account issue.`;
    case "timeout":
      return `${name} did not finish before the request timed out.`;
    case "cancelled":
      return `The ${name} request was cancelled before it completed.`;
    case "network":
      return `${name} could not be reached from the Sirkit server.`;
    default:
      return `${name} is currently unavailable.`;
  }
}

/**
 * Pull status/code/message out of a provider SDK error.
 *
 * Both SDKs expose `status` (HTTP) and an `error` body, but nest differently:
 *  - OpenAI:     e.code ("insufficient_quota"), e.type, e.error = { message, type, code }
 *  - Anthropic:  e.error = { type: "error", error: { type: "invalid_request_error", message } }
 * Client-construction errors (missing key) have no status at all.
 */
function extractDetail(error: unknown): {
  status?: number;
  code?: string;
  message: string;
} {
  const e = error as {
    status?: unknown;
    code?: unknown;
    type?: unknown;
    message?: unknown;
    error?: {
      code?: unknown;
      type?: unknown;
      message?: unknown;
      error?: { type?: unknown; message?: unknown };
    };
  };
  const status = typeof e?.status === "number" ? e.status : undefined;
  const code =
    [e?.code, e?.error?.code, e?.error?.error?.type, e?.error?.type, e?.type].find(
      (value): value is string => typeof value === "string" && value !== "error",
    ) ?? undefined;
  const message =
    [e?.error?.error?.message, e?.error?.message, e?.message].find(
      (value): value is string => typeof value === "string" && value.length > 0,
    ) ?? "";
  return { status, code, message };
}

function describeProviderFailure(error: unknown): {
  reason: LLMProviderFailureReason;
  status?: number;
  providerCode?: string;
  providerMessage?: string;
} {
  const { status, code: rawCode, message } = extractDetail(error);
  const providerCode = rawCode;
  const code = rawCode?.toLowerCase() ?? "";
  const name =
    typeof (error as { name?: unknown })?.name === "string"
      ? ((error as { name: string }).name.toLowerCase())
      : "";
  const text = message.toLowerCase();
  const base = { status, providerCode, providerMessage: message || undefined };

  // Client-side construction error: the SDK never sent a request because the
  // key env var is missing. Must run before the 401 branch (both mention keys).
  if (status === undefined && /api.?key|apikey|credential/.test(text)) {
    return { reason: "missing_credentials", ...base };
  }
  // Billing exhaustion is NOT transient and must not collapse into rate_limit:
  // OpenAI reports it as 429 `insufficient_quota`; Anthropic as 400
  // invalid_request_error with a "credit balance is too low" message, or as a
  // `billing_error` type.
  if (
    /insufficient.?quota|billing/.test(code) ||
    /credit balance|billing|purchase credits|quota.*exceeded.*billing/.test(text)
  ) {
    return { reason: "insufficient_quota", ...base };
  }
  if (status === 401 || /authentication|invalid.?api.?key/.test(code)) {
    return { reason: "authentication", ...base };
  }
  if (
    status === 404 ||
    /model.*(?:access|not.?found)|not.?found.*model/.test(code) ||
    (status === 403 && /model/.test(text))
  ) {
    return { reason: "model_access", ...base };
  }
  if (status === 403) return { reason: "authentication", ...base };
  if (status === 429 || /rate.?limit/.test(code)) return { reason: "rate_limit", ...base };
  if (status === 529 || /overloaded/.test(code)) return { reason: "overloaded", ...base };
  if (/abort|cancel/.test(name) || /abort|cancel/.test(code)) {
    return { reason: "cancelled", ...base };
  }
  if (status === 408 || /timeout/.test(name) || /timeout|timed.?out/.test(code)) {
    return { reason: "timeout", ...base };
  }
  if (status === 400 || status === 422 || /invalid.?request|bad.?request/.test(code)) {
    return { reason: "bad_request", ...base };
  }
  if (/connection|network|fetch/.test(name) || /connection|network/.test(code)) {
    return { reason: "network", ...base };
  }
  return { reason: "unknown", ...base };
}

/** Transient failures where an automatic or user-initiated retry can succeed. */
export function isRetryableReason(reason: LLMProviderFailureReason): boolean {
  return reason === "rate_limit" || reason === "overloaded" || reason === "timeout" || reason === "network";
}

export class LLMProviderError extends Error {
  readonly code = "provider_unavailable";

  constructor(
    readonly provider: LLMProviderId,
    readonly reason: LLMProviderFailureReason = "unknown",
    readonly providerStatus?: number,
    readonly providerCode?: string,
    options?: ErrorOptions,
    readonly providerMessage?: string,
  ) {
    super(friendlyMessage(provider, reason), options);
    this.name = "LLMProviderError";
  }
}

export function toProviderError(provider: LLMProviderId, error: unknown): LLMProviderError {
  if (error instanceof LLMProviderError) return error;
  const detail = describeProviderFailure(error);
  return new LLMProviderError(provider, detail.reason, detail.status, detail.providerCode, {
    cause: error instanceof Error ? error : undefined,
  }, detail.providerMessage);
}

/** Truncated provider-authored diagnostic, safe to surface (never contains the key). */
function providerDetail(error: LLMProviderError): string | undefined {
  if (!error.providerMessage) return undefined;
  const trimmed = error.providerMessage.replace(/\s+/g, " ").trim();
  return trimmed.length > 300 ? `${trimmed.slice(0, 297)}...` : trimmed;
}

export function providerErrorResponse(error: unknown, provider: LLMProviderId): Response {
  const normalized = toProviderError(provider, error);
  console.error(`[llm:${provider}] request failed`, {
    name: normalized.cause instanceof Error ? normalized.cause.name : "UnknownError",
    reason: normalized.reason,
    status: normalized.providerStatus,
    providerCode: normalized.providerCode,
    providerMessage: providerDetail(normalized),
  });
  return Response.json(
    {
      ok: false,
      code: normalized.code,
      provider,
      reason: normalized.reason,
      retryable: isRetryableReason(normalized.reason),
      error: normalized.message,
      detail: providerDetail(normalized),
    },
    { status: 503 },
  );
}
