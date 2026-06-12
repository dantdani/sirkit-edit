import Anthropic from "@anthropic-ai/sdk";
import { CHAT_SYSTEM_PROMPT } from "@/app/lib/prompts";

const client = new Anthropic();

export async function POST(req: Request) {
  const { messages } = await req.json();

  const stream = client.messages.stream({
    model: "claude-opus-4-7",
    max_tokens: 1024,
    system: CHAT_SYSTEM_PROMPT,
    messages,
  });

  const readable = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      for await (const chunk of stream) {
        if (
          chunk.type === "content_block_delta" &&
          chunk.delta.type === "text_delta"
        ) {
          controller.enqueue(enc.encode(chunk.delta.text));
        }
      }
      controller.close();
    },
    cancel() {
      stream.abort();
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
