export const DEFAULT_OPENAI_MODEL = "gpt-5.6-sol";

const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type OpenAIReasoningEffort = (typeof REASONING_EFFORTS)[number];

export interface OpenAIModelProfile {
  id: string;
  label: string;
  contextWindowTokens?: number;
  maxOutputTokens?: number; /** [PR-F, 2026-10-17] a QUALIFIABLE profile's pins (gpt-6-astra): the efforts its documentation supports and the one sent when the configured effort is outside them (`boundOpenAIReasoningEffort`, appended below); admission "server-env" = qualified for a role only when the server environment names the model (provider-policy.ts: the configured model, or the role map), never by family rule alone. In place: no cited line moves */ reasoningEfforts?: readonly OpenAIReasoningEffort[]; reasoningEffort?: OpenAIReasoningEffort; admission?: "server-env";
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
  }, "gpt-6-astra": { id: "gpt-6-astra", label: "GPT-6 Astra", contextWindowTokens: 1_050_000, maxOutputTokens: 128_000, reasoningEfforts: ["low", "medium", "high", "xhigh", "max"], reasoningEffort: "high", admission: "server-env" }, // [PR-F, 2026-10-17] the one documented GPT-6 id with a profile (developers.openai.com/api/docs/models/gpt-6-astra, read 2026-10-17: context 1 050 000, max output 128 000, efforts low..max; the reasoning guide: `none` is HTTP 400 there); QUALIFIABLE through the server env only - DEFAULT_OPENAI_MODEL stays, nothing selects it by default. In place: no cited line moves
};

export function configuredOpenAIModel(environment: Readonly<Record<string, string | undefined>> = process.env): string { // [B21 E1] the environment a caller hands in (the role policy); process.env by default, as before
  return environment.SIRKIT_OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
}

export function configuredOpenAIReasoningEffort(
  model = configuredOpenAIModel(),
): OpenAIReasoningEffort | undefined {
  if (!OPENAI_REASONING_MODEL_FAMILY.test(model)) return undefined;
  const configured = process.env.SIRKIT_OPENAI_REASONING_EFFORT?.trim().toLowerCase();
  if (!configured) return boundOpenAIReasoningEffort(model, "high"); // [PR-F, 2026-10-17] in place: a profile's pinned effort when it declares one (gpt-6-astra: "high", inside its documented set)
  return boundOpenAIReasoningEffort(model, REASONING_EFFORTS.find((effort) => effort === configured) ?? "high"); // [PR-F, 2026-10-17] in place: an effort outside a profile's documented set is never sent - its pinned effort is
}

export function openAIModelProfile(model = configuredOpenAIModel()): OpenAIModelProfile {
  return MODEL_PROFILES[model] ?? { id: model, label: model };
}

// [B21 E1] The two pinned OpenAI model-family rules, named ONCE (they were inline here and in `openai-provider.ts`): the family whose
// reasoning effort and profiles are pinned, and the family for which temperature is never sent. The orchestration role policy (OD-117)
// reads these same objects; a model its provider's rules do not all classify is refused for a role until qualified live (LB-9).
export const OPENAI_REASONING_MODEL_FAMILY = /^gpt-5\.6(?:-|$)|^gpt-6-astra$/; // [PR-F, 2026-10-17] + the one documented GPT-6 id that has a profile, anchored exactly (a sibling id - gpt-6-luna, gpt-6-sol, gpt-6.1-sol - stays outside until it has its own profile); its admission for a role is the server env's (provider-policy.ts). In place
export const OPENAI_NO_TEMPERATURE_MODEL_FAMILY = /^(?:gpt-5|o\d)|^gpt-6-astra$/; // [PR-F, 2026-10-17] temperature is never sent to Astra (the model guide, read 2026-10-17: remove temperature / top_p with any reasoning effort; `none` is unsupported there). In place

// ─── [PR-F, 2026-10-17] A profile's reasoning-effort bound (directive 4; CONTINUATION B: "pin supported reasoning effort") ─────────────
// Appended on purpose (a function declaration is hoisted): the flag inventory pins :41 and :48 as the two readers, B21-E1 pins :47 and
// the B21 pages cite :60-61, so no line above moves. Read by configuredOpenAIReasoningEffort (:49-50) and by the deployment
// configuration's mirror of it (configuration.ts), so what the record reports IS what the adapters send.

/** The effort the family rule yields, bounded by the model's profile when the profile declares its documented set: an effort outside
 *  the set is never sent - the profile's pinned effort is. A model whose profile declares no set (the gpt-5.6 family) keeps today's
 *  effort exactly. */
export function boundOpenAIReasoningEffort(model: string, effort: OpenAIReasoningEffort): OpenAIReasoningEffort {
  const profile = MODEL_PROFILES[model];
  if (!profile?.reasoningEfforts || !profile.reasoningEffort) return effort;
  return profile.reasoningEfforts.includes(effort) ? effort : profile.reasoningEffort;
}
