import {
  configuredOpenAIModel,
  configuredOpenAIReasoningEffort,
  openAIModelProfile,
} from "@/app/lib/llm/openai-config";

import { publicRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";

// [B16.0.12] canonical wrapper — policy -> bounded metadata/body run inside
// the wrapper; the callback receives only bounded projections, never the Request.
export const GET = publicRoute(undefined, async (): Promise<Response> => {
  const openAIModel = configuredOpenAIModel();
  const openAIProfile = openAIModelProfile(openAIModel);
  const anthropicModel = process.env.SIRKIT_ANTHROPIC_MODEL?.trim() || "claude-opus-4-7";

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
          label: anthropicModel,
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
