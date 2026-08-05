import { timingSafeEqual } from "node:crypto";
import { assignmentRevalidationOutboxHandlers } from "@/app/lib/assignment-queue/revalidation";
import { getAssignmentQueueRuntime } from "@/app/lib/assignment-queue/runtime";
import { dispatchDurableEffects } from "@/app/lib/durable-workflow/effects-runtime";

export const runtime = "nodejs";
function authorized(request: Request): boolean { const configured = process.env.SIRKIT_WORKFLOW_WORKER_SECRET, supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, ""); if (!configured || !supplied) return false; const left = Buffer.from(configured), right = Buffer.from(supplied); return left.length === right.length && timingSafeEqual(left, right); }
export async function POST(request: Request): Promise<Response> {
  if (!authorized(request)) return Response.json({ ok: false, code: "AQ_REVALIDATION_WORKER_UNAUTHORIZED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const handlers = assignmentRevalidationOutboxHandlers(getAssignmentQueueRuntime().revalidation);
    const result = await dispatchDurableEffects({ workerId: "assignment-revalidation-worker", topics: ["assignment.revalidation-requested"], extraHandlers: handlers, limit: 25, signal: request.signal });
    return Response.json({ ok: true, result, boardChanged: false }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ ok: false, code: "AQ_REVALIDATION_WORKER_FAILED" }, { status: 500, headers: { "Cache-Control": "no-store" } }); }
}
