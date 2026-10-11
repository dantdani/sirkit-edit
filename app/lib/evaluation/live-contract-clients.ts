/**
 * [B24-B3] The two provider SDK clients of the record-only command's per-provider contract turns (D24-18; OD-216, OD-125), and nothing
 * else: each built with `maxRetries: 0`, so one counted request is one request (the router's default clients retry - OpenAI's 5,
 * `openai-provider.ts`; Anthropic's the SDK default - and are never used for a live turn). It imports only the two SDKs, reads no
 * environment (the command hands it the keys) and is reached only by `scripts/run-b21-live-orchestration-evaluation.ts` through
 * `await import(...)` after every refusal: no route reaches it (b23-a-route-vocabulary case 8). It is the sixth production module that
 * imports a provider SDK at run time (`b21-a-import-gates` case 1 and `b20-a5-connector-tripwires` T2 and T4 moved by review).
 */
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

/** A contract turn's client deadline: one forced-tool turn, never retried. */
export const LIVE_CONTRACT_TIMEOUT_MS = 120_000;

/** The clients the router's provider classes take as their injected client, one per provider whose key the command holds. */
export function liveContractClients(keys: { readonly openai?: string; readonly anthropic?: string }): { readonly openai: Pick<OpenAI, "responses"> | null; readonly anthropic: Pick<Anthropic, "messages"> | null } {
  const openai = keys.openai ? new OpenAI({ apiKey: keys.openai, maxRetries: 0, timeout: LIVE_CONTRACT_TIMEOUT_MS }) : null;
  const anthropic = keys.anthropic ? new Anthropic({ apiKey: keys.anthropic, maxRetries: 0, timeout: LIVE_CONTRACT_TIMEOUT_MS }) : null;
  return { openai, anthropic };
}
