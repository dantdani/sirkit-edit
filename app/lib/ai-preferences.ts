import {
  isLLMProviderId,
  type AiProjectSettings,
  type LLMProviderId,
} from "@/app/lib/llm/types";

const GLOBAL_BRAIN_KEY = "sirkit:aiBrain";
const CURRENT_PROJECT_KEY = "sirkit:currentProjectId";
const PROJECT_PREFIX = "sirkit:project:";
const UNSAVED_HISTORY_KEY = "sirkit:aiBrainHistory:unsaved";

function projectRecord(): { key: string; value: Record<string, unknown> } | null {
  try {
    const id = localStorage.getItem(CURRENT_PROJECT_KEY);
    if (!id) return null;
    const key = PROJECT_PREFIX + id;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as unknown;
    return typeof value === "object" && value !== null
      ? { key, value: value as Record<string, unknown> }
      : null;
  } catch {
    return null;
  }
}

function projectBrain(record: ReturnType<typeof projectRecord>): LLMProviderId | null {
  if (!record) return null;
  const ai = record.value.ai;
  if (typeof ai !== "object" || ai === null) return null;
  const brain = (ai as Record<string, unknown>).brain;
  return isLLMProviderId(brain) ? brain : null;
}

export function loadAiBrainPreference(): LLMProviderId {
  if (typeof window === "undefined") return "openai";
  const fromProject = projectBrain(projectRecord());
  if (fromProject) return fromProject;
  try {
    const global = localStorage.getItem(GLOBAL_BRAIN_KEY);
    return isLLMProviderId(global) ? global : "openai";
  } catch {
    return "openai";
  }
}

export function saveAiBrainPreference(next: LLMProviderId): void {
  if (typeof window === "undefined") return;
  const record = projectRecord();
  const previous = projectBrain(record) ?? loadAiBrainPreference();
  try {
    localStorage.setItem(GLOBAL_BRAIN_KEY, next);
    const changed = previous !== next;
    const entry = {
      id: crypto.randomUUID(),
      at: Date.now(),
      from: previous,
      to: next,
      kind: "ai-provider-switch" as const,
    };

    if (record) {
      const currentAi =
        typeof record.value.ai === "object" && record.value.ai !== null
          ? (record.value.ai as Partial<AiProjectSettings>)
          : {};
      const providerHistory = Array.isArray(currentAi.providerHistory)
        ? currentAi.providerHistory
        : [];
      record.value.ai = {
        brain: next,
        embeddings: "openai",
        providerHistory: changed ? [...providerHistory, entry].slice(-200) : providerHistory,
      } satisfies AiProjectSettings;
      record.value.updatedAt = Date.now();
      localStorage.setItem(record.key, JSON.stringify(record.value));
    } else if (changed) {
      const raw = localStorage.getItem(UNSAVED_HISTORY_KEY);
      const history = raw ? (JSON.parse(raw) as unknown) : [];
      localStorage.setItem(
        UNSAVED_HISTORY_KEY,
        JSON.stringify([...(Array.isArray(history) ? history : []), entry].slice(-200)),
      );
    }
    if (changed) {
      window.dispatchEvent(new CustomEvent("sirkit:ai-brain-change", { detail: next }));
    }
  } catch {
    // The active in-memory selection still works when storage is unavailable.
  }
}

export function withAiBrain<T extends Record<string, unknown>>(body: T): T & {
  provider: LLMProviderId;
} {
  return { ...body, provider: loadAiBrainPreference() };
}

export class AiProviderUnavailableError extends Error {
  constructor(readonly provider: LLMProviderId, message: string) {
    super(message);
    this.name = "AiProviderUnavailableError";
  }
}

/**
 * B07.5 — ownership contract for provider-failure notification. The
 * `sirkit:ai-provider-failure` event is GLOBAL, so every dispatch must
 * carry its owner: `isCurrent` is evaluated immediately before dispatch
 * (after the body-parse await — the race window) and again by the page
 * listener; the retry callback is wrapped so it refuses once its owner is
 * stale. A request whose owner already ended dispatches NOTHING — an old
 * project's quota failure can never repopulate the new project's failure
 * banner, retry, or chat state.
 */
export interface AiRequestOwnership {
  /** True while the originating project/session generation (page requests)
   *  or component lifetime (editor components) is still active. */
  isCurrent(): boolean;
}

export interface AiProviderFailureDetail {
  provider: LLMProviderId;
  retry?: () => void; /** [B21 E1 fix] false: the card's Retry is WITHHELD (out of credits, Sirkit's breaker open - D21-18); `retry` still starts the "Use <other> instead" run */ retryOffered?: false;
  /** Listener-side re-check: an event whose owner went stale between
   *  dispatch and delivery must be ignored. */
  stillCurrent?: () => boolean;
}

/**
 * [B09.1] the ONE owned dispatch path for the global provider-failure
 * event — used by the legacy JSON-error flow below AND the NDJSON
 * `run_failed provider_*` flow. Ownership is re-checked immediately before
 * dispatch; the retry closure is wrapped so it refuses once its owner is
 * stale (B07.5 guarantees preserved). A stale owner dispatches NOTHING.
 */
export function dispatchAiProviderFailure(input: {
  provider: LLMProviderId;
  retry?: () => void; /** [B21 E1 fix] false withholds the card's Retry (the closure still serves its Switch) */ retryOffered?: false;
  ownership?: AiRequestOwnership;
}): void {
  if (input.ownership && !input.ownership.isCurrent()) return;
  const ownership = input.ownership;
  const ownedRetry = input.retry && ownership
    ? () => { if (ownership.isCurrent()) input.retry!(); }
    : input.retry;
  const detail: AiProviderFailureDetail = {
    provider: input.provider,
    retry: ownedRetry, ...(input.retryOffered === false ? { retryOffered: false as const } : {}),
    ...(ownership ? { stillCurrent: () => ownership.isCurrent() } : {}),
  };
  window.dispatchEvent(new CustomEvent("sirkit:ai-provider-failure", { detail }));
}

export async function throwAiResponseError(
  response: Response,
  retry?: () => void,
  ownership?: AiRequestOwnership,
): Promise<never> {
  let data: { code?: unknown; provider?: unknown; error?: unknown; reason?: unknown } = {};
  try {
    data = (await response.json()) as typeof data;
  } catch {
    // Non-JSON failures still become a normal request error below.
  }
  if (data.code === "provider_unavailable" && isLLMProviderId(data.provider)) {
    const message =
      typeof data.error === "string"
        ? data.error
        : `${data.provider === "openai" ? "OpenAI" : "Anthropic"} is currently unavailable.`;
    // Re-check ownership AFTER the body-parse await; a stale owner
    // dispatches no global event (the throw below still lets the
    // originating handler's scoped catch settle its own state).
    // [B09.1] shared owned dispatch path.
    dispatchAiProviderFailure({ provider: data.provider, retry, ownership, ...(typeof data.reason === "string" && providerRetryWithheld(`provider_${data.reason}`) ? { retryOffered: false as const } : {}) }); // [B21 E1 fix] the same rule on the shared card's JSON path
    throw new AiProviderUnavailableError(data.provider, message);
  }
  throw new Error(
    typeof data.error === "string" ? data.error : `AI request failed (${response.status})`,
  );
}

// ─── [B21 E1] No Retry for a provider out of credits or paused by Sirkit's breaker (D21-18, OD-115) ─────────────────────────
// Appended on purpose: a declaration read only when a request fails moves no line above. The ONE list, here beside the ONE owned
// dispatch both card paths use (the chat run's settlement, `run-consumer.ts`, re-exports it; the JSON 503 path above reads it).

/** The provider failures the card never offers Retry for: out of credits (`insufficient_quota` - a retry cannot succeed until someone
 *  adds credits, and the classifier never marked it retryable) and paused by Sirkit's own llm-provider breaker (`breaker_open` - a retry
 *  would be refused without a call; no run in B21-E1 ends with it: the coordinator's turn is not gated). The card itself is still shown:
 *  its "Use <other> instead" is the human's own choice and still sends the message again on the other provider (B09.2); only its Retry
 *  is withheld (`retryOffered: false`, rendered disabled). */
export const PROVIDER_FAILURES_WITHOUT_RETRY = Object.freeze(["provider_insufficient_quota", "provider_breaker_open"] as const);

/** Whether the card's Retry is withheld for a failure `reason` (the `provider_*` vocabulary of a run's terminal). */
export function providerRetryWithheld(reason: string): boolean {
  return (PROVIDER_FAILURES_WITHOUT_RETRY as readonly string[]).includes(reason);
}
