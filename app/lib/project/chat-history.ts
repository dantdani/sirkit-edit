/**
 * [B19-D I5e row 32] The conversation history sent to the chat model.
 *
 * The page shows other models' output in the chat — the build explanation, the review and the second opinion — and used to
 * resend every one of them as the assistant's own earlier turn. That output was written from catalog-influenced input by
 * other model calls; replaying it as the assistant's words let its text steer the chat model. Messages marked `advisory` stay
 * visible to the person and are left out of the model's history.
 */
export interface HistoryMessage {
  id: string;
  role: string;
  content?: string;
  advisory?: boolean;
}

export function chatHistoryForModel(messages: readonly HistoryMessage[]): Array<{ role: "user" | "assistant"; content: string }> {
  return messages
    .filter((message): message is HistoryMessage & { role: "user" | "assistant"; content: string } => (message.role === "user" || message.role === "assistant") && typeof message.content === "string" && message.advisory !== true)
    .map(({ role, content }) => ({ role, content }));
}
