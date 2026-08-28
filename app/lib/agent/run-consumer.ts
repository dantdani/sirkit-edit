/**
 * B09.2 — production-owned agent-run failure classification and recovery
 * settlement (the exact logic the NDJSON chat consumer and the recovery
 * card execute; page.tsx delegates here so tests exercise PRODUCTION
 * behavior, not a lookalike).
 *
 * Ownership contract (B07.5): a stale, cancelled, or superseded run
 * settles NOTHING — no card, no retry install, no overwrite of the
 * current run's state. Retry always starts a NEW run (the injected
 * `startNewRun` is the page's fresh `send()`, which captures a new scope
 * and a new AbortController). Switch selects the alternative provider
 * BEFORE the new run starts.
 */

import { dispatchAiProviderFailure, type AiRequestOwnership } from "../ai-preferences";
import type { LLMProviderId } from "../llm/types";

/** provider_* reasons are recoverable; cancellation/deadline/etc. are not. */
export function isRecoverableProviderFailure(reason: string): boolean {
  return reason.startsWith("provider_") && reason !== "provider_cancelled";
}

export interface AgentRunFailureSettlement {
  /** True ⇒ the owned recovery event was dispatched (card shown). */
  recovered: boolean;
}

/**
 * Settle a terminal `run_failed` event from the NDJSON stream. Dispatches
 * the OWNED global provider-failure event (Retry / Switch card) only for
 * recoverable provider failures whose run generation is still current.
 */
export function settleAgentRunFailure(input: {
  reason: string;
  provider: LLMProviderId;
  ownership: AiRequestOwnership;
  /** Starts a NEW run (fresh scope + fresh AbortController). */
  startNewRun: () => void;
}): AgentRunFailureSettlement {
  if (!input.ownership.isCurrent()) return { recovered: false };
  if (!isRecoverableProviderFailure(input.reason)) return { recovered: false };
  dispatchAiProviderFailure({ provider: input.provider, retry: input.startNewRun, ownership: input.ownership });
  return { recovered: true };
}

export function resolveProviderSwitch(failed: LLMProviderId): LLMProviderId {
  return failed === "anthropic" ? "openai" : "anthropic";
}

/**
 * The Switch-Provider action: select the alternative provider FIRST, then
 * start the new run (which reads the freshly selected brain).
 */
export function performProviderSwitch(failed: LLMProviderId, deps: {
  selectProvider: (next: LLMProviderId) => void;
  startNewRun: (() => void) | null;
}): LLMProviderId {
  const next = resolveProviderSwitch(failed);
  deps.selectProvider(next);
  deps.startNewRun?.();
  return next;
}
