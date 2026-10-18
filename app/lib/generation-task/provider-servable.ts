/**
 * [PR-L, 2026-10-17] Runbook L.4, increment 4: whether a design task can be served here for a provider - the fixture runtime (its
 * scripted provider answers, no credits), or the provider's key is configured on the server (presence only; the value is never read
 * here). The SAME rule as `schematicGenerationServable` (app/api/chat/schematic-generation-runtime.ts; `l4-routes` case 1 pins the two
 * equal over every provider, key and fixture combination), in a module with no generation import: the five generation-task routes
 * accept, read and control durable tasks and never run the build loop, so their import closure must not reach it (the per-principal
 * window gate, `b24-a3-principal-limits` case 8, holds every route that reaches the loop to a provider-credit window). The worker pump
 * route, which does run slices, is the one generation route that reaches it.
 */
import { fixtureRuntimeEnabled } from "../fixture-runtime/mode";
import type { LLMProviderId } from "../llm/types";

/** The server setting that configures each provider (presence decides availability). */
const PROVIDER_KEY_SETTINGS: Readonly<Record<LLMProviderId, string>> = Object.freeze({ openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY" });

/** Whether a generation task can be served for `provider` in this environment. */
export function generationProviderServable(provider: LLMProviderId, environment: Record<string, string | undefined> = process.env): boolean {
  if (fixtureRuntimeEnabled(environment)) return true;
  const setting = PROVIDER_KEY_SETTINGS[provider];
  return setting !== undefined && (environment[setting] ?? "").trim().length > 0;
}
