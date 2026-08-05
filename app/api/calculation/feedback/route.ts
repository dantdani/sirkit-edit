import { createCalculationFeedback } from "@/app/lib/calculation/feedback";
import { scopedJson } from "../_scope";
export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> { const parsed = await scopedJson(request); if (!parsed.ok) return parsed.response; try { const feedback = createCalculationFeedback(parsed.body as never); return Response.json({ ok: true, feedback, consequence: "invalidate_only_the_pinned_dependency_successors_and_recompile" }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 }); } }
