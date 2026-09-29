/**
 * B09.2 — production-owned agent-run failure classification and recovery
 * settlement (the exact logic the NDJSON chat consumer and the recovery
 * card execute; page.tsx delegates here so tests exercise PRODUCTION
 * behavior, not a lookalike).
 *
 * Ownership contract (B07.5): a stale, cancelled, or superseded run
 * settles NOTHING — no card, no retry install, no overwrite of the
 * current run's state. Retry always starts a NEW run (the injected
 * `startNewRun` is the page's fresh `send()` [superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): with SIRKIT_ORCHESTRATION_ENABLED=1 that same `send(text)` RESUMES an offered orchestrated run under its own run id when it is the same message on the same provider, project and branch - app/lib/project/chat-run-view.ts, artifacts/ai-control-plane-b21/route-resume.md, B21-E3, D21-4; anything else, and every run with the flag off, is a new run], which captures a new scope
 * and a new AbortController). Switch selects the alternative provider
 * BEFORE the new run starts.
 */

import { dispatchAiProviderFailure, providerRetryWithheld, type AiRequestOwnership } from "../ai-preferences";
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
  /** Starts a NEW run (fresh scope + fresh AbortController) [superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): the page's `send(text)`, which since B21-E3, with SIRKIT_ORCHESTRATION_ENABLED=1, resumes an offered orchestrated run of the same message and provider under its own run id - D21-4]. */
  startNewRun: () => void;
}): AgentRunFailureSettlement {
  if (!input.ownership.isCurrent()) return { recovered: false };
  if (!isRecoverableProviderFailure(input.reason)) return { recovered: false };
  dispatchAiProviderFailure({ provider: input.provider, retry: input.startNewRun, ownership: input.ownership, ...(providerRetryOffered(input.reason) ? {} : { retryOffered: false as const }) }); // [B21 E1] no Retry for quota or an open breaker; [B21 E1 fix] the Switch's new run kept
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

// ─── [B21 E1] No Retry for a provider out of credits or paused by Sirkit's breaker (D21-18, OD-115) ─────────────
// Appended on purpose: a function declaration is hoisted and the list is read only when a run fails, so no cited line moves.

/** The provider failures the card never offers Retry for (the ONE list, `ai-preferences.ts`, beside the owned dispatch): the card is
 *  still shown (`isRecoverableProviderFailure`) and its "Use <other> instead" still sends the message again on the other provider - the
 *  new-run closure rides along - while its Retry is withheld (`retryOffered: false`, rendered disabled). */
export { PROVIDER_FAILURES_WITHOUT_RETRY } from "../ai-preferences";

/** Whether the recovery card offers Retry for a run that failed with `reason`. */
export function providerRetryOffered(reason: string): boolean {
  return isRecoverableProviderFailure(reason) && !providerRetryWithheld(reason);
}
