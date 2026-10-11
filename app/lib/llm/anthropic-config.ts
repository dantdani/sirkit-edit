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

/** [B24-A1] D24-10, OD-199: the setting as a decision. An empty or padded value is refused by name, never echoed and never sent
 *  (`anthropic-model-guard.ts`); `/api/ai/runtime` and the deployment configuration report it. A well-formed value is exactly
 *  `configuredAnthropicModel`'s. Appended after the module's last line: no line B21 cites moves, and the module stays dependency-free. */
export const ANTHROPIC_MODEL_SETTING_REFUSALS = Object.freeze(["SIRKIT_ANTHROPIC_MODEL_EMPTY", "SIRKIT_ANTHROPIC_MODEL_PADDED"] as const);
export type AnthropicModelSetting =
  | { readonly ok: true; readonly model: string; readonly source: "default" | "configured" }
  | { readonly ok: false; readonly refusal: (typeof ANTHROPIC_MODEL_SETTING_REFUSALS)[number] };

export function anthropicModelSetting(environment: Readonly<Record<string, string | undefined>> = process.env): AnthropicModelSetting {
  const value = environment.SIRKIT_ANTHROPIC_MODEL;
  if (value === undefined) return Object.freeze({ ok: true, model: DEFAULT_ANTHROPIC_MODEL, source: "default" });
  if (value.trim() === "") return Object.freeze({ ok: false, refusal: "SIRKIT_ANTHROPIC_MODEL_EMPTY" });
  if (value !== value.trim()) return Object.freeze({ ok: false, refusal: "SIRKIT_ANTHROPIC_MODEL_PADDED" });
  return Object.freeze({ ok: true, model: value, source: "configured" });
}
