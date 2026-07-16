import { getRun, subscribeRun } from "@/app/lib/spice/server/job-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const terminal = new Set(["completed", "failed", "cancelled"]);

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  if (!getRun(id)) return Response.json({ ok: false, error: "Run not found" }, { status: 404 });
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      unsubscribe = subscribeRun(id, (run) => {
        try {
          controller.enqueue(encoder.encode(`event: run\ndata: ${JSON.stringify(run)}\n\n`));
          if (terminal.has(run.status)) {
            unsubscribe?.();
            controller.close();
          }
        } catch {
          unsubscribe?.();
        }
      });
    },
    cancel() {
      unsubscribe?.();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
