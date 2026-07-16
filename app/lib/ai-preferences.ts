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

export async function throwAiResponseError(response: Response, retry?: () => void): Promise<never> {
  let data: { code?: unknown; provider?: unknown; error?: unknown } = {};
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
    window.dispatchEvent(
      new CustomEvent("sirkit:ai-provider-failure", { detail: { provider: data.provider, retry } }),
    );
    throw new AiProviderUnavailableError(data.provider, message);
  }
  throw new Error(
    typeof data.error === "string" ? data.error : `AI request failed (${response.status})`,
  );
}
