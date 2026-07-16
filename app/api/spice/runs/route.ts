import { getBatch, getRuns, startRunPlan } from "@/app/lib/spice/server/job-store";
import type { SimulationPartSnapshot, SimulationProject } from "@/app/lib/spice/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  let body: { project?: SimulationProject; runPlanId?: string; parts?: SimulationPartSnapshot[] };
  try {
    body = await req.json() as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.project || typeof body.runPlanId !== "string") return Response.json({ ok: false, error: "project and runPlanId are required" }, { status: 400 });
  try {
    const batch = startRunPlan({ project: body.project, runPlanId: body.runPlanId, parts: body.parts ?? [] });
    return Response.json({ ok: true, batch }, { status: 202 });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 });
  }
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const ids = url.searchParams.get("ids")?.split(",").filter(Boolean);
  const batchId = url.searchParams.get("batchId");
  return Response.json({ ok: true, runs: getRuns(ids), batch: batchId ? getBatch(batchId) : null });
}
