import { timingSafeEqual } from "node:crypto";
import { getAssignmentQueueRuntime } from "@/app/lib/assignment-queue/runtime";
import type { AssignmentSourceBundle } from "@/app/lib/assignment-queue/types";

export const runtime = "nodejs";
const { service: assignmentService } = getAssignmentQueueRuntime();
function authorized(request: Request): boolean { const configured = process.env.SIRKIT_WORKFLOW_WORKER_SECRET, supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, ""); if (!configured || !supplied) return false; const left = Buffer.from(configured), right = Buffer.from(supplied); return left.length === right.length && timingSafeEqual(left, right); }
export async function POST(request: Request): Promise<Response> { if (!authorized(request)) return Response.json({ ok: false, code: "AQ_SOURCE_WORKER_UNAUTHORIZED" }, { status: 401 }); try { const bundle = await request.json() as AssignmentSourceBundle; const result = await assignmentService.refresh(bundle, { actorId: "assignment-source-coordinator", actorKind: "automated_engine", role: "automation", sessionId: "assignment-materialize" }); return Response.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { const code = error instanceof Error && /^AQ_[A-Z0-9_]+/.test(error.message) ? error.message : "AQ_SOURCE_MATERIALIZATION_FAILED"; return Response.json({ ok: false, code }, { status: 422 }); } }
