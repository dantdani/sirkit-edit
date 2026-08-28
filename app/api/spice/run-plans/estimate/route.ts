import { estimateRunPlan } from "@/app/lib/spice/run-plan";
import type { SimulationProject } from "@/app/lib/spice/types";
import { publicJsonRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";

// [B16.0.23] canonical PUBLIC wrapper — a stateless, deterministic run-plan
// expansion estimate (8 MB / 30 s bounded read). No simulator, no durable
// state; an estimate is planning arithmetic, never an executed run.
export const POST = publicJsonRoute<{ project?: SimulationProject; runPlanId?: string }>(
  { maxBytes: 8_000_000, deadlineMs: 30_000 },
  ({ body }) => {
  try {
    if (!body.project || typeof body.runPlanId !== "string") return Response.json({ ok: false, error: "project and runPlanId are required" }, { status: 400 });
    return Response.json({ ok: true, estimate: estimateRunPlan(body.project, body.runPlanId) });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 });
  }
  });
