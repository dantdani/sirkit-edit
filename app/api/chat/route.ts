import { llmRouter } from "@/app/lib/llm/router";
import { providerErrorResponse } from "@/app/lib/llm/errors";
import { requestedProvider } from "@/app/lib/llm/request";
import type { LLMMessage } from "@/app/lib/llm/types";
import { CHAT_SYSTEM_PROMPT } from "@/app/lib/prompts";

export async function POST(req: Request) {
  const body = (await req.json()) as {
    messages?: unknown;
    provider?: unknown;
    boardState?: unknown;
    schematicState?: unknown;
    retrievedContext?: unknown;
    designConstraints?: unknown;
  };
  const provider = requestedProvider(body.provider);
  const messages = Array.isArray(body.messages) ? (body.messages as LLMMessage[]) : [];
  if (messages.length === 0) {
    return Response.json({ ok: false, error: "messages are required" }, { status: 400 });
  }

  const iterator = llmRouter
    .stream({
      provider,
      maxTokens: 1024,
      system: CHAT_SYSTEM_PROMPT,
      messages,
      boardState: body.boardState,
      schematicState: body.schematicState,
      retrievedContext: body.retrievedContext,
      designConstraints: body.designConstraints,
    })
    [Symbol.asyncIterator]();

  let first: Awaited<ReturnType<typeof iterator.next>>;
  try {
    // Start the upstream request before returning HTTP 200 so provider failures
    // remain structured 503 responses the client can offer explicit recovery for.
    first = await iterator.next();
  } catch (error) {
    return providerErrorResponse(error, provider);
  }

  const readable = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        let item = first;
        while (!item.done) {
          if (item.value.type === "text_delta") {
            controller.enqueue(encoder.encode(item.value.text));
          }
          item = await iterator.next();
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Sirkit-AI-Provider": provider,
      "Cache-Control": "no-store",
    },
  });
}
