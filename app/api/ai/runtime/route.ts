import {
  configuredOpenAIModel,
  configuredOpenAIReasoningEffort,
  openAIModelProfile,
} from "@/app/lib/llm/openai-config";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
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
}
