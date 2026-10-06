import {
  configuredOpenAIModel,
  configuredOpenAIReasoningEffort,
  openAIModelProfile,
} from "@/app/lib/llm/openai-config";
import { anthropicModelSetting } from "@/app/lib/llm/anthropic-config"; // [B24-A1] OD-199: the setting the adapters send, refused when empty or padded
import { publicRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";

// [B16.0.12] canonical wrapper — policy -> bounded metadata/body run inside
// the wrapper; the callback receives only bounded projections, never the Request.
export const GET = publicRoute(undefined, async (): Promise<Response> => {
  const openAIModel = configuredOpenAIModel();
  const openAIProfile = openAIModelProfile(openAIModel);
  const anthropicSetting = anthropicModelSetting(); const anthropicModel = anthropicSetting.ok ? anthropicSetting.model : null; // [B24-A1] OD-199: what the Anthropic clients send (was `?.trim() || "claude-opus-4-7"`, D24-10); a refused setting reports no model

  return Response.json(
    {
      providers: {
        openai: {
          model: openAIProfile.id,
          label: openAIProfile.label,
          contextWindowTokens: openAIProfile.contextWindowTokens,
          maxOutputTokens: openAIProfile.maxOutputTokens,
          appContextCapTokens: null,
          reasoningEffort: configuredOpenAIReasoningEffort(openAIModel),
        },
        anthropic: {
          model: anthropicModel,
          label: anthropicSetting.ok ? anthropicSetting.model : `SIRKIT_ANTHROPIC_MODEL refused (${anthropicSetting.refusal})`,
        },
      },
      embeddings: {
        provider: "openai",
        model: "text-embedding-3-small",
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
