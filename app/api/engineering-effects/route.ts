import { dispatchDurableEffects } from "@/app/lib/durable-workflow/effects-runtime";
import { workerRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";

// [B16.0.8] canonical worker wrapper (no body): constant-time worker-secret
// boundary inside the wrapper; the historical refusal contract is DECLARED
// (DW_WORKER_UNAUTHORIZED + no-store); the callback receives only the worker
// principal and the AbortSignal — never the Request.
export const POST = workerRoute({ unauthorized: { code: "DW_WORKER_UNAUTHORIZED", noStore: true }, exposeAbortSignal: true }, async ({ signal }) => {
  try {
    const result = await dispatchDurableEffects({ workerId: "http-worker", limit: 50, signal });
    return Response.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false, code: "DW_WORKER_FAILED" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
});
