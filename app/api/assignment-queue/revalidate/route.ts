import { assignmentRevalidationOutboxHandlers } from "@/app/lib/assignment-queue/revalidation";
import { getAssignmentQueueRuntime } from "@/app/lib/assignment-queue/runtime";
import { dispatchDurableEffects } from "@/app/lib/durable-workflow/effects-runtime";
import { workerRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";

// [B16.0.8] canonical worker wrapper (no body) — declared historical refusal
// contract (AQ_REVALIDATION_WORKER_UNAUTHORIZED + no-store).
export const POST = workerRoute({ unauthorized: { code: "AQ_REVALIDATION_WORKER_UNAUTHORIZED", noStore: true }, exposeAbortSignal: true }, async ({ signal }) => {
  try {
    const handlers = assignmentRevalidationOutboxHandlers(getAssignmentQueueRuntime().revalidation);
    const result = await dispatchDurableEffects({ workerId: "assignment-revalidation-worker", topics: ["assignment.revalidation-requested"], extraHandlers: handlers, limit: 25, signal });
    return Response.json({ ok: true, result, boardChanged: false }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ ok: false, code: "AQ_REVALIDATION_WORKER_FAILED" }, { status: 500, headers: { "Cache-Control": "no-store" } }); }
});
