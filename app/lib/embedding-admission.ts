/**
 * [B24-A3] D24-8, OD-197 - the metered embedding call of the two public searches. `admittedEmbedQuery` takes an admission from the
 * embedding meter (`app/lib/acquisition/admission-control.ts`, key `embedding:openai/model:<EMBEDDING_MODEL>`), then calls
 * `embedQuery` (`app/lib/embeddings.ts`, not edited: the DB schema imports it), then records the outcome. A refusal throws
 * `EmbeddingAdmissionRefused` (with `retryAtMs`) and no provider call is made: `POST /api/parts/search` takes its lexical fallback,
 * `GET /api/pcb/footprints/search` answers 429 EMBEDDING_ADMISSION_PAUSED.
 *
 * Outcomes are classified by the error's provider status and code, never by its message text: a provider 429 is `rate_limited`
 * (`insufficient_quota` when its code says so); a 5xx, a 408, or an SDK error with no status (a timeout or a network failure: the
 * request was attempted) is `failure`; another provider status is `neutral` (the provider refused the request itself); an error that
 * carries no status at all was thrown before any provider request (a missing OPENAI_API_KEY) and is `neutral`, so it never opens the
 * breaker. The meter counts `embedQuery` calls, not provider HTTP requests: the SDK client in embeddings.ts keeps its default retries
 * (INFERRED: up to three requests for one call). The authenticated embedding paths (POST /api/pcb/assign/suggest, the build loop's
 * parts search) do not come through here: their routes' own windows bound them.
 */
import { EMBEDDING_MODEL, embedQuery } from "@/app/lib/embeddings";
import { recordEmbeddingOutcome, requestEmbeddingAdmission, type AdmissionPurpose, type EmbeddingKey, type EmbeddingOutcome } from "@/app/lib/acquisition/admission-control"; import { unfrozenNowMs } from "@/app/lib/fixture-runtime/clock"; // [B24-A3 review, 2026-10-08] regressions-1: the meter's clock is the real one, which the fixture runtime does not freeze

/** The one meter both public searches share: OpenAI's embedding model, as the embeddings module names it. */
export const EMBEDDING_ADMISSION_KEY: EmbeddingKey = Object.freeze({ kind: "embedding", provider: "openai", model: EMBEDDING_MODEL });

/** The meter refused the call: no provider request was made. */
export class EmbeddingAdmissionRefused extends Error {
  readonly code = "EMBEDDING_ADMISSION_PAUSED";
  readonly reason: "quota_exhausted" | "breaker_open";
  readonly retryAtMs: number;
  constructor(reason: "quota_exhausted" | "breaker_open", retryAtMs: number, message: string) {
    super(message);
    this.name = "EmbeddingAdmissionRefused";
    this.reason = reason;
    this.retryAtMs = retryAtMs;
  }
}

/** The outcome of a failed call, by the error's own `status` and `code` properties only (the SDK's APIError shape). */
export function classifyEmbeddingError(error: unknown): Exclude<EmbeddingOutcome, "success"> {
  if (typeof error !== "object" || error === null || !Object.hasOwn(error, "status")) return "neutral";
  const { status, code } = error as { status?: unknown; code?: unknown };
  if (status === 429) return code === "insufficient_quota" ? "insufficient_quota" : "rate_limited";
  if (status === undefined) return "failure";
  if (typeof status === "number" && (status >= 500 || status === 408)) return "failure";
  return "neutral";
}

/** Embed one query through the meter; a refusal throws `EmbeddingAdmissionRefused` before any provider call. */
export async function admittedEmbedQuery(text: string, options: { purpose: AdmissionPurpose }): Promise<number[]> {
  const admission = requestEmbeddingAdmission(EMBEDDING_ADMISSION_KEY, unfrozenNowMs(), options.purpose);
  if (!admission.allowed) throw new EmbeddingAdmissionRefused(admission.reason, admission.retryAtMs, admission.message);
  let vector: number[];
  try {
    vector = await embedQuery(text);
  } catch (error) {
    recordEmbeddingOutcome(EMBEDDING_ADMISSION_KEY, classifyEmbeddingError(error), unfrozenNowMs());
    throw error;
  }
  recordEmbeddingOutcome(EMBEDDING_ADMISSION_KEY, "success", unfrozenNowMs());
  return vector;
}

/** `Retry-After` for a refusal: whole seconds until the meter admits again, at least 1, at most an hour. */
export function embeddingRetryAfterSeconds(refusal: EmbeddingAdmissionRefused, nowMs: number = unfrozenNowMs()): number {
  return Math.min(3_600, Math.max(1, Math.ceil((refusal.retryAtMs - nowMs) / 1_000)));
}
