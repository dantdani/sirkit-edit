import { isLLMProviderId, type LLMProviderId } from "./types";

export function requestedProvider(value: unknown): LLMProviderId {
  return isLLMProviderId(value) ? value : "openai";
}
