/**
 * [PR-L, 2026-10-17] Runbook L.4, increment 4 (task-worker-contract.md section 4, worker.md): POST /api/generation-worker - the HTTP PUMP a
 * generation worker process drives (`pnpm run worker:generation -- --transport pump --origin <server>`): ONE awaited, bounded slice of a
 * queued durable generation task, run inside this server process by the same `GenerationWorker` and slice code as the direct transport
 * (the `/api/engineering-effects` precedent). The fixture runtime needs it (its task store lives only in the dev server's process).
 *
 * The canonical worker wrapper: the worker secret (`SIRKIT_WORKFLOW_WORKER_SECRET`, constant-time) BEFORE anything; unset, every request
 * is refused (fail closed). The slice's provider calls are recorded under the route that admitted the task (`/api/generation-tasks`) and
 * its scope; the continuation re-check (live membership, role, provider) runs before any provider call. A request that goes away (the
 * pump stopping) is a worker SHUTDOWN for the slice - it yields at its next turn boundary or is released - never the user's cancel.
 * Answers `{ ok, tick, ran }` (`ran` null: nothing was due).
 */
import { workerRoute } from "@/app/lib/auth/route-handlers";
import { resolveMembershipRepository } from "@/app/lib/auth/identity-runtime";
import { schematicGenerationServable } from "@/app/api/chat/schematic-generation-runtime";
import { withLlmCallScope } from "@/app/lib/observability/llm-call-record";
import { generationTaskStoreOf, resolveGenerationTaskRuntime } from "@/app/lib/generation-task/runtime";
import { GENERATION_NO_STORE, generationStoreUnavailable } from "@/app/lib/generation-task/route-support";
import { GENERATION_TASK_ROUTE, createGenerationSliceRevalidator, resolveGenerationSlicePorts, runPumpedSlice } from "@/app/lib/generation-task/worker/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = workerRoute({ unauthorized: { code: "GENERATION_WORKER_UNAUTHORIZED", noStore: true }, exposeAbortSignal: true }, async ({ signal }) => {
  const taskRuntime = resolveGenerationTaskRuntime();
  if (!taskRuntime) return generationStoreUnavailable();
  try {
    const answer = await runPumpedSlice({
      store: generationTaskStoreOf(taskRuntime),
      ports: resolveGenerationSlicePorts(),
      revalidate: createGenerationSliceRevalidator({ membership: resolveMembershipRepository, providerServable: (provider) => schematicGenerationServable(provider) }),
      clock: taskRuntime.clock,
      runInScope: (scope, run) => withLlmCallScope({ routeId: GENERATION_TASK_ROUTE.routeId, method: GENERATION_TASK_ROUTE.method, scope }, run),
      ...(signal ? { signal } : {}),
    });
    return Response.json({ ok: true, tick: answer.tick, ran: answer.ran }, { headers: GENERATION_NO_STORE });
  } catch {
    return Response.json({ ok: false, code: "GENERATION_WORKER_FAILED" }, { status: 500, headers: GENERATION_NO_STORE });
  }
});
