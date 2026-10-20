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
 *
 * [PR-M, 2026-10-18] Section M2: the same worker also consumes the component-resolution topic (`component-resolution-slice`): the one
 * pumped slice may be an acquisition slice, whose CAD retrieval reads an ADMITTED CAD source through the egress boundary (the route's
 * classification says `observation-query`); under the fixture runtime that source is the fixture host's committed bytes.
 *
 * [PR-L7, 2026-10-20] The idle hold: a request may ask `?hold=<ms>` (at most 8 s). When its tick ran nothing and this process has an
 * in-process work signal - the fixture container's, notified by every commit that schedules outbox work - the request waits for it and
 * ticks again (`runHeldPumpedSlice`), answering `heldMs`; so the worker's idle backoff costs no pickup latency: a Start, Resume, Retry
 * or acquisition wakes the waiting request at once. Without the signal (outside the fixture) nothing is held and `heldMs` is absent.
 */
import { workerRoute } from "@/app/lib/auth/route-handlers";
import { resolveMembershipRepository } from "@/app/lib/auth/identity-runtime";
import { schematicGenerationServable } from "@/app/api/chat/schematic-generation-runtime";
import { withLlmCallScope } from "@/app/lib/observability/llm-call-record";
import { generationTaskStoreOf, resolveGenerationTaskRuntime } from "@/app/lib/generation-task/runtime";
import { GENERATION_NO_STORE, generationStoreUnavailable } from "@/app/lib/generation-task/route-support";
import { GENERATION_TASK_ROUTE, createGenerationSliceRevalidator, pumpHoldMsOf, resolveGenerationSlicePorts, runHeldPumpedSlice, runPumpedSlice } from "@/app/lib/generation-task/worker/runtime";
import { fixtureRuntimeEnabled } from "@/app/lib/fixture-runtime/mode"; // [PR-L7, 2026-10-20] the idle hold's work signal is the fixture container's
import { fixtureContainer } from "@/app/lib/fixture-runtime/container";
import { resolveComponentResolutionRuntime } from "@/app/lib/component-resolution/task/runtime"; // [PR-M, 2026-10-18] M2
import { componentResolutionTopic } from "@/app/lib/component-resolution/task/worker-runtime";
import { resolveCatalogInspectionPort } from "@/app/api/chat/catalog-inspection-runtime";
import { resolveRevisionEvidencePort } from "@/app/api/chat/revision-evidence-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = workerRoute({ unauthorized: { code: "GENERATION_WORKER_UNAUTHORIZED", noStore: true }, exposeAbortSignal: true, query: true }, async ({ signal, meta }) => { // [PR-L7, 2026-10-20] + query: the idle hold (`?hold=`)
  const taskRuntime = resolveGenerationTaskRuntime();
  if (!taskRuntime) return generationStoreUnavailable();
  try {
    // [PR-M, 2026-10-18] M2: the component-resolution topic, when its durable store and the catalog are here
    const resolution = resolveComponentResolutionRuntime();
    const topic = resolution ? componentResolutionTopic(resolution, () => { const catalog = resolveCatalogInspectionPort(), evidence = resolveRevisionEvidencePort(); return catalog && evidence ? { catalog, evidence } : null; }) : null;
    const tick = () => runPumpedSlice({
      store: generationTaskStoreOf(taskRuntime),
      ports: resolveGenerationSlicePorts(),
      revalidate: createGenerationSliceRevalidator({ membership: resolveMembershipRepository, providerServable: (provider) => schematicGenerationServable(provider) }),
      clock: taskRuntime.clock,
      runInScope: (scope, run) => withLlmCallScope({ routeId: GENERATION_TASK_ROUTE.routeId, method: GENERATION_TASK_ROUTE.method, scope }, run),
      ...(signal ? { signal } : {}),
      ...(topic ? { topics: [topic] } : {}),
    });
    // [PR-L7, 2026-10-20] the idle hold (fixture only: the container's in-process work signal); `heldMs` tells the worker it was held
    const answer = await runHeldPumpedSlice({ run: tick, holdMs: pumpHoldMsOf(meta.query?.hold), work: fixtureRuntimeEnabled() ? fixtureContainer().work : null, now: taskRuntime.clock, ...(signal ? { signal } : {}) });
    return Response.json({ ok: true, tick: answer.tick, ran: answer.ran, ...(answer.heldMs !== undefined ? { heldMs: answer.heldMs } : {}) }, { headers: GENERATION_NO_STORE });
  } catch {
    return Response.json({ ok: false, code: "GENERATION_WORKER_FAILED" }, { status: 500, headers: GENERATION_NO_STORE });
  }
});
