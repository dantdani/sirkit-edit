/**
 * OpenAI embedding helpers, shared by ingestion and the search API.
 *
 * All embedding goes through here so the model, dimensions, and batching policy
 * live in one place. The OpenAI client is lazily created so importing the
 * model constant (e.g. from the DB schema) never requires an API key.
 */

import OpenAI from "openai";

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

/** OpenAI's hard cap is higher, but 100 keeps requests small and predictable. */
export const MAX_EMBED_BATCH_SIZE = 100;

let client: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (client) return client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set. Add it to .env.local.");
  }
  client = new OpenAI({ apiKey });
  return client;
}

/**
 * Embed a single string — convenience wrapper for the search endpoint, where
 * there is exactly one query to embed.
 */
export async function embedQuery(text: string, options?: { signal?: AbortSignal }): Promise<number[]> { // [PR-L6, 2026-10-19] an optional signal, passed to the SDK call (in place: :11 and :25 are cited)
  const [vector] = await embedBatch([text], options);
  return vector;
}

/**
 * Embed up to MAX_EMBED_BATCH_SIZE strings in ONE API call.
 * Output order matches input order. Throws if the batch is too large — callers
 * with arbitrary counts should use `embedMany`.
 */
export async function embedBatch(texts: string[], options?: { signal?: AbortSignal }): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (texts.length > MAX_EMBED_BATCH_SIZE) {
    throw new Error(
      `embedBatch received ${texts.length} texts; max is ${MAX_EMBED_BATCH_SIZE}. Use embedMany().`,
    );
  }
  const openai = getOpenAIClient(); const res = await recordModelCall({ provider: "openai", model: EMBEDDING_MODEL, kind: "embedding", usage: embeddingUsage }, () => openai.embeddings.create({ // [B24-C1] D24-21, OD-207: one call record per SDK call; the client comes first, so a missing key leaves no record
    model: EMBEDDING_MODEL,
    input: texts,
  }, options?.signal ? { signal: options.signal } : undefined));
  return res.data.map((d) => d.embedding);
}

/**
 * Embed any number of strings, automatically chunking into batches of
 * MAX_EMBED_BATCH_SIZE. Output order matches input order.
 */
export async function embedMany(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += MAX_EMBED_BATCH_SIZE) {
    const chunk = texts.slice(i, i + MAX_EMBED_BATCH_SIZE);
    out.push(...(await embedBatch(chunk)));
  }
  return out;
}

// [B24-C1] D24-21, OD-207: the call-record seam, appended after the last line - an import and a function declaration are hoisted, so
// no line cited in this file moves.
import { recordModelCall, type ModelCallUsage } from "./observability/llm-call-record";

/** What a call record keeps of an embedding answer: its model and its prompt token count (an embedding reports no output tokens). */
function embeddingUsage(response: { model?: unknown; usage?: { prompt_tokens?: unknown } }): ModelCallUsage {
  return { model: response.model, inputTokens: response.usage?.prompt_tokens, outputTokens: null };
}
