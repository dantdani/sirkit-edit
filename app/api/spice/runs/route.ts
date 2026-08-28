import { getBatch, getRuns, startRunPlan } from "@/app/lib/spice/server/job-store";
import type { SimulationPartSnapshot, SimulationProject } from "@/app/lib/spice/types";
import { authenticatedJsonRoute, authenticatedRoute } from "@/app/lib/auth/route-handlers";
import { spiceRunScopeFromContext } from "./_scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Run-plan bodies carry a whole SimulationProject (+ part snapshots). */
const MAX_BODY_BYTES = 8_000_000;
const BODY_DEADLINE_MS = 30_000;

// [B16.0.2 §B] authorize FIRST (identity + membership + role + CSRF), then a
// bounded body read, then start the plan under the TRUSTED scope. The body's
// `project.id` is a client assertion kept for display only.
// [B16.0.23] canonical wrapper — that ordering now lives in
// `authenticatedJsonRoute` (8 MB / 30 s); the callback never sees the Request.
export const POST = authenticatedJsonRoute<{ project?: SimulationProject; runPlanId?: string; parts?: SimulationPartSnapshot[] }>(
  { maxBytes: MAX_BODY_BYTES, deadlineMs: BODY_DEADLINE_MS },
  ({ context, body }) => {
  if (!body.project || typeof body.project !== "object" || typeof body.runPlanId !== "string") {
    return Response.json({ ok: false, error: "project and runPlanId are required" }, { status: 400 });
  }
  try {
    const batch = startRunPlan({ scope: spiceRunScopeFromContext(context), project: body.project, runPlanId: body.runPlanId, parts: Array.isArray(body.parts) ? body.parts : [] });
    return Response.json({ ok: true, batch }, { status: 202 });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 });
  }
  });

// [B16.0.23] canonical wrapper — all-members read, no CSRF; the header-less
// selector (EventSource/anchor surfaces) travels through the wrapper's
// per-request `querySelector` derivation, and the filters arrive through the
// bounded first-value-wins query projection. Every lookup is bound to the
// trusted scope: foreign ids are simply absent.
export const GET = authenticatedRoute({ query: true, querySelector: true }, ({ context, meta }) => {
  const scope = spiceRunScopeFromContext(context), query = meta.query ?? {};
  const ids = query.ids?.split(",").filter(Boolean);
  const batchId = query.batchId;
  return Response.json({ ok: true, runs: getRuns(scope, ids), batch: batchId ? getBatch(batchId, scope) : null }, { headers: { "Cache-Control": "no-store" } });
});
