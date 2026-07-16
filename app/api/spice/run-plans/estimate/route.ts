import { estimateRunPlan } from "@/app/lib/spice/run-plan";
import type { SimulationProject } from "@/app/lib/spice/types";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json() as { project?: SimulationProject; runPlanId?: string };
    if (!body.project || typeof body.runPlanId !== "string") return Response.json({ ok: false, error: "project and runPlanId are required" }, { status: 400 });
    return Response.json({ ok: true, estimate: estimateRunPlan(body.project, body.runPlanId) });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 });
  }
}
