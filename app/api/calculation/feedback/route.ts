import { createCalculationFeedback } from "@/app/lib/calculation/feedback";
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";
import { CALCULATION_API_MAX_BYTES, CALCULATION_API_DEADLINE_MS } from "../_scope";
export const runtime = "nodejs";
export const POST = authenticatedJsonRoute({ maxBytes: CALCULATION_API_MAX_BYTES, deadlineMs: CALCULATION_API_DEADLINE_MS }, async ({ body }): Promise<Response> => { try { const feedback = createCalculationFeedback(body as never); return Response.json({ ok: true, feedback, consequence: "invalidate_only_the_pinned_dependency_successors_and_recompile" }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 }); } });
