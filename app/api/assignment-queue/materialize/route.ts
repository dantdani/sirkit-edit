import { getAssignmentQueueRuntime } from "@/app/lib/assignment-queue/runtime";
import type { AssignmentSourceBundle } from "@/app/lib/assignment-queue/types";
import { workerJsonRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";
const { service: assignmentService } = getAssignmentQueueRuntime();

// [B16.0.8] canonical worker JSON wrapper: constant-time worker-secret
// boundary → media type → bounded body, all inside the wrapper; the historical
// refusal contract is DECLARED (AQ_SOURCE_WORKER_UNAUTHORIZED, no Cache-Control
// on the 401 — pinned by parity); the callback receives the worker principal
// and the parsed bundle, never the Request or a human actor.
export const POST = workerJsonRoute({ maxBytes: 8000000, deadlineMs: 30000, unauthorized: { code: "AQ_SOURCE_WORKER_UNAUTHORIZED" } }, async ({ body }) => {
  const bundle = body as unknown as AssignmentSourceBundle;
  try {
    const result = await assignmentService.refresh(bundle, { actorId: "assignment-source-coordinator", actorKind: "automated_engine", role: "automation", sessionId: "assignment-materialize" });
    return Response.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error && /^AQ_[A-Z0-9_]+/.test(error.message) ? error.message : "AQ_SOURCE_MATERIALIZATION_FAILED";
    return Response.json({ ok: false, code }, { status: 422 });
  }
});
