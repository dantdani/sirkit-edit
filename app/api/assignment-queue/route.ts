import { assignmentQueueFeatureState } from "@/app/lib/assignment-queue/rollout";
import { getAssignmentQueueRuntime } from "@/app/lib/assignment-queue/runtime";
import { ASSIGNMENT_ITEM_VERSION, ASSIGNMENT_PLAN_VERSION, ASSIGNMENT_QUEUE_VERSION, ASSIGNMENT_REQUEST_VERSION, type AssignmentDecisionRequest } from "@/app/lib/assignment-queue/types";
import { authenticatedJsonRoute, authenticatedRoute } from "@/app/lib/auth/route-handlers";
import { ASSIGNMENT_API_DEADLINE_MS, ASSIGNMENT_API_MAX_BYTES, assignmentForbiddenAuthorityRefusal, assignmentScopeFromContext, object } from "./_scope";

export const runtime = "nodejs";
const { service: assignmentService } = getAssignmentQueueRuntime();

function errorResponse(error: unknown): Response { const message = error instanceof Error ? error.message : "AQ_INTERNAL_ERROR", code = /^AQ_[A-Z0-9_]+/.exec(message)?.[0] ?? "AQ_INTERNAL_ERROR", status = code.includes("UNAUTHORIZED") || code.includes("SCOPE") || code.includes("HUMAN") ? 403 : code.includes("NOT_FOUND") ? 404 : code.includes("STALE") || code.includes("CONFLICT") || code.includes("DIGEST") || code.includes("EXPIRED") ? 409 : code.includes("LIMIT") || code.includes("PAYLOAD") ? 413 : 422; return Response.json({ ok: false, code }, { status, headers: { "Cache-Control": "no-store" } }); }

// [B16.0.22] canonical wrapper — authorization inside the wrapper (all-members
// read, no CSRF per the exact policy row); the callback receives only the
// trusted context and the bounded first-value-wins query projection.
export const GET = authenticatedRoute({ query: true }, async ({ context, meta }) => {
  const scope = assignmentScopeFromContext(context);
  const state = assignmentQueueFeatureState(), q = meta.query ?? {};
  if (state === "off") return Response.json({ ok: false, code: "AQ_STAGE6_DISABLED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  try {
    const itemId = q.itemId;
    if (itemId) { const item = await assignmentService.get(itemId, { ...scope, actor: scope.actor, at: new Date().toISOString() }); return Response.json({ ok: true, state, item, boardChanged: false }, { headers: { "Cache-Control": "no-store" } }); }
    const page = await assignmentService.listPage({ ...scope, actor: scope.actor, at: new Date().toISOString(), assemblyVariantId: q.variant, includeHistorical: q.history === "true", lifecycle: q.lifecycle, category: q.category, riskClass: q.risk, assigneeId: q.assignee, query: q.q, cursor: q.cursor, limit: Math.min(200, Math.max(1, Number(q.limit ?? 100) || 100)) });
    return Response.json({ ok: true, state, authority: "durable_stage1_stage5_owner_orchestration", versions: { queue: ASSIGNMENT_QUEUE_VERSION, item: ASSIGNMENT_ITEM_VERSION, request: ASSIGNMENT_REQUEST_VERSION, plan: ASSIGNMENT_PLAN_VERSION }, ...page, boardChanged: false }, { headers: { "Cache-Control": "no-store", "X-Sirkit-Assignment-Queue": state } });
  } catch (error) { return errorResponse(error); }
});

// [B16.0.22] canonical wrapper — authorization + exact-origin CSRF + the
// bounded 1 MB / 30 s JSON read inside the wrapper; the commit opt-in header
// arrives ONLY through the declared safe-header projection. The historical
// forbidden-authority screen runs FIRST in the callback (same observable
// order: after the bounded read, before any feature-state or durable work).
export const POST = authenticatedJsonRoute(
  { maxBytes: ASSIGNMENT_API_MAX_BYTES, deadlineMs: ASSIGNMENT_API_DEADLINE_MS, safeHeaders: ["x-sirkit-assignment-commit"] },
  async ({ context, body, meta }) => {
    const forbidden = assignmentForbiddenAuthorityRefusal(body);
    if (forbidden) return forbidden;
    const scope = assignmentScopeFromContext(context), state = assignmentQueueFeatureState();
    if (state === "off") return Response.json({ ok: false, code: "AQ_STAGE6_DISABLED" }, { status: 503 });
    const operation = typeof body.operation === "string" ? body.operation : "preview";
    if (!object(body.request)) return Response.json({ ok: false, code: "AQ_API_REQUEST_REQUIRED" }, { status: 400 });
    const value = body.request as unknown as AssignmentDecisionRequest, scoped: AssignmentDecisionRequest = { ...value, tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId, actorContext: scope.actor, requestedAt: new Date().toISOString(), mode: operation === "commit" ? "commit" : "preview" };
    try {
      if (operation === "preview") { const result = await assignmentService.preview(scoped); return Response.json({ ok: true, operation, boardChanged: false, ...result }, { headers: { "Cache-Control": "no-store" } }); }
      if (operation === "commit") { if (state !== "opt_in" || meta.headers?.["x-sirkit-assignment-commit"] !== "apply_exact_plan") return Response.json({ ok: false, code: "AQ_COMMIT_OPT_IN_REQUIRED" }, { status: 403 }); const result = await assignmentService.commit(scoped); return Response.json({ ok: true, operation, result, boardChanged: false }, { headers: { "Cache-Control": "no-store" } }); }
      return Response.json({ ok: false, code: "AQ_API_OPERATION_UNSUPPORTED" }, { status: 400 });
    } catch (error) { return errorResponse(error); }
  });
