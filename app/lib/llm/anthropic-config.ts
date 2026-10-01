/**
 * [B21 E1] The Anthropic model configuration in ONE dependency-free module (the OpenAI one is `openai-config.ts`): the default
 * model, the configured model, and the one pinned model-family rule the Anthropic provider applies (temperature is sent only for
 * these models, `anthropic-provider.ts`). Moved here from the provider modules, never copied: the providers, the agent adapter and
 * the orchestration role policy (OD-117, `app/lib/agent/orchestration/provider-policy.ts`) read these same values.
 */

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-4-7";

/** The Anthropic family whose temperature handling is pinned (`anthropic-provider.ts` sends temperature only for it). */
export const ANTHROPIC_TEMPERATURE_MODEL_FAMILY = /^claude-3-|^claude-(?:sonnet|opus)-4-[0-5]/;

/** The server's one configured Anthropic model: `SIRKIT_ANTHROPIC_MODEL`, else the default (exactly the adapters' former inline default). */
export function configuredAnthropicModel(environment: Readonly<Record<string, string | undefined>> = process.env): string {
  return environment.SIRKIT_ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL;
}
