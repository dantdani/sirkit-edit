/**
 * GET /api/ready
 *
 * [B24-A1] D24-9, OD-198: readiness, on the internal-worker class (the worker secret) through a reviewed read-only row
 * (route-policy.ts `readOnlyWorker`, never `worker()`, whose rows are authoritative writes). 401 without the credential; otherwise
 * 200 or 503 with `{ ready, checks, configurationDigest }` - check names and closed states only, never a value. The checks are
 * app/lib/deployment/readiness.ts's, the database probe bounded at 2,000 ms; the route binds no SDK client and starts no process.
 * Least privilege, RECORDED: the same secret also authorizes the three worker write routes; a separate credential is OD-195's (B24-A2).
 */
import { workerRoute } from "@/app/lib/auth/route-handlers";
import { readinessReport } from "@/app/lib/deployment/readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = workerRoute({}, async () => {
  const report = await readinessReport();
  return Response.json(report, { status: report.ready ? 200 : 503, headers: { "Cache-Control": "no-store" } });
});
