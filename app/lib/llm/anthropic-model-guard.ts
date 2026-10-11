/**
 * [B24-A1] D24-10, OD-199: an Anthropic model the configuration refuses is refused, never sent. Both Anthropic clients (the agent
 * adapter and the LLM provider) pass their model through `sendableAnthropicModel` while they build the request, before the SDK's
 * request call (`messages.create` or `messages.stream`): an empty or padded model throws `LLMProviderError("anthropic", "bad_request")`
 * with the refusal's own message ([B24-A1 review] below). Kept apart from `anthropic-config.ts`, which stays dependency-free.
 */
import { LLMProviderError } from "./errors";

export function sendableAnthropicModel(model: string): string {
  if (typeof model !== "string" || model.trim() === "" || model !== model.trim()) throw refusedModel();
  return model;
}

/** [B24-A1 review] regressions-4 (OD-223 (l)): the reason stays `bad_request`, the closed failure every caller already maps, but the
 *  message is this refusal's own - nothing was sent, and the cause is the server setting - in place of the generic text, which reads
 *  as Anthropic rejecting a request Sirkit built. The value is never echoed. (A role's override model never reaches here padded:
 *  `parseRoleModelOverrides` admits only a bare model id.) */
export const ANTHROPIC_MODEL_REFUSED_MESSAGE =
  "Sirkit did not send this request to Anthropic: its configured model, the server setting SIRKIT_ANTHROPIC_MODEL, is empty or padded with whitespace. Fix that server-side setting and restart.";

function refusedModel(): LLMProviderError {
  const refusal = new LLMProviderError("anthropic", "bad_request");
  refusal.message = ANTHROPIC_MODEL_REFUSED_MESSAGE;
  return refusal;
}
