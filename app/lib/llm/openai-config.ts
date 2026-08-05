export const DEFAULT_OPENAI_MODEL = "gpt-5.6-sol";

const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type OpenAIReasoningEffort = (typeof REASONING_EFFORTS)[number];

export interface OpenAIModelProfile {
  id: string;
  label: string;
  contextWindowTokens?: number;
  maxOutputTokens?: number;
}

const MODEL_PROFILES: Record<string, OpenAIModelProfile> = {
  "gpt-5.6": {
    id: "gpt-5.6",
    label: "GPT-5.6 Sol",
    contextWindowTokens: 1_050_000,
    maxOutputTokens: 128_000,
  },
  "gpt-5.6-sol": {
    id: "gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    contextWindowTokens: 1_050_000,
    maxOutputTokens: 128_000,
  },
  "gpt-5.6-terra": {
    id: "gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    contextWindowTokens: 1_050_000,
    maxOutputTokens: 128_000,
  },
  "gpt-5.6-luna": {
    id: "gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    contextWindowTokens: 1_050_000,
    maxOutputTokens: 128_000,
  },
};

export function configuredOpenAIModel(): string {
  return process.env.SIRKIT_OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
}

export function configuredOpenAIReasoningEffort(
  model = configuredOpenAIModel(),
): OpenAIReasoningEffort | undefined {
  if (!/^gpt-5\.6(?:-|$)/.test(model)) return undefined;
  const configured = process.env.SIRKIT_OPENAI_REASONING_EFFORT?.trim().toLowerCase();
  if (!configured) return "high";
  return REASONING_EFFORTS.find((effort) => effort === configured) ?? "high";
}

export function openAIModelProfile(model = configuredOpenAIModel()): OpenAIModelProfile {
  return MODEL_PROFILES[model] ?? { id: model, label: model };
}
