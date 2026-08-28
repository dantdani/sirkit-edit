import { getRun, subscribeRun } from "@/app/lib/spice/server/job-store";
import { authenticatedRoute } from "@/app/lib/auth/route-handlers";
import { runNotFound, spiceRunScopeFromContext } from "../../_scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const terminal = new Set(["completed", "failed", "cancelled"]);

// [B16.0.2 §B] authorize BEFORE opening the SSE stream or adding ANY
// listener; the run is resolved only inside the trusted scope (uniform
// 404 otherwise). EventSource cannot set headers, so the project selector
// travels in the query string (never authority — membership is reloaded).
// [B16.0.23] canonical wrapper — the selector parsing now lives in the
// wrapper's per-request `querySelector` derivation; the callback receives
// only the trusted context and the bounded run-id parameter, and returns the
// SSE stream Response directly.
export const GET = authenticatedRoute({ querySelector: true, routeParams: ["id"] }, ({ context, params }) => {
  const scope = spiceRunScopeFromContext(context), id = params!.id;
  if (!getRun(id, scope)) return runNotFound();
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // The subscription itself is scope-checked again inside the store.
      unsubscribe = subscribeRun(id, scope, (run) => {
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
});
